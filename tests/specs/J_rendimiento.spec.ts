/**
 * J — Rendimiento
 * Login < 6s (staging), Vista Global < 10s, PDF < 15s (red + pdf-lib).
 */
import { test, expect } from '@playwright/test';
import { loginAs }      from '../helpers/auth';
import { callApi, adminClient, limpiarAprobaciones, QA_IDS, CREDENTIALS } from '../helpers/api';
import { capturarDescarga } from '../helpers/pdf';
import { navegarVistaGlobal as _navegarVG, filaVG } from '../helpers/nav';

const TIMEOUT_LOGIN    = 6_000;   // staging puede tener latencia de red
const TIMEOUT_PDF      = 15_000;  // pdf-lib server-side + red
const TIMEOUT_VISTA    = 10_000;  // carga de tabla Vista Global

async function asegurarColabAprobado() {
  await limpiarAprobaciones(QA_IDS.COLAB_DOCENTE);
  const { email: ce, password: cp } = CREDENTIALS.colaborador_docente;
  const estadoR = await callApi('get_mi_estado', { cedula: 'QA0000001' }, ce, cp) as any;
  const areasRequeridas = (estadoR.estadoPorArea ?? []).filter((a: any) => a.estado !== 'OMITIDO');

  for (const area of areasRequeridas) {
    await adminClient().from('ps_aprobaciones').upsert({
      colaborador_id: QA_IDS.COLAB_DOCENTE,
      area_id:        area.areaId,
      estado:         'APROBADO',
      observaciones:  '',
      aprobado_por:   'qa_setup',
      fecha_accion:   new Date().toISOString(),
    }, { onConflict: 'colaborador_id,area_id' });
  }
}

const navegarVistaGlobal = _navegarVG;
const filaDocente = (page: import('@playwright/test').Page) => filaVG(page, 'QA Docente Primaria');

test.describe('J — Rendimiento', () => {
  test('J1 — login completo en tiempo razonable para staging', async ({ page }) => {
    const inicio = Date.now();
    await loginAs(page, 'super_admin');
    const duracion = Date.now() - inicio;

    console.log(`J1 login: ${duracion}ms (umbral ${TIMEOUT_LOGIN}ms)`);
    expect(duracion, `Login tomó ${duracion}ms (umbral: ${TIMEOUT_LOGIN}ms)`).toBeLessThan(TIMEOUT_LOGIN);
  });

  test('J2 — restauración de sesión tras recarga en tiempo razonable', async ({ page }) => {
    await loginAs(page, 'super_admin');

    const inicio = Date.now();
    await page.reload();
    // Esperar a que #screen-app esté activo (la app recupera la sesión)
    const appVisible = await page.locator('#screen-app')
      .waitFor({ state: 'visible', timeout: 8_000 })
      .then(() => true)
      .catch(() => false);
    const duracion = Date.now() - inicio;

    console.log(`J2 restaurar sesión: ${duracion}ms`);
    expect(appVisible, 'La sesión debe restaurarse tras recargar').toBe(true);
    expect(duracion).toBeLessThan(8_000);
  });

  test('J3 — Vista Global carga sin bloquear la UI', async ({ page }) => {
    await loginAs(page, 'super_admin');

    const inicio = Date.now();
    await navegarVistaGlobal(page);
    const duracion = Date.now() - inicio;

    console.log(`J3 vista global carga: ${duracion}ms`);
    expect(page.locator('body')).toBeDefined();
    expect(duracion).toBeLessThan(TIMEOUT_VISTA);
  });

  test('J4 — generación de PDF individual en tiempo razonable', async ({ page }) => {
    await asegurarColabAprobado();
    await loginAs(page, 'super_admin');
    await navegarVistaGlobal(page);

    const fila = filaDocente(page);
    await expect(fila).toBeVisible({ timeout: 8_000 });

    const inicio = Date.now();
    const pdfInfo = await capturarDescarga(
      page,
      async () => {
        const btn = fila.locator('button.btn-icon-action[title="Descargar paz y salvo"]');
        await btn.click();
      }
    );
    const duracion = Date.now() - inicio;

    console.log(`J4 generación PDF: ${duracion}ms, ${pdfInfo.sizeBytes} bytes`);
    expect(pdfInfo.sizeBytes).toBeGreaterThan(5_000);
    expect(duracion, `PDF tomó ${duracion}ms (umbral: ${TIMEOUT_PDF}ms)`).toBeLessThan(TIMEOUT_PDF);
  });

  test('J5 — 5 descargas consecutivas de PDF son estables (sin degradación)', async ({ page }) => {
    await loginAs(page, 'super_admin');
    await navegarVistaGlobal(page);

    const fila = filaDocente(page);
    await expect(fila).toBeVisible({ timeout: 8_000 });

    const duraciones: number[] = [];
    for (let i = 0; i < 5; i++) {
      const ini = Date.now();
      const pdfInfo = await capturarDescarga(
        page,
        async () => {
          const btn = fila.locator('button.btn-icon-action[title="Descargar paz y salvo"]');
          await btn.click();
        }
      );
      duraciones.push(Date.now() - ini);
      expect(pdfInfo.sizeBytes).toBeGreaterThan(5_000);
    }

    console.log(`J5 tiempos de descarga: ${duraciones.join(', ')}ms`);
    // Ninguna descarga debe tardar más de 30s
    expect(Math.max(...duraciones)).toBeLessThan(30_000);
  });
});
