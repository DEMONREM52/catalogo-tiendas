// Pruebas de 20261270: la base avisa a remhub.co (remhub.store redirige y pg_net no sigue redirecciones).
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const db = new PGlite();
await db.exec(`create table public.app_private_config (key text primary key, value text not null);
  insert into public.app_private_config values ('push_webhook_url', 'https://remhub.store/api/push/stock-requests'), ('otro', 'https://www.remhub.store/api/x'), ('nada', 'hola');`);
const M = fs.readFileSync(path.join(here, "migraciones/20261270_avisos_dominio_nuevo.sql"), "utf8");
await db.exec(M);
await db.exec(M); // idempotente
const rows = Object.fromEntries((await db.query("select key, value from app_private_config")).rows.map((r) => [r.key, r.value]));
let fail = 0;
const ok = (c, l, x) => { console.log(`  ${c ? "✔" : "✘"} ${l}${c ? "" : " → " + JSON.stringify(x)}`); if (!c) fail++; };
ok(rows.push_webhook_url === "https://remhub.co/api/push/stock-requests", "El aviso de pedidos internos va a remhub.co", rows);
ok(rows.otro === "https://remhub.co/api/x", "También con www", rows);
ok(rows.nada === "hola", "Lo demás no se toca", rows);
const empty = new PGlite();
await empty.exec(M);
console.log("  ✔ Sin la tabla (otra base) no falla");
console.log(`\n${fail ? "FALLÓ" : "4 pruebas OK, 0 fallidas"}`);
process.exit(fail ? 1 : 0);
