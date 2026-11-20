// Pruebas de 20261334: consumidor final sin crédito, «crédito» en el comprobante, notas crédito/débito y estado de cuenta por enlace.
import { makeDb } from "./setup.mjs";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const MIG = path.join(here, "migraciones");
const extra = `
create or replace function public.erp_can_any(p_store uuid, p_perms text[])
returns boolean language sql stable security definer set search_path = public as $fn$
  select auth.uid() is not null and (
    exists (select 1 from public.stores s where s.id = p_store and s.owner_id = auth.uid())
    or exists (select 1 from public.store_users su where su.store_id = p_store and su.user_id = auth.uid() and su.active
               and (su.role = 'store_admin' or su.permissions && p_perms)));
$fn$;
create or replace function public.erp_can(p_store uuid, p_perm text)
returns boolean language sql stable security definer set search_path = public as $fn$ select public.erp_can_any(p_store, array[p_perm]) $fn$;
create table if not exists public.erp_audit_logs (id bigserial primary key, store_id uuid, user_id uuid, action text, entity text, entity_id uuid, detail jsonb, created_at timestamptz default now());
create or replace function public.erp_audit(p_store uuid, p_action text, p_entity text, p_entity_id uuid, p_detail jsonb)
returns void language sql security definer set search_path = public as $fn$
  insert into public.erp_audit_logs (store_id, user_id, action, entity, entity_id, detail) values (p_store, auth.uid(), p_action, p_entity, p_entity_id, p_detail);
$fn$;
alter table public.erp_receivables add column if not exists kind text default 'order';
alter table public.erp_receivables add column if not exists doc_number text;
alter table public.erp_receivables add column if not exists description text;
alter table public.erp_receivables add column if not exists issue_date date default current_date;
alter table public.erp_receivables add column if not exists due_date date default current_date + 30;
alter table public.erp_receivables add column if not exists void_reason text;
alter table public.erp_receivables add column if not exists created_at timestamptz default now();
alter table public.erp_receivables add column if not exists updated_at timestamptz default now();
create table if not exists public.erp_receivable_payments (id uuid primary key default gen_random_uuid(), receivable_id uuid, amount numeric, method text,
  paid_at timestamptz default now(), voided boolean default false);
alter table public.billing_customers add column if not exists credit_enabled boolean default false;
alter table public.billing_customers add column if not exists credit_limit numeric default 0;
alter table public.billing_customers add column if not exists credit_days integer default 30;
create table if not exists public.fiscal_documents (id uuid primary key default gen_random_uuid(), store_id uuid, source_id uuid, status text, sent_at timestamptz);
`;
const combined = path.join(os.tmpdir(), `remhub_cc_${process.pid}.sql`);
fs.writeFileSync(combined, [fs.readFileSync(path.join(here, "fixtures/prod_ventas.sql"), "utf8"), extra].join("\n"));
process.on("unhandledRejection", (e) => { console.error("FALLA:", e?.message, e?.where ?? ""); process.exit(2); });
const { db } = await makeDb(combined, { twice: false });
fs.unlinkSync(combined);
const M = fs.readFileSync(path.join(MIG, "20261334_credito_completo.sql"), "utf8");
await db.exec(M);
await db.exec(M);

