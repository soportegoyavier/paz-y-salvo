-- ═══════════════════════════════════════════════════════
--  Google OAuth auto-link en custom_access_token_hook
--
--  Problema anterior: el hook solo buscaba por auth_user_id.
--  Si el usuario entraba por Google OAuth por primera vez,
--  auth_user_id era NULL en ps_usuarios → el hook no encontraba
--  nada → JWT sin claims → la app rechazaba la sesión.
--
--  Solución: si no hay coincidencia por auth_user_id, buscar por
--  email. Si se encuentra, vincular auth_user_id automáticamente
--  (solo si la fila aún no tiene vínculo, para no sobreescribir).
-- ═══════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE
  claims    jsonb;
  user_row  RECORD;
  v_auth_id uuid;
  v_email   text;
BEGIN
  v_auth_id := (event->>'user_id')::uuid;
  v_email   := lower(trim(coalesce(event->'claims'->>'email', '')));

  -- 1. Buscar por auth_user_id (camino normal — ya vinculado)
  SELECT id, rol, area_ids, cedula, username, activo, cambiar_password
  INTO user_row
  FROM ps_usuarios
  WHERE auth_user_id = v_auth_id;

  -- 2. Si no encontrado, buscar por email (primer login con Google OAuth)
  IF NOT FOUND AND v_email <> '' THEN
    SELECT id, rol, area_ids, cedula, username, activo, cambiar_password
    INTO user_row
    FROM ps_usuarios
    WHERE lower(trim(email)) = v_email
      AND activo = true
      AND auth_user_id IS NULL   -- solo si no está ya vinculado a otra cuenta Auth
    LIMIT 1;

    -- Vincular para que los próximos logins usen el camino rápido (1)
    IF FOUND THEN
      UPDATE ps_usuarios SET auth_user_id = v_auth_id WHERE id = user_row.id;
    END IF;
  END IF;

  -- Sin registro o cuenta inactiva → devolver token sin claims extra
  -- (el Edge Function rechazará el acceso al verificar el rol)
  IF NOT FOUND OR NOT user_row.activo THEN
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

-- Reotorgar permisos (el REPLACE puede revocarlos en algunas versiones)
GRANT USAGE  ON SCHEMA public TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook TO supabase_auth_admin;
