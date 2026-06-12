/**
 * B — Flujo de aprobación paso a paso
 * Verifica áreas del docente → aprueba vía UI → verifica estado final
 *
 * Notas sobre el modelo de datos:
 * - get_mi_estado NO crea aprobaciones; devuelve estadoPorArea derivado de ps_areas
 * - Las aprobaciones en ps_aprobaciones se crean al hacer "Aprobar/Rechazar" (upsert)
 * - El flujo UI: tabla Gestionar → modal #modal-gestionar → #btn-aprobar-modal → #confirm-ok-btn
 */
import { test, expect } from '@playwright/test';
import { loginAs }      from '../helpers/auth';
import { callApi, limpiarAprobaciones, getAprobaciones, adminClient, QA_IDS, CREDENTIALS } from '../helpers/api';

const AREAS_ESPERADAS_DOCENTE = [
  'QA Secretaría Académica',
  'QA Tecnología',
  'QA Biblioteca',
  'QA Restaurante',
  'QA Convivencia',
  'QA Rectora',
  'QA Talento Humano',
];

test.describe('B — Flujo de aprobación', () => {
  test.beforeEach(async () => {
    await limpiarAprobaciones(QA_IDS.COLAB_DOCENTE);
  });

  test('B1 — get_mi_estado devuelve exactamente las áreas correctas para docente primaria', async () => {
    const { email, password } = CREDENTIALS.colaborador_docente;
    const res = await callApi('get_mi_estado', { cedula: 'QA0000001' }, email, password);
    expect(res.ok).toBe(true);

    const estadoPorArea = (res as any).estadoPorArea ?? [];
    const nombres = estadoPorArea.map((a: any) => a.areaNombre ?? '');

    for (const area of AREAS_ESPERADAS_DOCENTE) {
      expect(nombres, `Falta área: ${area}`).toContain(area);
    }
    // Matemáticas solo aplica a docentes de SECUNDARIA
    expect(nombres, 'Área Matemáticas no debe aparecer para docente primaria').not.toContain('QA Jefe Área Matemáticas');
    // Coord. Administrativa solo aplica a ADMINISTRATIVO
    expect(nombres).not.toContain('QA Coord. Administrativa');
  });

  test('B2 — get_mi_estado incluye Jefe Área Matemáticas para docente de secundaria', async () => {
    await limpiarAprobaciones(QA_IDS.JEFE_MATEMATICAS);
    const { email, password } = CREDENTIALS.jefe_area_matematicas;
    const res = await callApi('get_mi_estado', { cedula: 'QA0000004' }, email, password);
    expect(res.ok).toBe(true);

    const nombres = ((res as any).estadoPorArea ?? []).map((a: any) => a.areaNombre ?? '');
    expect(nombres).toContain('QA Jefe Área Matemáticas');
  });

  test('B3 — aprobar una área vía UI actualiza el registro en DB', async ({ page }) => {
    // Login como responsable de Biblioteca
    await loginAs(page, 'responsable_biblioteca');

    // Debe aparecer al menos un colaborador en la tabla
    await expect(page.locator('#area-table-container table')).toBeVisible({ timeout: 10_000 });

    // Abrir modal de gestión del primer colaborador
    const btnGestionar = page.locator('button:has-text("Gestionar")').first();
    await expect(btnGestionar).toBeVisible({ timeout: 8_000 });
    await btnGestionar.click();

    // En el modal, hacer click en Aprobar
    await expect(page.locator('#btn-aprobar-modal')).toBeVisible({ timeout: 5_000 });
    await page.click('#btn-aprobar-modal');

    // Confirmar el dialog de confirmación
    await expect(page.locator('#confirm-ok-btn')).toBeVisible({ timeout: 5_000 });
    await page.click('#confirm-ok-btn');

    // Esperar a que el modal se cierre y la tabla se recargue
    await expect(page.locator('#modal-gestionar')).not.toHaveClass(/active/, { timeout: 8_000 });
    await expect(page.locator('#area-table-container table')).toBeVisible({ timeout: 8_000 });

    // Verificar en DB que hay al menos 1 aprobación con estado APROBADO para el área Biblioteca
    const aprobaciones = await getAprobaciones(QA_IDS.COLAB_DOCENTE);
    const biblio = aprobaciones.find((a: any) => a.ps_areas?.nombre === 'QA Biblioteca');
    expect(biblio?.estado).toBe('APROBADO');
  });

  test('B4 — estado final OK cuando todas las áreas son aprobadas por API', async () => {
    const { email: semail, password: spass } = CREDENTIALS.super_admin;

    // Primero obtenemos las áreas del colaborador via get_mi_estado
    const { email: cemail, password: cpass } = CREDENTIALS.colaborador_docente;
    const estadoR = await callApi('get_mi_estado', { cedula: 'QA0000001' }, cemail, cpass);
    expect(estadoR.ok).toBe(true);

    const estadoPorArea = (estadoR as any).estadoPorArea ?? [];
    const areasRequeridas = estadoPorArea.filter((a: any) => a.estado !== 'OMITIDO');
    expect(areasRequeridas.length).toBeGreaterThan(0);

    // Aprobar todas las áreas vía SUPERADMIN
    for (const area of areasRequeridas) {
      await adminClient()
        .from('ps_aprobaciones')
        .upsert({
          colaborador_id: QA_IDS.COLAB_DOCENTE,
          area_id: area.areaId,
          estado: 'APROBADO',
          observaciones: '',
          aprobado_por: 'qa_superadmin',
          fecha_accion: new Date().toISOString(),
        }, { onConflict: 'colaborador_id,area_id' });
    }

    // Verificar estado final
    const estadoFinal = await callApi('get_mi_estado', { cedula: 'QA0000001' }, cemail, cpass);
    expect(estadoFinal.ok).toBe(true);
    expect((estadoFinal as any).pazYSalvoCompleto).toBe(true);
  });
});
