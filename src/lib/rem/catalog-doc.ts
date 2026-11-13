/**
 * docs/REM_CAPACIDADES.md se genera desde el catálogo (npm run rem:catalog). No se edita a mano:
 * tests/rem/catalog-sync.test.ts falla si quedó desactualizado.
 */

import { permissionLabel } from "@/lib/permissions";
import { CAPABILITIES, VOICE_SCREENS, catalogVersion } from "./catalog";
import { MODULES } from "./modules";
import { listActions } from "./actions";
import { EXCLUDED_ROUTES } from "./routes";

const RISK = { low: "bajo", medium: "medio", high: "alto", critical: "crítico" } as const;
const CONFIRM = { none: "—", yes: "«Di sí o no»", strong: "no por voz" } as const;
const perms = (p: string[]) => (p.length ? p.map((x) => `${permissionLabel(x)} (\`${x}\`)`).join(", ") : "cualquiera de la tienda");
const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

export function catalogMarkdown(): string {
  const out: string[] = [];
  out.push("# REM: catálogo de capacidades", "");
  out.push("> Generado desde `src/lib/rem` con `npm run rem:catalog`. No lo edites a mano: `tests/rem/catalog-sync.test.ts` falla si quedó viejo.", "");
  out.push(`Versión del catálogo: \`${catalogVersion()}\` · ${CAPABILITIES.length} capacidades · ${MODULES.length} módulos.`, "");
  out.push("Que REM conozca algo no quiere decir que cualquiera lo pueda usar: abre solo lo que la persona puede abrir a mano, y la base vuelve a revisar el permiso en cada consulta o cambio.", "");

  out.push("## Módulos", "");
  out.push("| Módulo | Ruta | Para qué sirve | Cómo se hace (pasos verificados) |", "|---|---|---|---|");
  for (const m of MODULES) {
    const how = (m.howto ?? []).map((h) => `${h.goal}${h.verified && h.steps.length ? ` (${h.steps.length} pasos)` : h.voice ? " (por voz)" : " (sin pasos)"}`).join("; ") || "—";
    out.push(`| ${m.name} | \`${m.path}\` | ${cell(m.about)} | ${cell(how)} |`);
  }
  out.push("");

  out.push("## Pantallas con voz", "");
  out.push("| Pantalla | Se abre diciendo | Permisos (basta uno) | Riesgo | Confirmación | Qué guarda o cambia |", "|---|---|---|---|---|---|");
  for (const v of VOICE_SCREENS) {
    out.push(`| ${v.name} | ${v.examples.map((e) => `«${e}»`).join(", ")} | ${perms(v.perms)} | ${RISK[v.risk]} | ${CONFIRM[v.confirm]} | ${cell(v.effect)} |`);
  }
  out.push("");

  out.push("## Acciones que REM ejecuta solo", "");
  out.push("| Acción | Riesgo | Confirmación | Permisos (basta uno) |", "|---|---|---|---|");
  for (const a of listActions()) out.push(`| \`${a.id}\` ${a.label} | ${RISK[a.risk]} | ${CONFIRM[a.confirm]} | ${perms(a.perms)} |`);
  out.push("");

  out.push("## Matriz de permisos: páginas y formularios", "");
  out.push("Sale del buscador Ctrl+K (`src/lib/search-index.ts`) y del menú (`src/lib/module-tabs.ts`). Formularios = riesgo medio: REM los abre vacíos, la persona los llena y guarda.", "");
  out.push("| Capacidad | Tipo | Ruta | Permisos (basta uno) | Solo dueño o admin |", "|---|---|---|---|---|");
  for (const c of CAPABILITIES.filter((x) => x.kind === "page" || x.kind === "form")) {
    out.push(`| ${cell(c.label)} | ${c.kind === "form" ? "formulario" : "página"} | \`${c.href}\` | ${perms(c.perms)} | ${c.adminOnly ? "sí" : ""} |`);
  }
  out.push("");

  out.push("## Rutas que REM no abre directo", "");
  for (const [route, why] of Object.entries(EXCLUDED_ROUTES)) out.push(`- \`${route}\`: ${why}`);
  out.push("");
  return out.join("\n");
}
