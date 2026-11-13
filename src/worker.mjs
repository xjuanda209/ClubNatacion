/**
 * Backend de SER MÁS Natación (Cloudflare Workers + D1).
 *
 *   Público   POST /api/inscripciones        matrícula o clase gratis de bienvenida
 *             GET  /api/config               versiones de los textos legales y Turnstile
 *   Sesión    GET  /api/auth/sesion · POST /api/auth/login · /logout · /configurar · /clave
 *   Admin     /api/admin/inscripciones[/:id] (GET, POST, PUT, DELETE) · /api/admin/auditoria
 *
 * Los archivos públicos siguen en ASSETS. Bindings (Env): npm run types.
 * Secretos: MASTER_KEY, SETUP_TOKEN y, opcionales, TURNSTILE_SITEKEY/TURNSTILE_SECRET.
 */
import {
  ConfigError, HttpError, ITERACIONES, cifrar, descifrar, errorDeClave, exigirConfiguracion, hashClave,
  huella, igualSeguro, limitar, nuevaSal, olvidarLimite, sha256Hex, tokenAleatorio,
} from './seguridad.mjs';
import {
  DOCUMENTOS_REQUERIDOS, ESTADOS, validarClaseGratis, validarCorreo, validarGestion, validarMatricula,
} from './validacion.mjs';
import { LEGAL, versionesVigentes } from './legal.mjs';

const COOKIE = '__Host-sermas_sesion';
const SESION_MAXIMA = 8 * 3600000; // 8 horas y hay que volver a entrar
const SESION_INACTIVA = 60 * 60000; // 1 hora sin uso
const CUERPO_MAXIMO = 32 * 1024;
const MINUTO = 60000;
const LISTA_MAXIMA = 1000;

const CABECERAS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Referrer-Policy': 'no-referrer',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-Robots-Tag': 'noindex, nofollow',
};

function json(request, data, status = 200, extra = {}) {
  return new Response(request.method === 'HEAD' ? null : JSON.stringify(data), {
    status,
    headers: { ...CABECERAS, ...extra },
  });
}

const esLocal = (hostname) => hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
const ipDe = (request) => request.headers.get('CF-Connecting-IP') || 'local';
const ahoraIso = () => new Date().toISOString();

/* ---------- entrada ---------- */
/** Las escrituras solo se aceptan desde las páginas del propio sitio y en JSON. */
function exigirMismoOrigen(request, url) {
  const origen = request.headers.get('Origin');
  const sitio = request.headers.get('Sec-Fetch-Site');
  if (origen !== url.origin || (sitio && sitio !== 'same-origin')) {
    throw new HttpError(403, 'Solicitud no permitida desde otro sitio.');
  }
}

async function leerJson(request) {
  if (!/^application\/json\b/i.test(request.headers.get('Content-Type') || '')) {
    throw new HttpError(415, 'Se esperaba JSON.');
  }
  if (Number(request.headers.get('Content-Length') || 0) > CUERPO_MAXIMO) throw new HttpError(413, 'Solicitud demasiado grande.');
  const texto = await request.text();
  if (texto.length > CUERPO_MAXIMO) throw new HttpError(413, 'Solicitud demasiado grande.');
  let datos;
  try { datos = JSON.parse(texto); } catch { throw new HttpError(400, 'JSON no válido.'); }
  if (!datos || typeof datos !== 'object' || Array.isArray(datos)) throw new HttpError(400, 'JSON no válido.');
  return datos;
}

function leerCookie(request, nombre) {
  for (const parte of (request.headers.get('Cookie') || '').split(';')) {
    const i = parte.indexOf('=');
    if (i > 0 && parte.slice(0, i).trim() === nombre) return parte.slice(i + 1).trim();
  }
  return '';
}

const cookieSesion = (token, segundos) => `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${segundos}`;

/* ---------- auditoría ---------- */
async function auditar(env, request, accion, inscripcionId = null, detalle = null) {
  await env.DB.prepare('INSERT INTO auditoria (fecha, accion, inscripcion_id, ip_hash, detalle) VALUES (?1, ?2, ?3, ?4, ?5)')
    .bind(ahoraIso(), accion, inscripcionId, (await huella(env, 'ip', ipDe(request))).slice(0, 16), detalle).run();
}

