import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const pdfjs = require("pdfjs-dist/legacy/build/pdf.js");
const workerPath = path.join(path.dirname(require.resolve("pdfjs-dist/package.json")), "legacy/build/pdf.worker.js");
pdfjs.GlobalWorkerOptions.workerSrc = workerPath;

const buf = new Uint8Array(fs.readFileSync("Manual-Funciones-Casas-del-Parque-7.pdf"));
const pdf = await pdfjs.getDocument({ data: buf }).promise;
for (let i = 1; i <= pdf.numPages; i++) {
  const page = await pdf.getPage(i);
  const content = await page.getTextContent();
  const text = content.items.map((it) => it.str).join(" ").replace(/\s+/g, " ").trim();
  const first = text.split(" ").slice(0, 18).join(" ");
  console.log(`P${String(i).padStart(2)}: ${first}`);
}
await pdf.destroy();