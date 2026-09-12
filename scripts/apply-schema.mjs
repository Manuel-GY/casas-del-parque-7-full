/**
 * apply-schema.mjs — Aplica sql/schema.sql a Supabase (Management API).
 *
 * Uso:
 *   npm run db:push
 *
 * Configuracion (variable de entorno o .env.local en la raiz del repo,
 * archivo que NO se versiona):
 *   SUPABASE_ACCESS_TOKEN=sbp_...   Personal Access Token de Supabase
 *                                   (Account -> Access Tokens), permiso
 *                                   "Database -> Read-write" (run a query).
 *   SUPABASE_PROJECT_REF=ref        (opcional) ref del proyecto; por defecto
 *                                   el de este repo.
 *   APP_INSECURE_TLS=1              (opcional) SOLO si tu red corporativa
 *                                   intercepta el TLS (certificado
 *                                   autofirmado en la cadena) y no puedes
 *                                   confiar en la raiz corporativa. Evita
 *                                   verificar el certificado del servidor.
 *                                   Prefiere confiar en el CA corporativo via
 *                                   NODE_EXTRA_CA_CERTS antes que esto.
 *
 * Garantias:
 *   - schema.sql es IDEMPOTENTE; re-ejecutarlo es seguro.
 *   - El script sale con codigo distinto de 0 si falla (visible en CI).
 *   - No expone la contrasena de la base de datos en ningun lugar.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_REF = "mpffqfofdoaoqflrpnng";
const SCHEMA_FILE = join(ROOT, "sql", "schema.sql");
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

/** Aplica sql/schema.sql al proyecto usando la Management API. */
async function aplicar(query, projectRef, token) {
  const url = `https://api.supabase.com/v1/projects/${projectRef}/database/query`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ query })
    });
    const body = await res.text();
    return { ok: res.ok, status: res.status, body };
  } catch (err) {
    // fetch puede fallar a nivel de red/TLS (certificado autofirmado, etc.)
    const causa = err && err.cause && err.cause.message ? String(err.cause.message) : "";
    const msj = (err && err.message ? String(err.message) : "fetch fallido") + (causa ? " :: " + causa : "");
    return { ok: false, status: 0, body: msj };
  }
}

async function main() {
  if (!existsSync(SCHEMA_FILE)) {
    console.error("No existe sql/schema.sql");
    process.exit(1);
  }

  const token = leerClave("SUPABASE_ACCESS_TOKEN");
  if (!token) {
    console.error(
      "Falta SUPABASE_ACCESS_TOKEN.\n" +
      "Genera un Personal Access Token (sbp_...) en https://supabase.com/dashboard/account/tokens\n" +
      "y guardalo como variable de entorno o en un archivo .env.local:\n" +
      "  SUPABASE_ACCESS_TOKEN=sbp_..."
    );
    process.exit(1);
  }

  const projectRef = leerClave("SUPABASE_PROJECT_REF") || DEFAULT_REF;
  const query = readFileSync(SCHEMA_FILE, "utf8");

  console.log(`Aplicando sql/schema.sql al proyecto ${projectRef}...`);

  let resultado = await aplicar(query, projectRef, token);

  // Reintento unico solo si la red corporativa intercepta el TLS y el
  // usuario lo autorizo explicitamente (APP_INSECURE_TLS=1).
  if (!resultado.ok && /self-signed certificate|SELF_SIGNED_CERT/i.test(resultado.body) && leerClave("APP_INSECURE_TLS") === "1") {
    console.warn(
      "Advertencia: tu red corporativa emite un certificado autofirmado.\n" +
      "APP_INSECURE_TLS=1 activo: se omitira la verificacion del certificado SOLO para esta ejecucion."
    );
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
    resultado = await aplicar(query, projectRef, token);
  }

  if (!resultado.ok) {
    console.error(`Error ${resultado.status}:`);
    console.error(resultado.body);
    if (/self-signed certificate|SELF_SIGNED_CERT/i.test(resultado.body)) {
      console.error(
        "\nParece que tu red corporativa intercepta el TLS. Opciones:\n" +
        "  1) Confia en el CA corporativo y apunta NODE_EXTRA_CA_CERTS a el (recomendado).\n" +
        "  2) Agrega APP_INSECURE_TLS=1 a .env.local SOLO si entiendes el riesgo."
      );
    }
    process.exit(1);
  }

  console.log("Base de datos actualizada correctamente con sql/schema.sql.");
  if (resultado.body && resultado.body !== "null" && resultado.body.trim() !== "") {
    console.log(resultado.body);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});