---
description: Aplica esta skill como marco general antes de cualquier cambio sustancial en paz-y-salvo — recuerda que es un certificado de retiro de personal embebido vía iframe en Portal-Goyavier, que usa Supabase Auth nativo (no ps_sesiones custom), que el relay OAuth de app.js es específico de este proyecto (Zaiko usa otro mecanismo), que el bloque legacy del router es un shim intencional, que los tests Playwright corren solo contra staging, y que el hosting real es cPanel (no Netlify).
when_to_use: ["voy a cambiar cómo se embebe la app", "voy a tocar el login/OAuth", "encontré código legacy que parece muerto", "voy a correr los tests", "voy a tocar configuración de hosting/dominio", "asumí que esto funciona igual que en Zaiko"]
paths: app.js, supabase/functions/ps-api/index.ts, tests/**, .htaccess
---

## Descripción

Esta skill agrupa los hechos de identidad del proyecto que no encajan en ninguna otra skill más específica: qué es la aplicación, cómo se despliega, cómo se autentica, qué código parece basura pero no lo es, y contra qué entorno corren los tests. Sirve como chequeo de contexto antes de cambios que toquen el "borde" del sistema (embebido, auth, hosting, tests) en vez de su lógica interna.

## Objetivo

Evitar decisiones que asuman un contexto de despliegue/autenticación distinto al real (por ejemplo, asumir Netlify, asumir sesión custom, asumir que Zaiko y paz-y-salvo comparten mecanismo de login, o correr pruebas contra producción).

## Cuándo debe utilizarse

- Antes de cualquier cambio a la lógica de embebido en iframe o al flujo de login/OAuth.
- Antes de "limpiar" código que parezca legacy/muerto en el router de la Edge Function.
- Antes de ejecutar la suite de Playwright (`tests/specs/A` a `J`) o de modificar su configuración de entorno.
- Antes de tocar `.htaccess`, configuración de dominio, o cualquier referencia a Netlify/cPanel.
- Antes de reutilizar patrones del proyecto hermano Zaiko asumiendo que aplican igual aquí.

## Instrucciones detalladas

### 1. Qué es la aplicación

Sistema de gestión de "paz y salvo" del Colegio Campestre Goyavier (Floridablanca, Santander): certifica que un colaborador que se retira no debe nada y devolvió todo lo que tenía a cargo. Se embebe como iframe dentro del proyecto hermano Portal-Goyavier (`https://zaiko-portal.colegiogoyavier.edu.co`). Historia de migración: Google Apps Script → Netlify+Supabase → hosting cPanel actual (hay `.htaccess`; `netlify.toml` ya fue eliminado). No confundir con Zaiko (inventario/préstamos de activos), que es un proyecto hermano con su propio dominio de negocio y su propio mecanismo de login.

### 2. Autenticación: Supabase Auth nativo, sin sesión custom

El sistema migró de un esquema custom (bcrypt + tabla de sesión propia) a Supabase Auth nativo. La migración `20260606000000_supabase_auth.sql` eliminó `ps_sesiones` (tabla legacy) al hacer esta adopción. **No reintroducir** una tabla de sesión custom ni un mecanismo de hashing de contraseña propio — cualquier necesidad de "gestionar sesiones" (TTL, expiración, invalidación) debe resolverse con las capacidades nativas de Supabase Auth (`ps_config.SESSION_TTL_MINUTES` ya existe como parámetro de configuración para esto).

Login por email+password: `handleLogin()` (`app.js:468`). Login por Google OAuth: `handleLoginGoogle()` (`app.js:659`).

### 3. El relay OAuth es específico de este proyecto — no asumir que Zaiko lo necesita igual

Cuando la app está embebida en iframe dentro de Portal-Goyavier, el flujo OAuth de Supabase se rompe porque los navegadores modernos particionan el `localStorage` de terceros dentro de un iframe. La solución implementada en `app.js` (líneas ~127-160 para el manejo del callback con `#access_token`, y ~643-712 para `handleLoginGoogle`) es: si `window !== window.top` (`enIframe`, `app.js:681`), navegar `window.top` completo a `https://zaiko-portal.colegiogoyavier.edu.co/` con ese como `redirectTo` del OAuth (`app.js:684`), de forma que Supabase redirija al portal (no al iframe) con el token en el hash, y el portal luego se lo reinyecte al iframe. Si NO está en iframe, se usa un popup clásico (`window.open`) que guarda la sesión y se cierra solo (`_resetGoogleBtn`, `_oauthPopupTimer` en `app.js`).

Zaiko, el proyecto hermano, usa un mecanismo distinto para su propio problema de embebido (Google Identity Services por popup) que no requiere este relay de `window.top`. **No asumir que ambos proyectos comparten la misma solución** ni "simplificar" copiando el patrón de uno al otro sin verificar el mecanismo real de cada uno primero.

### 4. Código legacy del router: shim intencional, no basura

El router de la Edge Function (`supabase/functions/ps-api/index.ts:1471-1484`) tiene un bloque:
```ts
case 'login': case 'migracion_areas': ...
```
que devuelve mensajes de "ya no aplica" para acciones viejas de la era Google Apps Script. Es un shim de compatibilidad deliberado — probablemente para que clientes viejos (cache de navegador, bookmarks, integraciones externas no actualizadas) que todavía invoquen esas acciones reciban un mensaje explicativo en vez de un error genérico de "acción no reconocida". No eliminar este bloque asumiendo que es código muerto sin antes confirmar con el usuario que ya no hay ningún cliente que pueda invocar esas acciones viejas.

### 5. Tests: solo contra staging, nunca producción

`tests/` es su propio proyecto Node/TS con Playwright, 10 suites (`tests/specs/A_flujo_basico.spec.ts` a `tests/specs/J_rendimiento.spec.ts`): flujo básico, aprobación, auto-exclusión, multi-área, vista administrativa, generación de PDF/acta, recordatorios por correo, seguridad RLS, concurrencia, rendimiento. Corren en CI vía `.github/workflows/qa.yml` contra un proyecto Supabase de **staging dedicado**. `tests/.env.test.example` indica explícitamente "nunca usar producción" y nombra el proyecto de producción real a evitar: `ihzgfcojethwxphbnlmg`. `tests/staging-server.js` hace un reemplazo de texto (regex) de las constantes `SUPABASE_URL`/`SUPABASE_ANON_KEY`/`BACKEND_URL` (que en `app.js` están hardcodeadas como literales en las líneas 2, 9-10) al servir la app para QA — no hay `.env`/build real en el frontend, así que este reemplazo de texto ES el mecanismo de entorno de test.

Antes de correr o modificar cualquier test: confirmar que el `SUPABASE_URL` efectivo en la configuración de test apunta al proyecto de staging, no al `ihzgfcojethwxphbnlmg` de producción. Antes de usar cualquier tool de Supabase MCP (`execute_sql`, `apply_migration`, etc.) en el contexto de testing, confirmar contra qué proyecto se está apuntando.

### 6. Hosting: cPanel, no Netlify

El hosting real ya migró a cPanel (`.htaccess` presente, `netlify.toml` eliminado). Ver `regression-guardian` sobre `ALLOWED_ORIGINS` en la Edge Function, que todavía lista dominios Netlify — es una señal de que la migración de hosting no se reflejó completamente en la configuración de CORS. No asumir que `netlify.toml` o convenciones de Netlify (redirects, headers vía `_headers`) siguen aplicando; la fuente de verdad de reglas de servidor hoy es `.htaccess`.

## Reglas obligatorias

- No reintroducir `ps_sesiones` ni un mecanismo de sesión/hashing de contraseña custom.
- No asumir que Zaiko y paz-y-salvo comparten mecanismo de login/embebido sin verificarlo en el código de cada uno.
- No eliminar el bloque legacy del router (`index.ts:1471-1484`) sin confirmación explícita del usuario.
- No ejecutar migraciones, seeds, ni pruebas Playwright contra el proyecto de producción `ihzgfcojethwxphbnlmg` — solo contra staging.
- No asumir configuración/convenciones de Netlify vigentes; el hosting real es cPanel vía `.htaccess`.

## Criterios de validación

- Cualquier cambio a `handleLoginGoogle()`/relay de iframe explica por qué se preserva (o cambia) el chequeo `window !== window.top` y el `redirectTo` a `zaiko-portal.colegiogoyavier.edu.co`.
- El bloque `case 'login': case 'migracion_areas': ...` sigue presente salvo remoción explícitamente aprobada por el usuario.
- Antes de correr tests, se verificó que `tests/.env.test` (no el `.example`) apunta a un proyecto de staging distinto de `ihzgfcojethwxphbnlmg`.
- Ninguna migración/consulta SQL se ejecutó contra `ihzgfcojethwxphbnlmg` como parte de una tarea de testing.

## Checklist final

- [ ] ¿El cambio toca login/OAuth/iframe? Se preservó el mecanismo de relay específico de este proyecto (no se copió de Zaiko sin verificar).
- [ ] ¿El cambio toca `ps_sesiones` o autenticación? No se reintrodujo sesión custom.
- [ ] ¿El cambio toca el router de la Edge Function? El shim legacy sigue presente o su remoción fue aprobada explícitamente.
- [ ] ¿Se corrieron tests? Fue contra staging, nunca contra `ihzgfcojethwxphbnlmg`.
- [ ] ¿El cambio toca hosting/CORS/dominio? Se verificó contra la realidad de cPanel, no contra supuestos de Netlify.
