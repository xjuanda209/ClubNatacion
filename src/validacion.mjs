/**
 * Validación en el servidor de todo lo que llega de los formularios.
 * El navegador también valida, pero solo esta capa cuenta: nunca se guarda
 * un campo que no esté en estas listas ni un valor que no pase su regla.
 */

export const PROGRAMAS = ['cat1', 'cat2', 'cat3', 'cat4', 'master', 'triatlon', 'asesoria', 'orientacion'];
export const SEDES = ['medellin', 'envigado', 'cualquiera'];
export const TIPOS_DOCUMENTO = ['RC', 'TI', 'CC', 'CE', 'PA', 'PPT'];
export const REGIMENES = ['contributivo', 'subsidiado', 'especial', 'otro'];
export const ESTADOS = {
  matricula: ['pendiente', 'activo', 'retirado'],
  clase_gratis: ['nueva', 'contactada', 'agendada', 'asistio', 'descartada'],
};
/** Documentos del instructivo de matrícula que el administrador va marcando como recibidos. */
export const DOCUMENTOS_REQUERIDOS = [
  'hoja_vida', 'identidad', 'eps', 'identidad_acudiente', 'paz_salvo', 'pago', 'certificado_medico', 'foto', 'reglamento_firmado',
];

const CONTROL = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u200B-\u200F\u2028-\u202F\u2060-\u206F\uFEFF]/g;
const limpiar = (v) => v.normalize('NFC').replace(CONTROL, '').replace(/\s+/g, ' ').trim();
const limpiarLargo = (v) => v.normalize('NFC').replace(CONTROL, '').replace(/\r\n?/g, '\n')
  .replace(/[^\S\n]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

/** Fecha de hoy en Colombia (UTC−5) como AAAA-MM-DD. */
export const hoyColombia = (ahora = Date.now()) => new Date(ahora - 5 * 3600000).toISOString().slice(0, 10);

export function edadEn(fechaNacimiento, hoy = hoyColombia()) {
  const [a, m, d] = fechaNacimiento.split('-').map(Number);
  const [ha, hm, hd] = hoy.split('-').map(Number);
  return ha - a - (hm < m || (hm === m && hd < d) ? 1 : 0);
}

/* Cada regla devuelve [valor, error]. */
const reglas = {
  nombre: (v) => {
    const t = limpiar(v);
    return /^[\p{L}\p{M}][\p{L}\p{M} .'’-]{1,79}$/u.test(t) ? [t, ''] : [t, 'Escribe un nombre válido (solo letras).'];
  },
  texto: (min, max) => (v) => {
    const t = limpiar(v);
    if (/[<>]/.test(t)) return [t, 'No uses los símbolos < ni >.'];
    return t.length >= min && t.length <= max ? [t, ''] : [t, `Debe tener entre ${min} y ${max} caracteres.`];
  },
  parrafo: (max) => (v) => {
    const t = limpiarLargo(v);
    if (/[<>]/.test(t)) return [t, 'No uses los símbolos < ni >.'];
    return t.length <= max ? [t, ''] : [t, `Máximo ${max} caracteres.`];
  },
  documento: (v) => {
    const t = limpiar(v).replace(/[\s.]/g, '').toUpperCase();
    return /^[A-Z0-9-]{4,20}$/.test(t) ? [t, ''] : [t, 'Escribe el número del documento sin puntos.'];
  },
  telefono: (v) => {
    const t = limpiar(v).replace(/[\s().-]/g, '');
    return /^\+?\d{7,15}$/.test(t) ? [t, ''] : [t, 'Escribe un número de celular válido.'];
  },
  correo: (v) => {
    const t = limpiar(v).toLowerCase();
    return t.length <= 254 && /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[a-z]{2,}$/.test(t) ? [t, ''] : [t, 'Escribe un correo válido.'];
  },
  fechaNacimiento: (v) => {
    const t = limpiar(v);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return [t, 'Escribe la fecha de nacimiento.'];
    const f = new Date(`${t}T00:00:00Z`);
    if (Number.isNaN(f.getTime()) || f.toISOString().slice(0, 10) !== t) return [t, 'Esa fecha no existe.'];
    const edad = edadEn(t);
    return edad >= 3 && edad <= 100 ? [t, ''] : [t, 'La edad debe estar entre 3 y 100 años.'];
  },
  lista: (opciones) => (v) => (opciones.includes(v) ? [v, ''] : [v, 'Elige una opción.']),
};

/** @typedef {{regla: (v: string) => [string, string], opcional?: boolean}} Campo */

/** @type {Record<string, Campo>} */
const CAMPOS_DEPORTISTA = {
  nombres: { regla: reglas.nombre },
  apellidos: { regla: reglas.nombre },
  tipo_documento: { regla: reglas.lista(TIPOS_DOCUMENTO) },
  numero_documento: { regla: reglas.documento },
  fecha_nacimiento: { regla: reglas.fechaNacimiento },
  celular: { regla: reglas.telefono },
  correo: { regla: reglas.correo },
  direccion: { regla: reglas.texto(5, 120) },
  ciudad: { regla: reglas.texto(2, 60) },
  programa: { regla: reglas.lista(PROGRAMAS) },
  sede: { regla: reglas.lista(SEDES) },
  eps: { regla: reglas.texto(2, 80) },
  regimen: { regla: reglas.lista(REGIMENES), opcional: true },
  condiciones_salud: { regla: reglas.parrafo(600), opcional: true },
  emergencia_nombre: { regla: reglas.nombre },
  emergencia_telefono: { regla: reglas.telefono },
  club_anterior: { regla: reglas.texto(2, 80), opcional: true },
};

/** @type {Record<string, Campo>} */
const CAMPOS_ACUDIENTE = {
  acudiente_nombre: { regla: reglas.nombre },
  acudiente_tipo_documento: { regla: reglas.lista(['CC', 'CE', 'PA', 'PPT']) },
  acudiente_numero_documento: { regla: reglas.documento },
  acudiente_parentesco: { regla: reglas.texto(3, 40) },
  acudiente_celular: { regla: reglas.telefono },
  acudiente_correo: { regla: reglas.correo },
};

/** @type {Record<string, Campo>} */
const CAMPOS_CLASE = {
  nombre: { regla: reglas.nombre },
  celular: { regla: reglas.telefono },
  correo: { regla: reglas.correo, opcional: true },
  programa: { regla: reglas.lista(PROGRAMAS) },
  sede: { regla: reglas.lista(SEDES) },
  mensaje: { regla: reglas.parrafo(500), opcional: true },
};

function aplicar(campos, entrada, datos, errores) {
  for (const [nombre, campo] of Object.entries(campos)) {
    const bruto = entrada[nombre];
    if (bruto === undefined || bruto === null || bruto === '') {
      if (!campo.opcional) errores[nombre] = 'Este dato es obligatorio.';
      continue;
    }
    if (typeof bruto !== 'string' || bruto.length > 2000) { errores[nombre] = 'Dato no válido.'; continue; }
    const [valor, error] = campo.regla(bruto);
    if (error) errores[nombre] = error;
    else if (valor !== '') datos[nombre] = valor;
    else if (!campo.opcional) errores[nombre] = 'Este dato es obligatorio.';
  }
}

const exigirSi = (entrada, nombre, errores, mensaje) => {
  if (entrada[nombre] !== true) errores[nombre] = mensaje;
};

/**
 * Matrícula. Con admin=true no se exigen las casillas de aceptación
 * (el administrador declara aparte que tiene la autorización firmada).
 */
export function validarMatricula(entrada, { admin = false } = {}) {
  const datos = {};
  const errores = {};
  aplicar(CAMPOS_DEPORTISTA, entrada, datos, errores);

  const esMenor = datos.fecha_nacimiento ? edadEn(datos.fecha_nacimiento) < 18 : false;
  if (esMenor) {
    aplicar(CAMPOS_ACUDIENTE, entrada, datos, errores);
    if (datos.tipo_documento === 'CC') errores.tipo_documento = 'Un menor de edad no tiene cédula de ciudadanía.';
  }

  const aceptaciones = {};
  if (!admin) {
    exigirSi(entrada, 'acepta_reglamento', errores, 'Debes leer y aceptar el reglamento.');
    exigirSi(entrada, 'acepta_instructivo', errores, 'Debes leer y aceptar el instructivo de matrícula.');
    exigirSi(entrada, 'autoriza_datos', errores, 'Sin esta autorización no podemos recibir la matrícula.');
    exigirSi(entrada, 'autoriza_datos_sensibles', errores, 'Necesitamos tu autorización expresa para los datos de salud.');
    if (esMenor) {
      exigirSi(entrada, 'declara_representante', errores, 'Debe diligenciarlo el padre, la madre o el representante legal.');
      exigirSi(entrada, 'menor_escuchado', errores, 'Confirma que el menor conoce y está de acuerdo con su matrícula.');
    }
    const firma = typeof entrada.firma_nombre === 'string' ? reglas.nombre(entrada.firma_nombre) : ['', 'x'];
    if (firma[1]) errores.firma_nombre = 'Escribe tu nombre completo como firma.';
    Object.assign(aceptaciones, {
      acepta_reglamento: true,
      acepta_instructivo: true,
      autoriza_datos: true,
      autoriza_datos_sensibles: true,
      declara_representante: esMenor,
      menor_escuchado: esMenor,
      autoriza_imagen: entrada.autoriza_imagen === true,
      firma_nombre: firma[0],
      firma_documento: esMenor ? datos.acudiente_numero_documento : datos.numero_documento,
    });
  }
  return { ok: Object.keys(errores).length === 0, datos, aceptaciones, esMenor, errores };
}

export function validarClaseGratis(entrada, { admin = false } = {}) {
  const datos = {};
  const errores = {};
  aplicar(CAMPOS_CLASE, entrada, datos, errores);

  const edad = Number(entrada.edad);
  if (!Number.isInteger(edad) || edad < 3 || edad > 100) errores.edad = 'Escribe una edad entre 3 y 100 años.';
  else datos.edad = edad;
  const esMenor = datos.edad !== undefined && datos.edad < 18;
  if (esMenor) aplicar({ acudiente_nombre: { regla: reglas.nombre } }, entrada, datos, errores);

  const aceptaciones = {};
  if (!admin) {
    exigirSi(entrada, 'autoriza_datos', errores, 'Sin esta autorización no podemos contactarte.');
    if (esMenor) exigirSi(entrada, 'declara_representante', errores, 'Debe diligenciarlo el padre, la madre o el representante legal.');
    Object.assign(aceptaciones, { autoriza_datos: true, declara_representante: esMenor });
  }
  return { ok: Object.keys(errores).length === 0, datos, aceptaciones, esMenor, errores };
}

/** Campos que solo edita el administrador. */
export function validarGestion(entrada, tipo) {
  const errores = {};
  const gestion = {};
  if (!ESTADOS[tipo].includes(entrada.estado)) errores.estado = 'Estado no válido.';
  else gestion.estado = entrada.estado;

  const [notas, errorNotas] = reglas.parrafo(2000)(typeof entrada.notas === 'string' ? entrada.notas : '');
  if (errorNotas) errores.notas = errorNotas;
  gestion.notas = notas;

  gestion.documentos = {};
  const marcados = entrada.documentos && typeof entrada.documentos === 'object' ? entrada.documentos : {};
  for (const doc of DOCUMENTOS_REQUERIDOS) gestion.documentos[doc] = marcados[doc] === true;
  gestion.matricula_pagada = tipo === 'matricula' && entrada.matricula_pagada === true;
  return { ok: Object.keys(errores).length === 0, gestion, errores };
}

export const validarCorreo = (v) => (typeof v === 'string' ? reglas.correo(v) : ['', 'Escribe un correo válido.']);
