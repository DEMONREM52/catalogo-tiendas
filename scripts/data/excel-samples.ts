/**
 * Excel de ejemplo de RemHub Data Studio con DATOS DE PRUEBA (inventados, marcados «PRUEBA»), para revisar la
 * calidad de los documentos en Excel. Uso: npm run excel:samples  →  docs/ejemplos-excel/*.xlsx
 */
import fs from "node:fs";
import path from "node:path";
import { buildXlsxAsync, type XBook, type XCell } from "../../src/lib/data/xlsx";

const out = path.join(process.cwd(), "docs", "ejemplos-excel");
fs.mkdirSync(out, { recursive: true });
const png = new Uint8Array(fs.readFileSync(path.join(process.cwd(), "public", "icons", "remhub-192.png")));
const photo = { image: png, ext: "png" as const, w: 192, h: 192, alt: "" };
const company = "TIENDA DE PRUEBA S.A.S.";
const user = "Usuario de prueba";
const when = new Date("2026-11-27T15:30:00Z");

const productos = [
  ["00001234", "7701234567890", "OLLA EXPRESS 6 LITROS ACERO INOXIDABLE (PRUEBA)", "Cocina", 42, 61000, 89000, 79000],
  ["MV-759", "7709876543210", "MAQUINA 5 EN 1 DE DAMA VGR V 759 (PRUEBA)", "Belleza", 15, 52000, 99000, 85000],
  ["SC11WF", "0012345678905", "SECADOR DE CABELLO PROFESIONAL 2200W (PRUEBA)", "Belleza", 0, 38000, 69000, 59000],
  ["K41-COMBO", "", "RELOJ EN COMBO CARGADOR AUDIFONO K41 (PRUEBA)", "Tecnología", 3, 45000, 89000, 75000],
  ["WB-999", "7700000000017", "MAQUINA PATILLERA DIGITAL WEIBO WB 999 (PRUEBA)", "Belleza", 21, 35000, 65000, 55000],
  ["TZ_1", "", "TAZA DE CERÁMICA ROSA 350 ML (PRUEBA)", "Hogar", 120, 4200, 9900, 7900],
  ["KIT-LARGO-01", "", "KIT DE COCINA COMPLETO CON OLLAS, SARTENES, UTENSILIOS DE SILICONA Y TABLA DE PICAR DE BAMBÚ PARA REGALO (PRUEBA)", "Cocina", 7, 120000, 199000, 179000],
] as const;

async function save(name: string, book: XBook) {
  const bytes = await buildXlsxAsync(book);
  fs.writeFileSync(path.join(out, name), bytes);
  console.log(`  ${name} · ${(bytes.length / 1024).toFixed(1)} KB`);
}

// 1. Inventario valorizado con resumen, totales, alertas de existencia y gráfico.
await save("inventario-valorizado-PRUEBA.xlsx", {
  meta: {
    company, user, generatedAt: when, theme: "amethyst", title: "Inventario valorizado", subtitle: "Datos de prueba: no son de ninguna tienda real",
    filters: [["Bodega", "Bodega principal"], ["Categoría", "Todas"], ["Productos", String(productos.length)]],
    kpis: [
      { label: "Unidades en inventario", formula: "SUBTOTAL(109,T1_inventario[Unidades])", value: productos.reduce((s, p) => s + p[4], 0), type: "int" },
      { label: "Valor al costo", formula: "SUBTOTAL(109,T1_inventario[Valor al costo])", value: productos.reduce((s, p) => s + p[4] * p[5], 0), type: "money" },
      { label: "Valor a precio detal", formula: "SUBTOTAL(109,T1_inventario[Valor a precio detal])", value: productos.reduce((s, p) => s + p[4] * p[6], 0), type: "money" },
      { label: "Productos agotados", formula: 'COUNTIF(T1_inventario[Unidades],"<=0")', value: productos.filter((p) => p[4] <= 0).length, type: "int", hint: "En rojo en la hoja Inventario" },
    ],
    notes: ["«Valor al costo» y «Valor a precio detal» son fórmulas: si cambias unidades o precios, se recalculan."],
  },
  sheets: [{
    name: "Inventario",
    head: ["Referencia", "Código de barras", "Producto", "Categoría", "Unidades", "Costo unitario", "Precio detal", "Valor al costo", "Valor a precio detal", "Margen sobre venta"],
    totals: true,
    freezeCols: 1,
    columns: [undefined, { type: "code" }, undefined, undefined,
      { type: "int", cond: [{ when: "lte", value: 0, tone: "bad" }, { when: "between", value: 1, value2: 5, tone: "warn" }] },
      { type: "money" }, { type: "money" }, { type: "money", total: "sum" }, { type: "money", total: "sum" },
      { type: "percent", cond: [{ when: "lt", value: 0.3, tone: "warn" }] }],
    rows: productos.map((p, i) => {
      const r = i + 2;
      return [p[0], p[1], p[2], p[3], p[4], p[5], p[6],
        { f: `E${r}*F${r}`, v: p[4] * p[5] }, { f: `E${r}*G${r}`, v: p[4] * p[6] },
        { f: `IF(G${r}=0,"",(G${r}-F${r})/G${r})`, v: (p[6] - p[5]) / p[6] }] as XCell[];
    }),
    charts: [{ kind: "bar", title: "Valor al costo por producto", catCol: 0, valCols: [7], at: { col: 11, row: 0, cols: 8, rows: 16 } }],
  }],
});

