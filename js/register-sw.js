/**
 * register-sw.js — Registra el Service Worker (PWA).
 * Archivo separado para no usar script inline (compatible con CSP).
 */
(function () {
  "use strict";
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("./sw.js").then(function (reg) {
        reg.update();
      }).catch(function (e) {
        if (window.console && window.console.warn) console.warn("SW no registrado:", e);
      });

      var refreshing = false;
      navigator.serviceWorker.addEventListener("controllerchange", function () {
        if (!refreshing) {
          refreshing = true;
          window.location.reload();
        }
      });
    });
  }
})();