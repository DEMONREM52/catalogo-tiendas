import { money } from "./terceros";

export const ddmm = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString("es-CO", { day: "2-digit", month: "2-digit", year: "numeric" });

/** El mensaje con los datos de esa cuenta ({cliente}, {valor}, {fecha}, {documento}, {dias}, {tienda}). */
export function fillNotice(template: string, i: { name: string; balance: number; due_date: string; doc_number: string | null; days_left: number }, store: string) {
  return template
    .replaceAll("{cliente}", i.name)
    .replaceAll("{valor}", money(i.balance))
    .replaceAll("{fecha}", ddmm(i.due_date))
    .replaceAll("{documento}", i.doc_number ?? "")
    .replaceAll("{dias}", String(Math.abs(i.days_left)))
    .replaceAll("{tienda}", store)
    .replace(/\s{2,}/g, " ")
    .trim();
}

