// RemHub Label Studio: motor de etiquetas (variables, texto, QR, código de barras, papel e impresión).
// Los QR y CODE128 se LEEN de vuelta desde el SVG que se imprime y deben dar exactamente el contenido original.
import test from "node:test";
import assert from "node:assert/strict";
import jsQR from "jsqr";
import { resolveTokens, productLabelData, fmtLabelMoney, whatsappUrl, SAMPLE_DATA } from "../../src/lib/labels/data";
import { approxMeasure, fitText } from "../../src/lib/labels/text-fit";
import { encodeBarcode, layoutBarcode, layoutQr, qrMatrix } from "../../src/lib/labels/codes";
import { labelSvg, renderLabel, safeImageUrl } from "../../src/lib/labels/render";
import { STARPOS_IF4, cellOrigins, paginate, printDocument, validateProfile, normalizeProfile, PROFILE_PRESETS } from "../../src/lib/labels/layout";
import { builtinTemplates, newBarcode, newQr, newText, normalizeDesign, resizeDesign } from "../../src/lib/labels/templates";
import { mmToDots, type LabelDesign } from "../../src/lib/labels/types";

const REFS = ["12345678910", "SC11 W F", "W 0806 RYL018", "MALUMETA DE 6.5 PULGADAS RYL002", "0000123456", "REF-ABC 123 XYZ 7890 LARGA CON ESPACIOS"];
const DPI = 203;

// ---------------------------------------------------------------- lectores (para comprobar, no para la app)
/** Lee un QR a partir de su matriz de módulos (con margen y escala), como lo haría una cámara. */
function readQrModules(size: number, dark: (x: number, y: number) => boolean) {
  const scale = 4, quiet = 4, px = (size + quiet * 2) * scale;
  const img = new Uint8ClampedArray(px * px * 4).fill(255);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    if (!dark(x, y)) continue;
    for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
      const i = (((y + quiet) * scale + dy) * px + (x + quiet) * scale + dx) * 4;
      img[i] = img[i + 1] = img[i + 2] = 0;
    }
  }
  return jsQR(img, px, px)?.data ?? null;
}

/** Saca del SVG impreso el trazo del QR y lo lee. */
function readQrFromSvg(svg: string) {
  const m = /<path d="([^"]+)" transform="translate\(([\d.]+) ([\d.]+)\) scale\(([\d.]+)\)"/.exec(svg);
  assert.ok(m, "hay un QR en el SVG");
  const cells = new Set<string>();
  let max = 0;
  for (const run of m[1].matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) {
    const x0 = Number(run[1]), y = Number(run[2]), len = Number(run[3]);
    for (let x = x0; x < x0 + len; x++) { cells.add(`${x},${y}`); max = Math.max(max, x, y); }
  }
  const moduleMm = Number(m[4]);
  return { text: readQrModules(max + 2, (x, y) => cells.has(`${x},${y}`)), moduleMm, ox: Number(m[2]), oy: Number(m[3]) };
}

// Tabla estándar de CODE128 (valores 0–106; el 106 es la parada de 13 módulos).
const BARS = [11011001100, 11001101100, 11001100110, 10010011000, 10010001100, 10001001100, 10011001000, 10011000100, 10001100100, 11001001000, 11001000100, 11000100100, 10110011100, 10011011100, 10011001110, 10111001100, 10011101100, 10011100110, 11001110010, 11001011100, 11001001110, 11011100100, 11001110100, 11101101110, 11101001100, 11100101100, 11100100110, 11101100100, 11100110100, 11100110010, 11011011000, 11011000110, 11000110110, 10100011000, 10001011000, 10001000110, 10110001000, 10001101000, 10001100010, 11010001000, 11000101000, 11000100010, 10110111000, 10110001110, 10001101110, 10111011000, 10111000110, 10001110110, 11101110110, 11010001110, 11000101110, 11011101000, 11011100010, 11011101110, 11101011000, 11101000110, 11100010110, 11101101000, 11101100010, 11100011010, 11101111010, 11001000010, 11110001010, 10100110000, 10100001100, 10010110000, 10010000110, 10000101100, 10000100110, 10110010000, 10110000100, 10011010000, 10011000010, 10000110100, 10000110010, 11000010010, 11001010000, 11110111010, 11000010100, 10001111010, 10100111100, 10010111100, 10010011110, 10111100100, 10011110100, 10011110010, 11110100100, 11110010100, 11110010010, 11011011110, 11011110110, 11110110110, 10101111000, 10100011110, 10001011110, 10111101000, 10111100010, 11110101000, 11110100010, 10111011110, 10111101110, 11101011110, 11110101110, 11010000100, 11010010000, 11010011100, 1100011101011].map(String);

