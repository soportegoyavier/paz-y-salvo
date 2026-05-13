// ============================================================
// PAZ Y SALVO INSTITUCIONAL — BACKEND (Google Apps Script)
// Archivo: Code.gs
// Principio: TODA la lógica en backend. El frontend es solo UI.
// ============================================================

// ─── CONFIGURACIÓN GLOBAL ──────────────────────────────────
// ⚠️ IMPORTANTE: Reemplaza el valor de abajo con el ID de tu Google Sheet.
// Lo encuentras en la URL de tu hoja:
// https://docs.google.com/spreadsheets/d/  AQUÍ_VA_EL_ID  /edit
const SHEET_ID = "1dTqrk29S6yqL4WG3_nNV2-xUn6JvPHfbGwjVLO_zEsA";
const GOOGLE_CLIENT_ID = "818503445929-8nacop2o8g1us5pkp7256qr0atu91ldo.apps.googleusercontent.com";

const SESSION_TTL_MINUTES = 60;
const PASSWORD_SALT = "GOYAVIER_SALT_2026_"; // ← Cambiar en producción

// Nombres de hojas
const SHEETS = {
  COLABORADORES: "COLABORADORES",
  USUARIOS: "USUARIOS",
  AREAS: "AREAS",
  APROBACIONES: "APROBACIONES",
  CODIGOS: "CODIGOS_VERIFICACION",
  LOGS: "LOGS",
  CONFIG: "CONFIG",
  SESIONES: "SESIONES"
};

// ─── CACHÉ POR REQUEST ────────────────────────────────────
// Evita releer la misma hoja múltiples veces en un solo doPost.
// Se reinicia al inicio de cada llamada HTTP.
let _rCache = {};
function _resetRCache() { _rCache = {}; }
function cachedObjects(nombre) {
  if (!_rCache[nombre]) _rCache[nombre] = sheetToObjects(getSheet(nombre));
  return _rCache[nombre];
}
function _invalidate(nombre) { delete _rCache[nombre]; }

// ─── PUNTO DE ENTRADA HTTP ─────────────────────────────────
function doPost(e) {
  if (!e || !e.postData) {
    return respuesta({ ok: false, error: "doPost debe ejecutarse vía HTTP, no desde el editor de GAS" });
  }
  try {
    _resetRCache();
    if (Math.random() < 0.1) limpiarSesionesExpiradas();

    const body = JSON.parse(e.postData.contents);
    const action = body.action;
    const token = body.token || null;

    // Acciones públicas (sin sesión)
    const PUBLIC_ACTIONS = ["login", "login_google", "verificar_codigo"];

    if (!PUBLIC_ACTIONS.includes(action)) {
      const session = validarSesion(token);
      if (!session.ok) {
        return respuesta({ ok: false, error: "Sesión inválida o expirada" });
      }
      body._session = session.data;
    }

    let resultado;

    switch (action) {
      // AUTH
      case "login":               resultado = accionLogin(body); break;
      case "login_google":        resultado = accionLoginGoogle(body); break;
      case "logout":              resultado = accionLogout(body); break;

      // COLABORADOR
      case "get_mi_estado":       resultado = accionGetMiEstado(body); break;

      // ADMIN ÁREA
      case "get_colaboradores_area": resultado = accionGetColaboradoresArea(body); break;
      case "aprobar":             resultado = accionAprobar(body); break;
      case "aprobar_masivo":      resultado = accionAprobarMasivo(body); break;
      case "rechazar":            resultado = accionRechazar(body); break;
      case "get_estado_colaborador": resultado = accionGetEstadoColaborador(body); break;
      case "enviar_recordatorio": resultado = accionEnviarRecordatorio(body); break;
      case "diagnostico_aprobaciones": resultado = accionDiagnosticoAprobaciones(body); break;
      case "reparar_area_ids":        resultado = accionRepararAreaIds(body); break;
      case "migracion_areas":         resultado = accionMigracionAreas(body); break;
      case "agregar_cedula_usuarios": resultado = accionMigracionAgregarCedula(body); break;
      case "agregar_jefes_area":      resultado = accionAgregarJefesDeArea(body); break;
      case "agregar_cols_colaboradores": resultado = accionMigracionColsColab(body); break;
      case "agregar_tipo_areas":         resultado = accionMigracionTipoAreas(body); break;

      // SUPER ADMIN - Colaboradores
      case "get_all_colaboradores": resultado = accionGetAllColaboradores(body); break;
      case "crear_colaborador":   resultado = accionCrearColaborador(body); break;
      case "editar_colaborador":  resultado = accionEditarColaborador(body); break;
      case "toggle_paz_salvo":    resultado = accionTogglePazSalvo(body); break;
      case "toggle_paz_salvo_masivo": resultado = accionTogglePazSalvoMasivo(body); break;
      case "carga_masiva_colaboradores": resultado = accionCargaMasivaColaboradores(body); break;

      // SUPER ADMIN - Usuarios
      case "get_usuarios":        resultado = accionGetUsuarios(body); break;
      case "crear_usuario":       resultado = accionCrearUsuario(body); break;
      case "editar_usuario":      resultado = accionEditarUsuario(body); break;

      // SUPER ADMIN - Configuración
      case "get_config":          resultado = accionGetConfig(body); break;
      case "set_proceso_activo":  resultado = accionSetProcesoActivo(body); break;
      case "get_config_admin":    resultado = accionGetConfigAdmin(body); break;
      case "set_emails_notificacion": resultado = accionSetEmailsNotificacion(body); break;
      case "set_config_sa":       resultado = accionSetConfigSA(body); break;

      // COLABORADOR
      case "enviar_solicitud_th": resultado = accionEnviarSolicitudTH(body); break;
      case "cambiar_password":    resultado = accionCambiarPassword(body); break;

      // SUPER ADMIN - Vista global
      case "get_vista_global":    resultado = accionGetVistaGlobal(body); break;
      case "forzar_paz_salvo":    resultado = accionForzarPazSalvo(body); break;

      // DOCUMENTO
      case "generar_documento":   resultado = accionGenerarDocumento(body); break;
      case "descargar_pdf":       resultado = accionDescargarPdf(body); break;
      case "verificar_codigo":    resultado = accionVerificarCodigo(body); break;

      // AREAS
      case "get_areas":           resultado = accionGetAreas(body); break;

      // LOGS
      case "get_logs":            resultado = accionGetLogs(body); break;

      default:
        resultado = { ok: false, error: "Acción no reconocida: " + action };
    }

    return respuesta(resultado);

  } catch (err) {
    Logger.log("ERROR doPost: " + err.toString() + "\nStack: " + err.stack);
    return respuesta({ ok: false, error: "Error interno del servidor", detalle: err.toString() });
  }
}

// ─── FUNCIONES LLAMADAS VÍA google.script.run ─────────────
// Estas NO pasan por doPost — usan el puente nativo de Apps Script,
// que ya sabe quién es el usuario por su sesión de Google.

function loginConGoogleSession() {
  try {
    const email = Session.getActiveUser().getEmail();
    if (!email) return { ok: false, error: "No hay sesión de Google activa. Asegúrate de haber iniciado sesión en tu cuenta institucional." };

    const usuarios = sheetToObjects(getSheet(SHEETS.USUARIOS));
    const usuario  = usuarios.find(u =>
      String(u.EMAIL || "").toLowerCase() === email.toLowerCase() &&
      esTrue(u.ACTIVO)
    );

    if (!usuario) {
      registrarLog(email, "-", "LOGIN_GOOGLE_FALLIDO", "Correo no registrado");
      return { ok: false, error: "El correo " + email + " no está registrado en el sistema. Contacta al administrador." };
    }

    if (usuario.ROL !== "SUPERADMIN") {
      const config = getConfigValor("PROCESO_ACTIVO");
      if (config !== "TRUE") return { ok: false, error: "El proceso no está activo en este momento." };
    }

    const parseIds = v => String(v || "").split(",").map(s => s.trim()).filter(Boolean);
    const todosU = sheetToObjects(getSheet(SHEETS.USUARIOS));
    const areaIds = usuario.ROL === "ADMIN"
      ? getAreaIdsDelAdmin(usuario, todosU)
      : parseIds(usuario.AREA_ID);
    const token = crearSesion(usuario.ID, usuario.USERNAME, usuario.ROL, areaIds.join(","));
    registrarLog(usuario.USERNAME, usuario.ROL, "LOGIN_GOOGLE_OK", "Email: " + email);

    return {
      ok:         true,
      token,
      rol:        usuario.ROL,
      username:   usuario.USERNAME,
      email:      email,
      areaId:     areaIds[0] || "",
      areaIds:    areaIds,
      areaNombre: getNombreArea(areaIds[0] || "")
    };
  } catch(e) {
    Logger.log("loginConGoogleSession error: " + e.toString());
    return { ok: false, error: "Error al obtener sesión de Google: " + e.message };
  }
}

function enviarEmailGAS(para, asunto, cuerpo) {
  try {
    GmailApp.sendEmail(para, asunto, cuerpo);
    return { ok: true };
  } catch(e) {
    Logger.log("enviarEmailGAS error: " + e.toString());
    return { ok: false, error: e.message };
  }
}

// ─── PUNTO DE ENTRADA GET — sirve el index.html ────────────
// Esto permite abrir la app directamente desde la URL /exec del navegador.
// Ya NO necesitas abrir el index.html desde tu PC.
function doGet(e) {
  // Si piden el JSON de verificación de estado, responder JSON
  if (e && e.parameter && e.parameter.ping === "1") {
    return ContentService.createTextOutput(
      JSON.stringify({ ok: true, sistema: "Paz y Salvo Goyavier", version: "1.0" })
    ).setMimeType(ContentService.MimeType.JSON);
  }
  // De lo contrario, servir el frontend HTML
  return HtmlService.createHtmlOutputFromFile("index")
    .setTitle("Paz y Salvo — Colegio Campestre Goyavier")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ─── UTILIDADES CORE ───────────────────────────────────────
function getSheet(nombre) {
  return SpreadsheetApp.openById(SHEET_ID).getSheetByName(nombre);
}

function respuesta(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function sheetToObjects(sheet) {
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  const headers = data[0].map(h => String(h).trim());
  return data.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = row[i]; });
    return obj;
  });
}

// Compara boolean TRUE o string "TRUE"/"true" de forma segura
function esTrue(val) { return String(val).toLowerCase() === "true"; }

// Convierte un valor de celda (Date o string) a string de fecha formateado
function _strFecha(val) {
  if (!val) return "";
  if (val instanceof Date) return Utilities.formatDate(val, "America/Bogota", "yyyy-MM-dd HH:mm:ss");
  return String(val);
}
// Extrae el año de un valor de celda fecha (Date o string)
function _anioFecha(val) {
  if (!val) return "";
  if (val instanceof Date) return String(val.getFullYear());
  return String(val).substring(0, 4);
}

function generarId() {
  return Utilities.getUuid();
}

function hashPassword(password) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    PASSWORD_SALT + password,
    Utilities.Charset.UTF_8
  );
  return bytes.map(b => ('0' + (b & 0xFF).toString(16)).slice(-2)).join('');
}

function generarToken() {
  return Utilities.getUuid() + "-" + new Date().getTime();
}

function timestampActual() {
  return Utilities.formatDate(new Date(), "America/Bogota", "yyyy-MM-dd HH:mm:ss");
}

// ─── GESTIÓN DE SESIONES ───────────────────────────────────
function validarSesion(token) {
  if (!token) return { ok: false };

  const sheet = getSheet(SHEETS.SESIONES);
  const rows = sheetToObjects(sheet);
  const now = new Date();

  const sesion = rows.find(r => r.TOKEN === token);
  if (!sesion) return { ok: false };

  const expira = new Date(sesion.EXPIRA);
  if (now > expira) {
    eliminarSesion(token);
    return { ok: false };
  }

  const areaIdsRaw = String(sesion.AREA_ID || "");
  const areaIds    = areaIdsRaw ? areaIdsRaw.split(",").map(s => s.trim()).filter(Boolean) : [];

  return {
    ok: true,
    data: {
      usuarioId: sesion.USUARIO_ID,
      username:  sesion.USERNAME,
      rol:       sesion.ROL,
      areaId:    areaIds[0] || "",
      areaIds:   areaIds,
      token:     token
    }
  };
}

function crearSesion(usuarioId, username, rol, areaId) {
  const token = generarToken();
  const expira = new Date();
  expira.setMinutes(expira.getMinutes() + SESSION_TTL_MINUTES);

  const sheet = getSheet(SHEETS.SESIONES);
  sheet.appendRow([token, usuarioId, username, rol, areaId, expira.toISOString()]);

  return token;
}

function eliminarSesion(token) {
  const sheet = getSheet(SHEETS.SESIONES);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === token) {
      sheet.deleteRow(i + 1);
      break;
    }
  }
}

function limpiarSesionesExpiradas() {
  const sheet = getSheet(SHEETS.SESIONES);
  const data = sheet.getDataRange().getValues();
  const now = new Date();
  const toDelete = [];

  for (let i = data.length - 1; i >= 1; i--) {
    const expira = new Date(data[i][5]);
    if (now > expira) toDelete.push(i + 1);
  }
  toDelete.forEach(row => sheet.deleteRow(row));
}

// ─── LOGS ──────────────────────────────────────────────────
function registrarLog(username, rol, accion, detalle) {
  const sheet = getSheet(SHEETS.LOGS);
  sheet.appendRow([
    generarId(),
    timestampActual(),
    username || "SISTEMA",
    rol || "-",
    accion,
    detalle || ""
  ]);
}

// ─── ACCIÓN: LOGIN ─────────────────────────────────────────
function accionLogin(body) {
  const { username, password } = body;

  if (!username || !password) {
    return { ok: false, error: "Credenciales incompletas" };
  }

  const usuarios = cachedObjects(SHEETS.USUARIOS);
  const hash = hashPassword(password);

  const usuario = usuarios.find(u =>
    String(u.USERNAME).toLowerCase() === String(username).toLowerCase() &&
    u.PASSWORD_HASH === hash &&
    esTrue(u.ACTIVO)
  );

  if (!usuario) {
    registrarLog(username, "-", "LOGIN_FALLIDO", "Usuario o contraseña incorrectos");
    return { ok: false, error: "Credenciales incorrectas o usuario inactivo" };
  }

  // Si no es superadmin, verificar que el proceso esté activo
  if (usuario.ROL !== "SUPERADMIN") {
    const config = getConfigValor("PROCESO_ACTIVO");
    if (config !== "TRUE") {
      return { ok: false, error: "El proceso no está activo en este momento" };
    }
  }

  const parseIds = v => String(v || "").split(",").map(s => s.trim()).filter(Boolean);
  let areaIds;
  if (usuario.ROL === "ADMIN" || usuario.ROL === "SUPERADMIN") {
    const porEmail = getAreaIdsDelAdmin(usuario, usuarios);
    const propia   = parseIds(usuario.AREA_ID);
    areaIds = [...new Set([...porEmail, ...propia])];
  } else {
    areaIds = parseIds(usuario.AREA_ID);
  }
  const token = crearSesion(usuario.ID, usuario.USERNAME, usuario.ROL, areaIds.join(","));
  registrarLog(usuario.USERNAME, usuario.ROL, "LOGIN_OK", "Inicio de sesión exitoso");

  return {
    ok: true,
    token,
    rol:         usuario.ROL,
    username:    usuario.USERNAME,
    cedula:      usuario.CEDULA || "",
    areaId:      areaIds[0] || "",
    areaIds:     areaIds,
    areaNombre:  getNombreArea(areaIds[0] || ""),
    areaNombres: Object.fromEntries(areaIds.map(id => [id, getNombreArea(id)]))
  };
}

// ─── ACCIÓN: LOGOUT ────────────────────────────────────────
function accionLogout(body) {
  const session = body._session;
  eliminarSesion(session.token);
  registrarLog(session.username, session.rol, "LOGOUT", "");
  return { ok: true };
}

