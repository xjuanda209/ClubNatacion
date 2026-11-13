/* =========================================================
   Inscripciones: clase gratis de bienvenida y matrícula.
   Envía los datos al backend (/api/inscripciones) por conexión cifrada.
   La validación de aquí es solo ayuda para la persona: el servidor
   vuelve a validar todo.
   ========================================================= */
(function () {
  'use strict';
  const q = (sel, root) => (root || document).querySelector(sel);
  const qa = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  const tabs = qa('.ins-mode');
  const forms = { 'clase-gratis': q('#panel-clase'), matricula: q('#panel-matricula') };
  const alerta = q('#insAlert');
  const hecho = q('#insDone');
  let config = null;
  const leidos = new Set();

  const avisar = (texto) => {
    alerta.textContent = texto || '';
    alerta.hidden = !texto;
    if (texto) alerta.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };

  /* ---------- modo: clase gratis o matrícula ---------- */
  function elegir(modo, mover) {
    if (!forms[modo]) modo = 'clase-gratis';
    tabs.forEach((t) => t.setAttribute('aria-selected', String(t.dataset.modo === modo)));
    Object.entries(forms).forEach(([m, f]) => { f.hidden = m !== modo; });
    hecho.hidden = true;
    avisar('');
    if (mover) history.replaceState(null, '', `#${modo}`);
  }
  tabs.forEach((t) => t.addEventListener('click', () => elegir(t.dataset.modo, true)));
  window.addEventListener('hashchange', () => elegir(location.hash.slice(1), false));
  elegir(location.hash.slice(1) || 'clase-gratis', false);

  const programa = new URLSearchParams(location.search).get('programa');
  if (programa) qa('select[name="programa"]').forEach((s) => { if (qa('option', s).some((o) => o.value === programa)) s.value = programa; });

  /* ---------- errores por campo ---------- */
  const cajaDe = (input) => input.closest('.field');
  function marcar(input, mensaje) {
    const caja = cajaDe(input);
    if (!caja) return;
    caja.classList.toggle('has-error', !!mensaje);
    const p = q('.field__err', caja);
    if (p) p.textContent = mensaje || '';
    input.setAttribute('aria-invalid', mensaje ? 'true' : 'false');
  }

  function revisar(input) {
    if (input.name === 'sitio_web' || input.closest('[hidden]')) return '';
    const v = input.type === 'checkbox' ? input.checked : input.value.trim();
    const obligatorio = input.required || (input.closest('[data-solo-menor]') && input.type === 'checkbox');
    if (!v) return obligatorio ? (input.type === 'checkbox' ? 'Marca esta casilla para continuar.' : 'Este dato es obligatorio.') : '';
    if (input.type === 'email' && !/^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/.test(v)) return 'Escribe un correo válido.';
    if (input.type === 'tel' && !/^\+?\d{7,15}$/.test(v.replace(/[\s().-]/g, ''))) return 'Escribe un número de celular válido.';
    if (input.name === 'edad' && !(Number(v) >= 3 && Number(v) <= 100)) return 'Escribe una edad entre 3 y 100 años.';
    if (/numero_documento$/.test(input.name) && !/^[A-Za-z0-9-]{4,20}$/.test(v.replace(/[\s.]/g, ''))) return 'Escribe el número sin puntos.';
    if (input.name === 'fecha_nacimiento') {
      const edad = edadDe(v);
      if (!(edad >= 3 && edad <= 100)) return 'Revisa la fecha de nacimiento.';
    }
    return '';
  }

  /** Revisa los campos de un bloque; devuelve el primero con error. */
  function revisarBloque(bloque) {
    let primero = null;
    qa('input, select, textarea', bloque).forEach((input) => {
      const mensaje = revisar(input);
      marcar(input, mensaje);
      if (mensaje && !primero) primero = input;
    });
    return primero;
  }

  Object.values(forms).forEach((form) => {
    form.addEventListener('input', (e) => { if (cajaDe(e.target) && cajaDe(e.target).classList.contains('has-error')) marcar(e.target, revisar(e.target)); });
    form.addEventListener('change', (e) => { if (e.target.name) marcar(e.target, revisar(e.target)); });
  });

  function edadDe(fecha) {
    const [a, m, d] = fecha.split('-').map(Number);
    if (!a || !m || !d) return NaN;
    const hoy = new Date();
    return hoy.getFullYear() - a - (hoy.getMonth() + 1 < m || (hoy.getMonth() + 1 === m && hoy.getDate() < d) ? 1 : 0);
  }
  const soloMenor = (form, esMenor) => qa('[data-solo-menor]', form).forEach((el) => { el.hidden = !esMenor; });

  /* ---------- clase gratis ---------- */
  const clase = forms['clase-gratis'];
  clase.elements.edad.addEventListener('input', () => {
    const edad = Number(clase.elements.edad.value);
    soloMenor(clase, edad >= 3 && edad < 18);
  });

  /* ---------- matrícula por pasos ---------- */
  const mat = forms.matricula;
  const pasos = qa('.paso', mat);
  const atras = q('#stepBack');
  const siguiente = q('#stepNext');
  const enviar = q('#stepSend');
  let paso = 1;
  let menor = null; // null: todavía no se sabe (falta la fecha de nacimiento)

  const saltado = (n) => n === 3 && menor === false;
  function irA(n, enfocar) {
    paso = Math.min(4, Math.max(1, n));
    pasos.forEach((p) => { p.hidden = Number(p.dataset.paso) !== paso; });
    atras.hidden = paso === 1;
    siguiente.hidden = paso === 4;
    enviar.hidden = paso !== 4;
    q('#stepFill').style.width = `${[4, 36, 68, 100][paso - 1]}%`;
    qa('[data-paso-ind]', mat).forEach((li) => {
      const n = Number(li.dataset.pasoInd);
      li.classList.toggle('is-on', n <= paso && !saltado(n));
      li.classList.toggle('is-skip', saltado(n));
    });
    const titulo = q('.paso__t', pasos[paso - 1]).textContent;
    q('#stepLive').textContent = `Paso ${paso} de 4: ${titulo}`;
    if (enfocar) {
      const primero = q('input:not([type="checkbox"]), select', pasos[paso - 1]);
      mat.scrollIntoView({ block: 'start', behavior: 'smooth' });
      if (primero) primero.focus({ preventScroll: true });
    }
  }

  function revisarEdad() {
    const edad = edadDe(mat.elements.fecha_nacimiento.value);
    menor = Number.isNaN(edad) ? null : edad < 18;
    q('#minorNote').hidden = !menor;
    soloMenor(mat, !!menor);
  }
  mat.elements.fecha_nacimiento.addEventListener('change', () => { revisarEdad(); irA(paso, false); });

  siguiente.addEventListener('click', () => {
    revisarEdad();
    const malo = revisarBloque(pasos[paso - 1]);
    if (malo) { malo.focus(); return; }
    irA(saltado(paso + 1) ? paso + 2 : paso + 1, true);
  });
  atras.addEventListener('click', () => irA(saltado(paso - 1) ? paso - 2 : paso - 1, true));
  // Enter en un campo avanza de paso en vez de enviar a medias
  mat.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.tagName === 'INPUT' && paso < 4) { e.preventDefault(); siguiente.click(); }
  });
  irA(1, false);

  /* ---------- lector de documentos ---------- */
  const dlg = q('#docDialog');
  const dlgBody = q('#docDialogBody');
  const dlgAceptar = q('#docAccept');
  const TITULOS = { reglamento: 'Reglamento del club 2026', instructivo: 'Instructivo de matrícula 2026', politica: 'Política de tratamiento de datos' };
  const ORIGEN = { reglamento: 'documentos.html', instructivo: 'documentos.html', politica: 'privacidad.html' };
  const cache = {};
  let docAbierto = '';

  async function traer(doc) {
    if (!cache[doc]) {
      const r = await fetch(ORIGEN[doc], { credentials: 'omit' });
      if (!r.ok) throw new Error('sin documento');
      const pagina = new DOMParser().parseFromString(await r.text(), 'text/html');
      const articulo = pagina.querySelector(`[data-documento="${doc}"]`);
      if (!articulo) throw new Error('sin documento');
      cache[doc] = document.importNode(articulo, true);
      cache[doc].removeAttribute('id');
    }
    return cache[doc];
  }

  async function abrirDoc(doc) {
    try {
      const articulo = await traer(doc);
      docAbierto = doc;
      q('#docDialogTitle').textContent = TITULOS[doc];
      dlgBody.replaceChildren(articulo);
      dlgAceptar.hidden = doc === 'politica';
      dlg.showModal();
      dlgBody.scrollTop = 0;
      dlgBody.focus();
    } catch (err) {
      window.open(ORIGEN[doc] + (doc === 'politica' ? '' : `#${doc}`), '_blank', 'noopener');
    }
    leidos.add(doc);
    qa(`.check__read[data-doc="${doc}"]`).forEach((b) => b.classList.add('is-read'));
  }

  document.addEventListener('click', (e) => {
    const el = e.target instanceof Element ? e.target.closest('[data-doc]') : null;
    if (el && !dlg.contains(el)) { e.preventDefault(); abrirDoc(el.dataset.doc); return; }
    if (e.target instanceof Element && e.target.closest('[data-doc-cerrar]')) dlg.close();
    if (e.target === dlg) dlg.close(); // clic en el fondo
  });
  dlgAceptar.addEventListener('click', () => {
    const casilla = q(`input[data-requiere-doc="${docAbierto}"]`, mat);
    if (casilla) { casilla.checked = true; marcar(casilla, ''); }
    dlg.close();
  });
  // No se puede aceptar un documento que no se ha abierto
  qa('input[data-requiere-doc]', mat).forEach((casilla) => {
    casilla.addEventListener('click', (e) => {
      if (casilla.checked && !leidos.has(casilla.dataset.requiereDoc)) {
        e.preventDefault();
        abrirDoc(casilla.dataset.requiereDoc);
      }
    });
  });

  /* ---------- Turnstile (solo si el club lo activó) ---------- */
  const widgets = new Map();
  function activarTurnstile(sitekey) {
    window.sermasTurnstile = () => {
      Object.values(forms).forEach((form) => {
        const caja = q('[data-turnstile]', form);
        if (caja && window.turnstile) widgets.set(form, window.turnstile.render(caja, { sitekey, language: 'es' }));
      });
    };
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=sermasTurnstile';
    s.async = true;
    document.head.appendChild(s);
  }

  /* ---------- envío ---------- */
  function recoger(form) {
    const datos = { tipo: form.dataset.tipo };
    qa('input, select, textarea', form).forEach((input) => {
      if (!input.name || input.closest('[hidden]')) return;
      if (form === mat && input.closest('.paso[data-paso="3"]') && !menor) return;
      if (input.type === 'checkbox') datos[input.name] = input.checked;
      else if (input.name === 'edad') datos.edad = Number(input.value);
      else if (input.value.trim()) datos[input.name] = input.value.trim();
    });
    // los pasos ocultos de la matrícula también cuentan
    if (form === mat) {
      qa('.paso[hidden] input, .paso[hidden] select, .paso[hidden] textarea', form).forEach((input) => {
        if (!input.name || input.closest('[data-solo-menor][hidden]')) return;
        if (input.closest('.paso[data-paso="3"]') && !menor) return;
        if (input.type === 'checkbox') datos[input.name] = input.checked;
        else if (input.value.trim()) datos[input.name] = input.value.trim();
      });
    }
    datos.versiones = config ? config.versiones : {};
    if (widgets.has(form) && window.turnstile) datos.turnstile = window.turnstile.getResponse(widgets.get(form)) || '';
    return datos;
  }

  function mostrarErrores(form, errores) {
    let primero = null;
    Object.entries(errores).forEach(([nombre, mensaje]) => {
      const input = form.elements[nombre];
      if (!input || !input.name) return;
      marcar(input, mensaje);
      if (!primero) primero = input;
    });
    if (primero) {
      const suPaso = primero.closest('.paso');
      if (suPaso) irA(Number(suPaso.dataset.paso), false);
      primero.focus();
    }
  }

  function terminado(form, referencia) {
    const esMatricula = form === mat;
    q('#doneRef').textContent = referencia;
    q('#doneTitle').textContent = esMatricula ? '¡Tocaste la pared!' : '¡Nos vemos en el agua!';
    q('#doneText').textContent = esMatricula
      ? 'Recibimos tu matrícula y la aceptación del reglamento. El club revisará los datos y te escribirá para confirmar el cupo.'
      : 'Recibimos tu solicitud. Te escribiremos por WhatsApp para agendar tu clase gratis de bienvenida.';
    q('#doneDocs').hidden = !esMatricula;
    form.reset();
    form.hidden = true;
    hecho.hidden = false;
    hecho.focus();
    hecho.scrollIntoView({ block: 'start', behavior: 'smooth' });
    if (esMatricula) { menor = null; soloMenor(mat, false); q('#minorNote').hidden = true; irA(1, false); } else soloMenor(clase, false);
  }

  async function mandar(form) {
    avisar('');
    if (form === mat) revisarEdad();
    if (!config) { avisar('No pudimos conectar con el servidor. Revisa tu conexión y recarga la página.'); return; }
    let malo = null;
    if (form === mat) {
      for (const p of pasos) {
        if (saltado(Number(p.dataset.paso))) continue;
        const oculto = p.hidden;
        p.hidden = false; // para revisar también los pasos que no están a la vista
        const m = revisarBloque(p);
        p.hidden = oculto;
        if (m && !malo) malo = m;
      }
      if (malo) { irA(Number(malo.closest('.paso').dataset.paso), false); malo.focus(); return; }
    } else {
      malo = revisarBloque(form);
      if (malo) { malo.focus(); return; }
    }

    const boton = q('button[type="submit"]', form);
    boton.disabled = true;
    try {
      const r = await fetch('/api/inscripciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(recoger(form)),
      });
      const cuerpo = await r.json().catch(() => ({}));
      if (r.status === 201) { terminado(form, cuerpo.referencia || ''); return; }
      if (cuerpo.errores) mostrarErrores(form, cuerpo.errores);
      avisar(cuerpo.error || 'No pudimos enviar el formulario. Intenta de nuevo.');
      if (widgets.has(form) && window.turnstile) window.turnstile.reset(widgets.get(form));
    } catch (err) {
      avisar('No pudimos enviar el formulario. Revisa tu conexión e intenta de nuevo.');
    } finally {
      boton.disabled = false;
    }
  }
  Object.values(forms).forEach((form) => form.addEventListener('submit', (e) => { e.preventDefault(); mandar(form); }));

  /* ---------- arranque ---------- */
  if (location.protocol === 'file:') {
    avisar('Para enviar el formulario abre el sitio con "npm run dev" (http://127.0.0.1:8787) o en su dirección pública: desde un archivo local no hay servidor.');
  } else {
    fetch('/api/config', { credentials: 'omit' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('config'))))
      .then((c) => { config = c; if (c.turnstile) activarTurnstile(c.turnstile); })
      .catch(() => avisar('El formulario no está disponible en este momento. Escríbenos por WhatsApp mientras lo resolvemos.'));
  }
})();
