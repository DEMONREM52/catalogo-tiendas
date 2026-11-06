/**
 * Optimizar las fotos que ya están en Supabase Storage (Cached Egress).
 *
 * Las fotos viejas se subieron antes de comprimir: PNG de hasta 2 MB que se descargan en cada visita
 * al catálogo, al POS y al panel. Este script las vuelve WebP (máx. 1600 px, calidad 80) en LA MISMA
 * dirección (no hay que tocar la base) y les pone caché de 1 año (el navegador no las vuelve a pedir).
 *
 *   node scripts/optimizar-imagenes.mjs                 → SOLO MIRA: cuántas, cuánto pesan, cuánto se ahorra. No cambia nada.
 *   node scripts/optimizar-imagenes.mjs --aplicar       → las optimiza (antes guarda cada original en backups/imagenes/).
 *
 * Opciones:
 *   --bucket=product-images        un solo bucket (por defecto: product-images, store-assets, category-images)
 *   --min-kb=200                   solo las que pesan más de esto (por defecto 200 KB)
 *   --lado=1600                    lado máximo en píxeles
 *   --limite=50                    procesar solo las primeras N (para probar)
 *
 * Volver atrás: node scripts/optimizar-imagenes.mjs --restaurar   (sube de nuevo las originales de backups/imagenes/)
 *
 * Lee NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY de .env.local. La llave nunca se imprime.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, "").split("=");
  return [k, v ?? true];
}));
const APPLY = Boolean(args.aplicar);
const RESTORE = Boolean(args.restaurar);
const BUCKETS = args.bucket ? [String(args.bucket)] : ["product-images", "store-assets", "category-images"];
const MIN_BYTES = Number(args["min-kb"] ?? 200) * 1024;
const MAX_SIDE = Number(args.lado ?? 1600);
const LIMIT = args.limite ? Number(args.limite) : Infinity;
// Todo relativo a la carpeta del proyecto (funciona aunque se corra desde otra carpeta, p. ej. con Code Runner).
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BACKUP = path.join(ROOT, "backups", "imagenes");
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
const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`;

/** Todos los archivos de un bucket (recorre carpetas, de a 1.000). */
async function listAll(bucket, prefix = "") {
  const files = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await sb.storage.from(bucket).list(prefix, { limit: 1000, offset, sortBy: { column: "name", order: "asc" } });
    if (error) throw new Error(`${bucket}/${prefix}: ${error.message}`);
    for (const item of data ?? []) {
      const full = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.id === null) files.push(...(await listAll(bucket, full))); // carpeta
      else files.push({ path: full, size: Number(item.metadata?.size ?? 0), type: String(item.metadata?.mimetype ?? ""), cache: String(item.metadata?.cacheControl ?? "") });
    }
    if (!data || data.length < 1000) break;
  }
  return files;
}

async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; await fn(items[k], k); } }));
}

async function restore() {
  if (!fs.existsSync(BACKUP)) return console.log("No hay respaldos en", BACKUP);
  let n = 0;
  for (const bucket of fs.readdirSync(BACKUP)) {
    const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name)]));
    for (const file of walk(path.join(BACKUP, bucket))) {
      if (file.endsWith(".tipo")) continue;
      const rel = path.relative(path.join(BACKUP, bucket), file).split(path.sep).join("/");
      const type = fs.existsSync(`${file}.tipo`) ? fs.readFileSync(`${file}.tipo`, "utf8") : "image/png";
      const { error } = await sb.storage.from(bucket).upload(rel, fs.readFileSync(file), { upsert: true, contentType: type, cacheControl: "3600" });
      console.log(error ? `✘ ${bucket}/${rel}: ${error.message}` : `↩ ${bucket}/${rel}`);
      if (!error) n++;
    }
  }
  console.log(`\nRestauradas ${n} imágenes.`);
}

