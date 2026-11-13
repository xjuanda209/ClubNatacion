import assert from 'node:assert/strict';
import { test } from 'node:test';
import worker from '../src/worker.mjs';
import { LEGAL } from '../src/legal.mjs';
import { huellaLegal } from '../scripts/legal.mjs';
import {
  ADMIN, ORIGEN, SETUP_TOKEN, claseGratis, conAdmin, crearCliente, crearEnv, matriculaAdulto, matriculaMenor,
} from './ayuda.mjs';

const request = (path, method = 'GET') => new Request(`${ORIGEN}${path}`, { method });
const todoLoGuardado = (env) => JSON.stringify(env.DB.cruda.prepare('SELECT * FROM inscripciones').all());

/* ---------- base ---------- */
test('health comprueba D1 sin devolver datos ni usar caché', async () => {
  const response = await worker.fetch(request('/api/health'), crearEnv());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok', database: 'connected' });
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal((await worker.fetch(request('/api/health', 'HEAD'), crearEnv())).status, 200);
  assert.equal((await worker.fetch(request('/api/health', 'POST'), {})).status, 405);
});

test('una base no disponible devuelve 503 sin exponer detalles SQL', async (t) => {
  t.mock.method(console, 'error', () => {});
  const rota = { DB: { prepare: () => { throw new Error('no such table: inscripciones'); } } };
  const response = await worker.fetch(request('/api/health'), rota);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { status: 'error', database: 'unavailable' });
});

test('las páginas pasan a ASSETS y las rutas desconocidas de /api dan 404', async () => {
  const esperado = new Response('<html>Club</html>');
  assert.equal(await worker.fetch(request('/club.html'), { ASSETS: { fetch: async () => esperado } }), esperado);
  for (const ruta of ['/api', '/api/users', '/api/admin', '/api/admin/inscripciones/0', '/api/admin/inscripciones/1;DROP', '/api/admin/inscripciones/../x']) {
    assert.equal((await worker.fetch(request(ruta), {})).status, 404, ruta);
  }
});

test('todas las respuestas de la API llevan cabeceras de seguridad', async () => {
  const r = await crearCliente(crearEnv()).pedir('/api/config');
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
  assert.match(r.headers.get('content-security-policy'), /default-src 'none'/);
  assert.match(r.headers.get('strict-transport-security'), /max-age=31536000/);
  assert.equal(r.headers.get('access-control-allow-origin'), null, 'sin CORS: solo el propio sitio');
  assert.deepEqual(r.datos.versiones, { politica: '2026-11', reglamento: '2026', instructivo: '2026' });
});

test('sin MASTER_KEY el servicio se niega a funcionar (no guarda nada sin cifrar)', async (t) => {
  t.mock.method(console, 'error', () => {});
  const env = crearEnv({ MASTER_KEY: undefined });
  const r = await crearCliente(env).pedir('/api/inscripciones', { method: 'POST', body: claseGratis() });
  assert.equal(r.status, 503);
  assert.equal(env.DB.cruda.prepare('SELECT COUNT(*) AS n FROM inscripciones').get().n, 0);
  const corta = crearEnv({ MASTER_KEY: 'YWJj' });
  assert.equal((await crearCliente(corta).pedir('/api/auth/sesion')).status, 503);
});

test('las huellas de los textos legales coinciden con lo publicado', () => {
  for (const nombre of Object.keys(LEGAL)) {
    assert.deepEqual(huellaLegal(nombre), LEGAL[nombre], `${nombre}: el texto cambió. Sube la versión y ejecuta "npm run legal".`);
  }
});

