/**
 * RemHub Label Studio: formato de las etiquetas.
 *
 * Todo se mide en milímetros (la unidad física); el zoom del editor y la pantalla no cambian nada de esto.
 * Un diseño es una lista de elementos con posición y tamaño en mm dentro de una etiqueta de w × h mm.
 * Los textos y contenidos llevan variables entre llaves ({nombre}, {referencia}…): ver data.ts.
 * El formato está versionado (`v`) para poder migrarlo sin perder plantillas guardadas.
 */

export const LABEL_FORMAT_VERSION = 1;

export type Align = "left" | "center" | "right";
export type VAlign = "top" | "middle" | "bottom";
export type Rotation = 0 | 90 | 180 | 270;
export type FontKey = "sans" | "condensed" | "serif" | "mono";
export type Ecc = "L" | "M" | "Q" | "H";

export type BarcodeFormat =
  | "CODE128" | "CODE128A" | "CODE128B" | "CODE128C"
  | "CODE39" | "EAN13" | "EAN8" | "UPC" | "UPCE" | "ITF" | "ITF14" | "codabar" | "MSI" | "pharmacode";

type Base = {
  /** Identificador estable del elemento dentro del diseño. */
  id: string;
  /** Nombre en la lista de capas (opcional). */
  name?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation?: Rotation;
  hidden?: boolean;
  locked?: boolean;
};

export type TextElement = Base & {
  type: "text";
  /** Texto con variables y saltos de línea («\n»). */
  content: string;
  font: FontKey;
  /** Tamaño en puntos (1 pt = 0,3528 mm). Con autoFit es el máximo. */
  size: number;
  /** Tamaño mínimo al ajustar solo. */
  minSize: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  align: Align;
  valign: VAlign;
  /** Máximo de líneas (1 a 20). */
  maxLines: number;
  /** Alto de línea relativo al tamaño (1 = compacto). */
  lineHeight: number;
  /** Espacio extra entre letras, en mm. */
  letterSpacing: number;
  /** Achicar la letra hasta que quepa. */
  autoFit: boolean;
  /** Partir palabras largas que no caben (si no, se achica la letra y nunca se corta una referencia). */
  breakWords: boolean;
  /** Repartir las líneas parejas («MALUMETA DE 6.5 / PULGADAS RYL002»). */
  balance: boolean;
  transform: "none" | "upper" | "lower";
  color: string;
  background: string | null;
  /** Margen interno, en mm. */
  padding: number;
};

export type QrElement = Base & {
  type: "qr";
  /** Lo que lleva el QR (puede ser distinto del texto visible). */
  content: string;
  ecc: Ecc;
  /** Margen blanco alrededor, en módulos (el estándar pide 4; en etiquetas basta 1 si hay blanco alrededor). */
  quiet: number;
  color: string;
  /** Dónde va el cuadrado dentro de su caja (el QR siempre es cuadrado, nunca se deforma). */
  align: Align;
  valign: VAlign;
};

export type BarcodeElement = Base & {
  type: "barcode";
  content: string;
  format: BarcodeFormat;
  /** Números o texto debajo de las barras. */
  showText: boolean;
  textSize: number;
  /** Margen blanco a cada lado, en módulos (el estándar pide 10). */
  quiet: number;
  color: string;
  align: Align;
};

export type RectElement = Base & { type: "rect"; stroke: number; strokeColor: string; fill: string | null; radius: number };
export type EllipseElement = Base & { type: "ellipse"; stroke: number; strokeColor: string; fill: string | null };
/** Línea de (x, y) a (x + w, y + h). */
export type LineElement = Base & { type: "line"; stroke: number; color: string };
export type ImageElement = Base & {
  type: "image";
  /** «{logo}», «{foto}», una dirección https o una imagen subida (data:image/png|jpeg|webp). */
  src: string;
  fit: "contain" | "cover";
  /** En blanco y negro (mejor para térmicas). */
  mono: boolean;
};

export type LabelElement = TextElement | QrElement | BarcodeElement | RectElement | EllipseElement | LineElement | ImageElement;
export type ElementType = LabelElement["type"];

export type LabelDesign = {
  v: number;
  /** Ancho y alto de UNA etiqueta, en mm. */
  w: number;
  h: number;
  elements: LabelElement[];
};

/** Plantilla guardada (en la base o de las que trae RemHub). */
export type LabelTemplate = {
  id: string;
  name: string;
  category: string | null;
  design: LabelDesign;
  builtin?: boolean;
  is_default?: boolean;
  favorite?: boolean;
  archived_at?: string | null;
  updated_at?: string | null;
  version?: number;
};

/** Papel e impresora: cómo van las etiquetas en el rollo o la hoja. */
export type PrinterProfile = {
  id?: string;
  name: string;
  brand: string;
  model: string;
  /** Puntos por pulgada de la impresora (203, 300, 600…). */
  dpi: number;
  /** Cómo se imprime hoy desde RemHub: con el controlador del sistema (ventana de impresión). */
  method: "driver";
  /** Lenguaje que dice la impresora (informativo hasta que exista impresión directa probada). */
  language: "zpl" | "tspl" | "epl" | "escpos" | "otro";
  connection: "usb" | "red" | "bluetooth" | "serial";
  media: "gap" | "continuous" | "blackmark" | "sheet";
  /** «roll»: cada fila de etiquetas es una página; «sheet»: hoja con filas y columnas. */
  mode: "roll" | "sheet";
  /** Ancho total del rollo o de la hoja, en mm. */
  pageW: number;
  /** Alto de la hoja (solo «sheet»), en mm. */
  pageH: number;
  labelW: number;
  labelH: number;
  cols: number;
  gapX: number;
  gapY: number;
  marginLeft: number;
  marginRight: number;
  marginTop: number;
  marginBottom: number;
  /** Corrección de la calibración (se suma a todo), en mm. */
  offsetX: number;
  offsetY: number;
  /** Datos del controlador (informativos: RemHub no los envía a la impresora). */
  speed: string;
  density: string;
  output: string;
  notes: string;
};

export const MM_PER_PT = 25.4 / 72;
export const mmToDots = (mm: number, dpi: number) => (mm * dpi) / 25.4;
export const dotsToMm = (dots: number, dpi: number) => (dots * 25.4) / dpi;
/** Redondea a un punto entero de la impresora (los códigos quedan nítidos). */
export const snapMm = (mm: number, dpi: number) => dotsToMm(Math.round(mmToDots(mm, dpi)), dpi);
export const round2 = (n: number) => Math.round(n * 100) / 100;