/** Lector CODE128 independiente: inicio, juegos A/B/C, cambios y dígito de control. */
function decodeCode128(bits: string): string {
  const vals: number[] = [];
  let i = 0;
  while (i < bits.length) {
    if (bits.slice(i, i + 13) === BARS[106]) { i += 13; break; }
    const v = BARS.indexOf(bits.slice(i, i + 11));
    if (v < 0) throw new Error(`patrón desconocido en ${i}`);
    vals.push(v);
    i += 11;
  }
  if (i !== bits.length) throw new Error("sobran barras después de la parada");
  const check = vals.pop()!;
  const sum = vals.reduce((s, v, k) => s + v * (k === 0 ? 1 : k), 0) % 103;
  if (sum !== check) throw new Error("dígito de control incorrecto");
  let set = vals[0] === 103 ? "A" : vals[0] === 104 ? "B" : vals[0] === 105 ? "C" : "?";
  if (set === "?") throw new Error("no empieza con START");
  let out = "";
  for (const v of vals.slice(1)) {
    if (set === "C") {
      if (v < 100) out += String(v).padStart(2, "0");
      else if (v === 100) set = "B";
      else if (v === 101) set = "A";
      continue;
    }
    if (v === 99) { set = "C"; continue; }
    if (v === 100 && set === "A") { set = "B"; continue; }
    if (v === 101 && set === "B") { set = "A"; continue; }
    if (v >= 96) continue; // FNC
    out += set === "A" ? String.fromCharCode(v < 64 ? v + 32 : v - 64) : String.fromCharCode(v + 32);
  }
  return out;
}

/** Saca las barras del SVG impreso (con el margen blanco) y las vuelve 0/1. */
function barsFromSvg(svg: string) {
  const m = /<path d="([^"]+)" transform="translate\(([\d.]+) ([\d.]+)\) scale\(([\d.]+) [\d.]+\)"/.exec(svg);
  assert.ok(m, "hay barras en el SVG");
  const runs = [...m[1].matchAll(/M(\d+) 0h(\d+)v1h-\d+z/g)].map((r) => [Number(r[1]), Number(r[2])]);
  const end = Math.max(...runs.map(([s, l]) => s + l));
  const start = Math.min(...runs.map(([s]) => s));
  const arr = Array.from({ length: end }, () => "0");
  for (const [s, l] of runs) for (let k = s; k < s + l; k++) arr[k] = "1";
  return { bits: arr.slice(start).join(""), quiet: start, moduleMm: Number(m[4]) };
}

// Con 4 decimales en mm el error es menor a 0,01 punto de la impresora.
const isWholeDots = (mm: number) => Math.abs(mmToDots(mm, DPI) - Math.round(mmToDots(mm, DPI))) < 0.01;
const render = (design: LabelDesign, data = SAMPLE_DATA) => labelSvg({ design, data, dpi: DPI, measure: approxMeasure });

// ---------------------------------------------------------------- variables
test("variables: valores, alternativos, texto fijo y nunca «undefined»", () => {
  const d = { nombre: "MALUMETA", referencia: "", codigo: "RYL002", precio: "$330.000" };
  assert.equal(resolveTokens("REF. {referencia|codigo}", d), "REF. RYL002");
  assert.equal(resolveTokens("{precio} · {color|\"sin color\"}", d), "$330.000 · sin color");
  assert.equal(resolveTokens("{noexiste}{constructor}{__proto__}", d), "");
  assert.equal(resolveTokens("{{llaves}} {nombre", d), "{llaves} {nombre");
  assert.ok(!/undefined|null|NaN/.test(resolveTokens("{nombre} {referencia} {x} {precio9}", d)));
  assert.equal(fmtLabelMoney(330000), "$330.000");
  assert.equal(whatsappUrl("300 123 4567", "Hola"), "https://wa.me/573001234567?text=Hola");
  const data = productLabelData({ id: "p", name: "W 0806 RYL018", sku: "RYL018", barcode: null, prices: [1, 2, 330000, 4, 5] }, { store: "LA VITRINA", level: 3, today: new Date(2026, 10, 27) });
  assert.equal(data.codigo, "RYL018");
  assert.equal(data.precio, "$330.000");
  assert.equal(data.fecha, "27/11/2026");
});

