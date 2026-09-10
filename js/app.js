/**
 * app.js — Panel principal de la aplicacion.
 *
 * Se ejecuta exclusivamente en app.html. Maneja:
 *   - Sesion y perfil del usuario (carga, validacion, cambio de contrasena)
 *   - Navegacion por pestaas (vecino vs comite/admin)
 *   - CRUD de reclamos y sugerencias (envio, listado, respuesta)
 *   - Estadisticas comunitarias con graficos Canvas
 *   - Exportacion a CSV compatible con Excel
 *   - Gestion de usuarios (solo admin)
 *
 * Seguridad:
 *   - Todas las operaciones de lectura/escritura van contra Supabase
 *   - Las restricciones de acceso las controla RLS en PostgreSQL
 *   - Las funciones RPC (reclamos_detalle, responder_reclamo, etc.)
 *     validan el rol del usuario dentro de SECURITY DEFINER
 *
 * Mejoras aplicadas:
 *   - Flags para evitar duplicacion de event listeners (#4)
 *   - Loading states en todas las secciones (#5)
 *   - Confirmacion antes de cambiar rol de usuario (#6)
 *   - Paginacion en listas de reclamos/sugerencias (#9)
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
  /*  Flags para evitar duplicacion de event listeners (#4)              */
  /*                                                                     */
  /*  Problema: boot() se llama al cargar la pagina Y despues de cambiar */
  /*  contrasena. Sin estos flags, llenarReclamoForm() y                */
  /*  llenarSugerenciaForm() adjuntarian listeners duplicados.          */
  /* ------------------------------------------------------------------ */
  var _reclamoBound = false;
  var _sugerenciaBound = false;

  /* ------------------------------------------------------------------ */
  /*  Paginacion (#9)                                                    */
  /*                                                                     */
  /*  Muestra 20 registros por pagina en las listas de comite/admin.    */
  /*  Las listas del vecino (mis reclamos / mis sugerencias) no se      */
  /*  paginan porque normalmente son pocas.                             */
  /* ------------------------------------------------------------------ */
  var PAGE_SIZE = 20;
  var recPage = 1;
  var sugPage = 1;

  /* ------------------------------------------------------------------ */
  /*  Helpers                                                            */
  /* ------------------------------------------------------------------ */

  /** Genera un badge HTML para chips de estado. */
  function chip(txt, css) {
    return '<span class="chip ' + css + '">' + SBH.esc(txt) + "</span>";
  }

  /** Muestra texto de carga mientras se obtienen datos del servidor. */
  function showLoading(wrapId) {
    var wrap = document.getElementById(wrapId);
    if (wrap) wrap.innerHTML = '<p class="hint">Cargando...</p>';
  }

  /* ------------------------------------------------------------------ */
  /*  Sesion / perfil                                                    */
  /* ------------------------------------------------------------------ */

  /**
   * Construye la barra de navegacion por pestanas segun el rol del usuario.
   * - Vecino: Nuevo, Mis Reclamos, Sugerir, Mis Sugerencias, Estadisticas
   * - Comite/Admin: Reclamos, Sugerencias, Estadisticas (, Usuarios si admin)
   */
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

  /**
   * Muestra una seccion ocultando todas las demas.
   * Tambien dispara la carga de datos cuando la seccion lo requiere.
   */
  function mostrarSeccion(id) {
    var secciones = ["sec-nuevo", "sec-mios", "sec-sugerir", "sec-mias", "sec-reclamos", "sec-sugerencias", "sec-stats", "sec-usuarios"];
    secciones.forEach(function (s) { document.getElementById(s).hidden = (s !== id); });
    document.querySelectorAll("#nav .tab").forEach(function (t) {
      t.classList.toggle("active", t.dataset.target === id);
    });

    if (id === "sec-mios") cargarMios();
    if (id === "sec-mias") cargarMias();
    if (id === "sec-reclamos") cargarReclamos();
    if (id === "sec-sugerencias") cargarSugerencias();
    if (id === "sec-stats") setTimeout(cargarStats, 40);
    if (id === "sec-usuarios") cargarUsuarios();
  }

  /**
   * Inicializacion principal de la sesion.
   * Verifica autenticacion, carga perfil, y decide que vista mostrar:
   *   - Sin sesion -> redirigir a index.html
   *   - Sin perfil -> mostrar formulario de profiling
   *   - Con password temporal -> mostrar cambio obligatorio
   *   - OK -> mostrar panel principal
   */
  async function boot() {
    if (!SB.configOk) {
      SBH.mostrar("msg", "Falta configurar config.js (URL y anon key de Supabase).", "error");
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

    // Si el usuario no tiene perfil, necesita completar registro
    if (!gp.data) {
      document.getElementById("profiling").classList.remove("hidden");
      SBH.llenarCasas(document.getElementById("prof-casa"));
      return;
    }

    profile = gp.data;
    rol = profile.rol;

    // Actualizar barra de usuario
    document.getElementById("user-nombre").textContent = profile.nombre;
    document.getElementById("user-casa").textContent = profile.numero_casa ? "Casa " + profile.numero_casa : "Sin casa";
    var rl = document.getElementById("user-rol");
    rl.textContent = rol === "comite" ? "Comité" : rol === "admin" ? "Admin" : "Vecino";
    rl.className = "badge role-" + rol;

    var primer = String(profile.nombre).split(" ")[0];
    document.getElementById("welcome-tx").innerHTML =
      "¡Hola, " + SBH.esc(primer) + '! <span style="color:var(--sun-dark)">☀</span>';

    // Verificar si debe cambiar contrasena por defecto
    if (requiereCambioPass(user, profile)) {
      document.getElementById("app-main").classList.add("hidden");
      document.getElementById("card-cambiar-pass").classList.remove("hidden");
      SBH.mostrar("msg", "Por seguridad y transparencia, debes cambiar tu contraseña por defecto antes de continuar.", "error");
      return;
    }

    // Todo OK: mostrar panel principal
    document.getElementById("card-cambiar-pass").classList.add("hidden");
    document.getElementById("app-main").classList.remove("hidden");

    // Poblar selects de categorias (una sola vez)
    llenarReclamoForm();
    llenarSugerenciaForm();

    await definirNav();
  }

  /**
   * Determina si el usuario necesita cambiar su contrasena.
   * Caso 1: perfil tiene debe_cambiar_pass = true
   * Caso 2: es una cuenta generica (admin/comite) sin flag de cambio
   */
  function requiereCambioPass(u, p) {
    if (!u) return false;
    if (p && p.debe_cambiar_pass === true) return true;
    var em = (u.email || "").toLowerCase();
    var esGenerica = (em === "administracion@casasdelparque7.cl" || em === "comite@casasdelparque7.cl");
    var cambiada = u.user_metadata && u.user_metadata.clave_cambiada;
    return esGenerica && !cambiada;
  }

  /* ------------------------------------------------------------------ */
  /*  Event listeners principales (DOMContentLoaded)                    */
  /* ------------------------------------------------------------------ */

  document.addEventListener("DOMContentLoaded", function () {
    if (!document.getElementById("app-main")) return;

    /* -- Cerrar sesion -- */
    document.getElementById("btn-logout").addEventListener("click", async function () {
      await SB.client.auth.signOut();
      window.location.href = "index.html";
    });

    /* -- Boton "Cambiar clave" en el topbar -- */
    var btnCambiarPass = document.getElementById("btn-cambiar-pass");
    if (btnCambiarPass) {
      btnCambiarPass.addEventListener("click", function () {
        document.getElementById("app-main").classList.add("hidden");
        document.getElementById("card-cambiar-pass").classList.remove("hidden");
        SBH.mostrar("msg", "Ingresa tu nueva contraseña a continuación.", "ok");
      });
    }

    /* -- Formulario de cambio de contrasena -- */
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

        // Actualizar en Supabase Auth y marcar en el perfil
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

        // Actualizar flags en la DB y en memoria local
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

    /* -- Formulario de profiling (completar registro) -- */
    document.getElementById("profiling-form").addEventListener("submit", async function (e) {
      e.preventDefault();
      var nombre = document.getElementById("prof-name").value.trim();
      var casa = parseInt(document.getElementById("prof-casa").value, 10);
      var pr = await SB.client.rpc("registrar_perfil", { p_nombre: nombre, p_casa: casa, p_rol: "vecino" });
      if (pr.error) { SBH.mostrar("msg", SBH.fmtErr(pr.error.message), "error"); return; }
      boot();
    });

    /* -- Filtros de busqueda -- */
    var fBuscarRec = document.getElementById("filtro-buscar-reclamo");
    if (fBuscarRec) {
      fBuscarRec.addEventListener("input", function () {
        busquedaRec = fBuscarRec.value.trim().toLowerCase();
        recPage = 1; // Reset pagina al buscar
        rendReclamos();
      });
    }

    var fBuscarSug = document.getElementById("filtro-buscar-sugerencia");
    if (fBuscarSug) {
      fBuscarSug.addEventListener("input", function () {
        busquedaSug = fBuscarSug.value.trim().toLowerCase();
        sugPage = 1; // Reset pagina al buscar
        rendSugerencias();
      });
    }

    /* -- Botones de exportar CSV -- */
    var btnExpRec = document.getElementById("btn-exportar-reclamos");
    if (btnExpRec) {
      btnExpRec.addEventListener("click", function () { exportarCSVReclamos(); });
    }

    var btnExpSug = document.getElementById("btn-exportar-sugerencias");
    if (btnExpSug) {
      btnExpSug.addEventListener("click", function () { exportarCSVSugerencias(); });
    }

    boot();
  });

  /* ================================================================== */
  /*  VECINO: Nuevo reporte                                                */
  /* ================================================================== */

  /**
   * Pobla el select de categorias del formulario de reporte.
   * Los listeners se adjuntan UNA SOLA VEZ gracias al flag _reclamoBound (#4).
   */
  function llenarReclamoForm() {
    var cat = document.getElementById("recl-categoria");
    // Solo poblar si esta vacio
    if (cat && !cat.options.length) {
      Object.keys(SB.CATEGORIAS).forEach(function (k) {
        var o = document.createElement("option");
        o.value = k; o.textContent = SB.CATEGORIAS[k];
        cat.appendChild(o);
      });
    }

    // #4: Solo adjuntar el listener una vez
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
      var ins = await SB.client.from("reclamos").insert([payload]);
      if (ins.error) { SBH.mostrar("msg", SBH.fmtErr(ins.error.message), "error"); return; }
      SBH.mostrar("msg", "Reporte enviado. El comité lo revisará.", "ok");
      e.target.reset();
    });
  }

  /* ================================================================== */
  /*  VECINO: Nueva sugerencia                                           */
  /* ================================================================== */

  /**
   * Vincula el formulario de sugerencias.
   * Listener unico gracias al flag _sugerenciaBound (#4).
   */
  function llenarSugerenciaForm() {
    // #4: Solo adjuntar el listener una vez
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
      var ins = await SB.client.from("sugerencias").insert([payload]);
      if (ins.error) { SBH.mostrar("msg", SBH.fmtErr(ins.error.message), "error"); return; }
      SBH.mostrar("msg", "Sugerencia enviada. El comité la revisará.", "ok");
      e.target.reset();
    });
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
      .order("created_at", { ascending: false });
    if (q.error) { wrap.innerHTML = '<p class="hint">' + SBH.esc(SBH.fmtErr(q.error.message)) + "</p>"; return; }
    if (!q.data.length) { wrap.innerHTML = '<p class="hint">Aún no has enviado sugerencias.</p>'; return; }
    wrap.innerHTML = q.data.map(tarjetaSugerenciaMia).join("");
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
          '<div>' + chip(SB.ESTADOS[{ nueva: "nuevo", en_revision: "en_revision", resuelta: "resuelto" }[s.estado]] || s.estado, "estado-" + ({ nueva: "nuevo", en_revision: "en_revision", resuelta: "resuelto" }[s.estado])) + "</div>" +
        "</div>" +
        '<div class="desc">' + SBH.esc(s.descripcion) + "</div>" + resp +
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
      .order("created_at", { ascending: false });
    if (q.error) { wrap.innerHTML = '<p class="hint">' + SBH.esc(SBH.fmtErr(q.error.message)) + "</p>"; return; }
    if (!q.data.length) { wrap.innerHTML = '<p class="hint">Aún no has enviado reportes.</p>'; return; }
    wrap.innerHTML = q.data.map(tarjetaReclamo).join("");
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
        '<div class="desc">' + SBH.esc(r.descripcion) + "</div>" + resp +
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

  /**
   * Renderiza la lista paginada de reportes con filtros aplicados.
   * Los botones de paginacion se renderizan inline despues de la lista.
   */
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

    // #9: Paginacion
    var total = lista.length;
    var totalPages = Math.ceil(total / PAGE_SIZE);
    if (recPage > totalPages) recPage = totalPages;
    var start = (recPage - 1) * PAGE_SIZE;
    var page = lista.slice(start, start + PAGE_SIZE);

    wrap.innerHTML = page.map(tarjetaComite).join("") + renderPagination(total, recPage, totalPages, "rec");
    bindResponder();
    bindPagination("rec", function (p) { recPage = p; rendReclamos(); });
  }

  function tarjetaComite(r) {
    var resp = r.respuesta
      ? '<div class="respuesta-box"><b>Respuesta:</b> ' + SBH.esc(r.respuesta) + "</div>" : "";
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
        '<div class="desc">' + SBH.esc(r.descripcion) + "</div>" + resp +
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
      "</div>"
    );
  }

  /** Vincula los formularios de respuesta de cada reclamo. */
  function bindResponder() {
    document.querySelectorAll("#reclamos-list .responder").forEach(function (f) {
      f.addEventListener("submit", async function (e) {
        e.preventDefault();
        var card = f.closest(".reclamo");
        var id = card.dataset.id;
        var estado = f.querySelector(".resp-estado").value;
        var texto = f.querySelector(".resp-texto").value.trim();
        var r = await SB.client.rpc("responder_reclamo", {
          p_id: id, p_estado: estado, p_respuesta: texto || null
        });
        if (r.error) { SBH.mostrar("msg", SBH.fmtErr(r.error.message), "error"); return; }
        SBH.mostrar("msg", "Reporte actualizado.", "ok");
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

    // #9: Paginacion
    var total = lista.length;
    var totalPages = Math.ceil(total / PAGE_SIZE);
    if (sugPage > totalPages) sugPage = totalPages;
    var start = (sugPage - 1) * PAGE_SIZE;
    var page = lista.slice(start, start + PAGE_SIZE);

    wrap.innerHTML = page.map(tarjetaSugerencia).join("") + renderPagination(total, sugPage, totalPages, "sug");
    bindResponderSug();
    bindPagination("sug", function (p) { sugPage = p; rendSugerencias(); });
  }

  function tarjetaSugerencia(s) {
    var resp = s.respuesta
      ? '<div class="respuesta-box"><b>Respuesta:</b> ' + SBH.esc(s.respuesta) + "</div>" : "";
    var map = { nueva: "nuevo", en_revision: "en_revision", resuelta: "resuelto" };
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
        '<div class="desc">' + SBH.esc(s.descripcion) + "</div>" + resp +
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
        var r = await SB.client.rpc("responder_sugerencia", {
          p_id: id, p_estado: estado, p_respuesta: texto || null
        });
        if (r.error) { SBH.mostrar("msg", SBH.fmtErr(r.error.message), "error"); return; }
        SBH.mostrar("msg", "Sugerencia actualizada.", "ok");
        cargarSugerencias();
      });
    });
  }

  /* ================================================================== */
  /*  Paginacion (#9)                                                    */
  /* ================================================================== */

  /**
   * Genera HTML de botones de paginacion (Anterior / Siguiente + indicador).
   * @param {number} total - Total de registros
   * @param {number} current - Pagina actual (1-based)
   * @param {number} totalPages - Total de paginas
   * @param {string} prefix - Prefijo para IDs unicos ("rec" o "sug")
   * @returns {string} HTML de la paginacion
   */
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

  /** Vincula los botones de paginacion para una lista. */
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

  /**
   * Genera un archivo CSV y lo descarga en el navegador.
   * Usa BOM UTF-8 (\uFEFF) para compatibilidad con Excel en Windows.
   * @param {Array} datos - Array de objetos
   * @param {string} nombreArchivo - Nombre del archivo a descargar
   * @param {Array} columnas - Definicion de columnas [{ label, val }]
   */
  function exportarCSV(datos, nombreArchivo, columnas) {
    if (!datos || !datos.length) {
      SBH.mostrar("msg", "No hay datos para exportar.", "error");
      return;
    }
    var headers = columnas.map(function (c) { return '"' + String(c.label).replace(/"/g, '""') + '"'; }).join(",");
    var rows = datos.map(function (row) {
      return columnas.map(function (c) {
        var val = c.val(row);
        val = (val == null) ? "" : String(val);
        return '"' + val.replace(/"/g, '""') + '"';
      }).join(",");
    });
    var csvContent = "\uFEFF" + [headers].concat(rows).join("\n");
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
      { label: "Respuesta Comité", val: function (s) { return s.respuesta || ""; } },
      { label: "Atendido por", val: function (s) { return s.atendido_nombre || ""; } },
      { label: "Fecha creación", val: function (s) { return SBH.fmtFecha(s.created_at); } }
    ];
    exportarCSV(sugCache, "sugerencias_casas_del_parque_7.csv", cols);
  }

  /* ================================================================== */
  /*  Estadisticas                                                       */
  /* ================================================================== */

  /**
   * Carga y renderiza las estadisticas comunitarias.
   * Llama a la funcion RPC 'estadisticas' que retorna JSONB con
   * conteos agregados (total, por estado, categoria, mes).
   * Los graficos se dibujan via SBStats.drawBars() (Canvas puro).
   */
  async function cargarStats() {
    var s = await SB.client.rpc("estadisticas");
    if (s.error) { SBH.mostrar("msg", SBH.fmtErr(s.error.message), "error"); return; }
    var e = s.data || {};

    // Tarjetas resumen de reclamos
    var grid = document.getElementById("stats-grid");
    grid.innerHTML =
      statCard(e.total || 0, "Reportes totales") +
      statCard(e.por_estado && e.por_estado.nuevo || 0, "Nuevos") +
      statCard(e.por_estado && e.por_estado.en_revision || 0, "En revisión") +
      statCard(e.por_estado && e.por_estado.resuelto || 0, "Resueltos");

    // Graficos de barras de reportes
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
    var meses = (e.por_mes || []).map(function (m) { return SBStats.fmtMes(m.mes); });
    var cant = (e.por_mes || []).map(function (m) { return m.cantidad; });
    SBStats.drawBars(document.getElementById("chart-mes"), meses, cant);

    // Tarjetas resumen de sugerencias
    var gridSug = document.getElementById("stats-grid-sug");
    gridSug.innerHTML =
      statCard(e.sug_total || 0, "Sugerencias totales") +
      statCard(e.sug_por_estado && e.sug_por_estado.nueva || 0, "Nuevas") +
      statCard(e.sug_por_estado && e.sug_por_estado.en_revision || 0, "En revisión") +
      statCard(e.sug_por_estado && e.sug_por_estado.resuelta || 0, "Resueltas");

    // Graficos de barras de sugerencias
    SBStats.drawBars(
      document.getElementById("chart-sug-estado"),
      Object.keys(e.sug_por_estado || {}).map(function (k) {
        return { nueva: "Nueva", en_revision: "En revisión", resuelta: "Resuelta" }[k] || k;
      }),
      Object.values(e.sug_por_estado || {})
    );
    var sugMes = (e.sug_por_mes || []).map(function (m) { return SBStats.fmtMes(m.mes); });
    var sugCant = (e.sug_por_mes || []).map(function (m) { return m.cantidad; });
    SBStats.drawBars(document.getElementById("chart-sug-mes"), sugMes, sugCant);
  }

  function statCard(num, lbl) {
    return '<div class="stat"><div class="num">' + num + '</div><div class="lbl">' + SBH.esc(lbl) + "</div></div>";
  }

  /* ================================================================== */
  /*  Admin: Gestion de usuarios                                         */
  /* ================================================================== */

  /**
   * Lista todos los usuarios y permite al admin cambiar roles.
   * #6: Se agrega confirmacion antes de aplicar cambios de rol.
   */
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

    // #6: Vincular botones con confirmacion
    wrap.querySelectorAll(".user-row").forEach(function (row) {
      row.querySelector(".ubtn").addEventListener("click", async function () {
        var id = row.dataset.id;
        var nuevoRol = row.querySelector(".urol").value;
        var nombreUsuario = row.querySelector(".nm").textContent;
        var rolActual = row.querySelector(".dt").textContent.split(" · ").pop();
        var nuevoRolLabel = rolLabels[nuevoRol] || nuevoRol;

        // #6: Confirmar antes de cambiar rol
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
})();