// ─── ACCIÓN: GET MI ESTADO (COLABORADOR) ───────────────────
function accionGetMiEstado(body) {
  const session = body._session;

  const cedula = String(body.cedula || "").trim();
  if (!cedula) return { ok: false, error: "Cédula requerida" };

  const colaboradores = cachedObjects(SHEETS.COLABORADORES);

  const normalizar = v => String(v).trim().replace(/\D/g, "").replace(/^0+/, "");
  const cedulaNorm  = normalizar(cedula);

  const colaborador = colaboradores.find(c =>
    normalizar(c.CEDULA) === cedulaNorm && esTrue(c.ACTIVO)
  );

  if (!colaborador) {
    const inactivo = colaboradores.find(c => normalizar(c.CEDULA) === cedulaNorm);
    if (inactivo) return { ok: false, error: "Tu registro está inactivo. Contacta al administrador." };
    return { ok: false, error: "Cédula " + cedula + " no está registrada en el sistema. Verifica el número o contacta al administrador." };
  }

  const todasAreas = cachedObjects(SHEETS.AREAS).filter(a => esTrue(a.ACTIVO));
  const areas      = getAreasRequeridas(colaborador, todasAreas); // solo las que le aplican
  const aprobaciones = cachedObjects(SHEETS.APROBACIONES);
  const usuarios = cachedObjects(SHEETS.USUARIOS);

  const aprobMap = {};
  aprobaciones.forEach(a => { aprobMap[String(a.COLABORADOR_ID) + "_" + String(a.AREA_ID)] = a; });

  // Áreas que este colaborador administra (por su cédula en USUARIOS) → OMITIDO
  const areasOmitidas = new Set(getAreaIdsDelColaborador(colaborador.CEDULA, usuarios).map(String));

  const estadoPorArea = areas.map(area => {
    const adminDeArea = usuarios.find(u => {
      const uAreas = String(u.AREA_ID || "").split(",").map(s => s.trim());
      return uAreas.includes(String(area.ID)) && u.ROL === "ADMIN" && esTrue(u.ACTIVO);
    });

    if (areasOmitidas.has(String(area.ID))) {
      return {
        areaId: area.ID,
        areaNombre: area.NOMBRE,
        estado: "OMITIDO",
        observaciones: "Área propia — no requiere aprobación externa",
        aprobadoPor: "",
        adminUsername: adminDeArea ? adminDeArea.USERNAME : null
      };
    }

    const ap = aprobMap[String(colaborador.ID) + "_" + String(area.ID)];
    return {
      areaId: area.ID,
      areaNombre: area.NOMBRE,
      estado: ap ? ap.ESTADO : "PENDIENTE",
      observaciones: ap ? ap.OBSERVACIONES : "",
      aprobadoPor: ap ? ap.APROBADO_POR : "",
      adminUsername: adminDeArea ? adminDeArea.USERNAME : null
    };
  });

  const areasRequeridas = estadoPorArea.filter(a => a.estado !== "OMITIDO");
  const pazYSalvoCompleto = esTrue(colaborador.REQUIERE_PAZ_SALVO)
    ? areasRequeridas.length > 0 && areasRequeridas.every(a => a.estado === "APROBADO")
    : false;

  return {
    ok: true,
    colaborador: { id: colaborador.ID, nombre: colaborador.NOMBRE, cedula: colaborador.CEDULA },
    estadoPorArea,
    pazYSalvoCompleto,
    requierePazSalvo: esTrue(colaborador.REQUIERE_PAZ_SALVO)
  };
}

// ─── ACCIÓN: GET COLABORADORES ÁREA (ADMIN) ────────────────
function accionGetColaboradoresArea(body) {
  const session = body._session;
  if (!["ADMIN","SUPERADMIN"].includes(session.rol)) return { ok: false, error: "Acceso denegado" };

  const areaIds    = session.areaIds && session.areaIds.length ? session.areaIds : [session.areaId].filter(Boolean);
  const todasAreas = cachedObjects(SHEETS.AREAS);
  const colaboradores = cachedObjects(SHEETS.COLABORADORES)
    .filter(c => esTrue(c.ACTIVO) && esTrue(c.REQUIERE_PAZ_SALVO));
  const aprobaciones = cachedObjects(SHEETS.APROBACIONES);

  const aprobMap = {};
  aprobaciones.forEach(a => { aprobMap[String(a.COLABORADOR_ID) + "_" + String(a.AREA_ID)] = a; });

  const areas = areaIds.map(areaId => {
    const info = todasAreas.find(a => String(a.ID) === String(areaId));
    return {
      areaId,
      areaNombre: info ? info.NOMBRE : areaId,
      colaboradores: colaboradores.map(c => {
        const ap = aprobMap[String(c.ID) + "_" + String(areaId)];
        return {
          id: c.ID, nombre: c.NOMBRE, cedula: c.CEDULA,
          estado:       ap ? ap.ESTADO       : "PENDIENTE",
          observaciones: ap ? ap.OBSERVACIONES : "",
          aprobadoPor:  ap ? ap.APROBADO_POR  : ""
        };
      })
    };
  });

  return { ok: true, areas };
}

// ─── ACCIÓN: APROBAR ───────────────────────────────────────
function accionAprobar(body) {
  const session = body._session;
  if (!["ADMIN","SUPERADMIN"].includes(session.rol)) return { ok: false, error: "Acceso denegado" };

  const { colaboradorId, areaId: reqAreaId } = body;
  if (!colaboradorId) return { ok: false, error: "ID de colaborador requerido" };

  const areaIds = session.areaIds && session.areaIds.length ? session.areaIds : [session.areaId].filter(Boolean);
  const areaId  = session.rol === "SUPERADMIN"
    ? (reqAreaId ? String(reqAreaId) : areaIds[0])
    : (reqAreaId && areaIds.includes(String(reqAreaId)) ? String(reqAreaId) : areaIds[0]);
  if (!areaId) return { ok: false, error: "Área no autorizada" };

  const sheet = getSheet(SHEETS.APROBACIONES);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const colIdx = {};
  headers.forEach((h, i) => { colIdx[h] = i; });

  let filaExistente = -1;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][colIdx.COLABORADOR_ID]) === String(colaboradorId) &&
        String(data[i][colIdx.AREA_ID]) === String(areaId)) {
      filaExistente = i + 1; break;
    }
  }

  const timestamp = timestampActual();
  if (filaExistente > 0) {
    sheet.getRange(filaExistente, colIdx.ESTADO + 1).setValue("APROBADO");
    sheet.getRange(filaExistente, colIdx.OBSERVACIONES + 1).setValue("");
    sheet.getRange(filaExistente, colIdx.APROBADO_POR + 1).setValue(session.username);
    sheet.getRange(filaExistente, colIdx.FECHA_ACCION + 1).setValue(timestamp);
  } else {
    sheet.appendRow([generarId(), colaboradorId, areaId, "APROBADO", "", session.username, timestamp]);
  }

  registrarLog(session.username, session.rol, "APROBAR", `Colaborador ID: ${colaboradorId} en área ID: ${areaId}`);
  return { ok: true, mensaje: "Aprobado correctamente" };
}

// ─── ACCIÓN: RECHAZAR ──────────────────────────────────────
function accionRechazar(body) {
  const session = body._session;
  if (!["ADMIN","SUPERADMIN"].includes(session.rol)) return { ok: false, error: "Acceso denegado" };

  const { colaboradorId, observaciones, areaId: reqAreaId } = body;
  if (!colaboradorId) return { ok: false, error: "ID de colaborador requerido" };
  if (!observaciones || observaciones.trim().length < 5) return { ok: false, error: "Las observaciones son obligatorias" };

  const areaIds = session.areaIds && session.areaIds.length ? session.areaIds : [session.areaId].filter(Boolean);
  const areaId  = session.rol === "SUPERADMIN"
    ? (reqAreaId ? String(reqAreaId) : areaIds[0])
    : (reqAreaId && areaIds.includes(String(reqAreaId)) ? String(reqAreaId) : areaIds[0]);
  if (!areaId) return { ok: false, error: "Área no autorizada" };

  const sheet = getSheet(SHEETS.APROBACIONES);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const colIdx = {};
  headers.forEach((h, i) => { colIdx[h] = i; });

  let filaExistente = -1;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][colIdx.COLABORADOR_ID]) === String(colaboradorId) &&
        String(data[i][colIdx.AREA_ID]) === String(areaId)) {
      filaExistente = i + 1; break;
    }
  }

  const timestamp = timestampActual();
  if (filaExistente > 0) {
    sheet.getRange(filaExistente, colIdx.ESTADO + 1).setValue("RECHAZADO");
    sheet.getRange(filaExistente, colIdx.OBSERVACIONES + 1).setValue(observaciones);
    sheet.getRange(filaExistente, colIdx.APROBADO_POR + 1).setValue(session.username);
    sheet.getRange(filaExistente, colIdx.FECHA_ACCION + 1).setValue(timestamp);
  } else {
    sheet.appendRow([generarId(), colaboradorId, areaId, "RECHAZADO", observaciones, session.username, timestamp]);
  }

  registrarLog(session.username, session.rol, "RECHAZAR", `Colaborador ID: ${colaboradorId} — Motivo: ${observaciones}`);
  return { ok: true, mensaje: "Rechazado correctamente" };
}

// ─── ACCIÓN: GET ALL COLABORADORES (SUPERADMIN) ────────────
function accionGetAllColaboradores(body) {
  const session = body._session;
  if (session.rol !== "SUPERADMIN") return { ok: false, error: "Acceso denegado" };

  const colaboradores = cachedObjects(SHEETS.COLABORADORES);
  const areas = cachedObjects(SHEETS.AREAS).filter(a => esTrue(a.ACTIVO));
  const aprobaciones = cachedObjects(SHEETS.APROBACIONES);
  const codigos = cachedObjects(SHEETS.CODIGOS);
  const usuarios = cachedObjects(SHEETS.USUARIOS);

  const aprobMap = {};
  aprobaciones.forEach(a => { aprobMap[String(a.COLABORADOR_ID) + "_" + String(a.AREA_ID)] = a; });
  const codigosSet = new Set(codigos.filter(cd => esTrue(cd.ACTIVO)).map(cd => String(cd.COLABORADOR_ID)));

  const resultado = colaboradores.map(c => {
    const areasDelColab  = getAreasRequeridas(c, areas);
    const areasOmitidas  = new Set(getAreaIdsDelColaborador(c.CEDULA, usuarios).map(String));
    const estadoPorArea  = areasDelColab.map(area => {
      if (areasOmitidas.has(String(area.ID))) {
        return { areaId: area.ID, areaNombre: area.NOMBRE, estado: "OMITIDO" };
      }
      const ap = aprobMap[String(c.ID) + "_" + String(area.ID)];
      return { areaId: area.ID, areaNombre: area.NOMBRE, estado: ap ? ap.ESTADO : "PENDIENTE" };
    });

    const areasReq = estadoPorArea.filter(a => a.estado !== "OMITIDO");
    const todasAprobadas = esTrue(c.REQUIERE_PAZ_SALVO) &&
      areasReq.length > 0 && areasReq.every(a => a.estado === "APROBADO");
    const tieneDocumento = todasAprobadas && codigosSet.has(String(c.ID));

    return {
      id: c.ID,
      nombre: c.NOMBRE,
      cedula: c.CEDULA,
      tipoColaborador: c.TIPO_COLABORADOR || "",
      nivelEducativo: c.NIVEL_EDUCATIVO || "",
      areasRequeridas: c.AREAS_REQUERIDAS || "",
      activo: esTrue(c.ACTIVO),
      requierePazSalvo: esTrue(c.REQUIERE_PAZ_SALVO),
      estadoGeneral: todasAprobadas ? "COMPLETO" : "PENDIENTE",
      tieneDocumento
    };
  });

  return { ok: true, colaboradores: resultado };
}

// ─── ACCIÓN: CREAR COLABORADOR ─────────────────────────────
function accionCrearColaborador(body) {
  const session = body._session;
  if (session.rol !== "SUPERADMIN") return { ok: false, error: "Acceso denegado" };

  const { nombre, cedula, requierePazSalvo, tipoColaborador, nivelEducativo, areasRequeridas } = body;
  if (!nombre || !cedula) return { ok: false, error: "Nombre y cédula son obligatorios" };

  const colaboradores = cachedObjects(SHEETS.COLABORADORES);
  if (colaboradores.find(c => String(c.CEDULA) === String(cedula))) {
    return { ok: false, error: "Ya existe un colaborador con esa cédula" };
  }

  const id = generarId();
  const sheet = getSheet(SHEETS.COLABORADORES);
  sheet.appendRow([id, nombre.trim(), cedula.trim(), "TRUE", requierePazSalvo ? "TRUE" : "FALSE", timestampActual()]);

  const hdrRow = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const hIdx = {};
  hdrRow.forEach((h, i) => { hIdx[String(h).trim()] = i + 1; });
  const lastRow = sheet.getLastRow();
  if (tipoColaborador !== undefined && hIdx.TIPO_COLABORADOR) sheet.getRange(lastRow, hIdx.TIPO_COLABORADOR).setValue(tipoColaborador || "");
  if (nivelEducativo  !== undefined && hIdx.NIVEL_EDUCATIVO)  sheet.getRange(lastRow, hIdx.NIVEL_EDUCATIVO).setValue(nivelEducativo || "");
  if (areasRequeridas !== undefined && hIdx.AREAS_REQUERIDAS) sheet.getRange(lastRow, hIdx.AREAS_REQUERIDAS).setValue(areasRequeridas || "");

  registrarLog(session.username, session.rol, "CREAR_COLABORADOR", `${nombre} (${cedula}) [${tipoColaborador || "sin tipo"}]`);
  return { ok: true, mensaje: "Colaborador creado correctamente", id };
}

// ─── ACCIÓN: EDITAR COLABORADOR ────────────────────────────
function accionEditarColaborador(body) {
  const session = body._session;
  if (session.rol !== "SUPERADMIN") return { ok: false, error: "Acceso denegado" };

  const { id, nombre, cedula, activo, tipoColaborador, nivelEducativo, areasRequeridas } = body;
  if (!id) return { ok: false, error: "ID requerido" };

  const sheet = getSheet(SHEETS.COLABORADORES);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const colIdx = {};
  headers.forEach((h, i) => { colIdx[String(h).trim()] = i; });

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][colIdx.ID]) === String(id)) {
      if (nombre) sheet.getRange(i + 1, colIdx.NOMBRE + 1).setValue(nombre.trim());
      if (cedula) sheet.getRange(i + 1, colIdx.CEDULA + 1).setValue(cedula.trim());
      if (activo !== undefined) sheet.getRange(i + 1, colIdx.ACTIVO + 1).setValue(activo ? "TRUE" : "FALSE");
      if (tipoColaborador !== undefined && colIdx.TIPO_COLABORADOR !== undefined)
        sheet.getRange(i + 1, colIdx.TIPO_COLABORADOR + 1).setValue(tipoColaborador || "");
      if (nivelEducativo !== undefined && colIdx.NIVEL_EDUCATIVO !== undefined)
        sheet.getRange(i + 1, colIdx.NIVEL_EDUCATIVO + 1).setValue(nivelEducativo || "");
      if (areasRequeridas !== undefined && colIdx.AREAS_REQUERIDAS !== undefined)
        sheet.getRange(i + 1, colIdx.AREAS_REQUERIDAS + 1).setValue(areasRequeridas || "");
      registrarLog(session.username, session.rol, "EDITAR_COLABORADOR", `ID: ${id} [${tipoColaborador || ""}]`);
      return { ok: true, mensaje: "Colaborador actualizado correctamente" };
    }
  }
  return { ok: false, error: "Colaborador no encontrado" };
}

// ─── ACCIÓN: TOGGLE PAZ Y SALVO ────────────────────────────
function accionTogglePazSalvo(body) {
  const session = body._session;
  if (session.rol !== "SUPERADMIN") return { ok: false, error: "Acceso denegado" };

  const { id, valor } = body;
  const sheet = getSheet(SHEETS.COLABORADORES);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const colIdx = {};
  headers.forEach((h, i) => colIdx[h] = i);

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][colIdx.ID]) === String(id)) {
      sheet.getRange(i + 1, colIdx.REQUIERE_PAZ_SALVO + 1).setValue(valor ? "TRUE" : "FALSE");
      registrarLog(session.username, session.rol, "TOGGLE_PAZ_SALVO",
        `ID: ${id} → ${valor ? "SÍ requiere" : "NO requiere"}`);
      return { ok: true, mensaje: "Actualizado correctamente" };
    }
  }
  return { ok: false, error: "Colaborador no encontrado" };
}

// ─── ACCIÓN: GET USUARIOS (SUPERADMIN) ────────────────────
function accionGetUsuarios(body) {
  const session = body._session;
  if (session.rol !== "SUPERADMIN") return { ok: false, error: "Acceso denegado" };

  const usuarios = cachedObjects(SHEETS.USUARIOS);
  const areasAll = cachedObjects(SHEETS.AREAS);
  const areaMap = {};
  areasAll.forEach(a => { areaMap[String(a.ID)] = a.NOMBRE; });

  const parseIds = v => String(v || "").split(",").map(s => s.trim()).filter(Boolean);

  const resultado = usuarios.map(u => {
    const ids = parseIds(u.AREA_ID);
    const nombres = ids.map(id => areaMap[id] || id);
    return {
      id: u.ID,
      username: u.USERNAME,
      rol: u.ROL,
      areaId: u.AREA_ID || "",
      areaNombre: nombres.join(", "),
      areaNombres: nombres,
      email: u.EMAIL || "",
      cedula: u.CEDULA || "",
      activo: esTrue(u.ACTIVO)
    };
  });

  return { ok: true, usuarios: resultado };
}

