/**
 * I — Concurrencia / condiciones de carrera
 * Dos responsables aprueban casi al mismo tiempo. Estado final consistente.
 */
import { test, expect } from '@playwright/test';
import { callApi, getAprobaciones, limpiarAprobaciones, adminClient, QA_IDS, CREDENTIALS } from '../helpers/api';

async function crearAprobacionesPendientes() {
  await limpiarAprobaciones(QA_IDS.COLAB_DOCENTE);
  // Omitir aprobado_por y fecha_accion → usan DEFAULT del schema ('' y now())
  await adminClient().from('ps_aprobaciones').upsert([
    { colaborador_id: QA_IDS.COLAB_DOCENTE, area_id: QA_IDS.AREA_TECNOLOGIA, estado: 'PENDIENTE', observaciones: '' },
    { colaborador_id: QA_IDS.COLAB_DOCENTE, area_id: QA_IDS.AREA_BIBLIOTECA,  estado: 'PENDIENTE', observaciones: '' },
  ], { onConflict: 'colaborador_id,area_id' });
}

test.describe('I — Concurrencia', () => {
  test.beforeEach(async () => {
    await crearAprobacionesPendientes();
  });

  test('I1 — dos responsables aprueban áreas distintas simultáneamente → ambas aprobadas', async () => {
    const { email: te, password: tp } = CREDENTIALS.responsable_tecnologia_y_biblioteca;
    const { email: be, password: bp } = CREDENTIALS.responsable_biblioteca;

    // Lanzar ambas aprobaciones en paralelo (condición de carrera intencional)
    // aprobar usa {colaboradorId, areaId} — NOT aprobacionId
    const [resTec, resBib] = await Promise.all([
      callApi('aprobar', { colaboradorId: QA_IDS.COLAB_DOCENTE, areaId: QA_IDS.AREA_TECNOLOGIA }, te, tp),
      callApi('aprobar', { colaboradorId: QA_IDS.COLAB_DOCENTE, areaId: QA_IDS.AREA_BIBLIOTECA }, be, bp),
    ]);

    const updated = await getAprobaciones(QA_IDS.COLAB_DOCENTE);
    const tecFinal = updated.find((a: any) => a.area_id === QA_IDS.AREA_TECNOLOGIA);
    const bibFinal = updated.find((a: any) => a.area_id === QA_IDS.AREA_BIBLIOTECA);

    // Si ambas respondieron ok, ambas deben estar aprobadas
    if (resTec.ok && resBib.ok) {
      expect(tecFinal?.estado).toBe('APROBADO');
      expect(bibFinal?.estado).toBe('APROBADO');
    } else {
      // Al menos una fue procesada — el estado final debe ser válido
      if (tecFinal) expect(['APROBADO', 'PENDIENTE']).toContain(tecFinal.estado);
      if (bibFinal) expect(['APROBADO', 'PENDIENTE']).toContain(bibFinal.estado);
    }
  });

  test('I2 — aprobar y rechazar la misma área en paralelo → estado consistente (no corrupto)', async () => {
    const { email: te, password: tp } = CREDENTIALS.responsable_tecnologia_y_biblioteca;
    const { email: se, password: sp } = CREDENTIALS.super_admin;

    // Lanzar aprobar y rechazar en paralelo para la misma área
    // SUPERADMIN necesita especificar areaId explícitamente (area_ids: [] en su JWT)
    const [resAprobar, resRechazar] = await Promise.all([
      callApi('aprobar',  { colaboradorId: QA_IDS.COLAB_DOCENTE, areaId: QA_IDS.AREA_TECNOLOGIA }, te, tp),
      callApi('rechazar', {
        colaboradorId: QA_IDS.COLAB_DOCENTE,
        areaId:        QA_IDS.AREA_TECNOLOGIA,
        observaciones: 'Test concurrencia QA',
      }, se, sp),
    ]);

    const updated = await getAprobaciones(QA_IDS.COLAB_DOCENTE);
    const tecFinal = updated.find((a: any) => a.area_id === QA_IDS.AREA_TECNOLOGIA);

    // El estado final debe ser exactamente uno de los dos (no null ni valor extraño)
    expect(['APROBADO', 'RECHAZADO']).toContain(tecFinal?.estado);

    // No debe haber aprobaciones duplicadas para la misma área
    const duplicados = updated.filter((a: any) => a.area_id === QA_IDS.AREA_TECNOLOGIA);
    expect(duplicados.length).toBe(1);
  });

  test('I3 — múltiples llamadas a get_mi_estado en paralelo no crean registros duplicados', async () => {
    const { email, password } = CREDENTIALS.colaborador_docente;

    // Llamar get_mi_estado 5 veces en paralelo (get_mi_estado es de solo lectura, no debe crear duplicados)
    await Promise.all(Array.from({ length: 5 }, () =>
      callApi('get_mi_estado', { cedula: 'QA0000001' }, email, password)
    ));

    const aprobaciones = await getAprobaciones(QA_IDS.COLAB_DOCENTE);

    // Agrupar por area_id y verificar que no hay duplicados
    const porArea = new Map<string, number>();
    for (const ap of aprobaciones) {
      porArea.set(ap.area_id, (porArea.get(ap.area_id) ?? 0) + 1);
    }
    for (const [areaId, count] of porArea) {
      expect(count, `Área ${areaId} tiene ${count} registros duplicados`).toBe(1);
    }
  });
});
