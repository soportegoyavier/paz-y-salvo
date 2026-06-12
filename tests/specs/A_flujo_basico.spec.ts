/**
 * A — Flujo básico de colaborador
 * Login → ver estado → persistencia → logout → acceso directo bloqueado → seguridad RLS
 */
import { test, expect } from '@playwright/test';
import { loginAs, logout, assertSessionPersists } from '../helpers/auth';
import { limpiarAprobaciones, QA_IDS } from '../helpers/api';

const STAGING_URL = process.env.STAGING_URL!;

test.describe('A — Flujo básico colaborador', () => {
  test.beforeEach(async () => {
    await limpiarAprobaciones(QA_IDS.COLAB_DOCENTE);
  });

  test('A1 — login correcto con credenciales de colaborador', async ({ page }) => {
    await loginAs(page, 'colaborador_docente');
    await expect(page.locator('body')).not.toContainText('Error');
    await expect(page.locator('body')).not.toContainText('401');
    await expect(page.locator('body')).not.toContainText('403');
  });

  test('A2 — colaborador ve su estado al entrar (panel mi-estado activo)', async ({ page }) => {
    await loginAs(page, 'colaborador_docente');

    // El COLABORADOR navega automáticamente a "mi-estado" → se carga #panel-mi-estado
    await expect(page.locator('#panel-mi-estado')).toBeVisible({ timeout: 5_000 });

    // Esperar a que el contenido dinámico cargue (status card o mensaje de error)
    await expect(
      page.locator('#mi-estado-content .collab-status-card, #mi-estado-content .empty-state, #mi-estado-content .area-item').first()
    ).toBeVisible({ timeout: 12_000 });
  });

  test('A3 — la sesión persiste al recargar la página', async ({ page }) => {
    await loginAs(page, 'colaborador_docente');
    await assertSessionPersists(page);
  });

  test('A4 — logout limpio: sin spinner infinito, vuelve al login', async ({ page }) => {
    await loginAs(page, 'colaborador_docente');
    await logout(page);
    await expect(page.locator('.spinner, .loading, [data-testid="loading"]')).toHaveCount(0);
  });

  test('A5 — acceso por URL directa al acta sin sesión → redirige al login', async ({ page }) => {
    await page.goto('/?accion=ver_acta&id=' + QA_IDS.COLAB_DOCENTE);
    const loginVisible = await page.locator('#login-username')
      .waitFor({ state: 'visible', timeout: 8_000 })
      .then(() => true)
      .catch(() => false);
    const errorVisible = await page.locator('body').evaluate(
      el => el.innerText.includes('401') || el.innerText.includes('403') || el.innerText.includes('no autorizado')
    );
    expect(loginVisible || errorVisible).toBe(true);
  });

  test('A6 — colaborador no puede descargar acta de otro colaborador (COLABORADOR → 403)', async ({ page }) => {
    await loginAs(page, 'colaborador_docente');
    // Llamada directa a la Edge Function con el JWT activo del COLABORADOR
    const res = await page.evaluate(async ([stagingUrl, otroId]) => {
      const lsKey = Object.keys(localStorage).find(k => k.includes('auth-token') || k.includes('supabase'));
      let token = '';
      if (lsKey) {
        try { token = JSON.parse(localStorage.getItem(lsKey) ?? '{}')?.access_token ?? ''; } catch { /* */ }
      }
      const r = await fetch(`${stagingUrl}/functions/v1/ps-api`, {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': token ? `Bearer ${token}` : '',
        },
        // IMPORTANTE: usar "action" (no "accion") que es lo que lee la Edge Function
        body: JSON.stringify({ action: 'generar_documento', colaboradorId: otroId }),
      });
      return r.status;
    }, [STAGING_URL, QA_IDS.COLAB_ADMIN] as [string, string]);
    expect([401, 403]).toContain(res);
  });
});
