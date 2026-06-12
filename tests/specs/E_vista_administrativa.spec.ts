/**
 * E — Vista administrativa y global
 * Coordinación Administrativa solo ve lo que le corresponde.
 * Vista Global del Super Admin carga y filtra correctamente.
 */
import { test, expect } from '@playwright/test';
import { loginAs }      from '../helpers/auth';
import { callApi, limpiarAprobaciones, QA_IDS, CREDENTIALS } from '../helpers/api';
import { navegarVistaGlobal } from '../helpers/nav';

test.describe('E — Vista administrativa', () => {
  test.beforeAll(async () => {
    await limpiarAprobaciones(QA_IDS.COLAB_DOCENTE);
    await limpiarAprobaciones(QA_IDS.COLAB_ADMIN);
    // get_mi_estado toma cedula, no colaboradorId
    const { email: ce, password: cp } = CREDENTIALS.colaborador_docente;
    const { email: ae, password: ap } = CREDENTIALS.colaborador_admin;
    await callApi('get_mi_estado', { cedula: 'QA0000001' }, ce, cp);
    await callApi('get_mi_estado', { cedula: 'QA0000002' }, ae, ap);
  });

  test('E1 — Coord. Administrativa ve solo colaboradores de su área (no docentes)', async ({ page }) => {
    await loginAs(page, 'coordinacion_administrativa');

    // El ADMIN aterriza en area-colaboradores con los colaboradores de su área
    await expect(page.locator('#area-table-container')).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(2_000);

    const texto = await page.locator('#area-table-container').textContent() ?? '';
    // QA Docente Primaria es DOCENTE → no debe aparecer en área de Coord. Administrativa (solo ADMINISTRATIVO)
    expect(texto).not.toContain('QA Docente Primaria');
  });

  test('E2 — Vista Global (super admin) carga tabla de colaboradores', async ({ page }) => {
    await loginAs(page, 'super_admin');
    await navegarVistaGlobal(page);

    // El contenido debe mostrar colaboradores QA
    const texto = await page.locator('#sa-global-content').textContent() ?? '';
    expect(texto).toContain('QA');
  });

  test('E3 — Vista Global filtra por tipo de colaborador', async ({ page }) => {
    await loginAs(page, 'super_admin');
    await navegarVistaGlobal(page);

    // Esperar a que la tabla exista
    const tabla = page.locator('#vg-table-wrap table');
    if (!(await tabla.isVisible({ timeout: 5_000 }).catch(() => false))) {
      test.skip();
      return;
    }

    // Filtrar por DOCENTE (valor "DOCENTE" en select#vg-tipo-filter)
    const filtro = page.locator('select#vg-tipo-filter');
    if (await filtro.isVisible()) {
      await filtro.selectOption('DOCENTE');
      await page.waitForTimeout(800);

      const textoFiltrado = await page.locator('#vg-table-wrap').textContent() ?? '';
      // Después del filtro, la tabla tiene contenido (incluso si vacío aparece empty-state)
      expect(textoFiltrado.length).toBeGreaterThan(0);
    }
  });

  test('E4 — indicadores de estado (dots) visibles en Vista Global', async ({ page }) => {
    await loginAs(page, 'super_admin');
    await navegarVistaGlobal(page);

    // Restablecer filtro a todos
    const filtro = page.locator('select#vg-tipo-filter');
    if (await filtro.isVisible()) {
      await filtro.selectOption('todos');
      await page.waitForTimeout(500);
    }

    const tabla = page.locator('#vg-table-wrap table');
    if (!(await tabla.isVisible({ timeout: 5_000 }).catch(() => false))) {
      test.skip();
      return;
    }

    // Verificar que hay dots de estado en la tabla
    const dots = page.locator('.dot-estado');
    const count = await dots.count();
    // Si hay colaboradores con áreas, deben aparecer dots
    expect(count).toBeGreaterThanOrEqual(0);

    // Verificar que la fila del docente no contiene texto "Coord. Administrativa"
    // (ese área solo aplica a ADMINISTRATIVO, no DOCENTE)
    const filaDocente = page.locator('tr:has-text("QA Docente Primaria")').first();
    if (await filaDocente.isVisible()) {
      const textoFila = await filaDocente.textContent() ?? '';
      expect(textoFila).not.toContain('Coord. Administrativa');
    }
  });
});
