/**
 * H — Seguridad / RLS de Supabase
 * Verificar que las políticas bloquean lecturas y escrituras no autorizadas.
 */
import { test, expect } from '@playwright/test';
import { createClient }  from '@supabase/supabase-js';
import { callApi, anonClient, adminClient, limpiarAprobaciones, getAprobaciones, QA_IDS, CREDENTIALS } from '../helpers/api';

const { STAGING_URL, STAGING_ANON_KEY } = process.env;

async function clienteAutenticado(email: string, password: string) {
  const client = createClient(STAGING_URL!, STAGING_ANON_KEY!, { auth: { persistSession: false } });
  await client.auth.signInWithPassword({ email, password });
  return client;
}

test.describe('H — Seguridad y RLS', () => {
  test.beforeAll(async () => {
    // Crear aprobaciones PENDIENTES para el docente — necesarias para H2 y H3
    await limpiarAprobaciones(QA_IDS.COLAB_DOCENTE);
    // Omitir aprobado_por y fecha_accion para PENDIENTE → usan DEFAULT del schema ('' y now())
    await adminClient().from('ps_aprobaciones').upsert([
      { colaborador_id: QA_IDS.COLAB_DOCENTE, area_id: QA_IDS.AREA_TECNOLOGIA, estado: 'PENDIENTE', observaciones: '' },
      { colaborador_id: QA_IDS.COLAB_DOCENTE, area_id: QA_IDS.AREA_BIBLIOTECA,  estado: 'PENDIENTE', observaciones: '' },
    ], { onConflict: 'colaborador_id,area_id' });
  });

  test('H1 — colaborador no puede leer aprobaciones ajenas directamente desde el cliente', async () => {
    const { email, password } = CREDENTIALS.colaborador_docente;
    const client = await clienteAutenticado(email, password);

    // Intentar leer aprobaciones del colaborador ADMIN (ajenas)
    const { data, error } = await client
      .from('ps_aprobaciones')
      .select('*')
      .eq('colaborador_id', QA_IDS.COLAB_ADMIN);

    await client.auth.signOut();

    // RLS debe devolver 0 filas o un error de permisos
    const filas = data?.length ?? 0;
    expect(filas, 'RLS debe bloquear la lectura de aprobaciones ajenas').toBe(0);
  });

  test('H2 — colaborador no puede actualizar aprobaciones (RLS bloquea sin error, 0 filas afectadas)', async () => {
    const { email, password } = CREDENTIALS.colaborador_docente;
    const client = await clienteAutenticado(email, password);

    const aprobaciones = await getAprobaciones(QA_IDS.COLAB_DOCENTE);
    if (!aprobaciones.length) { test.skip(); await client.auth.signOut(); return; }

    const { data, error } = await client
      .from('ps_aprobaciones')
      .update({ estado: 'APROBADO', aprobado_por: 'HACK' })
      .eq('id', aprobaciones[0].id)
      .select();

    await client.auth.signOut();

    // RLS permite la llamada sin error pero filtra las filas → 0 filas afectadas
    // O bien devuelve error explícito. En ambos casos el estado NO debe haber cambiado.
    const filasAfectadas = data?.length ?? 0;
    const bloqueadoPorRLS = !!error || filasAfectadas === 0;
    expect(bloqueadoPorRLS, 'RLS debe impedir que COLABORADOR actualice aprobaciones').toBe(true);

    // Verificar en DB que el estado NO cambió a 'APROBADO' con aprobado_por='HACK'
    const updated = await getAprobaciones(QA_IDS.COLAB_DOCENTE);
    const hackeada = updated.find((a: any) => a.aprobado_por === 'HACK');
    expect(hackeada, 'Ninguna aprobación debe tener aprobado_por=HACK').toBeUndefined();
  });

  test('H3 — ADMIN no puede leer solicitudes de áreas que no son las suyas', async () => {
    const { email, password } = CREDENTIALS.responsable_biblioteca;
    const client = await clienteAutenticado(email, password);

    // Intentar leer aprobaciones del área Tecnología (no es su área)
    const { data, error } = await client
      .from('ps_aprobaciones')
      .select('*')
      .eq('area_id', QA_IDS.AREA_TECNOLOGIA);

    await client.auth.signOut();

    const filas = data?.length ?? 0;
    expect(filas, 'RLS debe bloquear la lectura de áreas ajenas para ADMIN').toBe(0);
  });

  test('H4 — ADMIN no puede aprobar áreas que no son las suyas vía API', async () => {
    const { email, password } = CREDENTIALS.responsable_biblioteca;

    // Intentar aprobar Tecnología como responsable de Biblioteca
    // La API redirige silenciosamente a su propia área (Biblioteca), NO a Tecnología
    await callApi('aprobar', { colaboradorId: QA_IDS.COLAB_DOCENTE, areaId: QA_IDS.AREA_TECNOLOGIA }, email, password);

    // Verificar: Tecnología NO debe estar APROBADO (solo Biblioteca podría haberlo sido)
    const aprobaciones = await getAprobaciones(QA_IDS.COLAB_DOCENTE);
    const tecAprobada = aprobaciones.find(
      (a: any) => a.area_id === QA_IDS.AREA_TECNOLOGIA && a.estado === 'APROBADO'
    );
    expect(tecAprobada, 'Responsable de Biblioteca no debe poder aprobar Tecnología').toBeUndefined();
  });

  test('H5 — usuario sin autenticación recibe 401 de la Edge Function', async () => {
    const res = await fetch(`${STAGING_URL}/functions/v1/ps-api`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'get_mi_estado', cedula: 'QA0000001' }),
    });
    expect([401, 403]).toContain(res.status);
  });

  test('H6 — COLABORADOR no puede acceder a get_usuarios (solo SUPERADMIN)', async () => {
    const { email, password } = CREDENTIALS.colaborador_docente;
    const res = await callApi('get_usuarios', {}, email, password);
    expect(res.ok).toBe(false);
  });

  test('H7 — ADMIN no puede cambiar configuración global (solo SUPERADMIN)', async () => {
    const { email, password } = CREDENTIALS.responsable_biblioteca;
    const res = await callApi('set_config_sa', { clave: 'PROCESO_ACTIVO', valor: 'FALSE' }, email, password);
    expect(res.ok).toBe(false);
  });
});
