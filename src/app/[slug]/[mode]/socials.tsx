import { SocialIcon } from "@/lib/supabase/socialIcons";

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
      {links.map((l) => (
        <a
          key={l.id}
          href={l.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2 rounded-xl border border-white/10 px-3 py-2 text-sm"
          style={{ background: "rgba(255,255,255,0.03)" }}
          title={l.label ?? l.type}
        >
          {l.type === "other" && l.icon_url ? (
            <img
              src={l.icon_url}
              alt={l.label ?? "icono"}
              className="h-5 w-5 rounded"
            />
          ) : (
            <SocialIcon type={l.type} />
          )}
          <span className="opacity-90">{l.label ?? l.type}</span>
        </a>
      ))}
    </div>
  );
}
