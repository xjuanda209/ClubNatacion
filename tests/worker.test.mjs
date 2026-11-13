import assert from 'node:assert/strict';
import { test } from 'node:test';
import worker from '../src/worker.mjs';

const request = (path, method = 'GET') => new Request(`https://club.test${path}`, { method });
const connected = { DB: { prepare: () => ({ all: async () => ({ success: true, results: [] }) }) } };

test('health comprueba D1 y devuelve un estado sin datos de usuarios ni caché', async () => {
  const response = await worker.fetch(request('/api/health'), connected);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok', database: 'connected' });
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('HEAD comprueba D1 pero no devuelve cuerpo', async () => {
  const response = await worker.fetch(request('/api/health', 'HEAD'), connected);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), '');
});

test('una tabla o binding no disponible devuelve 503 sin exponer detalles SQL', async (t) => {
  t.mock.method(console, 'error', () => {});
  const broken = { DB: { prepare: () => { throw new Error('no such table: users'); } } };
  const response = await worker.fetch(request('/api/health'), broken);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { status: 'error', database: 'unavailable' });
});

test('health rechaza escrituras antes de consultar D1', async () => {
  const response = await worker.fetch(request('/api/health', 'POST'), {});
  assert.equal(response.status, 405);
  assert.equal(response.headers.get('allow'), 'GET, HEAD');
});

test('las rutas del CRUD todavía no exponen ni modifican usuarios', async () => {
  for (const path of ['/api', '/api/users', '/api/users/1']) {
    for (const method of ['GET', 'POST', 'PUT', 'DELETE']) {
      const response = await worker.fetch(request(path, method), {});
      assert.equal(response.status, 404);
      assert.match(response.headers.get('content-type'), /application\/json/);
    }
  }
});

test('las páginas siguen pasando a ASSETS conservando respuesta y cabeceras', async () => {
  const incoming = request('/club.html');
  const expected = new Response('<html>Club</html>', { headers: { 'X-Robots-Tag': 'noindex' } });
  const response = await worker.fetch(incoming, { ASSETS: { fetch: async (actual) => {
    assert.equal(actual, incoming);
    return expected;
  } } });
  assert.equal(response, expected);
  assert.equal(response.headers.get('x-robots-tag'), 'noindex');
});
