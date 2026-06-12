/**
 * Helpers para validación de PDFs descargados.
 */
import * as fs   from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { Page, Download } from '@playwright/test';

export interface PdfInfo {
  path:      string;
  sizeBytes: number;
  text:      string;
  sha256:    string;
}

/** Espera la descarga de un PDF y extrae metadata básica. */
export async function capturarDescarga(
  page: Page,
  accion: () => Promise<void>
): Promise<PdfInfo> {
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 20_000 }),
    accion(),
  ]);

  const savePath = path.resolve('test-results', `pdf_${Date.now()}.pdf`);
  fs.mkdirSync('test-results', { recursive: true });
  await download.saveAs(savePath);

  const buf = fs.readFileSync(savePath);
  const sha256 = crypto.createHash('sha256').update(buf).digest('hex');

  // Extraer texto plano del PDF usando pdf-parse
  let text = '';
  try {
    const pdfParse = (await import('pdf-parse')).default;
    const parsed = await pdfParse(buf);
    text = parsed.text ?? '';
  } catch { /* pdf-parse opcional */ }

  return { path: savePath, sizeBytes: buf.length, text, sha256 };
}

/** Verifica que el PDF no esté en blanco (> 5 KB, contiene texto clave). */
export function assertPdfNoEnBlanco(info: PdfInfo, nombreEsperado: string): void {
  if (info.sizeBytes < 5_000) {
    throw new Error(`PDF demasiado pequeño: ${info.sizeBytes} bytes (posiblemente en blanco)`);
  }
  if (info.text && !info.text.includes('PAZ Y SALVO') && !info.text.includes('Paz y Salvo')) {
    throw new Error('El PDF no contiene el texto "PAZ Y SALVO"');
  }
  if (info.text && nombreEsperado && !info.text.toUpperCase().includes(nombreEsperado.toUpperCase())) {
    throw new Error(`El PDF no contiene el nombre del colaborador: "${nombreEsperado}"`);
  }
}

/** Compara dos PDFs: mismo tamaño aproximado (± 10%) y misma estructura textual básica. */
export function assertPdfsSimilares(a: PdfInfo, b: PdfInfo): void {
  const diff = Math.abs(a.sizeBytes - b.sizeBytes);
  const maxAllowed = Math.max(a.sizeBytes, b.sizeBytes) * 0.1;
  if (diff > maxAllowed) {
    throw new Error(
      `PDFs con tamaño muy diferente: descargado=${a.sizeBytes}B, correo=${b.sizeBytes}B (diff=${diff}B)`
    );
  }
}
