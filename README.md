# Casas del Parque 7 — Plataforma Oficial de Gestión Comunitaria (Versión Completa)

Plataforma web (**Serverless & Zero-Build**) desplegada en **Vercel** con backend **Supabase**, para la gestión transparente de reportes y sugerencias sobre **todo el condominio** Casas del Parque 7 (**146 casas**): seguridad, instalaciones, plazas, calles, luminarias, aseo y estacionamientos.

> ⚠️ Esta es la **versión completa** (repositorio `casas-del-parque-7-full`). Usa una base de datos Supabase **independiente** de la versión de guardias (`casas-del-parque-7`), por lo que los datos no se mezclan.

---

## 🟢 Diferencias con la versión de guardias

| Aspecto | Versión guardias | **Versión completa (este repo)** |
|---|---|---|
| Alcance | Solo servicio de guardias | **Todo el condominio** |
| Categorías | accesos, comportamiento, turnos, instalaciones | **seguridad, instalaciones, plazas, calles, luminarias, aseo, estacionamientos, otros** |
| Severidad | Baja / Media / Alta | **Eliminada** |
| Casas | 142 | **146** |
| Registro | Solo correos de un dominio | **Abierto a cualquier correo** (cualquiera con el link), con límite de 10 intentos/hora/correo |
| Novedades | — | **Avisos y reportes recientes dentro de la app** (campana en el panel) |
| Adjuntos | — | **Hasta 3 fotos por reporte o sugerencia** (bucket privado `reportes`) |
| Recuperar contraseña | — | **Enlace "¿Olvidaste tu contraseña?"** con email de respaldo |
| Base de datos (Supabase) | Compartida con este repo | **Proyecto Supabase propio** |
| Hospedaje | Vercel (`cdp7.vercel.app`) | Vercel (proyecto propio) |

---

## 🌟 Funcionalidades Principales

### 🏡 Para Vecinos
- **Registro Abierto**: cualquier persona con el link puede crear su cuenta verificando su correo; **máximo 2 vecinos por casa** (validado atómicamente en base de datos, evita que los 2 cupos se agoten a la vez).
- **Reporte Comunitario**: selección de categoría de 8 áreas del condominio (seguridad, instalaciones, plazas, calles, luminarias, aseo, estacionamientos, otros).
- **Fotos Adjuntas**: hasta **3 fotos** por reporte o sugerencia, subidas a un bucket privado protegido por RLS.
- **Envío de Sugerencias**: propuestas para la mejora comunitaria.
- **Historial Privado**: visualización exclusiva de sus propias solicitudes y de la respuesta del Comité / Administración.
- **Estadísticas Comunitarias**: métricas anónimas agregadas por mes, categoría y estado, con exportación a Excel.

### 🔔 Avisos dentro de la app
- **Campana de novedades**: al entrar y cada 60 s se revisan los reportes/sugerencias de los últimos 3 días; el contador muestra las no vistas.
- Al abrir la pestaña de novedades todo queda marcado como visto (sin correos ni push).
- Las tarjetas nuevas se marcan en amarillo y sus fotos se pueden ampliar.

### 🛡️ Para el Comité y la Administración
- **Panel de Control Completo**: gestión detallada de todos los reportes y sugerencias con estado (*Nuevo*, *En revisión*, *Resuelto*).
- **Buscador en Tiempo Real**: filtrado por palabra clave, título, detalle o número de casa.
- **Exportación a CSV / Excel**: descarga en formato `.csv` compatible con Microsoft Excel (UTF-8 con BOM).
- **Archivar / Borrar (Admin)**: los administradores pueden archivar (oculta a los vecinos) o borrar definitivamente un reporte/sugerencia.
- **Gestión de Roles (Solo Admin)**: asignación de permisos de Comité o Administración a perfiles registrados.

### 📱 PWA instalable
- **App instalable**: manifest + service worker + iconos. Instálala en el teléfono desde el navegador (soporte offline del shell).
- **Barra de Navegación Inferior (Bottom Tab Bar)**: menú táctil fijado abajo con iconos SVG para manejo con una sola mano.
- **Prevención de Auto-Zoom**: ajustes de `16px` en controles de formulario para evitar el zoom involuntario en iPhone/Safari.
- **Transparencia y Privacidad**: modal de Política de Privacidad e insignias de confidencialidad en los formularios.

---

## 🔒 Arquitectura de Seguridad (Supabase RLS)

- **Servidor Cero (Zero Server)**: el frontend se sirve como archivos estáticos a través de **Vercel**.
- **Row Level Security (RLS) en PostgreSQL**:
  - Los vecinos solo consultan **sus propios** reportes/sugerencias (`creado_por = auth.uid()`).
  - El cupo de casas y el límite de intentos de registro se aplican en la base de datos (funciones `SECURITY DEFINER` + triggers), no en el navegador.
- **Registro protegido**: trigger sobre `auth.users` que limita a **10 intentos de registro por hora por correo** (tabla `intentos_registro`).
- **Cupo atómico**: la función `registrar_perfil` reserva una de las 2 plazas por casa con un bloqueo de asesoría de PostgreSQL, evitando dobles asignaciones bajo concurrencia.
- **Adjuntos privados**: las fotos viven en el bucket `reportes` (acceso `private`), solo los autores y `admin`/`comite` pueden verlas; los enlaces firmados expiran.

---

## 🚀 Instalación y Despliegue

