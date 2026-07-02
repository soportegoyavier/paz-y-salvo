import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import nodemailer from 'npm:nodemailer@6'
import { PDFDocument, StandardFonts, rgb, PDFFont } from 'npm:pdf-lib@1.17.1'
import { encodeBase64 } from 'jsr:@std/encoding/base64'

// ─── SETUP ────────────────────────────────────────────────────────────────────
const supabase: SupabaseClient = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } }
)

// Cliente anon — solo para verificar contraseñas de usuario (signInWithPassword)
const supabaseAnon: SupabaseClient = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_ANON_KEY')!,
  { auth: { persistSession: false } }
)

const ALLOWED_ORIGINS = new Set([
  'https://pazysalvogoyavier.netlify.app',
  'https://portalgoyavier.netlify.app',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
])

function getCorsHeaders(origin: string) {
  const allowed = ALLOWED_ORIGINS.has(origin) ? origin : 'https://pazysalvogoyavier.netlify.app'
  return {
    'Access-Control-Allow-Origin':  allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Vary': 'Origin',
  }
}

function jsonResp(data: unknown, status = 200, origin = '') {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...getCorsHeaders(origin), 'Content-Type': 'application/json' },
  })
}

// ─── TIPOS ────────────────────────────────────────────────────────────────────
interface SessionData {
  usuarioId:  string   // ps_usuarios.id
  authUserId: string   // auth.users.id (JWT sub)
  username:   string
  email:      string
  rol:        string
  areaId:     string
  areaIds:    string[]
  cedula:     string
}

type Body = Record<string, unknown>

// ─── UTILIDADES ───────────────────────────────────────────────────────────────
function normCedula(v: string): string {
  return String(v).trim().replace(/\D/g, '').replace(/^0+/, '')
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim())
}

function escHtml(s: unknown): string {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;')
}

// ─── LOG ──────────────────────────────────────────────────────────────────────
async function log(usuario: string, rol: string, accion: string, detalle: string) {
  await supabase.from('ps_logs').insert({ usuario: usuario || 'SISTEMA', rol: rol || '-', accion, detalle: detalle || '' })
}

// ─── CONFIG ───────────────────────────────────────────────────────────────────
async function getConfig(clave: string): Promise<string> {
  const { data } = await supabase.from('ps_config').select('valor').eq('clave', clave).single()
  return data?.valor ?? ''
}

async function setConfig(clave: string, valor: string) {
  await supabase.from('ps_config').upsert({ clave, valor }, { onConflict: 'clave' })
}

async function procesoActivo(): Promise<boolean> {
  return (await getConfig('PROCESO_ACTIVO')) === 'TRUE'
}

// ─── EMAIL (SMTP) ─────────────────────────────────────────────────────────────
async function enviarCorreo(
  to: string, subject: string, html: string,
  attachments?: { filename: string; content: string; encoding: string; contentType: string }[]
): Promise<{ ok: boolean; error?: string }> {
  const host = Deno.env.get('SMTP_HOST')
  const port = parseInt(Deno.env.get('SMTP_PORT') ?? '587')
  const user = Deno.env.get('SMTP_USER')
  const pass = Deno.env.get('SMTP_PASS')
  const from = Deno.env.get('SMTP_FROM') ?? user

  if (!host || !user || !pass) return { ok: false, error: 'SMTP no configurado' }

  try {
    const transporter = nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass } })
    await transporter.sendMail({ from, to, subject, html, attachments })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// ─── HELPERS DE NEGOCIO ───────────────────────────────────────────────────────
function generarPasswordDefault(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
  let pwd = ''
  const arr = new Uint8Array(8)
  crypto.getRandomValues(arr)
  for (const b of arr) pwd += chars[b % chars.length]
  return pwd
}

async function emailCredenciales(to: string, username: string, password: string): Promise<void> {
  await enviarCorreo(
    to,
    'Credenciales de acceso — Sistema de Paz y Salvo',
    `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto">
       <h2 style="color:#1e3a5f;margin-bottom:0.5rem">Sistema de Paz y Salvo</h2>
       <p style="color:#475569;margin-bottom:1.25rem">Colegio Campestre Goyavier</p>
       <p>Tu cuenta de acceso está lista. Usa estas credenciales para ingresar:</p>
       <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:15px">
         <tr>
           <td style="padding:10px 14px;background:#f1f5f9;font-weight:bold;border:1px solid #e2e8f0;width:45%">Usuario</td>
           <td style="padding:10px 14px;border:1px solid #e2e8f0;font-family:monospace">${escHtml(username)}</td>
         </tr>
         <tr>
           <td style="padding:10px 14px;background:#f1f5f9;font-weight:bold;border:1px solid #e2e8f0">Contraseña temporal</td>
           <td style="padding:10px 14px;border:1px solid #e2e8f0;font-family:monospace;font-size:16px;letter-spacing:1px">${password}</td>
         </tr>
       </table>
       <p style="color:#dc2626;font-size:0.875rem;margin-bottom:1.5rem">
         <strong>Al ingresar por primera vez deberás cambiar esta contraseña temporal.</strong>
       </p>
       <p style="text-align:center;margin:24px 0">
         <a href="https://pazysalvogoyavier.netlify.app"
            style="background:#1e3a5f;color:#fff;text-decoration:none;padding:12px 28px;border-radius:6px;font-weight:bold;font-size:15px;display:inline-block">
           Iniciar sesión
         </a>
       </p>
       <hr style="margin:16px 0;border:none;border-top:1px solid #eee">
       <p style="color:#888;font-size:12px">Sistema de Paz y Salvo — Colegio Campestre Goyavier</p>
     </div>`
  )
}

async function revocarCodigosColaborador(colaboradorId: string, motivo: 'REVOCADO' | 'REEMPLAZADO') {
  await supabase.from('ps_codigos_verificacion')
    .update({ activo: false, motivo_inactivacion: motivo })
    .eq('colaborador_id', colaboradorId)
    .eq('activo', true)
}

async function getAreaIdsDelColaborador(cedula: string): Promise<string[]> {
  if (!cedula) return []
  const c = normCedula(cedula)
  const { data } = await supabase.from('ps_usuarios').select('cedula, area_ids').eq('rol', 'ADMIN').eq('activo', true)
  const ids = new Set<string>()
  for (const u of data ?? []) {
    if (normCedula(u.cedula) === c) for (const id of u.area_ids ?? []) ids.add(id)
  }
  return [...ids]
}

async function getNombreAprobador(username: string): Promise<string> {
  if (!username) return ''
  const { data: u } = await supabase.from('ps_usuarios').select('cedula').eq('username', username).maybeSingle()
  if (!u?.cedula) return username
  const { data: c } = await supabase.from('ps_colaboradores').select('nombre').eq('cedula', u.cedula).maybeSingle()
  return c?.nombre ?? username
}

// deno-lint-ignore no-explicit-any
function getAreasRequeridas(colaborador: Record<string, any>, areas: Record<string, any>[]): Record<string, any>[] {
  const tipo   = String(colaborador.tipo_colaborador || '').toUpperCase().trim()
  const nivel  = String(colaborador.nivel_educativo  || '').toUpperCase().trim()
  const jefeId = String(colaborador.areas_requeridas || '')

  if (areas.some(a => String(a.aplica_a || '').trim())) {
    const res = areas.filter(a => {
      const ap = String(a.aplica_a || '').toUpperCase()
      if (!ap) return false
      const tipos = ap.split(',').map(t => t.trim())
      if (!tipos.includes(tipo) && !tipos.includes('TODOS')) return false
      const apn = String(a.aplica_nivel || '').toUpperCase()
      if (apn) {
        const niveles = apn.split(',').map(n => n.trim())
        if (!niveles.includes(nivel)) return false
      }
      return true
    })
    // Siempre incluir el área departamental asignada (jefeId) aunque tenga aplica_a vacío
    if (jefeId) {
      const jefe = areas.find(a => a.id === jefeId)
      if (jefe && !res.find(r => r.id === jefeId)) res.push(jefe)
    }
    return res
  }

  if (!tipo) return areas
  let nombres: Set<string>
  if (tipo === 'DOCENTE') {
    nombres = new Set(['Secretaría Académica', 'Responsable de Tecnología', 'Responsable de Biblioteca',
      'Coord. General de Convivencia', 'Restaurante', 'Rectora'])
    if      (nivel === 'PREESCOLAR') nombres.add('Coord. Preescolar')
    else if (nivel === 'PRIMARIA')   nombres.add('Coord. Académica Primaria')
    else                             nombres.add('Coord. General Académica')
  } else if (tipo === 'ADMINISTRATIVO') {
    nombres = new Set(['Secretaría Académica', 'Responsable de Tecnología', 'Responsable de Biblioteca',
      'Restaurante', 'Coord. Administrativa', 'Rectora'])
  } else if (tipo === 'SERVICIOS') {
    nombres = new Set(['Responsable de Tecnología', 'Responsable de Biblioteca',
      'Jefe de Área', 'Restaurante', 'Rectora'])
  } else {
    return areas
  }

  const res = areas.filter(a => nombres.has(String(a.nombre)))
  if (jefeId) {
    const jefe = areas.find(a => a.id === jefeId)
    if (jefe && !res.find(r => r.id === jefeId)) res.push(jefe)
  }
  return res
}

// ─── COLABORADOR: MI ESTADO ───────────────────────────────────────────────────
async function accionGetMiEstado(body: Body) {
  const cedula = String(body.cedula || '').trim()
  if (!cedula) return { ok: false, error: 'Cédula requerida' }
  const cNorm = normCedula(cedula)

  const { data: colabs } = await supabase.from('ps_colaboradores').select('*').eq('activo', true)
  const c = colabs?.find(col => normCedula(col.cedula) === cNorm)
  if (!c) {
    const { data: inact } = await supabase.from('ps_colaboradores').select('id').ilike('cedula', cedula).maybeSingle()
    return { ok: false, error: inact
      ? 'Tu registro está inactivo. Contacta al administrador.'
      : `Cédula ${cedula} no está registrada.` }
  }

  const { data: areasAll } = await supabase.from('ps_areas').select('*').eq('activo', true)
  const areas = getAreasRequeridas(c, areasAll ?? [])
  const areasOmitidas = new Set(await getAreaIdsDelColaborador(c.cedula))
  const { data: aprobs } = await supabase.from('ps_aprobaciones').select('*').eq('colaborador_id', c.id)
  const aprobMap: Record<string, Record<string, unknown>> = {}
  for (const a of aprobs ?? []) aprobMap[a.area_id] = a

  const estadoPorArea = areas.map(area => {
    if (areasOmitidas.has(area.id))
      return { areaId: area.id, areaNombre: area.nombre, estado: 'OMITIDO',
               observaciones: 'Área propia — no requiere aprobación externa', aprobadoPor: '' }
    const ap = aprobMap[area.id]
    return { areaId: area.id, areaNombre: area.nombre,
             estado: ap ? ap.estado : 'PENDIENTE',
             observaciones: ap ? ap.observaciones : '',
             aprobadoPor: ap ? ap.aprobado_por : '' }
  })

  const areasReq = estadoPorArea.filter(a => a.estado !== 'OMITIDO')
  const pazYSalvoCompleto = c.requiere_paz_salvo && areasReq.length > 0 && areasReq.every(a => a.estado === 'APROBADO')
  return { ok: true,
    colaborador: { id: c.id, nombre: c.nombre, cedula: c.cedula },
    estadoPorArea, pazYSalvoCompleto, requierePazSalvo: c.requiere_paz_salvo }
}

