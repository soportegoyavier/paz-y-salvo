-- ═══════════════════════════════════════════════════════════
--  PAZ Y SALVO — Cierra lectura anónima directa + límite en verificar_codigo
--  2026-08-28
-- ═══════════════════════════════════════════════════════════
--
-- ─── 1. Políticas RLS "anon_read_*" — residuo de la arquitectura pre-migración ─
--
-- La migración inicial (20260605000000_paz_y_salvo_schema.sql) creó 3 políticas
-- RLS que permiten al rol `anon` (la anon key, embebida en app.js y por lo tanto
-- pública) leer directamente vía PostgREST, sin pasar por la Edge Function:
--   - anon_read_areas:   TODA la tabla ps_areas
--   - anon_read_colabs:  TODA la tabla ps_colaboradores (nombre, cédula, tipo,
--                        nivel educativo — el roster completo del colegio)
--   - anon_read_codigos: TODA la tabla ps_codigos_verificacion (cada código de
--                        verificación activo, con su colaborador_id — sin
--                        necesidad de adivinar el código)
--
-- Estas políticas datan de cuando el frontend consultaba Supabase directamente
-- con la anon key. Desde la adopción de Supabase Auth + Edge Function como
-- único punto de escritura/lectura (20260606000000_supabase_auth.sql en
-- adelante), app.js ya NO hace ninguna consulta .from('ps_...') directa — el
-- único uso del cliente Supabase en el frontend es supabase.auth.* (login).
-- Verificado: `grep "\.from('ps_" app.js` no arroja resultados.
--
-- Resultado: cualquiera con la anon key (pública, va en el bundle del cliente)
-- puede hoy pedir GET /rest/v1/ps_colaboradores?select=* y obtener el roster
-- completo sin autenticarse, y GET /rest/v1/ps_codigos_verificacion?select=*
-- para leer todos los códigos válidos sin fuerza bruta. Ninguna migración
-- posterior las tocó (verificado con grep en todo supabase/migrations/).
--
-- La Edge Function ya cubre estos mismos casos de uso con service_role
-- (bypassa RLS) — estas políticas no tienen ningún consumidor legítimo hoy.

DROP POLICY IF EXISTS "anon_read_areas"   ON public.ps_areas;
DROP POLICY IF EXISTS "anon_read_colabs"  ON public.ps_colaboradores;
DROP POLICY IF EXISTS "anon_read_codigos" ON public.ps_codigos_verificacion;

-- ─── 2. Límite de tasa en verificar_codigo (acción pública sin autenticar) ────
--
-- accionVerificarCodigo() es pública por diseño (verificar un acta impresa no
-- debe requerir login). El código tiene ~36^5 combinaciones plausibles — sin
-- límite de tasa es fuerza-bruteable con automatización para enumerar
-- nombre+cédula de colaboradores. Mismo patrón que ce_consulta_contador en
-- Control de Eventos: contador por IP en ventanas de 1 minuto.

CREATE TABLE IF NOT EXISTS public.ps_verificacion_contador (
  ip       TEXT        PRIMARY KEY,
  ventana  TIMESTAMPTZ NOT NULL,
  intentos INT         NOT NULL DEFAULT 1
);

ALTER TABLE public.ps_verificacion_contador ENABLE ROW LEVEL SECURITY;
-- Sin políticas: acceso solo vía service_role (Edge Function). Deny-all por diseño,
-- igual que ps_logs/ps_config/ps_sesiones — no hay consumidor anon/authenticated.
