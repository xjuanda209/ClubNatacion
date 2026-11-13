/**
 * Criptografía y utilidades de seguridad del backend.
 * Todo usa WebCrypto (disponible en Workers y en Node para las pruebas).
 *
 * MASTER_KEY (secreto de Cloudflare, 32 bytes en base64) nunca se usa directo:
 * de ella se derivan dos claves con HKDF, una para cifrar datos (AES-256-GCM)
 * y otra para HMAC (pimienta de la contraseña, huella de IP y de documentos).
 */

const enc = new TextEncoder();
const dec = new TextDecoder();

export class ConfigError extends Error {}
export class HttpError extends Error {
  /** @param {number} status @param {string} message @param {Record<string, unknown>} [extra] */
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

/* ---------- codificación ---------- */
export function aBase64(bytes) {
  let s = '';
  const u = new Uint8Array(bytes);
  for (let i = 0; i < u.length; i += 1) s += String.fromCharCode(u[i]);
  return btoa(s);
}
export function deBase64(texto) {
  const s = atob(texto);
  const u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i += 1) u[i] = s.charCodeAt(i);
  return u;
}
const aBase64Url = (bytes) => aBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const aHex = (bytes) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');

export const aleatorio = (n) => crypto.getRandomValues(new Uint8Array(n));
export const tokenAleatorio = () => aBase64Url(aleatorio(32)); // 43 caracteres, 256 bits

export async function sha256Hex(texto) {
  return aHex(await crypto.subtle.digest('SHA-256', enc.encode(texto)));
}

/** Comparación en tiempo constante de dos cadenas. */
export function igualSeguro(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const x = enc.encode(a);
  const y = enc.encode(b);
  let dif = x.length ^ y.length;
  for (let i = 0; i < x.length; i += 1) dif |= x[i] ^ y[i % (y.length || 1)];
  return dif === 0;
}

/* ---------- claves derivadas ---------- */
let cache = { maestra: '', claves: null };

async function claves(env) {
  const maestra = env && env.MASTER_KEY;
  if (typeof maestra !== 'string' || !maestra) throw new ConfigError('Falta el secreto MASTER_KEY');
  if (cache.maestra === maestra && cache.claves) return cache.claves;
  let bruto;
  try { bruto = deBase64(maestra.trim()); } catch { throw new ConfigError('MASTER_KEY no es base64'); }
  if (bruto.length < 32) throw new ConfigError('MASTER_KEY debe tener al menos 32 bytes');
  const base = await crypto.subtle.importKey('raw', bruto, 'HKDF', false, ['deriveKey']);
  const derivar = (info, algoritmo, usos) => crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: enc.encode(info) },
    base, algoritmo, false, usos,
  );
  const nuevas = {
    datos: await derivar('sermas/datos/v1', { name: 'AES-GCM', length: 256 }, ['encrypt', 'decrypt']),
    hmac: await derivar('sermas/hmac/v1', { name: 'HMAC', hash: 'SHA-256', length: 256 }, ['sign']),
  };
  cache = { maestra, claves: nuevas };
  return nuevas;
}

/** Comprueba que el secreto exista y sea válido (lanza ConfigError si no). */
export const exigirConfiguracion = (env) => claves(env).then(() => undefined);

/* ---------- HMAC: huellas que no permiten recuperar el dato ---------- */
async function hmacBytes(env, texto) {
  const { hmac } = await claves(env);
  return new Uint8Array(await crypto.subtle.sign('HMAC', hmac, enc.encode(texto)));
}
/** Huella con propósito ("ip", "doc"...) para que no se puedan cruzar entre sí. */
export async function huella(env, proposito, valor) {
  return aHex(await hmacBytes(env, `${proposito}:${valor}`));
}