// ---------------------------------------------------------------- texto
test("texto: «MALUMETA DE 6.5 / PULGADAS RYL002» en dos líneas parejas, sin cortar palabras", () => {
  const box = { ...newText(), w: 29.76, h: 9.5, size: 9, minSize: 4.5, maxLines: 3 };
  const fit = fitText("MALUMETA DE 6.5 PULGADAS RYL002", box, approxMeasure);
  assert.deepEqual(fit.lines, ["MALUMETA DE 6.5", "PULGADAS RYL002"]);
  assert.equal(fit.overflow, false);
});

test("texto: saltos manuales con Enter y referencia en una línea", () => {
  const fit = fitText("MALUMETA DE 6.5 PULGADAS\nREF. RYL002\n$330.000", { ...newText(), w: 29, h: 12, maxLines: 4 }, approxMeasure);
  assert.deepEqual(fit.lines, ["MALUMETA DE 6.5 PULGADAS", "REF. RYL002", "$330.000"]);
  const one = fitText("W 0806 RYL018", { ...newText(), w: 29.76, h: 6.75, size: 11, maxLines: 1 }, approxMeasure);
  assert.deepEqual(one.lines, ["W 0806 RYL018"]);
});

test("texto: una referencia larga nunca se corta; se achica y, si no cabe, se avisa", () => {
  const ref = "REFERENCIAMUYLARGASINESPACIOS1234567890";
  const fit = fitText(ref, { ...newText(), w: 20, h: 4, size: 9, minSize: 5, maxLines: 1 }, approxMeasure);
  assert.equal(fit.lines.join(""), ref);
  assert.equal(fit.overflow, true);
  const broken = fitText(ref, { ...newText(), w: 20, h: 12, size: 9, minSize: 5, maxLines: 4, breakWords: true }, approxMeasure);
  assert.equal(broken.lines.join(""), ref, "partida pero completa");
  assert.equal(broken.brokeWords, true);
});

// ---------------------------------------------------------------- QR
test("QR: cada referencia se lee idéntica (espacios y ceros iniciales incluidos)", () => {
  for (const ref of [...REFS, "https://remhub.co/lavitrina/producto/529", whatsappUrl("3001234567", "Hola, quiero este producto")]) {
    const m = qrMatrix(ref, "M");
    assert.equal(readQrModules(m.size, m.dark), ref);
  }
});

test("QR: módulos en puntos enteros a 203 dpi, cuadrado y con aviso si es muy denso", () => {
  const lay = layoutQr("W 0806 RYL018", "M", 1, 29.76, 16.5, DPI);
  assert.ok(lay.ok);
  if (lay.ok) {
    assert.ok(Number.isInteger(lay.moduleDots) && lay.moduleDots >= 2);
    assert.ok(lay.sideMm <= 16.5 + 1e-9);
  }
  const dense = layoutQr("x".repeat(300), "H", 1, 8, 8, DPI);
  assert.ok(!dense.ok || dense.issues.some((i) => /denso|no cabe/i.test(i.message)));
  assert.equal(layoutQr("", "M", 1, 10, 10, DPI).ok, false);
});

// ---------------------------------------------------------------- código de barras
test("CODE128: se lee idéntico; ceros iniciales, espacios y letras se conservan", () => {
  for (const ref of REFS.slice(0, 5)) {
    const enc = encodeBarcode(ref, "CODE128");
    assert.ok(enc.ok, ref);
    if (enc.ok) assert.equal(decodeCode128(enc.bits), ref);
  }
});

test("CODE128 que no cabe: no se corta ni se deforma; dice por qué y sugiere QR", () => {
  const lay = layoutBarcode("REF-ABC 123 XYZ 7890 LARGA CON ESPACIOS", "CODE128", 10, 29.76, DPI);
  assert.equal(lay.ok, false);
  assert.match(lay.issues[0].message, /no cabe[\s\S]*QR/);
  const ok = layoutBarcode("SC11 W F", "CODE128", 10, 29.76, DPI);
  assert.ok(ok.ok && Number.isInteger(ok.moduleDots));
});

test("EAN-13: calcula el dígito de control y rechaza uno equivocado; CODE39 rechaza minúsculas", () => {
  const ok = encodeBarcode("770123456789", "EAN13");
  assert.ok(ok.ok);
  if (ok.ok) assert.equal(ok.text, "7701234567897");
  assert.equal(encodeBarcode("7701234567890", "EAN13").ok, false);
  assert.equal(encodeBarcode("ABC", "EAN13").ok, false);
  assert.equal(encodeBarcode("abc", "CODE39").ok, false);
  assert.equal(encodeBarcode("ÑANDÚ", "CODE128").ok, false, "sin tildes: no se cambia el contenido a escondidas");
  assert.equal(encodeBarcode("É", "CODE128").ok, false, "la librería lo tomaría como un carácter de control");
});