// ─── ADMIN: COLABORADORES DE ÁREA ────────────────────────────────────────────
async function accionGetColaboradoresArea(ses: SessionData) {
  const areaIds = ses.areaIds.length ? ses.areaIds : [ses.areaId].filter(Boolean)
  const { data: areasAll }  = await supabase.from('ps_areas').select('*').eq('activo', true)
  const { data: colabs }    = await supabase.from('ps_colaboradores').select('*').eq('activo', true).eq('requiere_paz_salvo', true)
  const { data: aprobs }    = await supabase.from('ps_aprobaciones').select('*')
  const { data: usuarios }  = await supabase.from('ps_usuarios').select('cedula, area_ids, rol, activo')
  const aprobMap: Record<string, Record<string, unknown>> = {}
  for (const a of aprobs ?? []) aprobMap[`${a.colaborador_id}_${a.area_id}`] = a

  const areas = areaIds.map(areaId => {
    const info = areasAll?.find(a => a.id === areaId)
    const colabsFiltrados = (colabs ?? []).filter(c => {
      if (!getAreasRequeridas(c, areasAll ?? []).some(a => a.id === areaId)) return false
      const areasAdmin: string[] = []
      for (const u of usuarios ?? []) {
        if (u.rol === 'ADMIN' && u.activo && u.cedula &&
            normCedula(u.cedula) === normCedula(c.cedula))
          areasAdmin.push(...(u.area_ids ?? []))
      }
      return !areasAdmin.includes(areaId)
    })
    return {
      areaId, areaNombre: info?.nombre ?? areaId,
      colaboradores: colabsFiltrados.map(c => {
        const ap = aprobMap[`${c.id}_${areaId}`]
        return { id: c.id, nombre: c.nombre, cedula: c.cedula,
                 estado: ap ? ap.estado : 'PENDIENTE',
                 observaciones: ap ? ap.observaciones : '',
                 aprobadoPor: ap ? ap.aprobado_por : '' }
      }),
    }
  })
  return { ok: true, areas }
}

// ─── ADMIN: APROBAR / RECHAZAR ────────────────────────────────────────────────
async function accionAprobar(body: Body, ses: SessionData) {
  const colaboradorId = String(body.colaboradorId || '')
  if (!colaboradorId) return { ok: false, error: 'ID de colaborador requerido' }
  const areaId = _resolverAreaId(body, ses)
  if (!areaId) return { ok: false, error: 'Área no autorizada' }

  await supabase.from('ps_aprobaciones').upsert(
    { colaborador_id: colaboradorId, area_id: areaId, estado: 'APROBADO',
      observaciones: '', aprobado_por: ses.username, fecha_accion: new Date().toISOString() },
    { onConflict: 'colaborador_id,area_id' }
  )
  await log(ses.username, ses.rol, 'APROBAR', `Colaborador: ${colaboradorId} Área: ${areaId}`)
  return { ok: true, mensaje: 'Aprobado correctamente' }
}

async function accionRechazar(body: Body, ses: SessionData) {
  const colaboradorId  = String(body.colaboradorId || '')
  const observaciones  = String(body.observaciones || '').trim()
  if (!colaboradorId) return { ok: false, error: 'ID de colaborador requerido' }
  if (!observaciones || observaciones.length < 5)
    return { ok: false, error: 'Las observaciones son obligatorias (mínimo 5 caracteres)' }
  const areaId = _resolverAreaId(body, ses)
  if (!areaId) return { ok: false, error: 'Área no autorizada' }

  await supabase.from('ps_aprobaciones').upsert(
    { colaborador_id: colaboradorId, area_id: areaId, estado: 'RECHAZADO',
      observaciones, aprobado_por: ses.username, fecha_accion: new Date().toISOString() },
    { onConflict: 'colaborador_id,area_id' }
  )
  await revocarCodigosColaborador(colaboradorId, 'REVOCADO')
  await log(ses.username, ses.rol, 'RECHAZAR', `Colaborador: ${colaboradorId}`)
  return { ok: true, mensaje: 'Rechazado correctamente' }
}

async function accionAprobarMasivo(body: Body, ses: SessionData) {
  const ids = (body.colaboradorIds || body.ids || []) as string[]
  if (!ids.length) return { ok: false, error: 'No se enviaron IDs' }
  const areaId = _resolverAreaId(body, ses)
  if (!areaId) return { ok: false, error: 'Área no autorizada' }

  const rows = ids.map(id => ({ colaborador_id: String(id), area_id: areaId, estado: 'APROBADO',
    observaciones: '', aprobado_por: ses.username, fecha_accion: new Date().toISOString() }))
  await supabase.from('ps_aprobaciones').upsert(rows, { onConflict: 'colaborador_id,area_id' })
  await log(ses.username, ses.rol, 'APROBAR_MASIVO', `${ids.length} colaboradores en área ${areaId}`)
  return { ok: true, mensaje: `${ids.length} colaborador(es) aprobado(s) correctamente` }
}

function _resolverAreaId(body: Body, ses: SessionData): string {
  const areaIds = ses.areaIds.length ? ses.areaIds : [ses.areaId].filter(Boolean)
  const req = body.areaId ? String(body.areaId) : ''
  if (ses.rol === 'SUPERADMIN') return req || areaIds[0] || ''
  return (req && areaIds.includes(req)) ? req : (areaIds[0] || '')
}

// ─── SA: COLABORADORES ────────────────────────────────────────────────────────
async function accionGetAllColaboradores() {
  const { data: colabs }   = await supabase.from('ps_colaboradores').select('*')
  const { data: areasAll } = await supabase.from('ps_areas').select('*').eq('activo', true)
  const { data: aprobs }   = await supabase.from('ps_aprobaciones').select('*')
  const { data: codigos }  = await supabase.from('ps_codigos_verificacion').select('colaborador_id').eq('activo', true)
  const { data: usuarios } = await supabase.from('ps_usuarios').select('cedula, area_ids, rol, activo')
  const aprobMap: Record<string, Record<string, unknown>> = {}
  for (const a of aprobs ?? []) aprobMap[`${a.colaborador_id}_${a.area_id}`] = a
  const codigosSet = new Set((codigos ?? []).map(c => c.colaborador_id))

  const colaboradores = (colabs ?? []).map(c => {
    const areas       = getAreasRequeridas(c, areasAll ?? [])
    const areasOmit   = new Set<string>()
    for (const u of usuarios ?? []) {
      if (u.rol === 'ADMIN' && u.activo && u.cedula &&
          normCedula(u.cedula) === normCedula(c.cedula))
        for (const id of u.area_ids ?? []) areasOmit.add(id)
    }
    const estados = areas.map(area => ({
      areaId: area.id, areaNombre: area.nombre,
      estado: areasOmit.has(area.id) ? 'OMITIDO' : (aprobMap[`${c.id}_${area.id}`]?.estado ?? 'PENDIENTE'),
    }))
    const activos = estados.filter(a => a.estado !== 'OMITIDO')
    const completo = c.requiere_paz_salvo && activos.length > 0 && activos.every(a => a.estado === 'APROBADO')
    return { id: c.id, nombre: c.nombre, cedula: c.cedula, activo: c.activo,
             tipoColaborador: c.tipo_colaborador || '', nivelEducativo: c.nivel_educativo || '',
             areasRequeridas: c.areas_requeridas || '', requierePazSalvo: c.requiere_paz_salvo,
             estadoGeneral: completo ? 'COMPLETO' : 'PENDIENTE',
             tieneDocumento: completo && codigosSet.has(c.id) }
  })
  return { ok: true, colaboradores }
}

async function accionCrearColaborador(body: Body, ses: SessionData) {
  const { nombre, cedula, tipoColaborador, nivelEducativo, areasRequeridas } = body as Record<string, string>
  const req = body.requierePazSalvo
  if (!nombre || !cedula) return { ok: false, error: 'Nombre y cédula son obligatorios' }
  const { data: existe } = await supabase.from('ps_colaboradores').select('id').eq('cedula', cedula.trim()).maybeSingle()
  if (existe) return { ok: false, error: 'Ya existe un colaborador con esa cédula' }
  const { data, error } = await supabase.from('ps_colaboradores').insert({
    nombre: nombre.trim(), cedula: cedula.trim(), activo: true,
    requiere_paz_salvo: req !== false && req !== 'false',
    tipo_colaborador: (tipoColaborador || '').toUpperCase().trim(),
    nivel_educativo:  (nivelEducativo  || '').toUpperCase().trim(),
    areas_requeridas: areasRequeridas || null,
  }).select('id').single()
  if (error) return { ok: false, error: error.message }
  await log(ses.username, ses.rol, 'CREAR_COLABORADOR', `${nombre} (${cedula})`)
  return { ok: true, mensaje: 'Colaborador creado correctamente', id: data.id }
}

async function accionEditarColaborador(body: Body, ses: SessionData) {
  const { id, nombre, cedula, activo, tipoColaborador, nivelEducativo, areasRequeridas } = body as Record<string, unknown>
  if (!id) return { ok: false, error: 'ID requerido' }
  const updates: Record<string, unknown> = {}
  if (nombre            !== undefined) updates.nombre             = String(nombre).trim()
  if (cedula            !== undefined) updates.cedula             = String(cedula).trim()
  if (activo            !== undefined) updates.activo             = activo === true || activo === 'true'
  if (tipoColaborador   !== undefined) updates.tipo_colaborador   = String(tipoColaborador).toUpperCase().trim()
  if (nivelEducativo    !== undefined) updates.nivel_educativo    = String(nivelEducativo).toUpperCase().trim()
  if (areasRequeridas   !== undefined) updates.areas_requeridas   = areasRequeridas || null
  const { error } = await supabase.from('ps_colaboradores').update(updates).eq('id', String(id))
  if (error) return { ok: false, error: error.message }
  await log(ses.username, ses.rol, 'EDITAR_COLABORADOR', `ID: ${id}`)
  return { ok: true, mensaje: 'Colaborador actualizado correctamente' }
}

