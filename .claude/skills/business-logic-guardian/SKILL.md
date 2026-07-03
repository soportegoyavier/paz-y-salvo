---
description: Aplica esta skill antes de modificar el flujo de aprobaciones, getAreasRequeridas(), la regla pazYSalvoCompleto, el ciclo de vida del código de verificación, la generación de certificado, correos automáticos, u operaciones masivas del proyecto paz-y-salvo — es el dominio de negocio real (certificado de retiro de personal del Colegio Goyavier), no inventario/préstamos.
when_to_use: ["cambiar qué áreas debe aprobar un colaborador", "cambiar cuándo se considera completo el paz y salvo", "el código de verificación no se está revocando", "modificar aprobar_masivo / toggle_paz_salvo_masivo / carga_masiva_colaboradores", "cambiar el correo de recordatorio o el aviso a Talento Humano"]
paths: supabase/functions/ps-api/index.ts, app.js, supabase/migrations/**/*.sql
---

## Descripción

El dominio de negocio de este proyecto es la gestión del "paz y salvo": el certificado de que un colaborador que se retira del Colegio Campestre Goyavier no debe nada y devolvió todo lo que tenía a cargo (llaves, materiales, equipos, libros, etc.), respaldado por la aprobación de cada área/dependencia relevante. No hay conceptos de inventario, préstamos ni activos aquí (eso pertenece al proyecto hermano Zaiko) — el núcleo es: colaborador → áreas requeridas → aprobaciones por área → estado agregado → certificado con código de verificación.

## Objetivo

Que cualquier cambio a la lógica de negocio preserve la única fuente de verdad para "qué áreas debe aprobar un colaborador" (`getAreasRequeridas`), la única definición aceptada de "paz y salvo completo" (repetida en 5 sitios, debe cambiar en los 5 a la vez), el ciclo de vida correcto del código de verificación, y la coherencia entre generación de certificado, correos automáticos y operaciones masivas.

## Cuándo debe utilizarse

- Al modificar `getAreasRequeridas()` (`supabase/functions/ps-api/index.ts:182-232`) o los datos que la alimentan (`ps_areas.aplica_a`/`aplica_nivel`, `ps_colaboradores.tipo_colaborador`/`nivel_educativo`/`areas_requeridas`).
- Al modificar la condición de "paz y salvo completo" en cualquiera de sus 5 sitios.
- Al modificar la creación, reutilización, revocación o reemplazo del código de verificación (`ps_codigos_verificacion`).
- Al modificar `accionVerificarCodigo` o cualquier lógica de auto-revocación en tiempo de verificación.
- Al modificar operaciones masivas: `aprobar_masivo`, `toggle_paz_salvo_masivo`, `carga_masiva_colaboradores`, descarga masiva de PDFs.
- Al modificar cualquiera de los 3 correos automáticos (credenciales, recordatorio, aviso a Talento Humano).

## Instrucciones detalladas

### 1. `getAreasRequeridas()` — fuente única de qué áreas aplican

`index.ts:182-232`. Ruta principal (`index.ts:187-206`): si **algún** `ps_areas.aplica_a` está poblado, filtra áreas comparando `tipo_colaborador` (con soporte para `'TODOS'` en `aplica_a`) y, si `aplica_nivel` está seteado, también `nivel_educativo`; además siempre incluye el área/jefe propio asignado en `ps_colaboradores.areas_requeridas` aunque no calce con el filtro. Ruta de fallback (`index.ts:208-231`): si **ningún** área tiene `aplica_a` seteado, compara `ps_areas.nombre` contra listas de strings hardcodeadas por `tipo_colaborador` (`DOCENTE`, `ADMINISTRATIVO`, `SERVICIOS`) más variantes por `nivel_educativo` para docentes. Esta ruta de fallback ya quedó desincronizada una vez (ver `regression-guardian` para el detalle de la migración `20260612000002_renombrar_areas.sql` que renombró los nombres literales que el fallback espera). Cualquier cambio a esta función debe:
1. Decidir explícitamente si afecta la ruta principal, el fallback, o ambas.
2. Si afecta el fallback, verificar contra los nombres ACTUALES de `ps_areas` (no los nombres antiguos pre-rename).
3. Preservar la regla de "siempre incluir el área/jefe propio del colaborador" en ambas rutas.

### 2. `pazYSalvoCompleto` — una regla, 5 copias

```
pazYSalvoCompleto = requiere_paz_salvo && areasReq.length > 0 && areasReq.every(a => a.estado === 'APROBADO')
```
Repetida en `accionGetMiEstado`, `accionGetAllColaboradores`, `accionGetVistaGlobal`, `accionGetEstadoColaborador`, `accionVerificarCodigo` (todas en `index.ts`). Nótese la condición `areasReq.length > 0`: un colaborador sin ninguna área requerida NO se considera "a paz y salvo completo" automáticamente por vacuidad — esto es intencional (evita que un colaborador mal configurado sin áreas asignadas aparezca como aprobado). Cualquier cambio a esta regla (qué estados cuentan como aprobado, qué pasa con áreas vacías, etc.) se aplica en los 5 sitios en la misma tarea — grep `requiere_paz_salvo` y `areasReq` en `index.ts` para ubicarlos todos antes de dar la tarea por terminada.

### 3. Ciclo de vida del código de verificación