/* ---------- formularios públicos ---------- */
test('matrícula de un menor: se guarda cifrada y con la prueba de autorización', async () => {
  const env = crearEnv();
  const r = await crearCliente(env).pedir('/api/inscripciones', { method: 'POST', body: matriculaMenor() });
  assert.equal(r.status, 201);
  assert.match(r.datos.referencia, /^SM-[0-9A-F]{6}$/);

  const fila = env.DB.cruda.prepare('SELECT * FROM inscripciones').get();
  assert.equal(fila.tipo, 'matricula');
  assert.equal(fila.estado, 'pendiente');
  assert.equal(fila.es_menor, 1);
  assert.equal(fila.origen, 'web');
  assert.equal(fila.reglamento_version, '2026');
  assert.equal(fila.reglamento_hash, LEGAL.reglamento.sha256);
  assert.equal(fila.instructivo_hash, LEGAL.instructivo.sha256);
  assert.equal(fila.politica_hash, LEGAL.politica.sha256);
  assert.ok(fila.consentimiento_fecha);
  assert.match(fila.datos_cifrados, /^v1\./);

  const guardado = todoLoGuardado(env);
  for (const secreto of ['Sofía', 'Restrepo', '1033456789', '43123456', 'Asma', 'Sura', 'Laura', '3009876543', 'correo.com', 'Calle 10', '203.0.113.10']) {
    assert.ok(!guardado.includes(secreto), `"${secreto}" quedó legible en la base de datos`);
  }
});

test('matrícula: exige reglamento, instructivo, autorizaciones y firma', async () => {
  const env = crearEnv();
  const cliente = crearCliente(env);
  const r = await cliente.pedir('/api/inscripciones', {
    method: 'POST',
    body: matriculaAdulto({ acepta_reglamento: false, acepta_instructivo: 'true', autoriza_datos: undefined, autoriza_datos_sensibles: 0, firma_nombre: '' }),
  });
  assert.equal(r.status, 422);
  assert.deepEqual(Object.keys(r.datos.errores).sort(), ['acepta_instructivo', 'acepta_reglamento', 'autoriza_datos', 'autoriza_datos_sensibles', 'firma_nombre']);
  assert.equal(env.DB.cruda.prepare('SELECT COUNT(*) AS n FROM inscripciones').get().n, 0);
});

test('menor de edad: exige acudiente, representante legal y que el menor fue escuchado', async () => {
  const cliente = crearCliente(crearEnv());
  const r = await cliente.pedir('/api/inscripciones', {
    method: 'POST',
    body: matriculaMenor({ acudiente_nombre: '', acudiente_numero_documento: undefined, declara_representante: false, menor_escuchado: false, tipo_documento: 'CC' }),
  });
  assert.equal(r.status, 422);
  for (const campo of ['acudiente_nombre', 'acudiente_numero_documento', 'declara_representante', 'menor_escuchado', 'tipo_documento']) {
    assert.ok(r.datos.errores[campo], campo);
  }
});

test('un adulto no necesita acudiente y los campos desconocidos se descartan', async () => {
  const env = crearEnv();
  const admin = await conAdmin(env);
  const r = await crearCliente(env, { ip: '198.51.100.7' }).pedir('/api/inscripciones', {
    method: 'POST', body: matriculaAdulto({ estado: 'activo', es_admin: true, notas: 'hack', acudiente_nombre: 'No Aplica', id: 999 }),
  });
  assert.equal(r.status, 201);
  const { datos } = await admin.pedir('/api/admin/inscripciones/1');
  assert.equal(datos.inscripcion.estado, 'pendiente', 'el público no puede fijar el estado');
  assert.equal(datos.inscripcion.notas, '');
  assert.equal(datos.inscripcion.es_menor, false);
  assert.equal(datos.inscripcion.datos.acudiente_nombre, undefined);
  assert.equal(datos.inscripcion.datos.es_admin, undefined);
  assert.equal(datos.inscripcion.aceptaciones.autoriza_imagen, true);
  assert.equal(datos.inscripcion.aceptaciones.firma_documento, '71234567');
});

