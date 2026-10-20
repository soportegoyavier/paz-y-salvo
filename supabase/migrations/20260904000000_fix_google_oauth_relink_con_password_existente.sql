-- ═══════════════════════════════════════════════════════════
--  FIX — Google OAuth no vinculaba cuando el usuario YA tenía
--  auth_user_id de email+contraseña
--
--  20260626000000_google_oauth_autolink.sql agregó la búsqueda por
--  correo como respaldo, pero con "AND auth_user_id IS NULL" — eso
--  solo cubre cuentas que nunca tuvieron ninguna cuenta de Auth.
--  Casi todo el personal se migró en mayo con email+contraseña
--  (auth_user_id ya poblado), así que cuando alguien de ese grupo
--  probaba "Entrar con Google" por primera vez, Google creaba una
--  identidad nueva, no encontraba match en ningún paso, y el JWT
--  quedaba sin rol/claims ("Esta cuenta de Google no tiene acceso
--  al sistema. Contacta al administrador.", app.js:266).
--
--  Caso real: SANDOVAL LARROTTA SANDRA MILENA (63536066), Coord.
--  Académica Primaria. auth_user_id original (email+contraseña,
--  mayo): d8a19011-479e-4cb6-b4ef-70a2cd88f31e. Identidad de Google
--  (nunca vinculada): 0c98ca7e-a92b-4843-98f4-7a6a7d424549.
--
--  Fix: se quita la condición "auth_user_id IS NULL". Si hay match
--  por correo institucional, se revincula auth_user_id al identity
--  con el que se está entrando ahora mismo — la persona ya probó
--  ser dueña del correo (por Google OAuth o por conocer la
--  contraseña), así que revincular es seguro en este sistema
--  (staff interno, cuentas creadas solo por SUPERADMIN, sin
--  auto-registro público).
--
--  Efecto secundario esperado y aceptado: si alguien vuelve a
--  intentar el método viejo (contraseña) después de haber entrado
--  con Google, quedará desvinculado y tendrá que volver a entrar
--  con Google, o pedir un reset de contraseña (que sí revincula,
--  ver accionResetearPassword). Es el comportamiento correcto:
--  "el último método con el que probaste ser tú" es el vigente.
--  2026-09-04
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

  -- 1. Camino normal: ya vinculado a este auth_user_id
  SELECT id, rol, area_ids, cedula, username, activo, cambiar_password
  INTO user_row
  FROM ps_usuarios
  WHERE auth_user_id = v_auth_id;

  -- 2. Si no, buscar por correo institucional y revincular
  --    (cubre: primer login por Google de alguien migrado con
  --    email+contraseña, o el caso inverso)
  IF NOT FOUND AND v_email <> '' THEN
    SELECT id, rol, area_ids, cedula, username, activo, cambiar_password
    INTO user_row
    FROM ps_usuarios
    WHERE lower(trim(email)) = v_email
      AND activo = true
    LIMIT 1;

    IF FOUND THEN
      UPDATE ps_usuarios SET auth_user_id = v_auth_id WHERE id = user_row.id;
    END IF;
  END IF;

  -- Sin registro o cuenta inactiva → devolver token sin claims extra
  -- (el Edge Function rechaza el acceso al verificar el rol)
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

-- Reafirmar permisos — CREATE OR REPLACE puede resetearlos, y ya
-- hubo un incidente real por esto (20260727000001_fix_hook_search_path.sql).
GRANT USAGE   ON SCHEMA public                                   TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) FROM authenticated;
