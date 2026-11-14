/**
 * Sincronización del conocimiento de REM con RemHub. Si alguien agrega, mueve o borra una página, o pone un
 * permiso que no existe, esto falla y dice qué actualizar. Así REM no queda «sabiendo» cosas viejas.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { CAPABILITIES, VOICE_SCREENS, catalogVersion } from "@/lib/rem/catalog";
import { MODULES } from "@/lib/rem/modules";
import { EXCLUDED_ROUTES } from "@/lib/rem/routes";
import { catalogMarkdown } from "@/lib/rem/catalog-doc";
import { PERMISSION_LIST } from "@/lib/permissions";
import { SEARCH_INDEX } from "@/lib/search-index";

const ROOT = new URL("../../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const APP = join(ROOT, "src", "app");

/** Todas las páginas reales del panel (cada page.tsx bajo src/app/dashboard), como rutas. */
function routes(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (f === "page.tsx") out.push("/" + relative(APP, dir).split(sep).join("/"));
    }
  };
  walk(join(APP, "dashboard"));
  return out.sort();
}

const pathOf = (href: string) => href.split("?")[0];
const ROUTES = routes();
// Permisos que existen (más los de grupo que el menú entiende).
const VALID = new Set([...PERMISSION_LIST.map((p) => p.value), "inventory", "products_view", "profit", "finance", "store", "users", "billing"]);

test("toda página del panel está en el catálogo de REM o explicada en EXCLUDED_ROUTES", () => {
  const known = new Set(CAPABILITIES.map((c) => pathOf(c.href)));
  const missing = ROUTES.filter((r) => !known.has(r) && !(r in EXCLUDED_ROUTES));
  assert.deepEqual(missing, [], `Páginas nuevas sin REM. Agrégalas al buscador (src/lib/search-index.ts) o a src/lib/rem/routes.ts: ${missing.join(", ")}`);
});

test("nada del catálogo apunta a una página que ya no existe", () => {
  const set = new Set(ROUTES);
  const dead = [...new Set(CAPABILITIES.map((c) => pathOf(c.href)))].filter((p) => !set.has(p));
  assert.deepEqual(dead, [], `Rutas borradas o movidas: ${dead.join(", ")}`);
  const deadModules = MODULES.filter((m) => !set.has(m.path)).map((m) => m.path);
  assert.deepEqual(deadModules, [], "módulos con ruta que no existe (src/lib/rem/modules.ts)");
  const deadExcluded = Object.keys(EXCLUDED_ROUTES).filter((r) => !set.has(r));
  assert.deepEqual(deadExcluded, [], "EXCLUDED_ROUTES con páginas que ya no existen");
});

test("todos los permisos del catálogo existen de verdad", () => {
  const bad = CAPABILITIES.flatMap((c) => c.perms.filter((p) => !VALID.has(p)).map((p) => `${c.label}: ${p}`));
  assert.deepEqual(bad, [], "permiso inventado o renombrado");
});

test("cada módulo y cada pantalla con voz tienen algo en el buscador (si no, nadie los podría abrir)", () => {
  const hrefs = new Set(CAPABILITIES.filter((c) => c.kind === "page" || c.kind === "form").map((c) => pathOf(c.href)));
  assert.deepEqual(MODULES.filter((m) => !hrefs.has(m.path)).map((m) => m.name), []);
  assert.deepEqual(VOICE_SCREENS.filter((v) => !hrefs.has(pathOf(v.href))).map((v) => v.name), []);
});

test("los «cómo se hace» llevan a enlaces que están en el buscador y los pasos están verificados", () => {
  const all = new Set(SEARCH_INDEX.map((e) => e.href));
  for (const m of MODULES) for (const h of m.howto ?? []) {
    if (h.href) assert.ok(all.has(h.href) || all.has(pathOf(h.href)) || ROUTES.includes(pathOf(h.href)), `${h.id}: ${h.href} no está en el buscador`);
    if (h.steps.length) assert.equal(h.verified, true, `${h.id}: pasos sin verificar no se dicen`);
  }
});

test("ids únicos, riesgos y confirmaciones coherentes", () => {
  const ids = CAPABILITIES.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const c of CAPABILITIES) {
    if (c.risk === "high" || c.risk === "critical") assert.notEqual(c.confirm, "none", `${c.label}: riesgo ${c.risk} sin confirmación`);
    if (c.kind === "page") assert.equal(c.risk, "low", c.label);
  }
});

test("docs/REM_CAPACIDADES.md está al día (si falla: npm run rem:catalog)", () => {
  const doc = readFileSync(join(ROOT, "docs", "REM_CAPACIDADES.md"), "utf8").replace(/\r\n/g, "\n");
  assert.ok(doc.includes(catalogVersion()), "la versión del catálogo cambió: corre npm run rem:catalog");
  assert.equal(doc.trimEnd(), catalogMarkdown().trimEnd());
});

test("cada consulta del catálogo tiene su acción registrada, y cada intención sugerible su capacidad (con permisos)", async () => {
  const { listActions } = await import("@/lib/rem/actions");
  const { INTENT_CAP } = await import("@/lib/rem/suggest");
  const actions = new Set(listActions().map((a) => a.id));
  const missing = CAPABILITIES.filter((c) => c.kind === "query").filter((c) => !actions.has(c.runner)).map((c) => `${c.id} → ${c.runner}`);
  assert.deepEqual(missing, [], "consulta sin acción en src/lib/rem/actions.ts");
  const ids = new Set(CAPABILITIES.map((c) => c.id));
  const orphan = Object.entries(INTENT_CAP).filter(([, id]) => !ids.has(id)).map(([k, id]) => `${k} → ${id}`);
  assert.deepEqual(orphan, [], "intención sugerible sin capacidad en el catálogo (sus permisos no se revisarían)");
});
