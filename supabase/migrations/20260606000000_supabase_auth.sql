-- ═══════════════════════════════════════════════════════
--  Migración a Supabase Auth nativo
-- ═══════════════════════════════════════════════════════

-- 1. Enlazar ps_usuarios con auth.users
ALTER TABLE ps_usuarios ADD COLUMN IF NOT EXISTS auth_user_id UUID UNIQUE;
CREATE INDEX IF NOT EXISTS ps_usuarios_auth_user_id_idx ON ps_usuarios (auth_user_id);

-- 2. Hook custom JWT claims (añade rol, area_ids, cedula, username, usuario_id al token)
CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE
  claims   jsonb;
  user_row RECORD;
BEGIN
  SELECT id, rol, area_ids, cedula, username, activo, cambiar_password
  INTO user_row
  FROM ps_usuarios
  WHERE auth_user_id = (event->>'user_id')::uuid;

  IF NOT FOUND OR NOT user_row.activo THEN
    -- Usuario inactivo o sin registro: devolver claims sin modificar
    -- (el Edge Function rechazará el acceso al verificar el rol)
    RETURN event;
  END IF;

  claims := event->'claims';
  claims := jsonb_set(claims, '{rol}',        to_jsonb(user_row.rol));
  claims := jsonb_set(claims, '{area_ids}',   to_jsonb(user_row.area_ids));
  claims := jsonb_set(claims, '{cedula}',     to_jsonb(user_row.cedula));
  claims := jsonb_set(claims, '{username}',   to_jsonb(user_row.username));
  claims := jsonb_set(claims, '{usuario_id}', to_jsonb(user_row.id::text));
  RETURN jsonb_set(event, '{claims}', claims);
END;
$$;

GRANT USAGE  ON SCHEMA public                       TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook TO supabase_auth_admin;

-- ═══════════════════════════════════════════════════════
--  3. RLS completo — usando claims del JWT de Supabase Auth
-- ═══════════════════════════════════════════════════════

-- ps_usuarios
CREATE POLICY "ps_usuarios_sa_all"
  ON ps_usuarios FOR ALL TO authenticated
  USING  ((auth.jwt()->>'rol') = 'SUPERADMIN')
  WITH CHECK ((auth.jwt()->>'rol') = 'SUPERADMIN');

CREATE POLICY "ps_usuarios_self_read"
  ON ps_usuarios FOR SELECT TO authenticated
  USING (auth_user_id = auth.uid());

-- ps_aprobaciones: SUPERADMIN ve todo; ADMIN ve/edita su área; COLABORADOR solo lee las suyas
CREATE POLICY "ps_aprobaciones_sa"
  ON ps_aprobaciones FOR ALL TO authenticated
  USING  ((auth.jwt()->>'rol') = 'SUPERADMIN')
  WITH CHECK ((auth.jwt()->>'rol') = 'SUPERADMIN');

CREATE POLICY "ps_aprobaciones_admin_area"
  ON ps_aprobaciones FOR ALL TO authenticated
  USING (
    (auth.jwt()->>'rol') = 'ADMIN'
    AND area_id = ANY(
      ARRAY(
        SELECT jsonb_array_elements_text(COALESCE(auth.jwt()->'area_ids', '[]'::jsonb))
      )::uuid[]
    )
  )
  WITH CHECK (
    (auth.jwt()->>'rol') = 'ADMIN'
    AND area_id = ANY(
      ARRAY(
        SELECT jsonb_array_elements_text(COALESCE(auth.jwt()->'area_ids', '[]'::jsonb))
      )::uuid[]
    )
  );

CREATE POLICY "ps_aprobaciones_colab_read"
  ON ps_aprobaciones FOR SELECT TO authenticated
  USING (
    (auth.jwt()->>'rol') = 'COLABORADOR'
    AND colaborador_id = (
      SELECT id FROM ps_colaboradores
      WHERE cedula = (auth.jwt()->>'cedula')
      LIMIT 1
    )
  );

-- ps_config: SA escribe, autenticados leen
CREATE POLICY "ps_config_auth_read"
  ON ps_config FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "ps_config_sa_write"
  ON ps_config FOR ALL TO authenticated
  USING  ((auth.jwt()->>'rol') = 'SUPERADMIN')
  WITH CHECK ((auth.jwt()->>'rol') = 'SUPERADMIN');

-- ps_logs: SA lee, el sistema inserta (con service_role que bypasea RLS)
CREATE POLICY "ps_logs_sa_read"
  ON ps_logs FOR SELECT TO authenticated
  USING ((auth.jwt()->>'rol') = 'SUPERADMIN');

-- ps_sesiones: ya no se usa con Supabase Auth nativo
DROP TABLE IF EXISTS ps_sesiones CASCADE;