/* ---------- sesión ---------- */
async function sesionActual(request, env) {
  const token = leerCookie(request, COOKIE);
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const hash = await sha256Hex(token);
  const fila = await env.DB.prepare(
    `SELECT s.token_hash, s.csrf, s.expira, s.ultimo_uso, a.correo
     FROM sesiones s JOIN admins a ON a.id = s.admin_id WHERE s.token_hash = ?1`,
  ).bind(hash).first();
  if (!fila) return null;
  const ahora = Date.now();
  if (fila.expira <= ahora || fila.ultimo_uso + SESION_INACTIVA <= ahora) {
    await env.DB.prepare('DELETE FROM sesiones WHERE token_hash = ?1').bind(hash).run();
    return null;
  }
  if (ahora - fila.ultimo_uso > MINUTO) {
    await env.DB.prepare('UPDATE sesiones SET ultimo_uso = ?2 WHERE token_hash = ?1').bind(hash, ahora).run();
  }
  return fila;
}

async function exigirSesion(request, env, { escritura = false } = {}) {
  const sesion = await sesionActual(request, env);
  if (!sesion) throw new HttpError(401, 'Inicia sesión para continuar.');
  if (escritura && !igualSeguro(request.headers.get('X-CSRF-Token') || '', sesion.csrf)) {
    throw new HttpError(403, 'La sesión no pudo verificarse. Recarga la página.');
  }
  return sesion;
}

async function abrirSesion(env, request) {
  const token = tokenAleatorio();
  const csrf = tokenAleatorio();
  const ahora = Date.now();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sesiones'), // un solo administrador: una sola sesión viva
    env.DB.prepare('DELETE FROM limites WHERE inicio < ?1').bind(ahora - 24 * 3600000),
    // la actividad del panel se conserva dos años
    env.DB.prepare('DELETE FROM auditoria WHERE fecha < ?1').bind(new Date(ahora - 730 * 24 * 3600000).toISOString()),
    env.DB.prepare('INSERT INTO sesiones (token_hash, admin_id, csrf, creada, ultimo_uso, expira, ip_hash) VALUES (?1, 1, ?2, ?3, ?3, ?4, ?5)')
      .bind(await sha256Hex(token), csrf, ahora, ahora + SESION_MAXIMA, (await huella(env, 'ip', ipDe(request))).slice(0, 16)),
  ]);
  return { csrf, cookie: cookieSesion(token, SESION_MAXIMA / 1000) };
}

async function frenarIntentos(env, request) {
  const claveIp = `login:${await huella(env, 'ip', ipDe(request))}`;
  const porIp = await limitar(env, claveIp, 5, 15 * MINUTO);
  const global = await limitar(env, 'login:global', 40, 15 * MINUTO);
  if (!porIp.permitido || !global.permitido) {
    const espera = Math.max(porIp.reintentar, global.reintentar);
    throw new HttpError(429, 'Demasiados intentos. Espera unos minutos y vuelve a intentar.', { 'Retry-After': String(espera) });
  }
  return claveIp;
}

/* ---------- rutas de sesión ---------- */
async function rutaSesion(request, env) {
  const sesion = await sesionActual(request, env);
  if (sesion) return json(request, { autenticado: true, correo: sesion.correo, csrf: sesion.csrf });
  const admin = await env.DB.prepare('SELECT id FROM admins WHERE id = 1').first();
  return json(request, { autenticado: false, configurar: !admin });
}

