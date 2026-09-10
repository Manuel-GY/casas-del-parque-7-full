/**
 * index.js — Logica de autenticacion para la pantalla de Login / Registro.
 *
 * Se ejecuta exclusivamente en index.html. Maneja:
 *   - Pestaas de Login / Registro
 *   - Inicio de sesion con email + password (Supabase Auth)
 *   - Registro de nuevos vecinos ( signUp + registrar_perfil RPC )
 *   - Validaciones basicas de formato de correo
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
   * @param {HTMLSelectElement} select
   * @param {Object} map - Mapa de clave -> texto
   * @param {string} [selKey] - Clave a pre-seleccionar
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
   * @param {HTMLButtonElement} btn - Tab clickeado
   */
  function activarTab(btn) {
    var tabs = document.querySelectorAll("#auth-tabs .tab");
    tabs.forEach(function (t) { t.classList.remove("active"); });
    btn.classList.add("active");
    document.getElementById("view-login").hidden = (btn.dataset.view !== "login");
    document.getElementById("view-register").hidden = (btn.dataset.view !== "register");
  }

  /**
   * Maneja el submit del formulario de inicio de sesion.
   * Usa signInWithPassword de Supabase Auth.
   *
   * Feedback de UX al usuario:
   *   - Mientras autentica: spinner en el boton ("Entrando...").
   *   - Al exito: mensaje verde en #msg y redireccion a app.html tras 1s.
   *   - Al fallar: mensaje rojo con el error traducido.
   */
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
        // Exito: mostrar confirmacion y redirigir al panel principal
        SBH.mostrar("msg", "¡Inicio de sesión exitoso! Bienvenido de nuevo.", "ok");
        setTimeout(function () { window.location.href = "app.html"; }, 1000);
      });
  }

  /**
   * Maneja el submit del formulario de registro.
   *
   * Flujo:
   *   1. Validacion basica de correo en frontend
   *   2. signUp() en Supabase Auth
   *   3. Si hay session inmediata -> registrar_perfil() RPC
   *   4. Si no hay session -> aviso de confirmacion por correo
   */
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
    SB.client.auth.signUp({ email: email, password: pass })
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
        // Si no hay session, el usuario debe confirmar su correo
        if (!res.data || !res.data.session) {
          return res;
        }
        // Hay session: crear perfil en la tabla profiles via RPC
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

  /**
   * Alterna el estado de carga de un boton.
   * Muestra un spinner + texto mientras carga, y restaura el texto original al terminar.
   * @param {HTMLButtonElement} btn
   * @param {boolean} on - true = cargando (deshabilitar + spinner), false = habilitar
   * @param {string} txt - Texto a mostrar mientras carga
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
    return "Falta conectar Supabase: pega la URL y la anon key en config.js. Sin eso el registro no puede funcionar.";
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

    // Poblar select de casas (1-142)
    SBH.llenarCasas(document.getElementById("reg-casa"));

    // Vincular formularios
    loginForm.addEventListener("submit", onLoginForm);
    document.getElementById("register-form").addEventListener("submit", onRegisterForm);
  });
})();
