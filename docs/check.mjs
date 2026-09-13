import fs from 'node:fs'
const b = fs.readFileSync('manual.html')
if (b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF) console.log('BOM PRESENTE')
try { new TextDecoder('utf-8', { fatal: true }).decode(b); console.log('utf8 ok') }
catch (e) { console.log('utf8 INVALIDO', e.message) }
const t = b.toString('utf8')
console.log('h3 pagebreak:', (t.match(/h3 class="block pagebreak"/g) || []).length)
const m = t.match(/\.shot img\{[^}]*\}/)
console.log('shot img css:', m ? m[0] : 'NO ENCONTRADO')
console.log('mojibake:', /Ã|Â|â€/.test(t) ? 'SI' : 'no')