// ─── ACCIÓN: CREAR USUARIO ─────────────────────────────────
function accionCrearUsuario(body) {
  const session = body._session;
  if (session.rol !== "SUPERADMIN") return { ok: false, error: "Acceso denegado" };

  const { username, password, rol, areaId, email, cedula } = body;
  if (!username || !password || !rol) return { ok: false, error: "Campos obligatorios incompletos" };
  if (!["ADMIN", "COLABORADOR"].includes(rol)) return { ok: false, error: "Rol no válido" };
  if (password.length < 6) return { ok: false, error: "La contraseña debe tener al menos 6 caracteres" };

  const usuarios = cachedObjects(SHEETS.USUARIOS);
  if (usuarios.find(u => String(u.USERNAME).toLowerCase() === String(username).toLowerCase())) {
    return { ok: false, error: "El nombre de usuario ya existe" };
  }

  const id = generarId();
  const sheet = getSheet(SHEETS.USUARIOS);
  sheet.appendRow([id, username.trim(), hashPassword(password), rol, areaId || "", "TRUE", timestampActual()]);

  // Set email and cedula dynamically (columns may not exist in older sheets)
  const hdrRow = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const hIdx = {};
  hdrRow.forEach((h, i) => { hIdx[String(h).trim()] = i + 1; });
  const lastRow = sheet.getLastRow();
  if (email && hIdx.EMAIL) sheet.getRange(lastRow, hIdx.EMAIL).setValue(String(email).trim());
  if (cedula && hIdx.CEDULA) sheet.getRange(lastRow, hIdx.CEDULA).setValue(String(cedula).trim());

  registrarLog(session.username, session.rol, "CREAR_USUARIO", `${username} (${rol})`);
  return { ok: true, mensaje: "Usuario creado correctamente", id };
}

// ─── ACCIÓN: EDITAR USUARIO ────────────────────────────────
function accionEditarUsuario(body) {
  const session = body._session;
  if (session.rol !== "SUPERADMIN") return { ok: false, error: "Acceso denegado" };

  const { id, areaId, activo, nuevaPassword, email, cedula } = body;
  if (!id) return { ok: false, error: "ID requerido" };

  const sheet = getSheet(SHEETS.USUARIOS);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const colIdx = {};
  headers.forEach((h, i) => colIdx[String(h).trim()] = i);

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][colIdx.ID]) === String(id)) {
      if (areaId !== undefined) sheet.getRange(i + 1, colIdx.AREA_ID + 1).setValue(areaId);
      if (activo !== undefined) sheet.getRange(i + 1, colIdx.ACTIVO + 1).setValue(activo ? "TRUE" : "FALSE");
      if (nuevaPassword && nuevaPassword.length >= 6) {
        sheet.getRange(i + 1, colIdx.PASSWORD_HASH + 1).setValue(hashPassword(nuevaPassword));
      }
      if (email !== undefined && colIdx.EMAIL !== undefined) {
        sheet.getRange(i + 1, colIdx.EMAIL + 1).setValue(email || "");
      }
      if (cedula !== undefined && colIdx.CEDULA !== undefined) {
        sheet.getRange(i + 1, colIdx.CEDULA + 1).setValue(cedula ? String(cedula).trim() : "");
      }
      registrarLog(session.username, session.rol, "EDITAR_USUARIO", `ID: ${id}`);
      return { ok: true, mensaje: "Usuario actualizado correctamente" };
    }
  }
  return { ok: false, error: "Usuario no encontrado" };
}

// ─── ACCIÓN: GET CONFIG ────────────────────────────────────
function accionGetConfig(body) {
  const session = body._session;
  if (session.rol !== "SUPERADMIN") return { ok: false, error: "Acceso denegado" };
  return { ok: true, config: getTodasConfiguraciones() };
}

// ─── ACCIÓN: SET PROCESO ACTIVO ────────────────────────────
function accionSetProcesoActivo(body) {
  const session = body._session;
  if (session.rol !== "SUPERADMIN") return { ok: false, error: "Acceso denegado" };

  const valor = body.valor ? "TRUE" : "FALSE";
  setConfigValor("PROCESO_ACTIVO", valor);
  registrarLog(session.username, session.rol, "SET_PROCESO",
    `Proceso ${valor === "TRUE" ? "ACTIVADO" : "DESACTIVADO"}`);
  return { ok: true, mensaje: `Proceso ${valor === "TRUE" ? "activado" : "desactivado"} correctamente` };
}

// ─── ACCIÓN: GET VISTA GLOBAL ──────────────────────────────
function accionGetVistaGlobal(body) {
  const session = body._session;
  if (session.rol !== "SUPERADMIN") return { ok: false, error: "Acceso denegado" };

  const colaboradores = cachedObjects(SHEETS.COLABORADORES).filter(c => esTrue(c.ACTIVO));
  const areas = cachedObjects(SHEETS.AREAS).filter(a => esTrue(a.ACTIVO));
  const aprobaciones = cachedObjects(SHEETS.APROBACIONES);
  const usuarios = cachedObjects(SHEETS.USUARIOS);

  const aprobMap = {};
  aprobaciones.forEach(a => { aprobMap[String(a.COLABORADOR_ID) + "_" + String(a.AREA_ID)] = a; });

  const resultado = colaboradores.map(c => {
    const areasDelColab = new Set(getAreasRequeridas(c, areas).map(a => String(a.ID)));
    const areasOmitidas = new Set(getAreaIdsDelColaborador(c.CEDULA, usuarios).map(String));

    // Grid siempre muestra TODAS las áreas — NO_APLICA para las que no le corresponden
    const estadoPorArea = areas.map(area => {
      const areaId = String(area.ID);
      if (!areasDelColab.has(areaId)) {
        return { areaId: area.ID, areaNombre: area.NOMBRE, estado: "NO_APLICA", aprobadoPor: "", fecha: "" };
      }
      if (areasOmitidas.has(areaId)) {
        return { areaId: area.ID, areaNombre: area.NOMBRE, estado: "OMITIDO", aprobadoPor: "", fecha: "" };
      }
      const ap = aprobMap[String(c.ID) + "_" + areaId];
      return {
        areaId: area.ID, areaNombre: area.NOMBRE,
        estado: ap ? ap.ESTADO : "PENDIENTE",
        aprobadoPor: ap ? ap.APROBADO_POR : "",
        fecha: ap ? ap.FECHA_ACCION : ""
      };
    });

    const areasActivas = estadoPorArea.filter(a => a.estado !== "NO_APLICA" && a.estado !== "OMITIDO");
    const todasAprobadas = esTrue(c.REQUIERE_PAZ_SALVO) &&
      areasActivas.length > 0 && areasActivas.every(a => a.estado === "APROBADO");
    const pendientes = areasActivas.filter(a => a.estado !== "APROBADO").map(a => a.areaNombre);

    return {
      id: c.ID, nombre: c.NOMBRE, cedula: c.CEDULA,
      areaTrabajo: c.AREA_TRABAJO || "",
      requierePazSalvo: esTrue(c.REQUIERE_PAZ_SALVO),
      estadoPorArea,
      estadoGeneral: todasAprobadas ? "COMPLETO" : "PENDIENTE",
      pendientes
    };
  });

  return { ok: true, colaboradores: resultado, areas };
}

// ─── ACCIÓN: FORZAR PAZ Y SALVO (SUPERADMIN) ───────────────
// Aprueba TODAS las áreas activas del colaborador como si cada admin lo hubiera hecho.
function accionForzarPazSalvo(body) {
  const session = body._session;
  if (session.rol !== "SUPERADMIN") return { ok: false, error: "Acceso denegado" };

  const { colaboradorId } = body;
  if (!colaboradorId) return { ok: false, error: "ID de colaborador requerido" };

  const colaboradores = cachedObjects(SHEETS.COLABORADORES);
  const colaborador = colaboradores.find(c => String(c.ID) === String(colaboradorId));
  if (!colaborador) return { ok: false, error: "Colaborador no encontrado" };
  if (!esTrue(colaborador.ACTIVO)) return { ok: false, error: "El colaborador no está activo" };

  const areas = cachedObjects(SHEETS.AREAS).filter(a => esTrue(a.ACTIVO));
  if (!areas.length) return { ok: false, error: "No hay áreas activas configuradas" };

  const sheet   = getSheet(SHEETS.APROBACIONES);
  const data    = sheet.getDataRange().getValues();
  const headers = data[0];
  const colIdx  = {};
  headers.forEach((h, i) => { colIdx[h] = i; });

  const timestamp  = timestampActual();
  const aprobadoPor = session.username;
  let aprobadas = 0;

  areas.forEach(area => {
    let fila = -1;
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][colIdx.COLABORADOR_ID]) === String(colaboradorId) &&
          String(data[i][colIdx.AREA_ID])         === String(area.ID)) {
        fila = i + 1; break;
      }
    }
    if (fila > 0) {
      sheet.getRange(fila, colIdx.ESTADO        + 1).setValue("APROBADO");
      sheet.getRange(fila, colIdx.OBSERVACIONES + 1).setValue("");
      sheet.getRange(fila, colIdx.APROBADO_POR  + 1).setValue(aprobadoPor);
      sheet.getRange(fila, colIdx.FECHA_ACCION  + 1).setValue(timestamp);
    } else {
      sheet.appendRow([generarId(), colaboradorId, String(area.ID), "APROBADO", "", aprobadoPor, timestamp]);
    }
    aprobadas++;
  });

  registrarLog(session.username, session.rol, "FORZAR_PAZ_SALVO",
    `Colaborador: ${colaborador.NOMBRE} (ID: ${colaboradorId}) — ${aprobadas} área(s) aprobadas`);

  return { ok: true, mensaje: `Paz y salvo otorgado a ${colaborador.NOMBRE} en ${aprobadas} área(s)` };
}

// ─── ACCIÓN: GENERAR DOCUMENTO ─────────────────────────────
function accionGenerarDocumento(body) {
  const session = body._session;
  if (!["COLABORADOR", "ADMIN", "SUPERADMIN"].includes(session.rol)) {
    return { ok: false, error: "Acceso denegado" };
  }

  const { colaboradorId } = body;
  if (!colaboradorId) return { ok: false, error: "ID de colaborador requerido" };

  const colaboradores = cachedObjects(SHEETS.COLABORADORES);
  const colaborador = colaboradores.find(c => c.ID === colaboradorId);
  if (!colaborador) return { ok: false, error: "Colaborador no encontrado" };

  const areas = cachedObjects(SHEETS.AREAS).filter(a => esTrue(a.ACTIVO));
  const aprobaciones = cachedObjects(SHEETS.APROBACIONES);

  const usuarios = cachedObjects(SHEETS.USUARIOS);
  const areasDelColabG = getAreasRequeridas(colaborador, areas);
  const areasOmitidas  = new Set(getAreaIdsDelColaborador(colaborador.CEDULA, usuarios).map(String));

  const aprobadosSet = new Set(
    aprobaciones.filter(a => String(a.COLABORADOR_ID) === String(colaboradorId) && a.ESTADO === "APROBADO")
      .map(a => String(a.AREA_ID))
  );
  const areasRequeridas = areasDelColabG.filter(area => !areasOmitidas.has(String(area.ID)));
  const todasAprobadas = areasRequeridas.length > 0 && areasRequeridas.every(area => aprobadosSet.has(String(area.ID)));

  if (!todasAprobadas) {
    return { ok: false, error: "El colaborador no tiene todas las áreas aprobadas" };
  }

  // Buscar código existente para este colaborador en el año en curso
  const anoActual = new Date().getFullYear().toString();
  const codigos = cachedObjects(SHEETS.CODIGOS);
  let codigoExistente = codigos.find(c =>
    String(c.COLABORADOR_ID) === String(colaboradorId) &&
    esTrue(c.ACTIVO) &&
    _anioFecha(c.FECHA_EMISION) === anoActual
  );

  let codigoVerificacion;
  let fechaEmisionCodigo;
  if (codigoExistente) {
    codigoVerificacion  = codigoExistente.CODIGO;
    fechaEmisionCodigo  = _strFecha(codigoExistente.FECHA_EMISION);
  } else {
    fechaEmisionCodigo  = timestampActual();
    codigoVerificacion  = "PSG-" + String(colaborador.CEDULA).slice(-4) + "-" +
      Math.random().toString(36).substring(2, 7).toUpperCase();
    getSheet(SHEETS.CODIGOS).appendRow([
      generarId(), codigoVerificacion, colaboradorId, fechaEmisionCodigo, "TRUE"
    ]);
    _invalidate(SHEETS.CODIGOS);
  }

  const aprobMap2 = {};
  aprobaciones.forEach(a => { aprobMap2[String(a.COLABORADOR_ID) + "_" + String(a.AREA_ID)] = a; });

  const detalleAreas = areasRequeridas.map(area => {
    const ap = aprobMap2[String(colaboradorId) + "_" + String(area.ID)];
    return { nombre: area.NOMBRE, responsable: ap ? ap.APROBADO_POR : "", fecha: ap ? ap.FECHA_ACCION : "" };
  });

  registrarLog(session.username, session.rol, "GENERAR_DOCUMENTO",
    `Colaborador: ${colaborador.NOMBRE} (${colaborador.CEDULA}) - Código: ${codigoVerificacion}`);

  return {
    ok: true,
    documento: {
      colaboradorId,
      nombre: colaborador.NOMBRE,
      cedula: colaborador.CEDULA,
      codigoVerificacion,
      fechaEmision: fechaEmisionCodigo,
      areas: detalleAreas
    }
  };
}

// ─── ACCIÓN: VERIFICAR CÓDIGO ──────────────────────────────
function accionVerificarCodigo(body) {
  const { codigo } = body;
  if (!codigo) return { ok: false, error: "Código requerido" };

  const codigos = cachedObjects(SHEETS.CODIGOS);
  const entrada = codigos.find(c =>
    String(c.CODIGO).toUpperCase() === String(codigo).toUpperCase() &&
    esTrue(c.ACTIVO)
  );

  if (!entrada) {
    return { ok: false, valido: false, mensaje: "Código no válido o inexistente" };
  }

  const colaboradores = cachedObjects(SHEETS.COLABORADORES);
  const colaborador = colaboradores.find(c => String(c.ID) === String(entrada.COLABORADOR_ID));

  if (!colaborador) return { ok: false, valido: false, mensaje: "Datos no encontrados" };

  registrarLog("PÚBLICO", "VERIFICACION", "VERIFICAR_CODIGO", `Código: ${codigo}`);

  return {
    ok: true,
    valido: true,
    datos: {
      nombre: colaborador.NOMBRE,
      cedula: colaborador.CEDULA,
      estado: "PAZ Y SALVO COMPLETO",
      fechaEmision: entrada.FECHA_EMISION,
      codigo: entrada.CODIGO
    }
  };
}

// ─── ACCIÓN: GET AREAS ─────────────────────────────────────
function accionGetAreas(body) {
  const areas = cachedObjects(SHEETS.AREAS)
    .filter(a => esTrue(a.ACTIVO))
    .map(a => ({ id: a.ID, nombre: a.NOMBRE, tipo: String(a.TIPO || "GENERAL").toUpperCase().trim() }));
  return { ok: true, areas };
}

// ─── ACCIÓN: GET LOGS ──────────────────────────────────────
function accionGetLogs(body) {
  const session = body._session;
  if (session.rol !== "SUPERADMIN") return { ok: false, error: "Acceso denegado" };

  const logs = cachedObjects(SHEETS.LOGS);
  const resultado = logs.reverse().slice(0, 200).map(l => ({
    timestamp: l.TIMESTAMP,
    usuario: l.USUARIO,
    rol: l.ROL,
    accion: l.ACCION,
    detalle: l.DETALLE
  }));

  return { ok: true, logs: resultado };
}

// ─── UTILIDADES DE CONFIG ──────────────────────────────────
function getConfigValor(clave) {
  const sheet = getSheet(SHEETS.CONFIG);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === clave) return String(data[i][1]);
  }
  return null;
}

function setConfigValor(clave, valor) {
  const sheet = getSheet(SHEETS.CONFIG);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === clave) {
      sheet.getRange(i + 1, 2).setValue(valor);
      return;
    }
  }
  sheet.appendRow([clave, valor]);
}

function getTodasConfiguraciones() {
  const sheet = getSheet(SHEETS.CONFIG);
  const data = sheet.getDataRange().getValues();
  const config = {};
  for (let i = 1; i < data.length; i++) {
    config[data[i][0]] = data[i][1];
  }
  return config;
}

// Devuelve todos los AREA_IDs que gestiona un admin.
// Soporta: (1) AREA_ID con múltiples valores separados por coma,
//          (2) múltiples cuentas con el mismo EMAIL.
function getAreaIdsDelAdmin(usuario, todosUsuarios) {
  const email = String(usuario.EMAIL || "").toLowerCase().trim();
  const parseIds = v => String(v || "").split(",").map(s => s.trim()).filter(Boolean);

  if (!email) return parseIds(usuario.AREA_ID);

  const ids = [];
  todosUsuarios
    .filter(u => u.ROL === "ADMIN" && esTrue(u.ACTIVO) &&
                 String(u.EMAIL || "").toLowerCase().trim() === email)
    .forEach(u => parseIds(u.AREA_ID).forEach(id => ids.push(id)));
  return [...new Set(ids)];
}

