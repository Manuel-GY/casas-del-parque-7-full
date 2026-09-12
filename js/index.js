/**
 * index.js — Logica de autenticacion para la pantalla de Login / Registro.
 *
 * Se ejecuta exclusivamente en index.html. Maneja:
 *   - Pestaas de Login / Registro
 *   - Inicio de sesion con email + password (Supabase Auth)
 *   - Registro de nuevos vecinos (signUp + registrar_perfil RPC)
 *   - Recuperacion de contrasena (resetPasswordForEmail)
 *   - Restablecimiento de contrasena al llegar con el token del correo
 *
 * Flujo de registro:
 *   1. signUp() crea la cuenta en auth.users
 *   2. Si hay session activa, llama a registrar_perfil() para crear el
 *      perfil en la tabla profiles (valida cupo de 2 por casa en DB)
 *   3. Si no hay session (email confirmation habilitado), muestra aviso
 */
(function () {
  "use strict";

  /**
   * Puebla un <select> con opciones desde un mapa { clave: texto }.
   */
  function llenarOpciones(select, map, selKey) {
    if (!select) return;
    if (select.options.length) return;
    Object.keys(map).forEach(function (k) {
      var o = document.createElement("option");
      o.value = k;
      o.textContent = map[k];
      if (selKey && k === selKey) o.selected = true;
      select.appendChild(o);
    });
  }

  /**
   * Alterna entre las vistas de Login y Registro.
   */
  function activarTab(btn) {
    var tabs = document.querySelectorAll("#auth-tabs .tab");
    tabs.forEach(function (t) { t.classList.remove("active"); });
    btn.classList.add("active");
    document.getElementById("view-login").hidden = (btn.dataset.view !== "login");
    document.getElementById("view-register").hidden = (btn.dataset.view !== "register");
  }

  /** Muestra el resto de la UI de login (o la oculta mientras se recupera). */
  function setLoginVisible(visible) {
    var tabs = document.getElementById("auth-tabs");
    var f = document.getElementById("login-form");
    var fr = document.getElementById("forgot-box");
    var link = document.getElementById("link-forgot");
    if (tabs) tabs.style.display = visible ? "" : "none";
    if (f) f.style.display = visible ? "" : "none";
    if (link) link.style.display = visible ? "" : "none";
    if (fr) fr.hidden = visible;
  }

  /**
   * Cuando llega correo de recuperacion (link con token), Supabase emite
   * el evento PASSWORD_RECOVERY y una session temporal. Mostramos el
   * formulario para definir la nueva contrasena.
   */
  function activarModoRecuperacion() {
    // Ocultar login/registro y mostrar la tarjeta de nueva contrasena
    var tabs = document.getElementById("auth-tabs");
    if (tabs) tabs.style.display = "none";
    document.getElementById("view-login").hidden = true;
    document.getElementById("view-register").hidden = true;
    document.getElementById("view-recovery").hidden = false;
    SBH.mostrar("msg", "Crea tu nueva contraseña para recuperar el acceso.", "ok");
  }

  /* ------------------------------------------------------------------ */
  /*  Login / Registro                                                  */
  /* ------------------------------------------------------------------ */

  function onLoginForm(e) {
    e.preventDefault();
    var email = document.getElementById("login-email").value.trim();
    var pass = document.getElementById("login-pass").value;
    var btn = document.getElementById("login-btn");
    SBH.mostrar("msg", "", "ok");
    if (!SB.configOk) { SBH.mostrar("msg", configFallback(), "error"); return; }
    cargando(btn, true, "Entrando...");
    SB.client.auth.signInWithPassword({ email: email, password: pass })
      .then(function (res) {
        if (res.error) {
          cargando(btn, false, "Entrar");
          SBH.mostrar("msg", SBH.fmtErr(res.error.message), "error");
          return null;
        }
        SBH.mostrar("msg", "¡Inicio de sesión exitoso! Bienvenido de nuevo.", "ok");
        completarRegistroPendiente().then(function () {
          setTimeout(function () { window.location.href = "app.html"; }, 1000);
        });
      });
  }

  function onRegisterForm(e) {
    e.preventDefault();
    var nombre = document.getElementById("reg-name").value.trim();
    var email = document.getElementById("reg-email").value.trim();
    var pass = document.getElementById("reg-pass").value;
    var casa = parseInt(document.getElementById("reg-casa").value, 10);
    var btn = document.getElementById("reg-btn");
    SBH.mostrar("msg", "", "ok");
    if (!SB.configOk) { SBH.mostrar("msg", configFallback(), "error"); return; }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { SBH.mostrar("msg", "Revisa el correo: parece no ser válido.", "error"); return; }

    cargando(btn, true, "Creando cuenta...");
    SB.client.auth.signUp({
      email: email,
      password: pass,
      options: { emailRedirectTo: window.location.origin + window.location.pathname }
    })
      .then(function (res) {
        if (res.error) {
          cargando(btn, false, "Crear cuenta");
          if (/already registered/i.test(res.error.message)) {
            SBH.mostrar("msg", "Ese correo ya está registrado. Prueba iniciando sesión.", "error");
          } else {
            SBH.mostrar("msg", SBH.fmtErr(res.error.message), "error");
          }
          return null;
        }
        if (!res.data || !res.data.session) {
          // Email confirmation activo: guardar el registro pendiente para
          // completarlo (asociar casa) cuando el correo sea confirmado.
          try {
            localStorage.setItem("cdp7_registro", JSON.stringify({ nombre: nombre, casa: casa, email: email }));
          } catch (e) {}
          return res;
        }
        return SB.client.rpc("registrar_perfil", { p_nombre: nombre, p_casa: casa, p_rol: "vecino" })
          .then(function (pr) {
            if (pr.error) {
              SBH.mostrar("msg", "Cuenta creada pero faltó asociar tu casa: " + SBH.fmtErr(pr.error.message), "error");
              return null;
            }
            return res;
          });
      })
      .then(function (res) {
        if (!res) return;
        cargando(btn, false, "Crear cuenta");
        if (res.data && res.data.session) {
          SBH.mostrar("msg", "¡Bienvenido a tu comunidad! Redirigiendo...", "ok");
          setTimeout(function () { window.location.href = "app.html"; }, 1000);
        } else {
          SBH.mostrar("msg", "Te enviamos un correo a " + email + ". Confírmalo y luego inicia sesión.", "ok");
        }
      });
  }

  /* ------------------------------------------------------------------ */
  /*  Recuperacion de contrasena                                        */
  /* ------------------------------------------------------------------ */

  function onForgotForm(e) {
    e.preventDefault();
    var email = document.getElementById("forgot-email").value.trim();
    var btn = document.getElementById("forgot-btn");
    SBH.mostrar("msg", "", "ok");
    if (!SB.configOk) { SBH.mostrar("msg", configFallback(), "error"); return; }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { SBH.mostrar("msg", "Revisa el correo: parece no ser válido.", "error"); return; }

    cargando(btn, true, "Enviando...");
    var redirectTo = window.location.origin + window.location.pathname;
    SB.client.auth.resetPasswordForEmail(email, { redirectTo: redirectTo })
      .then(function (res) {
        cargando(btn, false, "Enviar enlace");
        if (res.error) {
          SBH.mostrar("msg", SBH.fmtErr(res.error.message), "error");
          return;
        }
        SBH.mostrar("msg", "Te enviamos un enlace a " + email + ". Revisa tu bandeja de entrada.", "ok");
        setLoginVisible(true);
      });
  }

  async function onRecoveryForm(e) {
    e.preventDefault();
    var p1 = document.getElementById("recovery-pass").value;
    var p2 = document.getElementById("recovery-pass2").value;
    var btn = document.getElementById("recovery-btn");
    SBH.mostrar("msg", "", "ok");
    if (p1.length < 6) { SBH.mostrar("msg", "La contraseña debe tener al menos 6 caracteres.", "error"); return; }
    if (p1 !== p2) { SBH.mostrar("msg", "Las contraseñas no coinciden. Revisa e inténtalo de nuevo.", "error"); return; }
    if (!SB.configOk) { SBH.mostrar("msg", configFallback(), "error"); return; }

    cargando(btn, true, "Guardando...");
    var res = await SB.client.auth.updateUser({ password: p1 });
    cargando(btn, false, "Guardar nueva contraseña");
    if (res.error) {
      SBH.mostrar("msg", SBH.fmtErr(res.error.message), "error");
      return;
    }
    await SB.client.auth.signOut();
    document.getElementById("view-recovery").hidden = true;
    document.getElementById("view-login").hidden = false;
    var tabs = document.getElementById("auth-tabs");
    if (tabs) tabs.style.display = "";
    var registrar = document.getElementById("view-register");
    if (registrar) registrar.hidden = true;
    SBH.mostrar("msg", "¡Contraseña restablecida! Inicia sesión con tu nueva contraseña.", "ok");
  }

  /* ------------------------------------------------------------------ */
  /*  Helpers                                                           */
  /* ------------------------------------------------------------------ */

  /**
   * Alterna el estado de carga de un boton (spinner + texto).
   */
  function cargando(btn, on, txt) {
    if (!btn) return;
    if (on) {
      var spin = document.createElement("span");
      spin.className = "spinner";
      spin.setAttribute("aria-hidden", "true");
      btn.innerHTML = "";
      btn.appendChild(spin);
      btn.appendChild(document.createTextNode(txt || ""));
      btn.disabled = true;
    } else {
      btn.innerHTML = txt || "";
      btn.disabled = false;
    }
  }

  function configFallback() {
    return "Falta conectar Supabase: pega la URL y la anon key de tu proyecto nuevo en config.js.";
  }

  /**
   * Completa un registro que quedó pendiente por la confirmación de correo:
   * llama a registrar_perfil (asocia casa + crea perfil) y limpia localStorage.
   * @returns {Promise}
   */
  function completarRegistroPendiente() {
    var raw = null;
    try { raw = localStorage.getItem("cdp7_registro"); } catch (e) {}
    if (!raw) return Promise.resolve();
    var pend = null;
    try { pend = JSON.parse(raw); } catch (e) { return Promise.resolve(); }
    var ses = SB.client.auth.getSession();
    var usr = ses && ses.data && ses.data.session ? ses.data.session.user : null;
    if (!usr || !pend.email || pend.email !== usr.email) return Promise.resolve();
    return SB.client.rpc("registrar_perfil", { p_nombre: pend.nombre, p_casa: pend.casa, p_rol: "vecino" })
      .then(function (pr) {
        try { localStorage.removeItem("cdp7_registro"); } catch (e) {}
        if (pr.error) {
          SBH.mostrar("msg", "Tu correo quedó confirmado, pero faltó asociar tu casa: " + SBH.fmtErr(pr.error.message), "error");
        }
      });
  }

  /* ------------------------------------------------------------------ */
  /*  Inicializacion al cargar el DOM                                   */
  /* ------------------------------------------------------------------ */

  document.addEventListener("DOMContentLoaded", function () {
    var loginForm = document.getElementById("login-form");
    if (!loginForm) return;

    // Vincular pestaas Login / Registro
    var tabs = document.querySelectorAll("#auth-tabs .tab");
    tabs.forEach(function (t) {
      t.addEventListener("click", function () { activarTab(t); });
    });

    // Poblar select de casas (1-146)
    SBH.llenarCasas(document.getElementById("reg-casa"));

    // Vincular formularios
    loginForm.addEventListener("submit", onLoginForm);
    document.getElementById("register-form").addEventListener("submit", onRegisterForm);

    // Recuperacion de contrasena
    var linkForgot = document.getElementById("link-forgot");
    if (linkForgot) {
      linkForgot.addEventListener("click", function (e) {
        e.preventDefault();
        setLoginVisible(false);
        SBH.mostrar("msg", "", "ok");
        document.getElementById("forgot-email").focus();
      });
    }

    var linkBack = document.getElementById("link-back-login");
    if (linkBack) {
      linkBack.addEventListener("click", function (e) {
        e.preventDefault();
        setLoginVisible(true);
        SBH.mostrar("msg", "", "ok");
      });
    }

    var forgotForm = document.getElementById("forgot-form");
    if (forgotForm) forgotForm.addEventListener("submit", onForgotForm);

    var recoveryForm = document.getElementById("recovery-form");
    if (recoveryForm) recoveryForm.addEventListener("submit", onRecoveryForm);

    // Anticipar el modo recuperacion si la sesion ya trae el token
    if (SB.configOk) {
      SB.client.auth.onAuthStateChange(function (event) {
        if (event === "PASSWORD_RECOVERY") {
          activarModoRecuperacion();
          return;
        }
        if (event === "SIGNED_IN") {
          // Llegada desde el correo de confirmación (solo si no es recovery)
          if (/type=recovery/i.test(window.location.hash || "")) return;
          completarRegistroPendiente().then(function () {
            window.location.href = "app.html";
          });
        }
      });
    }
  });
})();