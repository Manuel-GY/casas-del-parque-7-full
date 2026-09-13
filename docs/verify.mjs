import { default as puppeteer } from "puppeteer-core";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BASE = "https://manuel-gy.github.io/casas-del-parque-7-full/";
const EMAIL = "demo@casasdelparque.cl";
const PASS = "Demo1234!";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: "new",
    defaultViewport: { width: 1280, height: 900 },
    args: ["--no-sandbox", "--ignore-certificate-errors", "--disable-web-security", "--disable-features=IsolateOrigins,site-per-process"],
  });
  const page = await browser.newPage();

  await page.goto(BASE, { waitUntil: "networkidle2", timeout: 60000 });
  await page.waitForSelector("#login-email", { timeout: 30000 });
  console.log("LOGIN:", (await page.evaluate(() => document.title)));

  await page.type("#login-email", EMAIL);
  await page.type("#login-pass", PASS);
  await page.click("#login-btn");
  await page.waitForFunction(() => {
    const m = document.getElementById("app-main");
    return m && !m.classList.contains("hidden");
  }, { timeout: 45000 }).catch(() => {});
  await sleep(5000);

  const checks = [
    ["#sec-reclamos", "h1, h2, .hero h3", "reclamos"],
    ["#sec-sugerencias", "h1, h2, .hero h3", "suger"],
    ["#sec-stats", "h1, h2, .hero h3", "estad"],
    ["#sec-usuarios", "h1, h2, .hero h3", "usuario"],
  ];
  for (const [sel, sub, tag] of checks) {
    await page.click(`#nav .tab[data-target="${sel.slice(1)}"]`).catch(() => {});
    await sleep(2500);
    const txt = await page.evaluate((s, sub) => {
      const el = document.querySelector(s);
      if (!el) return "NO ELEMENTO";
      const heads = el.querySelectorAll(sub);
      return Array.from(heads).map((h) => h.textContent.trim()).slice(0, 4).join(" | ");
    }, sel, sub);
    console.log(tag.toUpperCase(), "->", txt);
  }

  await browser.close();
})();