/** Redes sociales: colores de marca, reconocer la red por el enlace y el nombre bien escrito (sin JSX, se puede probar). */

/** Datos visuales de cada red: nombre, color de marca (fondo del icono) y un ejemplo de enlace. */
export type SocialBrand = { type: string; name: string; bg: string; fg: string; example: string };

export const SOCIAL_BRANDS: SocialBrand[] = [
  { type: "instagram", name: "Instagram", bg: "linear-gradient(135deg,#feda75 0%,#fa7e1e 25%,#d62976 55%,#962fbf 80%,#4f5bd5 100%)", fg: "#fff", example: "https://instagram.com/tutienda" },
  { type: "tiktok", name: "TikTok", bg: "linear-gradient(135deg,#111 55%,#25f4ee 56%,#25f4ee 70%,#fe2c55 71%)", fg: "#fff", example: "https://tiktok.com/@tutienda" },
  { type: "facebook", name: "Facebook", bg: "#1877f2", fg: "#fff", example: "https://facebook.com/tutienda" },
  { type: "whatsapp", name: "WhatsApp", bg: "#25d366", fg: "#fff", example: "https://wa.me/573001234567" },
  { type: "youtube", name: "YouTube", bg: "#ff0000", fg: "#fff", example: "https://youtube.com/@tutienda" },
  { type: "website", name: "Sitio web", bg: "linear-gradient(135deg,#8b5cf6,#6366f1)", fg: "#fff", example: "https://tutienda.com" },
  { type: "other", name: "Otro", bg: "linear-gradient(135deg,#64748b,#475569)", fg: "#fff", example: "https://…" },
];

export function socialBrand(type: string): SocialBrand {
  return SOCIAL_BRANDS.find((b) => b.type === type) ?? SOCIAL_BRANDS[SOCIAL_BRANDS.length - 1];
}

/** Reconoce la red por el enlace (para que un enlace de TikTok nunca salga con el icono de Instagram). */
export function detectLinkType(url: string): string | null {
  const u = url.trim().toLowerCase();
  if (!u) return null;
  if (/(^|[/.])(instagram\.com|instagr\.am)/.test(u)) return "instagram";
  if (/(^|[/.])tiktok\.com/.test(u)) return "tiktok";
  if (/(^|[/.])(facebook\.com|fb\.com|fb\.me|m\.me)/.test(u)) return "facebook";
  if (/(^|[/.])(wa\.me|whatsapp\.com|api\.whatsapp)/.test(u)) return "whatsapp";
  if (/(^|[/.])(youtube\.com|youtu\.be)/.test(u)) return "youtube";
  return null;
}

/** El tipo con el que se pinta un enlace: manda lo que diga la dirección; si no se reconoce, lo elegido. */
export function linkVisualType(type: string, url: string) {
  return detectLinkType(url) ?? type;
}

/** Nombre que se muestra: el texto propio, o el nombre bien escrito de la red que corresponde al enlace. */
export function linkDisplayName(type: string, url: string, label: string | null | undefined) {
  // Si el texto es solo el nombre de una red (p. ej. «Instagram» en un enlace de TikTok), se muestra el de la red real.
  return isAutoLabel(label) ? socialBrand(linkVisualType(type, url)).name : (label ?? "").trim();
}

/** ¿El texto es el nombre automático de alguna red (o está vacío)? Entonces se puede cambiar solo. */
export function isAutoLabel(label: string | null | undefined) {
  const t = (label ?? "").trim().toLowerCase();
  return !t || SOCIAL_BRANDS.some((b) => b.name.toLowerCase() === t);
}
