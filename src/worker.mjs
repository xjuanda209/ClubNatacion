/**
 * Backend inicial del sitio. Los bindings Env se generan con npm run types.
 * Las rutas del CRUD se añadirán aquí; los archivos públicos siguen en ASSETS.
 */

function json(request, data, status = 200, extraHeaders = {}) {
  return new Response(request.method === 'HEAD' ? null : JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex',
      ...extraHeaders,
    },
  });
}

export default {
  /**
   * @param {Request} request
   * @param {Env} env
   * @returns {Promise<Response>}
   */
  async fetch(request, env) {
    const { pathname } = new URL(request.url);

    if (pathname !== '/api' && !pathname.startsWith('/api/')) {
      return env.ASSETS.fetch(request);
    }

    if (pathname !== '/api/health') {
      return json(request, { error: 'Ruta no encontrada' }, 404);
    }

    if (!['GET', 'HEAD'].includes(request.method)) {
      return json(request, { error: 'Método no permitido' }, 405, { Allow: 'GET, HEAD' });
    }

    try {
      // Verifica el binding y la tabla sin leer ni devolver datos de usuarios.
      const result = await env.DB.prepare('SELECT id FROM users LIMIT 0').all();
      if (!result.success) throw new Error('La comprobación de D1 no terminó correctamente');
      return json(request, { status: 'ok', database: 'connected' });
    } catch (error) {
      console.error(JSON.stringify({
        event: 'database_health_check_failed',
        message: error instanceof Error ? error.message : 'Error de base de datos',
      }));
      return json(request, { status: 'error', database: 'unavailable' }, 503);
    }
  },
};
