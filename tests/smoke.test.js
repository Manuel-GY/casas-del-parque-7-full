"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

function idsUsadosEn(js) {
  const ids = new Set();
  const re = /getElementById\(\s*["']([^"']+?)["']\s*\)/g;
  let m;
  while ((m = re.exec(js)) !== null) ids.add(m[1]);
  return ids;
}
function idsDefinidosEn(html) {
  const ids = new Set();
  const re = /id="([^"]+)"/g;
  let m;
  while ((m = re.exec(html)) !== null) ids.add(m[1]);
  return ids;
}

test("todos los archivos referenciados existen", () => {
  const refs = [
    "./index.html", "./app.html", "./manifest.webmanifest", "./sw.js",
    "./css/style.css", "./js/pure.js", "./js/auth.js", "./js/index.js",
    "./js/app.js", "./js/stats.js", "./js/register-sw.js",
    "./icons/icon-192.png", "./icons/icon-512.png", "./icons/icon-180.png",
    "./icons/icon-maskable-512.png", "./config.example.js"
  ];
  for (const r of refs) {
    assert.ok(fs.existsSync(path.join(ROOT, r)), `Falta: ${r}`);
  }
});

test("los scripts del HTML existen y en el orden correcto", () => {
  for (const page of ["./index.html", "./app.html"]) {
    const html = read(page);
    const scripts = [...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map((m) => m[1]);
    assert.ok(scripts.length >= 5, `${page}: scripts insuficientes`);
    const ordenOk = scripts.indexOf("./js/pure.js") < scripts.indexOf("./js/auth.js");
    const authAntesDeFinal = scripts.indexOf("./js/auth.js") < scripts.indexOf("./js/index.js") ||
                             scripts.indexOf("./js/auth.js") < scripts.indexOf("./js/app.js");
    assert.ok(ordenOk, `${page}: pure.js debe ir antes de auth.js`);
    assert.ok(authAntesDeFinal, `${page}: auth.js debe cargarse antes del script final`);
    for (const s of scripts) {
      if (s.startsWith("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2")) continue;
      assert.ok(fs.existsSync(path.join(ROOT, s)), `${page}: falta script ${s}`);
    }
  }
});

test("sin scripts inline (compatible con CSP)", () => {
  for (const page of ["./index.html", "./app.html"]) {
    const html = read(page);
    const inline = [...html.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g)]
      .filter((m) => m[1].trim().length > 0);
    assert.deepEqual(inline, [], `${page}: hay script inline`);
  }
});

test("los getElementById usados por el JS existen en el HTML", () => {
  const dom = idsDefinidosEn(read("./index.html") + read("./app.html"));
  for (const jsFile of ["js/index.js", "js/app.js", "js/auth.js", "js/stats.js"]) {
    const usados = idsUsadosEn(read(jsFile));
    const faltantes = [...usados].filter((id) => !dom.has(id) && !id.startsWith("#"));
    assert.deepEqual(faltantes, [], `${jsFile}: ids sin definir en el HTML -> ${faltantes.join(", ")}`);
  }
});

test("no debe quedar jerga del proyecto original", () => {
  const files = ["index.html", "app.html", "js/index.js", "js/app.js", "js/auth.js", "config.example.js"];
  for (const f of files) {
    const txt = read(f);
    assert.ok(!/\b142\b/.test(txt), `${f}: contiene "142" (número de casas antiguo)`);
    assert.ok(!/solo[^.\n]{0,25}guardias?/i.test(txt), `${f}: queda "solo ... guardias" del proyecto original`);
  }
});

test("config.example.js usa placeholders; config.js ya está configurado", () => {
  const ejemplo = read("config.example.js");
  assert.match(ejemplo, /TU-PROYECTO|TU_ANON_KEY/, "config.example.js debe contener placeholders");
  const real = read("config.js");
  assert.doesNotMatch(real, /TU-PROYECTO|TU_ANON_KEY/, "config.js no debe tener placeholders");
  assert.match(real, /https:\/\/.+\.supabase\.co/, "config.js debe tener un SUPABASE_URL real");
});

test("manifest incluye los iconos generados", () => {
  const man = JSON.parse(read("manifest.webmanifest"));
  for (const icon of man.icons) {
    assert.ok(fs.existsSync(path.join(ROOT, icon.src)), `Falta icono ${icon.src}`);
  }
});