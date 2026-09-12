/**
 * pure.js — Helpers PUROS (sin DOM) compartidos entre el frontend y los tests.
 *
 * Este módulo NO toca document/window/navigator. Se carga en el navegador
 * (expone window.PURE) y también vía require() en Node para los tests:
 *
 *   - catLabel    : etiqueta legible de una categoría (con soporte legado)
 *   - fmtErr      : traduce errores técnicos de Supabase/PostgreSQL
 *   - fmtFecha    : formatea ISO 8601 a fecha legible en español chileno
 *   - fmtMes      : formatea "YYYY-MM" a "ene 26"
 *   - construirCSV: construye el contenido CSV (sin BOM) y escapa campos
 *   - rangoCasas  : array 1..TOTAL_CASAS
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.PURE = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /** Total de casas del condominio. */
  var TOTAL_CASAS = 146;

  /** Catálogo de categorías de reporte del condominio. */
  var CATEGORIAS = {
    seguridad: "Seguridad",
    instalaciones: "Estado de instalaciones",
    plazas: "Plazas y áreas comunes",
    calles: "Calles y veredas",
    luminarias: "Luminarias",
    aseo: "Aseo y residuos",
    estacionamientos: "Estacionamientos",
    otro: "Otros"
  };

  /** Categorías de la versión de guardias (migradas a 'seguridad'). */
  var CATEGORIAS_LEGADO = {
    acceso: "Seguridad",
    comportamiento: "Seguridad",
    turnos: "Seguridad"
  };

  /** Estados de reportes (reclamos). */
  var ESTADOS = { nuevo: "Nuevo", en_revision: "En revisión", resuelto: "Resuelto" };

  /** Estados de sugerencias: api -> etiqueta y api -> estilo generico. */
  var ESTADOS_SUGERENCIA = { nueva: "Nueva", en_revision: "En revisión", resuelta: "Resuelta" };

  /** Devuelve la etiqueta legible de una categoría de reporte. */
  function catLabel(clave) {
    return CATEGORIAS[clave] || CATEGORIAS_LEGADO[clave] || clave;
  }

  /**
   * Traduce mensajes de error técnicos de Supabase/PostgreSQL a mensajes
   * amigables para el usuario final.
   */
  function fmtErr(m) {
    var s = String((m == null) ? "" : m);
    if (!s) return "";
    if (/could not find the function|schema cache/i.test(s))
      return "La base de datos no está actualizada. Ejecuta el sql/schema.sql completo en el SQL Editor de Supabase.";
    if (/failed to fetch|networkerror|load failed|fetch failed|timeout/i.test(s))
      return "No hay conexión con Supabase. Revisa tu internet e inténtalo de nuevo.";
    if (/already registered|already been registered|email already/i.test(s))
      return "Ese correo ya está registrado. Prueba iniciando sesión.";
    if (/email not confirmed|email not verified/i.test(s))
      return "Correo no confirmado. Revisa tu correo y haz clic en el enlace de confirmación para activar tu cuenta.";
    if (/invalid login credentials|invalid email or password|user not found/i.test(s))
      return "Correo o contraseña incorrectos.";
    if (/Demasiados intentos/i.test(s))
      return "Demasiados intentos de registro con este correo. Espera una hora e inténtalo de nuevo.";
    if (/too many (requests|attempts)|rate limit|429|email rate limit/i.test(s))
      return "Demasiadas solicitudes en poco tiempo. Espera un momento y vuelve a intentarlo.";
    if (/jwt expired|invalid jwt|token has expired|not authorized|signed out|session missing|invalid refresh token/i.test(s))
      return "Tu sesión expiró o no es válida. Vuelve a iniciar sesión.";
    if (/new password should be different|different from the old|same as (the )?old password/i.test(s))
      return "La nueva contraseña debe ser diferente a la contraseña anterior.";
    if (/password should be at least|password is too short/i.test(s))
      return "La contraseña debe tener al menos 6 caracteres.";
    if (/weak password/i.test(s))
      return "La contraseña ingresada es demasiado débil.";
    if (/violates check constraint.*descripcion/i.test(s))
      return "El detalle/descripción debe tener al menos 10 y máximo 2000 caracteres.";
    if (/violates check constraint.*titulo/i.test(s))
      return "El título debe tener al menos 3 y máximo 200 caracteres.";
    if (/violates check constraint.*nombre/i.test(s))
      return "El nombre debe tener entre 1 y 120 caracteres.";
    if (/violates check constraint/i.test(s))
      return "Los datos ingresados no cumplen con los límites de longitud requeridos (mínimo 10 caracteres en la descripción).";
    if (/violates row-level security policy|permission denied|access denied|unauthorized/i.test(s))
      return "No tienes permisos para realizar esta acción.";
    if (/duplicate key.*unique constraint/i.test(s))
      return "Ya existe un registro con esos mismos datos.";
    if (/null value in column.*not-null constraint/i.test(s))
      return "Por favor, completa todos los campos obligatorios.";
    if (/payload too large|file size|object too large/i.test(s))
      return "El archivo adjunto supera el tamaño máximo permitido (5 MB).";
    if (/mime type|file type|not allowed/i.test(s))
      return "Formato de archivo no válido. Sube una imagen (JPG, PNG, WebP).";
    if (/for security purposes.*once every/i.test(s))
      return "Por seguridad, solo puedes realizar esta acción una vez por minuto. Espera un momento.";
    if (/signup.*disabled|signups not allowed/i.test(s))
      return "El registro de nuevos usuarios no está disponible en este momento.";
    if (/bad request/i.test(s))
      return "Solicitud no válida. Revisa los datos e inténtalo de nuevo.";
    if (/not found|404|pgrst116/i.test(s))
      return "No se encontró el elemento solicitado.";
    if (/AuthApiError|PostgrestError|StorageApiError|error|failed|invalid|cannot|unable/i.test(s))
      return "Ocurrió un error al procesar la solicitud. Inténtalo de nuevo.";
    return s;
  }

  /**
   * Formatea una fecha ISO a formato legible en español chileno.
   */
  function fmtFecha(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleString("es-CL", {
      day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit"
    });
  }

  /**
   * Formatea una cadena "YYYY-MM" a formato corto: "ene 26", "feb 26", etc.
   */
  function fmtMes(ym) {
    var meses = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
    var p = String(ym).split("-");
    if (p.length < 2) return ym;
    return (meses[(parseInt(p[1], 10) || 1) - 1]) + " " + String(p[0]).slice(2);
  }

  /**
   * Caracteres que convierten una celda en formula/celda "peligrosa" al
   * abrir el CSV en Excel/Google Sheets (OWASP CSV Injection). Si el valor
   * empieza con alguno, se antepone una comilla simple para neutralizarlo.
   */
  var INICIO_FORMULA = /^[=+\-@\t\r\n]/;

  /**
   * Construye el contenido CSV (sin BOM) desde un array de objetos.
   * @param {Array} datos - Array de objetos
   * @param {Array} columnas - Definicion de columnas [{ label, val }]
   * @returns {string} CSV con cabecera + filas, campos entre comillas
   */
  function construirCSV(datos, columnas) {
    if (!datos || !datos.length) return "";
    var headers = columnas.map(function (c) { return '"' + String(c.label).replace(/"/g, '""') + '"'; }).join(",");
    var rows = datos.map(function (row) {
      return columnas.map(function (c) {
        var val = c.val(row);
        val = (val == null) ? "" : String(val);
        if (INICIO_FORMULA.test(val)) val = "'" + val; // Anti formula-injection
        return '"' + val.replace(/"/g, '""') + '"';
      }).join(",");
    });
    return [headers].concat(rows).join("\n");
  }

  /** Devuelve el array 1..TOTAL_CASAS. */
  function rangoCasas() {
    var arr = [];
    for (var i = 1; i <= TOTAL_CASAS; i++) arr.push(i);
    return arr;
  }

  return {
    TOTAL_CASAS: TOTAL_CASAS,
    CATEGORIAS: CATEGORIAS,
    CATEGORIAS_LEGADO: CATEGORIAS_LEGADO,
    ESTADOS: ESTADOS,
    ESTADOS_SUGERENCIA: ESTADOS_SUGERENCIA,
    catLabel: catLabel,
    fmtErr: fmtErr,
    fmtFecha: fmtFecha,
    fmtMes: fmtMes,
    construirCSV: construirCSV,
    rangoCasas: rangoCasas
  };
});