// ---------------------------------------------------------------- etiquetas completas (los 3 diseños del modelo)
test("plantillas a 31×25: el QR impreso se lee y el texto queda como en el modelo", () => {
  const [qrRef, qrName, full] = builtinTemplates(31, 25);
  const data = { ...SAMPLE_DATA, nombre: "MALUMETA DE 6.5 PULGADAS RYL002", referencia: "RYL002", codigo: "RYL002", precio: "$330.000" };

  const a = render(qrRef.design, { ...data, nombre: "W 0806 RYL018", referencia: "W 0806 RYL018", codigo: "W 0806 RYL018" });
  assert.equal(readQrFromSvg(a.svg).text, "W 0806 RYL018");
  assert.match(a.svg, />W 0806 RYL018</);
  assert.equal(a.issues.filter((i) => i.level === "error").length, 0);

  const b = render(qrName.design, data);
  assert.match(b.svg, />MALUMETA DE 6\.5<\/tspan><tspan[^>]*>PULGADAS RYL002</);
  assert.equal(readQrFromSvg(b.svg).text, "RYL002");

  const c = render(full.design, { ...data, nombre: "MALUMETA" });
  for (const t of [">MALUMETA<", ">REF. RYL002<", ">\\$330\\.000<"]) assert.match(c.svg, new RegExp(t));
  const q = readQrFromSvg(c.svg);
  assert.equal(q.text, "RYL002");
  assert.ok(isWholeDots(q.moduleMm) && isWholeDots(q.ox) && isWholeDots(q.oy), "QR alineado a puntos enteros");
  assert.ok(!/undefined|null|NaN/.test(a.svg + b.svg + c.svg));
});

test("plantilla de barras: el CODE128 impreso se lee y queda alineado", () => {
  const bar = builtinTemplates(31, 25).find((t) => t.id === "builtin:barras-ref")!;
  const out = render(bar.design, { ...SAMPLE_DATA, codigo: "0000123456", referencia: "0000123456" });
  const b = barsFromSvg(out.svg);
  assert.equal(decodeCode128(b.bits.replace(/0+$/, "")), "0000123456");
  assert.ok(isWholeDots(b.moduleMm));
});

test("todas las plantillas de RemHub se dibujan sin errores con datos de ejemplo", () => {
  for (const [w, h] of [[31, 25], [50, 25], [50, 30], [66.7, 25.4]]) {
    for (const t of builtinTemplates(w, h)) {
      const r = renderLabel({ design: t.design, data: SAMPLE_DATA, dpi: DPI, measure: approxMeasure, images: { logo: "https://example.com/logo.png" } });
      assert.equal(r.issues.filter((i) => i.level === "error").length, 0, `${t.name} ${w}×${h}: ${JSON.stringify(r.issues)}`);
    }
  }
});

// ---------------------------------------------------------------- seguridad
test("seguridad: texto escapado, imágenes peligrosas rechazadas y diseños importados limpios", () => {
  const out = render({ v: 1, w: 31, h: 25, elements: [newText({ content: "<script>alert(1)</script>{nombre}" })] }, { nombre: "<img src=x onerror=alert(1)>" });
  assert.ok(!out.svg.includes("<script>") && !out.svg.includes("<img"));
  assert.equal(safeImageUrl("javascript:alert(1)"), null);
  assert.equal(safeImageUrl("data:image/svg+xml;base64,PHN2Zz4="), null);
  assert.equal(safeImageUrl("http://inseguro.com/a.png"), null);
  assert.equal(safeImageUrl("//otro.com/a.png"), null);
  assert.ok(safeImageUrl("https://xyz.supabase.co/storage/v1/object/public/a.png"));
  const d = normalizeDesign({ w: 9999, h: -3, elements: [{ type: "script", x: 1 }, { type: "text", id: "a", content: 5, size: "grande", color: "red;fill:url(javascript:1)" }, { type: "qr", id: "a" }, ...Array.from({ length: 400 }, () => ({ type: "rect" }))] });
  assert.equal(d.w, 500);
  assert.equal(d.h, 5);
  assert.ok(d.elements.length <= 300, "máximo 300 elementos");
  assert.equal(d.elements[0].type, "text");
  assert.notEqual(d.elements[0].id, d.elements[1].id, "ids únicos");
  assert.equal((d.elements[0] as { color: string }).color, "#000000");
});

