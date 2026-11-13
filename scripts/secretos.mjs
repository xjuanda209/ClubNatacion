// Genera los secretos del backend. Nunca se suben a Git.
//
//   npm run secretos:local       → crea .dev.vars para `npm run dev` (si no existe)
//   npm run secretos:produccion  → crea secretos-produccion.txt y los sube a Cloudflare
//                                  con `wrangler secret bulk` (requiere `npx wrangler login`)
//
// MASTER_KEY cifra los datos personales. SI SE PIERDE, LOS DATOS NO SE PUEDEN RECUPERAR:
// guarda una copia en un gestor de contraseñas. No la cambies con datos guardados.
// SETUP_TOKEN solo sirve para crear la cuenta del administrador la primera vez.
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const produccion = process.argv.includes('--produccion');
const nuevos = () => ({ MASTER_KEY: randomBytes(32).toString('base64'), SETUP_TOKEN: randomBytes(32).toString('base64url') });
const comoEnv = (s) => Object.entries(s).map(([k, v]) => `${k}="${v}"`).join('\n') + '\n';

if (!produccion) {
  const destino = join(ROOT, '.dev.vars');
  if (existsSync(destino)) {
    console.log('.dev.vars ya existe: no se toca (cambiar MASTER_KEY dejaría ilegibles los datos locales).');
  } else {
    writeFileSync(destino, comoEnv(nuevos()), { mode: 0o600 });
    console.log('Listo: .dev.vars creado. El código para crear el administrador local es el SETUP_TOKEN de ese archivo.');
  }
  process.exit(0);
}

const destino = join(ROOT, 'secretos-produccion.txt');
if (existsSync(destino)) {
  console.error('secretos-produccion.txt ya existe. Si Cloudflare ya tiene esos secretos, NO generes otros:\n'
    + 'una MASTER_KEY nueva dejaría ilegibles los datos guardados. Si de verdad empiezas de cero, borra el archivo.');
  process.exit(1);
}
const secretos = nuevos();
writeFileSync(destino, comoEnv(secretos), { mode: 0o600 });
console.log('Secretos generados en secretos-produccion.txt (ignorado por Git). Subiendo a Cloudflare…');
const r = spawnSync('npx', ['wrangler', 'secret', 'bulk', destino], { cwd: ROOT, stdio: 'inherit', shell: true });
if (r.status !== 0) {
  console.error('\nNo se pudieron subir. Ejecuta `npx wrangler login` y luego:\n  npx wrangler secret bulk secretos-produccion.txt');
  process.exit(1);
}
console.log('\nListo. Ahora:\n'
  + '  1. Copia MASTER_KEY y SETUP_TOKEN a un gestor de contraseñas y borra secretos-produccion.txt.\n'
  + '  2. Abre /admin en el sitio y crea la cuenta con el SETUP_TOKEN.');
