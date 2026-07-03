---
description: Aplica esta skill antes de escribir o modificar código de interfaz en app.js/index.html del proyecto paz-y-salvo — exige esc() en todo innerHTML con datos dinámicos, reutilizar abrirModal()/cerrarModal() para diálogos, y prohíbe crear una 4ª implementación de selección masiva cuando ya existen toggleAdminSelect/toggleSASelect/toggleVGSelect.
when_to_use: ["voy a renderizar una tabla nueva", "necesito mostrar datos del servidor en el DOM", "voy a agregar un modal", "necesito checkboxes de selección múltiple", "voy a usar innerHTML"]
paths: app.js, index.html, styles.css
---

## Descripción

`app.js` no usa ningún framework de UI ni motor de templates: todo el renderizado es manipulación directa del DOM con `innerHTML` (~90 sitios en el archivo) y funciones de render manuales por tabla (`renderAreaTable` en `app.js:1180`, `renderSAColaboradoresTable` en `app.js:1398`, `renderVGTable` en `app.js:2637`). Sin la disciplina manual de escapar strings, esto ya produjo una vulnerabilidad XSS real (commit `8f6d46d`). Esta skill cubre la disciplina de UI: escape de datos, patrón de modales, y no duplicar selección masiva.

## Objetivo

Que cualquier UI nueva o modificada en `app.js`/`index.html` sea segura contra XSS por construcción manual (vía `esc()`), y consistente con los patrones ya establecidos de modal y de tabla con selección masiva — sin inventar un cuarto patrón donde ya hay tres casi idénticos.

## Cuándo debe utilizarse

- Al renderizar cualquier dato proveniente de `ps_colaboradores`, `ps_usuarios`, `ps_areas`, `ps_aprobaciones` o de un formulario, hacia `innerHTML`.
- Al crear un modal nuevo o modificar uno de los 8 existentes (`modal-primer-login`, `modal-gestionar`, `modal-colaborador`, `modal-carga-masiva`, `modal-usuario`, `modal-documento`, `modal-descarga-bulk`, `modal-recordatorio`).
- Al agregar una tabla con checkboxes de selección para acciones masivas (aprobar/rechazar/toggle en lote, descarga masiva).
- Al agregar badges de estado (`PENDIENTE`/`APROBADO`/`RECHAZADO`) o cualquier elemento visual repetido en varias tablas.

## Instrucciones detalladas

### 1. `esc()` es obligatorio antes de interpolar en `innerHTML`

```js
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
```
(`app.js:4-6`). El patrón correcto, visto en `renderSAColaboradoresTable` (`app.js:1417-1441`), es pre-escapar en variables intermedias y usarlas en el template:
```js
const escapedNombre    = esc(c.nombre);
const escapedAreasReq  = esc(c.areasRequeridas || "");
// ...
`<button onclick="abrirModalEditarColaborador('${c.id}','${escapedNombre}', ...)">Editar</button>`
```
Regla práctica: cualquier variable que provenga de una fila de la base de datos, de `body`/`FormData` del usuario, o de un parámetro de URL, pasa por `esc()` antes de aparecer dentro de un template string asignado a `.innerHTML`. Los únicos valores que NO necesitan `esc()` son literales fijos del propio código (íconos SVG constantes, clases CSS fijas, IDs generados por el propio sistema como UUIDs que ya se validaron con formato).

Nota: `esc()` escapa para contexto de texto/atributo HTML entre comillas dobles o simples — cuando el valor se interpola dentro de un atributo `onclick="...('${valor}')"`, además de `esc()` verificar que comillas simples dentro del valor no rompan el `onclick` (el reemplazo de `'` por `&#39;` ya lo cubre, pero al revisar código nuevo confirmar que efectivamente se usó `esc()` y no una interpolación cruda).

### 2. Modales: reutilizar, no reinventar

Ver también `architecture-guardian`. Todo modal se controla con:
```js
function cerrarModal(id) { document.getElementById(id).classList.remove("active"); }
function abrirModal(id)  { document.getElementById(id).classList.add("active"); }
```
El markup vive como bloque estático en `index.html`, oculto por CSS hasta que se le agrega la clase `.active`. No crear modales generados dinámicamente vía JS puro, no usar `<dialog>` nativo, no traer una librería de modales — seguir el patrón existente aunque parezca menos elegante.

### 3. Selección masiva: no crear una 4ª copia

Ya existen tres implementaciones casi idénticas:
- `toggleAdminSelect` (`app.js:1223`) para la vista de un `ADMIN` sobre su propia área.
- `toggleSASelect` (`app.js:1451`) para la vista de `SUPERADMIN` sobre colaboradores.
- `toggleVGSelect` (`app.js:2734`) para la vista global.

Cada una mantiene su propio `Set`/array de IDs seleccionados y actualiza checkboxes + un contador/botón de acción masiva. Antes de agregar una tabla nueva con selección masiva:
1. Leer las tres implementaciones existentes para entender el patrón exacto (estado seleccionado, evento `change` del checkbox, actualización del botón "Aprobar seleccionados"/similar).
2. Evaluar si se puede parametrizar una de las tres para el caso nuevo, o extraer una función genérica `toggleRowSelect(selectedSet, id, checkboxEl, onUpdate)` reutilizable por las 4.
3. Solo si ninguna opción de reuso es viable (y con justificación explícita en el código o en la respuesta al usuario), escribir una nueva — pero eso debería ser la excepción, no la norma.

### 4. Badges de estado

Los estados `PENDIENTE`/`APROBADO`/`RECHAZADO` se muestran como badges con clases CSS ya definidas en `styles.css`. Al añadir una tabla nueva que muestre estado de aprobación, reutilizar las mismas clases de badge existentes (buscar `class="badge` en `app.js`/`styles.css` para el patrón exacto) en vez de definir un esquema de color/clase nuevo para el mismo concepto de estado.

## Reglas obligatorias

- Ningún `innerHTML` nuevo interpola datos dinámicos sin pasar por `esc()`.
- Ningún modal nuevo evita `abrirModal(id)`/`cerrarModal(id)`.
- Ninguna tabla nueva con selección masiva implementa una 4ª copia de `toggle*Select` sin antes intentar reutilizar/extraer.
- Los badges de estado de aprobación reutilizan las clases CSS ya existentes para `PENDIENTE`/`APROBADO`/`RECHAZADO`.

## Criterios de validación

- Diff de `app.js`: cada línea nueva con `innerHTML = ` y una interpolación `${...}` de datos no literales tiene un `esc(...)` correspondiente (directo o vía variable pre-escapada).
- No aparece una cuarta función `toggle*Select` en el diff sin evidencia de que se evaluó reutilizar las tres existentes.
- Todo modal nuevo en `index.html` sigue la misma estructura de clases que los 8 existentes y se controla solo desde `abrirModal`/`cerrarModal`.

## Checklist final

- [ ] ¿Se agregó/modificó `innerHTML` con datos dinámicos? Si sí, pasan por `esc()`.
- [ ] ¿Se agregó un modal? Usa `abrirModal`/`cerrarModal` sobre markup estático.
- [ ] ¿Se agregó selección masiva? Se reutilizó o extrajo en vez de copiar por 4ª vez.
- [ ] ¿Se agregaron badges de estado? Reutilizan las clases CSS existentes, no un esquema nuevo.