// Retorna las áreas activas que aplican a este colaborador según su tipo.
//
// DOCENTE       → áreas fijas + coordinador según nivel + área académica propia (AREAS_REQUERIDAS)
// ADMINISTRATIVO → áreas fijas + jefe inmediato dinámico (AREAS_REQUERIDAS: Andrea/TH, David/JefeÁrea, Doña Sonia/CoordAdm)
// SERVICIOS     → áreas fijas con Jefe de Área Y Restaurante fijos (misma persona, dos registros separados)
// Sin tipo      → todas (compatibilidad con registros sin migrar)
function getAreasRequeridas(colaborador, areas) {
  const tipo      = String(colaborador.TIPO_COLABORADOR || "").toUpperCase().trim();
  const nivel     = String(colaborador.NIVEL_EDUCATIVO  || "").toUpperCase().trim();
  const jefeId    = String(colaborador.AREAS_REQUERIDAS || "").trim(); // ID del área del jefe/área académica

  let nombresReq = null;

  if (tipo === "DOCENTE") {
    nombresReq = new Set([
      "Secretaría Académica", "Responsable de Tecnología", "Responsable de Biblioteca",
      "Coord. General de Convivencia", "Restaurante", "Rectora"
    ]);
    if (nivel === "PREESCOLAR")    nombresReq.add("Coord. Preescolar");
    else if (nivel === "PRIMARIA") nombresReq.add("Coord. Académica Primaria");
    else                           nombresReq.add("Coord. General Académica"); // BACHILLERATO o sin nivel

  } else if (tipo === "ADMINISTRATIVO") {
    // "Jefe de Área" NO está en la lista fija — se asigna dinámicamente por colaborador
    // (Andrea → Talento Humano, David → Jefe de Área genérico, Doña Sonia → Coord. Administrativa)
    nombresReq = new Set([
      "Secretaría Académica", "Responsable de Tecnología", "Responsable de Biblioteca",
      "Restaurante", "Coord. Administrativa", "Rectora"
    ]);

  } else if (tipo === "SERVICIOS") {
    // Jefe de Área = misma persona que administra Restaurante → ambas áreas van fijas
    // El sistema las trata como dos aprobaciones independientes; OMITIDO previene auto-aprobación.
    nombresReq = new Set([
      "Responsable de Tecnología", "Responsable de Biblioteca",
      "Jefe de Área", "Restaurante", "Rectora"
    ]);

  } else {
    return areas; // sin tipo → todas (registros sin migrar)
  }

  const resultado = areas.filter(a => nombresReq.has(String(a.NOMBRE || "").trim()));

  // DOCENTE y ADMINISTRATIVO: agregar el área del jefe asignado dinámicamente.
  // Se evitan duplicados por ID (ej. si Doña Sonia = Coord. Administrativa ya está en el fijo).
  if ((tipo === "DOCENTE" || tipo === "ADMINISTRATIVO") && jefeId) {
    const areaJefe = areas.find(a => String(a.ID) === jefeId);
    if (areaJefe && !resultado.find(r => String(r.ID) === jefeId)) {
      resultado.push(areaJefe);
    }
  }

  return resultado;
}

// Devuelve los AREA_IDs que administra este colaborador (por su cédula en USUARIOS).
// Si su cédula está en USUARIOS como ADMIN, sus áreas se marcan OMITIDO (no se auto-aprueban).
function getAreaIdsDelColaborador(cedula, usuarios) {
  if (!cedula) return [];
  const norm = v => String(v).trim().replace(/\D/g, "").replace(/^0+/, "");
  const cedulaNorm = norm(cedula);
  const ids = [];
  usuarios
    .filter(u => u.ROL === "ADMIN" && esTrue(u.ACTIVO) && u.CEDULA)
    .forEach(u => {
      if (norm(String(u.CEDULA)) === cedulaNorm) {
        String(u.AREA_ID || "").split(",").map(s => s.trim()).filter(Boolean).forEach(id => ids.push(id));
      }
    });
  return [...new Set(ids)];
}

function getNombreArea(areaId) {
  if (!areaId) return "";
  const ids = String(areaId).split(",").map(s => s.trim()).filter(Boolean);
  if (!ids.length) return "";
  const areas = cachedObjects(SHEETS.AREAS);
  const names = ids.map(id => { const a = areas.find(x => String(x.ID) === id); return a ? a.NOMBRE : ""; }).filter(Boolean);
  return names.join(", ");
}

// ─── DIAGNÓSTICO: APROBACIONES vs AREAS ─────────────────────
// Muestra si los AREA_IDs en USUARIOS y APROBACIONES coinciden con AREAS.ID.
// Si hay huérfanos → correr reparar_area_ids.
function accionDiagnosticoAprobaciones(body) {
  const session = body._session;
  if (session.rol !== "SUPERADMIN") return { ok: false, error: "Acceso denegado" };

  const { colaboradorId } = body;
  const areas        = cachedObjects(SHEETS.AREAS);
  const areasActivas = areas.filter(a => esTrue(a.ACTIVO));
  const areaIdSet    = new Set(areasActivas.map(a => String(a.ID).trim()));

  const todasAprobaciones = cachedObjects(SHEETS.APROBACIONES);
  const aprobaciones      = colaboradorId
    ? todasAprobaciones.filter(a => String(a.COLABORADOR_ID).trim() === String(colaboradorId).trim())
    : todasAprobaciones;
  const usuarios = cachedObjects(SHEETS.USUARIOS);

  // ¿Tienen los admins un AREA_ID que exista en AREAS?
  const admins = usuarios.filter(u => u.ROL === "ADMIN" && esTrue(u.ACTIVO));
  const adminsCheck = admins.map(u => {
    const uid = String(u.AREA_ID || "").trim();
    const existe = uid && areaIdSet.has(uid);
    return {
      username:       u.USERNAME,
      areaIdUsuarios: uid || "(vacío)",
      existeEnAreas:  existe,
      areaNombre:     existe ? (areasActivas.find(a => String(a.ID).trim() === uid) || {}).NOMBRE : "❌ NO ENCONTRADO"
    };
  });

  // Estado por área activa para el colaborador dado
  const estadoPorArea = areasActivas.map(area => {
    const ap = aprobaciones.find(a => String(a.AREA_ID).trim() === String(area.ID).trim());
    return {
      areaNombre:     area.NOMBRE,
      areaId:         area.ID,
      tieneAprobacion: !!ap,
      estado:          ap ? ap.ESTADO : "SIN REGISTRO",
      aprobadoPor:     ap ? ap.APROBADO_POR : ""
    };
  });

  // Aprobaciones con AREA_ID que no existe en ningún área activa
  const seen = {};
  aprobaciones.forEach(a => {
    const k = String(a.AREA_ID).trim();
    if (!seen[k]) seen[k] = { areaId: k, aprobadoPor: a.APROBADO_POR, cantidad: 0 };
    seen[k].cantidad++;
  });
  const huerfanos = Object.values(seen).filter(x => !areaIdSet.has(x.areaId));

  const hayProblema = adminsCheck.some(a => !a.existeEnAreas) || huerfanos.length > 0;

  return {
    ok: true,
    resumen: {
      colaboradorId:           colaboradorId || "TODOS",
      areasActivasCount:       areasActivas.length,
      aprobacionesCount:       aprobaciones.length,
      adminsConAreaIdInvalido: adminsCheck.filter(a => !a.existeEnAreas).length,
      aprobacionesHuerfanas:   huerfanos.length,
      problema:                hayProblema
        ? "❌ IDs desincronizados — ejecutar accion reparar_area_ids"
        : "✅ IDs consistentes — el problema es otro",
      adminsCheck,
      estadoPorArea,
      huerfanos
    }
  };
}

// ─── SINCRONIZACIÓN COMPLETA DE IDs ─────────────────────────
// Correr desde el editor de GAS: Run > sincronizarTodo
// No requiere login. Resuelve cualquier desincronización de AREA_IDs.
// Estrategia: usa APROBADO_POR (username del admin que aprobó) para
// encontrar el AREA_ID correcto — más confiable que mapear IDs viejos a nuevos.
function sincronizarTodo() {
  const lineas = [];
  const log = msg => { Logger.log(msg); lineas.push(msg); };

  // Paso 1: AREAS como fuente de verdad
  const areas      = sheetToObjects(getSheet(SHEETS.AREAS)).filter(a => esTrue(a.ACTIVO));
  const areaIdSet  = new Set(areas.map(a => String(a.ID)));
  const nombreToId = {};
  areas.forEach(a => { nombreToId[a.NOMBRE.trim()] = String(a.ID); });
  log("ÁREAS ACTIVAS: " + areas.length);
  areas.forEach(a => log("  • " + a.NOMBRE + " → " + a.ID));

  // Paso 2: Mapeo username → nombre de área
  const USR_AREA = {
    "sec.academica":     "Secretaría Académica",
    "resp.tecnologia":   "Responsable de Tecnología",
    "resp.biblioteca":   "Responsable de Biblioteca",
    "coord.preescolar":  "Coord. Preescolar",
    "coord.convivencia": "Coord. General de Convivencia",
    "coord.academica":   "Coord. General Académica",
    "coord.primaria":    "Coord. Académica Primaria",
    "jefe.area":         "Jefe de Área",
    "administradora":    "Restaurante",
    "coord.adm":         "Coord. Administrativa",
    "rectora":           "Rectora",
    "talento.humano":    "Talento Humano"
  };

  // Paso 3: Corregir USUARIOS.AREA_ID para admins
  const usuSheet = getSheet(SHEETS.USUARIOS);
  const usuData  = usuSheet.getDataRange().getValues();
  const uC       = {};
  usuData[0].forEach((h, i) => { uC[String(h).trim()] = i; });

  const usernameToAreaId = {}; // username → ID correcto (para reparar APROBACIONES)
  let usuFixes = 0;

  for (let i = 1; i < usuData.length; i++) {
    if (usuData[i][uC.ROL] !== "ADMIN") continue;
    const username   = String(usuData[i][uC.USERNAME]).trim().toLowerCase();
    const areaNombre = USR_AREA[username];
    if (!areaNombre) { log("⚠️ Admin sin mapeo: " + username + " — actualiza AREA_ID manualmente"); continue; }

    const newId = nombreToId[areaNombre];
    if (!newId) { log("⚠️ Área '" + areaNombre + "' no existe en AREAS para admin: " + username); continue; }

    usernameToAreaId[username] = newId;
    const oldId = String(usuData[i][uC.AREA_ID] || "").trim();
    if (oldId !== newId) {
      usuSheet.getRange(i + 1, uC.AREA_ID + 1).setValue(newId);
      usuFixes++;
      log("✅ USUARIO " + username + ": " + (oldId || "(vacío)") + " → " + newId);
    }
  }

  // Paso 4: Corregir APROBACIONES usando APROBADO_POR como clave
  const aprobSheet = getSheet(SHEETS.APROBACIONES);
  const aprobData  = aprobSheet.getDataRange().getValues();
  const aC         = {};
  aprobData[0].forEach((h, i) => { aC[String(h).trim()] = i; });

  let aprobFixes = 0, aprobOk = 0, aprobSinResolver = 0;

  for (let i = 1; i < aprobData.length; i++) {
    const curId = String(aprobData[i][aC.AREA_ID] || "").trim();
    if (areaIdSet.has(curId)) { aprobOk++; continue; }

    const aprobadoPor = String(aprobData[i][aC.APROBADO_POR] || "").toLowerCase().trim();
    const newId       = usernameToAreaId[aprobadoPor];

    if (newId) {
      aprobSheet.getRange(i + 1, aC.AREA_ID + 1).setValue(newId);
      aprobFixes++;
      log("✅ APROBACION fila " + (i + 1) + ": " + curId.substring(0,8) + "... → " + newId.substring(0,8) + "... (por " + aprobadoPor + ")");
    } else {
      aprobSinResolver++;
      log("⚠️ APROBACION fila " + (i + 1) + ": no resuelta. AREA_ID=" + curId.substring(0,8) + " APROBADO_POR=" + aprobadoPor);
    }
  }

  log("═══════════════════════════════════════");
  log("USUARIOS reparados:        " + usuFixes);
  log("APROBACIONES ya correctas: " + aprobOk);
  log("APROBACIONES reparadas:    " + aprobFixes);
  log("APROBACIONES sin resolver: " + aprobSinResolver);
  if (aprobSinResolver > 0) log("⚠️ Las filas sin resolver: el admin debe volver a aprobar desde la app.");
  log("═══════════════════════════════════════");
}

// Wrapper HTTP para llamar desde la app (SUPERADMIN)
function accionRepararAreaIds(body) {
  const session = body._session;
  if (session.rol !== "SUPERADMIN") return { ok: false, error: "Solo SUPERADMIN puede ejecutar esto" };
  try {
    sincronizarTodo();
    return { ok: true, mensaje: "Sincronización completada — revisa Logs en el editor de GAS para el detalle." };
  } catch(e) {
    return { ok: false, error: e.message };
  }
}

// ─── ACCIÓN: GET ESTADO COLABORADOR (ADMIN/SA) ─────────────
// Retorna el estado de TODAS las áreas para un colaborador por ID.
// Usado por el panel de gestión para ver el panorama completo.
function accionGetEstadoColaborador(body) {
  const session = body._session;
  if (!["ADMIN","SUPERADMIN"].includes(session.rol)) return { ok: false, error: "Acceso denegado" };

  const { colaboradorId } = body;
  if (!colaboradorId) return { ok: false, error: "ID de colaborador requerido" };

  const colaboradores = cachedObjects(SHEETS.COLABORADORES);
  const colaborador   = colaboradores.find(c => String(c.ID) === String(colaboradorId));
  if (!colaborador) return { ok: false, error: "Colaborador no encontrado" };

  const areas        = cachedObjects(SHEETS.AREAS).filter(a => esTrue(a.ACTIVO));
  const aprobaciones = cachedObjects(SHEETS.APROBACIONES);
  const usuarios     = cachedObjects(SHEETS.USUARIOS);

  const aprobMap = {};
  aprobaciones.forEach(a => { aprobMap[String(a.COLABORADOR_ID) + "_" + String(a.AREA_ID)] = a; });

  const todasAreas2   = areas; // ya filtradas por esTrue(ACTIVO)
  const areasDelColab = getAreasRequeridas(colaborador, todasAreas2);
  const areasOmitidas = new Set(getAreaIdsDelColaborador(colaborador.CEDULA, usuarios).map(String));

  const estadoPorArea = areasDelColab.map(area => {
    if (areasOmitidas.has(String(area.ID))) {
      return { areaId: area.ID, areaNombre: area.NOMBRE, estado: "OMITIDO",
               aprobadoPor: "", fecha: "", adminUsername: null, adminEmail: "" };
    }
    const ap = aprobMap[String(colaboradorId) + "_" + String(area.ID)];
    const adminDeArea = usuarios.find(u => {
      const uAreas = String(u.AREA_ID || "").split(",").map(s => s.trim());
      return uAreas.includes(String(area.ID)) && u.ROL === "ADMIN" && esTrue(u.ACTIVO);
    });
    return {
      areaId: area.ID, areaNombre: area.NOMBRE,
      estado:       ap ? ap.ESTADO : "PENDIENTE",
      aprobadoPor:  ap ? ap.APROBADO_POR : "",
      fecha:        ap ? ap.FECHA_ACCION : "",
      adminUsername: adminDeArea ? adminDeArea.USERNAME : null,
      adminEmail:    adminDeArea ? (adminDeArea.EMAIL || "") : ""
    };
  });

  const areasRequeridas = estadoPorArea.filter(a => a.estado !== "OMITIDO");
  const todasAprobadas = esTrue(colaborador.REQUIERE_PAZ_SALVO) &&
    areasRequeridas.length > 0 && areasRequeridas.every(a => a.estado === "APROBADO");

  return {
    ok: true,
    colaborador: { id: colaborador.ID, nombre: colaborador.NOMBRE, cedula: colaborador.CEDULA },
    estadoPorArea,
    pazYSalvoCompleto: todasAprobadas,
    requierePazSalvo:  esTrue(colaborador.REQUIERE_PAZ_SALVO)
  };
}

