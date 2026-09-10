/**
 * auth.js — Inicializacion del cliente Supabase y utilidades compartidas.
 *
 * Este archivo se carga en AMBAS paginas (index.html y app.html) antes
 * del modulo especifico de cada una. Expone dos objetos globales:
 *
 *   SB  — Configuracion de la app (categorias, estados, cliente Supabase)
 *   SBH — Funciones de ayuda (mostrar mensajes, escapar HTML, etc.)
 *
 * Seguridad: La anon key es publica por disenio de Supabase. Todas las
 * restricciones de acceso estan garantizadas por Row Level Security (RLS)
 * en PostgreSQL. Ver sql/schema.sql para el detalle de las politicas.
 */
(function () {
  "use strict";

  /* ------------------------------------------------------------------ */
  /*  Inicializacion del cliente Supabase                               */
  /* ------------------------------------------------------------------ */

  var cfg = window.APP_CONFIG || {};
  var supabaseLoaded = (typeof supabase !== "undefined");

  /** Objeto principal con catalogos y el cliente de base de datos. */
  var SB = {
    CATEGORIAS: {
      seguridad: "Seguridad y guardias",
      instalaciones: "Estado de instalaciones",
      plazas: "Plazas y áreas comunes",
      calles: "Calles y veredas",
      luminarias: "Luminarias",
      aseo: "Aseo y residuos",
      estacionamientos: "Estacionamientos",
      otro: "Otros"
    },
    ESTADOS: { nuevo: "Nuevo", en_revision: "En revisión", resuelto: "Resuelto" },
    client: null,
    configOk: false
  };

  /**
   * Valida que la configuracion exista y no sea el placeholder por defecto.
   * El check indexOf("PEGA") detecta si el usuario no reemplazo el texto
   * de ejemplo en config.js ("PEGA_AQUI...").
   */
  SB.configOk = !!(supabaseLoaded && cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY &&
    cfg.SUPABASE_URL.indexOf("PEGA") === -1 && cfg.SUPABASE_ANON_KEY.indexOf("PEGA") === -1);

  if (SB.configOk) {
    try {
      SB.client = supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
    } catch (e) {
      SB.configOk = false;
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Funciones de ayuda (SBH)                                          */
  /* ------------------------------------------------------------------ */

  /**
   * Devuelve la etiqueta legible de una categoria de reporte.
   * Compatible con categorias antiguas (acceso, comportamiento, turnos)
   * que fueron migradas a 'seguridad' en la base de datos.
   */
  function catLabel(clave) {
    var legado = {
      acceso: "Seguridad y guardias",
      comportamiento: "Seguridad y guardias",
      turnos: "Seguridad y guardias"
    };
    return SB.CATEGORIAS[clave] || legado[clave] || clave;
  }

  /**
   * Muestra u oculta un mensaje en la interfaz.
   * @param {string} elId - ID del elemento .msg
   * @param {string} text - Texto a mostrar (vacio para ocultar)
   * @param {string} tipo - "ok" (verde) o "error" (rojo, por defecto)
   */
  function mostrar(elId, text, tipo) {
    var m = document.getElementById(elId);
    if (!m) return;
    m.textContent = text || "";
    m.className = "msg " + (tipo || "error");
  }

  /**
   * Escapa HTML para insercion segura en el DOM.
   * Usa textContent -> innerHTML para obtener la representacion escapada.
   */
  function esc(s) {
    var d = document.createElement("div");
    d.textContent = (s == null) ? "" : String(s);
    return d.innerHTML;
  }

  /**
   * Formatea una fecha ISO a formato legible en espanol chileno.
   * @param {string} iso - Fecha en formato ISO 8601
   * @returns {string} Fecha formateada (ej: "05 sep 2026, 14:30")
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
   * Traduce mensajes de error tecnicos de Supabase/PostgreSQL a mensajes
   * amigables para el usuario final. Cubre: errores de conexion, auth,
   * validacion de check constraints, RLS, rate limiting, JWT, etc.
   */
  function fmtErr(m) {
    var s = String((m == null) ? "" : m);
    if (/could not find the function|schema cache/i.test(s))
      return "La base de datos no está actualizada. Ejecuta el sql/schema.sql completo en el SQL Editor de Supabase.";
    if (/failed to fetch|networkerror|load failed|fetch failed|timeout/i.test(s))
      return "No hay conexión con Supabase. Revisa tu internet e inténtalo de nuevo.";
    if (/already registered|already been registered|email already/i.test(s))
      return "Ese correo ya está registrado. Prueba iniciando sesión.";
    if (/invalid login credentials|invalid email or password/i.test(s))
      return "Correo o contraseña incorrectos.";
    if (/too many (requests|attempts)|rate limit|429/i.test(s))
      return "Demasiadas solicitudes en poco tiempo. Espera un momento y vuelve a intentarlo.";
    if (/jwt expired|invalid jwt|token has expired|not authorized|signed out/i.test(s))
      return "Tu sesión expiró. Vuelve a iniciar sesión.";
    if (/new password should be different|different from the old|same as (the )?old password/i.test(s))
      return "La nueva contraseña debe ser diferente a la contraseña anterior.";
    if (/password should be at least/i.test(s))
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
    if (/violates row-level security policy/i.test(s))
      return "No tienes permisos para realizar esta acción.";
    return s;
  }

  /**
   * Llena un <select> con las 142 casas del condominio.
   * Usa DocumentFragment para minimizar reflows del DOM.
   * @param {HTMLSelectElement} select - Elemento select a poblar
   */
  function llenarCasas(select) {
    if (!select || select.options.length) return;
    var frag = document.createDocumentFragment();
    for (var i = 1; i <= 142; i++) {
      var o = document.createElement("option");
      o.value = i;
      o.textContent = "Casa " + i;
      frag.appendChild(o);
    }
    select.appendChild(frag);
  }

  /**
   * Vincula el modal de politica de privacidad al link del pie de pagina.
   * Soporta: click en el link, click en X, click fuera del modal, y tecla Escape.
   */
  function bindPrivacyModal() {
    var link = document.getElementById("link-privacy");
    var modal = document.getElementById("modal-privacidad");
    var closeBtn = document.getElementById("btn-close-privacy");
    if (!link || !modal) return;

    function abrir(e) {
      if (e) e.preventDefault();
      modal.classList.remove("hidden");
      modal.setAttribute("aria-hidden", "false");
    }

    function cerrar() {
      modal.classList.add("hidden");
      modal.setAttribute("aria-hidden", "true");
    }

    link.addEventListener("click", abrir);

    if (closeBtn) closeBtn.addEventListener("click", cerrar);

    // Cerrar al hacer clic fuera del contenido del modal
    modal.addEventListener("click", function (e) {
      if (e.target === modal) cerrar();
    });

    // #7: Cerrar con tecla Escape para accesibilidad
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !modal.classList.contains("hidden")) {
        cerrar();
      }
    });
  }

  /* ------------------------------------------------------------------ */
  /*  Inicializacion global al cargar el DOM                            */
  /* ------------------------------------------------------------------ */

  document.addEventListener("DOMContentLoaded", function () {
    bindPrivacyModal();
  });

  /* ------------------------------------------------------------------ */
  /*  Exponer globals para otros modulos                                 */
  /* ------------------------------------------------------------------ */

  window.SB = SB;
  window.SBH = { mostrar: mostrar, esc: esc, fmtFecha: fmtFecha, llenarCasas: llenarCasas, fmtErr: fmtErr, bindPrivacyModal: bindPrivacyModal, catLabel: catLabel };
})();
