import { default as puppeteer } from "puppeteer-core";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const HTML = path.join(__dirname, "manual.html");
const PDF = path.join(__dirname, "Manual-Funciones-Casas-del-Parque-7.pdf");

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--ignore-certificate-errors"],
  });
  const page = await browser.newPage();
  await page.goto("file://" + HTML.replace(/\\/g, "/"), { waitUntil: "networkidle0", timeout: 60000 });

  const pdf = await page.pdf({
    path: PDF,
    format: "A4",
    printBackground: true,
    preferCSSPageSize: false,
    margin: { top: "0mm", right: "0mm", bottom: "0mm", left: "0mm" },
  });
  console.log("PDF generado:", PDF, "(" + Math.round(pdf.length / 1024) + " KB)");
  const ROOT_PDF = "C:\\Users\\ac17157\\casas-del-parque-7-full\\Manual-Funciones-Casas-del-Parque-7.pdf";
  import("node:fs").then(fs => {
    fs.writeFileSync(ROOT_PDF, pdf);
    console.log("Copiado a root:", ROOT_PDF);
  });
  await browser.close();
})();