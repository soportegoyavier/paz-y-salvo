---
description: Aplica esta skill antes de finalizar cualquier cambio en paz-y-salvo que toque autenticación, autorización, acciones destructivas de SUPERADMIN, o innerHTML con datos dinámicos — exige disciplina de esc() contra XSS, RLS estricta por area_ids/cedula del JWT, custom_access_token_hook como única fuente de verdad de rol/área, verificarPassword() como patrón obligatorio de reautenticación para acciones destructivas, y mantener PUBLIC_ACTIONS mínimo.
when_to_use: ["voy a agregar una acción nueva al router de la Edge Function", "esta acción es destructiva/irreversible", "necesito saltarme la autenticación para esto", "voy a confiar en el rol que viene del cliente", "agregar una acción pública sin login"]
paths: supabase/functions/ps-api/index.ts, supabase/migrations/**/*.sql, app.js
---

## Descripción

La seguridad de este sistema descansa en 4 pilares concretos y verificables en el código: disciplina manual de escape XSS (`esc()`), RLS de Postgres basada en claims de JWT, un hook custom que es la única fuente de esos claims, y reautenticación con contraseña para acciones destructivas de `SUPERADMIN`. Cada uno de estos pilares tuvo (o podría tener) una falla real ya detectada — no son precauciones hipotéticas.

## Objetivo

Que ningún cambio nuevo debilite alguno de los 4 pilares: que no se reintroduzca XSS, que ninguna autorización nueva confíe en datos del cliente en vez del JWT, que ninguna acción destructiva nueva se salte la reautenticación por contraseña, y que la superficie de acciones sin login (`PUBLIC_ACTIONS`) no crezca sin justificación explícita.

## Cuándo debe utilizarse

- Antes de agregar cualquier `case` nuevo al router de acciones en `supabase/functions/ps-api/index.ts`.
- Antes de agregar una acción a `PUBLIC_ACTIONS`.
- Antes de escribir cualquier lógica que decida permisos comparando `rol`/`area_id` recibido en el body de la request, en vez de leerlo de la sesión/JWT verificado server-side.
- Antes de agregar una acción irreversible o de alto impacto (reseteo masivo, forzar estado, eliminar usuarios).
- Antes de tocar `innerHTML` en `app.js` (ver también `ui-guardian`/`regression-guardian` para el detalle operativo).

## Instrucciones detalladas

### 1. Disciplina XSS: `esc()` sin excepciones

`app.js:4-6` define `esc()`. El commit `8f6d46d` lo agregó retroactivamente a ~30+ sitios tras una vulnerabilidad XSS real. Con ~90 sitios `.innerHTML =` actuales, cualquier interpolación de datos de servidor/usuario sin `esc()` reintroduce esa misma clase de bug. Ver `ui-guardian` para el detalle de implementación; desde la óptica de seguridad, tratar un `innerHTML` sin `esc()` como un hallazgo bloqueante, no cosmético.

### 2. RLS por `area_ids`/`cedula`, nunca por dato del cliente

`custom_access_token_hook` (`supabase/migrations/20260606000000_supabase_auth.sql`) inyecta `rol`, `area_ids`, `cedula`, `username`, `usuario_id` en el JWT de Supabase Auth. Las políticas RLS (`ps_aprobaciones_admin_area`, `ps_aprobaciones_colab_read`, `ps_usuarios_sa_all`) leen esos claims desde `auth.jwt()`, nunca desde una columna que el propio request module. El Edge Function `ps-api` sigue el mismo principio: la sesión (`SessionData`) se resuelve del JWT verificado server-side, no de un campo `rol`/`area_id` que venga en el `body` del POST. Cualquier lógica nueva que compare permisos debe leer del objeto de sesión ya resuelto (`ses` en `index.ts`), nunca de `body.rol`, `body.areaId`, etc., como fuente de verdad de autorización — esos campos del body solo indican qué recurso se quiere afectar, no qué permiso tiene quien lo pide.

### 3. `_resolverAreaId()`: redirect silencioso, no error

`_resolverAreaId()` (`index.ts:358`) es el punto donde se resuelve a qué área aplica una acción de un `ADMIN`. Si un `ADMIN` intenta apuntar a un área que no es la suya, la función lo redirige EN SILENCIO a su propia área — no lanza un error. Esto está probado explícitamente en el test `H4` de `tests/specs/H_seguridad_rls.spec.ts`. Si una tarea toca esta función o su comportamiento, preservar el redirect silencioso salvo que el usuario pida explícitamente cambiarlo a un error — y si se cambia, actualizar el test `H4` en la misma tarea (ver `paz-y-salvo-guardian` sobre la suite de tests).

### 4. Reautenticación por contraseña para acciones destructivas