async function rutaLogin(request, env) {
  const cuerpo = await leerJson(request);
  const claveIp = await frenarIntentos(env, request);
  const correo = typeof cuerpo.correo === 'string' ? cuerpo.correo.trim().toLowerCase() : '';
  const clave = typeof cuerpo.clave === 'string' ? cuerpo.clave.slice(0, 128) : '';
  const admin = await env.DB.prepare('SELECT correo, clave_hash, clave_sal, clave_iteraciones FROM admins WHERE id = 1').first();

  // Siempre se calcula un hash, exista o no la cuenta: la respuesta tarda lo mismo.
  const calculado = await hashClave(env, clave, admin ? admin.clave_sal : 'AAAAAAAAAAAAAAAAAAAAAA==', admin ? admin.clave_iteraciones : ITERACIONES);
  const coincide = !!admin && igualSeguro(calculado, admin.clave_hash) && igualSeguro(correo, admin.correo.toLowerCase());
  if (!coincide) {
    await auditar(env, request, 'login_fallido');
    throw new HttpError(401, 'Correo o contraseña incorrectos.');
  }
  await olvidarLimite(env, claveIp);
  const { csrf, cookie } = await abrirSesion(env, request);
  await auditar(env, request, 'login');
  return json(request, { autenticado: true, correo: admin.correo, csrf }, 200, { 'Set-Cookie': cookie });
}

/** Crea la única cuenta de administrador. Solo funciona mientras no exista y con SETUP_TOKEN. */
async function rutaConfigurar(request, env) {
  const cuerpo = await leerJson(request);
  await frenarIntentos(env, request);
  const existe = await env.DB.prepare('SELECT id FROM admins WHERE id = 1').first();
  if (existe || typeof env.SETUP_TOKEN !== 'string' || env.SETUP_TOKEN.length < 32) throw new HttpError(404, 'Ruta no encontrada');
  if (!igualSeguro(typeof cuerpo.token === 'string' ? cuerpo.token.trim() : '', env.SETUP_TOKEN)) {
    await auditar(env, request, 'configurar_fallido');
    throw new HttpError(403, 'El código de configuración no es correcto.');
  }
  const [correo, errorCorreo] = validarCorreo(cuerpo.correo);
  const errorClave = errorCorreo || errorDeClave(cuerpo.clave, correo);
  if (errorClave) throw new HttpError(400, errorClave);

  const sal = nuevaSal();
  const ahora = ahoraIso();
  const creado = await env.DB.prepare(
    `INSERT INTO admins (id, correo, clave_hash, clave_sal, clave_iteraciones, creado, clave_cambiada)
     SELECT 1, ?1, ?2, ?3, ?4, ?5, ?5 WHERE NOT EXISTS (SELECT 1 FROM admins)`,
  ).bind(correo, await hashClave(env, cuerpo.clave, sal), sal, ITERACIONES, ahora).run();
  if (!creado.meta.changes) throw new HttpError(404, 'Ruta no encontrada');
  const { csrf, cookie } = await abrirSesion(env, request);
  await auditar(env, request, 'configurar');
  return json(request, { autenticado: true, correo, csrf }, 201, { 'Set-Cookie': cookie });
}

async function rutaLogout(request, env) {
  await exigirSesion(request, env, { escritura: true });
  await env.DB.prepare('DELETE FROM sesiones').run();
  await auditar(env, request, 'logout');
  return json(request, { autenticado: false }, 200, { 'Set-Cookie': cookieSesion('', 0) });
}

async function rutaCambiarClave(request, env) {
  const sesion = await exigirSesion(request, env, { escritura: true });
  const cuerpo = await leerJson(request);
  await frenarIntentos(env, request);
  const admin = await env.DB.prepare('SELECT clave_hash, clave_sal, clave_iteraciones FROM admins WHERE id = 1').first();
  const actual = await hashClave(env, typeof cuerpo.actual === 'string' ? cuerpo.actual.slice(0, 128) : '', admin.clave_sal, admin.clave_iteraciones);
  if (!igualSeguro(actual, admin.clave_hash)) throw new HttpError(403, 'La contraseña actual no es correcta.');
  const error = errorDeClave(cuerpo.nueva, sesion.correo);
  if (error) throw new HttpError(400, error);
  if (cuerpo.nueva === cuerpo.actual) throw new HttpError(400, 'La nueva contraseña debe ser distinta.');

  const sal = nuevaSal();
  await env.DB.prepare('UPDATE admins SET clave_hash = ?1, clave_sal = ?2, clave_iteraciones = ?3, clave_cambiada = ?4 WHERE id = 1')
    .bind(await hashClave(env, cuerpo.nueva, sal), sal, ITERACIONES, ahoraIso()).run();
  const { csrf, cookie } = await abrirSesion(env, request); // cierra cualquier otra sesión
  await auditar(env, request, 'cambio_clave');
  return json(request, { ok: true, csrf }, 200, { 'Set-Cookie': cookie });
}

