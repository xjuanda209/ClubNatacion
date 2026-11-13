/* =========================================================
   Panel de administración.
   Todo dato que viene del servidor se pinta con textContent
   (nunca como HTML), para que nada escrito en un formulario
   pueda ejecutarse aquí.
   ========================================================= */
(function () {
  'use strict';
  const q = (sel, root) => (root || document).querySelector(sel);
  const qa = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  /** Crea un elemento: h('p', {class: 'x'}, 'texto', otroNodo) */
  function h(tag, attrs, ...hijos) {
    const el = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => {
      if (v === false || v === null || v === undefined) return;
      if (k === 'class') el.className = v;
      else if (k === 'value') el.value = v;
      else if (k === 'checked') el.checked = !!v;
      else el.setAttribute(k, v === true ? '' : v);
    });
    hijos.flat().forEach((hijo) => { if (hijo !== null && hijo !== undefined && hijo !== false) el.append(hijo); });
    return el;
  }

  /* ---------- catálogos ---------- */
  const PROGRAMAS = {
    cat1: 'Categoría 1 · 8 a 11', cat2: 'Categoría 2 · 12 a 14', cat3: 'Categoría 3 · 15 a 17', cat4: 'Categoría 4 · 17+',
    master: 'Natación máster', triatlon: 'Triatlón y aguas abiertas', asesoria: 'Asesoría deportiva', orientacion: 'Por ubicar',
  };
  const SEDES = { medellin: 'Medellín', envigado: 'Envigado', cualquiera: 'Cualquiera' };
  const TIPOS_DOC = { RC: 'Registro civil', TI: 'Tarjeta de identidad', CC: 'Cédula de ciudadanía', CE: 'Cédula de extranjería', PA: 'Pasaporte', PPT: 'Permiso por protección temporal' };
  const TIPOS_DOC_ADULTO = { CC: TIPOS_DOC.CC, CE: TIPOS_DOC.CE, PA: TIPOS_DOC.PA, PPT: TIPOS_DOC.PPT };
  const REGIMENES = { '': 'Sin especificar', contributivo: 'Contributivo', subsidiado: 'Subsidiado', especial: 'Especial o de excepción', otro: 'Otro' };
  const ESTADOS = {
    matricula: { pendiente: 'Pendiente', activo: 'Activo', retirado: 'Retirado' },
    clase_gratis: { nueva: 'Nueva', contactada: 'Contactada', agendada: 'Agendada', asistio: 'Asistió', descartada: 'Descartada' },
  };
  const DOCUMENTOS = {
    hoja_vida: 'Hoja de vida', identidad: 'Documento de identidad', eps: 'Certificado EPS', identidad_acudiente: 'Documento del acudiente',
    paz_salvo: 'Paz y salvo (club anterior)', pago: 'Soportes de pago', certificado_medico: 'Certificado médico', foto: 'Foto fondo blanco',
    reglamento_firmado: 'Reglamento firmado',
  };
  const ACCIONES = {
    login: 'Entró al panel', login_fallido: 'Intento de entrada fallido', logout: 'Salió', configurar: 'Creó la cuenta',
    configurar_fallido: 'Código de configuración incorrecto', cambio_clave: 'Cambió la contraseña', crear: 'Creó un registro',
    ver: 'Consultó un registro', editar: 'Editó un registro', eliminar: 'Eliminó un registro', exportar: 'Exportó datos',
  };

  /** Campos por tipo: [nombre, etiqueta, clase de control, opciones] */
  const FICHA = {
    matricula: [
      ['Deportista', [
        ['nombres', 'Nombres'], ['apellidos', 'Apellidos'],
        ['tipo_documento', 'Tipo de documento', 'select', TIPOS_DOC], ['numero_documento', 'Número de documento'],
        ['fecha_nacimiento', 'Fecha de nacimiento', 'date'], ['celular', 'Celular', 'tel'], ['correo', 'Correo', 'email'],
        ['direccion', 'Dirección'], ['ciudad', 'Ciudad'],
        ['programa', 'Programa', 'select', PROGRAMAS], ['sede', 'Sede', 'select', SEDES],
      ]],
      ['Seguridad social y salud', [
        ['eps', 'EPS'], ['regimen', 'Régimen', 'select', REGIMENES],
        ['emergencia_nombre', 'Contacto de emergencia'], ['emergencia_telefono', 'Celular de emergencia', 'tel'],
        ['club_anterior', 'Club anterior'], ['condiciones_salud', 'Condiciones de salud', 'area'],
      ]],
      ['Acudiente (solo menores de edad)', [
        ['acudiente_nombre', 'Nombre completo'], ['acudiente_parentesco', 'Parentesco'],
        ['acudiente_tipo_documento', 'Tipo de documento', 'select', TIPOS_DOC_ADULTO], ['acudiente_numero_documento', 'Número de documento'],
        ['acudiente_celular', 'Celular', 'tel'], ['acudiente_correo', 'Correo', 'email'],
      ]],
    ],
    clase_gratis: [
      ['Solicitud', [
        ['nombre', 'Quién va a nadar'], ['edad', 'Edad', 'number'], ['acudiente_nombre', 'Acudiente (menores)'],
        ['celular', 'Celular', 'tel'], ['correo', 'Correo', 'email'],
        ['programa', 'Programa', 'select', PROGRAMAS], ['sede', 'Sede', 'select', SEDES], ['mensaje', 'Mensaje', 'area'],
      ]],
    ],
  };

  const fecha = (iso) => { try { return new Date(iso).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' }); } catch (e) { return iso; } };
  const dia = (iso) => { try { return new Date(iso).toLocaleDateString('es-CO', { dateStyle: 'medium' }); } catch (e) { return iso; } };

  /* ---------- comunicación con el servidor ---------- */
  let csrf = '';
  async function api(ruta, opciones) {
    const { method = 'GET', body } = opciones || {};
    const headers = {};
    if (body) headers['Content-Type'] = 'application/json';
    if (method !== 'GET') headers['X-CSRF-Token'] = csrf;
    let r;
    try {
      r = await fetch(ruta, { method, headers, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin', cache: 'no-store' });
    } catch (e) {
      throw Object.assign(new Error('Sin conexión con el servidor.'), { status: 0 });
    }
    const datos = await r.json().catch(() => ({}));
    if (r.status === 401 && ruta.indexOf('/api/admin') === 0) { mostrarEntrada(false, 'Tu sesión terminó. Entra de nuevo.'); }
    if (!r.ok) throw Object.assign(new Error(datos.error || 'Ocurrió un error.'), { status: r.status, errores: datos.errores });
    return datos;
  }

  /* ---------- entrada ---------- */
  const gate = q('#vGate');
  const panel = q('#vPanel');
  const fLogin = q('#fLogin');
  const fSetup = q('#fSetup');

  function errorEn(form, texto) {
    const p = q('.gate__err, .dlg__err', form);
    p.textContent = texto || '';
    p.hidden = !texto;
  }

  function mostrarEntrada(configurar, mensaje) {
    qa('dialog[open]').forEach((d) => d.close());
    lista = [];
    q('#tablaBody').replaceChildren();
    panel.hidden = true;
    gate.hidden = false;
    q('#gateWait').hidden = true;
    fLogin.hidden = !!configurar;
    fSetup.hidden = !configurar;
    fLogin.reset();
    fSetup.reset();
    errorEn(configurar ? fSetup : fLogin, mensaje || '');
  }

  function entrar(sesion) {
    csrf = sesion.csrf;
    q('#quien').textContent = sesion.correo;
    gate.hidden = true;
    panel.hidden = false;
    cargar();
  }

  async function enviarEntrada(form, ruta, cuerpo) {
    const boton = q('button[type="submit"]', form);
    boton.disabled = true;
    errorEn(form, '');
    try {
      const sesion = await api(ruta, { method: 'POST', body: cuerpo });
      form.reset();
      entrar(sesion);
    } catch (e) {
      errorEn(form, e.message);
      qa('input[type="password"]', form).forEach((campo) => { campo.value = ''; });
    } finally {
      boton.disabled = false;
    }
  }

  fLogin.addEventListener('submit', (e) => {
    e.preventDefault();
    const d = fLogin.elements;
    if (!d.correo.value.trim() || !d.clave.value) { errorEn(fLogin, 'Escribe tu correo y tu contraseña.'); return; }
    enviarEntrada(fLogin, '/api/auth/login', { correo: d.correo.value.trim(), clave: d.clave.value });
  });

  fSetup.addEventListener('submit', (e) => {
    e.preventDefault();
    const d = fSetup.elements;
    if (d.clave.value !== d.clave2.value) { errorEn(fSetup, 'Las contraseñas no coinciden.'); return; }
    if (d.clave.value.length < 12) { errorEn(fSetup, 'La contraseña debe tener al menos 12 caracteres.'); return; }
    enviarEntrada(fSetup, '/api/auth/configurar', { token: d.token.value.trim(), correo: d.correo.value.trim(), clave: d.clave.value });
  });

  q('#bSalir').addEventListener('click', async () => {
    try { await api('/api/auth/logout', { method: 'POST' }); } catch (e) { /* la sesión ya no existía */ }
    csrf = '';
    mostrarEntrada(false, '');
  });

  /* ---------- lista ---------- */
  let lista = [];
  let tipo = 'matricula';
  const buscar = q('#buscar');
  const filtroEstado = q('#filtroEstado');
  const avisoError = q('#avisoError');

  const fallo = (texto) => { avisoError.textContent = texto || ''; avisoError.hidden = !texto; };

  async function cargar() {
    fallo('');
    try {
      const datos = await api('/api/admin/inscripciones');
      lista = datos.inscripciones;
      if (datos.total >= datos.limite) fallo(`Se muestran los ${datos.limite} registros más recientes.`);
      pintar();
    } catch (e) {
      if (e.status !== 401) fallo(e.message);
    }
  }

  function opcionesEstado() {
    filtroEstado.replaceChildren(h('option', { value: '' }, 'Todos los estados'),
      tipo === 'matricula' && h('option', { value: 'debe' }, 'Deben matrícula'),
      ...Object.entries(ESTADOS[tipo]).map(([v, t]) => h('option', { value: v }, t)));
  }

  function pintar() {
    q('#nMatricula').textContent = String(lista.filter((r) => r.tipo === 'matricula').length);
    q('#nClase').textContent = String(lista.filter((r) => r.tipo === 'clase_gratis').length);

    const haceUnAno = Date.now() - 365 * 24 * 3600000;
    const viejas = lista.filter((r) => r.tipo === 'clase_gratis' && new Date(r.creado).getTime() < haceUnAno).length;
    const aviso = q('#avisoViejas');
    aviso.hidden = !viejas;
    aviso.textContent = viejas ? `Hay ${viejas} solicitud(es) de clase gratis con más de 12 meses. La política de datos pide eliminarlas: revísalas y bórralas.` : '';

    const deben = lista.filter((r) => r.debe_matricula).length;
    const avisoDeben = q('#avisoDeben');
    avisoDeben.hidden = !deben || tipo !== 'matricula';
    avisoDeben.textContent = deben ? `${deben} deportista(s) deben la matrícula. Usa el filtro "Deben matrícula" para verlos.` : '';

    const esMat = tipo === 'matricula';
    q('#tablaHead').replaceChildren(
      h('th', null, esMat ? 'Deportista' : 'Interesado'), h('th', { class: 'col-sec' }, 'Programa'), h('th', { class: 'col-sec' }, 'Sede'),
      h('th', null, 'Estado'), esMat ? h('th', { class: 'col-sec' }, 'Documentos') : h('th', { class: 'col-sec' }, 'Celular'), h('th', { class: 'col-sec' }, 'Recibido'),
    );

    const texto = buscar.value.trim().toLowerCase();
    const filas = lista.filter((r) => r.tipo === tipo
      && (!filtroEstado.value || (filtroEstado.value === 'debe' ? r.debe_matricula : r.estado === filtroEstado.value))
      && (!texto || `${r.nombre} ${r.celular || ''} ${r.referencia}`.toLowerCase().includes(texto)));

    q('#tablaBody').replaceChildren(...filas.map((r) => {
      const tr = h('tr', { tabindex: '0', 'data-id': String(r.id) },
        h('td', null,
          h('span', { class: 'nombre' }, r.nombre),
          r.es_menor && h('span', { class: 'chip chip--menor' }, 'Menor'),
          r.posible_duplicado && h('span', { class: 'chip chip--dup', title: 'Hay otra matrícula con el mismo documento' }, 'Duplicado'),
          r.debe_matricula && h('span', { class: 'chip chip--debe' }, 'Debe matrícula'),
          h('span', { class: 'ref' }, `${r.referencia}${r.origen === 'admin' ? ' · creado por el club' : ''}`)),
        h('td', { class: 'col-sec' }, PROGRAMAS[r.programa] || r.programa),
        h('td', { class: 'col-sec' }, SEDES[r.sede] || r.sede),
        h('td', null, h('span', { class: `chip chip--${r.estado}` }, ESTADOS[r.tipo][r.estado] || r.estado)),
        h('td', { class: 'col-sec num' }, esMat ? `${r.documentos_recibidos} / ${Object.keys(DOCUMENTOS).length}` : (r.celular || '')),
        h('td', { class: 'col-sec num' }, dia(r.creado)));
      return tr;
    }));
    q('#vacio').hidden = filas.length > 0;
  }

  qa('.tabs button').forEach((b) => b.addEventListener('click', () => {
    tipo = b.dataset.tipo;
    qa('.tabs button').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    opcionesEstado();
    pintar();
  }));
  buscar.addEventListener('input', pintar);
  filtroEstado.addEventListener('change', pintar);
  const abrirFila = (e) => {
    const tr = e.target instanceof Element ? e.target.closest('tr[data-id]') : null;
    if (tr && (e.type === 'click' || e.key === 'Enter')) abrirFicha(Number(tr.dataset.id));
  };
  q('#tablaBody').addEventListener('click', abrirFila);
  q('#tablaBody').addEventListener('keydown', abrirFila);

  /* ---------- ficha: ver, crear y editar ---------- */
  const dFicha = q('#dFicha');
  const fFicha = q('#fFicha');
  const cuerpoFicha = q('#fichaCuerpo');
  const errorFicha = q('#fichaError');
  let actual = null; // registro abierto, o null si se está creando

  function control([nombre, etiqueta, clase, opciones], valor) {
    let campo;
    const v = valor === undefined || valor === null ? '' : String(valor);
    if (clase === 'select') {
      campo = h('select', { name: nombre }, !('' in opciones) && h('option', { value: '' }, '—'),
        ...Object.entries(opciones).map(([val, txt]) => h('option', { value: val }, txt)));
      campo.value = v;
    } else if (clase === 'area') {
      campo = h('textarea', { name: nombre, rows: '3', maxlength: '2000' });
      campo.value = v;
    } else {
      campo = h('input', { name: nombre, type: clase || 'text', maxlength: clase === 'date' || clase === 'number' ? null : '254', autocomplete: 'off', value: v });
    }
    return h('label', { class: clase === 'area' ? 'ancho' : '', 'data-campo': nombre }, etiqueta, campo);
  }

  function armarFicha(tipoFicha, registro) {
    const datos = registro ? registro.datos : {};
    const partes = FICHA[tipoFicha].map(([titulo, campos]) => h('section', { class: 'sec' },
      h('p', { class: 'sec__t' }, titulo),
      h('div', { class: 'sec__grid' }, campos.map((c) => control(c, datos[c[0]])))));

    if (registro) {
      const estado = h('select', { name: 'estado' }, ...Object.entries(ESTADOS[tipoFicha]).map(([v, t]) => h('option', { value: v }, t)));
      estado.value = registro.estado;
      const notas = h('textarea', { name: 'notas', rows: '3', maxlength: '2000' });
      notas.value = registro.notas || '';
      partes.push(h('section', { class: 'sec' },
        h('p', { class: 'sec__t' }, 'Gestión del club'),
        h('div', { class: 'sec__grid' }, h('label', { 'data-campo': 'estado' }, 'Estado', estado)),
        tipoFicha === 'matricula' && h('label', { class: 'casilla casilla--pago' },
          h('input', { type: 'checkbox', name: 'matricula_pagada', checked: registro.matricula_pagada }),
          'Matrícula pagada (si no está marcada, aparece como "Debe matrícula")'),
        tipoFicha === 'matricula' && h('div', { class: 'docs' }, Object.entries(DOCUMENTOS).map(([clave, texto]) => h('label', { class: 'casilla' },
          h('input', { type: 'checkbox', name: `doc_${clave}`, checked: registro.documentos[clave] }), texto))),
        h('label', { 'data-campo': 'notas' }, 'Notas internas', notas)));

      const a = registro.aceptaciones || {};
      const c = registro.consentimiento;
      const dato = (t, v) => h('div', null, h('dt', null, t), h('dd', null, v));
      partes.push(h('section', { class: 'sec' },
        h('p', { class: 'sec__t' }, 'Prueba de la autorización'),
        h('dl', { class: 'prueba' },
          dato('Origen', registro.origen === 'web' ? 'Formulario web' : 'Creado por el club (autorización física)'),
          c && dato('Fecha de aceptación', fecha(c.fecha)),
          c && dato('Política de datos', `versión ${c.politica}`),
          c && c.reglamento && dato('Reglamento', `versión ${c.reglamento}`),
          c && c.instructivo && dato('Instructivo', `versión ${c.instructivo}`),
          a.firma_nombre && dato('Firmó', `${a.firma_nombre} · doc. ${a.firma_documento || ''}`),
          tipoFicha === 'matricula' && c && dato('Uso de imagen', a.autoriza_imagen ? 'Autorizado' : 'No autorizado'),
          registro.es_menor && c && dato('Menor', 'Autorizó su representante legal; el menor fue escuchado'),
          dato('Última actualización', fecha(registro.actualizado)))));
    } else {
      partes.push(h('section', { class: 'sec' },
        h('label', { class: 'casilla', 'data-campo': 'autorizacion_fisica' },
          h('input', { type: 'checkbox', name: 'autorizacion_fisica' }),
          'Tengo la autorización de tratamiento de datos y el reglamento firmados por el titular o su acudiente.')));
    }
    cuerpoFicha.replaceChildren(...partes);
  }

  function errorDeFicha(texto, errores) {
    qa('.malo', cuerpoFicha).forEach((el) => { el.classList.remove('malo'); const m = q('.malo__msg', el); if (m) m.remove(); });
    errorFicha.textContent = texto || '';
    errorFicha.hidden = !texto;
    let primero = null;
    Object.entries(errores || {}).forEach(([nombre, mensaje]) => {
      const caja = q(`[data-campo="${nombre}"]`, cuerpoFicha);
      if (!caja) return;
      caja.classList.add('malo');
      caja.append(h('span', { class: 'malo__msg' }, mensaje));
      if (!primero) primero = caja;
    });
    if (primero) primero.scrollIntoView({ block: 'center' });
  }

  async function abrirFicha(id) {
    fallo('');
    try {
      const { inscripcion } = await api(`/api/admin/inscripciones/${id}`);
      actual = inscripcion;
      q('#fichaTitulo').textContent = `${inscripcion.tipo === 'matricula' ? 'Matrícula' : 'Clase gratis'} · ${inscripcion.referencia}`;
      armarFicha(inscripcion.tipo, inscripcion);
      q('#bEliminar').hidden = false;
      q('#bDescargar').hidden = false;
      errorDeFicha('');
      dFicha.showModal();
    } catch (e) {
      if (e.status !== 401) fallo(e.message);
      if (e.status === 404) cargar();
    }
  }

  q('#bNuevo').addEventListener('click', () => {
    actual = null;
    q('#fichaTitulo').textContent = tipo === 'matricula' ? 'Nueva matrícula' : 'Nueva clase gratis';
    armarFicha(tipo, null);
    q('#bEliminar').hidden = true;
    q('#bDescargar').hidden = true;
    errorDeFicha('');
    dFicha.showModal();
  });

  fFicha.addEventListener('submit', async (e) => {
    e.preventDefault();
    const tipoFicha = actual ? actual.tipo : tipo;
    const datos = {};
    FICHA[tipoFicha].forEach(([, campos]) => campos.forEach(([nombre, , clase]) => {
      const valor = fFicha.elements[nombre].value.trim();
      if (valor) datos[nombre] = clase === 'number' ? Number(valor) : valor;
    }));

    const boton = q('#bGuardar');
    boton.disabled = true;
    try {
      if (actual) {
        const documentos = {};
        Object.keys(DOCUMENTOS).forEach((d) => { const c = fFicha.elements[`doc_${d}`]; documentos[d] = !!(c && c.checked); });
        await api(`/api/admin/inscripciones/${actual.id}`, {
          method: 'PUT',
          body: {
            datos, estado: fFicha.elements.estado.value, notas: fFicha.elements.notas.value, documentos,
            matricula_pagada: !!(fFicha.elements.matricula_pagada && fFicha.elements.matricula_pagada.checked),
          },
        });
      } else {
        await api('/api/admin/inscripciones', {
          method: 'POST',
          body: { tipo: tipoFicha, datos, autorizacion_fisica: fFicha.elements.autorizacion_fisica.checked },
        });
      }
      dFicha.close();
      cargar();
    } catch (err) {
      errorDeFicha(err.message, err.errores);
    } finally {
      boton.disabled = false;
    }
  });

  function descargar(nombre, tipoMime, contenido) {
    const url = URL.createObjectURL(new Blob([contenido], { type: tipoMime }));
    const a = h('a', { href: url, download: nombre });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // Derecho de acceso: copia de todo lo que el club tiene de una persona.
  q('#bDescargar').addEventListener('click', () => {
    if (actual) descargar(`datos-${actual.referencia}.json`, 'application/json', JSON.stringify(actual, null, 2));
  });

  /* ---------- eliminar ---------- */
  const dEliminar = q('#dEliminar');
  const fEliminar = q('#fEliminar');
  q('#bEliminar').addEventListener('click', () => {
    if (!actual) return;
    const d = actual.datos;
    q('#elimNombre').textContent = actual.tipo === 'matricula' ? `${d.nombres} ${d.apellidos}` : d.nombre;
    fEliminar.reset();
    dEliminar.showModal();
  });
  fEliminar.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (fEliminar.elements.confirmar.value.trim().toUpperCase() !== 'ELIMINAR' || !actual) { fEliminar.elements.confirmar.focus(); return; }
    try {
      await api(`/api/admin/inscripciones/${actual.id}`, { method: 'DELETE' });
      dEliminar.close();
      dFicha.close();
      cargar();
    } catch (err) {
      dEliminar.close();
      errorDeFicha(err.message);
    }
  });

  /* ---------- exportar ---------- */
  // Una celda que empieza por = + - @ podría ejecutarse como fórmula en Excel: se neutraliza.
  const celda = (v) => {
    let t = v === undefined || v === null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`;
    return `"${t.replace(/"/g, '""')}"`;
  };
  q('#bExportar').addEventListener('click', async () => {
    if (!window.confirm('El archivo tendrá datos personales de deportistas y menores de edad. Guárdalo en un lugar seguro, no lo compartas por chats ni correo, y bórralo cuando termines. ¿Exportar?')) return;
    fallo('');
    try {
      const { inscripciones } = await api('/api/admin/inscripciones?completo=1');
      const filas = inscripciones.filter((r) => r.tipo === tipo);
      const campos = FICHA[tipo].flatMap(([, c]) => c.map(([nombre]) => nombre));
      const docs = tipo === 'matricula' ? Object.keys(DOCUMENTOS) : [];
      const lineas = [['referencia', 'estado', 'recibido', ...campos, ...docs.map((d) => `doc_${d}`), 'matricula_pagada', 'uso_imagen', 'notas'].map(celda).join(';')];
      filas.forEach((r) => lineas.push([
        r.referencia, ESTADOS[r.tipo][r.estado], r.creado, ...campos.map((c) => r.datos[c]),
        ...docs.map((d) => (r.documentos[d] ? 'sí' : 'no')), r.tipo === 'matricula' ? (r.matricula_pagada ? 'sí' : 'no') : '', r.aceptaciones.autoriza_imagen ? 'sí' : 'no', r.notas,
      ].map(celda).join(';')));
      descargar(`${tipo}-${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv;charset=utf-8', String.fromCharCode(0xFEFF) + lineas.join(String.fromCharCode(13, 10)));
    } catch (e) {
      if (e.status !== 401) fallo(e.message);
    }
  });

  /* ---------- contraseña ---------- */
  const dClave = q('#dClave');
  const fClave = q('#fClave');
  q('#bClave').addEventListener('click', () => { fClave.reset(); errorEn(fClave, ''); dClave.showModal(); });
  fClave.addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = fClave.elements;
    if (d.nueva.value !== d.nueva2.value) { errorEn(fClave, 'Las contraseñas nuevas no coinciden.'); return; }
    try {
      const r = await api('/api/auth/clave', { method: 'POST', body: { actual: d.actual.value, nueva: d.nueva.value } });
      csrf = r.csrf;
      fClave.reset();
      dClave.close();
    } catch (err) {
      errorEn(fClave, err.message);
    }
  });

  /* ---------- actividad ---------- */
  q('#bAuditoria').addEventListener('click', async () => {
    try {
      const { eventos } = await api('/api/admin/auditoria');
      q('#audBody').replaceChildren(...eventos.map((ev) => h('tr', null,
        h('td', { class: 'num' }, fecha(ev.fecha)), h('td', null, ACCIONES[ev.accion] || ev.accion),
        h('td', { class: 'num' }, ev.inscripcion_id ? `#${ev.inscripcion_id}` : ''), h('td', null, ev.detalle || ''))));
      q('#dAuditoria').showModal();
    } catch (e) {
      if (e.status !== 401) fallo(e.message);
    }
  });

  document.addEventListener('click', (e) => {
    const boton = e.target instanceof Element ? e.target.closest('[data-cerrar]') : null;
    if (boton) boton.closest('dialog').close();
  });

  /* ---------- arranque ---------- */
  opcionesEstado();
  if (location.protocol === 'file:') {
    mostrarEntrada(false, 'Abre el panel desde el sitio (npm run dev o la dirección pública), no como archivo.');
  } else {
    api('/api/auth/sesion')
      .then((s) => (s.autenticado ? entrar(s) : mostrarEntrada(s.configurar, '')))
      .catch((e) => mostrarEntrada(false, e.message));
  }
})();