test('rechaza datos mal formados o maliciosos', async () => {
  const cliente = crearCliente(crearEnv());
  const casos = {
    nombres: ['<script>alert(1)</script>', 'A', '=cmd|calc', 'x'.repeat(81), { $ne: '' }, ['a']],
    numero_documento: ["1' OR '1'='1", '12', '../../etc'],
    correo: ['sin-arroba', 'a@b', 'a@b.c<script>', 'a b@c.co'],
    celular: ['123', 'abc1234567', '+57 300 123 45678901234'],
    fecha_nacimiento: ['2015-02-30', '15/03/2015', '1890-01-01', `${new Date().getUTCFullYear() + 1}-01-01`],
    programa: ['cat9', '', null],
    sede: ['bogota'],
    direccion: ['<img src=x onerror=alert(1)>'],
    condiciones_salud: ['x'.repeat(601), '<b>negrita</b>'],
  };
  for (const [campo, valores] of Object.entries(casos)) {
    for (const valor of valores) {
      const r = await cliente.pedir('/api/inscripciones', { method: 'POST', body: matriculaMenor({ [campo]: valor }), headers: { 'CF-Connecting-IP': `10.0.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}` } });
      assert.equal(r.status, 422, `${campo}=${JSON.stringify(valor)}`);
      assert.ok(r.datos.errores[campo], `${campo}=${JSON.stringify(valor)}`);
    }
  }
});

test('clase gratis: pide lo mínimo y no guarda documento ni salud', async () => {
  const env = crearEnv();
  const admin = await conAdmin(env);
  const publico = crearCliente(env, { ip: '198.51.100.8' });
  assert.equal((await publico.pedir('/api/inscripciones', { method: 'POST', body: claseGratis() })).status, 201);
  const sinAcudiente = await publico.pedir('/api/inscripciones', { method: 'POST', body: claseGratis({ acudiente_nombre: '', declara_representante: false }) });
  assert.deepEqual(Object.keys(sinAcudiente.datos.errores).sort(), ['acudiente_nombre', 'declara_representante']);
  assert.equal((await publico.pedir('/api/inscripciones', { method: 'POST', body: claseGratis({ edad: 30, acudiente_nombre: undefined, declara_representante: false }) })).status, 201);
  assert.equal((await publico.pedir('/api/inscripciones', { method: 'POST', body: claseGratis({ edad: '9; DROP TABLE' }) })).status, 422);
  assert.equal((await publico.pedir('/api/inscripciones', { method: 'POST', body: claseGratis({ autoriza_datos: false }) })).status, 422);

  const fila = env.DB.cruda.prepare("SELECT * FROM inscripciones WHERE tipo = 'clase_gratis' ORDER BY id LIMIT 1").get();
  assert.equal(fila.estado, 'nueva');
  assert.equal(fila.doc_hmac, null);
  assert.equal(fila.reglamento_version, null);
  const { datos } = await admin.pedir('/api/admin/inscripciones');
  assert.equal(datos.inscripciones.length, 2);
});

test('si los textos legales cambiaron, pide recargar antes de aceptar', async () => {
  const cliente = crearCliente(crearEnv());
  const r = await cliente.pedir('/api/inscripciones', { method: 'POST', body: matriculaAdulto({ versiones: { politica: '2026-11', reglamento: '2025', instructivo: '2026' } }) });
  assert.equal(r.status, 409);
  assert.equal((await cliente.pedir('/api/inscripciones', { method: 'POST', body: claseGratis({ versiones: undefined }) })).status, 409);
});

test('el campo trampa engaña a los robots sin guardar nada', async () => {
  const env = crearEnv();
  const r = await crearCliente(env).pedir('/api/inscripciones', { method: 'POST', body: claseGratis({ sitio_web: 'http://spam.example' }) });
  assert.equal(r.status, 201);
  assert.equal(env.DB.cruda.prepare('SELECT COUNT(*) AS n FROM inscripciones').get().n, 0);
});

test('límite de envíos por conexión', async () => {
  const env = crearEnv();
  const cliente = crearCliente(env, { ip: '192.0.2.44' });
  for (let i = 0; i < 6; i += 1) assert.equal((await cliente.pedir('/api/inscripciones', { method: 'POST', body: claseGratis() })).status, 201);
  const r = await cliente.pedir('/api/inscripciones', { method: 'POST', body: claseGratis() });
  assert.equal(r.status, 429);
  assert.ok(Number(r.headers.get('retry-after')) > 0);
  assert.equal((await crearCliente(env, { ip: '192.0.2.45' }).pedir('/api/inscripciones', { method: 'POST', body: claseGratis() })).status, 201, 'otra conexión no se ve afectada');
});

