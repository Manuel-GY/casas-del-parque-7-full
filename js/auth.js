/**
 * auth.js — Inicializacion del cliente Supabase y utilidades compartidas.
 *
 * Este archivo se carga en AMBAS paginas (index.html y app.html) antes
 * del modulo especifico de cada una. Expone dos objetos globales:
 *
 *   SB  — Configuracion de la app (categorias, estados, cliente Supabase)
 *   SBH — Funciones de ayuda (mostrar mensajes, escapar HTML, etc.)
 *
 * Se apoya en js/pure.js (helpers sin DOM, testables) que debe cargarse
 * ANTES en las paginas.
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
  var pure = window.PURE || {};

  /** Objeto principal con catalogos y el cliente de base de datos. */
  var SB = {
    CATEGORIAS: pure.CATEGORIAS || {
      seguridad: "Seguridad",
      instalaciones: "Estado de instalaciones",
      plazas: "Plazas y áreas comunes",
      calles: "Calles y veredas",
      luminarias: "Luminarias",
      aseo: "Aseo y residuos",
      estacionamientos: "Estacionamientos",
      otro: "Otros"
    },
    ESTADOS: pure.ESTADOS || { nuevo: "Nuevo", en_revision: "En revisión", resuelto: "Resuelto" },
    client: null,
    configOk: false
  };

  /**
   * Valida que la configuracion exista y no sea el placeholder por defecto.
   * Detecta "PEGA" (formato viejo) y "TU-PROYECTO"/"TU_ANON_KEY" (formato
   * actual de config.example.js).
   */
  SB.configOk = !!(supabaseLoaded && cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY &&
    cfg.SUPABASE_URL.indexOf("PEGA") === -1 && cfg.SUPABASE_ANON_KEY.indexOf("PEGA") === -1 &&
    cfg.SUPABASE_URL.indexOf("TU-PROYECTO") === -1 && cfg.SUPABASE_ANON_KEY.indexOf("TU_ANON_KEY") === -1);

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
   * Compatible con categorias antiguas migradas a 'seguridad'.
   */
  function catLabel(clave) {
    return pure.catLabel ? pure.catLabel(clave) : clave;
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
   * Delega en js/pure.js (sin DOM).
   */
  function fmtFecha(iso) {
    return pure.fmtFecha ? pure.fmtFecha(iso) : "";
  }

  /**
   * Traduce mensajes de error tecnicos de Supabase/PostgreSQL a mensajes
   * amigables para el usuario final. Delega en js/pure.js.
   */
  function fmtErr(m) {
    return pure.fmtErr ? pure.fmtErr(m) : String((m == null) ? "" : m);
  }

  /**
   * Llena un <select> con las 146 casas del condominio.
   * Usa DocumentFragment para minimizar reflows del DOM.
   * @param {HTMLSelectElement} select - Elemento select a poblar
   */
  function llenarCasas(select) {
    if (!select || select.options.length) return;
    var numeros = (pure.rangoCasas ? pure.rangoCasas() : []);
    var frag = document.createDocumentFragment();
    for (var i = 0; i < numeros.length; i++) {
      var o = document.createElement("option");
      o.value = numeros[i];
      o.textContent = "Casa " + numeros[i];
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

    // Cerrar con tecla Escape para accesibilidad
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