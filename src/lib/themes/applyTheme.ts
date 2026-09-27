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

export function applyThemeToRoot(cfg?: ThemeConfig) {
  if (typeof document === "undefined") return;

  const r = document.documentElement;

  // ---------- BG ----------
  // Prioridad:
  // 1) legacy cfg.bg (ya viene como string listo: gradients/radials/etc)
  // 2) nuevo bgMode solid/gradient
  // 3) default
  const legacyBg = pickStr((cfg as any)?.bg);
  const bg =
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

  // ✅ Variables que usa tu catálogo
  r.style.setProperty("--t-bg", bg);
  r.style.setProperty("--t-cta", cta);

  r.style.setProperty("--t-text", text);
  r.style.setProperty("--t-muted", muted);
  r.style.setProperty("--t-border", border);

  r.style.setProperty("--t-card-bg", cardBg);
  // por si en algún lugar lo usas (no molesta)
  r.style.setProperty("--t-card-border", cardBorder);

  r.style.setProperty("--t-accent", accent);
  r.style.setProperty("--t-accent2", accent2);

  r.style.setProperty("--t-radius", radius);
  r.style.setProperty("--t-glow", glow);
}
