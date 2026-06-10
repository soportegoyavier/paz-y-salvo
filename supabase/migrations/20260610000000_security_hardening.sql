-- ═══════════════════════════════════════════════════════════
--  PAZ Y SALVO — Security Hardening
--  Corrige alertas del Security Advisor de Supabase
--  2026-06-10
-- ═══════════════════════════════════════════════════════════

-- ─── 1. search_path fijo en funciones SECURITY DEFINER ───────────────────────
--
-- Sin SET search_path, un atacante con permisos para crear esquemas podría
-- interponer objetos falsos (tablas, funciones) en el search_path y lograr
-- que una función SECURITY DEFINER ejecute código malicioso con privilegios
-- elevados. Fijar search_path = public elimina esa superficie de ataque.

CREATE OR REPLACE FUNCTION public.ps_get_areas_omitidas(p_cedula TEXT)
RETURNS UUID[] LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(ARRAY_AGG(DISTINCT unnested_id ORDER BY unnested_id), '{}'::UUID[])
  FROM ps_usuarios u, LATERAL UNNEST(u.area_ids) AS unnested_id
  WHERE u.rol = 'ADMIN' AND u.activo = TRUE AND u.cedula = p_cedula AND p_cedula != '';
$$;

CREATE OR REPLACE FUNCTION public.ps_audit_aprobaciones()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO ps_logs (accion, detalle, usuario, rol)
  VALUES (
    TG_OP || '_APROBACION',
    format('colaborador=%s area=%s estado=%s', NEW.colaborador_id, NEW.area_id, NEW.estado),
    COALESCE(NEW.aprobado_por, current_user),
    'TRIGGER'
  );
  RETURN NEW;
END;
$$;

-- El hook JWT tiene el mismo patrón de riesgo aunque no fue listado en las
-- alertas. Se corrige de forma preventiva. CREATE OR REPLACE preserva los
-- GRANTs existentes; el GRANT explícito garantiza que el hook funcione.
CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  claims   jsonb;
  user_row RECORD;
BEGIN
  SELECT id, rol, area_ids, cedula, username, activo, cambiar_password
  INTO user_row
  FROM ps_usuarios
  WHERE auth_user_id = (event->>'user_id')::uuid;

  IF NOT FOUND OR NOT user_row.activo THEN
    -- Usuario inactivo o sin registro: devolver claims sin modificar.
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

-- Garantizar que el hook JWT siga siendo invocable por el motor de Auth.
GRANT USAGE   ON SCHEMA public                            TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook TO supabase_auth_admin;

-- ─── 2 & 3. Revocar EXECUTE de anon y authenticated ──────────────────────────
--
-- ps_audit_aprobaciones: es una función de trigger. Se invoca internamente
-- por el motor de PostgreSQL cuando hay un INSERT/UPDATE en ps_aprobaciones.
-- El permiso EXECUTE no es necesario para que el trigger siga funcionando:
-- el trigger se invoca como el owner de la función (postgres), no el llamante.
-- Revocar previene que un usuario anon/authenticated la llame directamente
-- via /rest/v1/rpc/ y obtenga escritura en ps_logs con privilegios elevados.
--
-- ps_get_areas_omitidas: la Edge Function NO la llama vía RPC. Usa una
-- consulta TypeScript directa contra ps_usuarios con service_role_key.
-- Revocar de anon/authenticated elimina el riesgo de escalamiento de
-- privilegios sin afectar ninguna funcionalidad existente.
-- El service_role (usado por la Edge Function) conserva acceso.

REVOKE EXECUTE ON FUNCTION public.ps_audit_aprobaciones()     FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.ps_get_areas_omitidas(text) FROM anon, authenticated;

-- ─── 4. Vista con security_invoker (elimina Security Definer View) ────────────
--
-- Por defecto, una vista se ejecuta con los permisos de su owner (postgres),
-- lo que puede bypassar RLS. Con security_invoker = on, la vista hereda los
-- permisos del rol que la consulta, respetando las políticas RLS del llamante.
--
-- Impacto en funcionalidad: ninguno.
-- La Edge Function usa SUPABASE_SERVICE_ROLE_KEY que bypasea RLS de por sí.
-- El Dashboard de Supabase (postgres) también bypasea RLS.
-- Para usuarios autenticados que consulten la vista directamente se aplicará
-- el RLS del rol authenticated, lo cual es el comportamiento correcto.

DROP VIEW IF EXISTS public.v_estado_colaboradores;

CREATE VIEW public.v_estado_colaboradores
WITH (security_invoker = on)
AS
SELECT
  c.id,
  c.nombre,
  c.cedula,
  c.activo,
  c.tipo_colaborador,
  c.requiere_paz_salvo,
  COUNT(a.id) FILTER (WHERE a.estado = 'APROBADO')  AS aprobadas,
  COUNT(a.id) FILTER (WHERE a.estado = 'PENDIENTE') AS pendientes,
  COUNT(a.id) FILTER (WHERE a.estado = 'RECHAZADO') AS rechazadas,
  COUNT(a.id)                                        AS total_aprobaciones
FROM ps_colaboradores c
LEFT JOIN ps_aprobaciones a ON a.colaborador_id = c.id
GROUP BY c.id;
