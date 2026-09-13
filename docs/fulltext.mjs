import { createRequire } from 'node:module'
import fs from 'node:fs'
const require = createRequire(import.meta.url)
const pdfjs = require('pdfjs-dist/legacy/build/pdf.js')
const buf = new Uint8Array(fs.readFileSync('Manual-Funciones-Casas-del-Parque-7.pdf'))
const pdf = await pdfjs.getDocument({ data: buf }).promise
for (let i = 1; i <= pdf.numPages; i++) {
  const p = await pdf.getPage(i)
  const c = await p.getTextContent()
  const t = c.items.map(it => it.str).join(' ').replace(/\s+/g, ' ').trim()
  console.log(`--- P${i} (${t.length} chars) ---`)
  console.log(t.slice(0, 1600))
  console.log()
}
await pdf.destroy()