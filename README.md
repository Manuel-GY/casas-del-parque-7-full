# Casas del Parque 7 — Plataforma Oficial de Gestión Comunitaria (Versión Completa)

Plataforma web (**Serverless & Zero-Build**) desplegada en **Vercel** con backend **Supabase**, para la gestión transparente de reportes y sugerencias sobre **todo el condominio** Casas del Parque 7 (142 casas): seguridad, instalaciones, plazas, calles, luminarias, aseo y estacionamientos.

> ⚠️ Esta es la **versión completa** (repositorio `casas-del-parque-7-full`). Usa una base de datos Supabase **independiente** de la versión de guardias (`casas-del-parque-7`), por lo que los datos no se mezclan.

---

## 🟢 Diferencias con la versión de guardias

| Aspecto | Versión guardias | **Versión completa (este repo)** |
|---|---|---|
| Alcance | Solo servicio de guardias | **Todo el condominio** |
| Categorías | accesos, comportamiento, turnos, instalaciones | **seguridad, instalaciones, plazas, calles, luminarias, aseo, estacionamientos, otros** |
| Severidad | Baja / Media / Alta | **Eliminada** |
| Base de datos (Supabase) | Compartida con este repo | **Proyecto Supabase propio** |
| Hospedaje | Vercel (`cdp7.vercel.app`) | Vercel (proyecto propio) |

---

## 🌟 Funcionalidades Principales

### 🏡 Para Vecinos
- **Registro por Casa**: Máximo 2 vecinos registrados por vivienda (validado estrictamente en base de datos).
- **Reporte Comunitario**: Selección de categoría de 8 áreas del condominio (seguridad, instalaciones, plazas, calles, luminarias, aseo, estacionamientos, otros).
- **Envío de Sugerencias**: Propuestas para la mejora comunitaria.
- **Historial Privado**: Visualización exclusiva de sus propias solicitudes y de la respuesta del Comité / Administración.
- **Estadísticas Comunitarias**: Métricas anónimas agregadas por mes, categoría y estado.

### 🛡️ Para el Comité y la Administración
- **Panel de Control Completo**: Gestión detallada de todos los reportes y sugerencias con estado (*Nuevo*, *En revisión*, *Resuelto*).
- **Buscador en Tiempo Real**: Filtrado dinámico por palabra clave, título, detalle o número de casa.
- **Exportación a CSV / Excel**: Descarga de reportes en formato `.csv` compatible con Microsoft Excel (UTF-8 con BOM).
- **Gestión de Roles (Solo Admin)**: Asignación de permisos de Comité o Administración a perfiles registrados.

### 📱 Experiencia Móvil & PWA
- **Barra de Navegación Inferior (Bottom Tab Bar)**: Menú táctil fijado en la parte inferior con iconos SVG para manejo con una sola mano en smartphones.
- **Prevención de Auto-Zoom**: Ajustes a `16px` en controles de formulario para evitar el zoom involuntario en iPhone / Safari.
- **Transparencia y Privacidad**: Modal interactivo de Política de Privacidad e insignias de confidencialidad en los formularios.

---

## 🔒 Arquitectura de Seguridad (Supabase RLS)

- **Servidor Cero (Zero Server)**: El frontend se sirve como archivos estáticos a través de **Vercel**.
- **Row Level Security (RLS) en PostgreSQL**:
  - Toda la seguridad se garantiza en la base de datos Supabase.
  - Los vecinos **solo pueden consultar sus propios reportes** (`creado_por = auth.uid()`).
  - La clave pública (`anon key`) no compromete la información: PostgreSQL rechaza cualquier consulta no autorizada.
- **Cambio Obligatorio de Contraseña**: Las cuentas genéricas/iniciales deben cambiar su clave por defecto en el primer inicio de sesión.

---

## 🚀 Instalación y Despliegue

### 1. Crear backend en Supabase
0. Crea un proyecto gratuito en [https://supabase.com](https://supabase.com) (**independiente** al de la versión de guardias).
1. Ve a **SQL Editor → New query**, pega el contenido de [`sql/schema.sql`](sql/schema.sql) y ejecútalo.
2. En **Authentication → Providers → Email**: habilita el provider.
3. En **Authentication → Sign In / Providers**: desactiva **Confirm email** (opcional si quieres login inmediato tras registrarse).
4. En **Project Settings → API** copia la **Project URL** y la **anon / publishable key**.

### 2. Configurar credenciales
Edita [`config.js`](config.js) con la URL y la anon key del proyecto nuevo:

```js
window.APP_CONFIG = {
  SUPABASE_URL: "https://TU-PROYECTO.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_TU_KEY_AQUI"
};
```

> ℹ️ `config.js` **se versiona intencionalmente** en este repo (como la v1) para que el deploy estático de Vercel funcione. La anon key es pública por diseño; la seguridad la garantiza RLS en PostgreSQL.

### 3. Crear el primer Administrador
Tras crear tu primera cuenta como vecino desde la interfaz, promuévela a `admin` ejecutando en el SQL Editor:

```sql
update public.profiles set rol = 'admin'
where id = (select id from auth.users where email = 'tu_correo@ejemplo.cl');
```

### 4. Desplegar en Vercel
1. Sube el repositorio a GitHub (`main`).
2. En [vercel.com](https://vercel.com) → **Add New → Project** → importar el repo `casas-del-parque-7-full`.
3. El framework se detecta como "Other" (estático, sin build). Verifica `vercel.json`:
   ```json
   { "version": 2, "outputDirectory": ".", "buildCommand": null, "framework": null }
   ```
4. Deploy. Obtendrás una URL tipo `casas-del-parque-7-full.vercel.app`.

---

## 💻 Desarrollo Local

```bash
npx serve .
# o
python -m http.server 8080
```

Abrir en el navegador: `http://localhost:8080`.

---

## 📁 Estructura del Código

```
├── index.html          Pantalla de Login, Registro, aviso de privacidad y modal
├── app.html            Panel principal (Vecino / Comité / Admin), navegación y formularios
├── config.js           Credenciales públicas (URL + anon key de Supabase) — versionado
├── config.example.js   Plantilla de config sin credenciales
├── css/style.css       Sistema de diseño, glassmorphism, responsive y Bottom Navigation Bar
├── js/auth.js          Cliente Supabase, catálogo de categorías, traducción de errores y modal
├── js/index.js         Lógica de autenticación e inicio de sesión
├── js/app.js           Panel dinámico, validaciones, buscador en tiempo real y exportación CSV
├── js/stats.js         Motor de gráficos dinámicos en HTML5 Canvas (sin dependencias)
├── sql/schema.sql      Esquema de base de datos, funciones SECURITY DEFINER y políticas RLS
└── vercel.json         Config de despliegue estático en Vercel
```