-- ═══════════════════════════════════════════════════════════
--  PAZ Y SALVO — Revoke PUBLIC execute de funciones internas
--  2026-06-10
-- ═══════════════════════════════════════════════════════════
--
-- Al crear una función, PostgreSQL otorga EXECUTE a PUBLIC por defecto.
-- REVOKE FROM anon, authenticated no elimina ese grant raíz.
-- Es necesario revocar de PUBLIC para que anon/authenticated queden
-- efectivamente excluidos y no puedan llamar estas funciones vía
-- /rest/v1/rpc/.
--
-- Conservamos los grants explícitos a postgres y service_role
-- (ya presentes en proacl) para que el trigger y el service_role
-- puedan seguir ejecutándolas internamente si es necesario.
--
-- El trigger audit_aprobaciones sigue funcionando: los triggers
-- son invocados por el motor de PostgreSQL directamente, no
-- requieren EXECUTE del llamante en la función de trigger.

REVOKE EXECUTE ON FUNCTION public.ps_audit_aprobaciones()     FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.ps_get_areas_omitidas(text) FROM PUBLIC;
