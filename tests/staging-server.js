/**
 * Servidor de staging para tests QA.
 * Sirve los archivos del proyecto en localhost:3000 pero reemplaza
 * las URLs de producción por las del proyecto staging en app.js.
 *
 * Uso: node tests/staging-server.js
 */
import http    from 'http';
import fs      from 'fs';
import path    from 'path';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

dotenv.config({ path: path.join(__dirname, '.env.test') });

const STAGING_URL     = process.env.STAGING_URL;
const STAGING_ANON    = process.env.STAGING_ANON_KEY;
const PORT            = parseInt(process.env.PORT ?? '3000');

if (!STAGING_URL || !STAGING_ANON) {
  console.error('❌  Falta STAGING_URL o STAGING_ANON_KEY en tests/.env.test');
  process.exit(1);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
};

const server = http.createServer((req, res) => {
  let urlPath = req.url.split('?')[0];
  if (urlPath === '/' || urlPath === '') urlPath = '/index.html';

  const filePath = path.join(ROOT, urlPath);
  const ext = path.extname(filePath);

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    let content = data;

    // Inyectar URLs de staging en app.js
    if (urlPath === '/app.js') {
      let src = data.toString('utf8');
      // Reemplazar URL del backend (Edge Function)
      src = src.replace(
        /const BACKEND_URL\s*=\s*["'][^"']+["']/,
        `const BACKEND_URL = "${STAGING_URL}/functions/v1/ps-api"`
      );
      // Reemplazar SUPABASE_URL
      src = src.replace(
        /const SUPABASE_URL\s*=\s*["'][^"']+["']/,
        `const SUPABASE_URL = "${STAGING_URL}"`
      );
      // Reemplazar SUPABASE_ANON_KEY
      src = src.replace(
        /const SUPABASE_ANON_KEY\s*=\s*["'][^"']+["']/,
        `const SUPABASE_ANON_KEY = "${STAGING_ANON}"`
      );
      content = Buffer.from(src, 'utf8');
      console.log(`  [staging] app.js → ${STAGING_URL}`);
    }

    res.writeHead(200, {
      'Content-Type': MIME[ext] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(content);
  });
});

server.listen(PORT, () => {
  console.log(`\n🚀  Servidor staging corriendo en http://localhost:${PORT}`);
  console.log(`    → Supabase staging: ${STAGING_URL}`);
  console.log(`    Ctrl+C para detener\n`);
});
