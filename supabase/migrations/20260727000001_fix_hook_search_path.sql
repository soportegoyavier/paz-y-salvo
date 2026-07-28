-- ═══════════════════════════════════════════════════════════
--  HOTFIX — custom_access_token_hook perdió SET search_path
--  La migración 20260626000000_google_oauth_autolink.sql reemplazó
--  la función sin el SET search_path = public agregado en
--  20260610000000_security_hardening.sql. SECURITY DEFINER sin
--  search_path fijo hace que `ps_usuarios` no resuelva bajo el rol
--  supabase_auth_admin → 500 "Error running hook" en cada login.
--  2026-07-27
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  claims    jsonb;
  user_row  RECORD;
  v_auth_id uuid;
  v_email   text;
BEGIN
  v_auth_id := (event->>'user_id')::uuid;
  v_email   := lower(trim(coalesce(event->'claims'->>'email', '')));

  SELECT id, rol, area_ids, cedula, username, activo, cambiar_password
  INTO user_row
  FROM ps_usuarios
  WHERE auth_user_id = v_auth_id;

  IF NOT FOUND AND v_email <> '' THEN
    SELECT id, rol, area_ids, cedula, username, activo, cambiar_password
    INTO user_row
    FROM ps_usuarios
    WHERE lower(trim(email)) = v_email
      AND activo = true
      AND auth_user_id IS NULL
    LIMIT 1;

    IF FOUND THEN
      UPDATE ps_usuarios SET auth_user_id = v_auth_id WHERE id = user_row.id;
    END IF;
  END IF;

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

GRANT USAGE   ON SCHEMA public                            TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook TO supabase_auth_admin;