test('las escrituras solo se aceptan del propio sitio, en JSON y de tamaño razonable', async () => {
  const env = crearEnv();
  const cliente = crearCliente(env);
  const enviar = (extra) => cliente.pedir('/api/inscripciones', { method: 'POST', body: claseGratis(), ...extra });
  assert.equal((await enviar({ headers: { Origin: 'https://sitio-malo.example' } })).status, 403);
  assert.equal((await enviar({ headers: { Origin: null } })).status, 403);
  assert.equal((await enviar({ headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  assert.equal((await enviar({ headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })).status, 415);
  assert.equal((await enviar({ headers: { 'Content-Type': 'text/plain' } })).status, 415);
  assert.equal((await enviar({ crudo: '{"tipo":' })).status, 400);
  assert.equal((await enviar({ crudo: '[1,2]' })).status, 400);
  assert.equal((await enviar({ crudo: JSON.stringify({ ...claseGratis(), mensaje: 'x'.repeat(40000) }) })).status, 413);
  assert.equal((await cliente.pedir('/api/inscripciones')).status, 405);
  assert.equal((await cliente.pedir('/api/inscripciones', { method: 'OPTIONS', headers: { Origin: 'https://sitio-malo.example' } })).status, 405);
  assert.equal(env.DB.cruda.prepare('SELECT COUNT(*) AS n FROM inscripciones').get().n, 0);
});

test('en producción la API rechaza conexiones sin https', async () => {
  const r = await worker.fetch(new Request('http://club.test/api/config'), crearEnv());
  assert.equal(r.status, 400);
  assert.equal((await worker.fetch(new Request('http://127.0.0.1:8787/api/config'), crearEnv())).status, 200, 'en local sí');
});

test('Turnstile: si está activo, sin verificación no se guarda', async (t) => {
  const env = crearEnv({ TURNSTILE_SITEKEY: 'sitio', TURNSTILE_SECRET: 'secreto' });
  const cliente = crearCliente(env);
  const llamadas = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    llamadas.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ success: JSON.parse(init.body).response === 'bueno' }));
  });
  assert.equal((await cliente.pedir('/api/config')).datos.turnstile, 'sitio');
  assert.equal((await cliente.pedir('/api/inscripciones', { method: 'POST', body: claseGratis() })).status, 400);
  assert.equal((await cliente.pedir('/api/inscripciones', { method: 'POST', body: claseGratis({ turnstile: 'malo' }) })).status, 400);
  assert.equal((await cliente.pedir('/api/inscripciones', { method: 'POST', body: claseGratis({ turnstile: 'bueno' }) })).status, 201);
  assert.equal(llamadas[0].secret, 'secreto');
  assert.equal(env.DB.cruda.prepare('SELECT COUNT(*) AS n FROM inscripciones').get().n, 1);
});

/* ---------- administrador ---------- */
test('sin sesión no se puede leer, crear, editar ni borrar', async () => {
  const env = crearEnv();
  await crearCliente(env).pedir('/api/inscripciones', { method: 'POST', body: matriculaMenor() });
  const anonimo = crearCliente(env, { ip: '198.51.100.9' });
  const intentos = [
    ['/api/admin/inscripciones', 'GET'], ['/api/admin/inscripciones?completo=1', 'GET'], ['/api/admin/inscripciones/1', 'GET'],
    ['/api/admin/inscripciones', 'POST'], ['/api/admin/inscripciones/1', 'PUT'], ['/api/admin/inscripciones/1', 'DELETE'],
    ['/api/admin/auditoria', 'GET'], ['/api/auth/clave', 'POST'], ['/api/auth/logout', 'POST'],
  ];
  for (const [ruta, method] of intentos) {
    for (const headers of [{}, { Cookie: '__Host-sermas_sesion=' }, { Cookie: `__Host-sermas_sesion=${'A'.repeat(43)}` }, { Cookie: "__Host-sermas_sesion=' OR 1=1 --" }]) {
      const r = await anonimo.pedir(ruta, { method, body: method === 'GET' ? undefined : {}, headers });
      assert.equal(r.status, 401, `${method} ${ruta}`);
      assert.ok(!JSON.stringify(r.datos).includes('Sofía'));
    }
  }
  assert.equal(env.DB.cruda.prepare('SELECT COUNT(*) AS n FROM inscripciones').get().n, 1);
});