/* ---------- Turnstile (opcional) ---------- */
async function verificarTurnstile(request, env, token) {
  if (!env.TURNSTILE_SECRET || !env.TURNSTILE_SITEKEY) return;
  if (typeof token !== 'string' || !token || token.length > 2048) throw new HttpError(400, 'Completa la verificación de seguridad.');
  const respuesta = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret: env.TURNSTILE_SECRET, response: token, remoteip: ipDe(request) }),
  });
  const resultado = await respuesta.json().catch(() => ({}));
  if (!resultado.success) throw new HttpError(400, 'No pudimos verificar que eres una persona. Intenta de nuevo.');
}

/* ---------- inscripciones ---------- */
const validar = (tipo, entrada, opciones) => (tipo === 'matricula' ? validarMatricula(entrada, opciones) : validarClaseGratis(entrada, opciones));
const documentosVacios = () => Object.fromEntries(DOCUMENTOS_REQUERIDOS.map((d) => [d, false]));
const huellaDocumento = (env, tipo, datos) => (tipo === 'matricula'
  ? huella(env, 'doc', `${datos.tipo_documento}:${datos.numero_documento}`)
  : null);

async function rutaInscripcionPublica(request, env) {
  const cuerpo = await leerJson(request);
  const tipo = cuerpo.tipo;
  if (tipo !== 'matricula' && tipo !== 'clase_gratis') throw new HttpError(400, 'Tipo de inscripción no válido.');

  // Campo trampa: las personas no lo ven; un bot que lo llena recibe un "ok" falso.
  if (cuerpo.sitio_web) return json(request, { ok: true, referencia: 'SM-000000' }, 201);

  const ipHash = await huella(env, 'ip', ipDe(request));
  const porIp = await limitar(env, `form:${ipHash}`, 6, 60 * MINUTO);
  const global = await limitar(env, 'form:global', 300, 24 * 60 * MINUTO);
  if (!porIp.permitido || !global.permitido) {
    throw new HttpError(429, 'Recibimos muchas solicitudes desde tu conexión. Intenta más tarde o escríbenos por WhatsApp.', {
      'Retry-After': String(Math.max(porIp.reintentar, global.reintentar)),
    });
  }

  const resultado = validar(tipo, cuerpo);
  if (!resultado.ok) throw new HttpError(422, 'Revisa los datos marcados.', { errores: resultado.errores });

  // La página debe haber mostrado exactamente los textos vigentes.
  const vistos = cuerpo.versiones && typeof cuerpo.versiones === 'object' ? cuerpo.versiones : {};
  const requeridos = tipo === 'matricula' ? ['politica', 'reglamento', 'instructivo'] : ['politica'];
  if (requeridos.some((doc) => vistos[doc] !== LEGAL[doc].version)) {
    throw new HttpError(409, 'Los documentos se actualizaron. Recarga la página y vuelve a leerlos.');
  }
  await verificarTurnstile(request, env, cuerpo.turnstile);

  const publicId = crypto.randomUUID();
  const ahora = ahoraIso();
  const contenido = { datos: resultado.datos, aceptaciones: resultado.aceptaciones, notas: '', documentos: documentosVacios() };
  const esMatricula = tipo === 'matricula';
  await env.DB.prepare(
    `INSERT INTO inscripciones (public_id, tipo, estado, es_menor, doc_hmac, datos_cifrados, origen,
       consentimiento_fecha, politica_version, politica_hash, reglamento_version, reglamento_hash,
       instructivo_version, instructivo_hash, consentimiento_ip_hash, consentimiento_agente, creado, actualizado)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'web', ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?7, ?7)`,
  ).bind(
    publicId, tipo, esMatricula ? 'pendiente' : 'nueva', resultado.esMenor ? 1 : 0,
    await huellaDocumento(env, tipo, resultado.datos), await cifrar(env, contenido, publicId), ahora,
    LEGAL.politica.version, LEGAL.politica.sha256,
    esMatricula ? LEGAL.reglamento.version : null, esMatricula ? LEGAL.reglamento.sha256 : null,
    esMatricula ? LEGAL.instructivo.version : null, esMatricula ? LEGAL.instructivo.sha256 : null,
    ipHash, (request.headers.get('User-Agent') || '').slice(0, 200),
  ).run();
  return json(request, { ok: true, referencia: `SM-${publicId.slice(0, 6).toUpperCase()}` }, 201);
}

