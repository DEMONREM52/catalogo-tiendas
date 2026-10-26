/**
 * ESC/POS: el «idioma» de las impresoras térmicas (Epson y compatibles: Xprinter, 3nStar, Digital POS, Bixolon…).
 * Arma los bytes de un tiquete: texto con tildes y eñes (página de códigos), negrilla, tamaño, corte, QR y cajón.
 */
export type CodePage = "cp850" | "wpc1252" | "ascii";

const ESC = 0x1b;
const GS = 0x1d;

/** Número de la página de códigos para «ESC t n» (tabla Epson; la siguen casi todas las compatibles). */
const CODEPAGE_N: Record<Exclude<CodePage, "ascii">, number> = { cp850: 2, wpc1252: 16 };

// PC850 (multilingüe latino 1): las letras del español y lo que más sale en un tiquete.
const CP850: Record<string, number> = {
  Ç: 0x80, ü: 0x81, é: 0x82, â: 0x83, ä: 0x84, à: 0x85, ç: 0x87, ê: 0x88, ë: 0x89, è: 0x8a, ï: 0x8b, î: 0x8c, ì: 0x8d, Ä: 0x8e,
  É: 0x90, ô: 0x93, ö: 0x94, ò: 0x95, û: 0x96, ù: 0x97, Ö: 0x99, Ü: 0x9a, "£": 0x9c, "×": 0x9e,
  á: 0xa0, í: 0xa1, ó: 0xa2, ú: 0xa3, ñ: 0xa4, Ñ: 0xa5, ª: 0xa6, º: 0xa7, "¿": 0xa8, "®": 0xa9, "½": 0xab, "¼": 0xac, "¡": 0xad, "«": 0xae, "»": 0xaf,
  Á: 0xb5, Â: 0xb6, À: 0xb7, "©": 0xb8, "¢": 0xbd, ã: 0xc6, Ã: 0xc7, Ê: 0xd2, Ë: 0xd3, È: 0xd4, Í: 0xd6, Î: 0xd7, Ï: 0xd8, Ì: 0xde,
  Ó: 0xe0, ß: 0xe1, Ô: 0xe2, Ò: 0xe3, õ: 0xe4, Õ: 0xe5, Ú: 0xe9, Û: 0xea, Ù: 0xeb, "±": 0xf1, "§": 0xf5, "÷": 0xf6, "°": 0xf8, "·": 0xfa,
};

// Signos que no traen las impresoras (o no hacen falta): se cambian por su equivalente simple.
const SIMPLE: Record<string, string> = {
  "•": "-", "–": "-", "—": "-", "…": "...", "→": "->", "←": "<-", "“": '"', "”": '"', "‘": "'", "’": "'", "✓": "OK", "✔": "OK",
  "€": "EUR", " ": " ", " ": " ", " ": " ",
};

/** Texto → bytes en la página de códigos elegida. Los emojis se quitan; lo desconocido queda sin tilde o como «?». */
export function encodeText(text: string, cp: CodePage): number[] {
  const out: number[] = [];
  for (const ch of text.replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, "")) {
    const code = ch.codePointAt(0) ?? 63;
    if (code === 10 || (code >= 32 && code < 127)) {
      out.push(code);
      continue;
    }
    const simple = SIMPLE[ch];
    if (simple !== undefined) {
      for (const c of simple) out.push(c.charCodeAt(0));
      continue;
    }
    if (cp === "cp850" && CP850[ch] !== undefined) {
      out.push(CP850[ch]);
      continue;
    }
    // Windows-1252: de U+00A0 a U+00FF el byte es el mismo número.
    if (cp === "wpc1252" && code >= 0xa0 && code <= 0xff) {
      out.push(code);
      continue;
    }
    // Sin tildes (o letra que la página no tiene): á→a, ñ→n, ¿/¡ se quitan.
    const plain = ch.normalize("NFD").replace(/[̀-ͯ]/g, "");
    if (plain && plain !== ch && /^[\x20-\x7e]+$/.test(plain)) {
      for (const c of plain) out.push(c.charCodeAt(0));
    } else if (!/[¿¡]/.test(ch)) {
      out.push(cp === "ascii" && ch === "º" ? 111 : 63);
    }
  }
  return out;
}