test('la cuenta del administrador solo se crea una vez y con el código correcto', async () => {
  const env = crearEnv();
  const cliente = crearCliente(env);
  assert.deepEqual((await cliente.pedir('/api/auth/sesion')).datos, { autenticado: false, configurar: true });
  assert.equal((await cliente.pedir('/api/auth/configurar', { method: 'POST', body: { token: 'equivocado', ...ADMIN } })).status, 403);
  assert.equal((await cliente.pedir('/api/auth/configurar', { method: 'POST', body: { token: SETUP_TOKEN, correo: ADMIN.correo, clave: 'corta' } })).status, 400);
  assert.equal((await cliente.pedir('/api/auth/configurar', { method: 'POST', body: { token: SETUP_TOKEN, correo: ADMIN.correo, clave: 'aaaaaaaaaaaaaaaa' } })).status, 400);
  assert.equal((await cliente.pedir('/api/auth/configurar', { method: 'POST', body: { token: SETUP_TOKEN, correo: 'no-es-correo', clave: ADMIN.clave } })).status, 400);

  const creado = await cliente.pedir('/api/auth/configurar', { method: 'POST', body: { token: SETUP_TOKEN, ...ADMIN } });
  assert.equal(creado.status, 201);
  const galleta = creado.headers.get('set-cookie');
  for (const atributo of ['__Host-sermas_sesion=', 'HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/']) assert.ok(galleta.includes(atributo), atributo);

  const otra = await crearCliente(env, { ip: '198.51.100.20' }).pedir('/api/auth/configurar', { method: 'POST', body: { token: SETUP_TOKEN, correo: 'intruso@x.co', clave: 'Otra-clave-larga-123' } });
  assert.equal(otra.status, 404, 'ya existe: la ruta desaparece');
  assert.equal(env.DB.cruda.prepare('SELECT COUNT(*) AS n FROM admins').get().n, 1);

  const admin = env.DB.cruda.prepare('SELECT * FROM admins').get();
  assert.ok(!JSON.stringify(admin).includes(ADMIN.clave), 'la contraseña no se guarda');
  assert.equal(admin.clave_iteraciones, 30000);
  const sesion = env.DB.cruda.prepare('SELECT * FROM sesiones').get();
  assert.ok(!galleta.includes(sesion.token_hash), 'en la base solo queda la huella del token');

  const sinToken = crearEnv({ SETUP_TOKEN: undefined });
  assert.equal((await crearCliente(sinToken).pedir('/api/auth/configurar', { method: 'POST', body: { token: '', ...ADMIN } })).status, 404);
});

test('inicio de sesión: errores genéricos, bloqueo por intentos y cierre de sesión real', async () => {
  const env = crearEnv();
  const admin = await conAdmin(env);
  await admin.pedir('/api/auth/logout', { method: 'POST' });
  assert.equal((await admin.pedir('/api/admin/inscripciones')).status, 401, 'la cookie vieja ya no sirve');

  const atacante = crearCliente(env, { ip: '198.51.100.66' });
  const malaClave = await atacante.pedir('/api/auth/login', { method: 'POST', body: { correo: ADMIN.correo, clave: 'incorrecta-123456' } });
  const malCorreo = await atacante.pedir('/api/auth/login', { method: 'POST', body: { correo: 'otro@club.test', clave: ADMIN.clave } });
  assert.equal(malaClave.status, 401);
  assert.deepEqual(malaClave.datos, malCorreo.datos, 'no revela si el correo existe');
  for (const cuerpo of [{ correo: { $gt: '' }, clave: { $gt: '' } }, { correo: "' OR 1=1 --", clave: "' OR 1=1 --" }, {}]) {
    assert.equal((await atacante.pedir('/api/auth/login', { method: 'POST', body: cuerpo })).status, 401);
  }
  const bloqueado = await atacante.pedir('/api/auth/login', { method: 'POST', body: ADMIN });
  assert.equal(bloqueado.status, 429, 'tras 5 intentos, ni la clave correcta entra desde esa conexión');
  assert.ok(Number(bloqueado.headers.get('retry-after')) > 0);

  const legitimo = crearCliente(env, { ip: '198.51.100.67' });
  const entrada = await legitimo.pedir('/api/auth/login', { method: 'POST', body: { correo: ADMIN.correo.toUpperCase(), clave: ADMIN.clave } });
  assert.equal(entrada.status, 200);
  assert.equal((await legitimo.pedir('/api/auth/sesion')).datos.autenticado, true);
});