const COLUMNAS = `id, public_id, tipo, estado, es_menor, doc_hmac, datos_cifrados, origen, consentimiento_fecha,
  politica_version, reglamento_version, instructivo_version, creado, actualizado`;

async function abrirFila(env, fila, repetidos) {
  const contenido = await descifrar(env, fila.datos_cifrados, fila.public_id);
  return {
    id: fila.id,
    referencia: `SM-${fila.public_id.slice(0, 6).toUpperCase()}`,
    tipo: fila.tipo,
    estado: fila.estado,
    es_menor: fila.es_menor === 1,
    origen: fila.origen,
    posible_duplicado: !!fila.doc_hmac && (repetidos.get(fila.doc_hmac) || 0) > 1,
    consentimiento: fila.consentimiento_fecha ? {
      fecha: fila.consentimiento_fecha,
      politica: fila.politica_version,
      reglamento: fila.reglamento_version,
      instructivo: fila.instructivo_version,
    } : null,
    creado: fila.creado,
    actualizado: fila.actualizado,
    datos: contenido.datos,
    aceptaciones: contenido.aceptaciones || {},
    notas: contenido.notas || '',
    documentos: { ...documentosVacios(), ...contenido.documentos },
    matricula_pagada: contenido.matricula_pagada === true,
  };
}

async function contarRepetidos(env) {
  const { results } = await env.DB.prepare(
    'SELECT doc_hmac, COUNT(*) AS n FROM inscripciones WHERE doc_hmac IS NOT NULL GROUP BY doc_hmac HAVING n > 1',
  ).all();
  return new Map(results.map((r) => [r.doc_hmac, r.n]));
}

async function rutaListar(request, env, url) {
  await exigirSesion(request, env);
  const completo = url.searchParams.get('completo') === '1';
  const { results } = await env.DB.prepare(`SELECT ${COLUMNAS} FROM inscripciones ORDER BY creado DESC, id DESC LIMIT ${LISTA_MAXIMA}`).all();
  const repetidos = await contarRepetidos(env);
  const lista = [];
  for (const fila of results) {
    const registro = await abrirFila(env, fila, repetidos);
    if (completo) { lista.push(registro); continue; }
    const d = registro.datos;
    const recibidos = Object.values(registro.documentos).filter(Boolean).length;
    lista.push({
      id: registro.id,
      referencia: registro.referencia,
      tipo: registro.tipo,
      estado: registro.estado,
      es_menor: registro.es_menor,
      origen: registro.origen,
      posible_duplicado: registro.posible_duplicado,
      creado: registro.creado,
      nombre: registro.tipo === 'matricula' ? `${d.nombres} ${d.apellidos}` : d.nombre,
      programa: d.programa,
      sede: d.sede,
      celular: registro.es_menor && d.acudiente_celular ? d.acudiente_celular : d.celular,
      documentos_recibidos: recibidos,
      // debe la matrícula: matriculado (no retirado) sin el pago marcado por el administrador
      debe_matricula: registro.tipo === 'matricula' && registro.estado !== 'retirado' && !registro.matricula_pagada,
    });
  }
  if (completo) await auditar(env, request, 'exportar', null, `${lista.length} registros`);
  return json(request, { inscripciones: lista, total: lista.length, limite: LISTA_MAXIMA });
}