let pass = 0, fail = 0;
const ok = (c, l, x) => { if (c) { pass++; console.log("  ✔ " + l); } else { fail++; console.log("  ✘ " + l + (x !== undefined ? " → " + JSON.stringify(x).slice(0, 400) : "")); } };
const raw = async (s, p) => (await db.query(s, p)).rows;
const as = async (uid, s, p) => { await db.query("select set_config('test.uid', $1, false)", [uid ?? ""]); try { return (await db.query(s, p)).rows; } finally { await db.query("select set_config('test.uid', '', false)"); } };
const fails = async (fn) => { try { await fn(); return null; } catch (e) { return e.message; } };
const U = (n) => `cc000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const OWNER = U(1), SELLER = U(2), CASHIER = U(3);
const [{ id: S }] = await raw("insert into stores (slug, name, owner_id, logo_url) values ('a', 'La Tienda', $1, 'https://x/logo.png') returning id", [OWNER]);
await raw("insert into auth.users (id, email) values ($1, 's@x.co'), ($2, 'c@x.co')", [SELLER, CASHIER]);
await raw("insert into store_users (store_id, user_id, role, permissions, active, display_name) values ($1, $2, 'seller', '{pos,credit,receivables}', true, 'ANA'), ($1, $3, 'seller', '{pos}', true, 'LUIS')", [S, SELLER, CASHIER]);

// 1. Consumidor final sin crédito.
const [{ id: CF }] = await raw("insert into billing_customers (store_id, name, document_number) values ($1, 'CONSUMIDOR FINAL', '222222222222') returning id", [S]);
const [{ id: NODOC }] = await raw("insert into billing_customers (store_id, name) values ($1, 'PEDRO SIN CEDULA') returning id", [S]);
const [{ id: C }] = await raw("insert into billing_customers (store_id, name, document_number, credit_enabled, credit_limit, credit_days) values ($1, 'JULIETH MARIN', '1152695048', true, 1000000, 10) returning id", [S]);
ok(/Consumidor final/i.test(await fails(() => raw("update billing_customers set credit_enabled = true where id = $1", [CF])) ?? ""), "Consumidor final no puede tener crédito activo");
ok(/cédula o NIT/i.test(await fails(() => raw("update billing_customers set credit_enabled = true where id = $1", [NODOC])) ?? ""), "Sin cédula/NIT tampoco");
ok(/Consumidor final/i.test(await fails(() => raw("insert into erp_receivables (store_id, customer_id, total, balance) values ($1, $2, 100, 100)", [S, CF])) ?? ""), "No se crea cuenta por cobrar a Consumidor final");
ok((await fails(() => raw("update billing_customers set name = 'JULIETH ANDREA MARIN' where id = $1", [C]))) === null, "Editar un cliente con crédito sigue funcionando");

// 2. Venta a crédito confirmada.
const [{ id: O }] = await raw("insert into orders (store_id, token, status, total) values ($1, 'tok-credito-0001', 'confirmed', 177000) returning id", [S]);
const [{ id: R }] = await raw("insert into erp_receivables (store_id, customer_id, order_id, total, balance, doc_number, issue_date, due_date) values ($1, $2, $3, 177000, 177000, 'REMB-00009', current_date, current_date + 10) returning id", [S, C, O]);
const [{ p: pay }] = await as(null, "select public.erp_order_payment_by_token('tok-credito-0001') p");
ok(pay?.method === "credito" && Number(pay.credit.balance) === 177000 && pay.credit.days === 10 && pay.credit.status === "open", "El comprobante dice CRÉDITO, plazo 10 días y saldo, sin sesión", pay);
const [{ x: credit }] = await as(CASHIER, "select public.erp_orders_credit($1, array[$2]::uuid[]) x", [S, O]);
ok(credit.length === 1 && Number(credit[0].balance) === 177000, "El POS sabe que el documento es a crédito y su saldo", credit);

// 3. Notas.
const note = (uid, kind, amount, code, reason) => as(uid, "select public.erp_receivable_note($1, $2, $3, $4, $5) r", [R, kind, amount, code, reason]).then((r) => r[0].r);
ok((await note(CASHIER, "credit", 10000, "descuento", "Descuento por volumen")).code === "FORBIDDEN", "Sin permiso «Créditos» no hace notas");
ok((await note(SELLER, "credit", 200000, "descuento", "Descuento por volumen")).code === "OVER_BALANCE", "La nota crédito no supera el saldo");
ok((await note(SELLER, "credit", 10000, "inventado", "Descuento por volumen")).ok === false, "Motivo fuera de la lista: no");
const nc = await note(SELLER, "credit", 20000, "error_precio", "El castillo se cobró a 95 y era 75");
ok(nc.ok && nc.number === "NC-00001" && Number(nc.balance) === 157000, "Nota crédito NC-00001 baja el saldo a 157.000", nc);
let [rc] = await raw("select total, balance, status from erp_receivables where id = $1", [R]);
ok(Number(rc.total) === 157000 && Number(rc.balance) === 157000, "Total y saldo bajan juntos (lo abonado no cambia)", rc);
const nd = await note(SELLER, "debit", 5000, "flete", "Envío a domicilio cobrado aparte");
ok(nd.ok && nd.number === "ND-00001" && Number(nd.balance) === 162000, "Nota débito ND-00001 sube el saldo", nd);
await raw("insert into erp_receivable_payments (receivable_id, amount, method) values ($1, 160000, 'efectivo')", [R]);
await raw("update erp_receivables set balance = 2000 where id = $1", [R]);
const vd = (await as(SELLER, "select public.erp_receivable_note_void($1, 'Se cobró por error') r", [nd.id]))[0].r;
ok(vd.code === "HAS_PAYMENTS", "No se anula la nota débito si ya se abonó ese cargo", vd);
const vc = (await as(SELLER, "select public.erp_receivable_note_void($1, 'Se aplicó por error') r", [nc.id]))[0].r;
ok(vc.ok && Number(vc.balance) === 22000, "Anular la nota crédito devuelve el saldo", vc);
const full = await note(SELLER, "credit", 22000, "pronto_pago", "Descuento por pagar antes");
[rc] = await raw("select status from erp_receivables where id = $1", [R]);
ok(full.ok && rc.status === "paid", "Si la nota deja el saldo en cero, queda pagada", rc);
const [{ r: list }] = await as(SELLER, "select public.erp_customer_receivable_notes($1) r", [C]);
ok(list.length === 3 && list.some((n) => n.voided) && list[0].doc_number === "REMB-00009", "Lista de notas del cliente con su documento", list);
ok((await raw("select count(*)::int n from erp_audit_logs where action like 'receivable.%'"))[0].n === 4, "Cada nota y anulación queda en auditoría");

// Documento sin confirmar o con factura electrónica enviada: no.
const [{ id: O2 }] = await raw("insert into orders (store_id, token, status, total) values ($1, 'tok-borrador-01', 'draft', 50000) returning id", [S]);
const [{ id: R2 }] = await raw("insert into erp_receivables (store_id, customer_id, order_id, total, balance) values ($1, $2, $3, 50000, 50000) returning id", [S, C, O2]);
ok((await as(SELLER, "select public.erp_receivable_note($1, 'credit', 1000, 'descuento', 'Descuento acordado') r", [R2]))[0].r.code === "NOT_CONFIRMED", "Documento abierto: se corrige en el POS, no con nota");
await raw("update orders set status = 'confirmed' where id = $1", [O2]);
await raw("insert into fiscal_documents (store_id, source_id, status) values ($1, $2, 'ACCEPTED')", [S, O2]);
ok((await as(SELLER, "select public.erp_receivable_note($1, 'credit', 1000, 'descuento', 'Descuento acordado') r", [R2]))[0].r.code === "FISCAL", "Factura electrónica enviada: la nota va por la DIAN");

// 4. Estado de cuenta por enlace.
ok((await as(CASHIER, "select public.erp_statement_link($1) r", [C]))[0].r.ok === false, "Sin permiso de cartera no se crea el enlace");
const link = (await as(SELLER, "select public.erp_statement_link($1) r", [C]))[0].r;
ok(link.ok && /^[a-f0-9]{64}$/.test(link.token), "Enlace privado de 64 caracteres", link);
ok((await as(SELLER, "select public.erp_statement_link($1) r", [C]))[0].r.token === link.token, "Mientras esté vigente se reutiliza el mismo enlace");
const [{ r: st }] = await as(null, "select public.erp_statement_public($1) r", [link.token]);
ok(st.ok && st.customer.name === "JULIETH ANDREA MARIN" && st.store.name === "La Tienda", "El cliente lo abre sin sesión", st.customer);
ok(Number(st.totals.open) === 50000 && st.documents.length === 1, "Muestra lo que debe y los documentos pendientes", st.totals);
ok(st.movements.some((m) => m.kind === "payment" && Number(m.amount) === 160000) && st.movements.some((m) => m.kind === "credit_note"), "Incluye abonos y notas", st.movements);
const charge = st.movements.find((m) => m.kind === "charge" && m.label === "REMB-00009");
ok(charge && Number(charge.amount) === 177000, "La compra aparece por su valor original (las notas van aparte)", charge);
ok(!JSON.stringify(st).includes("cost"), "Sin costos");
ok((await as(null, "select public.erp_statement_public('abc') r"))[0].r.ok === false, "Enlace inválido: nada");
await as(SELLER, "select public.erp_statement_link_revoke($1)", [C]);
ok((await as(null, "select public.erp_statement_public($1) r", [link.token]))[0].r.ok === false, "Enlace desactivado: ya no abre");
const [priv] = await raw("select has_table_privilege('authenticated', 'public.erp_receivable_notes', 'select') n, has_table_privilege('anon', 'public.erp_statement_links', 'select') l");
ok(!priv.n && !priv.l, "Notas y enlaces solo se leen por las funciones", priv);

console.log(`\n${pass} bien, ${fail} mal`);
await db.close();
process.exitCode = fail ? 1 : 0;