// ─── ACCIÓN: ENVIAR RECORDATORIO A ÁREAS PENDIENTES ─────────
// ADMIN/SUPERADMIN: pasan colaboradorId
// COLABORADOR: pasa cedula (envía el recordatorio para sí mismo)
function accionEnviarRecordatorio(body) {
  const session = body._session;
  if (!["COLABORADOR","ADMIN","SUPERADMIN"].includes(session.rol)) return { ok: false, error: "Acceso denegado" };

  const colaboradores = cachedObjects(SHEETS.COLABORADORES);
  let colaborador;

  if (session.rol === "COLABORADOR") {
    const cedula = String(body.cedula || "").trim();
    if (!cedula) return { ok: false, error: "Cédula requerida" };
    const norm = v => String(v).trim().replace(/\D/g,"").replace(/^0+/,"");
    colaborador = colaboradores.find(c => norm(c.CEDULA) === norm(cedula) && esTrue(c.ACTIVO));
    if (!colaborador) return { ok: false, error: "Colaborador no encontrado" };
  } else {
    const { colaboradorId } = body;
    if (!colaboradorId) return { ok: false, error: "ID de colaborador requerido" };
    colaborador = colaboradores.find(c => String(c.ID) === String(colaboradorId));
    if (!colaborador) return { ok: false, error: "Colaborador no encontrado" };
  }

  const areas        = cachedObjects(SHEETS.AREAS).filter(a => esTrue(a.ACTIVO));
  const aprobaciones = cachedObjects(SHEETS.APROBACIONES);
  const usuarios     = cachedObjects(SHEETS.USUARIOS);
  const institucion  = getConfigValor("INSTITUCION_NOMBRE") || "Colegio Campestre Goyavier";

  const areasDelColabR = getAreasRequeridas(colaborador, areas);
  const aprobSet = new Set(
    aprobaciones
      .filter(a => String(a.COLABORADOR_ID) === String(colaborador.ID) && a.ESTADO === "APROBADO")
      .map(a => String(a.AREA_ID))
  );
  const areasOmitidas = new Set(getAreaIdsDelColaborador(colaborador.CEDULA, usuarios).map(String));
  const areasPendientes = areasDelColabR.filter(area =>
    !aprobSet.has(String(area.ID)) && !areasOmitidas.has(String(area.ID))
  );

  if (!areasPendientes.length) {
    return { ok: false, error: "El colaborador ya tiene todas las áreas aprobadas (o gestionadas)" };
  }

  let enviados = 0;
  const errores = [];
  const nombresEnviados = [];

  areasPendientes.forEach(area => {
    const adminArea = usuarios.find(u => {
      const uAreas = String(u.AREA_ID || "").split(",").map(s => s.trim());
      return uAreas.includes(String(area.ID)) && u.ROL === "ADMIN" && esTrue(u.ACTIVO) && u.EMAIL;
    });
    if (!adminArea || !adminArea.EMAIL) {
      errores.push(area.NOMBRE + ": sin administrador con correo registrado");
      return;
    }
    const asunto =
      "⏳ Paz y Salvo Pendiente — " + colaborador.NOMBRE + " · " + institucion;
    const cuerpo =
      "Estimado/a administrador/a del área " + area.NOMBRE + ",\n\n" +
      "Le informamos que el/la colaborador/a " + colaborador.NOMBRE +
      " (C.C. " + colaborador.CEDULA + ") tiene pendiente la aprobación de paz y salvo " +
      "en su área.\n\n" +
      "Por favor ingrese al sistema y procese la aprobación, o indique al colaborador " +
      "los pasos a seguir para quedar a paz y salvo en su área.\n\n" +
      "— Sistema de Paz y Salvo · " + institucion;
    try {
      MailApp.sendEmail(adminArea.EMAIL, asunto, cuerpo);
      enviados++;
      nombresEnviados.push(area.NOMBRE);
    } catch(e) {
      errores.push(area.NOMBRE + ": " + e.message);
    }
  });

  registrarLog(session.username, session.rol, "ENVIAR_RECORDATORIO",
    "Colaborador: " + colaborador.NOMBRE +
    " | Áreas: " + areasPendientes.map(a => a.NOMBRE).join(", ") +
    " | Enviados: " + enviados);

  return {
    ok: true,
    mensaje: "Recordatorio enviado a " + enviados + " área(s)" +
      (errores.length ? " — " + errores.length + " sin correo" : ""),
    areasPendientes: areasPendientes.map(a => ({
      nombre:  a.NOMBRE,
      enviado: nombresEnviados.includes(a.NOMBRE)
    })),
    errores
  };
}

// ─── SETUP INICIAL (ejecutar UNA sola vez) ─────────────────
function setupInicialSistema() {
  const ss = SpreadsheetApp.openById(SHEET_ID);

  const estructura = {
    COLABORADORES: ["ID", "NOMBRE", "CEDULA", "ACTIVO", "REQUIERE_PAZ_SALVO", "FECHA_CREACION"],
    USUARIOS:      ["ID", "USERNAME", "PASSWORD_HASH", "ROL", "AREA_ID", "ACTIVO", "FECHA_CREACION", "EMAIL", "CEDULA"],
    AREAS:         ["ID", "NOMBRE", "DESCRIPCION", "ACTIVO", "TIPO"],
    APROBACIONES:  ["ID", "COLABORADOR_ID", "AREA_ID", "ESTADO", "OBSERVACIONES", "APROBADO_POR", "FECHA_ACCION"],
    CODIGOS_VERIFICACION: ["ID", "CODIGO", "COLABORADOR_ID", "FECHA_EMISION", "ACTIVO"],
    LOGS:          ["ID", "TIMESTAMP", "USUARIO", "ROL", "ACCION", "DETALLE"],
    CONFIG:        ["CLAVE", "VALOR"],
    SESIONES:      ["TOKEN", "USUARIO_ID", "USERNAME", "ROL", "AREA_ID", "EXPIRA"]
  };

  Object.entries(estructura).forEach(([nombre, headers]) => {
    let sheet = ss.getSheetByName(nombre);
    if (!sheet) {
      sheet = ss.insertSheet(nombre);
    }
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length)
      .setBackground("#1a1a2e")
      .setFontColor("#ffffff")
      .setFontWeight("bold");
  });

  const configSheet = ss.getSheetByName("CONFIG");
  configSheet.appendRow(["PROCESO_ACTIVO", "TRUE"]);
  configSheet.appendRow(["INSTITUCION_NOMBRE", "Colegio Campestre Goyavier"]);
  configSheet.appendRow(["VERSION", "1.0"]);

  const usuariosSheet = ss.getSheetByName("USUARIOS");
  usuariosSheet.appendRow([
    generarId(), "superadmin", hashPassword("Admin2026#"), "SUPERADMIN", "", "TRUE", timestampActual()
  ]);

  Logger.log("✅ Setup completado. Usuario: superadmin / Contraseña: Admin2026#");
  Logger.log("⚠️ CAMBIA LA CONTRASEÑA INMEDIATAMENTE DESPUÉS DEL PRIMER ACCESO");
}

// ─── SETUP COMPLETO: ÁREAS + ADMINS (ejecutar una sola vez) ──
// Crea las 11 áreas y un usuario ADMIN por área con contraseña temporal.
// Contraseña inicial: Goyavier2026#  ← cámbiala después desde la app.
function setupAreasYAdmins() {
  setupAreas();

  const usersSheet = getSheet(SHEETS.USUARIOS);
  const areas      = sheetToObjects(getSheet(SHEETS.AREAS));
  const existentes = sheetToObjects(usersSheet).map(u => String(u.USERNAME).trim().toLowerCase());

  const admins = [
    { username: "sec.academica",      areaNombre: "Secretaría Académica"          },
    { username: "resp.tecnologia",    areaNombre: "Responsable de Tecnología"     },
    { username: "resp.biblioteca",    areaNombre: "Responsable de Biblioteca"     },
    { username: "coord.preescolar",   areaNombre: "Coord. Preescolar"             },
    { username: "coord.convivencia",  areaNombre: "Coord. General de Convivencia" },
    { username: "coord.academica",    areaNombre: "Coord. General Académica"      },
    { username: "coord.primaria",     areaNombre: "Coord. Académica Primaria"     },
    { username: "jefe.area",          areaNombre: "Jefe de Área"                  },
    { username: "administradora",     areaNombre: "Restaurante"                   },
    { username: "coord.adm",          areaNombre: "Coord. Administrativa"         },
    { username: "rectora",            areaNombre: "Rectora"                       },
    { username: "talento.humano",     areaNombre: "Talento Humano"                },
  ];

  const PASSWORD_TEMP = "Goyavier2026#";
  let creados = 0, omitidos = 0;

  admins.forEach(({ username, areaNombre }) => {
    const area = areas.find(a => String(a.NOMBRE).trim() === areaNombre);
    if (!area) { Logger.log("⚠️ Área no encontrada: " + areaNombre); return; }

    if (existentes.includes(username.toLowerCase())) {
      Logger.log("↩️ Ya existe: " + username);
      omitidos++; return;
    }

    usersSheet.appendRow([
      generarId(), username, hashPassword(PASSWORD_TEMP),
      "ADMIN", area.ID, "TRUE", timestampActual()
    ]);
    creados++;
    Logger.log("✅ Creado: " + username + " → " + areaNombre);
  });

  Logger.log("─────────────────────────────────────────");
  Logger.log("Admins creados: " + creados + " | Omitidos (ya existían): " + omitidos);
  Logger.log("Contraseña temporal: " + PASSWORD_TEMP);
  Logger.log("⚠️ Cambia las contraseñas desde Superadmin → Usuarios una vez ingresen.");
}

// ─── SETUP ÁREAS (ejecutar para reemplazar todas las áreas) ──
function setupAreas() {
  const sheet = getSheet(SHEETS.AREAS);

  // Borrar todas las filas de datos (mantiene encabezado en fila 1)
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) sheet.deleteRows(2, lastRow - 1);

  // Detectar si la columna TIPO ya existe en el encabezado
  const hdrExist = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0].map(h => String(h).trim());
  const tieneHeader = hdrExist.some(h => h === "NOMBRE");
  const tieneTipo   = hdrExist.some(h => h === "TIPO");
  if (!tieneHeader) {
    // Hoja completamente vacía → agregar encabezado completo
    sheet.appendRow(["ID", "NOMBRE", "DESCRIPCION", "ACTIVO", "TIPO"]);
  } else if (!tieneTipo) {
    // Encabezado viejo sin TIPO → agregar la columna
    sheet.getRange(1, hdrExist.length + 1).setValue("TIPO");
  }

  const areas = [
    ["Secretaría Académica",          "Secretaría y gestión académica",                    "GENERAL"      ],
    ["Responsable de Tecnología",     "Área de tecnología e infraestructura",               "GENERAL"      ],
    ["Responsable de Biblioteca",     "Gestión de biblioteca y recursos",                   "GENERAL"      ],
    ["Coord. Preescolar",             "Coordinación de preescolar",                         "GENERAL"      ],
    ["Coord. General de Convivencia", "Coordinación de convivencia escolar",                "GENERAL"      ],
    ["Coord. General Académica",      "Coordinación académica general",                     "GENERAL"      ],
    ["Coord. Académica Primaria",     "Coordinación académica de primaria",                 "GENERAL"      ],
    ["Jefe de Área",                  "Jefatura de área docente",                           "GENERAL"      ],
    ["Restaurante",                   "Área de restaurante y alimentación",                 "GENERAL"      ],
    ["Coord. Administrativa",         "Coordinación administrativa",                        "GENERAL"      ],
    ["Rectora",                       "Rectoría del colegio",                               "GENERAL"      ],
    ["Talento Humano",                "Gestión de talento humano y nómina",                 "GENERAL"      ],
    ["Matemáticas",                   "Coordinación Área de Matemáticas",                   "DEPARTAMENTAL"],
    ["Lenguaje",                      "Coordinación Área de Lenguaje",                      "DEPARTAMENTAL"],
    ["Ciencias Sociales",             "Coordinación Área de Ciencias Sociales",             "DEPARTAMENTAL"],
    ["Ciencias Naturales",            "Coordinación Área de Ciencias Naturales",            "DEPARTAMENTAL"],
    ["Inglés",                        "Coordinación Área de Inglés",                        "DEPARTAMENTAL"],
    ["Artes",                         "Coordinación Área de Artes",                         "DEPARTAMENTAL"],
    ["Tecnología e Informática",      "Coordinación Área de Tecnología e Informática",      "DEPARTAMENTAL"],
    ["Educación Física",              "Coordinación Área de Educación Física",              "DEPARTAMENTAL"],
  ];

  areas.forEach(([nombre, desc, tipo]) => {
    sheet.appendRow([generarId(), nombre, desc, "TRUE", tipo]);
  });

  Logger.log("✅ " + areas.length + " áreas creadas. Las anteriores fueron eliminadas.");
}

// ─── MIGRACIÓN: AGREGAR COLUMNA EMAIL A USUARIOS ───────────
// Ejecutar UNA sola vez si ya existe la hoja USUARIOS sin columna EMAIL.
function setupAgregarEmailUsuarios() {
  const sheet = getSheet(SHEETS.USUARIOS);
  const data  = sheet.getDataRange().getValues();
  const headers = data[0].map(h => String(h).trim());

  if (!headers.includes("EMAIL")) {
    sheet.getRange(1, headers.length + 1).setValue("EMAIL");
    sheet.getRange(1, headers.length + 1)
      .setBackground("#1a1a2e")
      .setFontColor("#ffffff")
      .setFontWeight("bold");
    Logger.log("✅ Columna EMAIL agregada a USUARIOS");
  } else {
    Logger.log("ℹ️ Columna EMAIL ya existe en USUARIOS");
  }
}

// ─── ACCIÓN: LOGIN CON GOOGLE ──────────────────────────────
// Acepta idToken (de google.accounts.id — más confiable en iframes)
// o accessToken (de initTokenClient — fallback)
function accionLoginGoogle(body) {
  const { idToken, accessToken } = body;
  if (!idToken && !accessToken) return { ok: false, error: "Token de Google requerido" };

  try {
    let emailGoogle, nombre;

    if (idToken) {
      // Verificar ID token via tokeninfo (funciona en cualquier contexto)
      const resp = UrlFetchApp.fetch(
        "https://oauth2.googleapis.com/tokeninfo?id_token=" + idToken,
        { muteHttpExceptions: true }
      );
      if (resp.getResponseCode() !== 200) {
        return { ok: false, error: "ID token de Google inválido" };
      }
      const perfil = JSON.parse(resp.getContentText());
      if (perfil.error) return { ok: false, error: "Token rechazado por Google: " + perfil.error };
      emailGoogle = (perfil.email || "").toLowerCase();
      nombre      = perfil.name || perfil.email || "";
    } else {
      // Fallback: verificar access token via userinfo
      const resp = UrlFetchApp.fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
        headers: { Authorization: "Bearer " + accessToken },
        muteHttpExceptions: true
      });
      if (resp.getResponseCode() !== 200) {
        return { ok: false, error: "Token de Google inválido" };
      }
      const perfil = JSON.parse(resp.getContentText());
      emailGoogle = (perfil.email || "").toLowerCase();
      nombre      = perfil.name || perfil.email || "";
    }

    if (!emailGoogle) return { ok: false, error: "No se pudo obtener el correo de Google" };

    const usuarios = cachedObjects(SHEETS.USUARIOS);

    // Buscar todas las cuentas activas con ese correo
    const cuentas = usuarios.filter(u =>
      String(u.EMAIL || "").toLowerCase() === emailGoogle &&
      esTrue(u.ACTIVO)
    );

    if (!cuentas.length) {
      registrarLog(emailGoogle, "-", "LOGIN_GOOGLE_FALLIDO", "Correo no registrado en el sistema");
      return { ok: false, error: "No hay un usuario del sistema asociado a este correo. Contacta al administrador." };
    }

    // Seleccionar la cuenta según el modo de login solicitado por el frontend:
    // "colaborador" → preferir ROL=COLABORADOR; otro → preferir mayor privilegio
    // Siempre se selecciona la cuenta de mayor privilegio (un solo login sin pestañas)
    const prioridad = { SUPERADMIN: 3, ADMIN: 2, COLABORADOR: 1 };
    const usuario = cuentas.slice().sort((a, b) =>
      (prioridad[b.ROL] || 0) - (prioridad[a.ROL] || 0)
    )[0];

    if (!usuario) {
      registrarLog(emailGoogle, "-", "LOGIN_GOOGLE_FALLIDO", "Correo no registrado en el sistema");
      return { ok: false, error: "No hay un usuario del sistema asociado a este correo. Contacta al administrador." };
    }

    if (usuario.ROL !== "SUPERADMIN") {
      const config = getConfigValor("PROCESO_ACTIVO");
      if (config !== "TRUE") {
        return { ok: false, error: "El proceso no está activo en este momento" };
      }
    }

    const parseIdsG = v => String(v || "").split(",").map(s => s.trim()).filter(Boolean);
    let areaIds;
    if (usuario.ROL === "ADMIN" || usuario.ROL === "SUPERADMIN") {
      const porEmail = getAreaIdsDelAdmin(usuario, usuarios);
      const propia   = parseIdsG(usuario.AREA_ID);
      areaIds = [...new Set([...porEmail, ...propia])];
    } else {
      areaIds = parseIdsG(usuario.AREA_ID);
    }
    const token = crearSesion(usuario.ID, usuario.USERNAME, usuario.ROL, areaIds.join(","));
    registrarLog(usuario.USERNAME, usuario.ROL, "LOGIN_GOOGLE_OK", "Email: " + emailGoogle);

    return {
      ok: true,
      token,
      rol:         usuario.ROL,
      username:    usuario.USERNAME,
      cedula:      usuario.CEDULA || "",
      email:       emailGoogle,
      nombre:      nombre,
      areaId:      areaIds[0] || "",
      areaNombre:  getNombreArea(areaIds[0] || ""),
      areaIds:     areaIds,
      areaNombres: Object.fromEntries(areaIds.map(id => [id, getNombreArea(id)]))
    };

  } catch (err) {
    Logger.log("Error loginGoogle: " + err.toString());
    return { ok: false, error: "Error al verificar con Google" };
  }
}

// ─── ACCIÓN: CAMBIAR CONTRASEÑA ────────────────────────────
function accionCambiarPassword(body) {
  const session = body._session;
  const { passwordActual, passwordNueva } = body;

  if (!passwordActual || !passwordNueva) return { ok: false, error: "Campos requeridos" };
  if (passwordNueva.length < 6) return { ok: false, error: "La nueva contraseña debe tener al menos 6 caracteres" };

  const sheet = getSheet(SHEETS.USUARIOS);
  const data  = sheet.getDataRange().getValues();
  const headers = data[0];
  const colIdx  = {};
  headers.forEach((h, i) => { colIdx[h] = i; });

  const hashActual = hashPassword(passwordActual);

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][colIdx.USERNAME]) === String(session.username)) {
      if (String(data[i][colIdx.PASSWORD_HASH]) !== hashActual) {
        return { ok: false, error: "La contraseña actual es incorrecta" };
      }
      sheet.getRange(i + 1, colIdx.PASSWORD_HASH + 1).setValue(hashPassword(passwordNueva));
      registrarLog(session.username, session.rol, "CAMBIAR_PASSWORD", "Contraseña actualizada");
      return { ok: true, mensaje: "Contraseña actualizada correctamente" };
    }
  }
  return { ok: false, error: "Usuario no encontrado" };
}

