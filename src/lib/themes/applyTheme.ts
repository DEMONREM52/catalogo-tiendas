export type ThemeConfig = {
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
};

function gradient(angle = 135, a = "#2a0a5e", b = "#060620") {
  return `linear-gradient(${angle}deg, ${a}, ${b})`;
}

export function applyThemeToRoot(cfg?: ThemeConfig) {
  if (typeof document === "undefined") return;
  const r = document.documentElement;

  const bg =
    cfg?.bgMode === "solid"
      ? (cfg?.bgSolid ?? "#07060d")
      : gradient(cfg?.bgAngle ?? 135, cfg?.bgGradA ?? "#2a0a5e", cfg?.bgGradB ?? "#060620");

  const cta =
    cfg?.ctaMode === "solid"
      ? (cfg?.ctaSolid ?? "#d946ef")
      : gradient(cfg?.ctaAngle ?? 90, cfg?.ctaA ?? "#d946ef", cfg?.ctaB ?? "#8b5cf6");

  r.style.setProperty("--t-text", cfg?.text ?? "#ffffff");
  r.style.setProperty("--t-muted", cfg?.mutedText ?? "rgba(255,255,255,0.72)");
  r.style.setProperty("--t-border", cfg?.border ?? "rgba(255,255,255,0.12)");

  r.style.setProperty("--t-card-bg", cfg?.cardBg ?? "rgba(255,255,255,0.06)");
  r.style.setProperty("--t-card-border", cfg?.cardBorder ?? "rgba(255,255,255,0.12)");

  r.style.setProperty("--t-accent", cfg?.accent ?? "#d946ef");
  r.style.setProperty("--t-accent2", cfg?.accent2 ?? "#8b5cf6");

  r.style.setProperty("--t-radius", String(cfg?.radius ?? 24));
  r.style.setProperty("--t-glow", String(cfg?.glow ?? 60));

  r.style.setProperty("--t-bg", bg);
  r.style.setProperty("--t-cta", cta);
}
