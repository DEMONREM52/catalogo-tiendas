import { Facebook, Globe, Instagram, Link2, MessageCircle, Youtube } from "lucide-react";
import { socialBrand } from "@/lib/social-links";

export * from "@/lib/social-links";

function TikTokGlyph({ size }: { size: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true">
      <path d="M16.6 3c.35 2.3 1.8 3.85 4.1 4.05v3.1a7.2 7.2 0 0 1-4.05-1.3v6.2A5.95 5.95 0 1 1 10.7 9.1v3.2a2.8 2.8 0 1 0 2.8 2.8V3h3.1z" />
    </svg>
  );
}

export function SocialIcon({ type, size = 20 }: { type: string; size?: number }) {
  switch (type) {
    case "instagram": return <Instagram size={size} />;
    case "facebook": return <Facebook size={size} />;
    case "youtube": return <Youtube size={size} />;
    case "website": return <Globe size={size} />;
    case "whatsapp": return <MessageCircle size={size} />;
    case "tiktok": return <TikTokGlyph size={size} />;
    default: return <Link2 size={size} />;
  }
}

/** Icono de la red dentro de su cuadrito con el color de la marca. */
export function SocialBadge({ type, size = 36, rounded = 12 }: { type: string; size?: number; rounded?: number }) {
  const b = socialBrand(type);
  return (
    <span className="grid shrink-0 place-items-center shadow-sm" style={{ width: size, height: size, borderRadius: rounded, background: b.bg, color: b.fg }} aria-hidden="true">
      <SocialIcon type={b.type} size={Math.round(size * 0.52)} />
    </span>
  );
}