async function accionTogglePazSalvo(body: Body, ses: SessionData) {
  await supabase.from('ps_colaboradores').update({ requiere_paz_salvo: !!body.valor }).eq('id', String(body.id))
  await log(ses.username, ses.rol, 'TOGGLE_PAZ_SALVO', `ID: ${body.id} → ${body.valor ? 'SÍ' : 'NO'}`)
  return { ok: true, mensaje: 'Actualizado correctamente' }
}

async function accionTogglePazSalvoMasivo(body: Body, ses: SessionData) {
  const ids = (body.ids || []) as string[]
  if (!ids.length) return { ok: false, error: 'No se enviaron IDs' }
  await supabase.from('ps_colaboradores').update({ requiere_paz_salvo: !!body.valor }).in('id', ids)
  await log(ses.username, ses.rol, 'TOGGLE_PAZ_SALVO_MASIVO', `${ids.length} colaboradores`)
  return { ok: true, mensaje: `${ids.length} colaborador(es) actualizados correctamente` }
}

async function accionCargaMasivaColaboradores(body: Body, ses: SessionData) {
  const registros = (body.registros || []) as Body[]
  if (!registros.length) return { ok: false, error: 'No hay registros' }
  if (registros.length > 200) return { ok: false, error: 'Máximo 200 registros por carga' }
  const { data: existentes } = await supabase.from('ps_colaboradores').select('cedula')
  const { data: usersExist } = await supabase.from('ps_usuarios').select('username')
  const cedulasVistas   = new Set((existentes ?? []).map(c => c.cedula.trim()))
  const usernamesVistas = new Set((usersExist ?? []).map(u => u.username.toLowerCase()))
  const creados: string[] = [], omitidos: string[] = [], errores: string[] = []
  const newColabs: Body[] = [], newUsers: Body[] = []
  for (const reg of registros) {
    if (!reg.nombre || !reg.cedula) { errores.push('Fila sin nombre o cédula'); continue }
    const ced = String(reg.cedula).trim()
    if (cedulasVistas.has(ced)) { omitidos.push(`${reg.nombre} (${ced}) — duplicado`); continue }
    cedulasVistas.add(ced)
    newColabs.push({ nombre: String(reg.nombre).trim(), cedula: ced, activo: true, requiere_paz_salvo: reg.requierePazSalvo !== false })
    const uname = String(reg.username || ced).trim()
    if (!usernamesVistas.has(uname.toLowerCase())) {
      usernamesVistas.add(uname.toLowerCase())
      // Sin bcrypt — la contraseña se gestiona a través de Supabase Auth.
      // Ejecutar migrate_users_to_auth.js para crear cuentas Auth y enviar reset de contraseña.
      newUsers.push({ username: uname, password_hash: '', legacy_hash: '', rol: 'COLABORADOR', area_ids: [], activo: true })
    }
    creados.push(`${reg.nombre} (${ced})`)
  }
  if (newColabs.length) await supabase.from('ps_colaboradores').insert(newColabs)
  if (newUsers.length)  await supabase.from('ps_usuarios').insert(newUsers)
  await log(ses.username, ses.rol, 'CARGA_MASIVA', `${creados.length} creados, ${omitidos.length} omitidos`)
  return { ok: true, mensaje: `${creados.length} creado(s), ${omitidos.length} omitido(s). Ejecutar script de migración para activar cuentas Auth.`, creados, omitidos, errores }
}

// ─── SA: USUARIOS ─────────────────────────────────────────────────────────────
async function accionGetUsuarios() {
  const { data: usuarios } = await supabase.from('ps_usuarios').select('*')
  const { data: areasAll } = await supabase.from('ps_areas').select('id, nombre')
  const areaMap: Record<string, string> = {}
  for (const a of areasAll ?? []) areaMap[a.id] = a.nombre
  return {
    ok: true,
    usuarios: (usuarios ?? []).map(u => {
      const ids: string[] = u.area_ids ?? []
      return { id: u.id, username: u.username, rol: u.rol, email: u.email || '',
               cedula: u.cedula || '', activo: u.activo,
               tieneAuth: !!(u.auth_user_id),
               areaId: ids.join(','), areaNombre: ids.map(id => areaMap[id] || id).join(', '),
               areaNombres: ids.map(id => areaMap[id] || id) }
    }),
  }
}

async function accionCrearUsuario(body: Body, ses: SessionData) {
  const { username, password, rol, areaId, email, cedula } = body as Record<string, string>
  if (!username || !password || !rol || !email)
    return { ok: false, error: 'Campos obligatorios incompletos (email requerido)' }
  if (!['ADMIN', 'COLABORADOR'].includes(rol)) return { ok: false, error: 'Rol no válido' }
  if (password.length < 6) return { ok: false, error: 'La contraseña debe tener al menos 6 caracteres' }
  if (!isValidEmail(email)) return { ok: false, error: 'Email no válido' }

  const { data: existe } = await supabase.from('ps_usuarios').select('id').ilike('username', username).maybeSingle()
  if (existe) return { ok: false, error: 'El nombre de usuario ya existe' }

  const areaIds = (areaId || '').split(',').map(s => s.trim()).filter(Boolean)

  // Crear registro ps_usuarios primero
  const { data: newUser, error: dbError } = await supabase.from('ps_usuarios').insert({
    username: username.trim(), password_hash: '', legacy_hash: '', rol,
    area_ids: areaIds, email: email.toLowerCase().trim(),
    cedula: cedula || '', activo: true, cambiar_password: true,
  }).select('id').single()
  if (dbError) return { ok: false, error: dbError.message }

  // Crear cuenta en Supabase Auth y vincular
  const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
    email: email.toLowerCase().trim(), password,
    email_confirm: true,
    user_metadata: { username: username.trim() },
  })
  if (!authError && authUser?.user) {
    await supabase.from('ps_usuarios').update({ auth_user_id: authUser.user.id }).eq('id', newUser.id)
  } else if (authError) {
    // No revertir el ps_usuarios — SA puede vincular manualmente con resetear_password
    console.warn('[crear_usuario] Auth error:', authError.message)
  }

  // Enviar credenciales al usuario
  if (isValidEmail(email)) {
    await emailCredenciales(email.toLowerCase().trim(), username.trim(), password)
  }

  await log(ses.username, ses.rol, 'CREAR_USUARIO', `${username} (${rol})`)
  return { ok: true, mensaje: 'Usuario creado correctamente', id: newUser.id,
           authCreado: !authError, authError: authError?.message ?? null }
}

async function accionEditarUsuario(body: Body, ses: SessionData) {
  const { id, areaId, activo, email, cedula } = body as Record<string, unknown>
  if (!id) return { ok: false, error: 'ID requerido' }
  const updates: Record<string, unknown> = {}
  if (areaId  !== undefined) updates.area_ids = String(areaId).split(',').map(s => s.trim()).filter(Boolean)
  if (activo  !== undefined) updates.activo   = activo === true || activo === 'true'
  if (email   !== undefined) updates.email    = String(email || '').toLowerCase().trim()
  if (cedula  !== undefined) updates.cedula   = String(cedula || '').trim()
  await supabase.from('ps_usuarios').update(updates).eq('id', String(id))
  await log(ses.username, ses.rol, 'EDITAR_USUARIO', `ID: ${id}`)
  return { ok: true, mensaje: 'Usuario actualizado correctamente' }
}

async function accionResetearPassword(body: Body, ses: SessionData) {
  const { id, nuevaPassword } = body as Record<string, string>
  if (!id || !nuevaPassword) return { ok: false, error: 'ID y contraseña son requeridos' }
  if (nuevaPassword.length < 6) return { ok: false, error: 'La contraseña debe tener al menos 6 caracteres' }

  const { data: u } = await supabase.from('ps_usuarios').select('auth_user_id, email, username').eq('id', id).single()
  if (!u) return { ok: false, error: 'Usuario no encontrado' }

  if (u.auth_user_id) {
    const { error } = await supabase.auth.admin.updateUserById(u.auth_user_id, { password: nuevaPassword })
    if (error) return { ok: false, error: error.message }
  } else if (u.email && isValidEmail(u.email)) {
    // Crear cuenta Auth si no existe aún
    const { data: authUser, error } = await supabase.auth.admin.createUser({
      email: u.email.toLowerCase().trim(), password: nuevaPassword, email_confirm: true,
    })
    if (error) return { ok: false, error: `Sin cuenta Auth y creación falló: ${error.message}` }
    await supabase.from('ps_usuarios').update({ auth_user_id: authUser.user!.id }).eq('id', id)
  } else {
    return { ok: false, error: 'El usuario no tiene email válido. Edítalo primero en Editar Usuario.' }
  }

  await supabase.from('ps_usuarios').update({ cambiar_password: true }).eq('id', id)

  // Enviar nueva contraseña temporal al usuario
  if (u.email && isValidEmail(u.email)) {
    await emailCredenciales(u.email, u.username, nuevaPassword)
  }

  await log(ses.username, ses.rol, 'RESET_PASSWORD', `ID: ${id}`)
  return { ok: true, mensaje: 'Contraseña restablecida correctamente' }
}

async function accionSolicitarPasswordDefault(ses: SessionData) {
  const { data: u } = await supabase.from('ps_usuarios')
    .select('email, username, auth_user_id')
    .eq('id', ses.usuarioId).single()
  if (!u) return { ok: false, error: 'Usuario no encontrado' }
  if (!u.email || !isValidEmail(u.email))
    return { ok: false, error: 'No tienes un correo válido registrado. Contacta al administrador.' }
  if (!u.auth_user_id)
    return { ok: false, error: 'Tu cuenta aún no está vinculada. Contacta al administrador.' }

  const nuevaPassword = generarPasswordDefault()
  const { error } = await supabase.auth.admin.updateUserById(u.auth_user_id, { password: nuevaPassword })
  if (error) return { ok: false, error: error.message }

  await supabase.from('ps_usuarios').update({ cambiar_password: true }).eq('id', ses.usuarioId)
  await emailCredenciales(u.email, u.username, nuevaPassword)
  await log(ses.username, ses.rol, 'SOLICITAR_PASSWORD_DEFAULT', 'Contraseña temporal enviada por correo')
  return { ok: true, mensaje: `Se envió la contraseña temporal a ${u.email}` }
}