// 2. Catálogo con fotos, precios por mayor y detal, y enlace a la ficha.
await save("catalogo-con-fotos-PRUEBA.xlsx", {
  meta: { company, user, generatedAt: when, theme: "profesional", title: "Catálogo de precios", subtitle: "Precios de prueba", filters: [["Lista", "Por mayor y detal"]] },
  sheets: [{
    name: "Catálogo",
    head: ["Foto", "Referencia", "Producto", "Por mayor", "Detal", "Ficha"],
    imageRowHeight: 80,
    columns: [undefined, undefined, { wrap: true, width: 36 }, { type: "money" }, { type: "money" }],
    rows: productos.map((p) => [photo, p[0], p[2], p[7], p[6], { v: "Ver producto", link: `https://remhub.co/tienda-prueba/producto/${p[0]}` }]),
  }],
});

// 3. Conteo en grupo: consolidado, aportes por persona y diferencias en plata.
const aportes: Array<[string, string, number]> = [["MV-759", "Ana", 10], ["MV-759", "Luis", 4], ["00001234", "Ana", 40], ["TZ_1", "Pedro (invitado)", 118], ["SC11WF", "Luis", 0]];
const conteo = productos.filter((p) => aportes.some((a) => a[0] === p[0])).map((p) => {
  const contado = aportes.filter((a) => a[0] === p[0]).reduce((s, a) => s + a[2], 0);
  return { p, contado };
});
await save("conteo-en-grupo-PRUEBA.xlsx", {
  meta: {
    company, user, generatedAt: when, theme: "verde", title: "Conteo en grupo · Bodega principal", subtitle: "A ciegas · 3 personas · datos de prueba",
    kpis: [
      { label: "Productos contados", formula: "ROWS(T1_consolidado[Referencia])", value: conteo.length, type: "int" },
      { label: "Faltan (unidades)", formula: 'SUMIF(T1_consolidado[Diferencia],"<0")*-1', value: -conteo.reduce((s, c) => s + Math.min(0, c.contado - c.p[4]), 0), type: "int" },
      { label: "Sobran (unidades)", formula: 'SUMIF(T1_consolidado[Diferencia],">0")', value: conteo.reduce((s, c) => s + Math.max(0, c.contado - c.p[4]), 0), type: "int" },
      { label: "Diferencia en plata (al costo)", formula: "SUBTOTAL(109,T1_consolidado[Diferencia en plata])", value: conteo.reduce((s, c) => s + (c.contado - c.p[4]) * c.p[5], 0), type: "money" },
    ],
  },
  sheets: [
    {
      name: "Consolidado", totals: true,
      head: ["Referencia", "Producto", "Sistema", "Contado", "Diferencia", "Costo unitario", "Diferencia en plata", "Estado"],
      columns: [undefined, undefined, { type: "int" }, { type: "int" }, { type: "int", total: "sum", cond: [{ when: "lt", value: 0, tone: "bad" }, { when: "gt", value: 0, tone: "info" }, { when: "eq", value: 0, tone: "good" }] },
        { type: "money" }, { type: "money", total: "sum" }, { cond: [{ when: "contains", value: "Falta", tone: "bad" }, { when: "contains", value: "Sobra", tone: "info" }, { when: "contains", value: "Cuadra", tone: "good" }] }],
      rows: conteo.map((c, i) => {
        const r = i + 2;
        const d = c.contado - c.p[4];
        return [c.p[0], c.p[2], c.p[4], c.contado, { f: `D${r}-C${r}`, v: d }, c.p[5], { f: `E${r}*F${r}`, v: d * c.p[5] },
          { f: `IF(E${r}<0,"Falta",IF(E${r}>0,"Sobra","Cuadra"))`, v: d < 0 ? "Falta" : d > 0 ? "Sobra" : "Cuadra" }] as XCell[];
      }),
    },
    { name: "Aportes", head: ["Referencia", "Quién contó", "Unidades"], rows: aportes.map((a) => [a[0], a[1], a[2]]), totals: true },
    { name: "Participantes", head: ["Persona", "Productos", "Unidades"], rows: ["Ana", "Luis", "Pedro (invitado)"].map((n) => [n, aportes.filter((a) => a[1] === n).length, aportes.filter((a) => a[1] === n).reduce((s, a) => s + a[2], 0)]), totals: true },
  ],
});