test('la sesión vence por inactividad y por tiempo máximo', async () => {
  const env = crearEnv();
  const admin = await conAdmin(env);
  assert.equal((await admin.pedir('/api/admin/inscripciones')).status, 200);
  env.DB.cruda.prepare('UPDATE sesiones SET ultimo_uso = ?').run(Date.now() - 61 * 60000);
  assert.equal((await admin.pedir('/api/admin/inscripciones')).status, 401);
  assert.equal(env.DB.cruda.prepare('SELECT COUNT(*) AS n FROM sesiones').get().n, 0);

  await admin.pedir('/api/auth/login', { method: 'POST', body: ADMIN });
  env.DB.cruda.prepare('UPDATE sesiones SET expira = ?').run(Date.now() - 1);
  assert.equal((await admin.pedir('/api/admin/inscripciones')).status, 401);
});

test('CSRF: con la cookie pero sin el token, o desde otro sitio, no se puede escribir', async () => {
  const env = crearEnv();
  const admin = await conAdmin(env);
  await crearCliente(env, { ip: '198.51.100.30' }).pedir('/api/inscripciones', { method: 'POST', body: matriculaMenor() });
  const sinToken = { 'X-CSRF-Token': '' };
  assert.equal((await admin.pedir('/api/admin/inscripciones/1', { method: 'DELETE', headers: sinToken })).status, 403);
  assert.equal((await admin.pedir('/api/admin/inscripciones/1', { method: 'DELETE', headers: { 'X-CSRF-Token': 'A'.repeat(43) } })).status, 403);
  assert.equal((await admin.pedir('/api/admin/inscripciones/1', { method: 'DELETE', headers: { Origin: 'https://sitio-malo.example' } })).status, 403);
  assert.equal((await admin.pedir('/api/auth/logout', { method: 'POST', headers: sinToken })).status, 403);
  assert.equal(env.DB.cruda.prepare('SELECT COUNT(*) AS n FROM inscripciones').get().n, 1);
});

