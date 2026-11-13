// Base D1 de mentira para las pruebas: SQLite en memoria con las migraciones reales.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import worker from '../src/worker.mjs';

const MIGRACIONES = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

class Sentencia {
  constructor(db, sql, args = []) { this.db = db; this.sql = sql; this.args = args; }
  bind(...args) { return new Sentencia(this.db, this.sql, args); }
  ejecutar() {
    const st = this.db.prepare(this.sql);
    if (/^\s*(SELECT|WITH)\b/i.test(this.sql) || /\bRETURNING\b/i.test(this.sql)) {
      return { success: true, results: st.all(...this.args), meta: { changes: 0 } };
    }
    const r = st.run(...this.args);
    return { success: true, results: [], meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
  }
  async all() { return this.ejecutar(); }
  async run() { return this.ejecutar(); }
  async first() { return this.ejecutar().results[0] ?? null; }
}

export function crearD1() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  for (const archivo of readdirSync(MIGRACIONES).sort()) db.exec(readFileSync(join(MIGRACIONES, archivo), 'utf8'));
  return {
    cruda: db,
    prepare: (sql) => new Sentencia(db, sql),
    batch: async (sentencias) => sentencias.map((s) => s.ejecutar()),
  };
}

export const ORIGEN = 'https://club.test';
export const SETUP_TOKEN = 'codigo-de-configuracion-de-pruebas-0123456789';

export function crearEnv(extra = {}) {
  return {
    DB: crearD1(),
    MASTER_KEY: Buffer.alloc(32, 7).toString('base64'),
    SETUP_TOKEN,
    ASSETS: { fetch: async () => new Response('pagina') },
    ...extra,
  };
}

/** Cliente que recuerda la cookie y el token CSRF, como un navegador. */
export function crearCliente(env, { ip = '203.0.113.10' } = {}) {
  const estado = { cookie: '', csrf: '' };
  async function pedir(ruta, { method = 'GET', body, headers = {}, crudo } = {}) {
    const h = { 'CF-Connecting-IP': ip, 'User-Agent': 'pruebas', ...headers };
    if (method !== 'GET' && h.Origin === undefined) h.Origin = ORIGEN;
    if (h.Origin === null) delete h.Origin;
    if (body !== undefined && h['Content-Type'] === undefined) h['Content-Type'] = 'application/json';
    if (estado.cookie && h.Cookie === undefined) h.Cookie = estado.cookie;
    if (estado.csrf && method !== 'GET' && h['X-CSRF-Token'] === undefined) h['X-CSRF-Token'] = estado.csrf;
    const respuesta = await worker.fetch(new Request(`${ORIGEN}${ruta}`, {
      method, headers: h, body: crudo ?? (body === undefined ? undefined : JSON.stringify(body)),
    }), env);
    const galleta = respuesta.headers.get('Set-Cookie');
    if (galleta) estado.cookie = galleta.split(';')[0];
    const datos = await respuesta.json().catch(() => null);
    if (datos && datos.csrf) estado.csrf = datos.csrf;
    return { status: respuesta.status, datos, headers: respuesta.headers };
  }
  return { pedir, estado };
}

export const ADMIN = { correo: 'admin@club.test', clave: 'Brazada-larga-2026!' };

export async function conAdmin(env) {
  const cliente = crearCliente(env);
  const r = await cliente.pedir('/api/auth/configurar', { method: 'POST', body: { token: SETUP_TOKEN, ...ADMIN } });
  if (r.status !== 201) throw new Error(`No se pudo crear el admin: ${r.status} ${JSON.stringify(r.datos)}`);
  return cliente;
}

const VERSIONES = { politica: '2026-11', reglamento: '2026', instructivo: '2026' };
const hace = (anos) => `${new Date().getUTCFullYear() - anos}-03-15`;

export const matriculaMenor = (cambios = {}) => ({
  tipo: 'matricula',
  nombres: 'Sofía', apellidos: 'Restrepo Gómez', tipo_documento: 'TI', numero_documento: '1.033.456.789',
  fecha_nacimiento: hace(11), celular: '300 123 4567', correo: 'Familia@Correo.com',
  direccion: 'Calle 10 # 20-30', ciudad: 'Medellín', programa: 'cat1', sede: 'medellin',
  eps: 'Sura', regimen: 'contributivo', condiciones_salud: 'Asma leve.\nUsa inhalador.',
  emergencia_nombre: 'Laura Gómez', emergencia_telefono: '3009876543',
  acudiente_nombre: 'Laura Gómez', acudiente_tipo_documento: 'CC', acudiente_numero_documento: '43123456',
  acudiente_parentesco: 'Madre', acudiente_celular: '3009876543', acudiente_correo: 'laura@correo.com',
  acepta_reglamento: true, acepta_instructivo: true, autoriza_datos: true, autoriza_datos_sensibles: true,
  declara_representante: true, menor_escuchado: true, autoriza_imagen: false, firma_nombre: 'Laura Gómez',
  versiones: VERSIONES,
  ...cambios,
});

export const matriculaAdulto = (cambios = {}) => ({
  tipo: 'matricula',
  nombres: 'Carlos', apellidos: 'Pérez', tipo_documento: 'CC', numero_documento: '71234567',
  fecha_nacimiento: hace(34), celular: '3101112233', correo: 'carlos@correo.com',
  direccion: 'Carrera 43A # 1-50', ciudad: 'Envigado', programa: 'master', sede: 'envigado',
  eps: 'Nueva EPS', emergencia_nombre: 'Ana Pérez', emergencia_telefono: '3112223344',
  acepta_reglamento: true, acepta_instructivo: true, autoriza_datos: true, autoriza_datos_sensibles: true,
  autoriza_imagen: true, firma_nombre: 'Carlos Pérez',
  versiones: VERSIONES,
  ...cambios,
});

export const claseGratis = (cambios = {}) => ({
  tipo: 'clase_gratis', nombre: 'Mateo Ríos', edad: 9, acudiente_nombre: 'Paula Ríos', celular: '3205556677',
  programa: 'cat1', sede: 'envigado', autoriza_datos: true, declara_representante: true,
  versiones: VERSIONES,
  ...cambios,
});
