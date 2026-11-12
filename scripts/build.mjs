// Arma la carpeta dist/ con SOLO lo que se publica:
// las páginas de public/, su CSS/JS y las imágenes que de verdad se usan.
// Nunca entran: "Piscinas 2/" (fichas del cliente), capturas, el logo suelto, scripts/.
//
//   node scripts/build.mjs                       → vista previa (Google no la indexa)
//   node scripts/build.mjs --produccion          → sitio final (indexable)
//   node scripts/build.mjs --url=https://dominio → URL pública, para la imagen al compartir
import { readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync, existsSync, statSync, lstatSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(ROOT, 'public');
const DIST = join(ROOT, 'dist');
const args = process.argv.slice(2);
const PROD = args.includes('--produccion');
const SITE_URL = (args.find(a => a.startsWith('--url='))?.slice(6)
  || process.env.SITE_URL
  || 'https://sermasclubnatacion.xjuancho16.workers.dev').replace(/\/+$/, '');
const siteUrl = new URL(SITE_URL);
if (!['http:', 'https:'].includes(siteUrl.protocol) || siteUrl.username || siteUrl.password) {
  throw new Error('SITE_URL debe ser una URL pública HTTP(S) sin credenciales.');
}

// se vacía dist/ en vez de borrarla: en Windows falla si algo la tiene abierta
// La ruta es fija y se comprueba que no sea un enlace antes de vaciarla.
if (existsSync(DIST) && (!statSync(DIST).isDirectory() || lstatSync(DIST).isSymbolicLink())) {
  throw new Error('dist/ debe ser una carpeta local del proyecto, no un enlace.');
}
mkdirSync(DIST, { recursive: true });
for (const f of readdirSync(DIST)) rmSync(join(DIST, f), { recursive: true, force: true });

const rootFiles = readdirSync(SOURCE).filter(f => statSync(join(SOURCE, f)).isFile());
const pages = rootFiles.filter(f => f.endsWith('.html'));
const code = rootFiles.filter(f => /\.(css|js)$/.test(f));

// 1. páginas, estilos y scripts
const refs = new Set();
const missing = [];
for (const f of [...pages, ...code]) {
  let text = readFileSync(join(SOURCE, f), 'utf8');
  for (const m of text.matchAll(/assets\/[^"'()\s?#]+/g)) refs.add(m[0]);
  if (f.endsWith('.html') && SITE_URL) {
    // WhatsApp/Facebook necesitan la imagen de vista previa con URL absoluta
    text = text.replace(/(property="og:image" content=")(assets\/)/g, `$1${SITE_URL}/$2`);
  }
  writeFileSync(join(DIST, f), text);
}

// 2. solo las imágenes que se usan
let bytes = 0;
for (const ref of [...refs].sort()) {
  const src = join(SOURCE, ref);
  if (!existsSync(src)) { missing.push(ref); continue; }
  const dst = join(DIST, ref);
  mkdirSync(dirname(dst), { recursive: true });
  copyFileSync(src, dst);
  bytes += statSync(src).size;
}

// 3. cabeceras de Workers Static Assets
let headers = readFileSync(join(SOURCE, '_headers'), 'utf8');
if (PROD) headers = headers.replace(/^\s*X-Robots-Tag:.*\n/m, '');
writeFileSync(join(DIST, '_headers'), headers);

console.log(`dist/ listo · ${pages.length} páginas · ${code.length} css/js · ${refs.size - missing.length} imágenes (${(bytes / 1048576).toFixed(1)} MB)`);
console.log(PROD ? 'Modo producción: Google puede indexar el sitio.' : 'Modo vista previa: Google NO indexa el sitio (usa --produccion al lanzar).');
if (!SITE_URL) console.log('Aviso: sin --url, la imagen al compartir por WhatsApp no se verá.');
if (missing.length) {
  console.error('\nFALTAN imágenes referenciadas:\n  ' + missing.join('\n  '));
  process.exit(1);
}