test('CRUD completo del administrador y registro de actividad', async () => {
  const env = crearEnv();
  const admin = await conAdmin(env);
  const publico = crearCliente(env, { ip: '198.51.100.40' });
  await publico.pedir('/api/inscripciones', { method: 'POST', body: matriculaMenor() });
  await publico.pedir('/api/inscripciones', { method: 'POST', body: matriculaMenor({ nombres: 'Sofía Otra' }) });

  // listar
  const lista = (await admin.pedir('/api/admin/inscripciones')).datos.inscripciones;
  assert.equal(lista.length, 2);
  assert.equal(lista[0].nombre.includes('Restrepo'), true);
  assert.equal(lista[0].posible_duplicado, true, 'mismo documento: se avisa al administrador');
  assert.equal(lista[0].numero_documento, undefined, 'la lista no trae documentos');

  // ver
  const ficha = (await admin.pedir('/api/admin/inscripciones/1')).datos.inscripcion;
  assert.equal(ficha.datos.numero_documento, '1033456789');
  assert.equal(ficha.datos.correo, 'familia@correo.com');
  assert.equal(ficha.datos.condiciones_salud, 'Asma leve.\nUsa inhalador.');
  assert.equal(ficha.aceptaciones.firma_nombre, 'Laura Gómez');
  assert.equal(ficha.aceptaciones.firma_documento, '43123456');
  assert.equal(ficha.consentimiento.reglamento, '2026');

  // editar (rectificación)
  const cambios = { ...ficha.datos, celular: '3001110000', eps: 'Sanitas' };
  const malo = await admin.pedir('/api/admin/inscripciones/1', { method: 'PUT', body: { datos: cambios, estado: 'nueva', notas: '', documentos: {} } });
  assert.equal(malo.status, 422, 'estado de otro tipo');
  const editado = await admin.pedir('/api/admin/inscripciones/1', {
    method: 'PUT', body: { datos: cambios, estado: 'activo', notas: 'Pagó matrícula', documentos: { identidad: true, eps: true, inventado: true } },
  });
  assert.equal(editado.status, 200);
  const despues = (await admin.pedir('/api/admin/inscripciones/1')).datos.inscripcion;
  assert.equal(despues.estado, 'activo');
  assert.equal(despues.datos.eps, 'Sanitas');
  assert.equal(despues.notas, 'Pagó matrícula');
  assert.equal(despues.documentos.identidad, true);
  assert.equal(despues.documentos.foto, false);
  assert.equal(despues.documentos.inventado, undefined);
  assert.equal(despues.aceptaciones.firma_nombre, 'Laura Gómez', 'la prueba de autorización no se pierde al editar');
  assert.ok(!todoLoGuardado(env).includes('Sanitas'));

  // quién debe la matrícula
  assert.equal(lista[0].debe_matricula, true, 'recién matriculado: debe');
  assert.equal(despues.matricula_pagada, false);
  await admin.pedir('/api/admin/inscripciones/1', { method: 'PUT', body: { datos: cambios, estado: 'activo', notas: '', documentos: {}, matricula_pagada: true } });
  const pagos = (await admin.pedir('/api/admin/inscripciones')).datos.inscripciones;
  assert.equal(pagos.find((r) => r.id === 1).debe_matricula, false, 'pagada: ya no debe');
  assert.equal(pagos.find((r) => r.id === 2).debe_matricula, true);
  await admin.pedir('/api/admin/inscripciones/2', { method: 'PUT', body: { datos: (await admin.pedir('/api/admin/inscripciones/2')).datos.inscripcion.datos, estado: 'retirado', notas: '', documentos: {} } });
  assert.equal((await admin.pedir('/api/admin/inscripciones')).datos.inscripciones.find((r) => r.id === 2).debe_matricula, false, 'retirado: no cuenta');
  const publicoPagado = await crearCliente(env, { ip: '198.51.100.41' }).pedir('/api/inscripciones', { method: 'POST', body: matriculaAdulto({ numero_documento: '900111222', matricula_pagada: true }) });
  assert.equal(publicoPagado.status, 201);
  assert.equal((await admin.pedir('/api/admin/inscripciones')).datos.inscripciones[0].debe_matricula, true, 'el público no puede marcarse como pagado');
  await admin.pedir('/api/admin/inscripciones/3', { method: 'DELETE' });

  // crear desde el panel
  const sinAutorizacion = await admin.pedir('/api/admin/inscripciones', { method: 'POST', body: { tipo: 'matricula', datos: matriculaAdulto() } });
  assert.equal(sinAutorizacion.status, 422);
  const creado = await admin.pedir('/api/admin/inscripciones', { method: 'POST', body: { tipo: 'matricula', datos: matriculaAdulto(), autorizacion_fisica: true } });
  assert.equal(creado.status, 201);
  const nuevo = (await admin.pedir(`/api/admin/inscripciones/${creado.datos.id}`)).datos.inscripcion;
  assert.equal(nuevo.origen, 'admin');
  assert.equal(nuevo.consentimiento, null);

  // exportar
  const exportado = (await admin.pedir('/api/admin/inscripciones?completo=1')).datos.inscripciones;
  assert.equal(exportado.length, 3);
  assert.ok(exportado.every((r) => r.datos));

  // eliminar (supresión)
  assert.equal((await admin.pedir('/api/admin/inscripciones/2', { method: 'DELETE' })).status, 200);
  assert.equal((await admin.pedir('/api/admin/inscripciones/2')).status, 404);
  assert.equal((await admin.pedir('/api/admin/inscripciones/2', { method: 'DELETE' })).status, 404);
  assert.equal(env.DB.cruda.prepare('SELECT COUNT(*) AS n FROM inscripciones WHERE id = 2').get().n, 0);

  // actividad
  const eventos = (await admin.pedir('/api/admin/auditoria')).datos.eventos;
  const acciones = eventos.map((e) => e.accion);
  for (const accion of ['configurar', 'ver', 'editar', 'crear', 'exportar', 'eliminar']) assert.ok(acciones.includes(accion), accion);
  const auditoria = JSON.stringify(env.DB.cruda.prepare('SELECT * FROM auditoria').all());
  for (const secreto of ['Sofía', '1033456789', '203.0.113.10']) assert.ok(!auditoria.includes(secreto), 'la auditoría no guarda datos personales');
});

