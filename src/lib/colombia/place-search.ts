// Búsqueda de municipios y departamentos de Colombia para los campos «Ciudad» y «Departamento».
// No importa la lista: la recibe, para que la lista se cargue a pedido.
import type { Municipio } from "./municipios";

/** Sin tildes, sin puntos ni comas, en mayúsculas y con un solo espacio: «Bogotá, D.C.» → «BOGOTA DC». */
export function placeKey(s: string | null | undefined): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[.,]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Nombres cortos y apodos con los que la gente escribe el departamento. */
const DEPT_ALIAS: Record<string, string> = {
  BOGOTA: "11",
  "BOGOTA DC": "11",
  "SAN ANDRES": "88",
  "SAN ANDRES Y PROVIDENCIA": "88",
  GUAJIRA: "44",
  VALLE: "76",
};

/** Código de 2 dígitos del departamento que el usuario escribió, o null si no es uno conocido. */
export function deptCode(depts: Record<string, string>, value: string | null | undefined): string | null {
  const k = placeKey(value);
  if (!k) return null;
  for (const [code, name] of Object.entries(depts)) if (placeKey(name) === k) return code;
  return DEPT_ALIAS[k] ?? null;
}

function rank(name: string, q: string): number {
  const k = placeKey(name);
  if (k === q) return 0;
  if (k.startsWith(q)) return 1;
  if (k.split(" ").some((w) => w.startsWith(q))) return 2;
  if (k.includes(q)) return 3;
  return -1;
}

/**
 * Municipios que coinciden con lo escrito. Si ya hay departamento, primero (o solo) los de ese departamento;
 * si en ese departamento no hay ninguno, busca en todo el país.
 */
export function searchCities(list: Municipio[], query: string, department?: string | null, depts?: Record<string, string>, limit = 40): Municipio[] {
  const q = placeKey(query);
  const dc = depts ? deptCode(depts, department) : null;
  const inDept = (m: Municipio) => dc !== null && m.code.startsWith(dc);
  if (!q) return dc ? list.filter(inDept).sort((a, b) => a.name.localeCompare(b.name, "es")).slice(0, limit) : [];
  const hits = list
    .map((m) => ({ m, r: rank(m.name, q) }))
    .filter((x) => x.r >= 0);
  const scoped = dc ? hits.filter((x) => inDept(x.m)) : hits;
  const pool = scoped.length ? scoped : hits;
  return pool
    // Empates: primero las capitales (código DANE terminado en 001), luego en orden alfabético.
    .sort((a, b) => a.r - b.r || Number(b.m.code.endsWith("001")) - Number(a.m.code.endsWith("001")) || a.m.name.localeCompare(b.m.name, "es"))
    .slice(0, limit)
    .map((x) => x.m);
}

/** Departamentos que coinciden con lo escrito (todos, en orden alfabético, si no hay nada escrito). */
export function searchDepts(depts: Record<string, string>, query: string): string[] {
  const names = Object.values(depts).sort((a, b) => a.localeCompare(b, "es"));
  const q = placeKey(query);
  if (!q) return names;
  const alias = DEPT_ALIAS[q];
  return names
    .map((n) => ({ n, r: alias && depts[alias] === n ? 0 : rank(n, q) }))
    .filter((x) => x.r >= 0)
    .sort((a, b) => a.r - b.r || a.n.localeCompare(b.n, "es"))
    .map((x) => x.n);
}

/** Si lo escrito es exactamente un municipio que solo existe en un departamento, ese municipio (para llenar el departamento solo). */
export function uniqueCity(list: Municipio[], value: string | null | undefined): Municipio | null {
  const k = placeKey(value);
  if (!k) return null;
  const same = list.filter((m) => placeKey(m.name) === k);
  return same.length === 1 ? same[0] : null;
}