// 4. Traslado organizado por cajas.
const cajas: Array<[number, string, string, number]> = [[1, "Frágiles", "00001234", 20], [1, "Frágiles", "TZ_1", 60], [2, "", "MV-759", 10], [2, "", "WB-999", 15], [3, "", "00001234", 22]];
await save("traslado-por-cajas-PRUEBA.xlsx", {
  meta: { company, user, generatedAt: when, theme: "azul", title: "Traslado #148 · Bodega principal → Sede de prueba", filters: [["Pedido interno", "#582"], ["Estado", "En camino"]],
    kpis: [{ label: "Cajas", value: 3, type: "int" }, { label: "Unidades en cajas", formula: "SUBTOTAL(109,T1_contenido_por_caja[Unidades])", value: cajas.reduce((s, c) => s + c[3], 0), type: "int" }] },
  sheets: [
    { name: "Contenido por caja", head: ["Caja", "Nombre de la caja", "Referencia", "Producto", "Unidades"], totals: true,
      rows: cajas.map((c) => [c[0], c[1], c[2], productos.find((p) => p[0] === c[2])?.[2] ?? "", c[3]]) },
    { name: "Por producto", head: ["Referencia", "Producto", "Se envían", "En cajas", "Sin caja"], totals: true,
      rows: [["00001234", productos[0][2], 45, { f: 'SUMIF(T1_contenido_por_caja[Referencia],A2,T1_contenido_por_caja[Unidades])', v: 42 }, { f: "C2-D2", v: 3 }],
        ["TZ_1", productos[5][2], 60, { f: 'SUMIF(T1_contenido_por_caja[Referencia],A3,T1_contenido_por_caja[Unidades])', v: 60 }, { f: "C3-D3", v: 0 }]],
      columns: [undefined, undefined, { type: "int" }, { type: "int" }, { type: "int", total: "sum", cond: [{ when: "gt", value: 0, tone: "warn" }] }] },
  ],
});

// 5. Plantilla de importación de productos con listas desplegables.
await save("plantilla-productos-PRUEBA.xlsx", {
  sheets: [{
    name: "Productos",
    head: ["Referencia", "Código de barras", "Nombre", "Categoría", "Precio 3", "Activo"],
    columns: [{ type: "code" }, { type: "code" }, undefined, { list: ["Belleza", "Cocina", "Hogar", "Tecnología"] }, { type: "money" }, { list: ["Sí", "No"] }],
    rows: [["EJ-001", "0001234567890", "PRODUCTO DE EJEMPLO (BÓRRALO)", "Hogar", 25000, "Sí"]],
  }],
});
// 6. «Exportar productos» tal como sale de RemHub (con su ID): para cambiar precios en Excel y volver a subirlo.
//    Los ID son de prueba: al subirlo a una tienda real, dice que no son de esa tienda y no toca nada.
export const SAMPLE_IDS = productos.map((_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`);
await save("productos-para-actualizar-PRUEBA.xlsx", {
  meta: { company, user, generatedAt: when, title: "Productos", subtitle: "Exportado desde RemHub · Importar y exportar",
    notes: ["Cambia precios, nombres o categorías y vuelve a subir este archivo en Productos → Importar: verás antes y después."] },
  sheets: [{
    name: "Productos",
    head: ["Referencia", "Código de barras", "Nombre", "Categoría", "Precio 1", "Precio 2", "Precio 3", "Precio 4", "Precio 5",
      "Unidades (solo lectura)", "Costo (solo lectura)", "Activo", "Descripción", "Foto", "Creado", "ID RemHub (no cambiar)"],
    rows: productos.map((p, i) => [p[0], p[1], p[2], p[3].toUpperCase(), p[6], p[7], p[6], p[6], p[6], p[4], p[5], "Sí", i === 0 ? "Acero inoxidable" : "", "", "27/11/2026", SAMPLE_IDS[i]]),
  }],
});
console.log(`Listo: ${out}`);