`ps_codigos_verificacion`: un único código **activo** por colaborador.
- **Reutilización**: al generar el documento (`accionGenerarDocumento`, `index.ts:824-840`, comentario "Reusar el código activo si ya existe"), si ya hay un código activo vigente para ese colaborador, se reutiliza en vez de crear uno nuevo.
- **Revocación** (`motivo_inactivacion = 'REVOCADO'`): ocurre al rechazar una aprobación o al resetear aprobaciones — el certificado deja de ser válido porque las condiciones que lo sustentaban cambiaron.
- **Reemplazo** (`motivo_inactivacion = 'REEMPLAZADO'`): ocurre al forzar la aprobación (acción de `SUPERADMIN`) — se invalida el código anterior y se emite uno nuevo.
- **Auto-revocación en tiempo de verificación**: `accionVerificarCodigo` (`index.ts:1095-1101`) es una acción pública (`PUBLIC_ACTIONS`) que, al ser consultada, revalida en vivo si las aprobaciones subyacentes siguen sustentando el código; si no, lo auto-revoca en ese momento. Esto significa que el código NO es un flag cacheado que se pueda confiar ciegamente — es una revalidación viva en cada verificación. Cualquier cambio a esta lógica debe preservar esa revalidación en tiempo real, no reemplazarla por una bandera que se actualice solo de forma asíncrona/diferida.

### 4. Generación de certificado (acta) — duplicada en 2 runtimes

Ver `regression-guardian` para el detalle operativo de mantener sincronizados `_generarCertificadoPdf()` (`index.ts:866-1047`, servidor, `pdf-lib`) y `_generarHtmlCertificado()`/`_generarPdfClienteSide()` (`app.js:3008-3245`, cliente, fallback si `r.pdfBase64.length <= 5000` según el chequeo de `app.js:3250`). Desde la óptica de negocio: el fallback cliente existe para no bloquear la entrega del certificado si el servidor falla, pero el contenido legal certificado debe ser idéntico en ambos casos — un certificado con texto distinto según qué runtime lo generó sería un problema de integridad documental, no solo estético.

### 5. Operaciones masivas

- `aprobar_masivo`: aprueba en lote las aprobaciones seleccionadas de un área — debe respetar las mismas reglas de autorización que la aprobación individual (un `ADMIN` solo puede aprobar masivamente dentro de su(s) propia(s) área(s), vía `_resolverAreaId()`/`area_ids`).
- `toggle_paz_salvo_masivo`: activa/desactiva `requiere_paz_salvo` en lote.
- `carga_masiva_colaboradores`: importación CSV/Excel vía SheetJS con tope de 200 filas (`index.ts:450`) — cualquier cambio que toque el límite o el parseo debe considerar por qué existe el tope (evitar cargas que saturen la función o generen inconsistencias masivas sin revisión).
- Descarga masiva de PDFs: debe usar la misma ruta de generación de certificado que la descarga individual (`_generarCertificadoPdf()`), no una ruta paralela.

### 6. Correos automáticos

Vía `nodemailer`/SMTP en la Edge Function:
- `emailCredenciales`: al crear/resetear un usuario, envía sus credenciales.
- `accionEnviarRecordatorio`: recordatorio de aprobación pendiente a los admins de un área.
- `accionEnviarSolicitudTH`: aviso de certificado completo a Talento Humano (destinatario configurado en `ps_config.EMAIL_TALENTO_HUMANO`).

Cualquier cambio al contenido/destinatarios de estos correos debe considerar que son la única notificación proactiva del sistema (no hay notificaciones in-app persistentes) — un cambio que silencie un correo sin reemplazo equivalente deja a los interesados sin forma de enterarse del evento.

## Reglas obligatorias

- Cambios a `getAreasRequeridas()` consideran explícitamente ambas rutas (principal y fallback) y, si tocan el fallback, se validan contra los nombres actuales de `ps_areas`.
- Cambios a `pazYSalvoCompleto` se aplican en los 5 sitios (`accionGetMiEstado`, `accionGetAllColaboradores`, `accionGetVistaGlobal`, `accionGetEstadoColaborador`, `accionVerificarCodigo`) en la misma tarea.
- La auto-revocación en tiempo de verificación (`accionVerificarCodigo`) se preserva como revalidación viva, no se reemplaza por un flag cacheado.
- La descarga masiva de PDFs reutiliza `_generarCertificadoPdf()`, no una ruta de generación paralela.
- Ningún correo automático se elimina/silencia sin un mecanismo de notificación equivalente.

## Criterios de validación

- `grep -n "requiere_paz_salvo.*areasReq\|areasReq.*every" supabase/functions/ps-api/index.ts` muestra la misma expresión en los 5 sitios tras el cambio.
- Si se tocó el fallback de `getAreasRequeridas`, los nombres comparados existen hoy en `ps_areas` (verificable con `mcp__supabase__execute_sql` contra staging: `SELECT nombre FROM ps_areas`).
- `accionVerificarCodigo` sigue consultando el estado real de `ps_aprobaciones` en cada llamada, no un campo booleano cacheado sin recomputar.
- La descarga masiva y la individual de PDF invocan la misma función `_generarCertificadoPdf()`.

## Checklist final

- [ ] ¿Se tocó `getAreasRequeridas`? Se consideraron ambas rutas y el fallback está sincronizado con los nombres actuales de área.
- [ ] ¿Se tocó la regla de "paz y salvo completo"? Se actualizaron los 5 sitios.
- [ ] ¿Se tocó el código de verificación? Se preservaron reutilización/revocación/reemplazo/auto-revocación viva.
- [ ] ¿Se tocó la generación de certificado? Servidor y cliente quedaron con el mismo contenido (ver `regression-guardian`).
- [ ] ¿Se tocó una operación masiva? Respeta las mismas reglas de autorización que su equivalente individual.
- [ ] ¿Se tocó un correo automático? No quedó silenciado sin reemplazo.