`verificarPassword()` (`index.ts:731`) es el patrón ya establecido para exigir que un `SUPERADMIN` reingrese su contraseña actual antes de ejecutar una acción destructiva. Se usa hoy en `forzar_paz_salvo` y `resetear_aprobaciones` (ambas verifican `await verificarPassword(ses.email, String(body.password))` antes de proceder, `index.ts:738`, `:757`). Cualquier acción nueva que sea irreversible o de alto impacto (borrar datos permanentemente, resetear en masa, revocar credenciales de otros usuarios) debe seguir el mismo patrón: pedir la contraseña actual en el body y verificarla server-side con `verificarPassword()` antes de ejecutar. No aceptar un flag `confirmar: true` del cliente como sustituto de esta verificación.

### 5. `PUBLIC_ACTIONS` debe permanecer mínimo

```ts
const PUBLIC_ACTIONS = new Set(['verificar_codigo', 'diagnosticar_login'])
```
(`index.ts:1280`, aplicado en `index.ts:1301`). Estas son las únicas dos acciones del router que no requieren sesión autenticada — `verificar_codigo` porque es la funcionalidad pública de verificar un certificado (terceros externos sin cuenta deben poder validarlo), `diagnosticar_login` como herramienta de soporte para problemas de acceso. Cualquier acción nueva que se proponga agregar a este set necesita justificación explícita y equivalente en naturaleza (algo que legítimamente debe ser accesible sin login) — por defecto, toda acción nueva del router requiere sesión.

### 6. CORS es una capa débil — no la única defensa

`ALLOWED_ORIGINS` (`index.ts:20-25`) y `getCorsHeaders()` (`index.ts:27-35`) controlan qué origin recibe la cabecera `Access-Control-Allow-Origin`, pero CORS es una defensa de navegador, no de servidor: no reemplaza la verificación de sesión/JWT en cada acción. No razonar "esta acción está protegida porque CORS bloquea otros orígenes" — un cliente HTTP directo (curl, Postman, un script) ignora CORS por completo. La única protección real es la verificación de sesión dentro de cada `accionX` y las políticas RLS subyacentes.

### 7. Topes anti-abuso en operaciones masivas

`carga_masiva_colaboradores` limita las filas procesadas a 200 (`index.ts:450`). Este tope no es solo una guarda de rendimiento: limita el radio de explosión de una carga maliciosa o accidentalmente corrupta (por ejemplo, un Excel manipulado que intente crear cientos de colaboradores/usuarios de golpe). Cualquier cambio que aumente o elimine este tope debe considerar explícitamente el impacto en superficie de abuso, no solo en tiempo de ejecución.

## Reglas obligatorias

- Ningún `innerHTML` nuevo con datos dinámicos se cierra sin `esc()`.
- Ninguna decisión de autorización nueva lee `rol`/`area_id`/`cedula` del `body` del request en vez de la sesión resuelta desde el JWT.
- `_resolverAreaId()` conserva su redirect silencioso salvo pedido explícito del usuario, y cualquier cambio ahí actualiza `tests/specs/H_seguridad_rls.spec.ts` (test `H4`).
- Toda acción destructiva/irreversible nueva reutiliza `verificarPassword()` antes de ejecutar, tal como `forzar_paz_salvo` y `resetear_aprobaciones`.
- `PUBLIC_ACTIONS` no crece sin justificación explícita documentada en el mensaje de la tarea o en un comentario junto a la constante.
- Ninguna decisión de seguridad se basa únicamente en `ALLOWED_ORIGINS`/CORS; toda acción sensible verifica sesión/JWT en el servidor independientemente del origin.
- El tope de 200 filas en `carga_masiva_colaboradores` no se aumenta/elimina sin considerar explícitamente el impacto en superficie de abuso.

## Criterios de validación

- `grep -n "innerHTML" app.js` sobre el diff — toda interpolación dinámica pasa por `esc()`.
- `grep -n "body\.\(rol\|areaId\|area_id\)" supabase/functions/ps-api/index.ts` no aparece como base de una decisión de permisos (solo como referencia de "a qué recurso apunta la acción").
- Toda acción nueva marcada como destructiva en el router llama a `verificarPassword(ses.email, String(body.password))` antes de mutar datos.
- `PUBLIC_ACTIONS.size` no aumentó sin que la tarea documente por qué la acción nueva debe ser pública.
- Si se tocó `_resolverAreaId()`, el test `H4` en `tests/specs/H_seguridad_rls.spec.ts` sigue pasando (o fue actualizado a propósito).

## Checklist final

- [ ] ¿Hay `innerHTML` nuevo? Usa `esc()` en todo dato dinámico.
- [ ] ¿Hay una decisión de permisos nueva? Se basa en la sesión resuelta del JWT, no en el body.
- [ ] ¿Se agregó una acción destructiva? Reutiliza `verificarPassword()`.
- [ ] ¿Se tocó `PUBLIC_ACTIONS`? Está justificado explícitamente.
- [ ] ¿Se tocó `_resolverAreaId()`? Se preservó (o se actualizó a propósito) el redirect silencioso y el test `H4`.
