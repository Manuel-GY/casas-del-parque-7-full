/**
 * sw.js — Service Worker de Casas del Parque 7.
 *
 * Estrategia:
 *   - App shell: cache-first (precache en "install").
 *   - Navegaciones offline: caen al index.html cacheado.
 *   - Todo lo demás (Supabase, APIs): en red. Sin cache de datos
 *     privados para no filtrar información entre sesiones.
 */
"use strict";

var VERSION = "cdp7-v2.0.6";

var APP_SHELL = [
  "./",
  "./index.html",
  "./app.html",
  "./manifest.webmanifest",
  "./css/style.css",
  "./js/pure.js",
  "./js/auth.js",
  "./js/supabase.min.js",
  "./js/index.js",
  "./js/app.js",
  "./js/stats.js",
  "./js/register-sw.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/icon-180.png"
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(VERSION).then(function (cache) {
      return cache.addAll(APP_SHELL);
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (k) { return k !== VERSION; })
            .map(function (k) { return caches.delete(k); })
      );
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener("fetch", function (event) {
  var req = event.request;

  // Solo GET y mismo origen (dejamos CDNs y Supabase a la red)
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) {
    return;
  }

  var url = new URL(req.url);
  var path = url.pathname.replace(location.pathname.replace(/[^/]*$/, ""), "");

  // Navegaciones: red primero, con respaldo al shell cacheado (offline).
  // Se cachea bajo la ruta navegada para no confundir index.html y app.html.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then(function (res) {
          var copy = res.clone();
          caches.open(VERSION).then(function (c) { c.put(req, copy); });
          return res;
        })
        .catch(function () {
          var navKey = url.pathname.endsWith("/app.html") ? "./app.html" : "./index.html";
          return caches.match(navKey).then(function (hit) {
            if (hit) return hit;
            return caches.match("./index.html");
          });
        })
    );
    return;
  }

  // Assets: cache-first, actualización en segundo plano
  event.respondWith(
    caches.match(req).then(function (cached) {
      var network = fetch(req).then(function (res) {
        if (res && res.ok && url.origin === location.origin) {
          var copy = res.clone();
          caches.open(VERSION).then(function (c) { c.put(req, copy); });
        }
        return res;
      });
      return cached || network;
    })
  );
});