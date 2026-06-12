/**
 * Helpers de autenticación para los tests de Playwright.
 * Selectores basados en los IDs reales de index.html:
 *   email    → #login-username
 *   password → #login-password
 *   submit   → #login-btn
 *   app      → #screen-app  (class "active" = visible)
 *   error    → #login-error (class "visible" = hay error)
 *   logout   → button[title="Cerrar sesión"]
 */
import { Page, expect } from '@playwright/test';

export type RolKey =
  | 'colaborador_docente'
  | 'colaborador_admin'
  | 'colaborador_servicios'
  | 'jefe_area_matematicas'
  | 'responsable_biblioteca'
  | 'responsable_tecnologia_y_biblioteca'
  | 'talento_humano'
  | 'coordinacion_administrativa'
  | 'super_admin'
  | 'colaborador_autoexclusion';

export const CREDENTIALS: Record<RolKey, { email: string; password: string }> = {
  colaborador_docente:                { email: 'qa_colab_docente@goyavier.test',   password: 'QA_Test_2026!' },
  colaborador_admin:                  { email: 'qa_colab_admin@goyavier.test',     password: 'QA_Test_2026!' },
  colaborador_servicios:              { email: 'qa_colab_servicios@goyavier.test', password: 'QA_Test_2026!' },
  jefe_area_matematicas:              { email: 'qa_jefe_matematicas@goyavier.test',password: 'QA_Test_2026!' },
  responsable_biblioteca:             { email: 'qa_resp_biblioteca@goyavier.test', password: 'QA_Test_2026!' },
  responsable_tecnologia_y_biblioteca:{ email: 'qa_resp_tec_bib@goyavier.test',    password: 'QA_Test_2026!' },
  talento_humano:                     { email: 'qa_talento_humano@goyavier.test',  password: 'QA_Test_2026!' },
  coordinacion_administrativa:        { email: 'qa_coord_admin@goyavier.test',     password: 'QA_Test_2026!' },
  super_admin:                        { email: 'qa_superadmin@goyavier.test',      password: 'QA_Test_2026!' },
  colaborador_autoexclusion:          { email: 'qa_colab_autoexcl@goyavier.test',  password: 'QA_Test_2026!' },
};

/** Hace login en la app vía el formulario de la UI. */
export async function loginAs(page: Page, rol: RolKey): Promise<void> {
  const { email, password } = CREDENTIALS[rol];
  await page.goto('/');

  await page.waitForSelector('#login-username', { state: 'visible', timeout: 12_000 });
  await page.fill('#login-username', email);
  await page.fill('#login-password', password);
  await page.click('#login-btn');

  // Esperar hasta 25s a que ocurra alguna transición
  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline) {
    // 1. App cargada — éxito
    const appActive = await page.locator('#screen-app').evaluate(
      el => el.classList.contains('active')
    ).catch(() => false);
    if (appActive) return;

    // 2. Modal de primer login — completarlo y continuar
    const modalActive = await page.locator('#modal-primer-login').evaluate(
      el => el.classList.contains('active')
    ).catch(() => false);
    if (modalActive) {
      await page.fill('#pl-actual', password);
      await page.fill('#pl-nueva', password);
      await page.fill('#pl-confirmar', password);
      await page.click('#pl-btn');
      await page.locator('#screen-app').waitFor({ state: 'visible', timeout: 15_000 });
      return;
    }

    // 3. Error de login visible — fallar con mensaje útil
    const errVisible = await page.locator('#login-error').evaluate(
      el => el.classList.contains('visible') ? (el as HTMLElement).innerText.trim() : ''
    ).catch(() => '');
    if (errVisible) {
      throw new Error(`Login fallido para ${email}: "${errVisible}"`);
    }

    await page.waitForTimeout(400);
  }

  // Timeout — recolectar estado para diagnóstico
  const errText = await page.locator('#login-error').innerText().catch(() => '');
  const bodySnip = await page.locator('body').innerText().catch(() => '').then(t => t.slice(0, 300));
  throw new Error(
    `loginAs(${rol}): #screen-app nunca se activó (25s).\n` +
    `#login-error: "${errText}"\nBody: ${bodySnip}`
  );
}

/** Cierra sesión desde la UI. */
export async function logout(page: Page): Promise<void> {
  const btn = page.locator('button[title="Cerrar sesión"], button:has-text("Cerrar sesión")');
  if (await btn.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await btn.click();
  }
  await expect(page.locator('#login-username')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.spinner, .loading, [data-testid="loading"]')).toHaveCount(0);
}

/** Verifica que la sesión persiste tras recargar la página. */
export async function assertSessionPersists(page: Page): Promise<void> {
  await page.reload();
  const appActive = await page.locator('#screen-app')
    .waitFor({ state: 'visible', timeout: 15_000 })
    .then(() => true)
    .catch(() => false);
  if (!appActive) throw new Error('assertSessionPersists: la sesión no persiste tras recargar');
  await expect(page.locator('#screen-login')).not.toHaveClass(/active/, { timeout: 3_000 });
}