// ---------------------------------------------------------------- papel e impresión
test("STARPOS iF4: 2,5 + 3 × 31 + 2 × 2 + 2,5 = 102 mm, sin errores; un error si no cabe", () => {
  assert.deepEqual(validateProfile(STARPOS_IF4).filter((i) => i.level === "error"), []);
  assert.deepEqual(cellOrigins(STARPOS_IF4).map((o) => o.x), [2.5, 35.5, 68.5]);
  const bad = validateProfile({ ...STARPOS_IF4, labelW: 34 });
  assert.match(bad[0].message, /No cabe a lo ancho/);
  for (const p of PROFILE_PRESETS) assert.deepEqual(validateProfile(p.profile).filter((i) => i.level === "error"), [], p.label);
  const n = normalizeProfile({ cols: 999, dpi: "x", name: "<b>" });
  assert.equal(n.cols, 20);
  assert.equal(n.dpi, 203);
});

test("10 etiquetas en 3 columnas: 3 + 3 + 3 + 1; posición inicial y productos combinados en una fila", () => {
  const pages = paginate(Array.from({ length: 10 }, (_, i) => i), STARPOS_IF4);
  assert.deepEqual(pages.map((p) => p.filter((x) => x !== null).length), [3, 3, 3, 1]);
  const started = paginate(["A", "A", "B"], STARPOS_IF4, 2);
  assert.deepEqual(started, [[null, null, "A"], ["A", "B", null]]);
  const sheet = PROFILE_PRESETS.find((p) => p.key === "carta")!.profile;
  assert.equal(paginate(Array.from({ length: 31 }, () => 1), sheet).length, 2, "30 por hoja carta");
});

test("documento de impresión: página exacta de 102 × 25 mm, 3 etiquetas por fila y la misma etiqueta que la vista previa", () => {
  const t = builtinTemplates(31, 25)[0];
  const lbl = (ref: string) => ({ key: ref, input: { design: t.design, data: { ...SAMPLE_DATA, codigo: ref, referencia: ref }, dpi: DPI, measure: approxMeasure } });
  const pages = paginate([lbl("A1"), lbl("B2"), lbl("C3"), lbl("D4")], STARPOS_IF4);
  const doc = printDocument(pages, STARPOS_IF4);
  assert.match(doc.html, /@page\{size:102mm 25mm;margin:0\}/);
  assert.equal((doc.html.match(/class="p"/g) ?? []).length, 2);
  assert.equal((doc.html.match(/class="c"/g) ?? []).length, 4);
  const preview = renderLabel(lbl("A1").input).body;
  assert.ok(doc.html.includes(preview), "la impresión usa exactamente el mismo dibujo que la vista previa");
});

test("cambiar el tamaño de un diseño escala todo y los códigos siguen leyéndose", () => {
  const t = builtinTemplates(31, 25)[2];
  const big = resizeDesign(t.design, 50, 40);
  const out = render(big, { ...SAMPLE_DATA, codigo: "SC11 W F" });
  assert.equal(readQrFromSvg(out.svg).text, "SC11 W F");
  const qr = big.elements.find((e) => e.type === "qr")!;
  assert.ok(qr.w > 40);
  // Un QR y un código en la misma etiqueta, con contenidos distintos al texto visible.
  const mixed = render({ v: 1, w: 50, h: 30, elements: [newQr({ x: 1, y: 1, w: 14, h: 14, content: "https://remhub.co/x" }), newBarcode({ x: 16, y: 1, w: 33, h: 10, content: "12345678910" }), newText({ x: 16, y: 12, w: 33, h: 5, content: "{nombre}" })] });
  assert.equal(readQrFromSvg(mixed.svg).text, "https://remhub.co/x");
  assert.equal(decodeCode128(barsFromSvg(mixed.svg).bits.replace(/0+$/, "")), "12345678910");
});

test("separador entre productos: etiqueta en blanco con franja negra gruesa, en su propia posición", async () => {
  const { separatorDesign } = await import("../../src/lib/labels/templates");
  const d = separatorDesign(31, 25);
  const out = render(d, {});
  assert.match(out.svg, /<rect x="0" y="[\d.]+" width="31" height="3\.5" rx="0" fill="#000000" stroke="none"/);
  assert.equal(out.issues.length, 0);
  // 2 del producto A, separador, 2 del producto B → fila 1: A A ▬ · fila 2: B B (vacío).
  assert.deepEqual(paginate(["A", "A", "sep", "B", "B"], STARPOS_IF4), [["A", "A", "sep"], ["B", "B", null]]);
});
