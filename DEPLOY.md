# Despliegue en Cloudflare Workers

Worker: `sermasclubnatacion` · Cuenta: `649998aad1a7c374fbcd7820e820c434`.
Sitio: https://sermasclubnatacion.xjuancho16.workers.dev
Repositorio existente: https://github.com/xjuanda209/ClubNatacion

## Estado actual

La integración de **Workers Builds está conectada** desde el 12 de noviembre de 2026:
`xjuanda209/ClubNatacion`, rama `main`, publica en el Worker existente
`sermasclubnatacion`. Los builds están habilitados; las vistas previas de otras
ramas están desactivadas. La aplicación de GitHub tiene acceso únicamente a
`ClubNatacion`. El token de compilación fue generado y almacenado por Cloudflare.

Cada `git push origin main` inicia una compilación y despliegue. Puedes revisar el
resultado en **Workers & Pages → sermasclubnatacion → Deployments**.

## Referencia de la conexión (ya configurada)

En [el Worker](https://dash.cloudflare.com/649998aad1a7c374fbcd7820e820c434/workers/services/view/sermasclubnatacion/production),
abre **Settings → Builds → GitHub** (en algunas versiones aparece **Connect**).
No crees otro Worker ni un proyecto de Pages.
En GitHub selecciona **Only select repositories → xjuanda209/ClubNatacion** y
pulsa **Install & Authorize**. La aplicación es **Cloudflare Workers and Pages**;
solicita lectura de metadatos y lectura/escritura de administración, checks,
código, despliegues y pull requests para ese repositorio.

El código fuente ya está en GitHub y la autorización está completada. Tener ambas
aplicaciones conectadas a Codex es independiente de esta integración de despliegue.

| Campo | Valor |
| --- | --- |
| Proveedor | GitHub |
| Cuenta | `xjuanda209` |
| Repositorio | `ClubNatacion` |
| Rama de producción | `main` |
| Directorio raíz | `/` (raíz del repositorio) |
| Comando de compilación | `npm run build` |
| Comando de despliegue | `npm run deploy` |
| Versión de Node.js | `24` (archivo `.nvmrc`; si se solicita variable: `NODE_VERSION=24`) |
| API token | Generado automáticamente por Cloudflare |
| Despliegues de otras ramas / Previews | Desactivados para esta primera configuración |

Al reconstruir la conexión, guarda con **Connect**. Para iniciar la primera
compilación después de conectar, haz un nuevo commit y push a `main`.
Confirma que la compilación termine correctamente y que el sitio conserve las seis páginas.

El nombre en `wrangler.jsonc` coincide con el Worker existente. Se publica `dist/`
mediante **Workers Static Assets** y `src/worker.mjs` atiende el backend `/api/`.
La base D1 `sermasclubnatacion-db` está vinculada como `DB`. Cloudflare instala las dependencias desde
`package-lock.json`; el repositorio contiene los fuentes y no incluye `dist/`.

`npm run deploy` aplica las migraciones de `migrations/` en D1 antes de publicar
el Worker. Si una migración falla, el despliegue se detiene. El token de Workers
Builds necesita permisos de edición de Workers y D1; se almacena en Cloudflare.

## Comandos locales

```powershell
npm ci
npm run dev       # migra D1 local y abre http://127.0.0.1:8787
npm run build     # genera dist/
npm run check     # tipos, pruebas y validación de Wrangler sin publicar
npx wrangler login
npm run deploy    # migra D1 remota, compila y publica el Worker existente
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
