"use client";

import { useEffect } from "react";

/**
 * Tablas que en celular se vuelven tarjetas (clase `rt` en el <table>): copia el título de cada columna
 * a sus celdas (data-label) para que el CSS lo muestre encima de cada dato. Se monta una vez en el panel
 * y vuelve a etiquetar cuando cambian las tablas.
 */
function label(root: ParentNode) {
  root.querySelectorAll<HTMLTableElement>("table.rt").forEach((table) => {
    const heads: string[] = [];
    table.querySelectorAll<HTMLTableCellElement>("thead tr:last-child th").forEach((th) => {
      const text = (th.textContent ?? "").trim();
      for (let i = 0; i < Math.max(1, th.colSpan); i++) heads.push(text);
    });
    if (!heads.length) return;
    table.querySelectorAll<HTMLTableRowElement>("tbody tr, tfoot tr").forEach((tr) => {
      let col = 0;
      for (const cell of Array.from(tr.cells)) {
        const h = heads[col] ?? "";
        if (h && cell.getAttribute("data-label") !== h) cell.setAttribute("data-label", h);
        col += Math.max(1, cell.colSpan);
      }
    });
  });
}

export function ResponsiveTables() {
  useEffect(() => {
    let raf = 0;
    const run = () => { raf = 0; label(document); };
    run();
    const mo = new MutationObserver(() => { if (!raf) raf = requestAnimationFrame(run); });
    mo.observe(document.body, { childList: true, subtree: true });
    return () => { mo.disconnect(); cancelAnimationFrame(raf); };
  }, []);
  return null;
}
