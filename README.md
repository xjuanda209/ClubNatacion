# SER MÁS Club Natación

Frontend de seis páginas en HTML, CSS y JavaScript, con backend en Cloudflare
Workers y base de datos D1 preparada para el CRUD de usuarios.
Se publica en el Worker **sermasclubnatacion**:
https://sermasclubnatacion.xjuancho16.workers.dev

## Estructura

- `public/`: páginas, estilos, scripts, cabeceras y las 51 imágenes usadas por el sitio.
- `src/worker.mjs`: backend y comprobación de D1 en `/api/health`.
- `migrations/`: cambios SQL versionados; la primera migración crea `users`.
- `tests/`: pruebas del backend.
- `scripts/build.mjs`: genera `dist/` con los archivos publicables y comprueba las imágenes.
- `wrangler.jsonc`: configuración del Worker existente y del servidor local.
- `docs/`: documentación de la base de datos y procedencia de las imágenes.
- `dist/`, `node_modules/`, `material-local/` y `Piscinas 2/`: archivos locales excluidos de Git.

Las imágenes sin usar se conservan en `material-local/imagenes-sin-usar/`.
Las fichas del cliente, las capturas y el logo suelto tampoco se suben a GitHub.

## Desarrollo y comprobación

Usa Node.js 24 LTS (Wrangler requiere al menos 22.12) y npm:

```powershell
npm ci
npm run dev
```

Abre http://127.0.0.1:8787. `npm run dev` aplica primero las migraciones a una
base local separada de producción. Edita `public/` para el sitio y `src/` para el
backend; Wrangler recarga los cambios. No edites `dist/` porque se regenera.

```powershell
npm run build    # genera dist/
npm run check    # genera tipos, ejecuta pruebas y valida sin publicar
```

La URL pública ya está configurada. Para cambiarla, copia `.env.example` a `.env`
y ajusta `SITE_URL`. Es opcional; no se necesitan secretos para compilar.

`.env` se usa para la configuración del build; el único valor que este proyecto
lleva al sitio es la URL pública `SITE_URL`. Guarda los secretos del backend en
`.dev.vars` local y como **Secrets** en Cloudflare. Ambos archivos privados están
excluidos de Git. No pongas credenciales, exportaciones ni datos de usuarios en
`public/`. Guarda las copias de la base en `backups/`, también excluida.

## Publicar cambios

El remoto es https://github.com/xjuanda209/ClubNatacion, rama `main`.
**Workers Builds ya está conectado al Worker `sermasclubnatacion`.** Cada push a
`main` compila y publica el sitio automáticamente. Configuración en [DEPLOY.md](DEPLOY.md).

```powershell
git add public src migrations tests scripts package.json package-lock.json wrangler.jsonc README.md DEPLOY.md docs
git diff --cached --stat
git commit -m "Describe el cambio"
git push origin main
```

Cloudflare compila, aplica las migraciones pendientes a D1 y publica cada push
a `main`. No subas `dist/` manualmente.
Para publicar directamente desde este equipo:

```powershell
npx wrangler login  # solo la primera vez; autoriza desde el navegador
npm run deploy
```

Se conserva `X-Robots-Tag: noindex`, como en el sitio actual. `npm run build:produccion`
genera una versión indexable; para adoptarla en despliegues automáticos, cambia el
comando de compilación en Cloudflare y en `wrangler.jsonc` a `npm run build:produccion`.

## Base de datos y siguiente etapa

D1 **sermasclubnatacion-db** está conectada como `env.DB`. `users` contiene
nombre, correo único, teléfono, estado activo y fechas. La comprobación está en
https://sermasclubnatacion.xjuancho16.workers.dev/api/health.

La base queda preparada y vacía. Los formularios, operaciones del CRUD y su
autenticación se implementarán en la siguiente etapa. Detalles y comandos en
[docs/DATABASE.md](docs/DATABASE.md).
