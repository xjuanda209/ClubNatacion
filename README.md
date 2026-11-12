# SER MÁS Club Natación

Sitio estático de seis páginas, con HTML, CSS y JavaScript sin framework.
Se publica en el Worker existente **sermasclubnatacion**:
https://sermasclubnatacion.xjuancho16.workers.dev

## Estructura

- `public/`: páginas, estilos, scripts, cabeceras y las 51 imágenes usadas por el sitio.
- `scripts/build.mjs`: genera `dist/` con los archivos publicables y comprueba las imágenes.
- `wrangler.jsonc`: configuración del Worker existente y del servidor local.
- `docs/`: procedencia de las imágenes.
- `dist/`, `node_modules/`, `material-local/` y `Piscinas 2/`: archivos locales excluidos de Git.

Las imágenes sin usar se conservan en `material-local/imagenes-sin-usar/`.
Las fichas del cliente, las capturas y el logo suelto tampoco se suben a GitHub.

## Desarrollo y comprobación

Usa Node.js 24 LTS (Wrangler requiere al menos 22.12) y npm:

```powershell
npm ci
npm run dev
```

Abre http://127.0.0.1:8787. Edita los archivos de `public/`; Wrangler vuelve a compilar
cuando cambian. No edites `dist/` porque se regenera.

```powershell
npm run build    # genera dist/
npm run check    # compila y valida el despliegue sin publicar
```

La URL pública ya está configurada. Para cambiarla, copia `.env.example` a `.env`
y ajusta `SITE_URL`. Es opcional; no se necesitan secretos para compilar.

## Publicar cambios

El remoto es https://github.com/xjuanda209/ClubNatacion, rama `main`.
Una vez conectada la integración de Workers Builds descrita en [DEPLOY.md](DEPLOY.md):

```powershell
git add public scripts package.json package-lock.json wrangler.jsonc README.md DEPLOY.md docs
git diff --cached --stat
git commit -m "Describe el cambio"
git push origin main
```

Cloudflare compila y publica cada push a `main`. No subas `dist/` manualmente.
Para publicar directamente desde este equipo:

```powershell
npx wrangler login  # solo la primera vez; autoriza desde el navegador
npm run deploy
```

Se conserva `X-Robots-Tag: noindex`, como en el sitio actual. `npm run build:produccion`
genera una versión indexable; para adoptarla en despliegues automáticos, cambia el
comando de compilación en Cloudflare y en `wrangler.jsonc` a `npm run build:produccion`.

El CRUD y la base de datos quedan para la siguiente etapa.
