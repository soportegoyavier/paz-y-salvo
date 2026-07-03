---
description: Aplica esta skill antes de tocar app.js, index.html o styles.css en paz-y-salvo — el frontend es un monolito sin framework ni build (app.js de ~3373 líneas / 358KB); verifica que no se introduzca un framework/bundler parcial, que se reutilicen esc()/abrirModal()/cerrarModal()/badges existentes, que no se cree una 4ª implementación de selección masiva tipo toggle*Select, y que pazYSalvoCompleto no se reimplemente de forma distinta a las 5 copias ya existentes.
when_to_use: ["añadir una tabla nueva con selección masiva", "voy a instalar React/Vue/un bundler", "necesito una función para abrir un modal", "voy a agregar otra función tipo togglexSelect", "quiero recalcular si el colaborador está a paz y salvo", "refactorizar app.js"]
paths: app.js, index.html, styles.css
---

## Descripción

`paz-y-salvo` es un frontend sin framework y sin paso de build: `index.html` (770 líneas), `styles.css` (918 líneas) y `app.js` (3373 líneas / 358KB) se sirven tal cual desde cPanel vía `.htaccess`. No hay `package.json` de frontend, ni bundler, ni transpilador — las únicas dependencias son librerías CDN cargadas con `<script src="...">`: `@supabase/supabase-js@2`, `xlsx@0.18.5` y `html2pdf.js@0.10.1`. Esta skill evita que cambios puntuales introduzcan fragmentación arquitectónica: un framework parcial, una cuarta copia de lógica de selección masiva, o una reimplementación divergente de la regla de negocio `pazYSalvoCompleto`.

## Objetivo

Mantener `app.js` como un monolito internamente consistente: mismas convenciones de modal, mismo helper de escape, misma forma de calcular "paz y salvo completo", mismo patrón de selección masiva — para que cualquier persona (o Claude) que lea una sección del archivo pueda asumir que el resto se comporta igual.

## Cuándo debe utilizarse

- Antes de agregar cualquier modal nuevo a `index.html`/`app.js`.
- Antes de agregar una tabla nueva con checkboxes de selección masiva (hoy hay 3: `renderAreaTable` en `app.js:1180`, `renderSAColaboradoresTable` en `app.js:1398`, `renderVGTable` en `app.js:2637`).
- Antes de tocar cualquiera de los 5 sitios que calculan si un colaborador está a paz y salvo (`accionGetMiEstado`, `accionGetAllColaboradores`, `accionGetVistaGlobal`, `accionGetEstadoColaborador`, `accionVerificarCodigo` en `supabase/functions/ps-api/index.ts`).
- Antes de proponer instalar cualquier dependencia npm/CDN nueva para el frontend, o un bundler (Vite, webpack, esbuild).
- Antes de escribir una nueva función `toggle*Select`.

## Instrucciones detalladas

1. **No introducir build tooling parcial.** Si una tarea "necesita" React, Vue, TypeScript compilado, o un bundler solo para una feature aislada, la respuesta correcta es replicar el patrón vainilla existente, no montar un sub-sistema con build propio dentro de un proyecto sin build. Si de verdad se requiere una migración de stack, eso es una decisión de proyecto explícita del usuario, no algo a decidir en una tarea puntual.

2. **Reutilizar el patrón de modales existente.** Los 8 modales estáticos (`modal-primer-login`, `modal-gestionar`, `modal-colaborador`, `modal-carga-masiva`, `modal-usuario`, `modal-documento`, `modal-descarga-bulk`, `modal-recordatorio`) se abren/cierran con:
   ```js
   function cerrarModal(id) { document.getElementById(id).classList.remove("active"); }
   function abrirModal(id)  { document.getElementById(id).classList.add("active"); }
   ```
   (`app.js:447-448`). Un modal nuevo debe seguir esta misma convención: markup estático en `index.html` con clase `.active` toggled, `abrirModal("modal-x")`/`cerrarModal("modal-x")` — no un sistema de modales paralelo, no una librería de diálogos nueva.

3. **No triplicar (ni cuadruplicar) la selección masiva.** Ya existen 3 implementaciones casi idénticas de "seleccionar fila para acción masiva": `toggleAdminSelect` (`app.js:1223`), `toggleSASelect` (`app.js:1451`), `toggleVGSelect` (`app.js:2734`). Antes de escribir una cuarta, evaluar explícitamente si se puede:
   - Reutilizar una de las tres existentes generalizándola con un parámetro (nombre de tabla/estado), o
   - Extraer una función compartida `toggleRowSelect(estadoSet, id, checkbox)` y hacer que las tres (más la nueva) la llamen.
   No agregar una copia-pega más sin dejar constancia de por qué no se pudo reutilizar/extraer.

4. **`pazYSalvoCompleto` tiene una única definición aceptada.** La expresión es:
   ```
   pazYSalvoCompleto = requiere_paz_salvo && areasReq.length > 0 && areasReq.every(a => a.estado === 'APROBADO')
   ```
   y aparece repetida (casi idéntica) en 5 lugares de `supabase/functions/ps-api/index.ts`: `accionGetMiEstado`, `accionGetAllColaboradores`, `accionGetVistaGlobal`, `accionGetEstadoColaborador`, `accionVerificarCodigo`. Si una tarea requiere cambiar esta regla (por ejemplo, qué cuenta como "aprobado", o qué pasa si `areasReq` está vacío), hay que localizar y actualizar los 5 sitios en la misma tarea — nunca solo el que motivó el cambio. Ver `business-logic-guardian` para el detalle de la regla en sí.

