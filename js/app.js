/**
 * app.js — Panel principal de la aplicacion.
 *
 * Se ejecuta exclusivamente en app.html. Maneja:
 *   - Sesion y perfil del usuario (carga, validacion, cambio de contrasena)
 *   - Navegacion por pestaas (vecino vs comite/admin)
 *   - CRUD de reclamos y sugerencias (envio, listado, respuesta, fotos)
 *   - Novedades dentro de la app (campana con badge + lista)
 *   - Archivar y borrar reportes (comité/admin)
 *   - Estadisticas comunitarias con graficos Canvas
 *   - Exportacion a CSV compatible con Excel
 *   - Gestion de usuarios (solo admin)
 *
 * Seguridad:
 *   - Todas las operaciones de lectura/escritura van contra Supabase
 *   - Las restricciones de acceso las controla RLS en PostgreSQL
 *   - Las funciones RPC validan el rol del usuario dentro de SECURITY DEFINER
 */
(function () {
  "use strict";

  /* ------------------------------------------------------------------ */
  /*  Estado global de la sesion                                         */
  /* ------------------------------------------------------------------ */

  var user = null;      // Objeto auth.users de Supabase
  var profile = null;   // Registro de la tabla profiles
  var rol = null;       // 'vecino' | 'comite' | 'admin'
  var recCache = [];    // Cache local de reclamos (para filtros)
  var sugCache = [];    // Cache local de sugerencias (para filtros)
  var busquedaRec = "";
  var busquedaSug = "";

  /* ------------------------------------------------------------------ */
  /*  Flags para evitar duplicacion de event listeners                   */
  /* ------------------------------------------------------------------ */
  var _reclamoBound = false;
  var _sugerenciaBound = false;
  var _novedadesBound = false;

  /* ------------------------------------------------------------------ */
  /*  Paginacion                                                         */
  /* ------------------------------------------------------------------ */
  var PAGE_SIZE = 20;
  var recPage = 1;
  var sugPage = 1;

  /* ------------------------------------------------------------------ */
  /*  Novedades (campana)                                                */
  /* ------------------------------------------------------------------ */
  var vistoHasta = null;     // Baseline desde el que se cuentan novedades
  var novEdades = [];        // Cache de novedades
  var pollTimer = null;

  /* ------------------------------------------------------------------ */
  /*  Fotos adjuntas                                                     */
  /* ------------------------------------------------------------------ */
  var fotosRecl = [];        // File[] pendientes para el proximo reporte
  var fotosSug = [];         // File[] pendientes para la proxima sugerencia
  var MAX_FOTOS = 1;

  /* ------------------------------------------------------------------ */
  /*  Helpers                                                            */
  /* ------------------------------------------------------------------ */

  function chip(txt, css) {
    return '<span class="chip ' + css + '">' + SBH.esc(txt) + "</span>";
  }

  function showLoading(wrapId) {
    var wrap = document.getElementById(wrapId);
    if (wrap) wrap.innerHTML = '<p class="hint">Cargando...</p>';
  }

  function uid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0;
      var v = c === "x" ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  /** Genera el HTML de miniaturas con data-foto para hidratar luego. */
  function fotosHtml(fotos) {
    var arr = fotos || [];
    if (!arr.length) return "";
    return '<div class="fotos-row">' + arr.map(function (f) {
      return '<img class="foto-thumb" data-foto="' + SBH.esc(f) + '" alt="Foto adjunta" loading="lazy">';
    }).join("") + "</div>";
  }

  /**
   * Resuelve las URLs firmadas de las fotos y las asigna a las imagenes.
   * Se llama despues de cada render con fotos.
   */
  function hidratarFotos(scope) {
    if (!scope || !SB.client) return;
    var imgs = scope.querySelectorAll(".foto-thumb");
    for (var i = 0; i < imgs.length; i++) {
      (function (img) {
        var path = img.getAttribute("data-foto");
        if (!path) { img.style.display = "none"; return; }
        SB.client.storage.from("reportes").createSignedUrl(path, 3600).then(function (r) {
          if (!r.error && r.data && r.data.signedUrl) {
            img.src = r.data.signedUrl;
          } else {
            img.style.display = "none";
          }
        });
      })(imgs[i]);
    }
  }

  /**
   * Borra del Storage las fotos adjuntas a la tarjeta (al marcarla resuelta).
   * Devuelve true si procede (sin fotos, o borradas); false si se cancela o falla.
   */
  function borrarFotosDeTarjeta(card) {
    var paths = [];
    var imgs = card.querySelectorAll(".foto-thumb");
    for (var i = 0; i < imgs.length; i++) {
      var p = imgs[i].getAttribute("data-foto");
      if (p) paths.push(p);
    }
    if (!paths.length) return Promise.resolve(true);
    if (!confirm("Al marcarlo como resuelto se eliminará la foto adjunta. ¿Continuar?")) {
      return Promise.resolve(false);
    }
    return SB.client.storage.from("reportes").remove(paths).then(function (r) {
      if (r.error) { SBH.mostrar("msg", SBH.fmtErr(r.error.message), "error"); return false; }
      return true;
    });
  }

  /* ------------------------------------------------------------------ */
  /*  Sesion / perfil                                                    */
  /* ------------------------------------------------------------------ */

  async function definirNav() {
    var nav = document.getElementById("nav");
    nav.innerHTML = "";

    var tabs = [
      { id: "sec-nuevo", txt: "Reportar", icon: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>' },
      { id: "sec-mios", txt: "Mis Reportes", icon: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>' },
      { id: "sec-sugerir", txt: "Sugerir", icon: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>' },
      { id: "sec-mias", txt: "Mis Sugerencias", icon: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/></svg>' }
    ];
    if (rol === "comite" || rol === "admin") {
      tabs = [
        { id: "sec-reclamos", txt: "Reportes", icon: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>' },
        { id: "sec-sugerencias", txt: "Sugerencias", icon: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>' },
        { id: "sec-stats", txt: "Estadísticas", icon: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>' }
      ];
      if (rol === "admin") tabs.push({ id: "sec-usuarios", txt: "Usuarios", icon: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>' });
    } else {
      tabs.push({ id: "sec-stats", txt: "Estadísticas", icon: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>' });
    }

    tabs.forEach(function (t, i) {
      var b = document.createElement("button");
      b.className = "tab" + (i === 0 ? " active" : "");
      b.type = "button";
      b.innerHTML = (t.icon || "") + '<span>' + SBH.esc(t.txt) + '</span>';
      b.dataset.target = t.id;
      b.addEventListener("click", function () { mostrarSeccion(t.id); });
      nav.appendChild(b);
    });

    mostrarSeccion(tabs[0].id);
  }

  function mostrarSeccion(id) {
    var secciones = ["sec-nuevo", "sec-mios", "sec-sugerir", "sec-mias", "sec-novedades", "sec-reclamos", "sec-sugerencias", "sec-stats", "sec-usuarios"];
    secciones.forEach(function (s) { document.getElementById(s).hidden = (s !== id); });
    document.querySelectorAll("#nav .tab").forEach(function (t) {
      t.classList.toggle("active", t.dataset.target === id);
    });

    if (id === "sec-mios") cargarMios();
    if (id === "sec-mias") cargarMias();
    if (id === "sec-novedades") abrirNovedades();
    if (id === "sec-reclamos") cargarReclamos();
    if (id === "sec-sugerencias") cargarSugerencias();
    if (id === "sec-stats") setTimeout(cargarStats, 40);
    if (id === "sec-usuarios") cargarUsuarios();
  }

  /* ================================================================== */
  /*  Dashboard: Resumen                                                 */
  /* ================================================================== */

  /**
   * Llena el banner de resumen que va bajo el saludo. Para el vecino muestra
   * sus propias gestiones (reportes/sugerencias por estado). Para comité/admin
   * muestra el panorama completo de la comunidad usando la función RPC
   * resumen_dashboard.
   */
  async function cargarResumen() {
    var banner = document.getElementById("resumen-banner");
    if (!banner) return;
    banner.classList.add("cargando");
    var esVecino = rol === "vecino";

    if (esVecino) {
      // Vecino: datos personales SOLO
      var qs = [
        ["rec-abierto", "rec-proceso", "rec-cerrado"],
        ["sug-nueva", "sug-proceso", "sug-cerrada"]
      ];
      var qr = await SB.client.from("reclamos").select("estado").eq("creado_por", user.id).eq("eliminado", false);
      var qg = await SB.client.from("sugerencias").select("estado").eq("creado_por", user.id).eq("eliminado", false);
      banner.classList.remove("cargando");
      if (qr.error || qg.error) {
        var msje = SBH.esc(SBH.fmtErr((qr.error || qg.error).message));
        qs.forEach(function (grp) { grp.forEach(function (id) { var el = document.querySelector("[data-rb=\"" + id + "\"]"); if (el) el.textContent = "·"; }); });
        return;
      }
      var rec = { nuevo: 0, en_revision: 0, resuelto: 0 };
      (qr.data || []).forEach(function (r) { rec[r.estado] = (rec[r.estado] || 0) + 1; });
      var sug = { nueva: 0, en_revision: 0, resuelta: 0 };
      (qg.data || []).forEach(function (s) { sug[s.estado] = (sug[s.estado] || 0) + 1; });

      var textos = {
        "rec-abierto": function (n) { return n + " abierto" + (n === 1 ? "" : "s"); },
        "rec-proceso": function (n) { return n + " en proceso"; },
        "rec-cerrado": function (n) { return n + " cerrado" + (n === 1 ? "" : "s"); },
        "sug-nueva": function (n) { return n + " nueva" + (n === 1 ? "" : "s"); },
        "sug-proceso": function (n) { return n + " en proceso"; },
        "sug-cerrada": function (n) { return n + " cerrada" + (n === 1 ? "" : "s"); }
      };
      var valores = {
        "rec-abierto": rec.nuevo, "rec-proceso": rec.en_revision, "rec-cerrado": rec.resuelto,
        "sug-nueva": sug.nueva, "sug-proceso": sug.en_revision, "sug-cerrada": sug.resuelta
      };
      Object.keys(valores).forEach(function (k) {
        var el = document.querySelector("[data-rb=\"" + k + "\"]");
        if (el) el.textContent = textos[k](valores[k] || 0);
      });
    } else {
      // Admin/Comunidad: usa la RPC resumen_dashboard (agregados de toda la comunidad)
      var r = await SB.client.rpc("resumen_dashboard");
      banner.classList.remove("cargando");
      if (r.error) {
        var msje = SBH.esc(SBH.fmtErr(r.error.message));
        document.getElementById("resumen-banner").innerHTML = '<p class="hint">' + msje + "</p>";
        return;
      }
      var e = r.data || {};

      // Para admin: mostramos reportes y sugerencias por estado de la comunidad
      // y un bloque compacto de comunidad
      var rb = document.getElementById("resumen-banner");
      if (!rb) return;

      // Agrupamos los datos del dashboard en el formato del banner
      var rec = { nuevo: (e.reportes && e.reportes.nuevo) || 0, en_revision: (e.reportes && e.reportes.en_revision) || 0, resuelto: (e.reportes && e.reportes.resuelto) || 0 };
      var sug = { nueva: (e.sugerencias && e.sugerencias.nueva) || 0, en_revision: (e.sugerencias && e.sugerencias.en_revision) || 0, resuelta: (e.sugerencias && e.sugerencias.resuelta) || 0 };

      var textos = {
        "rec-abierto": function (n) { return n + " abierto" + (n === 1 ? "" : "s"); },
        "rec-proceso": function (n) { return n + " en proceso"; },
        "rec-cerrado": function (n) { return n + " cerrado" + (n === 1 ? "" : "s"); },
        "sug-nueva": function (n) { return n + " nueva" + (n === 1 ? "" : "s"); },
        "sug-proceso": function (n) { return n + " en proceso"; },
        "sug-cerrada": function (n) { return n + " cerrada" + (n === 1 ? "" : "s"); }
      };
      var valores = {
        "rec-abierto": rec.nuevo, "rec-proceso": rec.en_revision, "rec-cerrado": rec.resuelto,
        "sug-nueva": sug.nueva, "sug-proceso": sug.en_revision, "sug-cerrada": sug.resuelta
      };
      Object.keys(valores).forEach(function (k) {
        var el = document.querySelector("[data-rb=\"" + k + "\"]");
        if (el) el.textContent = textos[k](valores[k] || 0);
      });

      // También mostramos un bloque pequeño de comunidad debajo del banner
      var comunidadDiv = document.createElement("div");
      comunidadDiv.className = "resumen-banner-comunidad";
      comunidadDiv.innerHTML = `
        <div class="resumen-banner-grupo">
          <span class="resumen-banner-titulo">Vecinos registrados</span>
          <span class="rb-item" data-rb="com-vecinos">${e.vecinos || 0}</span>
        </div>
        <div class="resumen-banner-grupo">
          <span class="resumen-banner-titulo">Casas llenas</span>
          <span class="rb-item" data-rb="com-casas-llenas">${e.casas_llenas || 0}</span>
        </div>
        <div class="resumen-banner-grupo">
          <span class="resumen-banner-titulo">Reportes comunidad</span>
          <span class="rb-item" data-rb="com-reportes">${(e.reportes && e.reportes.total) || 0}</span>
        </div>
        <div class="resumen-banner-grupo">
          <span class="resumen-banner-titulo">Sugerencias comunidad</span>
          <span class="rb-item" data-rb="com-sugerencias">${(e.sugerencias && e.sugerencias.total) || 0}</span>
        </div>
      `;
      // Insertamos después del banner principal
      banner.parentNode.insertBefore(comunidadDiv, banner.nextSibling);
    }
  }

  async function boot() {
    if (!SB.configOk) {
      SBH.mostrar("msg", "Falta configurar config.js (URL y anon key de tu proyecto Supabase).", "error");
      return;
    }
    var gu = await SB.client.auth.getUser();
    user = gu.data.user || null;
    if (!user) { window.location.href = "index.html"; return; }

    var gp = await SB.client.from("profiles").select("*").eq("id", user.id).maybeSingle();
    if (gp.error && !gp.data) {
      SBH.mostrar("msg", SBH.fmtErr(gp.error.message), "error");
      return;
    }

    if (!gp.data) {
      document.getElementById("profiling").classList.remove("hidden");
      SBH.llenarCasas(document.getElementById("prof-casa"));
      return;
    }

    profile = gp.data;
    rol = profile.rol;

    document.getElementById("user-nombre").textContent = profile.nombre;
    document.getElementById("user-casa").textContent = profile.numero_casa ? "Casa " + profile.numero_casa : "Sin casa";
    var rl = document.getElementById("user-rol");
    rl.textContent = rol === "comite" ? "Comité" : rol === "admin" ? "Admin" : "Vecino";
    rl.className = "badge role-" + rol;

    var primer = String(profile.nombre).split(" ")[0];
    document.getElementById("welcome-tx").innerHTML =
      "¡Hola, " + SBH.esc(primer) + '! <span style="color:var(--sun-dark)">☀</span>';

    if (requiereCambioPass(user, profile)) {
      document.getElementById("app-main").classList.add("hidden");
      document.getElementById("card-cambiar-pass").classList.remove("hidden");
      SBH.mostrar("msg", "Por seguridad y transparencia, debes cambiar tu contraseña por defecto antes de continuar.", "error");
      return;
    }

    document.getElementById("card-cambiar-pass").classList.add("hidden");
    document.getElementById("app-main").classList.remove("hidden");

    llenarReclamoForm();
    llenarSugerenciaForm();
    vincularNovedades();

    await definirNav();
    cargarResumen();

    // Novedades: contar contra el último acceso conocido. No se marca como
    // leído aquí: eso ocurre al abrir la campana, para que las novedades sí
    // se muestren cuando el usuario entra (antes se avanzaba el baseline y la
    // lista salía vacía aunque la campana marcara un contador).
    vistoHasta = profile.ultimo_acceso || null;
    await actualizarNovedades();

    // Poll en vivo (cada 60 s) para detectar respuestas mientras la app está abierta
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(function () {
      if (SB.configOk && document.visibilityState === "visible") actualizarNovedades();
    }, 60000);
  }

  function requiereCambioPass(u, p) {
    if (!u) return false;
    if (p && p.debe_cambiar_pass === true) return true;
    var em = (u.email || "").toLowerCase();
    var esGenerica = (em === "administracion@casasdelparque7.cl" || em === "comite@casasdelparque7.cl");
    var cambiada = u.user_metadata && u.user_metadata.clave_cambiada;
    return esGenerica && !cambiada;
  }

  /* ------------------------------------------------------------------ */
  /*  Novedades (campana)                                                */
  /* ------------------------------------------------------------------ */

  function setBell(n) {
    var el = document.getElementById("bell-count");
    if (!el) return;
    if (n > 0) {
      el.textContent = n > 99 ? "99+" : String(n);
      el.hidden = false;
    } else {
      el.hidden = true;
    }
  }

  async function fetchNovedades() {
    if (!vistoHasta) return { contador: 0, novedades: [] };
    var res = await SB.client.rpc("mis_novedades", { p_desde: vistoHasta });
    if (res.error) return { contador: 0, novedades: [] };
    return { contador: res.data.contador || 0, novedades: res.data.novedades || [] };
  }

  /** Actualiza el badge de la campana (sin tocar el baseline). */
  async function actualizarNovedades() {
    var d = await fetchNovedades();
    novEdades = d.novedades || [];
    setBell(d.contador);
  }

  /** Al abrir la lista de novedades: renderiza y marca todo como visto. */
  async function abrirNovedades() {
    var wrap = document.getElementById("novedades-list");
    showLoading("novedades-list");

    var d = await fetchNovedades();
    var lista = d.novedades || [];

    if (!lista.length) {
      wrap.innerHTML = '<p class="hint">No tienes novedades. Te avisaremos cuando el comité responda o cambie el estado de tus reportes.</p>';
    } else {
      wrap.innerHTML = lista.map(tarjetaNovedad).join("");
      hidratarFotos(wrap);
    }

    // Marcar todo como visto
    await SB.client.rpc("marcar_acceso");
    vistoHasta = new Date().toISOString();
    setBell(0);
  }

  function tarjetaNovedad(n) {
    var resp = n.respuesta
      ? '<div class="respuesta-box"><b>Respuesta del comité:</b> ' + SBH.esc(n.respuesta) + "</div>" : "";
    var tipo = n.tipo === "reclamo" ? "Reporte" : "Sugerencia";
    var estilos = n.tipo === "reclamo"
      ? chip((SB.ESTADOS[n.estado] || n.estado), "estado-" + n.estado)
      : chip({ nueva: "Nueva", en_revision: "En revisión", resuelta: "Resuelta" }[n.estado] || n.estado, "estado-" + ({ nueva: "nuevo", en_revision: "en_revision", resuelta: "resuelto" }[n.estado] || n.estado));

    return (
      '<div class="reclamo novedad">' +
        '<div class="head">' +
          '<div>' +
            '<div class="titulo">' + SBH.esc(n.titulo) + "</div>" +
            '<div class="meta">' + tipo + " · " + SBH.fmtFecha(n.updated_at || n.created_at) + "</div>" +
          "</div>" +
          '<div>' + estilos + "</div>" +
        "</div>" +
        '<div class="desc">' + SBH.esc(n.descripcion) + "</div>" + resp + fotosHtml(n.fotos) +
      "</div>"
    );
  }

  function vincularNovedades() {
    if (_novedadesBound) return;
    _novedadesBound = true;
    var bell = document.getElementById("btn-novedades");
    if (bell) {
      bell.addEventListener("click", function () { mostrarSeccion("sec-novedades"); });
    }
  }

  /* ================================================================== */
  /*  VECINO: Nuevo reporte                                              */
  /* ================================================================== */

  function llenarReclamoForm() {
    var cat = document.getElementById("recl-categoria");
    if (cat && !cat.options.length) {
      Object.keys(SB.CATEGORIAS).forEach(function (k) {
        var o = document.createElement("option");
        o.value = k; o.textContent = SB.CATEGORIAS[k];
        cat.appendChild(o);
      });
    }

    vincularPicker("recl-fotos", "recl-fotos-preview", "recl-fotos-info", "fotosRecl");

    if (_reclamoBound) return;
    _reclamoBound = true;

    document.getElementById("reclamo-form").addEventListener("submit", async function (e) {
      e.preventDefault();
      SBH.mostrar("msg", "", "ok");
      var titulo = document.getElementById("recl-titulo").value.trim();
      var descripcion = document.getElementById("recl-descripcion").value.trim();
      if (titulo.length < 3 || titulo.length > 200) {
        SBH.mostrar("msg", "El título debe tener entre 3 y 200 caracteres.", "error");
        return;
      }
      if (descripcion.length < 10 || descripcion.length > 2000) {
        SBH.mostrar("msg", "La descripción del reporte debe tener al menos 10 y máximo 2000 caracteres.", "error");
        return;
      }

      var payload = {
        creado_por: user.id,
        numero_casa: profile.numero_casa,
        categoria: document.getElementById("recl-categoria").value,
        titulo: titulo,
        descripcion: descripcion
      };

      if (fotosRecl.length) {
        SBH.mostrar("msg", "Subiendo fotos...", "ok");
        var paths = await subirFotos(fotosRecl);
        if (!paths) return;
        payload.fotos = paths;
      }

      var ins = await SB.client.from("reclamos").insert([payload]);
      if (ins.error) { SBH.mostrar("msg", SBH.fmtErr(ins.error.message), "error"); return; }
      SBH.mostrar("msg", "Reporte enviado. El comité lo revisará.", "ok");
      e.target.reset();
      fotosRecl = [];
      limpiarPreview("recl-fotos-preview", "recl-fotos-info");
    });
  }

  /* ================================================================== */
  /*  VECINO: Nueva sugerencia                                           */
  /* ================================================================== */

  function llenarSugerenciaForm() {
    vincularPicker("sug-fotos", "sug-fotos-preview", "sug-fotos-info", "fotosSug");

    if (_sugerenciaBound) return;
    _sugerenciaBound = true;

    document.getElementById("sugerencia-form").addEventListener("submit", async function (e) {
      e.preventDefault();
      SBH.mostrar("msg", "", "ok");
      var titulo = document.getElementById("sug-titulo").value.trim();
      var descripcion = document.getElementById("sug-descripcion").value.trim();
      if (titulo.length < 3 || titulo.length > 200) {
        SBH.mostrar("msg", "El título de la sugerencia debe tener entre 3 y 200 caracteres.", "error");
        return;
      }
      if (descripcion.length < 10 || descripcion.length > 2000) {
        SBH.mostrar("msg", "El detalle de la sugerencia debe tener al menos 10 y máximo 2000 caracteres.", "error");
        return;
      }

      var payload = {
        creado_por: user.id,
        numero_casa: profile.numero_casa,
        titulo: titulo,
        descripcion: descripcion
      };

      if (fotosSug.length) {
        SBH.mostrar("msg", "Subiendo fotos...", "ok");
        var paths = await subirFotos(fotosSug);
        if (!paths) return;
        payload.fotos = paths;
      }

      var ins = await SB.client.from("sugerencias").insert([payload]);
      if (ins.error) { SBH.mostrar("msg", SBH.fmtErr(ins.error.message), "error"); return; }
      SBH.mostrar("msg", "Sugerencia enviada. El comité la revisará.", "ok");
      e.target.reset();
      fotosSug = [];
      limpiarPreview("sug-fotos-preview", "sug-fotos-info");
    });
  }

  /* ================================================================== */
  /*  FOTOS: picker, compresion y subida                                 */
  /* ================================================================== */

  /**
   * Vincula un input file multiple: guarda los archivos en el estado,
   * muestra miniaturas (clic para quitar) y limita a MAX_FOTOS.
   */
  function vincularPicker(inputId, previewId, infoId, stateKey) {
    var input = document.getElementById(inputId);
    if (!input) return;

    input.addEventListener("change", function () {
      var estado = (stateKey === "fotosRecl") ? fotosRecl : fotosSug;
      var files = Array.prototype.slice.call(input.files || []);
      var restantes = MAX_FOTOS - estado.length;
      estado = estado.concat(files.slice(0, restantes));
      if (stateKey === "fotosRecl") fotosRecl = estado; else fotosSug = estado;
      renderFotosPreview(previewId, infoId, stateKey);
      input.value = "";
    });
  }

  /** Re-dibuja las miniaturas desde el estado actual (clic para quitar). */
  function renderFotosPreview(previewId, infoId, stateKey) {
    var preview = document.getElementById(previewId);
    var info = document.getElementById(infoId);
    if (!preview) return;
    var estado = (stateKey === "fotosRecl") ? fotosRecl : fotosSug;
    preview.innerHTML = "";
    estado.forEach(function (f, idx) {
      var img = document.createElement("img");
      img.className = "foto-thumb";
      img.dataset.idx = idx;
      img.alt = "Vista previa";
      img.src = URL.createObjectURL(f);
      img.addEventListener("click", function () {
        URL.revokeObjectURL(img.src);
        var arr = (stateKey === "fotosRecl") ? fotosRecl : fotosSug;
        arr.splice(parseInt(img.dataset.idx, 10), 1);
        if (stateKey === "fotosRecl") fotosRecl = arr; else fotosSug = arr;
        renderFotosPreview(previewId, infoId, stateKey);
      });
      preview.appendChild(img);
    });
    if (info) {
      info.textContent = estado.length
        ? estado.length + " de " + MAX_FOTOS + (MAX_FOTOS === 1 ? " foto seleccionada (clic para quitar)" : " fotos seleccionadas (clic para quitar)")
        : "";
    }
  }

  function limpiarPreview(previewId, infoId) {
    var p = document.getElementById(previewId);
    var i = document.getElementById(infoId);
    if (p) p.innerHTML = "";
    if (i) i.textContent = "";
  }

  /**
   * Comprime una imagen a <= MAX_SIDE px y la devuelve como Blob JPEG.
   */
  function resizeImage(file, maxSide) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () {
        var w = img.width, h = img.height;
        var scale = Math.min(1, maxSide / Math.max(w, h));
        var cw = Math.round(w * scale), ch = Math.round(h * scale);
        var c = document.createElement("canvas");
        c.width = cw; c.height = ch;
        c.getContext("2d").drawImage(img, 0, 0, cw, ch);
        c.toBlob(function (blob) {
          if (blob) resolve(blob); else reject(new Error("No se pudo procesar la imagen."));
        }, "image/jpeg", 0.82);
      };
      img.onerror = function () { reject(new Error("Imagen inválida.")); };
      img.src = URL.createObjectURL(file);
    });
  }

  /**
   * Sube todas las fotos al bucket privado "reportes/{user.id}/" y
   * devuelve los paths (o null si algo falla).
   *
   * Defensa en dos capas:
   *   - Antes de subir: rechazo client-side si la foto comprimida supera
   *     5 MB (la politica de storage tambien lo valida en la base de datos).
   *   - La subida siempre es JPEG (la imagen se re-comprime abajo).
   */
  async function subirFotos(files) {
    var MAX_BYTES = 5 * 1024 * 1024; // 5 MB
    var paths = [];
    for (var i = 0; i < files.length; i++) {
      try {
        var blob = await resizeImage(files[i], 1280);
        if (blob.size > MAX_BYTES) {
          SBH.mostrar("msg", "La foto supera los 5 MB incluso comprimida. Prueba con una de menor resolución.", "error");
          return null;
        }
        var path = user.id + "/" + uid() + ".jpg";
        var up = await SB.client.storage.from("reportes").upload(path, blob, { contentType: "image/jpeg" });
        if (up.error) {
          SBH.mostrar("msg", "No se pudo subir una foto: " + SBH.fmtErr(up.error.message), "error");
          return null;
        }
        paths.push(path);
      } catch (ex) {
        SBH.mostrar("msg", "No se pudo procesar una foto: " + ex.message, "error");
        return null;
      }
    }
    return paths;
  }

  /* ================================================================== */
  /*  VECINO: Mis sugerencias                                            */
  /* ================================================================== */

  async function cargarMias() {
    showLoading("mias-list");
    var wrap = document.getElementById("mias-list");
    var q = await SB.client.from("sugerencias")
      .select("*")
      .eq("creado_por", user.id)
      .eq("eliminado", false)
      .order("created_at", { ascending: false });
    if (q.error) { wrap.innerHTML = '<p class="hint">' + SBH.esc(SBH.fmtErr(q.error.message)) + "</p>"; return; }
    if (!q.data.length) { wrap.innerHTML = '<p class="hint">Aún no has enviado sugerencias.</p>'; return; }
    wrap.innerHTML = q.data.map(tarjetaSugerenciaMia).join("");
    hidratarFotos(wrap);
  }

  function tarjetaSugerenciaMia(s) {
    var resp = s.respuesta
      ? '<div class="respuesta-box"><b>Respuesta del comité:</b> ' + SBH.esc(s.respuesta) + "</div>" : "";
    return (
      '<div class="reclamo">' +
        '<div class="head">' +
          '<div>' +
            '<div class="titulo">' + SBH.esc(s.titulo) + "</div>" +
            '<div class="meta">' + SBH.fmtFecha(s.created_at) + "</div>" +
          "</div>" +
          '<div>' + chip({ nueva: "Nueva", en_revision: "En revisión", resuelta: "Resuelta" }[s.estado] || s.estado, "estado-" + ({ nueva: "nuevo", en_revision: "en_revision", resuelta: "resuelto" }[s.estado] || s.estado)) + "</div>" +
        "</div>" +
        '<div class="desc">' + SBH.esc(s.descripcion) + "</div>" + resp + fotosHtml(s.fotos) +
      "</div>"
    );
  }

  /* ================================================================== */
  /*  VECINO: Mis reclamos                                               */
  /* ================================================================== */

  async function cargarMios() {
    showLoading("mios-list");
    var wrap = document.getElementById("mios-list");
    var q = await SB.client.from("reclamos")
      .select("*")
      .eq("creado_por", user.id)
      .eq("eliminado", false)
      .order("created_at", { ascending: false });
    if (q.error) { wrap.innerHTML = '<p class="hint">' + SBH.esc(SBH.fmtErr(q.error.message)) + "</p>"; return; }
    if (!q.data.length) { wrap.innerHTML = '<p class="hint">Aún no has enviado reportes.</p>'; return; }
    wrap.innerHTML = q.data.map(tarjetaReclamo).join("");
    hidratarFotos(wrap);
  }

  function tarjetaReclamo(r) {
    var resp = r.respuesta
      ? '<div class="respuesta-box"><b>Respuesta del comité:</b> ' + SBH.esc(r.respuesta) + "</div>" : "";
    return (
      '<div class="reclamo">' +
        '<div class="head">' +
          '<div>' +
            '<div class="titulo">' + SBH.esc(r.titulo) + "</div>" +
            '<div class="meta">' + SBH.esc(SBH.catLabel(r.categoria)) +
              " · " + SBH.fmtFecha(r.created_at) + "</div>" +
          "</div>" +
          '<div>' + chip(SB.ESTADOS[r.estado] || r.estado, "estado-" + r.estado) + "</div>" +
        "</div>" +
        '<div class="desc">' + SBH.esc(r.descripcion) + "</div>" + resp + fotosHtml(r.fotos) +
      "</div>"
    );
  }

  /* ================================================================== */
  /*  COMITE/ADMIN: Reportes de la comunidad                             */
  /* ================================================================== */

  async function cargarReclamos() {
    showLoading("reclamos-list");
    var wrap = document.getElementById("reclamos-list");
    var q = await SB.client.rpc("reclamos_detalle");
    if (q.error) { wrap.innerHTML = '<p class="hint">' + SBH.esc(SBH.fmtErr(q.error.message)) + "</p>"; return; }
    recCache = q.data || [];
    recPage = 1;
    rendReclamos();
  }

  function rendReclamos() {
    var wrap = document.getElementById("reclamos-list");
    var lista = recCache.filter(function (r) {
      if (busquedaRec) {
        var txt = (r.titulo + " " + r.descripcion + " " + (r.nombre || "") + " casa " + r.numero_casa).toLowerCase();
        if (txt.indexOf(busquedaRec) === -1) return false;
      }
      return true;
    });
    if (!lista.length) {
      wrap.innerHTML = recCache.length
        ? '<p class="hint">No hay reportes que coincidan con la búsqueda.</p>'
        : '<p class="hint">No hay reportes aún.</p>';
      return;
    }

    var total = lista.length;
    var totalPages = Math.ceil(total / PAGE_SIZE);
    if (recPage > totalPages) recPage = totalPages;
    var start = (recPage - 1) * PAGE_SIZE;
    var page = lista.slice(start, start + PAGE_SIZE);

    wrap.innerHTML = page.map(tarjetaComite).join("") + renderPagination(total, recPage, totalPages, "rec");
    bindResponder();
    bindPagination("rec", function (p) { recPage = p; rendReclamos(); });
    hidratarFotos(wrap);
  }

  function tarjetaComite(r) {
    var resp = r.respuesta
      ? '<div class="respuesta-box"><b>Respuesta:</b> ' + SBH.esc(r.respuesta) + "</div>" : "";
    var acciones =
      '<div class="admin-acciones">' +
        '<button class="btn ghost sm btn-archivar" type="button">🗄 Archivar</button>' +
        (rol === "admin" ? '<button class="btn ghost sm danger btn-borrar" type="button">🗑 Borrar</button>' : "") +
      "</div>";
    return (
      '<div class="reclamo" data-id="' + r.id + '">' +
        '<div class="head">' +
          '<div>' +
            '<div class="titulo">' + SBH.esc(r.titulo) + "</div>" +
            '<div class="meta"><b>Casa ' + r.numero_casa + "</b>" +
              (r.nombre ? " · " + SBH.esc(r.nombre) : "") +
              " · " + SBH.fmtFecha(r.created_at) + "</div>" +
          "</div>" +
          '<div>' + chip(SB.ESTADOS[r.estado] || r.estado, "estado-" + r.estado) + "</div>" +
        "</div>" +
        '<div class="meta">Categoría: ' + SBH.esc(SBH.catLabel(r.categoria)) + "</div>" +
        '<div class="desc">' + SBH.esc(r.descripcion) + "</div>" + resp + fotosHtml(r.fotos) +
        '<form class="responder" style="margin-top:12px; display:grid; gap:8px;">' +
          '<div class="grid-2">' +
            '<label>Estado<select class="resp-estado">' +
              '<option value="nuevo"' + (r.estado === "nuevo" ? " selected" : "") + ">Nuevo</option>" +
              '<option value="en_revision"' + (r.estado === "en_revision" ? " selected" : "") + ">En revisión</option>" +
              '<option value="resuelto"' + (r.estado === "resuelto" ? " selected" : "") + ">Resuelto</option>" +
            "</select></label>" +
            '<div style="align-self:end"><button class="btn primary" type="submit">Guardar</button></div>' +
          "</div>" +
          '<label>Respuesta<textarea class="resp-texto" rows="3">' + SBH.esc(r.respuesta || "") + "</textarea></label>" +
        "</form>" +
        acciones +
      "</div>"
    );
  }

  function bindResponder() {
    document.querySelectorAll("#reclamos-list .responder").forEach(function (f) {
      f.addEventListener("submit", async function (e) {
        e.preventDefault();
        var card = f.closest(".reclamo");
        var id = card.dataset.id;
        var estado = f.querySelector(".resp-estado").value;
        var texto = f.querySelector(".resp-texto").value.trim();
        if (estado === "resuelto") {
          var ok = await borrarFotosDeTarjeta(card);
          if (!ok) return;
        }
        var r = await SB.client.rpc("responder_reclamo", {
          p_id: id, p_estado: estado, p_respuesta: texto || null
        });
        if (r.error) { SBH.mostrar("msg", SBH.fmtErr(r.error.message), "error"); return; }
        SBH.mostrar("msg", "Reporte actualizado.", "ok");
        cargarReclamos();
      });
    });

    document.querySelectorAll("#reclamos-list .btn-archivar").forEach(function (b) {
      b.addEventListener("click", async function (e) {
        e.preventDefault();
        var card = b.closest(".reclamo");
        var id = card.dataset.id;
        if (!confirm("¿Archivar este reporte? Quedará oculto para todos.")) return;
        var r = await SB.client.rpc("archivar_reclamo", { p_id: id, p_archivar: true });
        if (r.error) { SBH.mostrar("msg", SBH.fmtErr(r.error.message), "error"); return; }
        SBH.mostrar("msg", "Reporte archivado.", "ok");
        cargarReclamos();
      });
    });

    document.querySelectorAll("#reclamos-list .btn-borrar").forEach(function (b) {
      b.addEventListener("click", async function (e) {
        e.preventDefault();
        var card = b.closest(".reclamo");
        var id = card.dataset.id;
        if (!confirm("⚠️ ¿BORRAR DEFINITIVAMENTE este reporte? Esta acción no se puede deshacer.")) return;
        var r = await SB.client.rpc("borrar_reclamo", { p_id: id });
        if (r.error) { SBH.mostrar("msg", SBH.fmtErr(r.error.message), "error"); return; }
        SBH.mostrar("msg", "Reporte borrado.", "ok");
        cargarReclamos();
      });
    });
  }

  /* ================================================================== */
  /*  COMITE/ADMIN: Sugerencias de la comunidad                          */
  /* ================================================================== */

  async function cargarSugerencias() {
    showLoading("sugerencias-list");
    var wrap = document.getElementById("sugerencias-list");
    var q = await SB.client.rpc("sugerencias_detalle");
    if (q.error) { wrap.innerHTML = '<p class="hint">' + SBH.esc(SBH.fmtErr(q.error.message)) + "</p>"; return; }
    sugCache = q.data || [];
    sugPage = 1;
    rendSugerencias();
  }

  function rendSugerencias() {
    var wrap = document.getElementById("sugerencias-list");
    var lista = sugCache.filter(function (s) {
      if (busquedaSug) {
        var txt = (s.titulo + " " + s.descripcion + " " + (s.nombre || "") + " casa " + s.numero_casa).toLowerCase();
        if (txt.indexOf(busquedaSug) === -1) return false;
      }
      return true;
    });
    if (!lista.length) {
      wrap.innerHTML = sugCache.length
        ? '<p class="hint">No hay sugerencias que coincidan con la búsqueda.</p>'
        : '<p class="hint">No hay sugerencias aún.</p>';
      return;
    }

    var total = lista.length;
    var totalPages = Math.ceil(total / PAGE_SIZE);
    if (sugPage > totalPages) sugPage = totalPages;
    var start = (sugPage - 1) * PAGE_SIZE;
    var page = lista.slice(start, start + PAGE_SIZE);

    wrap.innerHTML = page.map(tarjetaSugerencia).join("") + renderPagination(total, sugPage, totalPages, "sug");
    bindResponderSug();
    bindPagination("sug", function (p) { sugPage = p; rendSugerencias(); });
    hidratarFotos(wrap);
  }

  function tarjetaSugerencia(s) {
    var resp = s.respuesta
      ? '<div class="respuesta-box"><b>Respuesta:</b> ' + SBH.esc(s.respuesta) + "</div>" : "";
    var map = { nueva: "nuevo", en_revision: "en_revision", resuelta: "resuelto" };
    var acciones =
      '<div class="admin-acciones">' +
        '<button class="btn ghost sm btn-archivar" type="button">🗄 Archivar</button>' +
        (rol === "admin" ? '<button class="btn ghost sm danger btn-borrar" type="button">🗑 Borrar</button>' : "") +
      "</div>";
    return (
      '<div class="reclamo" data-id="' + s.id + '">' +
        '<div class="head">' +
          '<div>' +
            '<div class="titulo">' + SBH.esc(s.titulo) + "</div>" +
            '<div class="meta"><b>Casa ' + s.numero_casa + "</b>" +
              (s.nombre ? " · " + SBH.esc(s.nombre) : "") +
              " · " + SBH.fmtFecha(s.created_at) + "</div>" +
          "</div>" +
          '<div>' + chip({ nueva: "Nueva", en_revision: "En revisión", resuelta: "Resuelta" }[s.estado] || s.estado, "estado-" + (map[s.estado] || s.estado)) + "</div>" +
        "</div>" +
        '<div class="desc">' + SBH.esc(s.descripcion) + "</div>" + resp + fotosHtml(s.fotos) +
        '<form class="responder" style="margin-top:12px; display:grid; gap:8px;">' +
          '<div class="grid-2">' +
            '<label>Estado<select class="resp-estado">' +
              '<option value="nueva"' + (s.estado === "nueva" ? " selected" : "") + ">Nueva</option>" +
              '<option value="en_revision"' + (s.estado === "en_revision" ? " selected" : "") + ">En revisión</option>" +
              '<option value="resuelta"' + (s.estado === "resuelta" ? " selected" : "") + ">Resuelta</option>" +
            "</select></label>" +
            '<div style="align-self:end"><button class="btn primary" type="submit">Guardar</button></div>' +
          "</div>" +
          '<label>Respuesta<textarea class="resp-texto" rows="3">' + SBH.esc(s.respuesta || "") + "</textarea></label>" +
        "</form>" +
        acciones +
      "</div>"
    );
  }

  function bindResponderSug() {
    document.querySelectorAll("#sugerencias-list .responder").forEach(function (f) {
      f.addEventListener("submit", async function (e) {
        e.preventDefault();
        var card = f.closest(".reclamo");
        var id = card.dataset.id;
        var estado = f.querySelector(".resp-estado").value;
        var texto = f.querySelector(".resp-texto").value.trim();
        if (estado === "resuelta") {
          var ok = await borrarFotosDeTarjeta(card);
          if (!ok) return;
        }
        var r = await SB.client.rpc("responder_sugerencia", {
          p_id: id, p_estado: estado, p_respuesta: texto || null
        });
        if (r.error) { SBH.mostrar("msg", SBH.fmtErr(r.error.message), "error"); return; }
        SBH.mostrar("msg", "Sugerencia actualizada.", "ok");
        cargarSugerencias();
      });
    });

    document.querySelectorAll("#sugerencias-list .btn-archivar").forEach(function (b) {
      b.addEventListener("click", async function (e) {
        e.preventDefault();
        var card = b.closest(".reclamo");
        var id = card.dataset.id;
        if (!confirm("¿Archivar esta sugerencia? Quedará oculta para todos.")) return;
        var r = await SB.client.rpc("archivar_sugerencia", { p_id: id, p_archivar: true });
        if (r.error) { SBH.mostrar("msg", SBH.fmtErr(r.error.message), "error"); return; }
        SBH.mostrar("msg", "Sugerencia archivada.", "ok");
        cargarSugerencias();
      });
    });

    document.querySelectorAll("#sugerencias-list .btn-borrar").forEach(function (b) {
      b.addEventListener("click", async function (e) {
        e.preventDefault();
        var card = b.closest(".reclamo");
        var id = card.dataset.id;
        if (!confirm("⚠️ ¿BORRAR DEFINITIVAMENTE esta sugerencia? Esta acción no se puede deshacer.")) return;
        var r = await SB.client.rpc("borrar_sugerencia", { p_id: id });
        if (r.error) { SBH.mostrar("msg", SBH.fmtErr(r.error.message), "error"); return; }
        SBH.mostrar("msg", "Sugerencia borrada.", "ok");
        cargarSugerencias();
      });
    });
  }

  /* ================================================================== */
  /*  Paginacion                                                         */
  /* ================================================================== */

  function renderPagination(total, current, totalPages, prefix) {
    if (totalPages <= 1) return "";
    return (
      '<div style="display:flex;align-items:center;justify-content:center;gap:12px;margin-top:16px;">' +
        '<button class="btn ghost sm" type="button" id="' + prefix + '-prev"' +
          (current <= 1 ? " disabled" : "") + '>Anterior</button>' +
        '<span style="font-size:13px;font-weight:700;color:var(--muted);">' +
          current + ' / ' + totalPages + ' (' + total + ' registros)</span>' +
        '<button class="btn ghost sm" type="button" id="' + prefix + '-next"' +
          (current >= totalPages ? " disabled" : "") + '>Siguiente</button>' +
      '</div>'
    );
  }

  function bindPagination(prefix, onPageChange) {
    var prev = document.getElementById(prefix + "-prev");
    var next = document.getElementById(prefix + "-next");
    if (prev) prev.addEventListener("click", function () {
      var cur = prefix === "rec" ? recPage : sugPage;
      if (cur > 1) onPageChange(cur - 1);
    });
    if (next) next.addEventListener("click", function () {
      var cur = prefix === "rec" ? recPage : sugPage;
      onPageChange(cur + 1);
    });
  }

  /* ================================================================== */
  /*  Exportar CSV                                                       */
  /* ================================================================== */

  function exportarCSV(datos, nombreArchivo, columnas) {
    if (!datos || !datos.length) {
      SBH.mostrar("msg", "No hay datos para exportar.", "error");
      return;
    }
    var contenido = (window.PURE && window.PURE.construirCSV)
      ? window.PURE.construirCSV(datos, columnas)
      : "";
    if (!contenido) { SBH.mostrar("msg", "No hay datos para exportar.", "error"); return; }
    var csvContent = "\uFEFF" + contenido;
    var blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = nombreArchivo;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function exportarCSVReclamos() {
    var cols = [
      { label: "Casa", val: function (r) { return r.numero_casa; } },
      { label: "Vecino", val: function (r) { return r.nombre || ""; } },
      { label: "Título", val: function (r) { return r.titulo; } },
      { label: "Categoría", val: function (r) { return SBH.catLabel(r.categoria); } },
      { label: "Estado", val: function (r) { return SB.ESTADOS[r.estado] || r.estado; } },
      { label: "Descripción", val: function (r) { return r.descripcion; } },
      { label: "Fotos", val: function (r) { return (r.fotos || []).length; } },
      { label: "Respuesta Comité", val: function (r) { return r.respuesta || ""; } },
      { label: "Atendido por", val: function (r) { return r.atendido_nombre || ""; } },
      { label: "Fecha creación", val: function (r) { return SBH.fmtFecha(r.created_at); } }
    ];
    exportarCSV(recCache, "reclamos_casas_del_parque_7.csv", cols);
  }

  function exportarCSVSugerencias() {
    var cols = [
      { label: "Casa", val: function (s) { return s.numero_casa; } },
      { label: "Vecino", val: function (s) { return s.nombre || ""; } },
      { label: "Título", val: function (s) { return s.titulo; } },
      { label: "Estado", val: function (s) { return { nueva: "Nueva", en_revision: "En revisión", resuelta: "Resuelta" }[s.estado] || s.estado; } },
      { label: "Detalle", val: function (s) { return s.descripcion; } },
      { label: "Fotos", val: function (s) { return (s.fotos || []).length; } },
      { label: "Respuesta Comité", val: function (s) { return s.respuesta || ""; } },
      { label: "Atendido por", val: function (s) { return s.atendido_nombre || ""; } },
      { label: "Fecha creación", val: function (s) { return SBH.fmtFecha(s.created_at); } }
    ];
    exportarCSV(sugCache, "sugerencias_casas_del_parque_7.csv", cols);
  }

  /* ================================================================== */
  /*  Estadisticas                                                       */
  /* ================================================================== */

  async function cargarStats() {
    var s = await SB.client.rpc("estadisticas");
    if (s.error) { SBH.mostrar("msg", SBH.fmtErr(s.error.message), "error"); return; }
    var e = s.data || {};
    var pure = window.PURE || {};
    var fmtMes = pure.fmtMes || SBStats.fmtMes;

    var grid = document.getElementById("stats-grid");
    grid.innerHTML =
      statCard(e.total || 0, "Reportes totales") +
      statCard(e.por_estado && e.por_estado.nuevo || 0, "Nuevos") +
      statCard(e.por_estado && e.por_estado.en_revision || 0, "En revisión") +
      statCard(e.por_estado && e.por_estado.resuelto || 0, "Resueltos");

    SBStats.drawBars(
      document.getElementById("chart-estado"),
      Object.keys(e.por_estado || {}).map(function (k) { return SB.ESTADOS[k] || k; }),
      Object.values(e.por_estado || {})
    );
    SBStats.drawBars(
      document.getElementById("chart-categoria"),
      Object.keys(e.por_categoria || {}).map(function (k) { return SBH.catLabel(k); }),
      Object.values(e.por_categoria || {})
    );
    var meses = (e.por_mes || []).map(function (m) { return fmtMes(m.mes); });
    var cant = (e.por_mes || []).map(function (m) { return m.cantidad; });
    SBStats.drawBars(document.getElementById("chart-mes"), meses, cant);

    var gridSug = document.getElementById("stats-grid-sug");
    gridSug.innerHTML =
      statCard(e.sug_total || 0, "Sugerencias totales") +
      statCard(e.sug_por_estado && e.sug_por_estado.nueva || 0, "Nuevas") +
      statCard(e.sug_por_estado && e.sug_por_estado.en_revision || 0, "En revisión") +
      statCard(e.sug_por_estado && e.sug_por_estado.resuelta || 0, "Resueltas");

    SBStats.drawBars(
      document.getElementById("chart-sug-estado"),
      Object.keys(e.sug_por_estado || {}).map(function (k) {
        return { nueva: "Nueva", en_revision: "En revisión", resuelta: "Resuelta" }[k] || k;
      }),
      Object.values(e.sug_por_estado || {})
    );
    var sugMes = (e.sug_por_mes || []).map(function (m) { return fmtMes(m.mes); });
    var sugCant = (e.sug_por_mes || []).map(function (m) { return m.cantidad; });
    SBStats.drawBars(document.getElementById("chart-sug-mes"), sugMes, sugCant);
  }

  function statCard(num, lbl) {
    return '<div class="stat"><div class="num">' + num + '</div><div class="lbl">' + SBH.esc(lbl) + "</div></div>";
  }

  /* ================================================================== */
  /*  Admin: Gestion de usuarios                                         */
  /* ================================================================== */

  async function cargarUsuarios() {
    showLoading("usuarios-list");
    var wrap = document.getElementById("usuarios-list");
    if (rol !== "admin") { wrap.innerHTML = '<p class="hint">Solo admin.</p>'; return; }
    var q = await SB.client.from("profiles").select("id,nombre,numero_casa,rol,created_at").order("numero_casa");
    if (q.error) { wrap.innerHTML = '<p class="hint">' + SBH.esc(SBH.fmtErr(q.error.message)) + "</p>"; return; }
    if (!q.data.length) { wrap.innerHTML = '<p class="hint">No hay usuarios registrados.</p>'; return; }

    var rolLabels = { vecino: "Vecino", comite: "Comité", admin: "Admin" };
    wrap.innerHTML = q.data.map(function (p) {
      return (
        '<div class="user-row" data-id="' + p.id + '">' +
          '<div><div class="nm">' + SBH.esc(p.nombre) + '</div>' +
          '<div class="dt">' + (p.numero_casa ? "Casa " + p.numero_casa : "Sin casa") + " · " + (rolLabels[p.rol] || p.rol) + "</div></div>" +
          '<select class="urol">' +
            '<option value="vecino"' + (p.rol === "vecino" ? " selected" : "") + ">Vecino</option>" +
            '<option value="comite"' + (p.rol === "comite" ? " selected" : "") + ">Comité</option>" +
            '<option value="admin"' + (p.rol === "admin" ? " selected" : "") + ">Admin</option>" +
          "</select>" +
          '<button class="btn ghost sm ubtn">Guardar</button>' +
        "</div>"
      );
    }).join("");

    wrap.querySelectorAll(".user-row").forEach(function (row) {
      row.querySelector(".ubtn").addEventListener("click", async function () {
        var id = row.dataset.id;
        var nuevoRol = row.querySelector(".urol").value;
        var nombreUsuario = row.querySelector(".nm").textContent;
        var rolActual = row.querySelector(".dt").textContent.split(" · ").pop();
        var nuevoRolLabel = rolLabels[nuevoRol] || nuevoRol;

        if (!confirm("¿Estás seguro de cambiar el rol de \"" + nombreUsuario + "\" de " + rolActual + " a " + nuevoRolLabel + "?")) {
          return;
        }

        var r = await SB.client.rpc("asignar_rol", { p_usuario: id, p_rol: nuevoRol });
        if (r.error) { SBH.mostrar("msg", SBH.fmtErr(r.error.message), "error"); return; }
        SBH.mostrar("msg", "Rol actualizado.", "ok");
        cargarUsuarios();
      });
    });
  }

  /* ================================================================== */
  /*  Event listeners principales (DOMContentLoaded)                    */
  /* ================================================================== */

  document.addEventListener("DOMContentLoaded", function () {
    if (!document.getElementById("app-main")) return;

    document.getElementById("btn-logout").addEventListener("click", async function () {
      await SB.client.auth.signOut();
      window.location.href = "index.html";
    });

    var btnCambiarPass = document.getElementById("btn-cambiar-pass");
    if (btnCambiarPass) {
      btnCambiarPass.addEventListener("click", function () {
        document.getElementById("app-main").classList.add("hidden");
        document.getElementById("card-cambiar-pass").classList.remove("hidden");
        SBH.mostrar("msg", "Ingresa tu nueva contraseña a continuación.", "ok");
      });
    }

    var formCambiarPass = document.getElementById("form-cambiar-pass");
    if (formCambiarPass) {
      formCambiarPass.addEventListener("submit", async function (e) {
        e.preventDefault();
        SBH.mostrar("msg", "", "ok");
        var p1 = document.getElementById("pass-nueva").value;
        var p2 = document.getElementById("pass-confirmar").value;
        if (p1.length < 6) {
          SBH.mostrar("msg", "La contraseña debe tener al menos 6 caracteres.", "error");
          return;
        }
        if (p1 !== p2) {
          SBH.mostrar("msg", "Las contraseñas no coinciden. Revisa e inténtalo de nuevo.", "error");
          return;
        }

        var btn = document.getElementById("btn-save-pass");
        btn.disabled = true;
        btn.textContent = "Actualizando...";

        var up = await SB.client.auth.updateUser({
          password: p1,
          data: { clave_cambiada: true }
        });
        btn.disabled = false;
        btn.textContent = "Actualizar contraseña";

        if (up.error) {
          SBH.mostrar("msg", SBH.fmtErr(up.error.message), "error");
          return;
        }

        await SB.client.rpc("marcar_clave_cambiada");
        if (profile) profile.debe_cambiar_pass = false;
        if (user) {
          user.user_metadata = user.user_metadata || {};
          user.user_metadata.clave_cambiada = true;
        }

        SBH.mostrar("msg", "¡Contraseña actualizada exitosamente!", "ok");
        document.getElementById("card-cambiar-pass").classList.add("hidden");
        document.getElementById("app-main").classList.remove("hidden");
        boot();
      });
    }

    document.getElementById("profiling-form").addEventListener("submit", async function (e) {
      e.preventDefault();
      var nombre = document.getElementById("prof-name").value.trim();
      var casa = parseInt(document.getElementById("prof-casa").value, 10);
      var pr = await SB.client.rpc("registrar_perfil", { p_nombre: nombre, p_casa: casa, p_rol: "vecino" });
      if (pr.error) { SBH.mostrar("msg", SBH.fmtErr(pr.error.message), "error"); return; }
      boot();
    });

    var fBuscarRec = document.getElementById("filtro-buscar-reclamo");
    if (fBuscarRec) {
      fBuscarRec.addEventListener("input", function () {
        busquedaRec = fBuscarRec.value.trim().toLowerCase();
        recPage = 1;
        rendReclamos();
      });
    }

    var fBuscarSug = document.getElementById("filtro-buscar-sugerencia");
    if (fBuscarSug) {
      fBuscarSug.addEventListener("input", function () {
        busquedaSug = fBuscarSug.value.trim().toLowerCase();
        sugPage = 1;
        rendSugerencias();
      });
    }

    var btnExpRec = document.getElementById("btn-exportar-reclamos");
    if (btnExpRec) btnExpRec.addEventListener("click", function () { exportarCSVReclamos(); });

    var btnExpSug = document.getElementById("btn-exportar-sugerencias");
    if (btnExpSug) btnExpSug.addEventListener("click", function () { exportarCSVSugerencias(); });

    boot();
  });
})();