async function accionCambiarPassword(body: Body, ses: SessionData) {
  const { passwordNueva } = body as Record<string, string>
  if (!passwordNueva || passwordNueva.length < 6) return { ok: false, error: 'Mínimo 6 caracteres' }
  if (!ses.authUserId) return { ok: false, error: 'Token sin ID de usuario Auth' }

  const { error } = await supabase.auth.admin.updateUserById(ses.authUserId, { password: passwordNueva })
  if (error) return { ok: false, error: error.message }

  await supabase.from('ps_usuarios').update({ cambiar_password: false }).eq('id', ses.usuarioId)
  await log(ses.username, ses.rol, 'CAMBIAR_PASSWORD', 'Contraseña actualizada')
  return { ok: true, mensaje: 'Contraseña actualizada correctamente' }
}

// ─── ÁREAS ────────────────────────────────────────────────────────────────────
async function accionGetAreas() {
  const { data } = await supabase.from('ps_areas').select('*').eq('activo', true).order('nombre')
  return { ok: true, areas: (data ?? []).map(a => ({ id: a.id, nombre: a.nombre, tipo: a.tipo })) }
}

async function accionCrearArea(body: Body, ses: SessionData) {
  const { nombre, descripcion, tipo } = body as Record<string, string>
  if (!nombre?.trim()) return { ok: false, error: 'El nombre del área es obligatorio' }
  const tipoValido = ['GENERAL', 'DEPARTAMENTAL'].includes((tipo || '').toUpperCase()) ? tipo.toUpperCase() : 'GENERAL'
  const { data: existe } = await supabase.from('ps_areas').select('id').ilike('nombre', nombre.trim()).maybeSingle()
  if (existe) return { ok: false, error: `Ya existe un área con el nombre '${nombre.trim()}'` }
  const { data, error } = await supabase.from('ps_areas').insert({
    nombre: nombre.trim(), descripcion: descripcion || '', activo: true, tipo: tipoValido,
  }).select('id').single()
  if (error) return { ok: false, error: error.message }
  await log(ses.username, ses.rol, 'CREAR_AREA', `${nombre.trim()} (${tipoValido})`)
  return { ok: true, mensaje: `Área '${nombre.trim()}' creada`, id: data.id, nombre: nombre.trim(), tipo: tipoValido }
}

async function accionEditarArea(body: Body, ses: SessionData) {
  const { id, nombre, descripcion, tipo, activo } = body as Record<string, unknown>
  if (!id) return { ok: false, error: 'ID de área requerido' }
  const updates: Record<string, unknown> = {}
  if (nombre      !== undefined) updates.nombre      = String(nombre).trim()
  if (descripcion !== undefined) updates.descripcion = String(descripcion).trim()
  if (tipo        !== undefined) updates.tipo        = String(tipo).toUpperCase().trim()
  if (activo      !== undefined) updates.activo      = activo === true || activo === 'true'
  await supabase.from('ps_areas').update(updates).eq('id', String(id))
  await log(ses.username, ses.rol, 'EDITAR_AREA', `ID: ${id}`)
  return { ok: true, mensaje: 'Área actualizada correctamente' }
}

// ─── CONFIG ───────────────────────────────────────────────────────────────────
async function accionGetConfig() {
  const { data } = await supabase.from('ps_config').select('*')
  const config: Record<string, string> = {}
  for (const r of data ?? []) config[r.clave] = r.valor
  return { ok: true, config }
}

async function accionSetProcesoActivo(body: Body, ses: SessionData) {
  const valor = body.valor ? 'TRUE' : 'FALSE'
  await setConfig('PROCESO_ACTIVO', valor)
  await log(ses.username, ses.rol, 'SET_PROCESO', `Proceso ${valor}`)
  return { ok: true, mensaje: `Proceso ${valor === 'TRUE' ? 'activado' : 'desactivado'}` }
}

async function accionSetConfigSA(body: Body, ses: SessionData) {
  const { clave, valor } = body as Record<string, string>
  if (!clave) return { ok: false, error: 'Clave requerida' }
  await setConfig(clave, valor || '')
  await log(ses.username, ses.rol, 'SET_CONFIG', `${clave} = ${valor || ''}`)
  return { ok: true, mensaje: 'Configuración guardada' }
}

async function accionGetConfigAdmin(ses: SessionData) {
  const clave = ses.rol === 'ADMIN' && ses.areaId
    ? `EMAILS_NOTIFICACION_${ses.areaId}`
    : 'EMAILS_NOTIFICACION'
  const emailsNotificacion = await getConfig(clave) || await getConfig('EMAILS_NOTIFICACION')
  return { ok: true, emailsNotificacion }
}

async function accionSetEmailsNotificacion(body: Body, ses: SessionData) {
  const clave = ses.rol === 'ADMIN' && ses.areaId
    ? `EMAILS_NOTIFICACION_${ses.areaId}`
    : 'EMAILS_NOTIFICACION'
  await setConfig(clave, String(body.emails || ''))
  await log(ses.username, ses.rol, 'SET_EMAILS_NOTIF', String(body.emails || ''))
  return { ok: true, mensaje: 'Correos de notificación guardados' }
}

// ─── SA: VISTA GLOBAL ─────────────────────────────────────────────────────────
async function accionGetVistaGlobal() {
  const { data: colabs }   = await supabase.from('ps_colaboradores').select('*').eq('activo', true)
  const { data: areasAll } = await supabase.from('ps_areas').select('*').eq('activo', true)
  const { data: aprobs }   = await supabase.from('ps_aprobaciones').select('*')
  const { data: usuarios } = await supabase.from('ps_usuarios').select('cedula, area_ids, rol, activo')
  const aprobMap: Record<string, Record<string, unknown>> = {}
  for (const a of aprobs ?? []) aprobMap[`${a.colaborador_id}_${a.area_id}`] = a

  const colaboradores = (colabs ?? []).map(c => {
    const areasDelColab = new Set(getAreasRequeridas(c, areasAll ?? []).map(a => a.id))
    const areasOmit     = new Set<string>()
    for (const u of usuarios ?? []) {
      if (u.rol === 'ADMIN' && u.activo && u.cedula &&
          normCedula(u.cedula) === normCedula(c.cedula))
        for (const id of u.area_ids ?? []) areasOmit.add(id)
    }
    const estadoPorArea = (areasAll ?? []).map(area => {
      if (!areasDelColab.has(area.id)) return { areaId: area.id, areaNombre: area.nombre, estado: 'NO_APLICA' }
      if (areasOmit.has(area.id))      return { areaId: area.id, areaNombre: area.nombre, estado: 'OMITIDO' }
      const ap = aprobMap[`${c.id}_${area.id}`]
      return { areaId: area.id, areaNombre: area.nombre,
               estado: ap ? ap.estado : 'PENDIENTE',
               aprobadoPor: ap ? ap.aprobado_por : '',
               observaciones: ap ? (ap.observaciones || '') : '',
               fecha: ap ? ap.fecha_accion : '' }
    })
    const activos = estadoPorArea.filter(a => a.estado !== 'NO_APLICA' && a.estado !== 'OMITIDO')
    const completo = c.requiere_paz_salvo && activos.length > 0 && activos.every(a => a.estado === 'APROBADO')
    return { id: c.id, nombre: c.nombre, cedula: c.cedula, requierePazSalvo: c.requiere_paz_salvo,
             tipoColaborador: (c.tipo_colaborador || '').toUpperCase(),
             estadoPorArea, estadoGeneral: completo ? 'COMPLETO' : 'PENDIENTE',
             pendientes: activos.filter(a => a.estado !== 'APROBADO').map(a => a.areaNombre),
             tieneRechazados: activos.some(a => a.estado === 'RECHAZADO') }
  })
  return { ok: true, colaboradores, areas: areasAll ?? [] }
}

async function verificarPassword(email: string, password: string): Promise<boolean> {
  const { error } = await supabaseAnon.auth.signInWithPassword({ email, password })
  return !error
}

async function accionForzarPazSalvo(body: Body, ses: SessionData) {
  if (!body.password) return { ok: false, error: 'Se requiere contraseña para esta acción' }
  const ok = await verificarPassword(ses.email, String(body.password))
  if (!ok) return { ok: false, error: 'Contraseña incorrecta' }

  const { data: c } = await supabase.from('ps_colaboradores').select('*').eq('id', String(body.colaboradorId)).single()
  if (!c) return { ok: false, error: 'Colaborador no encontrado' }
  const { data: areasAll } = await supabase.from('ps_areas').select('*').eq('activo', true)
  if (!areasAll?.length) return { ok: false, error: 'No hay áreas activas' }
  const rows = areasAll.map(area => ({
    colaborador_id: String(body.colaboradorId), area_id: area.id, estado: 'APROBADO',
    observaciones: '', aprobado_por: ses.username, fecha_accion: new Date().toISOString(),
  }))
  await supabase.from('ps_aprobaciones').upsert(rows, { onConflict: 'colaborador_id,area_id' })
  await revocarCodigosColaborador(String(body.colaboradorId), 'REEMPLAZADO')
  await log(ses.username, ses.rol, 'FORZAR_PAZ_SALVO', `${c.nombre} — ${areasAll.length} áreas`)
  return { ok: true, mensaje: `Paz y salvo otorgado a ${c.nombre} en ${areasAll.length} área(s)` }
}

async function accionResetearAprobaciones(body: Body, ses: SessionData) {
  if (!body.password) return { ok: false, error: 'Se requiere contraseña para esta acción' }
  const ok = await verificarPassword(ses.email, String(body.password))
  if (!ok) return { ok: false, error: 'Contraseña incorrecta' }

  const colaboradorId = String(body.colaboradorId || '')
  if (!colaboradorId) return { ok: false, error: 'colaboradorId requerido' }

  const { data: c } = await supabase.from('ps_colaboradores').select('nombre').eq('id', colaboradorId).single()
  if (!c) return { ok: false, error: 'Colaborador no encontrado' }

  const { error, count } = await supabase.from('ps_aprobaciones')
    .delete({ count: 'exact' }).eq('colaborador_id', colaboradorId)
  if (error) return { ok: false, error: error.message }

  await revocarCodigosColaborador(colaboradorId, 'REVOCADO')
  await log(ses.username, ses.rol, 'RESETEAR_APROBACIONES', `${c.nombre} — ${count ?? 0} registros eliminados`)
  return { ok: true, mensaje: `Aprobaciones de ${c.nombre} restablecidas (${count ?? 0} eliminadas)` }
}

