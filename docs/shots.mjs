import { default as puppeteer } from "puppeteer-core";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BASE = "https://manuel-gy.github.io/casas-del-parque-7-full/";
const OUT = path.join(__dirname, "shots");
const VIEWPORT = { width: 1280, height: 900, deviceScaleFactor: 1 };

const EMAIL = "demo@casasdelparque.cl";
const PASS = "Demo1234!";

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: "new",
    defaultViewport: VIEWPORT,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--ignore-certificate-errors",
      "--disable-web-security",
      "--allow-running-insecure-content",
      "--disable-features=IsolateOrigins,site-per-process",
    ],
  });
  const errors = [];
  const page = await browser.newPage();
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push("console: " + m.text());
  });

  async function shot(name, selector) {
    try {
      await new Promise((r) => setTimeout(r, 1200));
      if (selector) {
        const el = await page.$(selector);
        if (el) {
          await el.scrollIntoViewIfNeeded();
          await new Promise((r) => setTimeout(r, 400));
          await el.screenshot({ path: path.join(OUT, name) });
          console.log("OK  ", name, "(element)");
          return;
        }
      }
      await page.screenshot({ path: path.join(OUT, name), fullPage: false });
      console.log("OK  ", name, "(viewport)");
    } catch (e) {
      console.log("FAIL", name, "-", e.message);
    }
  }

  async function gotoBase(wait = "networkidle2") {
    await page.goto(BASE, { waitUntil: wait, timeout: 60000 });
  }

  try {
    // ---------- Login page ----------
    await gotoBase();
    await page.waitForSelector("#login-email", { timeout: 30000 });
    await shot("01-login.png", "#auth-card");

    // ---------- Forgot password view ----------
    await page.click("#link-forgot").catch(() => {});
    await new Promise((r) => setTimeout(r, 600));
    await shot("02-recuperar-clave.png", "#view-forgot");

// ---------- Register view ----------
    await gotoBase();
    await page.waitForSelector('button[data-view="register"]', { timeout: 30000 });
    await page.click('button[data-view="register"]').catch(() => {});
    await new Promise((r) => setTimeout(r, 700));
    await shot("03-registro.png", "#view-register");

    // ---------- Do login as admin ----------
    await gotoBase();
    await page.waitForSelector("#login-email", { timeout: 30000 });
    await page.type("#login-email", EMAIL);
    await page.type("#login-pass", PASS);
    await page.click("#login-btn");
    await page.waitForFunction(() => {
      const m = document.getElementById("app-main");
      return m && !m.classList.contains("hidden");
    }, { timeout: 45000 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 4000));

    // Admin dashboard
    await shot("04-dashboard-admin.png", ".welcome");

    // Reportes (admin)
    await page.click('#nav .tab[data-target="sec-reclamos"]').catch(() => {});
    await new Promise((r) => setTimeout(r, 2500));
    await shot("05-admin-reportes.png", "#sec-reclamos");

    // Sugerencias (admin)
    await page.click('#nav .tab[data-target="sec-sugerencias"]').catch(() => {});
    await new Promise((r) => setTimeout(r, 2000));
    await shot("06-admin-sugerencias.png", "#sec-sugerencias");

    // Estadisticas (admin)
    await page.click('#nav .tab[data-target="sec-stats"]').catch(() => {});
    await new Promise((r) => setTimeout(r, 2500));
    await shot("07-admin-estadisticas.png", "#sec-stats");

    // Usuarios (admin)
    await page.click('#nav .tab[data-target="sec-usuarios"]').catch(() => {});
    await new Promise((r) => setTimeout(r, 2000));
    await shot("08-admin-usuarios.png", "#sec-usuarios");

    // Novedades bell
    await page.click("#btn-novedades").catch(() => {});
    await new Promise((r) => setTimeout(r, 1200));
    await shot("09-novedades.png", "#sec-novedades");
  } catch (e) {
    console.log("FATAL:", e.message);
  }

  console.log("--- Console/page errors:", errors.length ? errors.slice(0, 10) : "none");
  await browser.close();
})();
