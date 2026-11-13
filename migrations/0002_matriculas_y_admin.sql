-- Matrículas, clases gratis de bienvenida y panel del administrador.
-- Los datos personales (nombres, documentos, salud, contacto) NO se guardan en
-- columnas legibles: van cifrados (AES-256-GCM) dentro de datos_cifrados.
-- En claro solo queda lo necesario para listar y para probar la autorización.

-- Un único administrador (id siempre 1).
CREATE TABLE admins (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    correo TEXT NOT NULL COLLATE NOCASE CHECK (length(correo) BETWEEN 5 AND 254),
    clave_hash TEXT NOT NULL,
    clave_sal TEXT NOT NULL,
    clave_iteraciones INTEGER NOT NULL CHECK (clave_iteraciones >= 10000),
    creado TEXT NOT NULL,
    clave_cambiada TEXT NOT NULL
);

-- Sesiones: se guarda el SHA-256 del token, nunca el token.
CREATE TABLE sesiones (
    token_hash TEXT PRIMARY KEY,
    admin_id INTEGER NOT NULL REFERENCES admins (id) ON DELETE CASCADE,
    csrf TEXT NOT NULL,
    creada INTEGER NOT NULL,
    ultimo_uso INTEGER NOT NULL,
    expira INTEGER NOT NULL,
    ip_hash TEXT
) WITHOUT ROWID;

CREATE TABLE inscripciones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    public_id TEXT NOT NULL UNIQUE,
    tipo TEXT NOT NULL CHECK (tipo IN ('matricula', 'clase_gratis')),
    estado TEXT NOT NULL CHECK (estado IN (
        'pendiente', 'activo', 'retirado',
        'nueva', 'contactada', 'agendada', 'asistio', 'descartada'
    )),
    es_menor INTEGER NOT NULL CHECK (es_menor IN (0, 1)),
    -- HMAC del documento del deportista: detecta duplicados sin exponer el número.
    doc_hmac TEXT,
    datos_cifrados TEXT NOT NULL,
    origen TEXT NOT NULL CHECK (origen IN ('web', 'admin')),
    -- Prueba de la autorización (Ley 1581 de 2012, Decreto 1377 de 2013 art. 8).
    consentimiento_fecha TEXT,
    politica_version TEXT,
    politica_hash TEXT,
    reglamento_version TEXT,
    reglamento_hash TEXT,
    instructivo_version TEXT,
    instructivo_hash TEXT,
    consentimiento_ip_hash TEXT,
    consentimiento_agente TEXT,
    creado TEXT NOT NULL,
    actualizado TEXT NOT NULL
);

CREATE INDEX idx_inscripciones_tipo ON inscripciones (tipo, creado DESC, id DESC);
CREATE INDEX idx_inscripciones_doc ON inscripciones (doc_hmac) WHERE doc_hmac IS NOT NULL;

-- Registro de lo que hace el administrador. Nunca contiene datos personales.
CREATE TABLE auditoria (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fecha TEXT NOT NULL,
    accion TEXT NOT NULL,
    inscripcion_id INTEGER,
    ip_hash TEXT,
    detalle TEXT
);

CREATE INDEX idx_auditoria_fecha ON auditoria (id DESC);

-- Límite de intentos (inicio de sesión y formularios públicos).
CREATE TABLE limites (
    clave TEXT PRIMARY KEY,
    inicio INTEGER NOT NULL,
    cuenta INTEGER NOT NULL
) WITHOUT ROWID;
