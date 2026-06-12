/**
 * D — Múltiples áreas por usuario
 * qa_resp_tec_bib gestiona Tecnología Y Biblioteca.
 * UI: tabs de área → tabla de colaboradores → Gestionar → Aprobar → Confirmar
 */
import { test, expect } from '@playwright/test';
import { loginAs }      from '../helpers/auth';
import { getAprobaciones, limpiarAprobaciones, adminClient, QA_IDS, CREDENTIALS } from '../helpers/api';

test.describe('D — Múltiples áreas por usuario', () => {
  test.beforeAll(async () => {
    await limpiarAprobaciones(QA_IDS.COLAB_DOCENTE);
  });

  test('D1 — responsable TEC+BIB ve tabs de ambas áreas al entrar', async ({ page }) => {
    await loginAs(page, 'responsable_tecnologia_y_biblioteca');

    // Con dos áreas, la UI muestra tabs de área
    await expect(page.locator('#area-table-container table')).toBeVisible({ timeout: 10_000 });

    const tabTec = page.locator('button.area-tab:has-text("QA Tecnología")');
    const tabBib = page.locator('button.area-tab:has-text("QA Biblioteca")');
    await expect(tabTec).toBeVisible({ timeout: 6_000 });
    await expect(tabBib).toBeVisible({ timeout: 6_000 });
  });

  test('D2 — aprobar Tecnología vía UI no afecta el estado de Biblioteca', async ({ page }) => {
    await loginAs(page, 'responsable_tecnologia_y_biblioteca');
    await expect(page.locator('#area-table-container table')).toBeVisible({ timeout: 10_000 });

    // Asegurar que estamos en la tab de Tecnología
    const tabTec = page.locator('button.area-tab:has-text("QA Tecnología")');
    await expect(tabTec).toBeVisible({ timeout: 5_000 });
    await tabTec.click();
    await page.waitForTimeout(500);

    // Aprobar el primer colaborador de Tecnología
    const btnGestionar = page.locator('button:has-text("Gestionar")').first();
    await expect(btnGestionar).toBeVisible({ timeout: 6_000 });
    await btnGestionar.click();
    await expect(page.locator('#btn-aprobar-modal')).toBeVisible({ timeout: 5_000 });
    await page.click('#btn-aprobar-modal');
    await expect(page.locator('#confirm-ok-btn')).toBeVisible({ timeout: 5_000 });
    await page.click('#confirm-ok-btn');
    await expect(page.locator('#modal-gestionar')).not.toHaveClass(/active/, { timeout: 8_000 });

    // Verificar en DB: Tecnología aprobada
    const aprobaciones = await getAprobaciones(QA_IDS.COLAB_DOCENTE);
    const tec = aprobaciones.find((a: any) => a.ps_areas?.nombre === 'QA Tecnología');
    expect(tec?.estado).toBe('APROBADO');

    // Biblioteca aún no debe tener registro de aprobación (o si existe debe ser PENDIENTE/RECHAZADO)
    const bib = aprobaciones.find((a: any) => a.ps_areas?.nombre === 'QA Biblioteca');
    if (bib) expect(bib.estado).not.toBe('APROBADO');
  });

  test('D3 — tab Biblioteca sigue mostrando pendientes tras aprobar Tecnología', async ({ page }) => {
    await loginAs(page, 'responsable_tecnologia_y_biblioteca');
    await expect(page.locator('#area-table-container table')).toBeVisible({ timeout: 10_000 });

    // Cambiar a tab Biblioteca
    const tabBib = page.locator('button.area-tab:has-text("QA Biblioteca")');
    await expect(tabBib).toBeVisible({ timeout: 5_000 });
    await tabBib.click();
    await page.waitForTimeout(500);

    // Debe seguir mostrando al menos un colaborador pendiente en Biblioteca
    await expect(page.locator('#area-table-container table')).toBeVisible({ timeout: 8_000 });
    // Verificar que al menos un badge muestra PENDIENTE
    const badgePendiente = page.locator('.badge.badge-pendiente');
    await expect(badgePendiente.first()).toBeVisible({ timeout: 6_000 });
  });
});
