# Despliegue en Cloudflare Workers

Worker: `sermasclubnatacion` · Cuenta: `649998aad1a7c374fbcd7820e820c434`.
Sitio: https://sermasclubnatacion.xjuancho16.workers.dev
Repositorio existente: https://github.com/xjuanda209/ClubNatacion

## Conectar GitHub al Worker existente

En [el Worker](https://dash.cloudflare.com/649998aad1a7c374fbcd7820e820c434/workers/services/view/sermasclubnatacion/production),
abre **Settings → Builds → GitHub** (en algunas versiones aparece **Connect**).
No crees otro Worker ni un proyecto de Pages.
En GitHub selecciona **Only select repositories → xjuanda209/ClubNatacion** y
pulsa **Install & Authorize**. La aplicación es **Cloudflare Workers and Pages**;
solicita lectura de metadatos y lectura/escritura de administración, checks,
código, despliegues y pull requests para ese repositorio.

El código ya está en GitHub. La primera vinculación queda pendiente de esta
autorización: tener ambas aplicaciones conectadas a Codex no la sustituye.

| Campo | Valor |
| --- | --- |
| Proveedor | GitHub |
| Cuenta | `xjuanda209` |
| Repositorio | `ClubNatacion` |
| Rama de producción | `main` |
| Directorio raíz | `/` (raíz del repositorio) |
| Comando de compilación | `npm run build` |
| Comando de despliegue | `npx wrangler deploy` |
| Versión de Node.js | `24` (archivo `.nvmrc`; si se solicita variable: `NODE_VERSION=24`) |
| API token | Generado automáticamente por Cloudflare |
| Despliegues de otras ramas / Previews | Desactivados para esta primera configuración |

Guarda con **Connect / Save and deploy**. Si no comienza una compilación, usa
**Deployments → Retry deployment / Build** o haz un nuevo commit y push a `main`.
Confirma que la compilación termine correctamente y que el sitio conserve las seis páginas.

El nombre en `wrangler.jsonc` coincide con el Worker existente. Se publica `dist/`
mediante **Workers Static Assets**. Cloudflare instala las dependencias desde
`package-lock.json`; el repositorio contiene los fuentes y no incluye `dist/`.

## Comandos locales

```powershell
npm ci
npm run dev       # http://127.0.0.1:8787, recompila los cambios de public/
npm run build     # genera dist/
npm run check     # validación de Wrangler sin publicar
npx wrangler login
npm run deploy    # compila y publica en el Worker existente
```

No se necesitan credenciales dentro del repositorio. La conexión de las aplicaciones
de GitHub y Cloudflare en Codex es independiente de autorizar a Cloudflare para
leer el repositorio en GitHub. Los secretos futuros se guardan en Cloudflare,
**Settings → Variables and Secrets**, o en `.dev.vars` local, que está ignorado.

El sitio conserva su modo de vista previa (`noindex`). Cuando se apruebe el lanzamiento
indexable, usa `npm run build:produccion` tanto en Cloudflare como en el campo
`build.command` de `wrangler.jsonc`.

Documentación: [Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/)
y [configuración de compilación](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/).
