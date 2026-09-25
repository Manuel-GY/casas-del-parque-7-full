/**
 * keep-alive.mjs — Ejecuta una consulta minima ("select 1;") contra el
 * proyecto de Supabase para evitar que se pause por inactividad (free tier).
 *
 * Uso:
 *   npm run db:keep-alive
 *
 * Configuracion (variable de entorno o .env.local en la raiz del repo):
 *   SUPABASE_ACCESS_TOKEN=sbp_...   Personal Access Token de Supabase.
 *   SUPABASE_PROJECT_REF=ref        (opcional) ref del proyecto; por defecto
 *                                   el de este repo.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_REF = "mpffqfofdoaoqflrpnng";
const ENV_FILE = join(ROOT, ".env.local");

/** Lee una clave desde el entorno o desde .env.local (formato KEY=valor). */
function leerClave(clave) {
  if (process.env[clave]) return process.env[clave];
  if (existsSync(ENV_FILE)) {
    const lineas = readFileSync(ENV_FILE, "utf8").split(/\r?\n/);
    for (const linea of lineas) {
      const m = linea.match(new RegExp("^\\s*" + clave + "\\s*=\\s*(.+?)\\s*$"));
      if (m) return m[1];
    }
  }
  return null;
}

async function ping(projectRef, token) {
  const url = `https://api.supabase.com/v1/projects/${projectRef}/database/query`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ query: "select 1;" })
  });
  const body = await res.text();
  return { ok: res.ok, status: res.status, body };
}

async function main() {
  const token = leerClave("SUPABASE_ACCESS_TOKEN");
  if (!token) {
    console.error("Falta SUPABASE_ACCESS_TOKEN.");
    process.exit(1);
  }
  const projectRef = leerClave("SUPABASE_PROJECT_REF") || DEFAULT_REF;

  console.log(`Enviando ping de keep-alive al proyecto ${projectRef}...`);
  const resultado = await ping(projectRef, token);

  if (!resultado.ok) {
    console.error(`Error ${resultado.status}:`);
    console.error(resultado.body);
    process.exit(1);
  }

  console.log("Ping exitoso. El proyecto sigue activo.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
