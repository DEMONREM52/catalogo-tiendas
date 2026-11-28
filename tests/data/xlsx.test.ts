// Motor de Excel de RemHub (Data Studio): tipos correctos, tabla nativa, totales con fórmula, seguridad.
import test from "node:test";
import assert from "node:assert/strict";
import { inflateRawSync } from "node:zlib";
import { buildXlsx, buildXlsxAsync, csvSafe, excelSerial, inferType, safeLink, tableCol, tableName, type XBook } from "../../src/lib/data/xlsx";

/** Lee el ZIP (sin comprimir o deflate) y devuelve los archivos como texto. */
function unzip(bytes: Uint8Array): Map<string, string> {
  const out = new Map<string, string>();
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let p = 0;
  while (p + 30 < bytes.length && dv.getUint32(p, true) === 0x04034b50) {
    const method = dv.getUint16(p + 8, true);
    const size = dv.getUint32(p + 18, true);
    const nlen = dv.getUint16(p + 26, true), xlen = dv.getUint16(p + 28, true);
    const name = new TextDecoder().decode(bytes.slice(p + 30, p + 30 + nlen));
    const start = p + 30 + nlen + xlen;
    const raw = bytes.slice(start, start + size);
    const data = method === 8 ? inflateRawSync(raw) : raw;
    out.set(name, new TextDecoder().decode(data));
    p = start + size;
  }
  return out;
}

const BOOK: XBook = {
  meta: { company: "TIENDA DE PRUEBA", title: "Inventario valorizado", user: "Prueba", filters: [["Bodega", "Principal"]], theme: "amethyst", generatedAt: new Date("2026-11-27T15:00:00Z"),
    kpis: [{ label: "Unidades", formula: "SUBTOTAL(109,T1_productos[Unidades])", value: 15, type: "int" }] },
  sheets: [{
    name: "Productos",
    head: ["Referencia", "Nombre", "Unidades", "Costo", "Valor", "Creado", "Ficha"],
    totals: true,
    columns: [undefined, undefined, { cond: [{ when: "lte", value: 0, tone: "bad" }] }, undefined, { total: "sum" }, undefined, undefined],
    rows: [
      ["00001234", "=HYPERLINK(\"http://malo\")", 5, 1000, { f: "C2*D2", v: 5000 }, "27/11/2026", { v: "Ver producto", link: "https://remhub.co/x/producto/1" }],
      ["7701234567890123", "OLLA EXPRESS 6 LITROS ACERO", 10, 2500.5, { f: "C3*D3", v: 25005 }, "01/02/2026 14:30", { v: "Ver", link: "javascript:alert(1)" }],
    ],
  }],
};

test("referencias y códigos largos quedan como texto (con sus ceros); plata y cantidades como número", () => {
  const files = unzip(buildXlsx(BOOK));
  const sheet = files.get("xl/worksheets/sheet2.xml")!;
  assert.match(sheet, /<c r="A2" s="\d+" t="inlineStr"><is><t xml:space="preserve">00001234<\/t>/);
  assert.match(sheet, /<c r="A3" s="\d+" t="inlineStr"><is><t xml:space="preserve">7701234567890123<\/t>/);
  assert.match(sheet, /<c r="C2" s="\d+"><v>5<\/v><\/c>/);
  assert.match(sheet, /<c r="D3" s="\d+"><v>2500.5<\/v><\/c>/);
});

test("un nombre que empieza por = no se vuelve fórmula (queda como texto)", () => {
  const sheet = unzip(buildXlsx(BOOK)).get("xl/worksheets/sheet2.xml")!;
  assert.match(sheet, /<c r="B2" s="\d+" t="inlineStr"><is><t xml:space="preserve">=HYPERLINK\(&quot;http:\/\/malo&quot;\)<\/t>/);
  assert.equal(csvSafe("=1+1"), "'=1+1");
  assert.equal(csvSafe("-5"), "'-5");
  assert.equal(csvSafe('a;"b"'), '"a;""b"""');
});

