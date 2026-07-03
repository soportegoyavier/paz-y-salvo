---
description: Aplica esta skill antes de crear o modificar migraciones SQL en supabase/migrations/, políticas RLS, o funciones SECURITY DEFINER del proyecto paz-y-salvo — cubre las tablas ps_*, las políticas de RLS basadas en area_ids/cedula del JWT, el hook custom_access_token_hook como única fuente de claims, y el requisito de SET search_path = public en toda función SECURITY DEFINER (hallazgos reales del Security Advisor ya corregidos en 20260610000000_security_hardening.sql y 20260610000001_security_revoke_public.sql).
when_to_use: ["crear una migración nueva", "agregar una política RLS", "necesito una función SECURITY DEFINER", "dar permisos a una función", "modificar ps_usuarios/ps_aprobaciones/ps_areas", "el Security Advisor reportó algo"]
paths: supabase/migrations/**/*.sql, supabase/functions/**/*.ts, supabase/config.toml
---

## Descripción

El esquema completo vive en `supabase/migrations/`, con 8 migraciones aplicadas en orden: `20260605000000_paz_y_salvo_schema.sql` (esquema base), `20260606000000_supabase_auth.sql` (adopción de Supabase Auth nativo + `custom_access_token_hook` + políticas RLS basadas en JWT), `20260606000001_indexes_views_triggers.sql`, `20260610000000_security_hardening.sql` y `20260610000001_security_revoke_public.sql` (correcciones reales del Security Advisor de Supabase), `20260610000002_fix_tipo_colaborador_coordinadores.sql`, `20260612000001_codigos_verificacion_motivo.sql`, `20260612000002_renombrar_areas.sql`. Todo el acceso a datos desde el frontend pasa por RLS + la Edge Function `ps-api`; no hay un backend intermedio adicional.

## Objetivo

Que cualquier migración o política nueva preserve el modelo de autorización ya establecido (JWT con claims custom, RLS por `area_ids`/`cedula`) y no reintroduzca los hallazgos de seguridad que el Security Advisor ya encontró y que las migraciones de hardening corrigieron.

## Cuándo debe utilizarse

- Antes de escribir cualquier archivo nuevo en `supabase/migrations/`.
- Antes de agregar o modificar una `CREATE POLICY` sobre cualquier tabla `ps_*`.
- Antes de crear una función `SECURITY DEFINER` nueva.
- Antes de otorgar `GRANT` sobre cualquier función o tabla a `PUBLIC`, `anon` o `authenticated`.
- Antes de tocar `custom_access_token_hook` o cualquier lógica que dependa de sus claims.

## Instrucciones detalladas

### 1. Tablas del esquema (todas prefijo `ps_`)

- `ps_areas`: departamentos/estaciones de aprobación. `tipo` ∈ `GENERAL`/`DEPARTAMENTAL`. `aplica_a`/`aplica_nivel` determinan qué colaboradores necesitan esa área (ver `business-logic-guardian` para `getAreasRequeridas`).
- `ps_colaboradores`: persona que necesita el paz y salvo. `cedula` única, `tipo_colaborador` ∈ `DOCENTE`/`ADMINISTRATIVO`/`SERVICIOS`, `nivel_educativo` ∈ `PREESCOLAR`/`PRIMARIA`/`SECUNDARIA`/`BACHILLERATO`, `requiere_paz_salvo`, `areas_requeridas` (FK al área/jefe propio del colaborador).
- `ps_usuarios`: cuentas de login. `rol` ∈ `SUPERADMIN`/`ADMIN`/`COLABORADOR`; `area_ids UUID[]` (un `ADMIN` puede tener varias áreas); ligado a Supabase Auth vía `auth_user_id`.
- `ps_aprobaciones`: tabla central del flujo — par único `(colaborador_id, area_id)`, `estado` ∈ `PENDIENTE`/`APROBADO`/`RECHAZADO`, más `observaciones`, `aprobado_por`, `fecha_accion`.
- `ps_codigos_verificacion`: un único código activo por colaborador (`activo`, `motivo_inactivacion` ∈ `REVOCADO`/`REEMPLAZADO`).
- `ps_config`: clave/valor (`PROCESO_ACTIVO`, `INSTITUCION_NOMBRE`, `EMAIL_TALENTO_HUMANO`, `SESSION_TTL_MINUTES`).
- `ps_logs`: auditoría append-only.
- `ps_sesiones`: **eliminada** en `20260606000000_supabase_auth.sql` al adoptar Supabase Auth nativo. No reintroducir una tabla de sesión custom — si aparece una necesidad de "gestionar sesiones", la respuesta correcta es usar las capacidades nativas de Supabase Auth, no resucitar `ps_sesiones`.
- Vista `v_estado_colaboradores` con `security_invoker = on` — cualquier vista nueva sobre datos sensibles debe declarar explícitamente `security_invoker = on` salvo que haya una razón documentada para lo contrario.

### 2. RLS y el hook de claims