// ─── ACCIÓN: ENVIAR SOLICITUD TH (COLABORADOR) ─────────────
// Valida que el colaborador tenga todo aprobado y retorna los datos
// para que el FRONTEND envíe el correo desde la cuenta Gmail del usuario.
function accionEnviarSolicitudTH(body) {
  const session = body._session;
  if (!["COLABORADOR", "ADMIN", "SUPERADMIN"].includes(session.rol)) {
    return { ok: false, error: "Acceso denegado" };
  }

  const { cedula } = body;
  const colaboradores = cachedObjects(SHEETS.COLABORADORES);
  const colaborador   = colaboradores.find(c => String(c.CEDULA) === String(cedula));
  if (!colaborador) return { ok: false, error: "Colaborador no encontrado" };

  const areas        = cachedObjects(SHEETS.AREAS).filter(a => esTrue(a.ACTIVO));
  const aprobaciones = cachedObjects(SHEETS.APROBACIONES);

  const usuariosTH    = cachedObjects(SHEETS.USUARIOS);
  const areasReqBase  = getAreasRequeridas(colaborador, areas);
  const areasOmitTH   = new Set(getAreaIdsDelColaborador(colaborador.CEDULA, usuariosTH).map(String));

  const aprobadosTH = new Set(
    aprobaciones.filter(a => String(a.COLABORADOR_ID) === String(colaborador.ID) && a.ESTADO === "APROBADO")
      .map(a => String(a.AREA_ID))
  );
  const areasReqTH = areasReqBase.filter(area => !areasOmitTH.has(String(area.ID)));
  const todasAprobadas = areasReqTH.length > 0 && areasReqTH.every(area => aprobadosTH.has(String(area.ID)));
  if (!todasAprobadas) return { ok: false, error: "No tienes todas las áreas aprobadas aún" };

  // Obtener o crear código de verificación (uno por colaborador por año, inmutable)
  const anoActual    = new Date().getFullYear().toString();
  const codigosSheet = getSheet(SHEETS.CODIGOS);
  const codigos      = cachedObjects(SHEETS.CODIGOS);
  let codigo = codigos.find(c =>
    String(c.COLABORADOR_ID) === String(colaborador.ID) &&
    esTrue(c.ACTIVO) &&
    _anioFecha(c.FECHA_EMISION) === anoActual
  );
  let fechaEmisionCodigo;
  if (!codigo) {
    fechaEmisionCodigo = timestampActual();
    const nuevoCodigo  = "PSG-" + String(colaborador.CEDULA).slice(-4) + "-" +
      Math.random().toString(36).substring(2, 7).toUpperCase();
    codigosSheet.appendRow([generarId(), nuevoCodigo, colaborador.ID, fechaEmisionCodigo, "TRUE"]);
    _invalidate(SHEETS.CODIGOS);
    codigo = { CODIGO: nuevoCodigo, FECHA_EMISION: fechaEmisionCodigo };
  } else {
    fechaEmisionCodigo = _strFecha(codigo.FECHA_EMISION);
  }

  const emailTH     = getConfigValor("EMAIL_TALENTO_HUMANO") || "";
  const institucion = getConfigValor("INSTITUCION_NOMBRE") || "Colegio Campestre Goyavier";

  // Construir detalle de áreas para el PDF (solo áreas no-OMITIDO)
  const detalleAreas = areasReqTH.map(area => {
    return { nombre: area.NOMBRE };
  });

  const asunto = "Paz y Salvo — " + colaborador.NOMBRE;
  const cuerpo =
    "El colaborador " + colaborador.NOMBRE + " (C.C. " + colaborador.CEDULA + ") " +
    "ha completado el proceso de Paz y Salvo.\n\n" +
    "Código de verificación: " + codigo.CODIGO + "\n" +
    "Fecha de emisión: " + fechaEmisionCodigo + "\n\n" +
    "— " + institucion;

  // Generar PDF adjunto (requiere scope Drive)
  const pdfBlob = _generarPdfPazYSalvo(colaborador, codigo.CODIGO, fechaEmisionCodigo, institucion, detalleAreas);

  let correoEnviado = false;
  let errorCorreo   = "";

  if (emailTH) {
    try {
      const opciones = pdfBlob ? { attachments: [pdfBlob] } : {};
      MailApp.sendEmail(emailTH, asunto, cuerpo, opciones);
      correoEnviado = true;
    } catch(e) {
      Logger.log("Error enviando correo TH: " + e.toString());
      errorCorreo = e.message;
    }
  }

  registrarLog(session.username, session.rol, "SOLICITUD_TH",
    colaborador.NOMBRE + " (" + colaborador.CEDULA + ") — correo: " + (correoEnviado ? "OK" : "FALLIDO"));

  const mensaje = correoEnviado
    ? "✅ Paz y Salvo enviado correctamente a Talento Humano."
    : (!emailTH
        ? "Registro guardado. (No hay correo de Talento Humano configurado en el sistema.)"
        : "Registro guardado, pero no se pudo enviar el correo: " + errorCorreo);

  return {
    ok: true, mensaje, correoEnviado,
    datos: { nombre: colaborador.NOMBRE, cedula: colaborador.CEDULA, codigo: codigo.CODIGO, fechaEmision: fechaEmisionCodigo }
  };
}

// ─── ACCIÓN: DESCARGAR PDF (genera PDF server-side, retorna base64) ────
function accionDescargarPdf(body) {
  const session = body._session;
  if (!["COLABORADOR", "ADMIN", "SUPERADMIN"].includes(session.rol)) {
    return { ok: false, error: "Acceso denegado" };
  }
  const { colaboradorId } = body;
  if (!colaboradorId) return { ok: false, error: "ID de colaborador requerido" };

  const colaboradores = cachedObjects(SHEETS.COLABORADORES);
  const colaborador   = colaboradores.find(c => c.ID === colaboradorId);
  if (!colaborador) return { ok: false, error: "Colaborador no encontrado" };

  const areas        = cachedObjects(SHEETS.AREAS).filter(a => esTrue(a.ACTIVO));
  const aprobaciones = cachedObjects(SHEETS.APROBACIONES);

  const usuariosP  = cachedObjects(SHEETS.USUARIOS);
  const areasReqP0 = getAreasRequeridas(colaborador, areas);
  const areasOmitP = new Set(getAreaIdsDelColaborador(colaborador.CEDULA, usuariosP).map(String));

  const aprobPdfSet = new Set(
    aprobaciones.filter(a => String(a.COLABORADOR_ID) === String(colaboradorId) && a.ESTADO === "APROBADO")
      .map(a => String(a.AREA_ID))
  );
  const areasReqP = areasReqP0.filter(area => !areasOmitP.has(String(area.ID)));
  const todasAprobadas = areasReqP.length > 0 && areasReqP.every(area => aprobPdfSet.has(String(area.ID)));
  if (!todasAprobadas) return { ok: false, error: "El colaborador no tiene todas las áreas aprobadas" };

  const anoActual = new Date().getFullYear().toString();
  const codigos   = cachedObjects(SHEETS.CODIGOS);
  let codigoExistente = codigos.find(c =>
    String(c.COLABORADOR_ID) === String(colaboradorId) &&
    esTrue(c.ACTIVO) &&
    _anioFecha(c.FECHA_EMISION) === anoActual
  );

  let codigoVerificacion, fechaEmisionCodigo;
  if (codigoExistente) {
    codigoVerificacion = codigoExistente.CODIGO;
    fechaEmisionCodigo = _strFecha(codigoExistente.FECHA_EMISION);
  } else {
    fechaEmisionCodigo  = timestampActual();
    codigoVerificacion  = "PSG-" + String(colaborador.CEDULA).slice(-4) + "-" +
      Math.random().toString(36).substring(2, 7).toUpperCase();
    getSheet(SHEETS.CODIGOS).appendRow([
      generarId(), codigoVerificacion, colaboradorId, fechaEmisionCodigo, "TRUE"
    ]);
    _invalidate(SHEETS.CODIGOS);
  }

  const aprobMapPdf = {};
  aprobaciones.forEach(a => { aprobMapPdf[String(a.COLABORADOR_ID) + "_" + String(a.AREA_ID)] = a; });

  const detalleAreas = areasReqP.map(area => {
    const ap = aprobMapPdf[String(colaboradorId) + "_" + String(area.ID)];
    return { nombre: area.NOMBRE, responsable: ap ? ap.APROBADO_POR : "", fecha: ap ? ap.FECHA_ACCION : "" };
  });

  const institucion = getConfigValor("INSTITUCION_NOMBRE") || "Colegio Campestre Goyavier";
  const pdfBlob = _generarPdfPazYSalvo(colaborador, codigoVerificacion, fechaEmisionCodigo, institucion, detalleAreas);

  if (!pdfBlob) return { ok: false, error: "No se pudo generar el PDF. Verifique permisos de Drive." };

  const pdfBase64 = Utilities.base64Encode(pdfBlob.getBytes());
  const filename  = "PazYSalvo_" + colaborador.NOMBRE.replace(/\s+/g, "_") + ".pdf";

  registrarLog(session.username, session.rol, "DESCARGAR_PDF",
    colaborador.NOMBRE + " (" + colaborador.CEDULA + ")");

  return {
    ok: true, pdfBase64, filename,
    documento: {
      colaboradorId, nombre: colaborador.NOMBRE, cedula: colaborador.CEDULA,
      codigoVerificacion, fechaEmision: fechaEmisionCodigo, areas: detalleAreas
    }
  };
}

// Obtiene logo como <img> base64 desde Drive (server-side, sin CORS)
function _logoTagGs() {
  try {
    const f    = DriveApp.getFileById("1LnTQZzMonpDju9EMe_iWAfw0WvB5y6sn");
    const b64  = Utilities.base64Encode(f.getBlob().getBytes());
    const mime = f.getBlob().getContentType() || "image/png";
    return '<img src="data:' + mime + ';base64,' + b64 + '" ' +
      'style="height:56px;max-width:220px;object-fit:contain;display:block">';
  } catch(e) {
    Logger.log("Logo Drive no disponible: " + e.message);
    return '<span style="font-size:20px;font-weight:900;color:#1e3a5f;letter-spacing:2px">GOYAVIER</span>';
  }
}
// ─── ACCIÓN: DESCARGAR PDF (genera PDF server-side y retorna base64) ─────
function accionDescargarPdf(body) {
  const session = body._session;
  if (!["COLABORADOR", "ADMIN", "SUPERADMIN"].includes(session.rol)) {
    return { ok: false, error: "Acceso denegado" };
  }
  const { colaboradorId } = body;
  if (!colaboradorId) return { ok: false, error: "ID de colaborador requerido" };

  const colaboradores = cachedObjects(SHEETS.COLABORADORES);
  const colaborador   = colaboradores.find(c => c.ID === colaboradorId);
  if (!colaborador) return { ok: false, error: "Colaborador no encontrado" };

  const areas        = cachedObjects(SHEETS.AREAS).filter(a => esTrue(a.ACTIVO));
  const aprobaciones = cachedObjects(SHEETS.APROBACIONES);
  const usuarios2     = cachedObjects(SHEETS.USUARIOS);
  const areasReq2base = getAreasRequeridas(colaborador, areas);
  const areasOmitidas2 = new Set(getAreaIdsDelColaborador(colaborador.CEDULA, usuarios2).map(String));

  const aprobPdf2Set = new Set(
    aprobaciones.filter(a => String(a.COLABORADOR_ID) === String(colaboradorId) && a.ESTADO === "APROBADO")
      .map(a => String(a.AREA_ID))
  );
  const areasRequeridas2 = areasReq2base.filter(area => !areasOmitidas2.has(String(area.ID)));
  const todasAprobadas = areasRequeridas2.length > 0 && areasRequeridas2.every(area => aprobPdf2Set.has(String(area.ID)));
  if (!todasAprobadas) return { ok: false, error: "El colaborador no tiene todas las áreas aprobadas" };

  const anoActual = new Date().getFullYear().toString();
  const codigos   = cachedObjects(SHEETS.CODIGOS);
  let codigoExistente = codigos.find(c =>
    String(c.COLABORADOR_ID) === String(colaboradorId) &&
    esTrue(c.ACTIVO) &&
    _anioFecha(c.FECHA_EMISION) === anoActual
  );

  let codigoVerificacion, fechaEmisionCodigo;
  if (codigoExistente) {
    codigoVerificacion = codigoExistente.CODIGO;
    fechaEmisionCodigo = _strFecha(codigoExistente.FECHA_EMISION);
  } else {
    fechaEmisionCodigo = timestampActual();
    codigoVerificacion = "PSG-" + String(colaborador.CEDULA).slice(-4) + "-" +
      Math.random().toString(36).substring(2, 7).toUpperCase();
    getSheet(SHEETS.CODIGOS).appendRow([
      generarId(), codigoVerificacion, colaboradorId, fechaEmisionCodigo, "TRUE"
    ]);
    _invalidate(SHEETS.CODIGOS);
  }

  const aprobMapD2 = {};
  aprobaciones.forEach(a => { aprobMapD2[String(a.COLABORADOR_ID) + "_" + String(a.AREA_ID)] = a; });

  const detalleAreas = areasRequeridas2.map(area => {
    const ap = aprobMapD2[String(colaboradorId) + "_" + String(area.ID)];
    return { nombre: area.NOMBRE, responsable: ap ? ap.APROBADO_POR : "", fecha: ap ? ap.FECHA_ACCION : "" };
  });

  const institucion = getConfigValor("INSTITUCION_NOMBRE") || "Colegio Campestre Goyavier";
  const pdfBlob = _generarPdfPazYSalvo(colaborador, codigoVerificacion, fechaEmisionCodigo, institucion, detalleAreas);

  if (!pdfBlob) return { ok: false, error: "No se pudo generar el PDF. Verifique permisos de Drive." };

  const pdfBase64 = Utilities.base64Encode(pdfBlob.getBytes());
  const filename  = "PazYSalvo_" + colaborador.NOMBRE.replace(/\s+/g, "_") + ".pdf";

  registrarLog(session.username, session.rol, "DESCARGAR_PDF",
    colaborador.NOMBRE + " (" + colaborador.CEDULA + ")");

  return {
    ok: true, pdfBase64, filename,
    documento: {
      colaboradorId, nombre: colaborador.NOMBRE, cedula: colaborador.CEDULA,
      codigoVerificacion, fechaEmision: fechaEmisionCodigo, areas: detalleAreas
    }
  };
}