async function accionGetEstadoColaborador(body: Body) {
  const { data: c } = await supabase.from('ps_colaboradores').select('*').eq('id', String(body.colaboradorId)).single()
  if (!c) return { ok: false, error: 'Colaborador no encontrado' }
  const { data: areasAll } = await supabase.from('ps_areas').select('*').eq('activo', true)
  const { data: aprobs }   = await supabase.from('ps_aprobaciones').select('*').eq('colaborador_id', c.id)
  const areasOmit = new Set(await getAreaIdsDelColaborador(c.cedula))
  const areas     = getAreasRequeridas(c, areasAll ?? [])
  const aprobMap: Record<string, Record<string, unknown>> = {}
  for (const a of aprobs ?? []) aprobMap[a.area_id] = a
  const estadoPorArea = areas.map(area => {
    if (areasOmit.has(area.id)) return { areaId: area.id, areaNombre: area.nombre, estado: 'OMITIDO' }
    const ap = aprobMap[area.id]
    return { areaId: area.id, areaNombre: area.nombre,
             estado: ap ? ap.estado : 'PENDIENTE',
             aprobadoPor: ap ? ap.aprobado_por : '', fecha: ap ? ap.fecha_accion : '' }
  })
  const areasReq = estadoPorArea.filter(a => a.estado !== 'OMITIDO')
  const pazYSalvoCompleto = c.requiere_paz_salvo && areasReq.length > 0 && areasReq.every(a => a.estado === 'APROBADO')
  return { ok: true, colaborador: { id: c.id, nombre: c.nombre, cedula: c.cedula },
           estadoPorArea, pazYSalvoCompleto, requierePazSalvo: c.requiere_paz_salvo }
}

// ─── DOCUMENTO ────────────────────────────────────────────────────────────────
async function accionGenerarDocumento(body: Body, ses: SessionData) {
  let c: Record<string, unknown> | null = null
  if (body.cedula && !body.colaboradorId) {
    // Lookup por cédula para cualquier rol (COLABORADOR, ADMIN y SUPERADMIN enviando su propio paz y salvo)
    const { data } = await supabase.from('ps_colaboradores').select('*')
      .eq('cedula', String(body.cedula).trim()).eq('activo', true).maybeSingle()
    c = data
    console.log(`[generar_doc] lookup por cedula="${body.cedula}" rol=${ses.rol} → ${c ? c.nombre : 'no encontrado'}`)
  } else {
    const { data } = await supabase.from('ps_colaboradores').select('*')
      .eq('id', String(body.colaboradorId || '')).maybeSingle()
    c = data
    console.log(`[generar_doc] lookup por id="${body.colaboradorId}" rol=${ses.rol} → ${c ? c.nombre : 'no encontrado'}`)
  }
  if (!c) return { ok: false, error: 'Colaborador no encontrado' }
  const colaboradorId = String(c.id)

  const { data: areasAll } = await supabase.from('ps_areas').select('*').eq('activo', true)
  const { data: aprobs }   = await supabase.from('ps_aprobaciones').select('*').eq('colaborador_id', colaboradorId)
  const areasOmit          = new Set(await getAreaIdsDelColaborador(String(c.cedula ?? '')))
  const areasReq           = getAreasRequeridas(c, areasAll ?? []).filter(a => !areasOmit.has(a.id))
  const aprobadosSet       = new Set((aprobs ?? []).filter(a => a.estado === 'APROBADO').map(a => a.area_id))

  if (!areasReq.length || !areasReq.every(a => aprobadosSet.has(a.id)))
    return { ok: false, error: 'El colaborador no tiene todas las áreas aprobadas' }

  // Reusar el código activo si ya existe — solo genera uno nuevo cuando no hay ninguno activo.
  // El código se revoca automáticamente en rechazar/resetear/forzar, garantizando
  // que PDF descargado, preview y correo enviado siempre muestren el mismo código.
  const { data: codigoExist } = await supabase.from('ps_codigos_verificacion')
    .select('*').eq('colaborador_id', colaboradorId).eq('activo', true).maybeSingle()

  let codigo: string, fechaEmision: string
  if (codigoExist) {
    codigo       = codigoExist.codigo
    fechaEmision = codigoExist.fecha_emision
  } else {
    codigo       = `PSG-${String(c.cedula ?? '').slice(-4)}-${Math.random().toString(36).substring(2, 7).toUpperCase()}`
    fechaEmision = new Date().toISOString()
    await supabase.from('ps_codigos_verificacion').insert({
      codigo, colaborador_id: colaboradorId, activo: true, fecha_emision: fechaEmision,
    })
  }

  if (!c.nombre || !c.cedula) return { ok: false, error: 'Datos del colaborador incompletos (nombre o cédula ausentes)' }
  if (!codigo) return { ok: false, error: 'Error generando código de verificación' }

  const aprobMap: Record<string, Record<string, unknown>> = {}
  for (const a of aprobs ?? []) aprobMap[a.area_id] = a
  const areas = await Promise.all(areasReq.map(async area => {
    const ap = aprobMap[area.id]
    const responsable = ap ? String(ap.aprobado_por) : ''
    const responsableNombre = await getNombreAprobador(responsable)
    return { nombre: String(area.nombre || ''), responsable, responsableNombre: responsableNombre || responsable,
             fecha: ap ? String(ap.fecha_accion || '') : '' }
  }))

  if (!areas.length) return { ok: false, error: 'No se encontraron áreas certificadas para el documento' }

  const institucion  = await getConfig('INSTITUCION_NOMBRE')  || 'Proyectarte Ltda'
  const responsableTH = await getConfig('NOMBRE_RESPONSABLE_TH') || ''
  await log(ses.username, ses.rol, 'GENERAR_DOCUMENTO', `${c.nombre} (${c.cedula}) — ${codigo}`)
  return { ok: true, documento: { colaboradorId, nombre: String(c.nombre), cedula: String(c.cedula),
    codigoVerificacion: codigo, fechaEmision, areas, institucion, responsableTH } }
}