`custom_access_token_hook` (definido en `20260606000000_supabase_auth.sql`) inyecta `rol`, `area_ids`, `cedula`, `username`, `usuario_id` en cada access token de Supabase Auth. Es la **única** fuente de datos de autorización en la que confía el sistema — ni el Edge Function ni ninguna política nueva deben confiar en un rol/área que venga del body de la request o de un header custom. Políticas clave ya existentes:
- `ps_aprobaciones_admin_area`: restringe a un `ADMIN` a filas donde `area_id = ANY(auth.jwt()->'area_ids')`.
- `ps_aprobaciones_colab_read`: un `COLABORADOR` solo lee filas de su propia `cedula` (comparando contra `auth.jwt()->'cedula'`).
- `ps_usuarios_sa_all`: CRUD completo restringido a `SUPERADMIN`.

Toda política RLS nueva sobre una tabla `ps_*` debe seguir este mismo patrón: leer el claim relevante de `auth.jwt()`, nunca de una columna que el cliente pueda escribir libremente. Si una tabla nueva necesita distinguir por área, usar `area_id = ANY(auth.jwt()->'area_ids')` como en `ps_aprobaciones_admin_area`; si necesita distinguir por identidad del colaborador, usar `auth.jwt()->'cedula'` como en `ps_aprobaciones_colab_read`.

### 3. `SECURITY DEFINER` + `search_path`

Las migraciones `20260610000000_security_hardening.sql` y `20260610000001_security_revoke_public.sql` corrigieron hallazgos reales del Security Advisor de Supabase:
- Falta de `SET search_path = public` en funciones `SECURITY DEFINER` (riesgo: un atacante con permisos de crear esquemas podría interponer objetos falsos en el search_path y lograr ejecución con privilegios elevados).
- Grants `PUBLIC`/`anon`/`authenticated` sobre funciones internas que no debían ser invocables públicamente (`ps_get_areas_omitidas`, `ps_audit_aprobaciones`).
- Una vista `SECURITY DEFINER` que debía ser `security_invoker`.

Toda función `SECURITY DEFINER` nueva debe declarar explícitamente:
```sql
CREATE OR REPLACE FUNCTION public.mi_funcion(...)
RETURNS ... LANGUAGE plpgsql/sql ... SECURITY DEFINER
SET search_path = public
AS $$ ... $$;
```
y no debe recibir `GRANT EXECUTE ... TO PUBLIC` (ni implícitamente vía el default de Postgres) salvo que sea una función deliberadamente pública — en ese caso, documentar por qué en un comentario SQL junto al `GRANT`, igual que se justificaría una nueva entrada en `PUBLIC_ACTIONS` del Edge Function (ver `security-guardian`).

### 4. Antes de escribir una migración

1. Ejecutar (o pedir) `mcp__supabase__list_tables` / `list_migrations` para confirmar el estado real antes de asumir el esquema desde memoria.
2. Si la migración toca autorización o funciones `SECURITY DEFINER`, correr `mcp__supabase__get_advisors` después de aplicarla (en un branch/staging, nunca contra producción) para confirmar que no reintroduce un hallazgo ya corregido.
3. Nombrar el archivo con el mismo patrón de timestamp `YYYYMMDDHHMMSS_descripcion.sql` usado por las 8 migraciones existentes.

## Reglas obligatorias

- No reintroducir `ps_sesiones` ni ningún esquema de sesión custom — Supabase Auth nativo es la única fuente de sesión.
- Toda política RLS nueva lee `auth.jwt()->'area_ids'` / `auth.jwt()->'cedula'` / `auth.jwt()->'rol'`, nunca un valor enviado por el cliente en el body.
- Toda función `SECURITY DEFINER` nueva incluye `SET search_path = public`.
- Ninguna función interna nueva recibe `GRANT` a `PUBLIC`/`anon`/`authenticated` sin justificación explícita documentada.
- No modificar `custom_access_token_hook` sin considerar el impacto en TODAS las políticas RLS que leen sus claims (`ps_aprobaciones_admin_area`, `ps_aprobaciones_colab_read`, `ps_usuarios_sa_all`, y cualquier otra).

## Criterios de validación

- `grep -n "SECURITY DEFINER" <nueva_migración>.sql` — cada ocurrencia tiene un `SET search_path = public` a pocas líneas de distancia.
- `grep -n "GRANT" <nueva_migración>.sql` no otorga a `PUBLIC`/`anon`/`authenticated` sobre funciones que manipulan `ps_aprobaciones`, `ps_usuarios` o `ps_codigos_verificacion` sin justificación en comentario.
- Toda `CREATE POLICY` nueva referencia `auth.jwt()->...`, no una columna arbitraria de la tabla que el cliente controle directamente.
- `mcp__supabase__get_advisors` (ejecutado contra staging, no producción) no reporta hallazgos nuevos tras aplicar la migración.

## Checklist final

- [ ] ¿La migración crea una tabla `ps_*` nueva? Si sí, tiene RLS habilitada y políticas basadas en claims del JWT.
- [ ] ¿La migración crea una función `SECURITY DEFINER`? Si sí, tiene `SET search_path = public`.
- [ ] ¿La migración otorga `GRANT` a `PUBLIC`/`anon`/`authenticated`? Si sí, está justificado explícitamente.
- [ ] ¿La migración toca `ps_sesiones` o reintroduce sesión custom? Si sí, se detuvo — eso ya se decidió eliminar.
- [ ] Se corrió `get_advisors` contra staging (nunca producción) tras el cambio.
