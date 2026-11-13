# Base de datos para el CRUD de usuarios

| Recurso | Configuración |
| --- | --- |
| Motor | Cloudflare D1 (SQLite) |
| Base de producción | `sermasclubnatacion-db` |
| ID | `a275598c-c0c0-48fe-a297-f1b78fb47c9e` |
| Worker | `sermasclubnatacion` |
| Binding en el backend | `env.DB` |
| Migraciones | `migrations/` |
| Registro de migraciones aplicadas | `d1_migrations` |

El ID de la base es configuración pública, no una contraseña. El Worker accede
mediante el binding de Cloudflare; el navegador no se conecta directamente a D1.

## Secretos y datos privados

- `.env` y `.dev.vars` están excluidos de Git; `.env.example` contiene únicamente
  la URL pública del sitio. Ninguna contraseña de D1 es necesaria.
- Los secretos futuros del backend se configuran localmente en `.dev.vars` y en
  producción en **Worker → Settings → Variables and Secrets → Secret**.
- `public/` contiene archivos accesibles en Internet. Los datos personales,
  credenciales, copias y exportaciones deben permanecer fuera de esa carpeta.
- `backups/`, `exports/` y archivos SQLite están ignorados por Git.
- Los logs del Worker ocultan los parámetros de la URL (`redact_query_string`).
- La comprobación `/api/health` no devuelve filas, errores SQL ni datos personales.
  El CRUD deberá incorporar autenticación y autorización antes de exponer operaciones
  sobre usuarios; actualmente esas rutas devuelven 404.

## Tabla inicial: users

| Columna | Tipo y comportamiento |
| --- | --- |
| `id` | Entero autoincremental, clave primaria |
| `name` | Nombre obligatorio, entre 1 y 120 caracteres sin contar espacios exteriores |
| `email` | Correo obligatorio y único sin distinguir mayúsculas ASCII; hasta 254 caracteres |
| `phone` | Teléfono opcional, hasta 30 caracteres |
| `is_active` | `1` activo, `0` inactivo; inicia en `1` |
| `created_at` | Fecha UTC de creación en formato ISO |
| `updated_at` | Fecha UTC; se actualiza automáticamente al editar los campos del usuario |

La migración `0001_create_users.sql` incluye un índice para listar por fecha.
La base se deja vacía: no hay cuentas de acceso, contraseñas ni usuarios de ejemplo.
El formato de correo, normalización de espacios y demás reglas del formulario se
validarán en el futuro CRUD, además de las restricciones existentes en SQL.

## Desarrollo local

```powershell
npm ci
npm run dev
```

Este comando crea/migra la D1 **local** en `.wrangler/state/` y arranca el Worker.
Los datos locales están ignorados por Git y separados de producción. No se requieren
tokens ni contraseñas para el desarrollo local.

La ruta `GET /api/health` comprueba que existe la tabla mediante una consulta sin
filas. Devuelve `{"status":"ok","database":"connected"}` cuando D1 está lista,
o HTTP 503 si la conexión o el esquema no están disponibles. `HEAD` no devuelve
cuerpo y las respuestas de comprobación no se guardan en caché.

## Cambios de esquema y despliegue

```powershell
npm run db:new -- describe_el_cambio
# Edita el nuevo archivo SQL en migrations/.
npm run db:migrate:local
npm run check
git add migrations src tests docs package.json package-lock.json wrangler.jsonc
git commit -m "Describe el cambio de base de datos"
git push origin main
```

Workers Builds ejecuta `npm run build` y después `npm run deploy`. Este último
aplica las migraciones pendientes a producción antes de publicar el Worker. Una
migración ya registrada no vuelve a ejecutarse. Crea archivos nuevos para los
siguientes cambios, conservando los que ya se aplicaron.

Para mantenimiento manual desde este equipo, autoriza Wrangler con
`npx wrangler login` y usa:

```powershell
npm run db:migrations       # lista migraciones pendientes en producción
npm run db:migrate:remote   # aplica migraciones pendientes en producción
```

## Punto de partida del CRUD

`src/worker.mjs` recibe `/api/*`; las páginas continúan servidas por `ASSETS`.
El siguiente paso es implementar las operaciones de usuarios con consultas
preparadas `env.DB.prepare(...).bind(...)`, autenticación y los formularios.
Por ahora `/api/users` devuelve HTTP 404 y no expone datos.

Documentación: [D1](https://developers.cloudflare.com/d1/get-started/),
[migraciones](https://developers.cloudflare.com/d1/reference/migrations/) y
[bindings de assets](https://developers.cloudflare.com/workers/static-assets/binding/).
