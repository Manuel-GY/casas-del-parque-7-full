import fs from "node:fs";

const corrupted = fs.readFileSync("manual.html", "utf8");

// Strip UTF-8 BOM artifact from PowerShell — original had no BOM
const str = corrupted.startsWith("\uFEFF") ? corrupted.slice(1) : corrupted;

// Reverse CP1252→UTF-8 corruption: map each CP1252 special char back to its byte value
const reverse = new Map([
  ["\u20AC",0x80],["\u201A",0x82],["\u0192",0x83],["\u201E",0x84],
  ["\u2026",0x85],["\u2020",0x86],["\u2021",0x87],["\u02C6",0x88],
  ["\u2030",0x89],["\u0160",0x8A],["\u2039",0x8B],["\u0152",0x8C],
  ["\u017D",0x8E],["\u2018",0x91],["\u2019",0x92],["\u201C",0x93],
  ["\u201D",0x94],["\u2022",0x95],["\u2013",0x96],["\u2014",0x97],
  ["\u02DC",0x98],["\u2122",0x99],["\u0161",0x9A],["\u203A",0x9B],
  ["\u0153",0x9C],["\u017E",0x9E],["\u0178",0x9F],
]);

const bytes = [];
for (const ch of str) {
  const code = ch.codePointAt(0);
  if (code < 0x80) bytes.push(code);
  else if (reverse.has(ch)) bytes.push(reverse.get(ch));
  else if (code <= 0xFF) bytes.push(code);
  else bytes.push(0x3F);
}

const fixed = Buffer.from(bytes);

// Verify
const txt = fixed.toString("utf8");
const sample = txt.match(/Descripci.n de general|Gu.a comp|comit.e/);
console.log("verify:", sample ? sample[0] : "BAD");
const odd = txt.match(/Ã|Â|â€|Ã±|Ã©|Ã­|Ã³|Ãº|ðŸ/);
console.log("odd chars:", odd ? odd[0] : "none ✓");

fs.writeFileSync("manual.html", fixed);
console.log("fixed manual.html:", (fixed.length/1024).toFixed(0), "KB");