// Genera el certificado como PDF con pdf-lib (vector, sin html2canvas).
// El diseño replica fielmente el template HTML: colores, secciones, áreas certificadas.
async function _generarCertificadoPdf(doc: Record<string, unknown>): Promise<string> {
  const nombre      = String(doc.nombre     || '').trim()
  const cedula      = String(doc.cedula     || '').trim()
  const codigo      = String(doc.codigoVerificacion || '').trim()
  const institucion = String(doc.institucion || 'Colegio Campestre Goyavier')
  const respTH      = String(doc.responsableTH || '')
  const areas       = (doc.areas as Array<{ nombre: string; responsableNombre?: string; responsable?: string }>) ?? []

  let fechaFmt = String(doc.fechaEmision || '')
  try {
    fechaFmt = new Intl.DateTimeFormat('es-CO', {
      year: 'numeric', month: 'long', day: 'numeric', timeZone: 'America/Bogota'
    }).format(new Date(fechaFmt))
  } catch { /* keep original */ }

  // ── Documento PDF (Carta: 612 × 792 pt) ─────────────────────────────────────
  const pdfDoc = await PDFDocument.create()
  const page   = pdfDoc.addPage([612, 792])
  const [W, H, M] = [612, 792, 33]
  const CW = W - 2 * M  // 546 pt de contenido

  const Hbold = await pdfDoc.embedFont(StandardFonts.HelveticaBold)
  const Hreg  = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const Hobl  = await pdfDoc.embedFont(StandardFonts.HelveticaOblique)
  const Mono  = await pdfDoc.embedFont(StandardFonts.Courier)

  // ── Colores ──────────────────────────────────────────────────────────────────
  const navy    = rgb(30/255,  58/255,  95/255)
  const white   = rgb(1, 1, 1)
  const hdrBg   = rgb(248/255,250/255,255/255)
  const grayAA  = rgb(170/255,170/255,170/255)
  const gray66  = rgb(102/255,102/255,102/255)
  const gray44  = rgb(68/255, 68/255, 68/255)
  const grayBB  = rgb(187/255,187/255,187/255)
  const green2d = rgb(45/255, 122/255,45/255)
  const greenBg = rgb(240/255,247/255,240/255)
  const pBg     = rgb(238/255,243/255,255/255)
  const pBdr    = rgb(197/255,213/255,240/255)
  const tBdr    = rgb(221/255,228/255,240/255)
  const ftrBg   = rgb(240/255,244/255,248/255)
  const ftrBdr  = rgb(232/255,237/255,244/255)
  const g1a     = rgb(26/255, 74/255, 26/255)
  const g3a     = rgb(58/255, 90/255, 58/255)
  const gSig    = rgb(45/255, 90/255, 45/255)
  const ccClr   = rgb(102/255,102/255,119/255)
  const gBdr    = rgb(184/255,223/255,184/255)

  // ── Helpers ──────────────────────────────────────────────────────────────────
  const tw = (t: string, f: PDFFont, sz: number, cs = 0) =>
    f.widthOfTextAtSize(t, sz) + cs * t.length
  const cx = (t: string, f: PDFFont, sz: number, cs = 0) =>
    (W - tw(t, f, sz, cs)) / 2
  const wrap = (t: string, f: PDFFont, sz: number, mw: number): string[] => {
    const lines: string[] = []
    let cur = ''
    for (const w of t.split(' ')) {
      const test = cur ? `${cur} ${w}` : w
      if (f.widthOfTextAtSize(test, sz) > mw && cur) { lines.push(cur); cur = w }
      else cur = test
    }
    if (cur) lines.push(cur)
    return lines
  }

  // ── HEADER (top 75 pt) ───────────────────────────────────────────────────────
  const HDR = 75
  page.drawRectangle({ x: 0, y: H-HDR, width: W, height: HDR, color: hdrBg })
  page.drawRectangle({ x: 0, y: H-HDR, width: W, height: 2,   color: navy })
  page.drawText(institucion.toUpperCase(), {
    x: M, y: H-HDR+HDR/2+5, size: 12.75, font: Hbold, color: navy, characterSpacing: 0.5
  })
  page.drawText('Floridablanca, Santander', {
    x: M, y: H-HDR+HDR/2-11, size: 8.25, font: Hreg, color: grayAA
  })

  // ── TITLE (siguiente 95 pt) ──────────────────────────────────────────────────
  const TTLH = 95, ttlBot = H-HDR-TTLH
  page.drawRectangle({ x: 0, y: ttlBot, width: W, height: 0.75, color: tBdr })

  const bdgTxt = 'CERTIFICADO OFICIAL'
  const bdgW = Hbold.widthOfTextAtSize(bdgTxt, 6.75) + 24, bdgH = 14
  const bdgX = (W-bdgW)/2, bdgY = H-HDR-22-bdgH
  page.drawRectangle({ x: bdgX, y: bdgY, width: bdgW, height: bdgH, color: navy })
  page.drawText(bdgTxt, { x: bdgX+12, y: bdgY+4, size: 6.75, font: Hbold, color: white, characterSpacing: 1.5 })

  page.drawText('PAZ Y SALVO', {
    x: cx('PAZ Y SALVO', Hbold, 22.5, 3), y: bdgY-8-22.5,
    size: 22.5, font: Hbold, color: navy, characterSpacing: 3
  })
  page.drawText('SISTEMA INSTITUCIONAL DE CERTIFICACIÓN', {
    x: cx('SISTEMA INSTITUCIONAL DE CERTIFICACIÓN', Hreg, 7.5, 1.5), y: ttlBot+10,
    size: 7.5, font: Hreg, color: grayBB, characterSpacing: 1.5
  })

  // ── BODY ─────────────────────────────────────────────────────────────────────
  let cy = ttlBot - 19

  // Intro
  const intro = 'La Dirección de la Institución Educativa certifica que el colaborador:'
  page.drawText(intro, { x: cx(intro, Hreg, 9), y: cy-9, size: 9, font: Hreg, color: gray66 })
  cy -= 22

  // Cuadro persona
  const pbH = 52, pbY = cy-pbH
  page.drawRectangle({ x: M, y: pbY, width: CW, height: pbH, color: pBg, borderColor: pBdr, borderWidth: 1.5 })
  const nUp = nombre.toUpperCase()
  page.drawText(nUp, { x: cx(nUp, Hbold, 17), y: pbY+pbH-17-12, size: 17, font: Hbold, color: navy })
  const ccT = `Cédula de Ciudadanía No. ${cedula}`
  page.drawText(ccT, { x: cx(ccT, Hreg, 9), y: pbY+9, size: 9, font: Hreg, color: ccClr })
  cy = pbY - 12

  // Texto del certificado (con ajuste de línea)
  const cTxt = `Se encuentra a PAZ Y SALVO con todas las dependencias de ${institucion}, habiendo cumplido satisfactoriamente con todos los requerimientos establecidos en el proceso de certificación de retiro y desvinculación institucional.`
  for (const ln of wrap(cTxt, Hreg, 9, CW)) {
    cy -= 13.5
    page.drawText(ln, { x: M, y: cy, size: 9, font: Hreg, color: gray44 })
  }
  cy -= 10

  // Cuadro áreas certificadas
  const aPV = 10, aRH = 14, aTH = 17
  const aBoxH = aPV*2 + aTH + areas.length*aRH
  const aBoxY = cy - aBoxH
  page.drawRectangle({ x: M, y: aBoxY, width: CW, height: aBoxH, color: greenBg, borderColor: gBdr, borderWidth: 0.75 })
  page.drawText('DEPENDENCIAS CERTIFICADAS', {
    x: M+15, y: aBoxY+aBoxH-aPV-7, size: 6.75, font: Hbold, color: green2d, characterSpacing: 1.125
  })
  for (let i = 0; i < areas.length; i++) {
    const a = areas[i]
    const ry = aBoxY + aBoxH - aPV - aTH - (i+1)*aRH + 4
    page.drawText('>', { x: M+15, y: ry, size: 8, font: Hbold, color: green2d })
    const nU = a.nombre.toUpperCase()
    page.drawText(nU, { x: M+26, y: ry, size: 7.5, font: Hbold, color: g1a })
    const resp = a.responsableNombre || a.responsable || ''
    if (resp) page.drawText(`- ${resp}`, {
      x: M+26+Hbold.widthOfTextAtSize(nU, 7.5)+6, y: ry, size: 7.5, font: Hobl, color: g3a
    })
  }
  cy = aBoxY - 12

  // Distribuir espacio restante antes de la sección inferior
  const lowerH = 178
  const gap = cy - 24 - lowerH
  if (gap > 0) cy -= gap * 0.35

  // Fecha
  const dTxt = `Expedido en Floridablanca, Santander, el ${fechaFmt}.`
  cy -= 14
  page.drawText(dTxt, { x: cx(dTxt, Hobl, 9), y: cy, size: 9, font: Hobl, color: gray66 })
  cy -= 16

  // Firma
  if (respTH) page.drawText(respTH, {
    x: cx(respTH, Hobl, 11.25), y: cy, size: 11.25, font: Hobl, color: gSig
  })
  cy -= 33
  page.drawLine({ start: { x: W/2-67.5, y: cy }, end: { x: W/2+67.5, y: cy }, thickness: 0.75, color: grayAA })
  const lblTH = 'Talento Humano'
  page.drawText(lblTH, { x: cx(lblTH, Hreg, 7.5), y: cy-10, size: 7.5, font: Hreg, color: rgb(136/255,136/255,136/255) })
  cy -= 22

  // Código de verificación
  const vBoxH = 54, vBoxY = cy-vBoxH
  page.drawRectangle({ x: M, y: vBoxY, width: CW, height: vBoxH, color: navy })
  const vL = 'CÓDIGO DE VERIFICACIÓN'
  page.drawText(vL, { x: cx(vL, Hreg, 6.75, 1.5), y: vBoxY+vBoxH-13, size: 6.75, font: Hreg, color: white, characterSpacing: 1.5 })
  page.drawText(codigo, { x: cx(codigo, Mono, 15, 3.75), y: vBoxY+22, size: 15, font: Mono, color: white, characterSpacing: 3.75 })
  const hint = 'Verifique la autenticidad en el sistema institucional'
  page.drawText(hint, { x: cx(hint, Hreg, 6.75), y: vBoxY+8, size: 6.75, font: Hreg, color: rgb(0.8,0.8,0.8) })

  // ── FOOTER ───────────────────────────────────────────────────────────────────
  const FH = 24
  page.drawRectangle({ x: 0, y: 0,    width: W, height: FH,   color: ftrBg })
  page.drawRectangle({ x: 0, y: FH-0.75, width: W, height: 0.75, color: ftrBdr })
  const fTxt = `Documento generado automáticamente  ·  Sistema de Paz y Salvo  ·  ${institucion}  ·  ${fechaFmt}`
  page.drawText(fTxt, { x: cx(fTxt, Hreg, 6.75), y: FH/2-3.4, size: 6.75, font: Hreg, color: grayAA })

  // ── Exportar como base64 ──────────────────────────────────────────────────────
  const bytes = await pdfDoc.save()
  console.log(`[PDF] pdf-lib generado: ${bytes.length} bytes`)
  return encodeBase64(bytes)
}

async function accionDescargarPdf(body: Body, ses: SessionData) {
  const r = await accionGenerarDocumento(body, ses)
  if (!r.ok) return r
  const doc = r.documento as Record<string, unknown>
  const nombre = String(doc?.nombre ?? '')
  try {
    const pdfBase64 = await _generarCertificadoPdf(doc)
    return { ...r, pdfBase64, filename: `PazYSalvo_${nombre.replace(/\s+/g, '_')}.pdf` }
  } catch (err) {
    console.error('[PDF] Error pdf-lib:', err)
    return { ...r, pdfBase64: null, filename: `PazYSalvo_${nombre.replace(/\s+/g, '_')}.pdf` }
  }
}

// ─── VERIFICAR CÓDIGO (público) ───────────────────────────────────────────────
async function accionVerificarCodigo(body: Body) {
  const codigo = String(body.codigo || '').trim().toUpperCase()
  if (!codigo) return { ok: false, error: 'Código requerido' }

  // Buscar el código sin filtrar por activo — necesitamos distinguir el motivo
  const { data: entrada } = await supabase.from('ps_codigos_verificacion')
    .select('*').ilike('codigo', codigo).maybeSingle()
  if (!entrada) return { ok: false, valido: false, mensaje: 'Código no válido o inexistente' }

  // Ya inactivo: informar el motivo
  if (!entrada.activo) {
    const motivo = String(entrada.motivo_inactivacion ?? 'REVOCADO')
    if (motivo === 'REEMPLAZADO') {
      return { ok: true, valido: false, motivo: 'REEMPLAZADO',
        mensaje: 'Este código ha sido reemplazado por un certificado más reciente. Solicita el documento actualizado.' }
    }
    return { ok: true, valido: false, motivo,
      mensaje: 'Este código ya no está vigente. Las aprobaciones del colaborador fueron modificadas.' }
  }

  // Verificación en tiempo real del estado de aprobaciones
  const { data: c } = await supabase.from('ps_colaboradores').select('*').eq('id', entrada.colaborador_id).single()
  if (!c) return { ok: false, valido: false, mensaje: 'Datos no encontrados' }

  const { data: areasAll } = await supabase.from('ps_areas').select('*').eq('activo', true)
  const { data: aprobs }   = await supabase.from('ps_aprobaciones').select('*').eq('colaborador_id', c.id)
  const areasOmit  = new Set(await getAreaIdsDelColaborador(String(c.cedula ?? '')))
  const areasReq   = getAreasRequeridas(c, areasAll ?? []).filter(a => !areasOmit.has(a.id))
  const aprobados  = new Set((aprobs ?? []).filter(a => a.estado === 'APROBADO').map(a => a.area_id))
  const completo   = c.requiere_paz_salvo && areasReq.length > 0 && areasReq.every(a => aprobados.has(a.id))

  if (!completo) {
    // Auto-revocar: el estado actual no sostiene el paz y salvo
    await revocarCodigosColaborador(String(c.id), 'REVOCADO')
    await log('SISTEMA', 'VERIFICACION', 'AUTO_REVOCAR_CODIGO', `Código: ${codigo} — ${c.nombre}`)
    return { ok: true, valido: false, motivo: 'REVOCADO',
      mensaje: 'Este código ya no está vigente. El colaborador no tiene todas las áreas aprobadas actualmente.' }
  }

  await log('PÚBLICO', 'VERIFICACION', 'VERIFICAR_CODIGO', `Código: ${codigo}`)
  return { ok: true, valido: true, datos: {
    nombre: c.nombre, cedula: c.cedula,
    estado: 'PAZ Y SALVO COMPLETO', fechaEmision: entrada.fecha_emision, codigo: entrada.codigo,
  }}
}

