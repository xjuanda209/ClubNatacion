// Calcula la huella (SHA-256) de los textos que aceptan las familias.
//   npm run legal   → muestra las huellas para copiarlas en src/legal.mjs
// La huella se calcula sobre el texto visible (sin etiquetas ni espacios repetidos),
// así que cambiar el diseño no la altera, pero cambiar una palabra sí.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
export const ORIGEN = { politica: 'privacidad.html', reglamento: 'documentos.html', instructivo: 'documentos.html' };

export function textoLegal(nombre) {
  const html = readFileSync(join(PUBLIC, ORIGEN[nombre]), 'utf8');
  const m = new RegExp(`<article[^>]*data-documento="${nombre}"[^>]*data-version="([^"]+)"[^>]*>([\\s\\S]*?)</article>`).exec(html);
  if (!m) throw new Error(`No encuentro <article data-documento="${nombre}" data-version="..."> en ${ORIGEN[nombre]}`);
  return { version: m[1], texto: m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() };
}

export function huellaLegal(nombre) {
  const { version, texto } = textoLegal(nombre);
  return { version, sha256: createHash('sha256').update(texto, 'utf8').digest('hex') };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log('Copia estos valores en src/legal.mjs:\n');
  for (const nombre of Object.keys(ORIGEN)) {
    const { version, sha256 } = huellaLegal(nombre);
    console.log(`  ${nombre}: { version: '${version}', sha256: '${sha256}' },`);
  }
}
