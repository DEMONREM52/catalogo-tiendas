import {
  Instagram,
  Facebook,
  Youtube,
  Globe,
  MessageCircle,
} from "lucide-react";

export function SocialIcon({ type }: { type: string }) {
  const className = "h-5 w-5";

  switch (type) {
    case "instagram":
      return <Instagram className={className} />;
    case "facebook":
      return <Facebook className={className} />;
    case "youtube":
      return <Youtube className={className} />;
    case "website":
      return <Globe className={className} />;
    case "whatsapp":
      return <MessageCircle className={className} />;
    // tiktok no está en lucide por defecto, lo tratamos como "globe" o luego te doy svg
    case "tiktok":
      return <Globe className={className} />;
    default:
      return <Globe className={className} />;
  }
}