// ─── RECORDATORIO / SOLICITUD TH ─────────────────────────────────────────────
async function accionGetPendientesRecordatorio(body: Body, ses: SessionData) {
  let c: Record<string, unknown> | null = null
  if (body.cedula && !body.colaboradorId) {
    const { data } = await supabase.from('ps_colaboradores').select('*')
      .eq('cedula', String(body.cedula).trim()).eq('activo', true).maybeSingle()
    c = data
    console.log(`[pendientes_rec] lookup por cedula="${body.cedula}" rol=${ses.rol} → ${c ? c.nombre : 'no encontrado'}`)
  } else {
    const { data } = await supabase.from('ps_colaboradores').select('*').eq('id', String(body.colaboradorId || '')).maybeSingle()
    c = data
    console.log(`[pendientes_rec] lookup por id="${body.colaboradorId}" rol=${ses.rol} → ${c ? c.nombre : 'no encontrado'}`)
  }
  if (!c) return { ok: false, error: 'Colaborador no encontrado' }

  const { data: areasAll } = await supabase.from('ps_areas').select('*').eq('activo', true)
  const { data: aprobs }   = await supabase.from('ps_aprobaciones').select('*').eq('colaborador_id', String(c.id))
  const { data: usuarios } = await supabase.from('ps_usuarios').select('*').in('rol', ['ADMIN', 'SUPERADMIN']).eq('activo', true)
  const areasOmit  = new Set(await getAreaIdsDelColaborador(String(c.cedula)))
  const aprobSet   = new Set((aprobs ?? []).filter(a => a.estado === 'APROBADO').map(a => a.area_id))

  // Mapa cedula → nombre completo para los admins
  const cedulasAdmins = (usuarios ?? []).map(u => u.cedula).filter(Boolean)
  const { data: colabsAdmins } = cedulasAdmins.length
    ? await supabase.from('ps_colaboradores').select('cedula, nombre').in('cedula', cedulasAdmins)
    : { data: [] }
  const nombrePorCedula: Record<string, string> = {}
  for (const ca of colabsAdmins ?? []) nombrePorCedula[String(ca.cedula)] = String(ca.nombre)

  const pendientes = getAreasRequeridas(c, areasAll ?? [])
    .filter(area => !aprobSet.has(area.id) && !areasOmit.has(area.id))
    .map(area => {
      const admin = (usuarios ?? []).find(u => (u.area_ids ?? []).includes(area.id))
      const adminNombre = admin
        ? (admin.cedula ? (nombrePorCedula[String(admin.cedula)] ?? admin.username) : admin.username)
        : null
      return { areaId: String(area.id), areaNombre: area.nombre,
               adminNombre,
               adminEmail: admin?.email || null,
               tieneCorreo: !!(admin?.email) }
    })
  return { ok: true, colaboradorId: String(c.id), colaboradorNombre: String(c.nombre), pendientes }
}

async function accionEnviarRecordatorio(body: Body, ses: SessionData) {
  const r = await accionGetPendientesRecordatorio(body, ses)
  if (!r.ok) return r

  const todosLosPendientes = ((r as Record<string, unknown[]>).pendientes ?? []) as Body[]
  const areaIdsFiltro      = Array.isArray(body.areaIds) ? (body.areaIds as string[]) : []
  const pendientes         = areaIdsFiltro.length
    ? todosLosPendientes.filter(p => areaIdsFiltro.includes(String(p.areaId)))
    : todosLosPendientes

  console.log(`[enviar_recordatorio] areaIdsFiltro=${JSON.stringify(areaIdsFiltro)} total=${todosLosPendientes.length} filtrados=${pendientes.length}`)

  const colaboradorNombre = String((r as Record<string, unknown>).colaboradorNombre || '')
  const resultados: Body[] = []
  let enviados = 0

  for (const p of pendientes) {
    const adminEmail = String(p.adminEmail || '')
    if (!adminEmail || !isValidEmail(adminEmail)) {
      resultados.push({ nombre: p.areaNombre, enviado: false, error: 'Administrador sin correo registrado' })
      continue
    }
    const res = await enviarCorreo(
      adminEmail,
      `Recordatorio de Paz y Salvo — ${colaboradorNombre}`,
      `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto">
         <p>Estimado/a <strong>${escHtml(p.adminNombre || 'Jefe de Área')}</strong>:</p>
         <p>Le recordamos que <strong>${escHtml(colaboradorNombre)}</strong> tiene pendiente su paz y salvo en el área <strong>${escHtml(p.areaNombre)}</strong>.</p>
         <p>Por favor ingrese al sistema y gestione la solicitud a la brevedad.</p>
         <p style="text-align:center;margin:24px 0">
           <a href="https://pazysalvogoyavier.netlify.app"
              style="background:#1e3a5f;color:#fff;text-decoration:none;padding:12px 28px;border-radius:6px;font-weight:bold;font-size:15px;display:inline-block">
             Ir al Sistema de Paz y Salvo
           </a>
         </p>
         <hr style="margin:16px 0;border:none;border-top:1px solid #eee">
         <p style="color:#888;font-size:12px">Sistema de Paz y Salvo — Colegio Campestre Goyavier</p>
       </div>`
    )
    if (res.ok) enviados++
    resultados.push({ nombre: p.areaNombre, adminEmail, enviado: res.ok, error: res.error ?? null })
  }

  await log(ses.username, ses.rol, 'ENVIAR_RECORDATORIO',
    `${colaboradorNombre} — ${enviados}/${pendientes.length} enviados`)
  return { ok: true, mensaje: `${enviados} recordatorio(s) enviado(s)`, resultados }
}

async function accionEnviarSolicitudTH(body: Body, ses: SessionData) {
  const r = await accionGenerarDocumento(body, ses)
  if (!r.ok) return { ok: false, error: (r as Record<string, string>).error || 'Error generando documento' }

  const doc = (r as Record<string, Record<string, unknown>>).documento

  // Modo preview: devuelve los datos del documento sin enviar correo
  if (body.preview === true) {
    return { ok: true, preview: true, datos: doc }
  }

  const emailTH = await getConfig('EMAIL_TALENTO_HUMANO')

  if (!emailTH || !isValidEmail(emailTH)) {
    await log(ses.username, ses.rol, 'SOLICITUD_TH', `${doc?.nombre} — Sin email TH configurado`)
    return { ok: true, correoEnviado: false,
      mensaje: 'Paz y salvo registrado. Configura el email de Talento Humano en SA → Configuración para enviar automáticamente.',
      datos: doc }
  }

  const areas = (doc?.areas ?? []) as Body[]
  const areasList = areas.map(a => `<li><strong>${escHtml(a.nombre)}</strong> — ${escHtml(a.responsableNombre || a.responsable)}</li>`).join('')
  const fechaStr  = new Date(String(doc?.fechaEmision)).toLocaleDateString('es-CO', { year: 'numeric', month: 'long', day: 'numeric' })

  const pdfBase64 = typeof body.pdfBase64 === 'string' && body.pdfBase64 ? body.pdfBase64 : null
  const nombreArchivo = `PazYSalvo_${String(doc?.nombre ?? 'Colaborador').replace(/\s+/g, '_')}.pdf`
  const attachments = pdfBase64
    ? [{ filename: nombreArchivo, content: pdfBase64, encoding: 'base64', contentType: 'application/pdf' }]
    : undefined

  const res = await enviarCorreo(
    emailTH,
    `Paz y Salvo Completo — ${doc?.nombre} (${doc?.cedula})`,
    `<h2 style="color:#1a1a2e">Paz y Salvo Completo</h2>
     <table style="border-collapse:collapse;margin-bottom:16px">
       <tr><td style="padding:4px 12px 4px 0;color:#666">Colaborador</td><td><strong>${escHtml(doc?.nombre)}</strong></td></tr>
       <tr><td style="padding:4px 12px 4px 0;color:#666">Cédula</td><td>${escHtml(doc?.cedula)}</td></tr>
       <tr><td style="padding:4px 12px 4px 0;color:#666">Fecha de emisión</td><td>${escHtml(fechaStr)}</td></tr>
       <tr><td style="padding:4px 12px 4px 0;color:#666">Código de verificación</td><td><code>${escHtml(doc?.codigoVerificacion)}</code></td></tr>
     </table>
     <p><strong>Áreas aprobadas:</strong></p>
     <ul style="line-height:1.8">${areasList}</ul>
     <hr style="margin:16px 0;border:none;border-top:1px solid #eee">
     <p style="color:#888;font-size:12px">Sistema de Paz y Salvo — ${escHtml(doc?.institucion)}</p>`,
    attachments
  )

  await log(ses.username, ses.rol, 'SOLICITUD_TH',
    `${doc?.nombre} — ${res.ok ? 'OK' : 'Error: ' + res.error}`)
  return { ok: true, correoEnviado: res.ok,
    mensaje: res.ok
      ? 'Solicitud de paz y salvo enviada a Talento Humano'
      : `Documento generado pero error al enviar correo: ${res.error}`,
    datos: doc }
}

// ─── DIAGNÓSTICO ──────────────────────────────────────────────────────────────
async function accionDiagnosticarLogin(body: Body) {
  const { data: u } = await supabase.from('ps_usuarios').select('*').ilike('username', String(body.username || '')).maybeSingle()
  if (!u) return { ok: true, existe: false, mensaje: 'Usuario no encontrado' }
  const pActivo = await procesoActivo()
  return { ok: true, existe: true, username: u.username, rol: u.rol, activo: u.activo,
           tieneAuth: !!(u.auth_user_id), email: u.email || '', procesoActivo: pActivo,
           mensaje: !u.activo         ? 'Cuenta inactiva'
             : !u.auth_user_id        ? 'Sin cuenta Supabase Auth — ejecutar script de migración'
             : !pActivo && u.rol !== 'SUPERADMIN' ? 'Proceso no activo'
             : 'Cuenta OK' }
}

// ─── LOGS ─────────────────────────────────────────────────────────────────────
async function accionGetLogs() {
  const { data } = await supabase.from('ps_logs').select('*').order('timestamp', { ascending: false }).limit(200)
  return { ok: true, logs: (data ?? []).map(l => ({
    timestamp: l.timestamp, usuario: l.usuario, rol: l.rol, accion: l.accion, detalle: l.detalle,
  })) }
}

