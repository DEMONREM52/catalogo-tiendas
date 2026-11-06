/**
 * REMHUB AMETHYST GLASS — motor de temas.
 *
 * Un tema es una configuración ESTRUCTURADA (colores HEX y números con límites), nunca CSS escrito por la persona.
 * De esa configuración se calculan los tokens `--t-*` que ya usa todo el panel (fondo, tarjetas, texto, acentos,
 * vidrio, radios…). Así un tema nuevo pinta todo RemHub sin tocar cada pantalla.
 *
 * Los mismos límites se revisan en la base (erp__theme_config_valid, migración 20261284).
 */

/**
 * 2 = paleta «cristal neutro» (2026-11-06): superficies grafito/perla, violeta solo en acentos.
 * Los temas guardados con v1 se siguen pintando EXACTAMENTE como antes (sus fórmulas y niveles de vidrio se conservan).
 */
export const THEME_SCHEMA_VERSION = 2;
/** Tamaño máximo de una configuración (protección técnica; la cantidad de temas no tiene límite). */
export const MAX_CONFIG_BYTES = 6000;

export type BaseMode = "light" | "dark";
export type GlassLevel = "off" | "subtle" | "elegant" | "premium" | "custom";
export type BackgroundKind = "solid" | "gradient" | "glow";
export type Density = "compact" | "normal" | "comfortable";

export type ThemeConfig = {
  v: number;
  base: BaseMode;
  colors: {
    accent: string;   // principal (botones, seleccionado)
    accent2: string;  // secundario
    accent3: string;  // énfasis (magenta discreto)
    bg: string;       // fondo de la página
    surface: string;  // tarjetas
    menu: string;     // menú lateral y barra superior
    dialog: string;   // ventanas y menús desplegables
    input: string;    // campos de formulario
    text: string;     // texto principal
    muted: string;    // texto secundario
  };
  background: { kind: BackgroundKind; from: string; to: string; angle: number; intensity: number };
  glass: { level: GlassLevel; opacity: number; blur: number; saturation: number; border: number; shadow: number; sheen: number };
  layout: { radius: number; density: Density; fontScale: number; dividers: number };
  effects: { ambient: number; halo: boolean; hover: boolean };
};

export type ThemeMeta = { id: string; name: string; description?: string | null; official?: boolean };

const HEX = /^#[0-9a-f]{6}$/;

/* ------------------------------------------------------------------ temas oficiales (no se pueden borrar ni cambiar) */

export const OBSIDIAN: ThemeConfig = {
  v: 2,
  base: "dark",
  // Obsidian Aurora Glass: grafito ciruela, cristal ahumado con matices amatista (ni negro ni violeta saturado).
  colors: {
    accent: "#a98af0", accent2: "#8f6fe6", accent3: "#d16be8",
    bg: "#150c24", surface: "#26193a", menu: "#1f1431", dialog: "#34224f", input: "#1d1230",
    text: "#f8f5ff", muted: "#c9b8e6",
  },
  background: { kind: "glow", from: "#2c1d44", to: "#150c24", angle: 160, intensity: 50 },
  glass: { level: "elegant", opacity: 76, blur: 14, saturation: 125, border: 18, shadow: 60, sheen: 35 },
  layout: { radius: 16, density: "normal", fontScale: 100, dividers: 11 },
  effects: { ambient: 30, halo: true, hover: true },
};

export const PEARL: ThemeConfig = {
  v: 2,
  base: "light",
  colors: {
    accent: "#7545d6", accent2: "#8b5cf6", accent3: "#c026d3",
    bg: "#f8f9fd", surface: "#ffffff", menu: "#ffffff", dialog: "#ffffff", input: "#f7f7fb",
    text: "#20192e", muted: "#625b70",
  },
  background: { kind: "glow", from: "#efeaf8", to: "#f8f9fd", angle: 160, intensity: 25 },
  glass: { level: "elegant", opacity: 82, blur: 14, saturation: 120, border: 12, shadow: 25, sheen: 35 },
  layout: { radius: 16, density: "normal", fontScale: 100, dividers: 10 },
  effects: { ambient: 25, halo: true, hover: true },
};

