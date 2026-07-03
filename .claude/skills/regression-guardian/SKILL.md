---
description: Aplica esta skill antes de finalizar cualquier cambio en paz-y-salvo que toque innerHTML en app.js, la generación de certificado/acta (pdf-lib en index.ts o html2pdf.js en app.js), la lista hardcodeada de nombres de área en el fallback de getAreasRequeridas, o ALLOWED_ORIGINS en index.ts — son las 4 clases de regresión que YA ocurrieron una vez en este proyecto (XSS real, deriva de nombres de área tras un rename, allowlist de CORS desactualizada).
when_to_use: ["voy a agregar innerHTML con datos del servidor", "cambié el texto del certificado", "renombré un área", "necesito agregar un dominio a CORS", "el PDF del cliente se ve distinto al del servidor", "el fallback de áreas devolvió algo raro"]
paths: app.js, supabase/functions/ps-api/index.ts, supabase/migrations/**/*.sql
---

## Descripción

Este proyecto ya sufrió 4 clases de regresión conocidas y documentadas en su propia historia: (1) una vulnerabilidad XSS real por `innerHTML` sin escapar, corregida retroactivamente en el commit `8f6d46d`; (2) una lista hardcodeada de nombres de área en el fallback de `getAreasRequeridas()` que quedó desincronizada tras la migración `20260612000002_renombrar_areas.sql`; (3) el riesgo estructural de que el PDF generado server-side (`pdf-lib`) y el generado client-side (`html2pdf.js`) diverjan en texto/diseño porque están duplicados en dos runtimes; (4) `ALLOWED_ORIGINS` en la Edge Function que solo lista dominios Netlify aunque el hosting ya migró a cPanel. Esta skill existe para que ninguna de las 4 se repita.

## Objetivo

Detectar, antes de cerrar cualquier tarea, si el cambio realizado reintroduce alguna de estas 4 clases de bug ya vistas, y bloquear el cierre de la tarea hasta corregirlo.

## Cuándo debe utilizarse

- Cualquier diff que agregue o modifique una línea `.innerHTML =` en `app.js`.
- Cualquier cambio de texto legal, layout o constantes visuales del certificado/acta (en `_generarCertificadoPdf()` de `index.ts` o en `_generarHtmlCertificado()`/`_generarPdfClienteSide()` de `app.js`).
- Cualquier migración SQL que haga `UPDATE ps_areas SET nombre = ...` (rename de área).
- Cualquier cambio a `ps_areas.aplica_a`/`aplica_nivel` que pudiera dejarlos todos vacíos (lo que activaría el fallback hardcodeado).
- Cualquier cambio a `ALLOWED_ORIGINS` en `supabase/functions/ps-api/index.ts` o a la configuración de hosting/dominio.

## Instrucciones detalladas

### 1. XSS vía `innerHTML` sin `esc()`

`app.js` define (línea 4-6):
```js
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
```
Hoy hay ~90 sitios `.innerHTML =` en el archivo. El commit `8f6d46d` tuvo que agregar `esc()` retroactivamente a ~30+ de ellos tras detectar una vulnerabilidad XSS real (no un hallazgo teórico de linter). Regla: **todo dato que venga de la base de datos, del usuario, o de un formulario, debe pasar por `esc()` antes de interpolarse en un template string asignado a `innerHTML`**. Antes de cerrar una tarea que toque `innerHTML`:
1. Ejecutar `grep -n "innerHTML" app.js` sobre las líneas nuevas/modificadas.
2. Para cada una, verificar que cualquier variable interpolada que no sea un literal controlado por el propio código (ej. un ícono fijo) esté envuelta en `esc(...)`.
3. Si el dato ya viene pre-escapado en una variable anterior (patrón común: `const escapedNombre = esc(c.nombre);` seguido de su uso más abajo, ver `app.js:1417-1441`), no hace falta volver a escapar, pero sí verificar que esa variable intermedia exista y realmente se haya derivado con `esc()`.

### 2. Fallback hardcodeado de nombres de área (`getAreasRequeridas`)

`index.ts:208-231` contiene una ruta de fallback que solo se activa si **ningún** área tiene `aplica_a` poblado (`index.ts:187`, `areas.some(a => String(a.aplica_a || '').trim())` es falso). Ese fallback compara `ps_areas.nombre` contra listas de strings literales por `tipo_colaborador`: `DOCENTE` → `{'Secretaría Académica', 'Responsable de Tecnología', 'Responsable de Biblioteca', 'Coord. General de Convivencia', 'Restaurante', 'Rectora'}` (+ variante por nivel), `ADMINISTRATIVO` y `SERVICIOS` con sus propias listas. La migración `20260612000002_renombrar_areas.sql` ya renombró varios de esos nombres literales (`'Restaurante' → 'Asistente administrativo(a) y de servicios'`, `'Rectora' → 'Rector(a)'`, `'Coord. General de Convivencia' → 'Coordinador(a) de Convivencia General'`, `'Coord. Preescolar' → 'Coordinador(a) Preescolar'`, etc.) — si el fallback se activara hoy, devolvería listas vacías o incorrectas porque ninguno de esos nombres antiguos existe ya en `ps_areas`.