5. **Preferir extensión sobre archivo nuevo.** Dado que no hay build, un archivo `.js` adicional implica una etiqueta `<script>` adicional en `index.html` y gestión manual de orden de carga. Antes de crear `app2.js` o similar, preferir añadir la función al `app.js` existente en la sección temática correspondiente (el archivo ya está organizado por bloques con comentarios `// ─── SECCIÓN ───`).

6. **Respetar el límite de dependencias CDN ya establecido.** Las únicas tres librerías externas del frontend son `@supabase/supabase-js@2` (datos/auth), `xlsx@0.18.5` (lectura de Excel para carga masiva) y `html2pdf.js@0.10.1` (fallback de PDF cliente). Antes de agregar una CDN nueva para resolver un problema puntual (fechas, formularios, validación, iconos), preferir una solución con JS plano equivalente a lo que ya hace el resto de `app.js` — cada dependencia CDN nueva es una carga de red adicional sin gestión de versiones ni lockfile, y este proyecto ya optó deliberadamente por mantenerlas al mínimo.

7. **Badges y utilidades visuales repetidas.** Los badges de estado (`PENDIENTE`/`APROBADO`/`RECHAZADO`) y otros indicadores visuales usados en más de una tabla (`renderAreaTable`, `renderSAColaboradoresTable`, `renderVGTable`) ya tienen sus clases CSS en `styles.css`. Antes de introducir un nuevo esquema de color/ícono para un concepto que ya se representa en otra tabla, buscar la clase existente (`grep -n "badge" app.js styles.css`) y reutilizarla, para que el mismo estado se vea igual en toda la aplicación.

## Reglas obligatorias

- No instalar frameworks, bundlers ni transpiladores para resolver una tarea puntual en `app.js`/`index.html`/`styles.css`.
- Todo modal nuevo usa `abrirModal(id)`/`cerrarModal(id)` sobre markup estático con clase `.active` — no un sistema de diálogos alterno.
- No crear una 4ª función `toggle*Select`; reutilizar o extraer una función compartida.
- Cualquier cambio a la lógica de `pazYSalvoCompleto` se aplica simultáneamente en los 5 sitios de `index.ts` listados arriba.
- No dividir `app.js` en módulos ES (`import`/`export`) sin antes confirmar que el hosting cPanel y el `<script>` tag en `index.html` lo soportan — hoy se carga como script clásico.
- No agregar una librería CDN nueva si el mismo resultado se logra con JS plano consistente con el resto de `app.js`.
- Todo badge/indicador visual de estado nuevo reutiliza las clases CSS existentes en `styles.css`, no un esquema de color paralelo.

## Criterios de validación

- `grep -n "toggle.*Select" app.js` no debe mostrar una cuarta función nueva sin justificación de por qué no se reutilizó una existente.
- `grep -n "pazYSalvoCompleto\|requiere_paz_salvo.*areasReq" supabase/functions/ps-api/index.ts` debe seguir mostrando la misma expresión booleana en los 5 sitios tras cualquier cambio a la regla.
- `index.html` no referencia ningún `<script type="module">` de bundler ni CDN de framework (React/Vue/Angular) que no estuviera antes.
- Un modal nuevo aparece en `index.html` con el mismo patrón de clases (`.modal`, `.active`) que los 8 existentes, y se abre/cierra solo vía `abrirModal`/`cerrarModal`.

## Checklist final

- [ ] ¿La tarea agregó o modificó un modal? Si sí, usa `abrirModal`/`cerrarModal`, no un sistema nuevo.
- [ ] ¿La tarea agregó selección masiva a una tabla? Si sí, reutiliza o extrae en vez de copiar `toggle*Select` por 4ª vez.
- [ ] ¿La tarea tocó la regla de "paz y salvo completo"? Si sí, se actualizaron los 5 sitios en `index.ts`, no solo uno.
- [ ] ¿La tarea introdujo alguna dependencia de build (bundler, transpilador, framework)? Si sí, se detuvo y se preguntó al usuario antes de proceder.
- [ ] ¿La tarea agregó una librería CDN nueva? Se evaluó primero si JS plano bastaba.
- [ ] ¿La tarea agregó un badge/indicador de estado? Reutiliza las clases CSS existentes.
- [ ] El archivo `app.js` sigue siendo un único script clásico cargado sin build step.

## Nota sobre la relación con otras skills

Esta skill se enfoca en la forma/estructura del código (monolito, patrones de reuso). Para el contenido de seguridad de lo que se renderiza, ver `ui-guardian` y `security-guardian`; para la regla de negocio detrás de `pazYSalvoCompleto`, ver `business-logic-guardian`; para el detalle de por qué el fallback de `getAreasRequeridas` es frágil, ver `regression-guardian`.
