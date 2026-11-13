# Matrículas, panel del administrador y protección de datos

| Recurso | Configuración |
| --- | --- |
| Motor | Cloudflare D1 (SQLite) · `sermasclubnatacion-db` · binding `env.DB` |
| Backend | `src/worker.mjs` (rutas), `src/seguridad.mjs` (cifrado, sesiones), `src/validacion.mjs` (reglas), `src/legal.mjs` (versiones de los textos) |
| Migraciones | `migrations/` (la `0002` crea todo lo de esta etapa) |
| Secretos | `MASTER_KEY`, `SETUP_TOKEN` y, opcionales, `TURNSTILE_SITEKEY` / `TURNSTILE_SECRET` |

## Qué hace

- **Público** (`/inscripcion`): clase gratis de bienvenida (datos mínimos) o matrícula
  (deportista, seguridad social, acudiente si es menor, lectura y aceptación del
  reglamento y del instructivo, autorizaciones y firma con nombre).
- **Administrador** (`/admin`, una sola cuenta): listar, buscar, ver, crear, editar,
  eliminar, exportar a CSV, descargar los datos de una persona, ver quién **debe la
  matrícula** (casilla "Matrícula pagada" en la ficha y filtro "Deben matrícula"), marcar documentos
  recibidos, notas internas, registro de actividad y cambio de contraseña.
- Los PDF del instructivo (documento, EPS, certificado médico…) **no se suben al sitio**:
  se siguen enviando por correo o WhatsApp y el administrador los marca como recibidos.

## Primera puesta en marcha (producción)

```powershell
npx wrangler login              # una vez
npm run secretos:produccion     # genera MASTER_KEY y SETUP_TOKEN y los sube a Cloudflare
git push origin main            # Workers Builds migra D1 y publica
```

1. Copia `MASTER_KEY` y `SETUP_TOKEN` de `secretos-produccion.txt` a un gestor de
   contraseñas y **borra el archivo**.
2. Abre `/admin`, escribe el `SETUP_TOKEN`, el correo y una contraseña de 12+ caracteres.
   Esa pantalla desaparece para siempre en cuanto existe la cuenta.

> **`MASTER_KEY` cifra todos los datos. Si se pierde, no hay forma de recuperarlos.**
> No la cambies mientras haya datos guardados y nunca la subas a Git.

En local, `npm run dev` crea `.dev.vars` con secretos de prueba y una base aparte.

### Tareas frecuentes

| Necesidad | Cómo |
| --- | --- |
| Olvidé la contraseña | `npm run admin:reiniciar` (borra solo la cuenta y la sesión) y vuelve a crearla en `/admin` con el `SETUP_TOKEN` |
| Cambió el reglamento, el instructivo o la política | Edita `public/documentos.html` o `public/privacidad.html`, sube la versión en `src/legal.mjs`, ejecuta `npm run legal` y copia la huella. `npm test` falla si se olvida |
| Activar Turnstile (antirrobots) | Crea un widget gratis en Cloudflare → Turnstile y guarda `TURNSTILE_SITEKEY` y `TURNSTILE_SECRET` con `npx wrangler secret put` |
| Copia de seguridad | `npx wrangler d1 export sermasclubnatacion-db --remote --output backups/copia.sql` (los datos personales salen cifrados; sin `MASTER_KEY` no se leen) |
| Nueva migración | `npm run db:new -- nombre`, edita el SQL, `npm run db:migrate:local`, `npm run check`, commit y push |

## Medidas de seguridad

