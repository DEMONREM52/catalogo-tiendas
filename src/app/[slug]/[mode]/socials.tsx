import { SocialBadge, linkDisplayName, linkVisualType, socialBrand } from "@/lib/supabase/socialIcons";

export function SocialIconRow({
  links,
}: {
  links: Array<{
    id: string;
    type: string;
    label: string | null;
    url: string;
    icon_url: string | null;
  }>;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {links.map((l) => {
        const type = linkVisualType(l.type, l.url);
        const name = linkDisplayName(l.type, l.url, l.label);
        return (
          <a
            key={l.id}
            href={l.url}
            target="_blank"
            rel="noreferrer"
            className="group inline-flex items-center gap-2 rounded-2xl border py-1.5 pl-1.5 pr-3.5 text-sm font-semibold transition hover:-translate-y-0.5 hover:shadow-lg"
            style={{
              borderColor: "var(--t-border)",
              background: "color-mix(in oklab, var(--t-card-bg) 82%, transparent)",
              color: "var(--t-text)",
            }}
            title={`${name} · ${socialBrand(type).name}`}
          >
            {type === "other" && l.icon_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={l.icon_url} alt="" className="h-8 w-8 rounded-[10px] object-cover" />
            ) : (
              <span className="transition group-hover:scale-110 group-hover:-rotate-6"><SocialBadge type={type} size={32} rounded={10} /></span>
            )}
            <span className="opacity-95">{name}</span>
          </a>
        );
      })}
    </div>
  );
}