// Obtiene el logo como <img> base64 para el PDF (server-side, sin CORS)
function _logoTagGs() {
  try {
    const f    = DriveApp.getFileById("1LnTQZzMonpDju9EMe_iWAfw0WvB5y6sn");
    const b64  = Utilities.base64Encode(f.getBlob().getBytes());
    const mime = f.getBlob().getContentType() || "image/png";
    return '<img src="data:' + mime + ';base64,' + b64 +
      '" style="height:56px;max-width:220px;object-fit:contain;display:block">';
  } catch(e) {
    Logger.log("Logo no disponible: " + e.message);
    return '<span style="font-size:20px;font-weight:900;color:#1e3a5f;letter-spacing:2px">GOYAVIER</span>';
  }
}
// Genera un PDF del Paz y Salvo usando Drive (requiere scope Drive).
// Retorna el blob PDF o null si falla.
function _generarPdfPazYSalvo(colaborador, codigoVerificacion, fechaEmision, institucion, detalleAreas) {
  try {
    const logoTag = _logoTagGs();

    const areasHtml = (detalleAreas && detalleAreas.length)
      ? '<div class="areas">' +
        '<div class="areas-title">DEPENDENCIAS CERTIFICADAS</div>' +
        '<div class="areas-grid">' +
        detalleAreas.map(function(a) {
          return '<span class="area-chip">&#10003; ' + a.nombre + '</span>';
        }).join('') +
        '</div></div>'
      : '';

    const css =
      '*{box-sizing:border-box;margin:0;padding:0}' +
      '@page{size:8.5in 11in;margin:0}' +
      'html,body{margin:0;padding:0;width:8.5in}' +
      'body{font-family:Arial,sans-serif;color:#1a1a2e;background:#fff}' +
      '.page{width:8.5in;min-height:11in;display:flex;flex-direction:column}' +
      '.hdr{display:flex;align-items:center;gap:20px;padding:24px 44px 20px;' +
        'border-bottom:3px solid #1e3a5f;background:#f8faff;flex-shrink:0}' +
      '.inst{display:flex;flex-direction:column;justify-content:center}' +
      '.inst-name{font-size:17px;font-weight:700;color:#1e3a5f;text-transform:uppercase;letter-spacing:1px}' +
      '.inst-sub{font-size:11px;color:#999;margin-top:3px}' +
      '.title-blk{text-align:center;padding:26px 44px 22px;border-bottom:1px solid #dde4f0;flex-shrink:0}' +
      '.t-badge{display:inline-block;background:#1e3a5f;color:#fff;font-size:9px;font-weight:700;' +
        'letter-spacing:2px;text-transform:uppercase;padding:5px 16px;border-radius:20px;margin-bottom:12px}' +
      '.t-main{font-size:30px;font-weight:700;color:#1e3a5f;letter-spacing:4px;text-transform:uppercase}' +
      '.t-desc{font-size:10px;color:#bbb;margin-top:8px;letter-spacing:2px;text-transform:uppercase}' +
      '.body{flex:1;padding:26px 44px 22px;display:flex;flex-direction:column;justify-content:space-between}' +
      '.intro{font-size:12px;color:#666;text-align:center;margin-bottom:16px}' +
      '.person{background:#eef3ff;border:2px solid #c5d5f0;border-radius:12px;' +
        'padding:18px 32px;text-align:center;margin-bottom:16px}' +
      '.p-name{font-size:23px;font-weight:700;color:#1e3a5f;text-transform:uppercase}' +
      '.p-cc{font-size:12px;color:#667;margin-top:7px}' +
      '.cert-txt{font-size:12px;color:#444;line-height:1.9;text-align:justify;margin-bottom:16px}' +
      '.areas{background:#f0f7f0;border:1px solid #b8dfb8;border-radius:10px;' +
        'padding:14px 20px;margin-bottom:16px}' +
      '.areas-title{font-size:9px;font-weight:700;color:#2d7a2d;letter-spacing:1.5px;' +
        'text-transform:uppercase;margin-bottom:10px}' +
      '.areas-grid{display:flex;flex-wrap:wrap;gap:8px}' +
      '.area-chip{background:#fff;border:1px solid #c5e8c5;border-radius:6px;' +
        'padding:4px 12px;font-size:10px;color:#2d7a2d}' +
      '.fecha{font-size:12px;color:#555;text-align:center;font-style:italic;margin-bottom:16px}' +
      '.sigs{display:flex;justify-content:space-around;margin-bottom:18px}' +
      '.sig{text-align:center;width:180px}' +
      '.sig-space{height:44px}' +
      '.sig-line{border-top:1px solid #aaa;margin-bottom:5px}' +
      '.sig-lbl{font-size:10px;color:#888}' +
      '.verif{background:#1e3a5f;border-radius:12px;padding:18px 28px;text-align:center}' +
      '.v-lbl{font-size:9px;color:rgba(255,255,255,.6);letter-spacing:2px;text-transform:uppercase}' +
      '.v-code{font-family:monospace;font-size:20px;font-weight:700;color:#fff;' +
        'letter-spacing:5px;margin-top:8px}' +
      '.v-hint{font-size:9px;color:rgba(255,255,255,.5);margin-top:5px}' +
      '.ftr{background:#f0f4f8;padding:12px 44px;text-align:center;font-size:9px;' +
        'color:#aaa;border-top:1px solid #e8edf4;line-height:1.8;flex-shrink:0}';

    const html =
      '<!DOCTYPE html><html><head><meta charset="UTF-8"><style>' + css + '</style></head><body>' +
      '<div class="page">' +
        '<div class="hdr">' +
          logoTag +
          '<div class="inst">' +
            '<div class="inst-name">' + institucion + '</div>' +
            '<div class="inst-sub">Institución Educativa Privada &middot; Floridablanca, Santander</div>' +
          '</div>' +
        '</div>' +
        '<div class="title-blk">' +
          '<div class="t-badge">Certificado Oficial</div><br>' +
          '<div class="t-main">Paz y Salvo</div>' +
          '<div class="t-desc">Sistema Institucional de Certificación</div>' +
        '</div>' +
        '<div class="body">' +
          '<div>' +
            '<p class="intro">La Dirección de la Institución Educativa certifica que el colaborador:</p>' +
            '<div class="person">' +
              '<div class="p-name">' + colaborador.NOMBRE + '</div>' +
              '<div class="p-cc">C&eacute;dula de Ciudadan&iacute;a No. ' + colaborador.CEDULA + '</div>' +
            '</div>' +
            '<p class="cert-txt">Se encuentra a <strong>PAZ Y SALVO</strong> con todas las dependencias de la ' +
            'Institución Educativa ' + institucion + ', habiendo cumplido satisfactoriamente con todos ' +
            'los requerimientos establecidos en el proceso de certificación de retiro y desvinculación institucional.</p>' +
            areasHtml +
          '</div>' +
          '<div>' +
            '<p class="fecha">Expedido en Floridablanca, Santander, el ' + fechaEmision + '.</p>' +
            '<div class="sigs">' +
              '<div class="sig"><div class="sig-space"></div><div class="sig-line"></div>' +
                '<div class="sig-lbl">Firma Autorizada</div></div>' +
              '<div class="sig"><div class="sig-space"></div><div class="sig-line"></div>' +
                '<div class="sig-lbl">Talento Humano</div></div>' +
            '</div>' +
            '<div class="verif">' +
              '<div class="v-lbl">C&oacute;digo de verificaci&oacute;n</div>' +
              '<div class="v-code">' + codigoVerificacion + '</div>' +
              '<div class="v-hint">Verifique la autenticidad en el sistema institucional</div>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="ftr">' +
          'Documento generado autom&aacute;ticamente &middot; ' +
          'Sistema de Paz y Salvo Institucional &middot; ' + institucion +
          ' &middot; ' + fechaEmision +
        '</div>' +
      '</div>' +
      '</body></html>';

    const file = DriveApp.createFile(
      'PazYSalvo_' + colaborador.NOMBRE + '.html', html, MimeType.HTML
    );
    const pdf = file.getAs('application/pdf');
    pdf.setName('PazYSalvo_' + colaborador.NOMBRE.replace(/\s+/g, '_') + '.pdf');
    file.setTrashed(true);
    return pdf;
  } catch(e) {
    Logger.log("PDF no generado: " + e.message);
    return null;
  }
}
// ─── ACCIÓN: APROBAR MASIVO (ADMIN) ───────────────────────
function accionAprobarMasivo(body) {
  const session = body._session;
  if (!["ADMIN","SUPERADMIN"].includes(session.rol)) return { ok: false, error: "Acceso denegado" };

  const ids = body.colaboradorIds || body.ids;
  if (!ids || !ids.length) return { ok: false, error: "No se enviaron IDs" };

  const areaIds = session.areaIds && session.areaIds.length ? session.areaIds : [session.areaId].filter(Boolean);
  const reqAreaId = body.areaId;
  const areaId  = session.rol === "SUPERADMIN"
    ? (reqAreaId ? String(reqAreaId) : areaIds[0])
    : (reqAreaId && areaIds.includes(String(reqAreaId)) ? String(reqAreaId) : areaIds[0]);
  if (!areaId) return { ok: false, error: "Área no autorizada" };

  const sheet  = getSheet(SHEETS.APROBACIONES);
  const data   = sheet.getDataRange().getValues();
  const headers = data[0];
  const colIdx  = {};
  headers.forEach((h, i) => { colIdx[h] = i; });

  const timestamp = timestampActual();
  let procesados  = 0;

  ids.forEach(colaboradorId => {
    let fila = -1;
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][colIdx.COLABORADOR_ID]) === String(colaboradorId) &&
          String(data[i][colIdx.AREA_ID])         === String(areaId)) {
        fila = i + 1; break;
      }
    }
    if (fila > 0) {
      sheet.getRange(fila, colIdx.ESTADO        + 1).setValue("APROBADO");
      sheet.getRange(fila, colIdx.OBSERVACIONES + 1).setValue("");
      sheet.getRange(fila, colIdx.APROBADO_POR  + 1).setValue(session.username);
      sheet.getRange(fila, colIdx.FECHA_ACCION  + 1).setValue(timestamp);
    } else {
      sheet.appendRow([generarId(), colaboradorId, areaId, "APROBADO", "", session.username, timestamp]);
    }
    procesados++;
  });

  registrarLog(session.username, session.rol, "APROBAR_MASIVO",
    procesados + " colaboradores en área ID: " + areaId);

  return { ok: true, mensaje: procesados + " colaborador(es) aprobado(s) correctamente" };
}

// ─── ACCIÓN: TOGGLE PAZ Y SALVO MASIVO (SUPERADMIN) ───────
function accionTogglePazSalvoMasivo(body) {
  const session = body._session;
  if (session.rol !== "SUPERADMIN") return { ok: false, error: "Acceso denegado" };

  const { ids, valor } = body;
  if (!ids || !ids.length) return { ok: false, error: "No se enviaron IDs" };

  const sheet  = getSheet(SHEETS.COLABORADORES);
  const data   = sheet.getDataRange().getValues();
  const headers = data[0];
  const colIdx  = {};
  headers.forEach((h, i) => { colIdx[h] = i; });

  let procesados = 0;
  for (let i = 1; i < data.length; i++) {
    if (ids.includes(String(data[i][colIdx.ID]))) {
      sheet.getRange(i + 1, colIdx.REQUIERE_PAZ_SALVO + 1).setValue(valor ? "TRUE" : "FALSE");
      procesados++;
    }
  }

  registrarLog(session.username, session.rol, "TOGGLE_PAZ_SALVO_MASIVO",
    procesados + " colaboradores → " + (valor ? "SÍ requieren" : "NO requieren"));

  return { ok: true, mensaje: procesados + " colaborador(es) actualizados correctamente" };
}

// ─── ACCIÓN: CARGA MASIVA COLABORADORES (SUPERADMIN) ──────
function accionCargaMasivaColaboradores(body) {
  const session = body._session;
  if (session.rol !== "SUPERADMIN") return { ok: false, error: "Acceso denegado" };

  const { registros } = body;
  if (!registros || !registros.length) return { ok: false, error: "No hay registros" };
  if (registros.length > 200) return { ok: false, error: "Máximo 200 registros por carga" };

  const colabSheet    = getSheet(SHEETS.COLABORADORES);
  const usuariosSheet = getSheet(SHEETS.USUARIOS);
  const colabExist    = sheetToObjects(colabSheet);
  const usuariosExist = sheetToObjects(usuariosSheet);

  const cedulasVistas  = new Set(colabExist.map(c => String(c.CEDULA).trim()));
  const usernamesVistas = new Set(usuariosExist.map(u => String(u.USERNAME).toLowerCase()));

  const creados  = [];
  const omitidos = [];
  const errores  = [];
  const timestamp = timestampActual();

  registros.forEach(reg => {
    if (!reg.nombre || !reg.cedula) {
      errores.push("Fila sin nombre o cédula");
      return;
    }
    const cedulaStr = String(reg.cedula).trim();
    if (cedulasVistas.has(cedulaStr)) {
      omitidos.push(reg.nombre + " (" + cedulaStr + ") — cédula ya existe");
      return;
    }
    cedulasVistas.add(cedulaStr);

    const id = generarId();
    colabSheet.appendRow([
      id, reg.nombre.trim(), cedulaStr, "TRUE",
      reg.requierePazSalvo !== false ? "TRUE" : "FALSE", timestamp
    ]);

    const uname = ((reg.username || "") + "").trim() || cedulaStr;
    const pass  = ((reg.password  || "") + "").trim() || cedulaStr;
    if (!usernamesVistas.has(uname.toLowerCase())) {
      usernamesVistas.add(uname.toLowerCase());
      usuariosSheet.appendRow([
        generarId(), uname, hashPassword(pass), "COLABORADOR", "", "TRUE", timestamp
      ]);
    }

    creados.push(reg.nombre + " (" + cedulaStr + ")");
  });

  registrarLog(session.username, session.rol, "CARGA_MASIVA",
    creados.length + " creados, " + omitidos.length + " omitidos, " + errores.length + " errores");

  return {
    ok: true,
    mensaje: "Carga completada: " + creados.length + " creado(s), " + omitidos.length + " omitido(s)",
    creados, omitidos, errores
  };
}

// ─── ACCIÓN: GET CONFIG ADMIN ──────────────────────────────
function accionGetConfigAdmin(body) {
  const session = body._session;
  if (!["ADMIN", "SUPERADMIN"].includes(session.rol)) return { ok: false, error: "Acceso denegado" };

  const clave = session.rol === "ADMIN" && session.areaId
    ? "EMAILS_NOTIFICACION_" + session.areaId
    : "EMAILS_NOTIFICACION";

  const emailsNotificacion = getConfigValor(clave) || getConfigValor("EMAILS_NOTIFICACION") || "";
  return { ok: true, emailsNotificacion };
}

// ─── ACCIÓN: SET EMAILS NOTIFICACIÓN ──────────────────────
function accionSetEmailsNotificacion(body) {
  const session = body._session;
  if (!["ADMIN", "SUPERADMIN"].includes(session.rol)) return { ok: false, error: "Acceso denegado" };

  const { emails } = body;
  const clave = session.rol === "ADMIN" && session.areaId
    ? "EMAILS_NOTIFICACION_" + session.areaId
    : "EMAILS_NOTIFICACION";

  setConfigValor(clave, emails || "");
  registrarLog(session.username, session.rol, "SET_EMAILS_NOTIF", "Correos: " + (emails || ""));
  return { ok: true, mensaje: "Correos de notificación guardados" };
}

