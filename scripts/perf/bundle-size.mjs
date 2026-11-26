// JS inicial por página (lo que el navegador descarga al abrirla), medido del build de producción.
//
//   npm run build            → al terminar corre esto solo (postbuild) y revisa el presupuesto.
//   node scripts/perf/bundle-size.mjs [--json salida.json] [--all]
//
// Cómo mide: por cada página toma los chunks de su manifiesto de cliente (layout + loading + page) más los
// archivos raíz que carga toda página, y suma su tamaño comprimido con gzip y con brotli (lo que viaja por la red).
// El presupuesto está en scripts/perf/bundle-budget.json (kB gzip por página). Si una página se pasa, falla el
// build con la lista. Para dejar pasar una vez (y avisar): PERF_BUDGET=warn npm run build.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const NEXT = path.join(ROOT, ".next");
const BUDGET_FILE = path.join(ROOT, "scripts/perf/bundle-budget.json");
const args = process.argv.slice(2);
const jsonOut = args.includes("--json") ? args[args.indexOf("--json") + 1] : null;
const showAll = args.includes("--all");

if (!fs.existsSync(path.join(NEXT, "build-manifest.json"))) {
  console.error("No hay build de producción (.next). Corre primero: npm run build");
  process.exit(1);
}
const buildManifest = JSON.parse(fs.readFileSync(path.join(NEXT, "build-manifest.json"), "utf8"));
const rootFiles = buildManifest.rootMainFiles ?? [];

const sizeCache = new Map();
function sizes(file) {
  if (sizeCache.has(file)) return sizeCache.get(file);
  const buf = fs.readFileSync(path.join(NEXT, file));
  const out = {
    raw: buf.length,
    gz: zlib.gzipSync(buf, { level: 9 }).length,
    br: zlib.brotliCompressSync(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 } }).length,
  };
  sizeCache.set(file, out);
  return out;
}

function manifests(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) manifests(p, out);
    else if (e.name === "page_client-reference-manifest.js") out.push(p);
  }
  return out;
}

const rows = [];
for (const file of manifests(path.join(NEXT, "server/app"))) {
  globalThis.self = globalThis;
  globalThis.__RSC_MANIFEST = {};
  // El manifiesto es un script que llena globalThis.__RSC_MANIFEST.
  new Function(fs.readFileSync(file, "utf8"))();
  for (const [route, m] of Object.entries(globalThis.__RSC_MANIFEST)) {
    const chunks = new Set(rootFiles);
    for (const list of Object.values(m.entryJSFiles ?? {})) for (const c of list) chunks.add(c);
    let raw = 0, gz = 0, br = 0;
    for (const c of chunks) { const s = sizes(c); raw += s.raw; gz += s.gz; br += s.br; }
    const name = route.replace(/\/page$/, "") || "/";
    rows.push({ route: name, files: chunks.size, raw, gz, br });
  }
}
rows.sort((a, b) => b.gz - a.gz);

const kb = (n) => (n / 1024).toFixed(1);
const budget = fs.existsSync(BUDGET_FILE) ? JSON.parse(fs.readFileSync(BUDGET_FILE, "utf8")) : null;
const limitFor = (route) => {
  if (!budget) return null;
  if (budget.routes?.[route] !== undefined) return budget.routes[route];
  for (const [prefix, v] of Object.entries(budget.prefixes ?? {})) if (route.startsWith(prefix)) return v;
  return budget.default ?? null;
};

console.log(`\nJS inicial por página (${rows.length} páginas). kB = 1024 bytes.\n`);
console.log("gzip kB  brotli kB  archivos  página");
const over = [];
for (const r of rows) {
  const limit = limitFor(r.route);
  const isOver = limit !== null && r.gz / 1024 > limit;
  if (isOver) over.push({ ...r, limit });
  if (showAll || isOver || rows.indexOf(r) < 25) {
    console.log(`${kb(r.gz).padStart(7)}  ${kb(r.br).padStart(9)}  ${String(r.files).padStart(8)}  ${r.route}${isOver ? `   ⚠️ pasa el presupuesto (${limit} kB)` : ""}`);
  }
}
if (!showAll && rows.length > 25) console.log(`… ${rows.length - 25} páginas más (--all para verlas todas)`);
const shared = [...rootFiles].reduce((s, c) => s + sizes(c).gz, 0);
console.log(`\nCompartido por todas (raíz): ${kb(shared)} kB gzip`);

if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify({ measuredAt: new Date().toISOString(), shared, rows }, null, 2));

// --write-budget: rehace el presupuesto con lo medido + 8 % de holgura (después de revisar que el aumento es justo).
if (args.includes("--write-budget")) {
  const routes = Object.fromEntries(rows.map((r) => [r.route, Math.ceil((r.gz / 1024) * 1.08)]).sort(([a], [b]) => a.localeCompare(b)));
  const maxPublic = Math.max(...rows.filter((r) => !/^\/(dashboard|admin)/.test(r.route)).map((r) => r.gz / 1024));
  const out = {
    "//": "kB gzip de JS inicial por página (scripts/perf/bundle-size.mjs). Página nueva sin entrada: usa prefixes o default. Para rehacerlo: node scripts/perf/bundle-size.mjs --write-budget",
    default: Math.ceil(maxPublic * 1.08),
    prefixes: { "/dashboard": Math.ceil(Math.max(...rows.filter((r) => r.route.startsWith("/dashboard")).map((r) => r.gz / 1024)) * 1.05), "/admin": Math.ceil(Math.max(...rows.filter((r) => r.route.startsWith("/admin")).map((r) => r.gz / 1024)) * 1.08) },
    routes,
  };
  fs.writeFileSync(BUDGET_FILE, JSON.stringify(out, null, 2) + "\n");
  console.log(`\nPresupuesto escrito en ${path.relative(ROOT, BUDGET_FILE)} (${rows.length} páginas).`);
  process.exit(0);
}

if (over.length) {
  const warnOnly = process.env.PERF_BUDGET === "warn";
  console.log(`\n${warnOnly ? "⚠️" : "❌"} ${over.length} página(s) pasan el presupuesto de JS (scripts/perf/bundle-budget.json):`);
  for (const o of over) console.log(`   ${o.route}: ${kb(o.gz)} kB gzip (máximo ${o.limit} kB)`);
  console.log("   Revisa qué se importó de más (next/dynamic para ventanas y pestañas, nada de librerías pesadas en el arranque).");
  if (!warnOnly) process.exit(1);
} else if (budget) {
  console.log("\n✅ Todas las páginas dentro del presupuesto de JS.");
}
