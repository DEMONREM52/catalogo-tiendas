import { PRODUCTION_ORIGIN } from "@/lib/share/origin";

/**
 * Sello discreto al pie de catálogos y vitrinas. Cada cliente de una tienda descubre RemHub, y el registro
 * recuerda qué tienda lo trajo (?ref=slug) para el programa «Invita y gana».
 */
export function MadeWithRemhub({ slug, source }: { slug?: string | null; source: "catalogo" | "vitrina" | "pausada" }) {
  const q = new URLSearchParams({ utm_source: source, utm_medium: "sello" });
  if (slug) q.set("ref", slug);
  return (
    <p className="pb-6 pt-2 text-center text-[11px]" style={{ color: "var(--t-muted)" }}>
      <a href={`${PRODUCTION_ORIGIN}/?${q.toString()}`} target="_blank" rel="noopener" className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 transition hover:opacity-100"
        style={{ borderColor: "var(--t-card-border, rgba(148,163,184,.3))", opacity: 0.85 }}>
        ⚡ Hecho con <b>RemHub</b> · Crea tu tienda gratis
      </a>
    </p>
  );
}