// ─── ROUTER ───────────────────────────────────────────────────────────────────
const PUBLIC_ACTIONS = new Set(['verificar_codigo', 'diagnosticar_login'])
const ADMIN_ROLES    = new Set(['ADMIN', 'SUPERADMIN'])
const SA             = (s: SessionData) => s.rol === 'SUPERADMIN'
const ADMIN          = (s: SessionData) => ADMIN_ROLES.has(s.rol)

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin') ?? ''
  // Wrapper local para no pasar origin en cada llamada dentro de este handler
  const resp = (data: unknown, status = 200) => jsonResp(data, status, origin)

  if (req.method === 'OPTIONS') return new Response(null, { headers: getCorsHeaders(origin) })
  if (req.method !== 'POST')    return resp({ ok: false, error: 'Método no permitido' }, 405)

  let body: Body
  try { body = await req.json() }
  catch { return resp({ ok: false, error: 'JSON inválido' }, 400) }

  const action = String(body.action || '')

  // ── Autenticación via Supabase Auth JWT ────────────────────────────────────
  let ses: SessionData | undefined
  if (!PUBLIC_ACTIONS.has(action)) {
    const authHeader = req.headers.get('Authorization') ?? ''
    const jwt = authHeader.replace(/^Bearer\s+/i, '').trim()
    if (!jwt) return jsonResp({ ok: false, error: 'No autenticado' }, 401)

    // Verificar el JWT contra Supabase Auth (valida firma, expiración y revocación).
    // getUser() usa la clave secreta del servidor — no se puede falsificar desde el cliente.
    const { data: { user: authUser }, error: authErr } = await supabase.auth.getUser(jwt)
    if (authErr || !authUser) return jsonResp({ ok: false, error: 'Token inválido' }, 401)

    // El token es auténtico — ahora extraer custom claims del payload.
    let claims: Record<string, unknown>
    try {
      const payload = jwt.split('.')[1]
      claims = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')))
    } catch {
      return jsonResp({ ok: false, error: 'Token inválido' }, 401)
    }

    const rol = String(claims.rol ?? '')
    if (!rol) return jsonResp({ ok: false, error: 'Token sin permisos de rol. Contacta al administrador.' }, 403)

    ses = {
      usuarioId:  String(claims.usuario_id ?? ''),
      authUserId: String(claims.sub ?? ''),
      username:   String(claims.username ?? ''),
      email:      String(claims.email ?? ''),
      rol,
      areaId:     ((claims.area_ids ?? []) as string[])[0] ?? '',
      areaIds:    (claims.area_ids ?? []) as string[],
      cedula:     String(claims.cedula ?? ''),
    }
  }

  try {
    switch (action) {
      // Públicas
      case 'verificar_codigo':  return jsonResp(await accionVerificarCodigo(body))
      case 'diagnosticar_login':return jsonResp(await accionDiagnosticarLogin(body))

      // Cualquier sesión activa
      case 'verify_session': {
        const { data: uVS } = await supabase.from('ps_usuarios').select('cambiar_password, cedula').eq('id', ses!.usuarioId).maybeSingle()
        let nombreCompleto: string | null = null
        if (uVS?.cedula) {
          const { data: colVS } = await supabase.from('ps_colaboradores').select('nombre').eq('cedula', uVS.cedula).maybeSingle()
          nombreCompleto = colVS?.nombre ?? null
        }
        return jsonResp({ ok: true, rol: ses!.rol, username: ses!.username, nombre: nombreCompleto, cambiarPassword: uVS?.cambiar_password ?? false })
      }
      case 'get_mi_estado':               return jsonResp(await accionGetMiEstado(body))
      case 'cambiar_password':            return jsonResp(await accionCambiarPassword(body, ses!))
      case 'solicitar_password_default':  return jsonResp(await accionSolicitarPasswordDefault(ses!))
      case 'get_pendientes_recordatorio': return jsonResp(await accionGetPendientesRecordatorio(body, ses!))
      case 'enviar_recordatorio':         return jsonResp(await accionEnviarRecordatorio(body, ses!))
      case 'enviar_solicitud_th':         return jsonResp(await accionEnviarSolicitudTH(body, ses!))
      case 'generar_documento':
      case 'descargar_pdf': {
        if (ses!.rol === 'COLABORADOR') return jsonResp({ ok: false, error: 'Acceso denegado' }, 403)
        if (ses!.rol === 'ADMIN' && body.colaboradorId) {
          const { data: ap } = await supabase.from('ps_aprobaciones').select('id')
            .eq('colaborador_id', String(body.colaboradorId))
            .in('area_id', ses!.areaIds).eq('estado', 'APROBADO').limit(1).maybeSingle()
          if (!ap) return jsonResp({ ok: false, error: 'No tienes acceso al acta de este colaborador' }, 403)
        }
        return jsonResp(action === 'descargar_pdf'
          ? await accionDescargarPdf(body, ses!)
          : await accionGenerarDocumento(body, ses!))
      }
      case 'get_areas':                   return jsonResp(await accionGetAreas())
      case 'get_estado_colaborador':      return jsonResp(await accionGetEstadoColaborador(body))
      case 'get_config_admin':            return jsonResp(await accionGetConfigAdmin(ses!))
      case 'set_emails_notificacion':     return jsonResp(await accionSetEmailsNotificacion(body, ses!))

      // ADMIN o SUPERADMIN
      case 'get_colaboradores_area': {
        if (!ADMIN(ses!)) return jsonResp({ ok: false, error: 'Acceso denegado' })
        return jsonResp(await accionGetColaboradoresArea(ses!))
      }
      case 'aprobar': {
        if (!ADMIN(ses!)) return jsonResp({ ok: false, error: 'Acceso denegado' })
        return jsonResp(await accionAprobar(body, ses!))
      }
      case 'rechazar': {
        if (!ADMIN(ses!)) return jsonResp({ ok: false, error: 'Acceso denegado' })
        return jsonResp(await accionRechazar(body, ses!))
      }
      case 'aprobar_masivo': {
        if (!ADMIN(ses!)) return jsonResp({ ok: false, error: 'Acceso denegado' })
        return jsonResp(await accionAprobarMasivo(body, ses!))
      }

      // SUPERADMIN únicamente
      case 'get_all_colaboradores': {
        if (!SA(ses!)) return jsonResp({ ok: false, error: 'Acceso denegado' })
        return jsonResp(await accionGetAllColaboradores())
      }
      case 'crear_colaborador': {
        if (!SA(ses!)) return jsonResp({ ok: false, error: 'Acceso denegado' })
        return jsonResp(await accionCrearColaborador(body, ses!))
      }
      case 'editar_colaborador': {
        if (!SA(ses!)) return jsonResp({ ok: false, error: 'Acceso denegado' })
        return jsonResp(await accionEditarColaborador(body, ses!))
      }
      case 'toggle_paz_salvo': {
        if (!SA(ses!)) return jsonResp({ ok: false, error: 'Acceso denegado' })
        return jsonResp(await accionTogglePazSalvo(body, ses!))
      }
      case 'toggle_paz_salvo_masivo': {
        if (!SA(ses!)) return jsonResp({ ok: false, error: 'Acceso denegado' })
        return jsonResp(await accionTogglePazSalvoMasivo(body, ses!))
      }
      case 'carga_masiva_colaboradores': {
        if (!SA(ses!)) return jsonResp({ ok: false, error: 'Acceso denegado' })
        return jsonResp(await accionCargaMasivaColaboradores(body, ses!))
      }
      case 'get_usuarios': {
        if (!SA(ses!)) return jsonResp({ ok: false, error: 'Acceso denegado' })
        return jsonResp(await accionGetUsuarios())
      }
      case 'crear_usuario': {
        if (!SA(ses!)) return jsonResp({ ok: false, error: 'Acceso denegado' })
        return jsonResp(await accionCrearUsuario(body, ses!))
      }
      case 'editar_usuario': {
        if (!SA(ses!)) return jsonResp({ ok: false, error: 'Acceso denegado' })
        return jsonResp(await accionEditarUsuario(body, ses!))
      }
      case 'resetear_password': {
        if (!SA(ses!)) return jsonResp({ ok: false, error: 'Acceso denegado' })
        return jsonResp(await accionResetearPassword(body, ses!))
      }
      case 'get_config': {
        if (!SA(ses!)) return jsonResp({ ok: false, error: 'Acceso denegado' })
        return jsonResp(await accionGetConfig())
      }
      case 'set_proceso_activo': {
        if (!SA(ses!)) return jsonResp({ ok: false, error: 'Acceso denegado' })
        return jsonResp(await accionSetProcesoActivo(body, ses!))
      }
      case 'set_config_sa': {
        if (!SA(ses!)) return jsonResp({ ok: false, error: 'Acceso denegado' })
        return jsonResp(await accionSetConfigSA(body, ses!))
      }
      case 'get_vista_global': {
        if (!SA(ses!)) return jsonResp({ ok: false, error: 'Acceso denegado' })
        return jsonResp(await accionGetVistaGlobal())
      }
      case 'forzar_paz_salvo': {
        if (!SA(ses!)) return jsonResp({ ok: false, error: 'Acceso denegado' })
        return jsonResp(await accionForzarPazSalvo(body, ses!))
      }
      case 'resetear_aprobaciones': {
        if (!SA(ses!)) return jsonResp({ ok: false, error: 'Acceso denegado' })
        return jsonResp(await accionResetearAprobaciones(body, ses!))
      }
      case 'crear_area': {
        if (!SA(ses!)) return jsonResp({ ok: false, error: 'Acceso denegado' })
        return jsonResp(await accionCrearArea(body, ses!))
      }
      case 'editar_area': {
        if (!SA(ses!)) return jsonResp({ ok: false, error: 'Acceso denegado' })
        return jsonResp(await accionEditarArea(body, ses!))
      }
      case 'get_logs': {
        if (!SA(ses!)) return jsonResp({ ok: false, error: 'Acceso denegado' })
        return jsonResp(await accionGetLogs())
      }

      // Acciones obsoletas de la era GAS/custom-auth
      case 'login':
      case 'login_google':
      case 'logout':
      case 'agregar_cedula_usuarios':
      case 'agregar_jefes_area':
      case 'agregar_cols_colaboradores':
      case 'agregar_tipo_areas':
      case 'migracion_areas':
      case 'reparar_area_ids':
      case 'diagnostico_aprobaciones':
      case 'diagnosticar_admins':
      case 'diagnosticar_y_reparar_admins':
        return jsonResp({ ok: true, mensaje: 'Esta acción ya no aplica. El sistema usa Supabase Auth.' })

      default:
        return jsonResp({ ok: false, error: `Acción no reconocida: ${action}` })
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error(`[ps-api] Error en "${action}":`, e)
    return jsonResp({ ok: false, error: 'Error interno del servidor', detalle: msg }, 500)
  }
})
