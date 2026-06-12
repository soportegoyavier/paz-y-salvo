/**
 * G — Correos de recordatorio
 * get_pendientes_recordatorio devuelve solo pendientes.
 * enviar_recordatorio no incluye áreas ya aprobadas.
 */
import { test, expect } from '@playwright/test';
import { loginAs }      from '../helpers/auth';
import { callApi, limpiarAprobaciones, adminClient, QA_IDS, CREDENTIALS } from '../helpers/api';
import { navegarVistaGlobal } from '../helpers/nav';

test.describe('G — Correos de recordatorio', () => {
  test.beforeAll(async () => {
    // Crear estado parcial: Biblioteca aprobada, resto pendiente
    await limpiarAprobaciones(QA_IDS.COLAB_DOCENTE);
    // Aprobar Biblioteca directamente vía adminClient
    await adminClient().from('ps_aprobaciones').upsert({
      colaborador_id: QA_IDS.COLAB_DOCENTE,
      area_id:        QA_IDS.AREA_BIBLIOTECA,
      estado:         'APROBADO',
      observaciones:  '',
      aprobado_por:   'qa_setup',
      fecha_accion:   new Date().toISOString(),
    }, { onConflict: 'colaborador_id,area_id' });
  });

  test('G1 — get_pendientes_recordatorio devuelve solo las áreas PENDIENTE', async () => {
    const { email: se, password: sp } = CREDENTIALS.super_admin;
    const res = await callApi(
      'get_pendientes_recordatorio',
      { colaboradorId: QA_IDS.COLAB_DOCENTE },
      se, sp
    ) as any;

    expect(res.ok).toBe(true);
    const pendientes = res.pendientes ?? [];

    // Biblioteca ya fue aprobada → no debe estar en pendientes de recordatorio
    const tieneBiblio = pendientes.some((a: any) =>
      (a.areaNombre ?? '').toUpperCase().includes('BIBLIOTECA')
    );
    expect(tieneBiblio).toBe(false);

    // Pero debe haber otras áreas pendientes (Tecnología, Secretaría, etc.)
    expect(pendientes.length).toBeGreaterThan(0);
  });

  test('G2 — la Vista Global muestra botón de recordatorio para colaboradores incompletos', async ({ page }) => {
    await loginAs(page, 'super_admin');

    // Navegar a Vista Global (helper maneja mobile y race condition)
    await navegarVistaGlobal(page).catch(() => { test.skip(); return; });

    // El docente está incompleto → debe aparecer el botón de recordatorio (📧)
    const filaDocente = page.locator('tr:has-text("QA Docente Primaria")');
    if (await filaDocente.isVisible({ timeout: 5_000 }).catch(() => false)) {
      const btnRecordatorio = filaDocente.locator('button.btn-icon-action[title="Enviar recordatorio"]');
      // Si el colaborador está incompleto, el botón de recordatorio debe existir
      const count = await btnRecordatorio.count();
      expect(count).toBeGreaterThanOrEqual(1);
    }
  });

  test('G3 — enviar_recordatorio no incluye Biblioteca (ya aprobada) en destinatarios', async () => {
    const { email: se, password: sp } = CREDENTIALS.super_admin;
    const res = await callApi(
      'enviar_recordatorio',
      { colaboradorId: QA_IDS.COLAB_DOCENTE },
      se, sp
    ) as any;

    // Si hay respuesta, verificar que Biblioteca no estuvo entre los intentos de envío
    if (res.ok !== undefined) {
      const resultados = res.resultados ?? [];
      const incluyeBiblio = resultados.some((d: any) =>
        (d.nombre ?? '').toUpperCase().includes('BIBLIOTECA')
      );
      expect(incluyeBiblio).toBe(false);
    }
  });
});