test('un registro manipulado o movido de fila no se puede descifrar', async (t) => {
  t.mock.method(console, 'error', () => {});
  const env = crearEnv();
  const admin = await conAdmin(env);
  const publico = crearCliente(env, { ip: '198.51.100.50' });
  await publico.pedir('/api/inscripciones', { method: 'POST', body: matriculaMenor() });
  await publico.pedir('/api/inscripciones', { method: 'POST', body: matriculaAdulto() });
  const [a, b] = env.DB.cruda.prepare('SELECT id, datos_cifrados FROM inscripciones ORDER BY id').all();
  env.DB.cruda.prepare('UPDATE inscripciones SET datos_cifrados = ? WHERE id = ?').run(b.datos_cifrados, a.id);
  assert.equal((await admin.pedir(`/api/admin/inscripciones/${a.id}`)).status, 500);

  const otraLlave = { ...env, MASTER_KEY: Buffer.alloc(32, 9).toString('base64') };
  const r = await worker.fetch(new Request(`${ORIGEN}/api/admin/inscripciones/${b.id}`, { headers: { Cookie: admin.estado.cookie } }), otraLlave);
  assert.equal(r.status, 500, 'con otra llave maestra no se lee nada');
});

test('cambio de contraseña: pide la actual, exige una fuerte y cierra las demás sesiones', async () => {
  const env = crearEnv();
  const admin = await conAdmin(env);
  const cookieVieja = admin.estado.cookie;
  const nueva = 'Otra-brazada-mejor-2027';
  assert.equal((await admin.pedir('/api/auth/clave', { method: 'POST', body: { actual: 'no-es-la-actual', nueva } })).status, 403);
  assert.equal((await admin.pedir('/api/auth/clave', { method: 'POST', body: { actual: ADMIN.clave, nueva: 'corta' } })).status, 400);
  assert.equal((await admin.pedir('/api/auth/clave', { method: 'POST', body: { actual: ADMIN.clave, nueva: ADMIN.clave } })).status, 400);
  assert.equal((await admin.pedir('/api/auth/clave', { method: 'POST', body: { actual: ADMIN.clave, nueva } })).status, 200);
  assert.notEqual(admin.estado.cookie, cookieVieja);
  assert.equal((await admin.pedir('/api/admin/inscripciones')).status, 200);
  assert.equal((await crearCliente(env).pedir('/api/admin/inscripciones', { headers: { Cookie: cookieVieja } })).status, 401);

  const otro = crearCliente(env, { ip: '198.51.100.70' });
  assert.equal((await otro.pedir('/api/auth/login', { method: 'POST', body: ADMIN })).status, 401, 'la clave anterior ya no sirve');
  assert.equal((await otro.pedir('/api/auth/login', { method: 'POST', body: { correo: ADMIN.correo, clave: nueva } })).status, 200);
});

test('los errores internos no filtran detalles', async (t) => {
  const registrado = [];
  t.mock.method(console, 'error', (linea) => registrado.push(linea));
  const env = crearEnv();
  const admin = await conAdmin(env);
  env.DB.cruda.exec('DROP TABLE auditoria');
  const r = await admin.pedir('/api/admin/auditoria');
  assert.equal(r.status, 500);
  assert.deepEqual(Object.keys(r.datos), ['error']);
  assert.ok(!r.datos.error.includes('auditoria'));
  assert.equal(registrado.length, 1);
});