async function buscarFila(env, id) {
  const fila = await env.DB.prepare(`SELECT ${COLUMNAS} FROM inscripciones WHERE id = ?1`).bind(id).first();
  if (!fila) throw new HttpError(404, 'Ese registro ya no existe.');
  return fila;
}

async function rutaVer(request, env, id) {
  await exigirSesion(request, env);
  const registro = await abrirFila(env, await buscarFila(env, id), await contarRepetidos(env));
  await auditar(env, request, 'ver', id);
  return json(request, { inscripcion: registro });
}

async function rutaCrear(request, env) {
  await exigirSesion(request, env, { escritura: true });
  const cuerpo = await leerJson(request);
  const tipo = cuerpo.tipo;
  if (tipo !== 'matricula' && tipo !== 'clase_gratis') throw new HttpError(400, 'Tipo de inscripción no válido.');
  const entrada = cuerpo.datos && typeof cuerpo.datos === 'object' ? cuerpo.datos : {};
  const resultado = validar(tipo, entrada, { admin: true });
  const errores = { ...resultado.errores };
  if (cuerpo.autorizacion_fisica !== true) errores.autorizacion_fisica = 'Confirma que tienes la autorización firmada del titular o su acudiente.';
  if (Object.keys(errores).length) throw new HttpError(422, 'Revisa los datos marcados.', { errores });

  const publicId = crypto.randomUUID();
  const ahora = ahoraIso();
  const contenido = {
    datos: resultado.datos,
    aceptaciones: { autorizacion_fisica: true },
    notas: '',
    documentos: documentosVacios(),
  };
  const creado = await env.DB.prepare(
    `INSERT INTO inscripciones (public_id, tipo, estado, es_menor, doc_hmac, datos_cifrados, origen, creado, actualizado)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'admin', ?7, ?7) RETURNING id`,
  ).bind(
    publicId, tipo, tipo === 'matricula' ? 'pendiente' : 'nueva', resultado.esMenor ? 1 : 0,
    await huellaDocumento(env, tipo, resultado.datos), await cifrar(env, contenido, publicId), ahora,
  ).first();
  await auditar(env, request, 'crear', creado.id);
  return json(request, { id: creado.id }, 201);
}

async function rutaEditar(request, env, id) {
  await exigirSesion(request, env, { escritura: true });
  const cuerpo = await leerJson(request);
  const fila = await buscarFila(env, id);
  const anterior = await descifrar(env, fila.datos_cifrados, fila.public_id);

  const entrada = cuerpo.datos && typeof cuerpo.datos === 'object' ? cuerpo.datos : {};
  const resultado = validar(fila.tipo, entrada, { admin: true });
  const gestion = validarGestion(cuerpo, fila.tipo);
  const errores = { ...resultado.errores, ...gestion.errores };
  if (Object.keys(errores).length) throw new HttpError(422, 'Revisa los datos marcados.', { errores });

  const contenido = {
    datos: resultado.datos,
    aceptaciones: anterior.aceptaciones || {}, // la prueba de autorización no se edita
    notas: gestion.gestion.notas,
    documentos: gestion.gestion.documentos,
    matricula_pagada: gestion.gestion.matricula_pagada,
  };
  await env.DB.prepare(
    'UPDATE inscripciones SET estado = ?2, es_menor = ?3, doc_hmac = ?4, datos_cifrados = ?5, actualizado = ?6 WHERE id = ?1',
  ).bind(
    id, gestion.gestion.estado, resultado.esMenor ? 1 : 0,
    await huellaDocumento(env, fila.tipo, resultado.datos), await cifrar(env, contenido, fila.public_id), ahoraIso(),
  ).run();
  await auditar(env, request, 'editar', id);
  return json(request, { ok: true });
}

async function rutaEliminar(request, env, id) {
  await exigirSesion(request, env, { escritura: true });
  const borrado = await env.DB.prepare('DELETE FROM inscripciones WHERE id = ?1').bind(id).run();
  if (!borrado.meta.changes) throw new HttpError(404, 'Ese registro ya no existe.');
  await auditar(env, request, 'eliminar', id);
  return json(request, { ok: true });
}

