"use strict";
const puppeteer = require("puppeteer-core");
const path = require("path");
const fs = require("fs");

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
      await page.waitForTimeout(1200);
      if (selector) {
        const el = await page.$(selector);
        if (el) {
          await el.scrollIntoViewIfNeeded();
          await page.waitForTimeout(400);
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

  try {
    // ---------- Login page ----------
    await page.goto(BASE, { waitUntil: "networkidle2", timeout: 60000 });
    await page.waitForSelector("#login-email", { timeout: 30000 });
    await shot("01-login.png", "#auth-card");

    // ---------- Forgot password view ----------
    await page.click("#link-forgot").catch(() => {});
    await page.waitForTimeout(600);
    await shot("02-recuperar-clave.png", "#view-forgot");

    // ---------- Register view ----------
    await page.goto(BASE, { waitUntil: "networkidle2", timeout: 60000 });
    await page.waitForSelector("#link-registro", { timeout: 30000 });
    await page.click("#link-registro").catch(() => {});
    await page.waitForTimeout(700);
    await shot("03-registro.png", "#view-register");

    // ---------- Do login as admin ----------
    await page.goto(BASE, { waitUntil: "networkidle2", timeout: 60000 });
    await page.waitForSelector("#login-email", { timeout: 30000 });
    await page.type("#login-email", EMAIL);
    await page.type("#login-pass", PASS);
    await Promise.all([
      page.click("#login-btn"),
      page.waitForNavigation({ waitUntil: "networkidle2", timeout: 60000 }),
    ]).catch(async (e) => {
      // sometimes no nav; just wait
      await page.waitForTimeout(8000);
    });
    await page.waitForSelector("#app-main:not(.hidden)", { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(4000);

    // Admin dashboard
    await shot("04-dashboard-admin.png", ".welcome");

    // Reportes (admin)
    await page.click('#nav .tab[data-target="sec-reclamos"]').catch(() => {});
    await page.waitForTimeout(2500);
    await shot("05-admin-reportes.png", "#sec-reclamos");

    // Sugerencias (admin)
    await page.click('#nav .tab[data-target="sec-sugerencias"]').catch(() => {});
    await page.waitForTimeout(2000);
    await shot("06-admin-sugerencias.png", "#sec-sugerencias");

    // Estadisticas (admin)
    await page.click('#nav .tab[data-target="sec-stats"]').catch(() => {});
    await page.waitForTimeout(2500);
    await shot("07-admin-estadisticas.png", "#sec-stats");

    // Usuarios (admin)
    await page.click('#nav .tab[data-target="sec-usuarios"]').catch(() => {});
    await page.waitForTimeout(2000);
    await shot("08-admin-usuarios.png", "#sec-usuarios");

    // Novedades bell
    await page.click("#btn-novedades").catch(() => {});
    await page.waitForTimeout(1200);
    await shot("09-novedades.png", "#sec-novedades");
  } catch (e) {
    console.log("FATAL:", e.message);
  }

  console.log("--- Console/page errors:", errors.length ? errors.slice(0, 10) : "none");
  await browser.close();
})();