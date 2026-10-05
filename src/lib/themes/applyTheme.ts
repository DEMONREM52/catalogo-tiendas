export type ThemeConfig = {
  // ✅ NUEVO (si lo usas en el futuro)
  text?: string;
  mutedText?: string;
  border?: string;

  cardBg?: string;
  cardBorder?: string;

  accent?: string;
  accent2?: string;

  radius?: number;
  glow?: number;

  // Modo de color: "auto" sigue al visitante; "light"/"dark" lo fuerzan para esta tienda.
  colorMode?: "auto" | "light" | "dark";
  // Colores opcionales para la variante clara cuando el tema base es oscuro.
  lightBg?: string;
  lightBg2?: string;
  lightText?: string;
  lightMuted?: string;
  lightBorder?: string;
  lightCardBg?: string;
  lightAccent?: string;
  lightAccent2?: string;
  ctaFromAccent?: boolean;
  lightCta?: string;
  bgMode?: "solid" | "gradient";
  bgSolid?: string;
  bgGradA?: string;
  bgGradB?: string;
  bgAngle?: number;

  ctaMode?: "solid" | "gradient";
  ctaSolid?: string;
  ctaA?: string;
  ctaB?: string;
  ctaAngle?: number;

  // ✅ LEGACY (tu dashboard actual)
  bg?: string;
  card?: string;
  card_border?: string;
  muted?: string;
  cta?: string;
};

function gradient(angle = 135, a = "#2a0a5e", b = "#060620") {
  return `linear-gradient(${angle}deg, ${a}, ${b})`;
}

function pickStr(v: any) {
  const s = typeof v === "string" ? v.trim() : "";
  return s || undefined;
}

