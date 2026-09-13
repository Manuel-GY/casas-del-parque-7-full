import { default as puppeteer } from "puppeteer-core";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BASE = "https://manuel-gy.github.io/casas-del-parque-7-full/";
const OUT = path.join(__dirname, "shots");
const EMAIL = "mrivera@live.cl";
const PASS = "Natalia1204";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: "new",
    defaultViewport: { width: 1280, height: 900, deviceScaleFactor: 1 },
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--ignore-certificate-errors",
      "--disable-web-security",
      "--allow-running-insecure-content",
      "--disable-features=IsolateOrigins,site-per-process",
    ],
  });
  const page = await browser.newPage();

  async function shot(name, selector) {
    try {
      await sleep(1500);
      if (selector) {
        const el = await page.$(selector);
        if (el) {
          await el.scrollIntoViewIfNeeded();
          await sleep(500);
          await el.screenshot({ path: path.join(OUT, name) });
          console.log("OK  ", name, "(element)");
          return;
        }
        console.log("SKIP", name, "- selector not found");
        return;
      }
      await page.screenshot({ path: path.join(OUT, name), fullPage: false });
      console.log("OK  ", name, "(viewport)");
    } catch (e) {
      console.log("FAIL", name, "-", e.message);
    }
  }

  try {
    await page.goto(BASE, { waitUntil: "networkidle2", timeout: 60000 });
    await page.waitForSelector("#login-email", { timeout: 30000 });
    await page.type("#login-email", EMAIL);
    await page.type("#login-pass", PASS);
    await page.click("#login-btn");
    await page.waitForFunction(() => {
      const m = document.getElementById("app-main");
      return m && !m.classList.contains("hidden");
    }, { timeout: 45000 }).catch(() => {});
    await sleep(5500);

    // Vecino dashboard/resumen
    await shot("10-vecino-resumen.png", ".welcome");

    // Formulario Reportar
    await page.click('#nav .tab[data-target="sec-nuevo"]').catch(() => {});
    await sleep(1800);
    await shot("11-vecino-reportar.png", "#sec-nuevo");
await page.select("#recl-categoria", "seguridad").catch(() => {});
    await sleep(400);
    await shot("12-vecino-reportar-categoria.png", "#reclamo-form");

    // Formulario Sugerir
    await page.click('#nav .tab[data-target="sec-sugerir"]').catch(() => {});
    await sleep(1800);
    await shot("13-vecino-sugerir.png", "#sec-sugerir");

    // Mis Reportes
    await page.click('#nav .tab[data-target="sec-mios"]').catch(() => {});
    await sleep(2500);
    await shot("14-vecino-mis-reportes.png", "#sec-mios");

    // Mis Sugerencias
    await page.click('#nav .tab[data-target="sec-mias"]').catch(() => {});
    await sleep(2500);
    await shot("15-vecino-mis-sugerencias.png", "#sec-mias");

    // Estadisticas vecino
    await page.click('#nav .tab[data-target="sec-stats"]').catch(() => {});
    await sleep(2500);
    await shot("16-vecino-estadisticas.png", "#sec-stats");
  } catch (e) {
    console.log("FATAL:", e.message);
  }

  await browser.close();
})();

