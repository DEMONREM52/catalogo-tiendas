// Pruebas de 20261116: forma de pago en el comprobante y otros pedidos del mismo cliente.
import { makeDb } from "./setup.mjs";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
// Carpeta de migraciones (se puede cambiar si ya se movieron después de ejecutarlas).
const MIG = process.env.REMHUB_MIGRATIONS ?? path.join(here, "migraciones");
const combined = path.join(os.tmpdir(), `remhub_cmp_${process.pid}.sql`);
fs.writeFileSync(combined, [fs.readFileSync(path.join(here, "fixtures/prod_ventas.sql"), "utf8"),
  "alter table public.erp_order_meta add column if not exists customer_doc text; alter table public.erp_order_meta add column if not exists payment jsonb;",
  fs.readFileSync(path.join(MIG, "20261116_comprobante_pago_historial.sql"), "utf8")].join("\n"));
process.on("unhandledRejection", (e) => { console.error("FALLA:", e?.message, e?.where ?? ""); process.exit(2); });
const { db } = await makeDb(combined);
fs.unlinkSync(combined);

let pass = 0, fail = 0;
const ok = (c, l, x) => { if (c) { pass++; console.log("  ✔ " + l); } else { fail++; console.log("  ✘ " + l + (x !== undefined ? " → " + JSON.stringify(x).slice(0, 300) : "")); } };
const raw = async (s, p) => (await db.query(s, p)).rows;
const anon = async (s, p) => { await db.exec("set role anon"); try { return (await db.query(s, p)).rows[0]?.r; } finally { await db.exec("reset role"); } };

const [{ id: A }] = await raw("insert into stores (slug, name, owner_id) values ('a', 'A', gen_random_uuid()) returning id");
const [{ id: B }] = await raw("insert into stores (slug, name, owner_id) values ('b', 'B', gen_random_uuid()) returning id");
let n = 0;
async function order(store, name, doc, phone, total, payment) {
  n++;
  const token = `tok-${String(n).padStart(6, "0")}`;
  const [{ id }] = await raw("insert into orders (store_id, token, receipt_no, total, status, customer_name, customer_whatsapp, created_at) values ($1, $2, $3, $4, 'confirmed', $5, $6, now() - make_interval(mins => $7)) returning id", [store, token, n, total, name, phone, n]);
  await raw("insert into erp_order_meta (order_id, store_id, doc_kind, doc_number, customer_doc, payment) values ($1, $2, 'remision', $3, $4, $5)", [id, store, `REM-${n}`, doc, payment ? JSON.stringify(payment) : null]);
  return token;
}
const t1 = await order(A, "JUAN PEREZ", "1.020.304", "300 111 2233", 50000, { method: "efectivo", parts: [{ method: "efectivo", amount: 50000 }], received: 100000, change: 50000 });
const t2 = await order(A, "JUAN PEREZ", "1020304", null, 20000);
const t3 = await order(A, "J. PEREZ", null, "+57 3001112233", 15000);
const t4 = await order(A, "OTRA PERSONA", "999888777", null, 10000);
const t5 = await order(B, "JUAN PEREZ", "1020304", null, 7000);
const cf1 = await order(A, "CONSUMIDOR FINAL", "222222222222", null, 1000);
await order(A, "CONSUMIDOR FINAL", "222222222222", null, 2000);
const g1 = await order(A, "PEDRO", "222222222222", null, 3000);
await order(A, "PEDRO 2", "222222222222", null, 4000);

console.log("Forma de pago");
const pay = await anon("select public.erp_order_payment_by_token($1) r", [t1]);
ok(pay?.method === "efectivo" && Number(pay.change) === 50000 && Number(pay.received) === 100000, "El comprobante muestra cómo pagó y el vuelto", pay);
ok((await anon("select public.erp_order_payment_by_token($1) r", [t2])) === null, "Sin pago guardado: no muestra nada");
ok((await anon("select public.erp_order_payment_by_token('x') r")) === null, "Un enlace inválido no devuelve nada");

console.log("Historial del cliente");
const h = await anon("select public.erp_customer_orders_by_token($1) r", [t1]);
const tokens = h.rows.map((r) => r.token);
ok(tokens.includes(t2) && tokens.includes(t3), "Ve sus otros pedidos (por documento y por WhatsApp)", h);
ok(!tokens.includes(t1), "…sin repetir el que está viendo");
ok(!tokens.includes(t4) && !tokens.includes(cf1), "…nunca los de otros clientes");
ok(!tokens.includes(t5), "…ni los de otra tienda");
ok(h.rows.every((r) => !("items" in r) && !("customer_name" in r)), "Solo número, fecha, total y estado");
ok((await anon("select public.erp_customer_orders_by_token($1) r", [cf1])).rows.length === 0, "Consumidor final: no muestra historial");
ok((await anon("select public.erp_customer_orders_by_token($1) r", [g1])).rows.length === 0, "Documento genérico (222…): no junta clientes distintos");

console.log(`\n${pass} ok · ${fail} fallas`);
process.exit(fail ? 1 : 0);
