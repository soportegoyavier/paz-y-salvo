# paz-y-salvo — Colegio Campestre Goyavier

Sistema de gestión del certificado de "paz y salvo" para personal que se retira del Colegio Campestre Goyavier (Floridablanca, Santander). Se embebe como iframe dentro del proyecto hermano Portal-Goyavier (`https://zaiko-portal.colegiogoyavier.edu.co`).

**Stack real** (sin framework, sin build):
- Frontend: `index.html` (770 líneas) + `styles.css` (918 líneas) + `app.js` (3373 líneas / 358KB, monolítico), servidos tal cual desde hosting cPanel (`.htaccess`). Librerías vía CDN: `@supabase/supabase-js@2`, `xlsx@0.18.5`, `html2pdf.js@0.10.1`.
- Backend: Edge Function Deno `supabase/functions/ps-api/index.ts` (1494 líneas), con `pdf-lib` (PDF server-side) y `nodemailer` (SMTP).
- Datos: Supabase Postgres, tablas `ps_*` con RLS, migraciones en `supabase/migrations/`.
- Auth: Supabase Auth nativo (email+password y Google OAuth), con claims custom vía `custom_access_token_hook`.
- Tests: `tests/` es su propio proyecto Node/TS con Playwright (suites `A` a `J`), corre en CI contra un Supabase de **staging dedicado**, nunca contra producción.

## Skills obligatorias

Antes de finalizar cualquier cambio relevante (código, migraciones, configuración), Claude debe aplicar automáticamente las skills en `.claude/skills/` que apliquen a la tarea. Su contenido especializado prevalece sobre cualquier suposición genérica de este archivo — este documento solo referencia las skills, no duplica su contenido.

1. **`architecture-guardian`** (`.claude/skills/architecture-guardian/`) — protege el monolito sin framework/build; evita triplicar `toggle*Select` o divergir en `pazYSalvoCompleto`.
2. **`regression-guardian`** (`.claude/skills/regression-guardian/`) — previene la reaparición de bugs ya vistos: XSS por `innerHTML` sin `esc()`, deriva PDF servidor/cliente, fallback de áreas desincronizado, `ALLOWED_ORIGINS` obsoleto.
3. **`supabase-guardian`** (`.claude/skills/supabase-guardian/`) — reglas de migraciones, RLS por `area_ids`/`cedula`, funciones `SECURITY DEFINER` con `search_path` obligatorio.
4. **`ui-guardian`** (`.claude/skills/ui-guardian/`) — disciplina de `esc()`, reuso de `abrirModal`/`cerrarModal`, no duplicar selección masiva.
5. **`security-guardian`** (`.claude/skills/security-guardian/`) — XSS, autorización basada en JWT (no en el cliente), reautenticación por contraseña en acciones destructivas, `PUBLIC_ACTIONS` mínimo.
6. **`business-logic-guardian`** (`.claude/skills/business-logic-guardian/`) — dominio real: `getAreasRequeridas()`, `pazYSalvoCompleto` (5 copias), ciclo de vida del código de verificación, certificado dual, correos, operaciones masivas.
7. **`paz-y-salvo-guardian`** (`.claude/skills/paz-y-salvo-guardian/`) — identidad del proyecto: embebido en iframe, Auth nativo (no `ps_sesiones`), relay OAuth específico de este proyecto, shim legacy del router, tests solo contra staging, hosting cPanel.

Si una tarea toca código cubierto por varias skills, aplicar todas las que correspondan antes de dar el cambio por terminado.
