/**
 * Miniaturas de 480 px para las fotos que ya existen (productos y categorías). Ver src/lib/images/thumb.ts.
 *
 * Las tarjetas del catálogo, del POS y de las listas muestran fotos de ~150–300 px, pero descargaban la de 1.600 px.
 * Con la miniatura (~20–40 KB) cada tarjeta pesa varias veces menos: baja la transferencia de Storage (Cached Egress).
 * Las fotos NUEVAS ya suben su miniatura solas; esto es para las de antes (y se puede repetir: salta las que ya están).
 *
 *   npm run images:thumbs                      → SOLO MIRA: cuántas fotos hay y a cuántas les falta miniatura. No cambia nada.
 *   npm run images:thumbs -- --aplicar         → crea las que faltan (no toca ni borra las fotos originales).
 *   npm run images:thumbs -- --quitar          → borra las miniaturas que encuentre (volver atrás).
 *
 * Opciones: --limite=50 (solo las primeras N, para probar) · --a-la-vez=4 (cuántas al mismo tiempo)
 *
 * Después de --aplicar: en Vercel agrega NEXT_PUBLIC_IMAGE_THUMBS=1 y vuelve a desplegar. Sin esa variable la
 * aplicación sigue mostrando la foto grande (las miniaturas no estorban). Si a una foto le falta su miniatura,
 * la página vuelve sola a la grande.
 *
 * Lee NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY de .env.local. La llave nunca se imprime.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { THUMB_SIDE, thumbPath, thumbTarget } from "../src/lib/images/thumb.ts";

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, "").split("=");
  return [k, v ?? true];
}));
const APPLY = Boolean(args.aplicar);
const REMOVE = Boolean(args.quitar);
const LIMIT = args.limite ? Number(args.limite) : Infinity;
const AT_ONCE = Math.max(1, Math.min(8, Number(args["a-la-vez"] ?? 4)));
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = "31536000";

function env() {
  const out = { ...process.env };
  for (const name of [".env.local", ".env"]) {
    const file = path.join(ROOT, name);
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && out[m[1]] === undefined) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
  return out;
}
const E = env();
if (!E.NEXT_PUBLIC_SUPABASE_URL || !E.SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env.local");
  process.exit(1);
}
const sb = createClient(E.NEXT_PUBLIC_SUPABASE_URL, E.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`;

/** Todas las direcciones de fotos de una tabla (de a 1.000: PostgREST no da más por consulta). */
async function urls(table) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from(table).select("image_url").not("image_url", "is", null).order("id").range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...data.map((r) => r.image_url));
    if (data.length < 1000) break;
  }
  return out;
}

async function exists(url) {
  const r = await fetch(url, { method: "HEAD" });
  return r.ok;
}

async function pool(items, n, fn) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) { const i = next++; await fn(items[i], i); }
  }));
}

const all = [...await urls("products"), ...await urls("product_categories")];
const seen = new Set();
const targets = [];
for (const u of all) {
  const t = thumbTarget(u);
  if (!t || seen.has(t.thumbUrl)) continue;
  seen.add(t.thumbUrl);
  targets.push({ ...t, url: u });
}
const work = targets.slice(0, LIMIT);
console.log(`Fotos en productos y categorías: ${all.length} · con miniatura posible: ${targets.length}${Number.isFinite(LIMIT) ? ` · revisando ${work.length}` : ""}`);

let have = 0, made = 0, failed = 0, removed = 0, bytesBig = 0, bytesSmall = 0;
await pool(work, AT_ONCE, async (t, i) => {
  try {
    const there = await exists(t.thumbUrl);
    if (REMOVE) {
      if (there) {
        const { error } = await sb.storage.from(t.bucket).remove([thumbPath(t.path, t.version)]);
        if (error) throw new Error(error.message);
        removed++;
      }
      return;
    }
    if (there) { have++; return; }
    if (!APPLY) return;
    const res = await fetch(t.url.split("?")[0]);
    if (!res.ok) throw new Error(`la foto respondió ${res.status}`);
    const big = Buffer.from(await res.arrayBuffer());
    const small = await sharp(big).rotate().resize(THUMB_SIDE, THUMB_SIDE, { fit: "inside", withoutEnlargement: true }).webp({ quality: 75 }).toBuffer();
    const { error } = await sb.storage.from(t.bucket).upload(thumbPath(t.path, t.version), small, { contentType: "image/webp", cacheControl: CACHE, upsert: true });
    if (error) throw new Error(error.message);
    made++; bytesBig += big.length; bytesSmall += small.length;
    if (made % 50 === 0) console.log(`  … ${made} creadas (${i + 1}/${work.length})`);
  } catch (e) {
    failed++;
    if (failed <= 10) console.log(`  ✘ ${t.path}: ${e.message}`);
  }
});

if (REMOVE) {
  console.log(`Miniaturas borradas: ${removed}${failed ? ` · fallaron ${failed}` : ""}`);
} else if (!APPLY) {
  console.log(`Ya tienen miniatura: ${have} · les falta: ${work.length - have - failed}${failed ? ` · no se pudieron revisar: ${failed}` : ""}`);
  console.log("No se cambió nada. Para crearlas: npm run images:thumbs -- --aplicar");
} else {
  console.log(`Creadas: ${made} · ya estaban: ${have} · fallaron: ${failed}`);
  if (made) console.log(`Peso: fotos ${mb(bytesBig)} → miniaturas ${mb(bytesSmall)} (promedio ${kb(bytesBig / made)} → ${kb(bytesSmall / made)} por tarjeta)`);
  console.log("Siguiente paso: en Vercel agrega NEXT_PUBLIC_IMAGE_THUMBS=1 y vuelve a desplegar.");
}