test("fechas reales de Excel (con hora de Colombia)", () => {
  assert.equal(excelSerial("27/11/2026"), 46353);
  assert.equal(excelSerial("2026-11-27"), 46353);
  assert.equal(excelSerial("01/02/2026 14:30"), 46054 + 14.5 / 24);
  assert.equal(excelSerial(new Date("2026-11-27T15:00:00Z")), 46353 + 10 / 24);
  assert.equal(excelSerial("31/02/2026"), null);
  const sheet = unzip(buildXlsx(BOOK)).get("xl/worksheets/sheet2.xml")!;
  assert.match(sheet, /<c r="F2" s="\d+"><v>46353<\/v><\/c>/);
});

test("tabla nativa con filtros, totales con SUBTOTAL y fórmulas por fila", () => {
  const files = unzip(buildXlsx(BOOK));
  const table = files.get("xl/tables/table1.xml")!;
  assert.match(table, /name="T1_productos" displayName="T1_productos" ref="A1:G4" totalsRowCount="1"/);
  assert.match(table, /<autoFilter ref="A1:G3"\/>/);
  assert.match(table, /<tableColumn id="5" name="Valor" totalsRowFunction="sum"\/>/);
  const sheet = files.get("xl/worksheets/sheet2.xml")!;
  assert.match(sheet, /<c r="E2" s="\d+"><f>C2\*D2<\/f><v>5000<\/v><\/c>/);
  assert.match(sheet, /<c r="E4" s="\d+"><f>SUBTOTAL\(109,T1_productos\[Valor\]\)<\/f><v>30005<\/v><\/c>/);
  assert.match(sheet, /state="frozen"/);
  assert.match(files.get("xl/workbook.xml")!, /fullCalcOnLoad="1"/);
});

test("formato condicional, filas alternadas y solo enlaces https", () => {
  const files = unzip(buildXlsx(BOOK));
  const sheet = files.get("xl/worksheets/sheet2.xml")!;
  assert.match(sheet, /<conditionalFormatting sqref="C2:C3"><cfRule type="cellIs" dxfId="\d+" priority="1" operator="lessThanOrEqual"><formula>0<\/formula>/);
  assert.match(sheet, /<cfRule type="expression" dxfId="\d+" priority="\d+"><formula>MOD\(ROW\(\),2\)=1<\/formula>/);
  const rels = files.get("xl/worksheets/_rels/sheet2.xml.rels")!;
  assert.match(rels, /Target="https:\/\/remhub.co\/x\/producto\/1" TargetMode="External"/);
  assert.doesNotMatch(rels, /javascript/);
  assert.equal(safeLink("javascript:alert(1)"), null);
  assert.equal(safeLink("http://inseguro.com"), null);
});