function luminanceOf(color: string | undefined): number | null {
  if (!color) return null;
  const hex = color.match(/#([0-9a-f]{3}|[0-9a-f]{6})\b/i);
  let rgb: number[] | null = null;
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].split("").map((c) => c + c).join("") : hex[1];
    rgb = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  } else {
    const m = color.match(/rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i);
    if (m) rgb = [Number(m[1]), Number(m[2]), Number(m[3])];
  }
  if (!rgb) return null;
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function applyThemeToElement(
  cfg: ThemeConfig | undefined,
  element: HTMLElement,
  scheme?: "light" | "dark",
) {
  const r = element;

  // ---------- BG ----------
  // Prioridad:
  // 1) legacy cfg.bg (ya viene como string listo: gradients/radials/etc)
  // 2) nuevo bgMode solid/gradient
  // 3) default
  const legacyBg = pickStr((cfg as any)?.bg);
  const rawBg = pickStr((cfg as any)?.__rawBg);
  const bg =
    rawBg ??
    legacyBg ??
    (cfg?.bgMode === "solid"
      ? (cfg?.bgSolid ?? "#07060d")
      : gradient(cfg?.bgAngle ?? 135, cfg?.bgGradA ?? "#2a0a5e", cfg?.bgGradB ?? "#060620"));

  // ---------- CTA ----------
  // Prioridad:
  // 1) legacy cfg.cta (string sólido o gradient listo)
  // 2) nuevo ctaMode
  // 3) legacy ctaA/ctaB (si las guardaste así)
  // 4) fallback
  const legacyCta = pickStr((cfg as any)?.cta);
  const legacyCtaA = pickStr((cfg as any)?.ctaA);
  const legacyCtaB = pickStr((cfg as any)?.ctaB);

  const cta =
    legacyCta ??
    (cfg?.ctaMode === "solid"
      ? (cfg?.ctaSolid ?? "#d946ef")
      : cfg?.ctaMode === "gradient"
        ? gradient(cfg?.ctaAngle ?? 90, cfg?.ctaA ?? "#d946ef", cfg?.ctaB ?? "#8b5cf6")
        : legacyCtaA
          ? (legacyCtaB ? gradient(90, legacyCtaA, legacyCtaB) : legacyCtaA)
          : "#d946ef");

  // ---------- TEXT / MUTED / BORDER ----------
  const text = pickStr((cfg as any)?.text) ?? "#ffffff";

  // legacy: muted
  const muted =
    pickStr((cfg as any)?.muted) ??
    pickStr((cfg as any)?.mutedText) ??
    "rgba(255,255,255,0.72)";

  // legacy: card_border la estás usando como border global en tu catálogo
  const border =
    pickStr((cfg as any)?.card_border) ??
    pickStr((cfg as any)?.border) ??
    "rgba(255,255,255,0.12)";

  // ---------- CARD ----------
  const cardBg =
    pickStr((cfg as any)?.card) ??
    pickStr((cfg as any)?.cardBg) ??
    "rgba(255,255,255,0.06)";

  const cardBorder =
    pickStr((cfg as any)?.cardBorder) ??
    // si no existe, usamos el mismo border global
    border;

  // ---------- ACCENTS ----------
  const accent = pickStr((cfg as any)?.accent) ?? "#d946ef";
  const accent2 = pickStr((cfg as any)?.accent2) ?? accent;

  // ---------- RADIUS / GLOW ----------
  const radius = String((cfg as any)?.radius ?? 24);
  const glow = String((cfg as any)?.glow ?? 60);
  const bgBase =
    cfg?.bgMode === "solid" && cfg.bgSolid
      ? cfg.bgSolid
      : "#070014";

  // Si el tema de la tienda no coincide con el modo claro/oscuro elegido, se adapta conservando acentos y CTA.
  const effectiveScheme =
    cfg?.colorMode === "light" || cfg?.colorMode === "dark" ? cfg.colorMode : scheme;
  const themeIsDark = (luminanceOf(text) ?? 1) > 0.5;
  const adapt = effectiveScheme && (effectiveScheme === "dark") !== themeIsDark ? effectiveScheme : null;
  const light = adapt === "light";
  const lightBg = pickStr(cfg?.lightBg);
  const lightBg2 = pickStr(cfg?.lightBg2);
  const lightText = pickStr(cfg?.lightText);
  const lightMuted = pickStr(cfg?.lightMuted);
  const lightBorder = pickStr(cfg?.lightBorder);
  const lightCardBg = pickStr(cfg?.lightCardBg);
  const lightAccent = pickStr(cfg?.lightAccent);
  const lightAccent2 = pickStr(cfg?.lightAccent2);

  const finalBg = adapt
    ? light
      ? lightBg && lightBg2
        ? `linear-gradient(135deg, ${lightBg}, ${lightBg2})`
        : lightBg ?? `linear-gradient(135deg, color-mix(in oklab, ${accent} 16%, #ffffff), color-mix(in oklab, ${accent2} 10%, #f1f5f9))`
      : `linear-gradient(135deg, color-mix(in oklab, ${accent} 28%, #0b0713), #05030a)`
    : bg;
  const finalBgBase = adapt ? (light ? lightBg ?? "#f8fafc" : "#07060d") : bgBase;
  const finalText = adapt ? (light ? lightText ?? "#0f172a" : "#f8fafc") : text;
  const finalMuted = adapt ? (light ? lightMuted ?? "rgba(15,23,42,0.68)" : "rgba(248,250,252,0.72)") : muted;
  const finalBorder = adapt ? (light ? lightBorder ?? "rgba(15,23,42,0.14)" : "rgba(255,255,255,0.14)") : border;
  const finalCard = adapt ? (light ? lightCardBg ?? "rgba(255,255,255,0.88)" : "rgba(255,255,255,0.07)") : cardBg;
  const finalAccent = adapt && light ? lightAccent ?? accent : accent;
  const finalAccent2 = adapt && light ? lightAccent2 ?? accent2 : accent2;

  // Sin CTA propio: oscuro usa un tono profundo del acento y claro usa el acento 2 vivo.
  const lightCta = pickStr(cfg?.lightCta);
  const isLightView = (adapt && light) || (!adapt && !themeIsDark);
  const finalCta = isLightView && lightCta
    ? lightCta
    : (cfg as any)?.ctaFromAccent
    ? isLightView
      ? finalAccent2
      : `linear-gradient(90deg, color-mix(in oklab, ${accent} 72%, #000000), color-mix(in oklab, ${accent} 46%, #000000))`
    : cta;

  // El texto del botón se elige por contraste con el primer color del CTA.
  const ctaLum = luminanceOf(finalCta);
  const ctaText = ctaLum !== null && ctaLum > 0.45 ? "#111827" : "#ffffff";

  // Store theme tokens stay scoped to the catalog element.
  r.style.setProperty("--t-bg", finalBg);
  r.style.setProperty("--t-bg-base", finalBgBase);
  r.style.setProperty("--t-cta", finalCta);
  r.style.setProperty("--t-cta-text", ctaText);

  r.style.setProperty("--t-text", finalText);
  r.style.setProperty("--t-muted", finalMuted);
  r.style.setProperty("--t-border", finalBorder);

  r.style.setProperty("--t-card-bg", finalCard);
  // por si en algún lugar lo usas (no molesta)
  r.style.setProperty("--t-card-border", adapt ? finalBorder : cardBorder);

  r.style.setProperty("--t-accent", finalAccent);
  r.style.setProperty("--t-accent2", finalAccent2);

  r.style.setProperty("--t-radius", radius);
  r.style.setProperty("--t-glow", glow);
  r.style.setProperty("--t-store-bg-opacity", String(Math.min(0.3, Math.max(0.08, Number(glow) / 300))));
}