### 1. Crear backend en Supabase (BD nueva)
0. Crea un proyecto gratuito en [https://supabase.com](https://supabase.com) (**independiente** al de la versión de guardias).
1. Ve a **SQL Editor → New query**, pega el contenido de [`sql/schema.sql`](sql/schema.sql) y ejecútalo.
2. En **Authentication → Sign In / Providers → Email**: habilita el provider, conserva **Confirm email: ON** (así se valida el correo al registrarse).
3. En **Authentication → Email Templates → Confirm signup**: escribe un asunto y un texto acogedor (se envía al registrarse).
4. En **Authentication → Email Templates → Reset password**: edita la plantilla y en el campo **"Site URL"** pega tus URLs de producción y local:
   - `https://TU-PROYECTO.vercel.app` (producción)
   - `http://localhost:8080` (desarrollo)
   
   Ábrela y agrega el **JavaScript**:
   ```js
   window.location.href = window.location.origin + "/index.html#view-recovery?access_token=" + urlParams.get("access_token") + "&refresh_token=" + urlParams.get("refresh_token");
   ```
5. En **Project Settings → API** copia la **Project URL** y la **anon / publishable key**.
6. En **Storage → Buckets**: verifica que exista el bucket `reportes` (lo crea `schema.sql`) y que las políticas estén activas (también van en el mismo script).

### 2. Configurar credenciales
Edita [`config.js`](config.js) con la URL y la anon key del proyecto nuevo:

```js
window.APP_CONFIG = {
  SUPABASE_URL: "https://TU-PROYECTO.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_TU_KEY_AQUI"
};
```

> ℹ️ `config.js` **se versiona intencionalmente** en este repo para que el deploy estático de Vercel funcione. La anon key es pública por diseño; la seguridad la garantiza RLS en PostgreSQL.

### 3. Crear el primer Administrador
Tras crear tu primera cuenta como vecino desde la interfaz, promuévela a `admin` ejecutando en el SQL Editor:

```sql
update public.profiles set rol = 'admin'
where id = (select id from auth.users where email = 'tu_correo@ejemplo.cl');
```

### 4. Desplegar en Vercel
1. Sube el repositorio a GitHub (`main`).
2. En [vercel.com](https://vercel.com) → **Add New → Project** → importar el repo `casas-del-parque-7-full`.
3. Framework "Other" (estático, sin build). `vercel.json` ya trae la configuración y los **headers de seguridad** (CSP, `nosniff`, `frame-ancestors`, `permissions-policy`).
4. Deploy. Obtendrás una URL tipo `casas-del-parque-7-full.vercel.app`.

---

## 💻 Desarrollo Local

```bash
npx serve .
# o
python -m http.server 8080
```

Abrir en el navegador: `http://localhost:8080`. Para probar la instalación PWA es recomendable servir por HTTPS (por ejemplo `ngrok http 8080`).

## ✅ Tests

Sin dependencias (Node ≥ 18 incluido):

```bash
npm test
```

- `tests/pure.test.js`: helpers puros (casas, categorías, fechas, CSV).
- `tests/smoke.test.js`: consistencia HTML↔JS (IDs usados existen), orden de scripts, archivos referenciados existen, sin scripts inline y sin restos de la versión de guardias.
- CI en GitHub Actions ejecuta `npm test` en cada push/PR.

Regenerar iconos (opcional, ya están versionados en `icons/`):

```bash
npm run icons
```

---

## 📁 Estructura del Código

```
├── index.html           Login, registro, recuperación de contraseña, privacidad y modal
├── app.html             Panel principal (Vecino / Comité / Admin), navegación, novedades y formularios
├── manifest.webmanifest Manifesto PWA (nombre, colores, iconos)
├── sw.js                Service Worker (cache de app shell, fallback offline)
├── config.js            Credenciales públicas (URL + anon key de Supabase) — versionado
├── config.example.js    Plantilla de config sin credenciales
├── css/style.css        Sistema de diseño, glassmorphism, responsive y Bottom Navigation Bar
├── js/pure.js           Helpers puros (sin DOM) y testeables con Node
├── js/auth.js           Cliente Supabase, catálogo de categorías, traducción de errores y modal
├── js/index.js          Lógica de autenticación y recuperación de contraseña
├── js/app.js            Panel dinámico, novedades, fotos, validaciones y exportación CSV
├── js/stats.js          Motor de gráficos dinámicos en HTML5 Canvas (sin dependencias)
├── js/register-sw.js    Registro del Service Worker (archivo externo por CSP)
├── icons/               Iconos PNG del PWA (192, 512, 180 y maskable)
├── scripts/make-icons.ps1 Generador de iconos (PowerShell + System.Drawing)
├── sql/schema.sql       Esquema de BD, funciones SECURITY DEFINER, triggers y políticas RLS
├── tests/               Tests de Node (helpers puros + smoke de la webapp)
├── .github/workflows/ci.yml CI en GitHub Actions
└── vercel.json          Config de deploy estático + headers de seguridad en Vercel
```

---

## 📝 Changelog (vs. versión 1)

- 146 casas (antes 142) con 8 categorías del condominio.
- Registro **abierto** (sin restricción de dominio) con rate-limit de 10 intentos/hora/correo.
- Recuperación de contraseña desde el login con enlace de respaldo.
- Avisos in-app (campana + contador + pestaña de novedades), sin push.
- Adjunto de hasta 3 fotos por reporte/sugerencia (bucket privado + RLS + URL firmadas).
- Acciones de archivo y borrado para administradores.
- PWA instalable (manifest, service worker, iconos) y soporte offline del shell.
- `vercel.json` con headers de seguridad (CSP, `nosniff`, `X-Frame-Options`, `Permissions-Policy`).
- Tests de Node + CI en GitHub Actions.