"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Eye, EyeOff, ExternalLink, Plus, Sparkles, Trash2, Wand2 } from "lucide-react";
import {
  SOCIAL_BRANDS,
  SocialBadge,
  detectLinkType,
  isAutoLabel,
  linkDisplayName,
  linkVisualType,
  socialBrand,
} from "@/lib/supabase/socialIcons";

export type EditableSocialLink = { id: string; type: string; label: string | null; url: string; active?: boolean };

const fieldCls = "w-full rounded-xl border px-3 py-2.5 text-sm outline-none transition focus:ring-2 focus:ring-[color:var(--t-accent)]/40";
const fieldStyle = { borderColor: "var(--t-card-border)", background: "var(--t-input-bg, var(--t-card-bg))", color: "var(--t-text)" } as const;

function safeHref(url: string) {
  const u = url.trim();
  if (!u) return null;
  return /^https?:\/\//i.test(u) ? u : `https://${u}`;
}

/**
 * Editor de redes y enlaces con iconos de cada red. El nombre visible se llena solo con el nombre bien escrito
 * de la red (sin errores de ortografía) y cambia con ella, salvo que la persona escriba un texto propio.
 * Pegar el enlace reconoce la red sola (un enlace de TikTok nunca queda como Instagram).
 */
export function SocialLinksEditor<T extends EditableSocialLink>({
  links,
  onPatch,
  onRemove,
  onAdd,
  disabled,
}: {
  links: T[];
  onPatch: (id: string, change: Partial<EditableSocialLink>) => void;
  onRemove: (link: T) => void;
  /** Agrega un enlace nuevo de esa red, con su nombre ya puesto. */
  onAdd: (type: string, label: string) => void;
  disabled?: boolean;
}) {
  const used = new Set(links.map((l) => linkVisualType(l.type, l.url)));
  const quick = SOCIAL_BRANDS.filter((b) => b.type !== "other" && !used.has(b.type));
  const visible = links.filter((l) => l.active !== false && l.url.trim());

  function chooseType(link: T, type: string) {
    onPatch(link.id, { type, ...(isAutoLabel(link.label) ? { label: socialBrand(type).name } : {}) });
  }

  function changeUrl(link: T, url: string) {
    const found = detectLinkType(url);
    if (found && found !== link.type) {
      onPatch(link.id, { url, type: found, ...(isAutoLabel(link.label) ? { label: socialBrand(found).name } : {}) });
    } else {
      onPatch(link.id, { url });
    }
  }

  return (
    <div className="space-y-3">
      <AnimatePresence initial={false}>
        {links.map((link) => {
          const type = linkVisualType(link.type, link.url);
          const brand = socialBrand(type);
          const href = safeHref(link.url);
          const hidden = link.active === false;
          const autoName = isAutoLabel(link.label);
          return (
            <motion.div
              key={link.id}
              layout
              initial={{ opacity: 0, y: 10, scale: 0.98 }}
              animate={{ opacity: hidden ? 0.6 : 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, x: -20, height: 0, marginTop: 0 }}
              transition={{ type: "spring", stiffness: 380, damping: 32 }}
              className="relative overflow-hidden rounded-2xl border p-3 sm:p-4"
              style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg-soft)" }}
            >
              {/* Franja con el color de la red. */}
              <span aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-1" style={{ background: brand.bg }} />
              <div className="flex items-start gap-3">
                <motion.span key={type} initial={{ scale: 0.6, rotate: -20 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: "spring", stiffness: 420, damping: 18 }} className="mt-0.5">
                  <SocialBadge type={type} size={46} rounded={14} />
                </motion.span>
                <div className="min-w-0 flex-1 space-y-2.5">
                  {/* Elegir la red tocando su icono. */}
                  <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="Red social">
                    {SOCIAL_BRANDS.map((b) => {
                      const on = b.type === type;
                      return (
                        <button
                          key={b.type}
                          type="button"
                          role="radio"
                          aria-checked={on}
                          disabled={disabled}
                          onClick={() => chooseType(link, b.type)}
                          title={b.name}
                          className="rounded-[11px] p-0.5 transition hover:scale-110 disabled:opacity-50"
                          style={{ boxShadow: on ? "0 0 0 2px var(--t-accent)" : "none", opacity: on ? 1 : 0.55 }}
                        >
                          <SocialBadge type={b.type} size={26} rounded={9} />
                          <span className="sr-only">{b.name}</span>
                        </button>
                      );
                    })}
                    <span className="ml-1 text-xs font-bold" style={{ color: "var(--t-muted)" }}>{brand.name}</span>
                  </div>

                  <div className="grid gap-2 sm:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
                    <label className="block">
                      <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--t-muted)" }}>Enlace</span>
                      <input
                        className={fieldCls}
                        style={fieldStyle}
                        inputMode="url"
                        value={link.url}
                        disabled={disabled}
                        placeholder={brand.example}
                        onChange={(e) => changeUrl(link, e.target.value)}
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1 flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--t-muted)" }}>
                        Nombre visible {autoName ? <span className="inline-flex items-center gap-0.5 normal-case tracking-normal" style={{ color: "var(--t-accent)" }}><Wand2 size={11} /> automático</span> : null}
                      </span>
                      <div className="flex gap-1.5">
                        <input
                          className={fieldCls}
                          style={fieldStyle}
                          maxLength={48}
                          value={link.label ?? ""}
                          disabled={disabled}
                          placeholder={brand.name}
                          onChange={(e) => onPatch(link.id, { label: e.target.value })}
                        />
                        {!autoName ? (
                          <button
                            type="button"
                            disabled={disabled}
                            onClick={() => onPatch(link.id, { label: brand.name })}
                            className="shrink-0 rounded-xl border px-2.5 text-xs font-bold"
                            style={{ borderColor: "var(--t-card-border)", color: "var(--t-accent)" }}
                            title={`Usar «${brand.name}»`}
                          >
                            <Wand2 size={14} />
                          </button>
                        ) : null}
                      </div>
                    </label>
                  </div>
                </div>

                <div className="flex shrink-0 flex-col gap-1.5">
                  {href ? (
                    <a href={href} target="_blank" rel="noreferrer" className="grid h-9 w-9 place-items-center rounded-xl border transition hover:scale-105" style={{ borderColor: "var(--t-card-border)" }} title="Probar el enlace" aria-label="Probar el enlace">
                      <ExternalLink size={15} />
                    </a>
                  ) : null}
                  {link.active !== undefined ? (
                    <button type="button" disabled={disabled} onClick={() => onPatch(link.id, { active: hidden })} className="grid h-9 w-9 place-items-center rounded-xl border transition hover:scale-105" style={{ borderColor: "var(--t-card-border)", color: hidden ? "var(--t-muted)" : "var(--t-accent)" }} title={hidden ? "Oculto: tocar para mostrar" : "Visible: tocar para ocultar"} aria-label={hidden ? "Mostrar en el catálogo" : "Ocultar del catálogo"}>
                      {hidden ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  ) : null}
                  <button type="button" disabled={disabled} onClick={() => onRemove(link)} className="grid h-9 w-9 place-items-center rounded-xl border text-rose-500 transition hover:scale-105" style={{ borderColor: "var(--t-card-border)" }} aria-label={`Quitar ${linkDisplayName(link.type, link.url, link.label)}`}>
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>

      {/* Agregar con un toque: solo las redes que aún no están. */}
      <div className="flex flex-wrap items-center gap-2">
        {quick.map((b) => (
          <button
            key={b.type}
            type="button"
            disabled={disabled}
            onClick={() => onAdd(b.type, b.name)}
            className="inline-flex items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-xs font-bold transition hover:-translate-y-0.5 hover:shadow-md disabled:opacity-50"
            style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)" }}
          >
            <SocialBadge type={b.type} size={24} rounded={999} /> <Plus size={12} /> {b.name}
          </button>
        ))}
        <button
          type="button"
          disabled={disabled}
          onClick={() => onAdd("website", "")}
          className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition hover:-translate-y-0.5 disabled:opacity-50"
          style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)" }}
        >
          <Plus size={13} /> Otro enlace
        </button>
      </div>

      {/* Vista previa: así lo ven los clientes. */}
      {visible.length ? (
        <div className="rounded-2xl border border-dashed p-3" style={{ borderColor: "var(--t-card-border)" }}>
          <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--t-muted)" }}>
            <Sparkles size={12} /> Así se ve en el catálogo
          </p>
          <div className="flex flex-wrap gap-2">
            {visible.map((l) => (
              <span key={l.id} className="inline-flex items-center gap-2 rounded-2xl border py-1 pl-1 pr-3 text-sm font-semibold" style={{ borderColor: "var(--t-border)", background: "var(--t-card-bg)" }}>
                <SocialBadge type={linkVisualType(l.type, l.url)} size={28} rounded={9} />
                {linkDisplayName(l.type, l.url, l.label)}
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
