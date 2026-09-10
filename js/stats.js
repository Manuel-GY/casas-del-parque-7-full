/**
 * stats.js — Motor de graficos de barras en HTML5 Canvas.
 *
 * Renderiza graficos de barras animados con:
 *   - Gradientes y efectos de brillo en cada barra
 *   - Tooltips interactivos al pasar el mouse / tocar
 *   - Adaptacion automatica al tamano del contenedor (DPR-aware)
 *   - Animacion de entrada con easing cubico
 *
 * Sin dependencias externas: todo se dibuja con Canvas 2D API.
 *
 * API publica (window.SBStats):
 *   drawBars(canvas, labels, values) - Dibuja o actualiza un grafico
 *   fmtMes(ym) - Formatea "YYYY-MM" a "ene 26"
 *
 * El grafico usa un registry interno para mantener el estado de cada canvas
 * (rects para hit-testing del tooltip, indice activo, intentos de render,
 * frames de animacion pendientes).
 */
(function () {
  "use strict";

  /* ------------------------------------------------------------------ */
  /*  Configuracion                                                      */
  /* ------------------------------------------------------------------ */

  /** Paleta de colores para las barras (se repite ciclicamente). */
  var PALETTE = ["#16a34a", "#0e7490", "#c2410c", "#7c3aed", "#b91c1c", "#f59e0b", "#475569", "#059669", "#1d4ed8", "#be185d"];

  /** Duracion de la animacion de entrada en milisegundos. */
  var ANIM_MS = 420;

  /** Polyfill para requestAnimationFrame en navegadores antiguos. */
  var raf = window.requestAnimationFrame ||
    function (cb) { return setTimeout(function () { cb(Date.now()); }, 16); };
  var caf = window.cancelAnimationFrame || function (id) { clearTimeout(id); };

  /**
   * Registro interno de todos los canvas renderizados.
   * Cada entrada contiene: canvas, labels, values, rects (hit areas),
   * activeIdx (barra resaltada), raf (frame pendiente), h (altura),
   * tries (intentos cuando el canvas esta oculto).
   */
  var registry = [];

  function findRecord(canvas) {
    for (var i = 0; i < registry.length; i++) {
      if (registry[i].canvas === canvas) return registry[i];
    }
    return null;
  }

  function ensureRecord(canvas) {
    var rec = findRecord(canvas);
    if (!rec) {
      rec = {
        canvas: canvas,
        labels: [],
        values: [],
        raf: 0,
        rects: [],
        activeIdx: -1,
        bound: false,
        h: parseInt(canvas.getAttribute("height"), 10) || 200,
        tries: 0
      };
      registry.push(rec);
    }
    return rec;
  }

  /* ------------------------------------------------------------------ */
  /*  Helpers de dibujo                                                  */
  /* ------------------------------------------------------------------ */

  /**
   * Divide texto en lineas respetando el ancho maximo.
   * Maximo 2 lineas; si la segunda es muy larga, agrega "...".
   * @param {CanvasRenderingContext2D} ctx
   * @param {string} lbl - Texto a dividir
   * @param {number} maxW - Ancho maximo en pixeles
   * @returns {string[]} Array de 1-2 lineas
   */
  function wrapLines(ctx, lbl, maxW) {
    var words = String(lbl).split(/\s+/).filter(Boolean);
    if (!words.length) return [""];
    var lines = [];
    var cur = words[0];
    var addEll = false;
    for (var i = 1; i < words.length; i++) {
      var test = cur + " " + words[i];
      if (ctx.measureText(test).width <= maxW) {
        cur = test;
      } else {
        lines.push(cur);
        cur = words[i];
        if (lines.length === 2) { lines = lines.slice(0, 2); addEll = true; break; }
      }
    }
    if (lines.length === 0) {
      lines.push(cur);
    } else if (lines.length === 1) {
      lines.push(cur);
    } else {
      if (addEll || ctx.measureText(cur).width > maxW) lines[1] += "\u2026";
    }
    return lines;
  }

  /**
   * Dibuja un rectangulo con esquinas redondeadas (solo arriba).
   * Utilizado para las barras del grafico.
   */
  function cornerRect(ctx, x, y, w, h, r) {
    if (h < 2 * r) r = h / 2;
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x, y + h);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  /**
   * Aclara u oscurece un color hex segun la cantidad indicada.
   * @param {string} hex - Color "#RRGGBB"
   * @param {number} amt - 0 a 1 para aclarar, -1 a 0 para oscurecer
   * @returns {string} Color en formato "rgb(r,g,b)"
   */
  function shade(hex, amt) {
    var c = parseInt(hex.slice(1), 16);
    var r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
    var t = amt < 0 ? 0 : 255;
    var p = Math.abs(amt);
    r = Math.round((t - r) * p + r);
    g = Math.round((t - g) * p + g);
    b = Math.round((t - b) * p + b);
    return "rgb(" + r + "," + g + "," + b + ")";
  }

  /** Escapa HTML para insercion segura en tooltips. */
  function escHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  /* ------------------------------------------------------------------ */
  /*  Tooltip interactivo                                                */
  /* ------------------------------------------------------------------ */

  var tooltipEl = null;

  /** Crea el elemento tooltip una sola vez y lo adjunta al body. */
  function ensureTooltip() {
    if (tooltipEl) return tooltipEl;
    var t = document.createElement("div");
    t.className = "chart-tooltip";
    t.style.display = "none";
    document.body.appendChild(t);
    tooltipEl = t;
    return t;
  }

  function hideTooltip() {
    if (tooltipEl) {
      tooltipEl.classList.remove("vis");
      tooltipEl.style.display = "none";
    }
  }

  /**
   * Muestra el tooltip con el valor y label de la barra.
   * Calcula posicion automatica para no salirse de la pantalla.
   * @param {number} value - Valor numerico de la barra
   * @param {string} label - Texto de la categoria
   * @param {number} x - Posicion X (centro de la barra en viewport)
   * @param {number} y - Posicion Y (tope de la barra en viewport)
   */
  function showTooltip(value, label, x, y) {
    var t = ensureTooltip();
    t.innerHTML =
      '<div class="chart-tip-num">' + escHtml(value) + "</div>" +
      (label ? '<div class="chart-tip-lbl">' + escHtml(label) + "</div>" : "");
    t.classList.remove("vis");
    t.style.display = "block";
    t.style.visibility = "hidden";

    var w = t.offsetWidth;
    var h = t.offsetHeight;
    var vw = document.documentElement.clientWidth || document.body.clientWidth;
    var vh = document.documentElement.clientHeight || document.body.clientHeight;

    // Centrar horizontalmente, arriba de la barra (o abajo si no cabe arriba)
    var L = Math.max(8, Math.min(x - w / 2, vw - w - 8));
    var T = y - h - 10;
    if (T < 8) T = y + 14;

    t.style.left = L + "px";
    t.style.top = T + "px";
    t.style.visibility = "visible";
    void t.offsetWidth; // Forzar reflow para la transicion
    t.classList.add("vis");
  }

  /**
   * Vincula los eventos de mouse/touch al canvas para el tooltip.
   * Solo se vincula una vez por canvas (flag rec.bound).
   */
  function bindHover(canvas, rec) {
    if (rec.bound) return;
    rec.bound = true;

    // Mouse: detectar barra bajo el cursor y resaltarla
    canvas.addEventListener("mousemove", function (e) {
      if (!rec.canvas) return;
      var r = canvas.getBoundingClientRect();
      if (!r.width) return;
      var px = e.clientX - r.left;
      var py = e.clientY - r.top;
      var hit = null;
      for (var i = 0; i < rec.rects.length; i++) {
        var b = rec.rects[i];
        if (px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h) { hit = b; break; }
      }
      var newActive = hit ? rec.rects.indexOf(hit) : -1;
      if (newActive !== rec.activeIdx) {
        rec.activeIdx = newActive;
        renderChart(rec, 1); // Re-render instantaneo al cambiar la barra activa
      }
      if (hit) {
        showTooltip(hit.value, hit.label, r.left + hit.x + hit.w / 2, r.top + hit.y);
      } else {
        hideTooltip();
      }
    });

    canvas.addEventListener("mouseleave", function () {
      hideTooltip();
      if (rec.activeIdx !== -1) {
        rec.activeIdx = -1;
        renderChart(rec, 1);
      }
    });

    // Touch: mostrar tooltip al tocar una barra (movil)
    canvas.addEventListener("touchstart", function (e) {
      var t = e.touches && e.touches[0];
      if (!t) return;
      var r = canvas.getBoundingClientRect();
      var px = t.clientX - r.left;
      var py = t.clientY - r.top;
      var hit = null;
      for (var i = 0; i < rec.rects.length; i++) {
        var b = rec.rects[i];
        if (px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h) { hit = b; break; }
      }
      if (hit) {
        showTooltip(hit.value, hit.label, r.left + hit.x + hit.w / 2, r.top + hit.y);
      }
    }, false);
  }

  /* ------------------------------------------------------------------ */
  /*  Renderizado del grafico                                            */
  /* ------------------------------------------------------------------ */

  /**
   * Renderiza el grafico de barras completo en el canvas.
   *
   * Pasos:
   *   1. Calcular dimensiones y DPR para HiDPI
   *   2. Dibujar fondo y gridlines
   *   3. Dibujar cada barra con gradiente, borde y brillo
   *   4. Dibujar badges de valor sobre cada barra
   *   5. Dibujar labels envueltos debajo
   *   6. Actualizar rects para hit-testing del tooltip
   *
   * @param {Object} rec - Registro del canvas
   * @param {number} ease - Factor de animacion (0 a 1, 1 = terminado)
   */
  function renderChart(rec, ease) {
    var canvas = rec.canvas;
    var dpr = window.devicePixelRatio || 1;
    var W = canvas.clientWidth;
    if (!W && canvas.parentNode) W = canvas.parentNode.clientWidth;
    if (!W) W = 300;
    var H = rec.h || 200;

    // Configurar canvas para HiDPI (retina)
    canvas.width = Math.max(1, Math.round(W * dpr));
    canvas.height = Math.max(1, Math.round(H * dpr));
    var ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);

    var padL = 8, padR = 8, padT = 18, padB = 36;
    var iw = W - padL - padR;
    var ih = H - padT - padB;
    var n = Math.min(rec.labels.length, rec.values.length);

    // Fondo semitransparente
    ctx.fillStyle = "rgba(255,255,255,.30)";
    ctx.fillRect(0, 0, W, H);

    // Estado vacio: borde punteado + texto "Sin datos"
    if (!n) {
      ctx.strokeStyle = "rgba(20,83,45,.18)";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 5]);
      roundRectPath(ctx, padL, padT, iw, ih, 10);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "#94a3b8";
      ctx.font = "bold 14px Nunito, Segoe UI";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("Sin datos aún", W / 2, padT + ih / 2);
      ctx.textBaseline = "alphabetic";
      rec.rects = [];
      return;
    }

    // Calcular escala (maximo valor)
    var max = 1;
    for (var i = 0; i < n; i++) { if (rec.values[i] > max) max = rec.values[i]; }
    var bw = iw / n;
    var gap = Math.min(8, Math.max(2, bw * 0.14));
    var barW = Math.max(6, bw - gap * 2);
    var baseY = padT + ih;

    ctx.textAlign = "center";

    // Gridlines horizontales (5 lineas sutiles)
    ctx.strokeStyle = "rgba(20,83,45,.06)";
    ctx.lineWidth = 1;
    for (var g = 1; g <= 4; g++) {
      var gy = padT + (ih * g) / 5;
      ctx.beginPath();
      ctx.moveTo(padL, gy);
      ctx.lineTo(padL + iw, gy);
      ctx.stroke();
    }

    // Linea base
    ctx.strokeStyle = "rgba(20,83,45,.22)";
    ctx.beginPath();
    ctx.moveTo(padL, baseY + 0.5);
    ctx.lineTo(padL + iw, baseY + 0.5);
    ctx.stroke();

    // Sombra suave debajo del area de grafico
    var sh = ctx.createLinearGradient(0, baseY, 0, baseY + 26);
    sh.addColorStop(0, "rgba(20,83,45,.12)");
    sh.addColorStop(1, "rgba(20,83,45,0)");
    ctx.fillStyle = sh;
    ctx.fillRect(padL, baseY, iw, 26);

    rec.rects = [];

    // Dibujar cada barra
    for (var i = 0; i < n; i++) {
      var target = (rec.values[i] / max) * ih;
      var h = target * ease; // Altura animada
      var x = padL + i * bw + (bw - barW) / 2;
      var y = baseY - h;
      var fullY = baseY - target;
      var color = PALETTE[i % PALETTE.length];

      if (rec.values[i] > 0) {
        var r = Math.min(5, barW / 2);
        var active = (i === rec.activeIdx);

        // Gradiente vertical de la barra
        var grad = ctx.createLinearGradient(0, y, 0, y + h);
        grad.addColorStop(0, active ? shade(color, 0.45) : shade(color, 0.32));
        grad.addColorStop(0.5, active ? shade(color, 0.2) : shade(color, 0.1));
        grad.addColorStop(1, active ? shade(color, -0.05) : shade(color, -0.16));
        ctx.fillStyle = grad;
        ctx.beginPath();
        cornerRect(ctx, x, y, barW, h, r);
        ctx.fill();

        // Borde: resaltado si activa, sutil si no
        if (active) {
          ctx.save();
          ctx.shadowColor = shade(color, -0.3);
          ctx.shadowBlur = 10;
          ctx.shadowOffsetY = 3;
          ctx.strokeStyle = shade(color, 0.5);
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.restore();
        } else {
          ctx.strokeStyle = "rgba(255,255,255,.30)";
          ctx.lineWidth = 1;
          ctx.stroke();
        }

        // Efecto de brillo (reflejo a la izquierda)
        ctx.save();
        ctx.beginPath();
        cornerRect(ctx, x, y, barW, h, r);
        ctx.clip();
        var gl = ctx.createLinearGradient(x, y, x + barW * 0.55, y + h);
        gl.addColorStop(0, "rgba(255,255,255,.26)");
        gl.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = gl;
        ctx.fillRect(x, y, barW * 0.55, h);
        // Brillo en la parte superior de la barra
        ctx.fillStyle = "rgba(255,255,255,.55)";
        ctx.beginPath();
        cornerRect(ctx, x, y, barW, Math.min(4, Math.max(2, h * 0.18)), r);
        ctx.fill();
        ctx.restore();

        // Guardar area de la barra para hit-testing del tooltip
        rec.rects.push({ x: x, y: fullY, w: barW, h: target, value: rec.values[i], label: rec.labels[i] });
      }

      // Badge con el valor numerico sobre la barra
      var valTxt = String(rec.values[i]);
      ctx.font = "bold 11px Nunito, Segoe UI";
      var vwpx = ctx.measureText(valTxt).width;
      var pillW = vwpx + 8;
      var pillH = 15;
      var pxx = x + barW / 2 - pillW / 2;
      var pyy = fullY - 5 - pillH;
      ctx.fillStyle = "rgba(255,255,255,.85)";
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = shade(color, -0.18);
      roundRectPath(ctx, pxx, pyy, pillW, pillH, 7.5);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#14532d";
      ctx.textBaseline = "middle";
      ctx.fillText(valTxt, x + barW / 2, pyy + pillH / 2 + 0.5);
      ctx.textBaseline = "alphabetic";

      // Label envuelto debajo de la barra (max 2 lineas)
      ctx.fillStyle = "#374151";
      ctx.font = "bold 11px Nunito, Segoe UI";
      var lines = wrapLines(ctx, rec.labels[i], Math.max(42, bw - 4));
      var cx = padL + i * bw + bw / 2;
      var base = H - 18 - (lines.length - 1) * 12;
      for (var li = 0; li < lines.length; li++) {
        ctx.fillText(lines[li], cx, base + li * 12);
      }
    }
  }

  function roundRectPath(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    cornerRect(ctx, x, y, w, h, r);
  }

  /**
   * Animacion de entrada de las barras.
   * Usa easing cubico (ease-out) para un efecto suave.
   * @param {Object} rec - Registro del canvas
   */
  function animate(rec) {
    var t0 = null;
    function step(ts) {
      if (t0 === null) t0 = ts;
      var p = Math.min(1, (ts - t0) / ANIM_MS);
      var e = 1 - Math.pow(1 - p, 3); // Ease-out cubico
      renderChart(rec, e);
      if (p < 1) {
        rec.raf = raf(step);
      } else {
        rec.raf = 0;
      }
    }
    rec.raf = raf(step);
  }

  /* ------------------------------------------------------------------ */
  /*  API publica                                                        */
  /* ------------------------------------------------------------------ */

  /**
   * Dibuja o actualiza un grafico de barras en el canvas indicado.
   *
   * Si el canvas esta oculto (display:none), espera a que sea visible
   * antes de dibujar. Dibujar con ancho 0 estira/emborra la grafica.
   * Se corta despues de ~60 intentos (~1 segundo) para evitar bucle infinito.
   *
   * @param {HTMLCanvasElement} canvas
   * @param {string[]} labels - Etiquetas del eje X
   * @param {number[]} values - Valores del eje Y
   */
  function drawBars(canvas, labels, values) {
    if (!canvas || !canvas.getContext) return;
    var rec = ensureRecord(canvas);

    var vis = canvas.clientWidth && canvas.clientWidth > 0;
    if (!vis) {
      rec.tries = (rec.tries || 0) + 1;
      if (rec.tries > 60) {
        rec.tries = 0;
        return;
      }
      rec.labels = labels || [];
      rec.values = values || [];
      raf(function () { drawBars(canvas, labels, values); });
      return;
    }

    rec.tries = 0;

    if (rec.raf) { caf(rec.raf); rec.raf = 0; }
    rec.labels = labels || [];
    rec.values = values || [];
    bindHover(canvas, rec);
    animate(rec);
  }

  /**
   * Re-renderiza todos los graficos al cambiar el tamano de ventana.
   * Oculta el tooltip durante el redimensionamiento.
   */
  window.addEventListener("resize", function () {
    hideTooltip();
    for (var i = 0; i < registry.length; i++) {
      var rec = registry[i];
      var alive = typeof rec.canvas.isConnected === "undefined" || rec.canvas.isConnected;
      if (alive) drawBars(rec.canvas, rec.labels, rec.values);
    }
  });

  // Ocultar tooltip al hacer scroll
  document.addEventListener("scroll", hideTooltip, true);

  /**
   * Formatea una cadena "YYYY-MM" a formato corto: "ene 26", "feb 26", etc.
   * @param {string} ym - Cadena en formato "YYYY-MM"
   * @returns {string} Fecha formateada
   */
  function fmtMes(ym) {
    var meses = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
    var p = String(ym).split("-");
    if (p.length < 2) return ym;
    return (meses[(parseInt(p[1], 10) || 1) - 1]) + " " + String(p[0]).slice(2);
  }

  /* ------------------------------------------------------------------ */
  /*  Exponer API publica                                                */
  /* ------------------------------------------------------------------ */

  window.SBStats = { drawBars: drawBars, fmtMes: fmtMes };
})();