| Riesgo | Medida |
| --- | --- |
| Copia o fuga de la base | Datos personales cifrados con AES-256-GCM (clave derivada de `MASTER_KEY`, que no está en la base). El documento solo deja una huella HMAC para detectar duplicados. Cada registro va atado a su fila: no se puede mover ni alterar |
| Robo de contraseña | Hash PBKDF2-SHA256 con sal y una pimienta secreta; mínimo 12 caracteres; mensajes de error idénticos; 5 intentos por conexión cada 15 minutos |
| Robo de sesión | Cookie `__Host-` con `HttpOnly`, `Secure`, `SameSite=Strict`; en la base solo queda la huella del token; vence a la hora sin uso y a las 8 horas; una sola sesión viva |
| CSRF | Solo se aceptan escrituras del mismo origen, en JSON y con token CSRF de la sesión. La API no habilita CORS |
| Inyección SQL | Todas las consultas usan parámetros (`prepare().bind()`) |
| XSS | Validación estricta en el servidor, el panel pinta con `textContent`, y política CSP sin scripts en línea ajenos (las huellas las calcula `scripts/build.mjs`) |
| Clickjacking / rastreo | `frame-ancestors 'none'`, `X-Frame-Options: DENY`, HSTS, `nosniff`, `Referrer-Policy`, `Permissions-Policy` |
| Robots y abuso | Campo trampa, 6 envíos por conexión por hora, tope diario global y Turnstile opcional |
| Fórmulas en Excel | El CSV neutraliza las celdas que empiezan por `= + - @` |
| Errores | Respuestas genéricas; los logs no incluyen cuerpos ni datos personales; la IP solo se guarda como huella |
| Configuración incompleta | Sin `MASTER_KEY` la API responde 503 y no guarda nada |

Límite conocido: el plan gratuito de Workers da 10 ms de CPU por solicitud, por eso
PBKDF2 usa 30 000 iteraciones (`ITERACIONES` en `src/seguridad.mjs`); la pimienta compensa.
Con Workers Paid se puede subir a 100 000 sin migrar nada.

## Ley 1581 de 2012 (habeas data): qué cubre el sistema

- Autorización previa, expresa e informada, con casilla aparte para datos sensibles de
  salud y otra, opcional, para uso de imagen.
- Menores: autoriza el representante legal, declara serlo y confirma que el menor fue
  escuchado (Decreto 1377 de 2013, art. 12).
- Prueba de la autorización: fecha, versión y huella SHA-256 de cada texto aceptado,
  nombre y documento de quien firma (columnas `consentimiento_*`, `*_version`, `*_hash`).
- Derechos del titular desde el panel: consulta y copia (*Descargar datos*),
  rectificación (*Guardar*) y supresión (*Eliminar*, borrado real).
- Minimización: la clase gratis no pide documento ni salud. El panel avisa cuando una
  solicitud de clase gratis pasa de 12 meses para que se elimine.
- Política publicada en `/privacidad` y aviso de cookies (los mapas de Google solo se
  cargan si la persona acepta).

### Pendiente del club (no lo resuelve el software)

1. Completar en `public/privacidad.html` la razón social, el **NIT** y el domicilio, y
   hacer revisar la política y las autorizaciones por un abogado.
2. Verificar si el club debe inscribir sus bases en el Registro Nacional de Bases de
   Datos (RNBD) de la SIC.
3. Definir quién atiende las consultas y reclamos (10 y 15 días hábiles).
4. Tratar con el mismo cuidado los PDF que llegan por correo y WhatsApp, y los CSV que
   se exporten del panel.
5. El reglamento publicado incluye el número de cuenta bancaria y el WhatsApp del club,
   tal como está en el documento original: confirmar que quieren que sea público.

## Tablas

| Tabla | Contenido |
| --- | --- |
| `inscripciones` | `tipo`, `estado`, `es_menor`, `doc_hmac`, `datos_cifrados` y la prueba de autorización |
| `admins` | La única cuenta (id 1): correo, hash, sal e iteraciones |
| `sesiones` | Huella del token, token CSRF, vencimientos |
| `auditoria` | Fecha, acción, id del registro y huella de IP (se conserva 2 años) |
| `limites` | Contadores de intentos |
| `users` | Tabla vacía de la etapa anterior; ya no se usa |

D1 guarda un historial para restaurar (Time Travel): un registro eliminado puede seguir
en ese historial hasta 30 días (7 en el plan gratuito).

## Pruebas

```powershell
npm test        # 27 pruebas del backend con las migraciones reales
npm run check   # tipos + pruebas + validación de Wrangler sin publicar
```
