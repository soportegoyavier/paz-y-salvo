-- ═══════════════════════════════════════════════════════════
--  FIX SEGURIDAD — custom_access_token_hook expuesto a anon/authenticated
--  El advisor de Supabase detectó que cualquiera (sin sesión) puede
--  llamar POST /rest/v1/rpc/custom_access_token_hook con un user_id
--  arbitrario en el body y recibir de vuelta rol, area_ids, cedula,
--  username e id interno de ESA persona. Ninguna migración anterior
--  revocó el EXECUTE de anon/authenticated (Supabase lo otorga por
--  defecto a PUBLIC al crear/reemplazar la función).
--  Este hook solo debe ser invocado por supabase_auth_admin (el
--  servicio interno de Auth durante el login) — nunca por un cliente.
--  2026-07-28
-- ═══════════════════════════════════════════════════════════

REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) FROM authenticated;

-- Se conserva el único acceso legítimo: el servicio de Auth.
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) TO supabase_auth_admin;