/* ---------- cifrado de los datos personales ---------- */
/** @param {unknown} objeto @param {string} aad dato asociado (public_id del registro) */
export async function cifrar(env, objeto, aad) {
  const { datos } = await claves(env);
  const iv = aleatorio(12);
  const cifrado = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: enc.encode(aad) }, datos, enc.encode(JSON.stringify(objeto)),
  ));
  const todo = new Uint8Array(iv.length + cifrado.length);
  todo.set(iv);
  todo.set(cifrado, iv.length);
  return `v1.${aBase64(todo)}`;
}

export async function descifrar(env, texto, aad) {
  const { datos } = await claves(env);
  if (typeof texto !== 'string' || !texto.startsWith('v1.')) throw new Error('Formato de cifrado desconocido');
  const todo = deBase64(texto.slice(3));
  const claro = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: todo.slice(0, 12), additionalData: enc.encode(aad) }, datos, todo.slice(12),
  );
  return JSON.parse(dec.decode(claro));
}

/* ---------- contraseña del administrador ----------
   PBKDF2-SHA256 sobre HMAC(pimienta, contraseña).
   El plan gratuito de Workers da 10 ms de CPU por solicitud (y admite como
   máximo 100 000 iteraciones): 100 000 tardan unos 20 ms y podrían cortar el
   inicio de sesión, así que se usan 30 000 (~6 ms). La protección fuerte es la
   pimienta: sale de MASTER_KEY, no está en la base de datos y sin ella el hash
   no se puede atacar por fuerza bruta aunque alguien copie la base. Cada hash
   guarda sus iteraciones, así que se puede subir el número sin romper nada. */
export const ITERACIONES = 30000;

export async function hashClave(env, clave, salB64, iteraciones = ITERACIONES) {
  const previa = await hmacBytes(env, `clave:${clave}`);
  const llave = await crypto.subtle.importKey('raw', previa, 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: deBase64(salB64), iterations: iteraciones }, llave, 256,
  );
  return aBase64(bits);
}

export const nuevaSal = () => aBase64(aleatorio(16));

const CLAVES_COMUNES = /^(?:(.)\1+|123456789012|contraseña.*|password.*|qwertyuiop.*|sermasnatacion.*|natacion.*)$/i;

/** Devuelve un mensaje de error o '' si la contraseña sirve. */
export function errorDeClave(clave, correo = '') {
  if (typeof clave !== 'string' || clave.length < 12) return 'La contraseña debe tener al menos 12 caracteres.';
  if (clave.length > 128) return 'La contraseña no puede pasar de 128 caracteres.';
  if (CLAVES_COMUNES.test(clave)) return 'Esa contraseña es demasiado fácil de adivinar.';
  const usuario = correo.split('@')[0].toLowerCase();
  if (usuario.length >= 4 && clave.toLowerCase().includes(usuario)) return 'La contraseña no debe contener tu correo.';
  if (new Set(clave).size < 6) return 'Usa una contraseña más variada.';
  return '';
}

/* ---------- límite de intentos (ventana fija en D1) ---------- */
/**
 * Suma un intento y dice si se pasó del máximo.
 * @returns {Promise<{permitido: boolean, reintentar: number}>} reintentar en segundos
 */
export async function limitar(env, clave, maximo, ventanaMs, ahora = Date.now()) {
  const fila = await env.DB.prepare(
    `INSERT INTO limites (clave, inicio, cuenta) VALUES (?1, ?2, 1)
     ON CONFLICT (clave) DO UPDATE SET
       cuenta = CASE WHEN limites.inicio + ?3 <= ?2 THEN 1 ELSE limites.cuenta + 1 END,
       inicio = CASE WHEN limites.inicio + ?3 <= ?2 THEN ?2 ELSE limites.inicio END
     RETURNING inicio, cuenta`,
  ).bind(clave, ahora, ventanaMs).first();
  const permitido = fila.cuenta <= maximo;
  return { permitido, reintentar: permitido ? 0 : Math.max(1, Math.ceil((fila.inicio + ventanaMs - ahora) / 1000)) };
}

export const olvidarLimite = (env, clave) => env.DB.prepare('DELETE FROM limites WHERE clave = ?1').bind(clave).run();
