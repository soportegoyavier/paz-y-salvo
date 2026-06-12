/**
 * Helpers de navegación para los tests de Playwright.
 * Centraliza la lógica de navegación a paneles, incluyendo
 * soporte para mobile (sidebar off-canvas) y retry ante
 * race condition del doble iniciarApp().
 */
import { Page } from '@playwright/test';

/**
 * Navega a Vista Global (#panel-sa-global) y espera que
 * select#vg-tipo-filter sea visible (confirma que loadSAGlobal() completó).
 *
 * Maneja:
 * - Mobile: abre el hamburger antes de clicar el nav item
 * - Race condition: reintenta si un iniciarApp() tardío resetea el panel
 */
export async function navegarVistaGlobal(page: Page): Promise<void> {
  // Detectar modo mobile (hamburger visible = sidebar off-canvas)
  const hamburger = page.locator('#btn-hamburger');
  const isMobile = await hamburger.isVisible().catch(() => false);

  for (let attempt = 0; attempt < 3; attempt++) {
    // En mobile, abrir el sidebar antes de clicar el nav item
    if (isMobile) {
      const sidebarAbierto = await page.locator('#sidebar.open').count().then(n => n > 0).catch(() => false);
      if (!sidebarAbierto) {
        await hamburger.click().catch(() => {});
        await page.waitForTimeout(200); // animación slide-in
      }
    }

    await page.click('#nav-sa-global');

    // Esperar que el panel obtenga la clase 'active' (CSS activa el display:block)
    await page.waitForFunction(
      () => document.getElementById('panel-sa-global')?.classList.contains('active'),
      { timeout: 5_000 }
    ).catch(() => {});

    // Esperar que loadSAGlobal() renderice su contenido (select aparece tras API response)
    const loaded = await page.locator('select#vg-tipo-filter')
      .waitFor({ state: 'visible', timeout: 18_000 })
      .then(() => true).catch(() => false);

    if (loaded) return;

    // Retry: el panel puede haber sido reseteado por un iniciarApp() tardío
    await page.waitForTimeout(300);
  }

  throw new Error('navegarVistaGlobal: no se pudo cargar Vista Global en 3 intentos');
}

/**
 * Selector de fila en la tabla de Vista Global scoped a #vg-table-wrap.
 * Evita strict mode violation con la tabla del panel SA-Colaboradores
 * (oculto pero presente en el DOM).
 */
export function filaVG(page: Page, nombreColaborador: string) {
  return page.locator(`#vg-table-wrap tr:has-text("${nombreColaborador}")`).first();
}