async function main() {
  if (RESTORE) return restore();
  console.log(APPLY ? "MODO APLICAR: se optimizan las imágenes (con respaldo local).\n" : "SOLO MIRAR: no se cambia nada. Para aplicar, agrega --aplicar.\n");
  let total = 0, heavyBytes = 0, savedBytes = 0, done = 0, skipped = 0, failed = 0;
  const report = [["bucket", "archivo", "antes_kb", "despues_kb", "resultado"]];
  for (const bucket of BUCKETS) {
    let files;
    try { files = await listAll(bucket); } catch (e) { console.log(`· ${bucket}: no se pudo leer (${e.message})`); continue; }
    const images = files.filter((f) => /^image\/(png|jpeg|jpg|webp)$/i.test(f.type) || /\.(png|jpe?g|webp)$/i.test(f.path));
    const heavy = images.filter((f) => f.size > MIN_BYTES).sort((a, b) => b.size - a.size).slice(0, LIMIT);
    const bytes = images.reduce((s, f) => s + f.size, 0);
    const shortCache = images.filter((f) => !/31536000/.test(f.cache)).length;
    total += images.length;
    heavyBytes += heavy.reduce((s, f) => s + f.size, 0);
    console.log(`· ${bucket}: ${images.length} imágenes, ${mb(bytes)} · ${heavy.length} pesan más de ${MIN_BYTES / 1024} KB (${mb(heavy.reduce((s, f) => s + f.size, 0))}) · ${shortCache} sin caché de 1 año`);
    if (heavy.length) console.log(`  Las más pesadas: ${heavy.slice(0, 5).map((f) => `${f.path} (${Math.round(f.size / 1024)} KB)`).join(", ")}`);
    if (!APPLY) continue;

    await pool(heavy, 4, async (f) => {
      try {
        const { data, error } = await sb.storage.from(bucket).download(f.path);
        if (error || !data) throw new Error(error?.message ?? "sin datos");
        const input = Buffer.from(await data.arrayBuffer());
        const meta = await sharp(input, { animated: true }).metadata();
        if ((meta.pages ?? 1) > 1) { skipped++; report.push([bucket, f.path, Math.round(input.length / 1024), "", "animada (se deja)"]); return; }
        const output = await sharp(input).rotate()
          .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: "inside", withoutEnlargement: true })
          .webp({ quality: 80, effort: 5 }).toBuffer();
        if (output.length > input.length * 0.8) { skipped++; report.push([bucket, f.path, Math.round(input.length / 1024), Math.round(output.length / 1024), "ya estaba bien"]); return; }
        // Respaldo local ANTES de reemplazar.
        const backupFile = path.join(BACKUP, bucket, ...f.path.split("/"));
        fs.mkdirSync(path.dirname(backupFile), { recursive: true });
        if (!fs.existsSync(backupFile)) {
          fs.writeFileSync(backupFile, input);
          fs.writeFileSync(`${backupFile}.tipo`, f.type || "image/png");
        }
        const up = await sb.storage.from(bucket).upload(f.path, output, { upsert: true, contentType: "image/webp", cacheControl: CACHE });
        if (up.error) throw new Error(up.error.message);
        done++;
        savedBytes += input.length - output.length;
        report.push([bucket, f.path, Math.round(input.length / 1024), Math.round(output.length / 1024), "optimizada"]);
        if (done % 25 === 0) console.log(`  … ${done} optimizadas (${mb(savedBytes)} menos)`);
      } catch (e) {
        failed++;
        report.push([bucket, f.path, Math.round(f.size / 1024), "", `error: ${e.message}`]);
      }
    });
  }

  console.log(`\nTotal: ${total} imágenes. Pesadas: ${mb(heavyBytes)}.`);
  if (!APPLY) {
    console.log(`Estimado: al pasar a WebP suelen quedar en ~10–15 % → se ahorrarían unos ${mb(heavyBytes * 0.87)} por cada vez que se vean todas.`);
    console.log("Para aplicar:  node scripts/optimizar-imagenes.mjs --aplicar --limite=20   (prueba con 20 y revisa el catálogo)");
    return;
  }
  fs.mkdirSync(BACKUP, { recursive: true });
  const csv = path.join(BACKUP, `informe-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.csv`);
  fs.writeFileSync(csv, report.map((r) => r.join(";")).join("\n"));
  console.log(`Optimizadas ${done} · sin cambio ${skipped} · con error ${failed} · ${mb(savedBytes)} menos.`);
  console.log(`Respaldos e informe en ${BACKUP}`);
}

main().catch((e) => { console.error("Falló:", e.message); process.exit(1); });