test("hoja Resumen con datos del informe, indicadores con fórmula e índice de hojas", () => {
  const files = unzip(buildXlsx(BOOK));
  const wb = files.get("xl/workbook.xml")!;
  assert.match(wb, /<sheet name="Resumen" sheetId="1"[^>]*\/><sheet name="Productos" sheetId="2"/);
  const sum = files.get("xl/worksheets/sheet1.xml")!;
  assert.match(sum, /Inventario valorizado/);
  assert.match(sum, /TIENDA DE PRUEBA/);
  assert.match(sum, /<f>SUBTOTAL\(109,T1_productos\[Unidades\]\)<\/f><v>15<\/v>/);
  assert.match(sum, /location="&#39;Productos&#39;!A1"|location="'Productos'!A1"/);
  // Imprimir: el encabezado de la tabla se repite en cada página.
  assert.match(wb, /_xlnm.Print_Titles" localSheetId="1">'Productos'!\$1:\$1/);
});

test("hojas de datos sin título dejan el encabezado en la fila 1 (se pueden volver a importar)", () => {
  const files = unzip(buildXlsx([{ name: "Terceros", head: ["Documento", "Nombre"], rows: [["0123", "ANA"]] }]));
  assert.ok(!files.has("xl/worksheets/sheet2.xml"), "sin resumen si no se pide");
  assert.match(files.get("xl/worksheets/sheet1.xml")!, /<row r="1"[^>]*><c r="A1"[^>]*><is><t xml:space="preserve">Documento/);
});

test("encabezados repetidos: no hay tabla (Excel no la acepta) pero sí filtros", () => {
  const files = unzip(buildXlsx([{ name: "X", head: ["A", "A"], rows: [[1, 2]] }]));
  assert.ok(![...files.keys()].some((k) => k.startsWith("xl/tables/")));
  assert.match(files.get("xl/worksheets/sheet1.xml")!, /<autoFilter ref="A1:B2"\/>/);
});

test("gráfico nativo e imagen dentro de la celda", () => {
  const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const files = unzip(buildXlsx([{
    name: "Ventas", head: ["Producto", "Foto", "Vendido"],
    rows: [["A", { image: png, ext: "png", w: 200, h: 100 }, 10], ["B", null, 20]],
    charts: [{ kind: "column", title: "Lo más vendido", catCol: 0, valCols: [2] }],
  }]));
  assert.ok(files.has("xl/media/image1.png"));
  assert.match(files.get("xl/charts/chart1.xml")!, /<c:f>'Ventas'!\$C\$2:\$C\$3<\/c:f>/);
  assert.match(files.get("xl/drawings/drawing1.xml")!, /<xdr:oneCellAnchor>/);
  assert.match(files.get("[Content_Types].xml")!, /Extension="png"/);
});

test("deflate: el archivo comprimido trae lo mismo y pesa menos", async () => {
  const rows = Array.from({ length: 300 }, (_, i) => [`REF-${i}`, `PRODUCTO DE PRUEBA NÚMERO ${i}`, i, i * 1000]);
  const book: XBook = { sheets: [{ name: "Grande", head: ["Referencia", "Nombre", "Unidades", "Costo"], rows }] };
  const plain = buildXlsx(book);
  const zipped = await buildXlsxAsync(book);
  assert.ok(zipped.length < plain.length / 3, `${zipped.length} vs ${plain.length}`);
  assert.equal(unzip(zipped).get("xl/worksheets/sheet1.xml"), unzip(plain).get("xl/worksheets/sheet1.xml"));
});

test("tipos inferidos por el encabezado", () => {
  assert.equal(inferType("Referencia", ["00123"]), "code");
  assert.equal(inferType("Código de barras", [7701234567890]), "int");
  assert.equal(inferType("Precio 3", [52000]), "money");
  assert.equal(inferType("Unidades (solo lectura)", [5]), "int");
  assert.equal(inferType("Vence", ["27/11/2026"]), "date");
  assert.equal(inferType("Creado", ["27/11/2026 10:00"]), "datetime");
  assert.equal(inferType("Nombre", ["OLLA"]), "text");
  assert.equal(tableName("Existencias por punto", 2), "T3_existencias_por_punto");
  assert.equal(tableCol("T1", "Precio [P3]"), "T1[Precio '[P3']]");
});

test("lo exportado se vuelve a leer con el mismo lector de los importadores (con portada, comprimido)", async () => {
  const { default: readXlsxFile } = await import("read-excel-file/node");
  const { pickSheet } = await import("../../src/lib/data/read-table");
  const bytes = await buildXlsxAsync({
    meta: { company: "PRUEBA", title: "Productos" },
    sheets: [{ name: "Productos", head: ["Referencia", "Nombre", "Precio 3", "Creado"], rows: [["00001234", "=SUMA(1)", 52000, "27/11/2026"], ["MV-759", "OLLA", 99000.5, ""]] }],
  });
  const sheets = (await readXlsxFile(Buffer.from(bytes))) as Array<{ sheet: string; data: unknown[][] }>;
  assert.deepEqual(sheets.map((s) => s.sheet), ["Resumen", "Productos"]);
  const idx = pickSheet(sheets.map((s) => ({ name: s.sheet, rows: s.data })), { name: "Productos" });
  const data = sheets[idx].data;
  assert.deepEqual(data[0], ["Referencia", "Nombre", "Precio 3", "Creado"]);
  assert.equal(data[1][0], "00001234");
  assert.equal(data[1][1], "=SUMA(1)");
  assert.equal(data[1][2], 52000);
  assert.ok(data[1][3] instanceof Date, `fecha: ${String(data[1][3])}`);
  assert.equal(data[2][2], 99000.5);
});
