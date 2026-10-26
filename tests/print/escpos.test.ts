import { test } from "node:test";
import assert from "node:assert/strict";
import { EscPos, encodeText, leftRight, wrap } from "../../src/lib/print/escpos";
import { ticketEscpos, ticketHtml, testTicket, type TicketData } from "../../src/lib/print/ticket";
import { DEFAULT_PRINTER, type PrinterSettings } from "../../src/lib/print/settings";

const has = (bytes: Uint8Array, seq: number[]) => {
  outer: for (let i = 0; i + seq.length <= bytes.length; i++) {
    for (let j = 0; j < seq.length; j++) if (bytes[i + j] !== seq[j]) continue outer;
    return true;
  }
  return false;
};
const count = (bytes: Uint8Array, seq: number[]) => {
  let n = 0;
  for (let i = 0; i + seq.length <= bytes.length; i++) if (seq.every((b, j) => bytes[i + j] === b)) n++;
  return n;
};

test("tildes y eñes en PC850, Windows-1252 y sin tildes", () => {
  assert.deepEqual(encodeText("ñÑáéíóú¿¡º", "cp850"), [0xa4, 0xa5, 0xa0, 0x82, 0xa1, 0xa2, 0xa3, 0xa8, 0xad, 0xa7]);
  assert.deepEqual(encodeText("ñÑá", "wpc1252"), [0xf1, 0xd1, 0xe1]);
  assert.equal(String.fromCharCode(...encodeText("Ñandú ¿listo? ¡sí! N.º", "ascii")), "Nandu listo? si! N.o");
  assert.equal(String.fromCharCode(...encodeText("Hola 🎉 • total → $1", "cp850")), "Hola  - total -> $1", "emojis fuera; viñetas y flechas simples");
});

test("renglones del ancho del papel (58 mm = 32 letras)", () => {
  const rows = wrap("Licuadora de vaso de vidrio con siete velocidades y función de picar hielo", 32);
  assert.ok(rows.every((r) => r.length <= 32));
  assert.equal(rows.join(" "), "Licuadora de vaso de vidrio con siete velocidades y función de picar hielo");
  assert.deepEqual(leftRight("TOTAL", "$238.000", 32), ["TOTAL" + " ".repeat(32 - 5 - 8) + "$238.000"]);
  const long = leftRight("Un nombre de producto demasiado largo para un renglón", "$1.000", 32);
  assert.ok(long.length >= 2 && long.every((r) => r.length <= 32) && long[long.length - 1].endsWith("$1.000"));
});

test("tiquete ESC/POS: reinicio, página de códigos, corte, cajón y copias", () => {
  const t: TicketData = { ...testTicket(), cash: true };
  const s: PrinterSettings = { ...DEFAULT_PRINTER, mode: "usb", width: 32, drawer: true, copies: 2, cut: true, qr: true };
  const b = ticketEscpos(t, s);
  assert.deepEqual([...b.slice(0, 5)], [0x1b, 0x40, 0x1b, 0x74, 2], "reinicia y elige PC850");
  assert.ok(has(b, [0x1b, 0x70, 0x00, 0x19, 0xfa]), "abre el cajón (venta con efectivo)");
  assert.equal(count(b, [0x1d, 0x56, 0x42, 0x03]), 2, "un corte por copia");
  assert.ok(has(b, encodeText("(COPIA)", "cp850")), "la segunda dice (COPIA)");
  assert.ok(has(b, [0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30]), "imprime el QR");
  const noDrawer = ticketEscpos({ ...t, cash: false }, s);
  assert.ok(!has(noDrawer, [0x1b, 0x70, 0x00]), "sin efectivo no abre el cajón");
  const plain = ticketEscpos(t, { ...s, cut: false, qr: false, copies: 1 });
  assert.ok(!has(plain, [0x1d, 0x56]) && !has(plain, [0x1d, 0x28, 0x6b]), "sin cortador ni QR si se apagan");
});

test("constructor: negrilla, centrado y tamaño", () => {
  const b = new EscPos("ascii", 48).align("center").bold(true).size(3).line("HOLA").build();
  assert.deepEqual([...b], [0x1b, 0x40, 0x1b, 0x61, 1, 0x1b, 0x45, 1, 0x1d, 0x21, 0x11, 72, 79, 76, 65, 10]);
});

test("la misma información sale como página (ventana del navegador o Chrome directo)", () => {
  const html = ticketHtml(testTicket(), "tirilla", "data:image/png;base64,AAA");
  assert.match(html, /PRUEBA DE IMPRESIÓN/);
  assert.match(html, /<img class="qr" src="data:image\/png;base64,AAA"/);
  assert.match(html, /window\.print\(\)/);
  assert.doesNotMatch(ticketHtml(testTicket(), "carta", null, false), /window\.print/);
});