async function rutaAuditoria(request, env) {
  await exigirSesion(request, env);
  const { results } = await env.DB.prepare('SELECT fecha, accion, inscripcion_id, detalle FROM auditoria ORDER BY id DESC LIMIT 200').all();
  return json(request, { eventos: results });
}

/* ---------- enrutador ---------- */
/** @type {Record<string, Record<string, (request: Request, env: Env, url: URL) => Promise<Response>>>} */
const RUTAS = {
  '/api/config': {
    GET: async (request, env) => json(request, {
      versiones: versionesVigentes(),
      turnstile: env.TURNSTILE_SECRET && env.TURNSTILE_SITEKEY ? env.TURNSTILE_SITEKEY : null,
      estados: ESTADOS,
    }),
  },
  '/api/inscripciones': { POST: rutaInscripcionPublica },
  '/api/auth/sesion': { GET: rutaSesion },
  '/api/auth/login': { POST: rutaLogin },
  '/api/auth/configurar': { POST: rutaConfigurar },
  '/api/auth/logout': { POST: rutaLogout },
  '/api/auth/clave': { POST: rutaCambiarClave },
  '/api/admin/inscripciones': { GET: rutaListar, POST: rutaCrear },
  '/api/admin/auditoria': { GET: rutaAuditoria },
};
const RUTAS_POR_ID = { GET: rutaVer, PUT: rutaEditar, DELETE: rutaEliminar };

async function salud(request, env) {
  if (!['GET', 'HEAD'].includes(request.method)) return json(request, { error: 'Método no permitido' }, 405, { Allow: 'GET, HEAD' });
  try {
    // Verifica el binding y el esquema sin leer ni devolver datos personales.
    const resultado = await env.DB.prepare('SELECT id FROM inscripciones LIMIT 0').all();
    if (!resultado.success) throw new Error('La comprobación de D1 no terminó correctamente');
    return json(request, { status: 'ok', database: 'connected' });
  } catch (error) {
    console.error(JSON.stringify({ event: 'database_health_check_failed', message: error instanceof Error ? error.message : 'Error de base de datos' }));
    return json(request, { status: 'error', database: 'unavailable' }, 503);
  }
}

async function api(request, env, url) {
  const { pathname } = url;
  if (pathname === '/api/health') return salud(request, env);

  const porId = /^\/api\/admin\/inscripciones\/([1-9]\d{0,14})$/.exec(pathname);
  const metodos = porId ? RUTAS_POR_ID : RUTAS[pathname];
  if (!metodos) return json(request, { error: 'Ruta no encontrada' }, 404);
  const manejador = metodos[request.method];
  if (!manejador) return json(request, { error: 'Método no permitido' }, 405, { Allow: Object.keys(metodos).join(', ') });

  if (url.protocol !== 'https:' && !esLocal(url.hostname)) throw new HttpError(400, 'Usa una conexión segura (https).');
  if (request.method !== 'GET') exigirMismoOrigen(request, url);
  await exigirConfiguracion(env);
  return porId ? manejador(request, env, Number(porId[1])) : manejador(request, env, url);
}

export default {
  /**
   * @param {Request} request
   * @param {Env} env
   * @returns {Promise<Response>}
   */
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== '/api' && !url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);

    try {
      return await api(request, env, url);
    } catch (error) {
      if (error instanceof HttpError) {
        const { errores, ...cabeceras } = error.extra || {};
        return json(request, errores ? { error: error.message, errores } : { error: error.message }, error.status, cabeceras);
      }
      if (error instanceof ConfigError) {
        console.error(JSON.stringify({ event: 'configuracion_incompleta', message: error.message }));
        return json(request, { error: 'El servicio todavía no está configurado.' }, 503);
      }
      // Nunca se registran cuerpos ni datos personales: solo el tipo de fallo.
      console.error(JSON.stringify({ event: 'error_interno', ruta: url.pathname, message: error instanceof Error ? error.message.slice(0, 200) : 'desconocido' }));
      return json(request, { error: 'Ocurrió un error. Intenta de nuevo en un momento.' }, 500);
    }
  },
};
