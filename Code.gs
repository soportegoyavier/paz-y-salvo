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

// ─── PUNTO DE ENTRADA HTTP ─────────────────────────────────
function doPost(e) {
  if (!e || !e.postData) {
    return respuesta({ ok: false, error: "doPost debe ejecutarse vía HTTP, no desde el editor de GAS" });
  }
  try {
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

    const token = crearSesion(usuario.ID, usuario.USERNAME, usuario.ROL, usuario.AREA_ID || "");
    registrarLog(usuario.USERNAME, usuario.ROL, "LOGIN_GOOGLE_OK", "Email: " + email);

    return {
      ok:         true,
      token,
      rol:        usuario.ROL,
      username:   usuario.USERNAME,
      email:      email,
      areaId:     usuario.AREA_ID || "",
      areaNombre: getNombreArea(usuario.AREA_ID)
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

  const usuarios = sheetToObjects(getSheet(SHEETS.USUARIOS));
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

  const modoLogin = String(body.modoLogin || "admin").toLowerCase();
  let areaIds;
  if (usuario.ROL === "ADMIN" || (usuario.ROL === "SUPERADMIN" && modoLogin === "admin")) {
    const porEmail = getAreaIdsDelAdmin(usuario, usuarios);
    const propia   = [usuario.AREA_ID].filter(Boolean);
    areaIds = [...new Set([...porEmail, ...propia])];
  } else {
    areaIds = [usuario.AREA_ID].filter(Boolean);
  }
  const token    = crearSesion(usuario.ID, usuario.USERNAME, usuario.ROL, areaIds.join(","));
  registrarLog(usuario.USERNAME, usuario.ROL, "LOGIN_OK", "Inicio de sesión exitoso");

  return {
    ok: true,
    token,
    rol:         usuario.ROL,
    username:    usuario.USERNAME,
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

  const colaboradores = sheetToObjects(getSheet(SHEETS.COLABORADORES));

  // Buscar sin importar puntos, espacios o ceros a la izquierda
  const normalizar = v => String(v).trim().replace(/\D/g, "").replace(/^0+/, "");
  const cedulaNorm  = normalizar(cedula);

  const colaborador = colaboradores.find(c =>
    normalizar(c.CEDULA) === cedulaNorm && esTrue(c.ACTIVO)
  );

  if (!colaborador) {
    // ¿existe pero inactivo?
    const inactivo = colaboradores.find(c => normalizar(c.CEDULA) === cedulaNorm);
    if (inactivo) return { ok: false, error: "Tu registro está inactivo. Contacta al administrador." };
    return { ok: false, error: "Cédula " + cedula + " no está registrada en el sistema. Verifica el número o contacta al administrador." };
  }

  const areas = sheetToObjects(getSheet(SHEETS.AREAS)).filter(a => esTrue(a.ACTIVO));
  const aprobaciones = sheetToObjects(getSheet(SHEETS.APROBACIONES));
  const usuarios = sheetToObjects(getSheet(SHEETS.USUARIOS));

  // Áreas que el usuario de la sesión administra (aplica a ADMIN y SUPERADMIN)
  const areasAdminSession = session.rol === "SUPERADMIN"
    ? areas.map(a => String(a.ID))                            // superadmin gestiona todas
    : (session.areaIds && session.areaIds.length
        ? session.areaIds.map(String)
        : [session.areaId].filter(Boolean).map(String));      // admin gestiona las suyas

  const estadoPorArea = areas.map(area => {
    const adminDeArea = usuarios.find(u =>
      String(u.AREA_ID) === String(area.ID) &&
      u.ROL === "ADMIN" &&
      esTrue(u.ACTIVO)
    );

    // ADMIN/SUPERADMIN no requieren aprobación en las áreas que ellos gestionan
    if (areasAdminSession.includes(String(area.ID))) {
      const yaAprobado = aprobaciones.some(a =>
        String(a.COLABORADOR_ID) === String(colaborador.ID) &&
        String(a.AREA_ID) === String(area.ID) && a.ESTADO === "APROBADO"
      );
      if (!yaAprobado) {
        getSheet(SHEETS.APROBACIONES).appendRow([
          generarId(), colaborador.ID, area.ID, "APROBADO",
          "Aprobación automática (administrador del área)", session.username, timestampActual()
        ]);
        aprobaciones.push({
          COLABORADOR_ID: String(colaborador.ID), AREA_ID: String(area.ID),
          ESTADO: "APROBADO", OBSERVACIONES: "", APROBADO_POR: session.username
        });
      }
      return {
        areaId: area.ID,
        areaNombre: area.NOMBRE,
        estado: "APROBADO",
        observaciones: "",
        aprobadoPor: session.username,
        adminUsername: session.username
      };
    }

    const ap = aprobaciones.find(a =>
      String(a.COLABORADOR_ID) === String(colaborador.ID) && String(a.AREA_ID) === String(area.ID)
    );
    return {
      areaId: area.ID,
      areaNombre: area.NOMBRE,
      estado: ap ? ap.ESTADO : "PENDIENTE",
      observaciones: ap ? ap.OBSERVACIONES : "",
      aprobadoPor: ap ? ap.APROBADO_POR : "",
      adminUsername: adminDeArea ? adminDeArea.USERNAME : null
    };
  });

  const pazYSalvoCompleto = esTrue(colaborador.REQUIERE_PAZ_SALVO)
    ? estadoPorArea.length > 0 && estadoPorArea.every(a => a.estado === "APROBADO")
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
  const todasAreas = sheetToObjects(getSheet(SHEETS.AREAS));
  const colaboradores = sheetToObjects(getSheet(SHEETS.COLABORADORES))
    .filter(c => esTrue(c.ACTIVO) && esTrue(c.REQUIERE_PAZ_SALVO));
  const aprobaciones = sheetToObjects(getSheet(SHEETS.APROBACIONES));

  const areas = areaIds.map(areaId => {
    const info = todasAreas.find(a => String(a.ID) === String(areaId));
    return {
      areaId,
      areaNombre: info ? info.NOMBRE : areaId,
      colaboradores: colaboradores.map(c => {
        const ap = aprobaciones.find(a =>
          String(a.COLABORADOR_ID) === String(c.ID) && String(a.AREA_ID) === String(areaId)
        );
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

  const colaboradores = sheetToObjects(getSheet(SHEETS.COLABORADORES));
  const areas = sheetToObjects(getSheet(SHEETS.AREAS)).filter(a => esTrue(a.ACTIVO));
  const aprobaciones = sheetToObjects(getSheet(SHEETS.APROBACIONES));
  const codigos = sheetToObjects(getSheet(SHEETS.CODIGOS));

  const resultado = colaboradores.map(c => {
    const estadoPorArea = areas.map(area => {
      const ap = aprobaciones.find(a =>
        String(a.COLABORADOR_ID) === String(c.ID) && String(a.AREA_ID) === String(area.ID)
      );
      return {
        areaId: area.ID,
        areaNombre: area.NOMBRE,
        estado: ap ? ap.ESTADO : "PENDIENTE"
      };
    });

    const todasAprobadas = estadoPorArea.length > 0 && estadoPorArea.every(a => a.estado === "APROBADO");
    const tieneDocumento = todasAprobadas && codigos.some(cd =>
      String(cd.COLABORADOR_ID) === String(c.ID) && esTrue(cd.ACTIVO)
    );

    return {
      id: c.ID,
      nombre: c.NOMBRE,
      cedula: c.CEDULA,
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

  const { nombre, cedula, requierePazSalvo } = body;
  if (!nombre || !cedula) return { ok: false, error: "Nombre y cédula son obligatorios" };

  const colaboradores = sheetToObjects(getSheet(SHEETS.COLABORADORES));
  if (colaboradores.find(c => String(c.CEDULA) === String(cedula))) {
    return { ok: false, error: "Ya existe un colaborador con esa cédula" };
  }

  const id = generarId();
  getSheet(SHEETS.COLABORADORES).appendRow([
    id, nombre.trim(), cedula.trim(), "TRUE", requierePazSalvo ? "TRUE" : "FALSE", timestampActual()
  ]);

  registrarLog(session.username, session.rol, "CREAR_COLABORADOR", `${nombre} (${cedula})`);
  return { ok: true, mensaje: "Colaborador creado correctamente", id };
}

// ─── ACCIÓN: EDITAR COLABORADOR ────────────────────────────
function accionEditarColaborador(body) {
  const session = body._session;
  if (session.rol !== "SUPERADMIN") return { ok: false, error: "Acceso denegado" };

  const { id, nombre, cedula, activo } = body;
  if (!id) return { ok: false, error: "ID requerido" };

  const sheet = getSheet(SHEETS.COLABORADORES);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const colIdx = {};
  headers.forEach((h, i) => colIdx[h] = i);

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][colIdx.ID]) === String(id)) {
      if (nombre) sheet.getRange(i + 1, colIdx.NOMBRE + 1).setValue(nombre.trim());
      if (cedula) sheet.getRange(i + 1, colIdx.CEDULA + 1).setValue(cedula.trim());
      if (activo !== undefined) sheet.getRange(i + 1, colIdx.ACTIVO + 1).setValue(activo ? "TRUE" : "FALSE");
      registrarLog(session.username, session.rol, "EDITAR_COLABORADOR", `ID: ${id}`);
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

  const usuarios = sheetToObjects(getSheet(SHEETS.USUARIOS));
  const resultado = usuarios.map(u => ({
    id: u.ID,
    username: u.USERNAME,
    rol: u.ROL,
    areaId: u.AREA_ID || "",
    areaNombre: getNombreArea(u.AREA_ID),
    email: u.EMAIL || "",
    activo: esTrue(u.ACTIVO)
  }));

  return { ok: true, usuarios: resultado };
}

// ─── ACCIÓN: CREAR USUARIO ─────────────────────────────────
function accionCrearUsuario(body) {
  const session = body._session;
  if (session.rol !== "SUPERADMIN") return { ok: false, error: "Acceso denegado" };

  const { username, password, rol, areaId } = body;
  if (!username || !password || !rol) return { ok: false, error: "Campos obligatorios incompletos" };
  if (!["ADMIN", "COLABORADOR"].includes(rol)) return { ok: false, error: "Rol no válido" };
  if (password.length < 6) return { ok: false, error: "La contraseña debe tener al menos 6 caracteres" };

  const usuarios = sheetToObjects(getSheet(SHEETS.USUARIOS));
  if (usuarios.find(u => String(u.USERNAME).toLowerCase() === String(username).toLowerCase())) {
    return { ok: false, error: "El nombre de usuario ya existe" };
  }

  const id = generarId();
  getSheet(SHEETS.USUARIOS).appendRow([
    id, username.trim(), hashPassword(password), rol, areaId || "", "TRUE", timestampActual()
  ]);

  registrarLog(session.username, session.rol, "CREAR_USUARIO", `${username} (${rol})`);
  return { ok: true, mensaje: "Usuario creado correctamente", id };
}

// ─── ACCIÓN: EDITAR USUARIO ────────────────────────────────
function accionEditarUsuario(body) {
  const session = body._session;
  if (session.rol !== "SUPERADMIN") return { ok: false, error: "Acceso denegado" };

  const { id, areaId, activo, nuevaPassword, email } = body;
  if (!id) return { ok: false, error: "ID requerido" };

  const sheet = getSheet(SHEETS.USUARIOS);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const colIdx = {};
  headers.forEach((h, i) => colIdx[h] = i);

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

  const colaboradores = sheetToObjects(getSheet(SHEETS.COLABORADORES))
    .filter(c => esTrue(c.ACTIVO));
  const areas = sheetToObjects(getSheet(SHEETS.AREAS)).filter(a => esTrue(a.ACTIVO));
  const aprobaciones = sheetToObjects(getSheet(SHEETS.APROBACIONES));
  const usuarios = sheetToObjects(getSheet(SHEETS.USUARIOS));

  const resultado = colaboradores.map(c => {
    const estadoPorArea = areas.map(area => {
      const ap = aprobaciones.find(a =>
        String(a.COLABORADOR_ID) === String(c.ID) && String(a.AREA_ID) === String(area.ID)
      );
      return {
        areaId: area.ID,
        areaNombre: area.NOMBRE,
        estado: ap ? ap.ESTADO : "PENDIENTE",
        aprobadoPor: ap ? ap.APROBADO_POR : "",
        fecha: ap ? ap.FECHA_ACCION : ""
      };
    });

    const todasAprobadas = esTrue(c.REQUIERE_PAZ_SALVO) &&
      estadoPorArea.length > 0 && estadoPorArea.every(a => a.estado === "APROBADO");
    const pendientes = estadoPorArea.filter(a => a.estado !== "APROBADO").map(a => a.areaNombre);

    return {
      id: c.ID,
      nombre: c.NOMBRE,
      cedula: c.CEDULA,
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

  const colaboradores = sheetToObjects(getSheet(SHEETS.COLABORADORES));
  const colaborador = colaboradores.find(c => String(c.ID) === String(colaboradorId));
  if (!colaborador) return { ok: false, error: "Colaborador no encontrado" };
  if (!esTrue(colaborador.ACTIVO)) return { ok: false, error: "El colaborador no está activo" };

  const areas = sheetToObjects(getSheet(SHEETS.AREAS)).filter(a => esTrue(a.ACTIVO));
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

  const colaboradores = sheetToObjects(getSheet(SHEETS.COLABORADORES));
  const colaborador = colaboradores.find(c => c.ID === colaboradorId);
  if (!colaborador) return { ok: false, error: "Colaborador no encontrado" };

  const areas = sheetToObjects(getSheet(SHEETS.AREAS)).filter(a => esTrue(a.ACTIVO));
  const aprobaciones = sheetToObjects(getSheet(SHEETS.APROBACIONES));

  const todasAprobadas = areas.length > 0 && areas.every(area => {
    return aprobaciones.some(a =>
      String(a.COLABORADOR_ID) === String(colaboradorId) &&
      String(a.AREA_ID) === String(area.ID) &&
      a.ESTADO === "APROBADO"
    );
  });

  if (!todasAprobadas) {
    return { ok: false, error: "El colaborador no tiene todas las áreas aprobadas" };
  }

  // Buscar código existente para este colaborador en el año en curso
  const anoActual = new Date().getFullYear().toString();
  const codigos = sheetToObjects(getSheet(SHEETS.CODIGOS));
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
  }

  const detalleAreas = areas.map(area => {
    const ap = aprobaciones.find(a =>
      String(a.COLABORADOR_ID) === String(colaboradorId) && String(a.AREA_ID) === String(area.ID)
    );
    return {
      nombre: area.NOMBRE,
      responsable: ap ? ap.APROBADO_POR : "",
      fecha: ap ? ap.FECHA_ACCION : ""
    };
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

  const codigos = sheetToObjects(getSheet(SHEETS.CODIGOS));
  const entrada = codigos.find(c =>
    String(c.CODIGO).toUpperCase() === String(codigo).toUpperCase() &&
    esTrue(c.ACTIVO)
  );

  if (!entrada) {
    return { ok: false, valido: false, mensaje: "Código no válido o inexistente" };
  }

  const colaboradores = sheetToObjects(getSheet(SHEETS.COLABORADORES));
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
  const areas = sheetToObjects(getSheet(SHEETS.AREAS))
    .filter(a => esTrue(a.ACTIVO))
    .map(a => ({ id: a.ID, nombre: a.NOMBRE }));
  return { ok: true, areas };
}

// ─── ACCIÓN: GET LOGS ──────────────────────────────────────
function accionGetLogs(body) {
  const session = body._session;
  if (session.rol !== "SUPERADMIN") return { ok: false, error: "Acceso denegado" };

  const logs = sheetToObjects(getSheet(SHEETS.LOGS));
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

// Devuelve todos los AREA_ID que gestiona un admin (mismo email → misma persona)
function getAreaIdsDelAdmin(usuario, todosUsuarios) {
  const email = String(usuario.EMAIL || "").toLowerCase().trim();
  if (!email) return [usuario.AREA_ID].filter(Boolean);
  return todosUsuarios
    .filter(u => u.ROL === "ADMIN" && esTrue(u.ACTIVO) &&
                 String(u.EMAIL || "").toLowerCase().trim() === email && u.AREA_ID)
    .map(u => String(u.AREA_ID))
    .filter((v, i, a) => a.indexOf(v) === i); // unique
}

function getNombreArea(areaId) {
  if (!areaId) return "";
  const areas = sheetToObjects(getSheet(SHEETS.AREAS));
  const area = areas.find(a => String(a.ID) === String(areaId));
  return area ? area.NOMBRE : areaId;
}

// ─── DIAGNÓSTICO: APROBACIONES vs AREAS ─────────────────────
// Muestra si los AREA_IDs en USUARIOS y APROBACIONES coinciden con AREAS.ID.
// Si hay huérfanos → correr reparar_area_ids.
function accionDiagnosticoAprobaciones(body) {
  const session = body._session;
  if (session.rol !== "SUPERADMIN") return { ok: false, error: "Acceso denegado" };

  const { colaboradorId } = body;
  const areas        = sheetToObjects(getSheet(SHEETS.AREAS));
  const areasActivas = areas.filter(a => esTrue(a.ACTIVO));
  const areaIdSet    = new Set(areasActivas.map(a => String(a.ID).trim()));

  const todasAprobaciones = sheetToObjects(getSheet(SHEETS.APROBACIONES));
  const aprobaciones      = colaboradorId
    ? todasAprobaciones.filter(a => String(a.COLABORADOR_ID).trim() === String(colaboradorId).trim())
    : todasAprobaciones;
  const usuarios = sheetToObjects(getSheet(SHEETS.USUARIOS));

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
    "administradora":    "Administradora General",
    "coord.adm":         "Coord. Administrativa",
    "rectora":           "Rectora"
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

  const colaboradores = sheetToObjects(getSheet(SHEETS.COLABORADORES));
  const colaborador   = colaboradores.find(c => String(c.ID) === String(colaboradorId));
  if (!colaborador) return { ok: false, error: "Colaborador no encontrado" };

  const areas        = sheetToObjects(getSheet(SHEETS.AREAS)).filter(a => esTrue(a.ACTIVO));
  const aprobaciones = sheetToObjects(getSheet(SHEETS.APROBACIONES));
  const usuarios     = sheetToObjects(getSheet(SHEETS.USUARIOS));

  const estadoPorArea = areas.map(area => {
    const ap = aprobaciones.find(a =>
      String(a.COLABORADOR_ID) === String(colaboradorId) &&
      String(a.AREA_ID) === String(area.ID)
    );
    const adminDeArea = usuarios.find(u =>
      String(u.AREA_ID) === String(area.ID) && u.ROL === "ADMIN" && esTrue(u.ACTIVO)
    );
    return {
      areaId:       area.ID,
      areaNombre:   area.NOMBRE,
      estado:       ap ? ap.ESTADO : "PENDIENTE",
      aprobadoPor:  ap ? ap.APROBADO_POR : "",
      fecha:        ap ? ap.FECHA_ACCION : "",
      adminUsername: adminDeArea ? adminDeArea.USERNAME : null,
      adminEmail:    adminDeArea ? (adminDeArea.EMAIL || "") : ""
    };
  });

  const todasAprobadas = esTrue(colaborador.REQUIERE_PAZ_SALVO) &&
    estadoPorArea.length > 0 && estadoPorArea.every(a => a.estado === "APROBADO");

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

  const colaboradores = sheetToObjects(getSheet(SHEETS.COLABORADORES));
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

  const areas        = sheetToObjects(getSheet(SHEETS.AREAS)).filter(a => esTrue(a.ACTIVO));
  const aprobaciones = sheetToObjects(getSheet(SHEETS.APROBACIONES));
  const usuarios     = sheetToObjects(getSheet(SHEETS.USUARIOS));
  const institucion  = getConfigValor("INSTITUCION_NOMBRE") || "Colegio Campestre Goyavier";

  const areasPendientes = areas.filter(area =>
    !aprobaciones.some(a =>
      String(a.COLABORADOR_ID) === String(colaborador.ID) &&
      String(a.AREA_ID) === String(area.ID) &&
      a.ESTADO === "APROBADO"
    )
  );

  if (!areasPendientes.length) {
    return { ok: false, error: "El colaborador ya tiene todas las áreas aprobadas" };
  }

  let enviados = 0;
  const errores = [];
  const nombresEnviados = [];

  areasPendientes.forEach(area => {
    const adminArea = usuarios.find(u =>
      String(u.AREA_ID) === String(area.ID) && u.ROL === "ADMIN" &&
      esTrue(u.ACTIVO) && u.EMAIL
    );
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
    USUARIOS:      ["ID", "USERNAME", "PASSWORD_HASH", "ROL", "AREA_ID", "ACTIVO", "FECHA_CREACION"],
    AREAS:         ["ID", "NOMBRE", "DESCRIPCION", "ACTIVO"],
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
    { username: "administradora",     areaNombre: "Administradora General"        },
    { username: "coord.adm",          areaNombre: "Coord. Administrativa"         },
    { username: "rectora",            areaNombre: "Rectora"                       },
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

  const areas = [
    ["Secretaría Académica",          "Secretaría y gestión académica"],
    ["Responsable de Tecnología",     "Área de tecnología e infraestructura"],
    ["Responsable de Biblioteca",     "Gestión de biblioteca y recursos"],
    ["Coord. Preescolar",             "Coordinación de preescolar"],
    ["Coord. General de Convivencia", "Coordinación de convivencia escolar"],
    ["Coord. General Académica",      "Coordinación académica general"],
    ["Coord. Académica Primaria",     "Coordinación académica de primaria"],
    ["Jefe de Área",                  "Jefatura de área docente"],
    ["Administradora General",        "Administración general del colegio"],
    ["Coord. Administrativa",         "Coordinación administrativa"],
    ["Rectora",                       "Rectoría del colegio"],
  ];

  areas.forEach(([nombre, desc]) => {
    sheet.appendRow([generarId(), nombre, desc, "TRUE"]);
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

    const usuarios = sheetToObjects(getSheet(SHEETS.USUARIOS));

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
    const modoLogin = String(body.modoLogin || "admin").toLowerCase();
    const prioridad = { SUPERADMIN: 3, ADMIN: 2, COLABORADOR: 1 };
    let usuario;
    if (modoLogin === "colaborador") {
      usuario = cuentas.find(u => u.ROL === "COLABORADOR") || cuentas[0];
    } else {
      usuario = cuentas.slice().sort((a, b) =>
        (prioridad[b.ROL] || 0) - (prioridad[a.ROL] || 0)
      )[0];
    }

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

    const todosUsuarios = sheetToObjects(getSheet(SHEETS.USUARIOS));
    let areaIds;
    if (usuario.ROL === "ADMIN" || (usuario.ROL === "SUPERADMIN" && modoLogin === "admin")) {
      const porEmail = getAreaIdsDelAdmin(usuario, todosUsuarios);
      const propia   = [usuario.AREA_ID].filter(Boolean);
      areaIds = [...new Set([...porEmail, ...propia])];
    } else {
      areaIds = [usuario.AREA_ID].filter(Boolean);
    }
    const token    = crearSesion(usuario.ID, usuario.USERNAME, usuario.ROL, areaIds.join(","));
    registrarLog(usuario.USERNAME, usuario.ROL, "LOGIN_GOOGLE_OK", "Email: " + emailGoogle);

    return {
      ok: true,
      token,
      rol:         usuario.ROL,
      username:    usuario.USERNAME,
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
  const colaboradores = sheetToObjects(getSheet(SHEETS.COLABORADORES));
  const colaborador   = colaboradores.find(c => String(c.CEDULA) === String(cedula));
  if (!colaborador) return { ok: false, error: "Colaborador no encontrado" };

  const areas        = sheetToObjects(getSheet(SHEETS.AREAS)).filter(a => esTrue(a.ACTIVO));
  const aprobaciones = sheetToObjects(getSheet(SHEETS.APROBACIONES));

  const todasAprobadas = areas.length > 0 && areas.every(area =>
    aprobaciones.some(a =>
      String(a.COLABORADOR_ID) === String(colaborador.ID) &&
      String(a.AREA_ID)        === String(area.ID) &&
      a.ESTADO === "APROBADO"
    )
  );
  if (!todasAprobadas) return { ok: false, error: "No tienes todas las áreas aprobadas aún" };

  // Obtener o crear código de verificación (uno por colaborador por año, inmutable)
  const anoActual    = new Date().getFullYear().toString();
  const codigosSheet = getSheet(SHEETS.CODIGOS);
  const codigos      = sheetToObjects(codigosSheet);
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
    codigo = { CODIGO: nuevoCodigo, FECHA_EMISION: fechaEmisionCodigo };
  } else {
    fechaEmisionCodigo = _strFecha(codigo.FECHA_EMISION);
  }

  const emailTH     = getConfigValor("EMAIL_TALENTO_HUMANO") || "";
  const institucion = getConfigValor("INSTITUCION_NOMBRE") || "Colegio Campestre Goyavier";

  // Construir detalle de áreas para el PDF
  const detalleAreas = areas.map(area => {
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

  const colaboradores = sheetToObjects(getSheet(SHEETS.COLABORADORES));
  const colaborador   = colaboradores.find(c => c.ID === colaboradorId);
  if (!colaborador) return { ok: false, error: "Colaborador no encontrado" };

  const areas        = sheetToObjects(getSheet(SHEETS.AREAS)).filter(a => esTrue(a.ACTIVO));
  const aprobaciones = sheetToObjects(getSheet(SHEETS.APROBACIONES));

  const todasAprobadas = areas.length > 0 && areas.every(area =>
    aprobaciones.some(a =>
      String(a.COLABORADOR_ID) === String(colaboradorId) &&
      String(a.AREA_ID)        === String(area.ID) &&
      a.ESTADO === "APROBADO"
    )
  );
  if (!todasAprobadas) return { ok: false, error: "El colaborador no tiene todas las áreas aprobadas" };

  const anoActual = new Date().getFullYear().toString();
  const codigos   = sheetToObjects(getSheet(SHEETS.CODIGOS));
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
  }

  const detalleAreas = areas.map(area => {
    const ap = aprobaciones.find(a =>
      String(a.COLABORADOR_ID) === String(colaboradorId) &&
      String(a.AREA_ID) === String(area.ID)
    );
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

  const colaboradores = sheetToObjects(getSheet(SHEETS.COLABORADORES));
  const colaborador   = colaboradores.find(c => c.ID === colaboradorId);
  if (!colaborador) return { ok: false, error: "Colaborador no encontrado" };

  const areas        = sheetToObjects(getSheet(SHEETS.AREAS)).filter(a => esTrue(a.ACTIVO));
  const aprobaciones = sheetToObjects(getSheet(SHEETS.APROBACIONES));

  const todasAprobadas = areas.length > 0 && areas.every(area =>
    aprobaciones.some(a =>
      String(a.COLABORADOR_ID) === String(colaboradorId) &&
      String(a.AREA_ID)        === String(area.ID) &&
      a.ESTADO === "APROBADO"
    )
  );
  if (!todasAprobadas) return { ok: false, error: "El colaborador no tiene todas las áreas aprobadas" };

  const anoActual = new Date().getFullYear().toString();
  const codigos   = sheetToObjects(getSheet(SHEETS.CODIGOS));
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
  }

  const detalleAreas = areas.map(area => {
    const ap = aprobaciones.find(a =>
      String(a.COLABORADOR_ID) === String(colaboradorId) &&
      String(a.AREA_ID) === String(area.ID)
    );
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