export const OFFICIAL_THEMES: Array<ThemeMeta & { config: ThemeConfig; official: true }> = [
  { id: "official:pearl", name: "Pearl Amethyst", description: "Claro: blanco perla, lavanda suave y amatista.", official: true, config: PEARL },
  { id: "official:obsidian", name: "Obsidian Amethyst", description: "Oscuro: negro obsidiana, violeta profundo y cristal ahumado.", official: true, config: OBSIDIAN },
];
export const officialFor = (base: BaseMode) => (base === "dark" ? OBSIDIAN : PEARL);

/* ------------------------------------------------------------------ colores */

/** Acepta #abc, #aabbcc, rgb(…), hsl(…). Devuelve #aabbcc en minúsculas o null si no es válido. */
export function normalizeColor(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const s = input.trim().toLowerCase();
  let m = /^#([0-9a-f]{3})$/.exec(s);
  if (m) return `#${m[1].split("").map((c) => c + c).join("")}`;
  if (HEX.test(s)) return s;
  m = /^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})(?:[\s,/]+[\d.]+%?)?\s*\)$/.exec(s);
  if (m) {
    const [r, g, b] = [m[1], m[2], m[3]].map(Number);
    if ([r, g, b].some((x) => x > 255)) return null;
    return rgbToHex(r, g, b);
  }
  m = /^hsla?\(\s*(-?[\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%(?:[\s,/]+[\d.]+%?)?\s*\)$/.exec(s);
  if (m) {
    const [h, sat, l] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (sat > 100 || l > 100) return null;
    const [r, g, b] = hslToRgb(((h % 360) + 360) % 360, sat / 100, l / 100);
    return rgbToHex(r, g, b);
  }
  return null;
}

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function rgbToHex(r: number, g: number, b: number) {
  return `#${[r, g, b].map((x) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, "0")).join("")}`;
}
export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}
export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, Math.round(l * 100)];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [Math.round(h * 60), Math.round(s * 100), Math.round(l * 100)];
}
const rgba = (hex: string, alpha: number) => { const [r, g, b] = hexToRgb(hex); return `rgba(${r}, ${g}, ${b}, ${+alpha.toFixed(3)})`; };
/** Mezcla dos colores (t = 0 → a, 1 → b). */
export function mix(a: string, b: string, t: number) {
  const x = hexToRgb(a), y = hexToRgb(b);
  return rgbToHex(x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t);
}