/** Corta un texto en renglones del ancho del papel, sin partir palabras si se puede. */
export function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      if (!line) line = word;
      else if (line.length + 1 + word.length <= width) line += ` ${word}`;
      else {
        lines.push(line);
        line = word;
      }
      while (line.length > width) {
        lines.push(line.slice(0, width));
        line = line.slice(width);
      }
    }
    lines.push(line);
  }
  return lines;
}

/** «Texto ........ valor» en un renglón (si no cabe, el texto va arriba y el valor a la derecha abajo). */
export function leftRight(left: string, right: string, width: number): string[] {
  if (left.length + right.length + 1 <= width) return [left + " ".repeat(width - left.length - right.length) + right];
  const rows = wrap(left, width);
  const last = rows[rows.length - 1];
  if (last.length + right.length + 1 <= width) rows[rows.length - 1] = last + " ".repeat(width - last.length - right.length) + right;
  else rows.push(" ".repeat(Math.max(0, width - right.length)) + right);
  return rows;
}

/** Constructor de tiquetes ESC/POS. */
export class EscPos {
  private bytes: number[] = [];
  private cp: CodePage;
  readonly width: number;
  constructor(cp: CodePage, width: number) {
    this.cp = cp;
    this.width = width;
    this.raw([ESC, 0x40]); // reinicia la impresora
    if (cp !== "ascii") this.raw([ESC, 0x74, CODEPAGE_N[cp]]);
  }
  raw(b: number[]) {
    this.bytes.push(...b);
    return this;
  }
  align(a: "left" | "center" | "right") {
    return this.raw([ESC, 0x61, a === "left" ? 0 : a === "center" ? 1 : 2]);
  }
  bold(on: boolean) {
    return this.raw([ESC, 0x45, on ? 1 : 0]);
  }
  /** Tamaño: 1 = normal, 2 = doble alto, 3 = doble alto y ancho. */
  size(s: 1 | 2 | 3) {
    return this.raw([GS, 0x21, s === 1 ? 0x00 : s === 2 ? 0x01 : 0x11]);
  }
  text(t: string) {
    return this.raw(encodeText(t, this.cp));
  }
  line(t = "") {
    return this.text(t).raw([0x0a]);
  }
  /** Párrafo cortado al ancho (con el ancho real si el texto va en doble ancho). */
  para(t: string, width = this.width) {
    for (const row of wrap(t, width)) this.line(row);
    return this;
  }
  lr(left: string, right: string) {
    for (const row of leftRight(left, right, this.width)) this.line(row);
    return this;
  }
  rule(ch = "-") {
    return this.line(ch.repeat(this.width));
  }
  feed(n = 1) {
    return this.raw([ESC, 0x64, Math.max(0, Math.min(10, n))]);
  }
  /** Código QR (modelo 2). Las impresoras que no lo soportan simplemente no lo imprimen. */
  qr(data: string, module = 6) {
    const payload = encodeText(data, "ascii");
    const len = payload.length + 3;
    return this.raw([GS, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00]) // modelo 2
      .raw([GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, Math.max(1, Math.min(16, module))]) // tamaño del módulo
      .raw([GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 0x31]) // corrección de errores M
      .raw([GS, 0x28, 0x6b, len & 0xff, (len >> 8) & 0xff, 0x31, 0x50, 0x30, ...payload]) // guarda los datos
      .raw([GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30]); // imprime
  }
  /** Código de barras CODE128 con el texto debajo (alto en puntos; 1 mm ≈ 8 puntos). */
  barcode(data: string, height = 60) {
    const payload = [0x7b, 0x42, ...encodeText(data, "ascii").slice(0, 60)]; // {B = juego B (letras y números)
    return this.raw([GS, 0x68, Math.max(16, Math.min(255, height))]) // alto
      .raw([GS, 0x77, 2]) // ancho del módulo
      .raw([GS, 0x48, 2]) // texto debajo
      .raw([GS, 0x6b, 73, payload.length, ...payload])
      .raw([0x0a]);
  }
  /** Corte parcial con avance (las que no tienen cortador lo ignoran). */
  cut() {
    return this.raw([GS, 0x56, 0x42, 0x03]);
  }
  /** Pulso al cajón monedero (pin 2). */
  drawer() {
    return this.raw([ESC, 0x70, 0x00, 0x19, 0xfa]);
  }
  build(): Uint8Array {
    return Uint8Array.from(this.bytes);
  }
}