Antes de cerrar cualquier tarea que:
- Renombre una fila de `ps_areas.nombre` — buscar si ese nombre (antiguo o nuevo) aparece en las listas hardcodeadas de `index.ts:208-231` y actualizarlas si es coherente con la intención del rename.
- Modifique/vacíe `aplica_a`/`aplica_nivel` en cualquier área — confirmar explícitamente que no se está a punto de activar accidentalmente la ruta de fallback (que hoy está efectivamente rota respecto a los nombres actuales).

La corrección de fondo preferida a largo plazo (no asumir que ya se hizo) sería eliminar el fallback o mantenerlo sincronizado en cada migración de rename — pero mientras exista, cada migración `UPDATE ps_areas SET nombre = ...` debe revisarse contra esta lista.

### 3. Deriva entre PDF servidor y PDF cliente

El certificado/acta se genera en dos runtimes que deben producir el mismo resultado visual y textual:
- Servidor: `_generarCertificadoPdf()` (`index.ts:866-1047`, usa `pdf-lib`, invocado por `accionDescargarPdf`).
- Cliente (fallback): `_generarHtmlCertificado()` + `_generarPdfClienteSide()` (`app.js:3008-3245`, usa `html2pdf.js`/`html2canvas`), que solo se usa si el PDF del servidor viene ausente o sospechosamente pequeño (`r.pdfBase64.length > 5000` en `app.js:3250`).

Ambos hardcodean el mismo texto legal ("Se encuentra a PAZ Y SALVO con todas las dependencias de...", "DEPENDENCIAS CERTIFICADAS", "CÓDIGO DE VERIFICACIÓN") y constantes de layout de forma independiente. Si una tarea cambia texto, membrete, firma, orden de campos o cualquier elemento visual del certificado en uno de los dos sitios, **debe** aplicar el mismo cambio en el otro. Verificar con `grep -n "PAZ Y SALVO\|DEPENDENCIAS CERTIFICADAS\|CÓDIGO DE VERIFICACIÓN"` en ambos archivos tras el cambio, comparando que el texto coincida.

### 4. `ALLOWED_ORIGINS` desactualizado respecto al hosting real

`index.ts:20-25` define:
```ts
const ALLOWED_ORIGINS = new Set([
  'https://pazysalvogoyavier.netlify.app',
  'https://portalgoyavier.netlify.app',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
])
```
y el fallback de `getCorsHeaders()` (`index.ts:28`) usa `'https://pazysalvogoyavier.netlify.app'` como origin permitido por defecto si el origin de la request no está en el set. El hosting real ya migró de Netlify a cPanel (hay `.htaccess`, `netlify.toml` fue eliminado), así que este allowlist puede estar desincronizado con el dominio de producción actual. No "limpiar" este set asumiendo que los dominios Netlify ya no se usan, ni agregar el dominio cPanel sin antes confirmarlo con el usuario o con la configuración real de DNS/hosting — pero sí señalar la inconsistencia si una tarea toca CORS, login, o requests fallidas por CORS, y no asumir que el set ya refleja el dominio productivo.

## Reglas obligatorias

- Todo `innerHTML` nuevo o modificado en `app.js` debe envolver en `esc()` cualquier dato que no sea un literal fijo del propio código.
- Ningún rename de `ps_areas.nombre` se cierra sin revisar `index.ts:208-231`.
- Ningún cambio de texto/layout del certificado se cierra sin aplicarlo en `_generarCertificadoPdf()` (index.ts) y en `_generarHtmlCertificado()`/`_generarPdfClienteSide()` (app.js) a la vez.
- No modificar `ALLOWED_ORIGINS` ni el dominio de fallback CORS sin verificar contra el dominio de producción real vigente.

## Criterios de validación

- `grep -n "innerHTML" app.js` sobre el diff no muestra interpolación de `${variable}` sin pasar por `esc()` cuando la variable viene de datos de servidor/usuario.
- El texto legal del certificado (`grep -n "PAZ Y SALVO\|DEPENDENCIAS CERTIFICADAS"` en `index.ts` y `app.js`) es idéntico en ambos archivos tras el cambio.
- Tras cualquier `UPDATE ps_areas SET nombre` en una migración nueva, las listas de `index.ts:208-231` fueron revisadas (y si aplica, actualizadas) en el mismo PR.
- `ALLOWED_ORIGINS` no se modificó sin evidencia explícita del dominio de producción actual en el mensaje de la tarea o en la conversación.

## Checklist final

- [ ] ¿El diff agrega/modifica `innerHTML`? Si sí, todo dato dinámico pasa por `esc()`.
- [ ] ¿El diff renombra un área en una migración? Si sí, se revisó el fallback hardcodeado de `getAreasRequeridas`.
- [ ] ¿El diff cambia texto/diseño del certificado? Si sí, se aplicó en servidor (`index.ts`) y cliente (`app.js`) por igual.
- [ ] ¿El diff toca `ALLOWED_ORIGINS` o CORS? Si sí, se confirmó el dominio real de producción antes de cambiarlo.
