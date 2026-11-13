-- Base inicial para el futuro CRUD. No crea cuentas ni datos de demostración.
CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
    email TEXT NOT NULL COLLATE NOCASE UNIQUE
        CHECK (length(trim(email)) BETWEEN 3 AND 254),
    phone TEXT CHECK (phone IS NULL OR length(phone) <= 30),
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_users_created_at ON users (created_at DESC, id DESC);

-- La segunda actualización solo cambia updated_at, por lo que no reejecuta este trigger.
CREATE TRIGGER users_set_updated_at
AFTER UPDATE OF name, email, phone, is_active ON users
FOR EACH ROW
BEGIN
    UPDATE users
    SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = NEW.id;
END;
