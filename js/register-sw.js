/**
 * register-sw.js — Registra el Service Worker (PWA).
 * Archivo separado para no usar script inline (compatible con CSP).
 */
(function () {
  "use strict";
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("./sw.js").catch(function (e) {
        // Solo de depuración: no romper la app si falla el registro
        if (window.console && window.console.warn) console.warn("SW no registrado:", e);
      });
    });
  }
})();