/** Contraste WCAG 2.2 entre dos colores sólidos (1 a 21). */
export function contrast(a: string, b: string) {
  const lum = (hex: string) => {
    const [r, g, bl] = hexToRgb(hex).map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
/** Blanco o casi negro: el que mejor se lea sobre `bg`. */
export function readableOn(bg: string) {
  return contrast("#ffffff", bg) >= contrast("#14101f", bg) ? "#ffffff" : "#14101f";
}

/* ------------------------------------------------------------------ validación (entrada no confiable) */

const clamp = (v: unknown, min: number, max: number, def: number) => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.round(Math.max(min, Math.min(max, n))) : def;
};
const pickEnum = <T extends string>(v: unknown, list: readonly T[], def: T): T => (list.includes(v as T) ? (v as T) : def);
const color = (v: unknown, def: string) => normalizeColor(v) ?? def;
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** Deja solo propiedades permitidas, con valores válidos y dentro de sus límites. Lo que falte sale del tema oficial de su tipo. */
export function normalizeTheme(input: unknown): ThemeConfig {
  const raw = obj(input);
  const base = pickEnum(raw.base, ["light", "dark"] as const, "dark");
  const d = officialFor(base);
  const c = obj(raw.colors), bg = obj(raw.background), g = obj(raw.glass), l = obj(raw.layout), e = obj(raw.effects);
  return {
    // Se conserva la versión con la que se guardó (v1 se pinta como antes); lo nuevo nace en la actual.
    v: raw.v === 1 ? 1 : THEME_SCHEMA_VERSION,
    base,
    colors: {
      accent: color(c.accent, d.colors.accent), accent2: color(c.accent2, d.colors.accent2), accent3: color(c.accent3, d.colors.accent3),
      bg: color(c.bg, d.colors.bg), surface: color(c.surface, d.colors.surface), menu: color(c.menu, d.colors.menu),
      dialog: color(c.dialog, d.colors.dialog), input: color(c.input, d.colors.input),
      text: color(c.text, d.colors.text), muted: color(c.muted, d.colors.muted),
    },
    background: {
      kind: pickEnum(bg.kind, ["solid", "gradient", "glow"] as const, d.background.kind),
      from: color(bg.from, d.background.from), to: color(bg.to, d.background.to),
      angle: clamp(bg.angle, 0, 360, d.background.angle), intensity: clamp(bg.intensity, 0, 100, d.background.intensity),
    },
    glass: {
      level: pickEnum(g.level, ["off", "subtle", "elegant", "premium", "custom"] as const, d.glass.level),
      opacity: clamp(g.opacity, 45, 100, d.glass.opacity), blur: clamp(g.blur, 0, 32, d.glass.blur),
      saturation: clamp(g.saturation, 100, 200, d.glass.saturation), border: clamp(g.border, 0, 40, d.glass.border),
      shadow: clamp(g.shadow, 0, 100, d.glass.shadow), sheen: clamp(g.sheen, 0, 100, d.glass.sheen),
    },
    layout: {
      radius: clamp(l.radius, 0, 28, d.layout.radius), density: pickEnum(l.density, ["compact", "normal", "comfortable"] as const, "normal"),
      fontScale: clamp(l.fontScale, 90, 115, 100), dividers: clamp(l.dividers, 4, 30, d.layout.dividers),
    },
    effects: { ambient: clamp(e.ambient, 0, 100, d.effects.ambient), halo: e.halo === undefined ? d.effects.halo : e.halo === true, hover: e.hover === undefined ? d.effects.hover : e.hover === true },
  };
}

/** Niveles de vidrio prearmados (el «personalizado» usa los números del tema). */
type GlassPreset = Record<Exclude<GlassLevel, "custom">, Pick<ThemeConfig["glass"], "opacity" | "blur" | "saturation" | "sheen">>;
/** v2: desenfoque moderado y poca saturación (la saturación alta pintaba de morado todo lo que había detrás). */
export const GLASS_PRESETS: GlassPreset = {
  off: { opacity: 100, blur: 0, saturation: 100, sheen: 0 },
  subtle: { opacity: 92, blur: 8, saturation: 115, sheen: 15 },
  elegant: { opacity: 82, blur: 14, saturation: 125, sheen: 25 },
  premium: { opacity: 70, blur: 20, saturation: 140, sheen: 40 },
};
/** v1 (temas guardados antes del 2026-11-06): se conservan tal cual. */
const GLASS_PRESETS_V1: GlassPreset = {
  off: { opacity: 100, blur: 0, saturation: 100, sheen: 0 },
  subtle: { opacity: 90, blur: 10, saturation: 130, sheen: 20 },
  elegant: { opacity: 80, blur: 18, saturation: 160, sheen: 35 },
  premium: { opacity: 66, blur: 26, saturation: 190, sheen: 55 },
};
export function effectiveGlass(t: ThemeConfig) {
  if (t.glass.level === "custom") return t.glass;
  return { ...t.glass, ...(t.v < 2 ? GLASS_PRESETS_V1 : GLASS_PRESETS)[t.glass.level] };
}

/* ------------------------------------------------------------------ revisión de accesibilidad */

export type ContrastCheck = { key: string; label: string; ratio: number; min: number; ok: boolean };
export function accessibilityReport(t: ThemeConfig): ContrastCheck[] {
  const c = t.colors;
  const rows: Array<[string, string, string, string, number]> = [
    ["text-bg", "Texto sobre el fondo", c.text, c.bg, 4.5],
    ["text-surface", "Texto sobre las tarjetas", c.text, c.surface, 4.5],
    ["muted-surface", "Texto secundario sobre las tarjetas", c.muted, c.surface, 4.5],
    ["text-input", "Texto en los campos", c.text, c.input, 4.5],
    ["text-dialog", "Texto en ventanas y menús", c.text, c.dialog, 4.5],
    ["button", "Texto de los botones principales", readableOn(c.accent), c.accent, 4.5],
    ["accent-surface", "Color principal sobre las tarjetas (enlaces, íconos)", c.accent, c.surface, 3],
  ];
  return rows.map(([key, label, a, b, min]) => { const ratio = contrast(a, b); return { key, label, ratio: Math.round(ratio * 100) / 100, min, ok: ratio >= min }; });
}
/** Lo mínimo para poder guardar: texto principal y secundario legibles (WCAG AA). */
export function isReadable(t: ThemeConfig) {
  return accessibilityReport(t).filter((r) => r.key !== "accent-surface").every((r) => r.ok);
}
/** Corrige el texto para que se lea (oscurece o aclara hasta llegar al mínimo). */
export function fixReadability(t: ThemeConfig): ThemeConfig {
  const c = { ...t.colors };
  const darkest = [c.bg, c.surface, c.input, c.dialog];
  const push = (fg: string, target: number) => {
    const toward = t.base === "dark" ? "#ffffff" : "#000000";
    let out = fg;
    for (let i = 0; i <= 20 && darkest.some((b) => contrast(out, b) < target); i++) out = mix(fg, toward, i / 20);
    return out;
  };
  c.text = push(c.text, 4.5);
  c.muted = push(c.muted, 4.5);
  return { ...t, colors: c };
}

/* ------------------------------------------------------------------ tokens y CSS */

/** Los `--t-*` que entiende todo el panel, calculados desde el tema. Solo números y colores validados. */
export function themeTokens(input: ThemeConfig): Record<string, string> {
  const t = normalizeTheme(input);
  const c = t.colors, g = effectiveGlass(t), dark = t.base === "dark";
  const legacy = t.v < 2;
  const alpha = g.opacity / 100;
  const amb = t.background.intensity / 100;
  // Luces de fondo: en v2 son muy suaves (el violeta va en los acentos, no detrás de cada tarjeta).
  const glowA = legacy ? [(dark ? 0.28 : 0.16) * 1.6, (dark ? 0.16 : 0.1) * 1.6, 0.5] : [dark ? 0.34 : 0.26, dark ? 0.16 : 0.12, 0.9];
  const bgImage = t.background.kind === "solid" ? "none"
    : t.background.kind === "gradient" ? `linear-gradient(${t.background.angle}deg, ${rgba(t.background.from, 0.35 + amb * 0.65)}, ${rgba(t.background.to, 0.35 + amb * 0.65)})`
      : `radial-gradient(900px 620px at 12% 0%, ${rgba(c.accent2, glowA[0] * amb)}, transparent 64%), radial-gradient(820px 640px at 96% 100%, ${rgba(c.accent3, glowA[1] * amb)}, transparent 64%), radial-gradient(900px 700px at 60% 40%, ${rgba(t.background.from, glowA[2] * amb)}, transparent 70%)`;
  const divider = t.layout.dividers / 100;
  const shadowA = (t.glass.shadow / 100) * (dark ? 0.7 : 0.22);
  const sheenA = g.sheen / 100;
  const density = t.layout.density === "compact" ? 0.94 : t.layout.density === "comfortable" ? 1.05 : 1;
  const r = t.layout.radius;
  return {
    "color-scheme": dark ? "dark" : "light",
    "--t-text": c.text,
    "--t-muted": c.muted,
    "--t-border": rgba(c.text, divider + 0.04),
    "--t-card-bg": rgba(c.surface, Math.max(alpha, 0.9)),
    "--t-card-bg-soft": rgba(c.text, dark ? 0.065 : 0.045),
    "--t-card-border": rgba(c.text, divider),
    "--t-accent": c.accent,
    "--t-accent2": c.accent2,
    "--t-accent3": c.accent3,
    "--t-accent4": mix(c.accent2, c.bg, 0.25),
    "--t-on-accent": readableOn(c.accent),
    "--t-bg-base": c.bg,
    "--t-bg": bgImage,
    "--t-vignette": dark ? "rgba(0, 0, 0, 0.24)" : rgba(c.text, 0.05),
    "--t-cta": `linear-gradient(90deg, ${c.accent3}, ${c.accent}, ${c.accent2})`,
    "--t-shadow": `0 24px 70px ${dark ? `rgba(0, 0, 0, ${shadowA.toFixed(2)})` : rgba(c.text, shadowA)}`,
    "--t-menu-bg": rgba(c.menu, Math.max(alpha, 0.86)),
    "--t-input-bg": c.input,
    "--t-glow": String(t.effects.halo ? 60 : 0),
    "--t-radius": String(Math.round(r * 1.5)),
    "--radius-lg": `${Math.round(r * 0.5)}px`,
    "--radius-xl": `${Math.round(r * 0.75)}px`,
    "--radius-2xl": `${r}px`,
    "--radius-3xl": `${Math.round(r * 1.5)}px`,
    "--t-font-scale": String(+((t.layout.fontScale / 100) * density).toFixed(3)),
    // Vidrio (solo se usa con «Vidrio» encendido).
    "--t-glass-blur": `${g.blur}px`,
    "--t-glass-sat": `${g.saturation}%`,
    "--t-glass-card": rgba(c.surface, alpha),
    ...(legacy ? {
      "--t-glass-border": rgba(dark ? "#ffffff" : c.accent, (t.glass.border / 100) * (dark ? 1 : 1.2)),
      "--t-glass-edge": `inset 0 1px 0 ${rgba("#ffffff", dark ? 0.08 + sheenA * 0.12 : 0.6 + sheenA * 0.35)}, 0 14px 38px -16px ${dark ? `rgba(0, 0, 0, ${(0.4 + shadowA * 0.5).toFixed(2)})` : rgba(c.accent, 0.12 + shadowA)}`,
      "--t-glass-sheen": `linear-gradient(135deg, ${rgba("#ffffff", (dark ? 0.09 : 0.5) * sheenA)} 0%, ${rgba("#ffffff", (dark ? 0.02 : 0.1) * sheenA)} 40%, transparent 62%, ${rgba(c.accent2, 0.1 * sheenA)} 100%)`,
    } : {
      // v2: borde fino translúcido, reflejo delicado arriba y sombra amplia neutra (sin halo violeta).
      "--t-glass-border": rgba(dark ? "#ffffff" : mix(c.text, c.accent, 0.4), t.glass.border / 100),
      "--t-glass-edge": `inset 0 1px 0 ${rgba("#ffffff", dark ? 0.05 + sheenA * 0.08 : 0.75 + sheenA * 0.2)}, 0 18px 48px -22px ${dark ? `rgba(0, 0, 0, ${(0.45 + shadowA * 0.35).toFixed(2)})` : rgba(c.text, 0.08 + shadowA * 0.5)}`,
      "--t-glass-sheen": `linear-gradient(180deg, ${rgba("#ffffff", (dark ? 0.05 : 0.55) * sheenA)} 0%, ${rgba("#ffffff", 0)} 42%)`,
    }),
    "--t-glass-dialog": rgba(c.dialog, Math.max(alpha, 0.88)),
    "--t-glass-input": rgba(c.input, Math.max(alpha, 0.8)),
    "--t-accent-soft": rgba(c.accent, dark ? 0.12 : 0.08),
    // Menús flotantes (Apariencia, notificaciones…): cristal casi sólido.
    "--t-popover": rgba(c.dialog, 0.94),
    "--t-popover-border": dark ? "rgba(255, 255, 255, 0.12)" : rgba(c.text, 0.12),
  };
}

/** Bloque CSS seguro para el panel. `scope` es un selector fijo nuestro (nunca de la persona). */
export function themeCss(t: ThemeConfig, scope = "html:root[data-user-theme]") {
  const tokens = themeTokens(t);
  const body = Object.entries(tokens).map(([k, v]) => `${k}: ${v} !important;`).join(" ");
  // En vidrio las variables van en <body>; se repiten ahí para que el tema gane también en ese modo.
  const glassBody = ["--t-card-bg", "--t-card-border", "--t-muted", "--t-glass-edge", "--t-glass-sheen", "--t-glass-dialog", "--t-glass-input", "--t-glass-blur", "--t-glass-sat", "--t-bg"]
    .map((k) => `${k}: ${k === "--t-card-bg" ? tokens["--t-glass-card"] : k === "--t-card-border" ? tokens["--t-glass-border"] : tokens[k]} !important;`).join(" ");
  const noHover = t.effects.hover ? "" : ` ${scope} *:hover { transform: none !important; }`;
  const c = t.colors;
  // Listas nativas: fondo sólido del tema (el navegador no acepta transparencias ahí).
  const options = ` ${scope} select option, ${scope} select optgroup { background-color: ${c.dialog} !important; color: ${c.text} !important; } ${scope} select option:checked { background-color: ${mix(c.dialog, c.accent, 0.35)} !important; color: ${c.text} !important; }`;
  // Celular: menos desenfoque (fluido y gasta menos batería) y tarjetas un poco más sólidas.
  const g = effectiveGlass(t);
  const coarse = ` @media (pointer: coarse) { ${scope}[data-glass="on"][data-glass-area="full"] body { --t-glass-blur: ${Math.min(g.blur, 12)}px !important; --t-card-bg: ${rgba(c.surface, Math.max(g.opacity / 100, 0.8))} !important; } }`;
  return `${scope} { ${body} } ${scope} body { ${body} } ${scope}[data-glass="on"][data-glass-area] body { ${glassBody} }${options}${coarse}${noHover}`;
}

/** Tema → texto para exportar (JSON con nombre). */
export function exportTheme(name: string, t: ThemeConfig) {
  return JSON.stringify({ remhub_theme: THEME_SCHEMA_VERSION, name: name.slice(0, 60), config: normalizeTheme(t) }, null, 2);
}
/** Texto importado → tema validado (o error en español). */
export function importTheme(text: string): { name: string; config: ThemeConfig } {
  if (text.length > MAX_CONFIG_BYTES * 2) throw new Error("El archivo es demasiado grande para ser un tema.");
  let data: unknown;
  try { data = JSON.parse(text); } catch { throw new Error("Ese archivo no es un tema de RemHub (no es JSON válido)."); }
  const o = obj(data);
  if (!("config" in o) || !o.remhub_theme) throw new Error("Ese archivo no es un tema de RemHub.");
  const name = cleanName(o.name) || "Tema importado";
  return { name, config: normalizeTheme(o.config) };
}
export function cleanName(v: unknown) {
  return typeof v === "string" ? v.replace(/[<>{}\\]/g, "").replace(/\s+/g, " ").trim().slice(0, 60) : "";
}
/** Las 5 muestras de color de un tema (para miniaturas). */
export const swatches = (t: ThemeConfig) => [t.colors.bg, t.colors.surface, t.colors.accent, t.colors.accent2, t.colors.accent3];