// ─── MIGRACIÓN COMPLETA: ÁREAS + USUARIO TH + REPARAR IDs ─
// Ejecutar UNA sola vez desde el editor de GAS: Run > migracionActualizarAreas
// O desde el botón en la UI: SuperAdmin → Configuración → "Migración de áreas"
//
// Pasos que realiza:
//   1. Renombra "Administradora General" → "Restaurante" en AREAS
//   2. Agrega "Talento Humano" a AREAS (si no existe)
//   3. Crea usuario admin "talento.humano" en USUARIOS (si no existe)
//   4. Actualiza AREA_IDs de todos los admins en USUARIOS según USR_AREA
//   5. Repara AREA_IDs huérfanos en APROBACIONES usando APROBADO_POR
function migracionActualizarAreas() {
  const log = msg => Logger.log(msg);
  log("════════ INICIO MIGRACIÓN ════════");

  // ── PASO 1: Renombrar en AREAS ─────────────────────────
  const areasSheet = getSheet(SHEETS.AREAS);
  const areasData  = areasSheet.getDataRange().getValues();
  const aC = {};
  areasData[0].forEach((h, i) => { aC[String(h).trim()] = i; });

  let renombradas = 0;
  for (let i = 1; i < areasData.length; i++) {
    const nombre = String(areasData[i][aC.NOMBRE] || "").trim();
    if (nombre === "Administradora General") {
      areasSheet.getRange(i + 1, aC.NOMBRE + 1).setValue("Restaurante");
      if (aC.DESCRIPCION !== undefined) {
        areasSheet.getRange(i + 1, aC.DESCRIPCION + 1).setValue("Área de restaurante y alimentación");
      }
      renombradas++;
      log("✅ AREAS: 'Administradora General' → 'Restaurante'");
    }
  }

  // ── PASO 2: Agregar Talento Humano ─────────────────────
  const areasActuales = areasSheet.getDataRange().getValues(); // re-leer
  const nombresActuales = areasActuales.slice(1).map(r => String(r[aC.NOMBRE] || "").trim());
  let thAreaId = "";
  if (!nombresActuales.includes("Talento Humano")) {
    thAreaId = generarId();
    areasSheet.appendRow([thAreaId, "Talento Humano", "Gestión de talento humano y nómina", "TRUE"]);
    log("✅ AREAS: Área 'Talento Humano' creada con ID " + thAreaId);
  } else {
    // Obtener ID existente
    const areasActuales2 = areasSheet.getDataRange().getValues();
    for (let i = 1; i < areasActuales2.length; i++) {
      if (String(areasActuales2[i][aC.NOMBRE] || "").trim() === "Talento Humano") {
        thAreaId = String(areasActuales2[i][aC.ID] || "");
        break;
      }
    }
    log("ℹ️ AREAS: 'Talento Humano' ya existía (ID: " + thAreaId + ")");
  }

  // ── PASO 3: Crear usuario talento.humano ───────────────
  const usuSheet  = getSheet(SHEETS.USUARIOS);
  const usuData   = usuSheet.getDataRange().getValues();
  const uC        = {};
  usuData[0].forEach((h, i) => { uC[String(h).trim()] = i; });

  const usernames = usuData.slice(1).map(r => String(r[uC.USERNAME] || "").toLowerCase());
  if (!usernames.includes("talento.humano")) {
    const PASSWORD_TEMP = "Goyavier2026#";
    usuSheet.appendRow([
      generarId(), "talento.humano", hashPassword(PASSWORD_TEMP),
      "ADMIN", thAreaId, "TRUE", timestampActual()
    ]);
    log("✅ USUARIOS: Usuario 'talento.humano' creado (área ID: " + thAreaId + ")");
    log("   ⚠️ Contraseña temporal: " + PASSWORD_TEMP + " — cámbiala desde el panel de usuarios");
  } else {
    log("ℹ️ USUARIOS: 'talento.humano' ya existía");
    // Asegurarse de que tiene el AREA_ID correcto si thAreaId fue encontrado
    if (thAreaId) {
      for (let i = 1; i < usuData.length; i++) {
        if (String(usuData[i][uC.USERNAME] || "").toLowerCase() === "talento.humano") {
          usuSheet.getRange(i + 1, uC.AREA_ID + 1).setValue(thAreaId);
          log("   ✅ AREA_ID actualizado a: " + thAreaId);
          break;
        }
      }
    }
  }

  // ── PASO 4: Actualizar AREA_IDs de admins en USUARIOS ──
  const USR_AREA = {
    "sec.academica":     "Secretaría Académica",
    "resp.tecnologia":   "Responsable de Tecnología",
    "resp.biblioteca":   "Responsable de Biblioteca",
    "coord.preescolar":  "Coord. Preescolar",
    "coord.convivencia": "Coord. General de Convivencia",
    "coord.academica":   "Coord. General Académica",
    "coord.primaria":    "Coord. Académica Primaria",
    "jefe.area":         "Jefe de Área",
    "administradora":    "Restaurante",
    "coord.adm":         "Coord. Administrativa",
    "rectora":           "Rectora",
    "talento.humano":    "Talento Humano"
  };

  // Re-leer áreas y usuarios para tener datos frescos
  const areasRefresh = getSheet(SHEETS.AREAS).getDataRange().getValues();
  const nombreToId   = {};
  for (let i = 1; i < areasRefresh.length; i++) {
    const n = String(areasRefresh[i][aC.NOMBRE] || "").trim();
    const id = String(areasRefresh[i][aC.ID] || "").trim();
    if (n && id) nombreToId[n] = id;
  }

  const usuDataFresh = usuSheet.getDataRange().getValues();
  const uCF = {};
  usuDataFresh[0].forEach((h, i) => { uCF[String(h).trim()] = i; });

  const usernameToAreaId = {};
  let usuFixes = 0;
  for (let i = 1; i < usuDataFresh.length; i++) {
    if (usuDataFresh[i][uCF.ROL] !== "ADMIN") continue;
    const username   = String(usuDataFresh[i][uCF.USERNAME] || "").trim().toLowerCase();
    const areaNombre = USR_AREA[username];
    if (!areaNombre) { log("⚠️ USUARIOS: Admin '" + username + "' sin mapeo en USR_AREA"); continue; }

    const newId = nombreToId[areaNombre];
    if (!newId) { log("⚠️ USUARIOS: Área '" + areaNombre + "' no encontrada para admin '" + username + "'"); continue; }

    usernameToAreaId[username] = newId;
    const oldId = String(usuDataFresh[i][uCF.AREA_ID] || "").trim();
    if (oldId !== newId) {
      usuSheet.getRange(i + 1, uCF.AREA_ID + 1).setValue(newId);
      usuFixes++;
      log("✅ USUARIOS: " + username + " AREA_ID: '" + oldId.substring(0,8) + "...' → '" + newId.substring(0,8) + "...'");
    }
  }

  // ── PASO 5: Reparar AREA_IDs en APROBACIONES ──────────
  const areasIdSet   = new Set(Object.values(nombreToId));
  const aprobSheet   = getSheet(SHEETS.APROBACIONES);
  const aprobData    = aprobSheet.getDataRange().getValues();
  const aprobC       = {};
  aprobData[0].forEach((h, i) => { aprobC[String(h).trim()] = i; });

  let aprobFixes = 0, aprobOk = 0, aprobSinResolver = 0;
  for (let i = 1; i < aprobData.length; i++) {
    const curId = String(aprobData[i][aprobC.AREA_ID] || "").trim();
    if (areasIdSet.has(curId)) { aprobOk++; continue; }

    const aprobadoPor = String(aprobData[i][aprobC.APROBADO_POR] || "").toLowerCase().trim();
    const newId       = usernameToAreaId[aprobadoPor];
    if (newId) {
      aprobSheet.getRange(i + 1, aprobC.AREA_ID + 1).setValue(newId);
      aprobFixes++;
      log("✅ APROBACIONES fila " + (i + 1) + ": AREA_ID reparado (aprobado por: " + aprobadoPor + ")");
    } else {
      aprobSinResolver++;
      log("⚠️ APROBACIONES fila " + (i + 1) + ": no resuelta. AREA_ID=" + curId.substring(0,8) + " APROBADO_POR=" + aprobadoPor);
    }
  }

  log("════════════════════════════════════════");
  log("AREAS renombradas:           " + renombradas);
  log("USERS AREA_ID reparados:     " + usuFixes);
  log("APROBACIONES ya correctas:   " + aprobOk);
  log("APROBACIONES reparadas:      " + aprobFixes);
  log("APROBACIONES sin resolver:   " + aprobSinResolver);
  if (aprobSinResolver > 0) {
    log("   ⚠️ Las filas sin resolver requieren reaprobación manual desde la app.");
  }
  log("════════════════════════════════════════");
}

// Wrapper HTTP para llamar desde la app (SUPERADMIN)
function accionMigracionAreas(body) {
  const session = body._session;
  if (session.rol !== "SUPERADMIN") return { ok: false, error: "Solo SUPERADMIN puede ejecutar esto" };
  try {
    migracionActualizarAreas();
    return {
      ok: true,
      mensaje: "Migración completada: áreas actualizadas, usuario Talento Humano creado e IDs reparados. Revisa los Logs del editor de GAS para el detalle completo."
    };
  } catch(e) {
    Logger.log("Error migracionActualizarAreas: " + e.toString());
    return { ok: false, error: e.message };
  }
}

// ─── MIGRACIÓN: AGREGAR COLUMNA CEDULA A USUARIOS ───────────
// Agrega columnas EMAIL y CEDULA a la hoja USUARIOS si no existen.
// Solo ejecutar una vez. Es seguro repetirlo (idempotente).
function migracionAgregarCedulaUsuarios() {
  const sheet = getSheet(SHEETS.USUARIOS);
  const hdrRow = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const headers = hdrRow.map(h => String(h).trim());
  let cambios = [];

  if (!headers.includes("EMAIL")) {
    const col = headers.length + 1;
    sheet.getRange(1, col).setValue("EMAIL");
    cambios.push("Columna EMAIL agregada");
  }
  if (!headers.includes("CEDULA")) {
    const updatedHdr = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const col = updatedHdr.length + 1;
    sheet.getRange(1, col).setValue("CEDULA");
    cambios.push("Columna CEDULA agregada");
  }

  Logger.log("migracionAgregarCedulaUsuarios: " + (cambios.length ? cambios.join(", ") : "nada que agregar"));
  return cambios.length ? cambios.join(", ") : "Las columnas ya existían";
}

function accionMigracionAgregarCedula(body) {
  const session = body._session;
  if (session.rol !== "SUPERADMIN") return { ok: false, error: "Solo SUPERADMIN puede ejecutar esto" };
  try {
    const resultado = migracionAgregarCedulaUsuarios();
    return { ok: true, mensaje: "Migración completada: " + resultado };
  } catch(e) {
    Logger.log("Error migracionAgregarCedula: " + e.toString());
    return { ok: false, error: e.message };
  }
}

// ─── SETUP: JEFES DE ÁREA ACADÉMICAS ────────────────────────
// Crea las 8 áreas académicas y sus usuarios ADMIN si no existen.
// Idempotente: seguro repetirlo (no duplica). Contraseña temporal: Goyavier2026#
// Después: editar cada usuario para agregar su CÉDULA (activa OMITIDO en su paz y salvo).
function agregarJefesDeArea() {
  const JEFES = [
    { area: "Matemáticas",            desc: "Coordinación Área de Matemáticas",            username: "candy.villamizar",    email: "candy.villamizar@colegiogoyavier.edu.co"    },
    { area: "Lenguaje",               desc: "Coordinación Área de Lenguaje",               username: "jennym.ramirez",      email: "jennym.ramirez@colegiogoyavier.edu.co"      },
    { area: "Ciencias Sociales",      desc: "Coordinación Área de Ciencias Sociales",      username: "johand.camargo",      email: "johand.camargo@colegiogoyavier.edu.co"      },
    { area: "Ciencias Naturales",     desc: "Coordinación Área de Ciencias Naturales",     username: "lizetho.ballesteros", email: "lizetho.ballesteros@colegiogoyavier.edu.co" },
    { area: "Inglés",                 desc: "Coordinación Área de Inglés",                 username: "frankj.acevedo",      email: "frankj.acevedo@colegiogoyavier.edu.co"      },
    { area: "Artes",                  desc: "Coordinación Área de Artes",                  username: "linam.solano",        email: "linam.solano@colegiogoyavier.edu.co"        },
    { area: "Tecnología e Informática", desc: "Coordinación Área de Tecnología e Informática", username: "leydie.arguello", email: "leydie.arguello@colegiogoyavier.edu.co"     },
    { area: "Educación Física",       desc: "Coordinación Área de Educación Física",       username: "yudia.cubides",       email: "yudia.cubides@colegiogoyavier.edu.co"       }
  ];

  const PASSWORD_TEMP = "Goyavier2026#";
  const lineas = [];
  const logL = msg => { Logger.log(msg); lineas.push(msg); };
  logL("════ INICIO SETUP JEFES DE ÁREA ════");

  // ── PASO 1: Crear áreas que no existan ─────────────────────────
  const areasSheet = getSheet(SHEETS.AREAS);
  const areasData  = areasSheet.getDataRange().getValues();
  const arC = {};
  areasData[0].forEach((h, i) => { arC[String(h).trim()] = i; });
  const areaIdPorNombre = {};
  areasData.slice(1).forEach(r => {
    areaIdPorNombre[String(r[arC.NOMBRE] || "").trim()] = String(r[arC.ID]);
  });

  // Obtener índice de columna TIPO si existe
  const arHdr = areasSheet.getRange(1, 1, 1, areasSheet.getLastColumn()).getValues()[0];
  const arColIdx = {};
  arHdr.forEach((h, i) => { arColIdx[String(h).trim()] = i + 1; });

  JEFES.forEach(j => {
    if (areaIdPorNombre[j.area]) {
      logL("✔ Área ya existe: " + j.area + " (ID: " + areaIdPorNombre[j.area] + ")");
      // Asegurar TIPO = DEPARTAMENTAL si la columna ya existe
      if (arColIdx.TIPO) {
        const rowIdx = areasData.findIndex((r, i) => i > 0 && String(r[arC.NOMBRE] || "").trim() === j.area);
        if (rowIdx > 0) areasSheet.getRange(rowIdx + 1, arColIdx.TIPO).setValue("DEPARTAMENTAL");
      }
      return;
    }
    const newId = generarId();
    areasSheet.appendRow([newId, j.area, j.desc, "TRUE"]);
    areaIdPorNombre[j.area] = newId;
    // Setear TIPO = DEPARTAMENTAL si la columna existe
    if (arColIdx.TIPO) {
      areasSheet.getRange(areasSheet.getLastRow(), arColIdx.TIPO).setValue("DEPARTAMENTAL");
    }
    logL("✅ Área creada: " + j.area + " (ID: " + newId + ")");
  });

  // ── PASO 2: Crear usuarios ADMIN que no existan ─────────────────
  const usuSheet = getSheet(SHEETS.USUARIOS);
  const usuData  = usuSheet.getDataRange().getValues();
  const uC = {}, uIdx = {};
  usuData[0].forEach((h, i) => { uC[String(h).trim()] = i; uIdx[String(h).trim()] = i + 1; });
  const existentes = usuData.slice(1).map(r => String(r[uC.USERNAME] || "").toLowerCase());

  JEFES.forEach(j => {
    const areaId = areaIdPorNombre[j.area];
    if (!areaId) { logL("⚠ Sin ID de área para: " + j.area); return; }

    if (existentes.includes(j.username.toLowerCase())) {
      logL("✔ Usuario ya existe: " + j.username);
      return;
    }

    usuSheet.appendRow([generarId(), j.username, hashPassword(PASSWORD_TEMP), "ADMIN", areaId, "TRUE", timestampActual()]);
    const lastRow = usuSheet.getLastRow();
    if (uIdx.EMAIL)  usuSheet.getRange(lastRow, uIdx.EMAIL).setValue(j.email);

    logL("✅ Usuario: " + j.username + " → " + j.area + " | " + j.email);
  });

  logL("════ FIN ════");
  logL("Contraseña temporal: " + PASSWORD_TEMP);
  logL("Próximo paso: editar cada usuario y agregar su CÉDULA para activar OMITIDO.");
  return lineas.join("\n");
}

// ─── MIGRACIÓN: AGREGAR COLUMNAS DE TIPO A COLABORADORES ─────
// Agrega AREAS_REQUERIDAS, TIPO_COLABORADOR, NIVEL_EDUCATIVO si no existen.
// Idempotente.
function migracionAgregarColsColaboradores() {
  const sheet  = getSheet(SHEETS.COLABORADORES);
  const cambios = [];

  const colsNecesarias = ["AREAS_REQUERIDAS", "TIPO_COLABORADOR", "NIVEL_EDUCATIVO"];
  colsNecesarias.forEach(col => {
    const hdr = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(h => String(h).trim());
    if (!hdr.includes(col)) {
      sheet.getRange(1, hdr.length + 1).setValue(col);
      cambios.push("Columna " + col + " agregada");
    }
  });

  Logger.log("migracionAgregarColsColaboradores: " + (cambios.length ? cambios.join(", ") : "columnas ya existían"));
  return cambios.length ? cambios.join(", ") : "Las columnas ya existían";
}

function accionMigracionColsColab(body) {
  const session = body._session;
  if (session.rol !== "SUPERADMIN") return { ok: false, error: "Solo SUPERADMIN puede ejecutar esto" };
  try {
    const resultado = migracionAgregarColsColaboradores();
    return { ok: true, mensaje: "Migración completada: " + resultado };
  } catch(e) {
    Logger.log("Error migracionAgregarColsColaboradores: " + e.toString());
    return { ok: false, error: e.message };
  }
}

// ─── MIGRACIÓN: AGREGAR COLUMNA TIPO A ÁREAS ───────────────
// Agrega columna TIPO a la hoja AREAS y clasifica cada área.
// Áreas académicas → DEPARTAMENTAL. Resto → GENERAL.
// Idempotente.
function migracionAgregarTipoAreas() {
  const AREAS_DEPARTAMENTALES = [
    "Matemáticas", "Lenguaje", "Ciencias Sociales", "Ciencias Naturales",
    "Inglés", "Artes", "Tecnología e Informática", "Educación Física"
  ];

  const sheet  = getSheet(SHEETS.AREAS);
  const hdrRow = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const headers = hdrRow.map(h => String(h).trim());
  const cambios = [];

  if (!headers.includes("TIPO")) {
    sheet.getRange(1, headers.length + 1).setValue("TIPO");
    cambios.push("Columna TIPO agregada");
  }

  // Re-leer para obtener índices actualizados
  const allData = sheet.getDataRange().getValues();
  const hdr2 = allData[0].map(h => String(h).trim());
  const colNombre = hdr2.indexOf("NOMBRE");
  const colTipo   = hdr2.indexOf("TIPO");

  if (colNombre < 0 || colTipo < 0) throw new Error("No se encontraron columnas NOMBRE o TIPO");

  let actualizadas = 0;
  for (let i = 1; i < allData.length; i++) {
    const nombre = String(allData[i][colNombre] || "").trim();
    if (!nombre) continue;
    const tipo = AREAS_DEPARTAMENTALES.includes(nombre) ? "DEPARTAMENTAL" : "GENERAL";
    const actual = String(allData[i][colTipo] || "").trim();
    if (actual !== tipo) {
      sheet.getRange(i + 1, colTipo + 1).setValue(tipo);
      actualizadas++;
    }
  }

  cambios.push("Áreas clasificadas: " + actualizadas + " actualizadas");
  Logger.log("migracionAgregarTipoAreas: " + cambios.join(", "));
  return cambios.join(", ");
}

function accionMigracionTipoAreas(body) {
  const session = body._session;
  if (session.rol !== "SUPERADMIN") return { ok: false, error: "Solo SUPERADMIN puede ejecutar esto" };
  try {
    const resultado = migracionAgregarTipoAreas();
    return { ok: true, mensaje: "Migración completada: " + resultado };
  } catch(e) {
    Logger.log("Error migracionAgregarTipoAreas: " + e.toString());
    return { ok: false, error: e.message };
  }
}

function accionAgregarJefesDeArea(body) {
  const session = body._session;
  if (session.rol !== "SUPERADMIN") return { ok: false, error: "Solo SUPERADMIN puede ejecutar esto" };
  try {
    const detalle = agregarJefesDeArea();
    return { ok: true, mensaje: "Setup completado. Revisa los Logs en el editor GAS para el detalle.", detalle };
  } catch(e) {
    Logger.log("Error agregarJefesDeArea: " + e.toString());
    return { ok: false, error: e.message };
  }
}

// ─── ACCIÓN: SET CONFIG (SUPERADMIN) ──────────────────────
function accionSetConfigSA(body) {
  const session = body._session;
  if (session.rol !== "SUPERADMIN") return { ok: false, error: "Acceso denegado" };

  const { clave, valor } = body;
  if (!clave) return { ok: false, error: "Clave requerida" };

  setConfigValor(clave, valor || "");
  registrarLog(session.username, session.rol, "SET_CONFIG", clave + " = " + (valor || ""));
  return { ok: true, mensaje: "Configuración guardada" };
}
