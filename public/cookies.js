/* =========================================================
   Aviso de cookies y contenido de terceros.
   El sitio no usa cookies de publicidad ni de analítica. La única cookie
   propia es la de sesión del administrador (estrictamente necesaria).
   Los mapas son de Google y sí pueden guardar cookies: solo se cargan
   si la persona acepta. La elección se recuerda en este navegador.
   ========================================================= */
(function () {
  var CLAVE = 'sermas-cookies';
  var leer = function () { try { return localStorage.getItem(CLAVE); } catch (e) { return null; } };
  var guardar = function (v) { try { localStorage.setItem(CLAVE, v); } catch (e) { /* modo privado */ } };

  var mapas = [].slice.call(document.querySelectorAll('iframe[src*="google."]'));

  function apagarMapas() {
    mapas.forEach(function (mapa) {
      if (mapa.dataset.src) return;
      mapa.dataset.src = mapa.getAttribute('src');
      mapa.removeAttribute('src');
      mapa.hidden = true;
      var aviso = document.createElement('div');
      aviso.className = 'map-off';
      var texto = document.createElement('span');
      texto.textContent = 'El mapa es de Google y puede guardar cookies.';
      var boton = document.createElement('button');
      boton.type = 'button';
      boton.textContent = 'Ver el mapa';
      boton.addEventListener('click', function () { guardar('todas'); encenderMapas(); cerrar(); });
      aviso.appendChild(texto);
      aviso.appendChild(boton);
      mapa.parentNode.insertBefore(aviso, mapa);
    });
  }
  function encenderMapas() {
    mapas.forEach(function (mapa) {
      if (!mapa.dataset.src) return;
      var aviso = mapa.previousElementSibling;
      if (aviso && aviso.className === 'map-off') aviso.remove();
      mapa.setAttribute('src', mapa.dataset.src);
      delete mapa.dataset.src;
      mapa.hidden = false;
    });
  }

  var caja = null;
  function cerrar() { if (caja) { caja.remove(); caja = null; } }
  function mostrar() {
    caja = document.createElement('div');
    caja.className = 'cookies';
    caja.setAttribute('role', 'region');
    caja.setAttribute('aria-label', 'Aviso de cookies');
    var titulo = document.createElement('b');
    titulo.textContent = 'Cookies y privacidad';
    var texto = document.createElement('span');
    texto.textContent = 'Usamos solo lo necesario para que el sitio funcione, sin publicidad ni rastreo. Los mapas de Google son opcionales. ';
    var enlace = document.createElement('a');
    enlace.href = 'privacidad.html#cookies';
    enlace.textContent = 'Más información';
    texto.appendChild(enlace);
    var acciones = document.createElement('div');
    acciones.className = 'cookies__actions';
    [['necesarias', 'Solo necesarias'], ['todas', 'Aceptar todas']].forEach(function (op) {
      var b = document.createElement('button');
      b.type = 'button';
      b.dataset.cookies = op[0];
      b.textContent = op[1];
      b.addEventListener('click', function () {
        guardar(op[0]);
        if (op[0] === 'todas') encenderMapas(); else apagarMapas();
        cerrar();
      });
      acciones.appendChild(b);
    });
    caja.appendChild(titulo);
    caja.appendChild(texto);
    caja.appendChild(acciones);
    document.body.appendChild(caja);
  }

  var eleccion = leer();
  if (eleccion !== 'todas') apagarMapas();
  if (!eleccion) mostrar();

  // enlace "Cambiar mi elección" en la política de datos
  document.addEventListener('click', function (e) {
    var el = e.target instanceof Element ? e.target.closest('[data-cookies-reabrir]') : null;
    if (!el) return;
    e.preventDefault();
    if (!caja) mostrar();
  });
})();
