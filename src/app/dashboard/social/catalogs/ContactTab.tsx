"use client";

/* eslint-disable @next/next/no-img-element */
import { useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Globe, ImagePlus, Link2, Loader2, MapPin, MessageCircle, Phone, Plus, Trash2 } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { STORE_CONTACT_ICONS } from "@/lib/store-contacts";
import { newLocalId, type CatalogLink, type CatalogLocation, type StoreCatalog } from "@/lib/catalogs";
import { Field, Section, Switch, ToggleRow, errorText, inputCls, inputStyle, softBox } from "./ui";

type Channel = { id: string; label: string; phone: string; icon: string; active: boolean };

const LINK_TYPES: Array<[string, string]> = [
  ["instagram", "Instagram"],
  ["facebook", "Facebook"],
  ["tiktok", "TikTok"],
  ["youtube", "YouTube"],
  ["whatsapp", "WhatsApp"],
  ["website", "Sitio web"],
  ["other", "Otro"],
];

function asChannels(value: unknown): Channel[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const e = entry as Record<string, unknown>;
    return [{
      id: typeof e.id === "string" && e.id ? e.id : newLocalId("contact"),
      label: typeof e.label === "string" ? e.label : "",
      phone: typeof e.phone === "string" ? e.phone : "",
      icon: typeof e.icon === "string" ? e.icon : "other",
      active: e.active !== false,
    }];
  });
}

export function ContactTab({
  storeId,
  draft,
  patch,
  storeWhatsapp,
  storeChannels,
  storeLocations,
  storeLinks,
}: {
  storeId: string;
  draft: StoreCatalog;
  patch: (change: Partial<StoreCatalog>) => void;
  storeWhatsapp: string;
  storeChannels: unknown[];
  storeLocations: CatalogLocation[];
  storeLinks: CatalogLink[];
}) {
  const channels = asChannels(draft.contact_channels);
  const customChannels = channels.length > 0;
  const primary = channels.find((c) => c.id === "primary") ?? { id: "primary", label: "WhatsApp principal", phone: "", icon: "other", active: true };
  const extras = channels.filter((c) => c.id !== "primary");
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const targetRef = useRef<string | null>(null);

  function setChannels(next: Channel[]) {
    patch({ contact_channels: next });
  }

  function patchChannel(id: string, change: Partial<Channel>) {
    const list = channels.some((c) => c.id === id) ? channels : [primary, ...channels];
    setChannels(list.map((c) => (c.id === id ? { ...c, ...change } : c)));
  }

  function patchLocation(id: string, change: Partial<CatalogLocation>) {
    patch({ locations: draft.locations.map((l) => (l.id === id ? { ...l, ...change } : l)) });
  }

  function patchLink(id: string, change: Partial<CatalogLink>) {
    patch({ links: draft.links.map((l) => (l.id === id ? { ...l, ...change } : l)) });
  }

  async function uploadPhoto(file: File) {
    const id = targetRef.current;
    if (!id) return;
    if (!file.type.startsWith("image/")) return setError("Elige una imagen (PNG o JPG).");
    if (file.size > 2 * 1024 * 1024) return setError("La imagen debe pesar máximo 2 MB.");
    setUploadingId(id);
    setError("");
    try {
      const sb = supabaseBrowser();
      const path = `${storeId}/catalogs/${draft.id}/locations/${id}-${Date.now()}.${file.type.includes("png") ? "png" : "jpg"}`;
      const { error: upError } = await sb.storage.from("store-assets").upload(path, file, { upsert: true, cacheControl: "3600" });
      if (upError) throw upError;
      patchLocation(id, { photo_url: sb.storage.from("store-assets").getPublicUrl(path).data.publicUrl });
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setUploadingId(null);
    }
  }

  return (
    <div className="space-y-4">
      {error ? <p className="rounded-xl border p-2.5 text-sm" style={{ borderColor: "#ef4444" }}>{error}</p> : null}

      <Section title="WhatsApp del catálogo" hint="Los pedidos de este catálogo llegan a estos números." icon={<MessageCircle size={18} />}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="WhatsApp principal" hint={draft.whatsapp ? undefined : `Si lo dejas vacío se usa el de la tienda (${storeWhatsapp}).`}>
            <input className={inputCls} style={inputStyle} inputMode="tel" value={draft.whatsapp ?? ""} placeholder={storeWhatsapp} onChange={(e) => patch({ whatsapp: e.target.value || null })} />
          </Field>
        </div>
        <div className="mt-3">
          <ToggleRow
            title="Asesores propios de este catálogo"
            hint={customChannels ? "Tus clientes eligen a qué asesor enviar el pedido." : "Se usan los asesores configurados en Mi tienda."}
            checked={customChannels}
            onChange={(next) => setChannels(next ? [primary, ...asChannels(storeChannels).filter((c) => c.id !== "primary")] : [])}
          />
        </div>
        {customChannels ? (
          <div className="mt-3 space-y-2">
            <div className="flex flex-wrap items-center gap-2 rounded-2xl border p-3" style={softBox}>
              <span className="text-sm font-semibold">WhatsApp principal</span>
              <select className="rounded-lg border px-2 py-1.5 text-xs" style={inputStyle} value={primary.icon} onChange={(e) => patchChannel("primary", { icon: e.target.value })}>
                {STORE_CONTACT_ICONS.map((o) => <option key={o.value} value={o.value}>{o.emoji} {o.label}</option>)}
              </select>
              <span className="ml-auto flex items-center gap-2 text-xs" style={{ color: "var(--t-muted)" }}>
                Activo <Switch checked={primary.active} onChange={(next) => patchChannel("primary", { active: next })} label="Activar WhatsApp principal" />
              </span>
            </div>
            <AnimatePresence initial={false}>
              {extras.map((c) => (
                <motion.div key={c.id} layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0 }} className="grid gap-2 rounded-2xl border p-3 sm:grid-cols-[150px_minmax(0,1fr)_minmax(0,1fr)_auto]" style={softBox}>
                  <select className="rounded-lg border px-2 py-2 text-xs" style={inputStyle} value={c.icon} onChange={(e) => patchChannel(c.id, { icon: e.target.value })}>
                    {STORE_CONTACT_ICONS.map((o) => <option key={o.value} value={o.value}>{o.emoji} {o.label}</option>)}
                  </select>
                  <input className={inputCls} style={inputStyle} value={c.label} placeholder="Nombre (ej. Asesora Zamora)" onChange={(e) => patchChannel(c.id, { label: e.target.value })} />
                  <input className={inputCls} style={inputStyle} inputMode="tel" value={c.phone} placeholder="Número de WhatsApp" onChange={(e) => patchChannel(c.id, { phone: e.target.value })} />
                  <div className="flex items-center gap-2">
                    <Switch checked={c.active} onChange={(next) => patchChannel(c.id, { active: next })} label={`Activar ${c.label}`} />
                    <button type="button" onClick={() => setChannels(channels.filter((x) => x.id !== c.id))} className="grid h-8 w-8 place-items-center rounded-lg border text-rose-500" style={softBox} aria-label="Quitar asesor"><Trash2 size={14} /></button>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
            <button type="button" onClick={() => setChannels([...(channels.some((c) => c.id === "primary") ? channels : [primary, ...channels]), { id: newLocalId("contact"), label: "", phone: "", icon: "woman-1", active: true }])} className="inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold" style={softBox}>
              <Plus size={14} /> Agregar asesor
            </button>
          </div>
        ) : null}
      </Section>

      <Section title="Encuéntranos" hint="Puntos físicos que tus clientes ven con mapa y ruta." icon={<MapPin size={18} />}>
        <ToggleRow
          title="Ubicaciones propias de este catálogo"
          hint={draft.locations.length ? "Se muestran solo estas ubicaciones." : "Se usan las ubicaciones de Mi tienda."}
          checked={draft.locations.length > 0}
          onChange={(next) => patch({ locations: next ? (storeLocations.length ? storeLocations : [{ id: newLocalId("loc"), name: "", address: "", city: "", map_url: "", photo_url: "", description: "", active: true }]) : [] })}
        />
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void uploadPhoto(file);
          }}
        />
        {draft.locations.length ? (
          <div className="mt-3 space-y-2">
            {draft.locations.map((l) => (
              <div key={l.id} className="grid gap-2 rounded-2xl border p-3 sm:grid-cols-[72px_minmax(0,1fr)]" style={softBox}>
                <button
                  type="button"
                  onClick={() => {
                    targetRef.current = l.id;
                    fileRef.current?.click();
                  }}
                  className="relative grid h-[72px] w-[72px] place-items-center overflow-hidden rounded-xl border"
                  style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg-soft)" }}
                  title="Foto del punto"
                >
                  {l.photo_url ? <img src={l.photo_url} alt="" className="h-full w-full object-cover" /> : uploadingId === l.id ? <Loader2 size={18} className="animate-spin" /> : <ImagePlus size={18} />}
                </button>
                <div className="grid gap-2 sm:grid-cols-2">
                  <input className={inputCls} style={inputStyle} value={l.name} placeholder="Nombre del punto" onChange={(e) => patchLocation(l.id, { name: e.target.value })} />
                  <input className={inputCls} style={inputStyle} value={l.city} placeholder="Ciudad" onChange={(e) => patchLocation(l.id, { city: e.target.value })} />
                  <input className={`${inputCls} sm:col-span-2`} style={inputStyle} value={l.address} placeholder="Dirección" onChange={(e) => patchLocation(l.id, { address: e.target.value })} />
                  <input className={inputCls} style={inputStyle} value={l.map_url} placeholder="Enlace de Google Maps (opcional)" onChange={(e) => patchLocation(l.id, { map_url: e.target.value })} />
                  <input className={inputCls} style={inputStyle} value={l.description} placeholder="Horario o descripción" onChange={(e) => patchLocation(l.id, { description: e.target.value })} />
                  <div className="flex items-center justify-end gap-2 sm:col-span-2">
                    <span className="text-xs" style={{ color: "var(--t-muted)" }}>Visible</span>
                    <Switch checked={l.active} onChange={(next) => patchLocation(l.id, { active: next })} label={`Mostrar ${l.name}`} />
                    <button type="button" onClick={() => patch({ locations: draft.locations.filter((x) => x.id !== l.id) })} className="grid h-8 w-8 place-items-center rounded-lg border text-rose-500" style={softBox} aria-label="Quitar ubicación"><Trash2 size={14} /></button>
                  </div>
                </div>
              </div>
            ))}
            <button type="button" onClick={() => patch({ locations: [...draft.locations, { id: newLocalId("loc"), name: "", address: "", city: "", map_url: "", photo_url: "", description: "", active: true }] })} className="inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold" style={softBox}>
              <Plus size={14} /> Agregar ubicación
            </button>
          </div>
        ) : null}
      </Section>

      <Section title="Redes y enlaces" hint="Iconos de redes en la parte superior del catálogo." icon={<Link2 size={18} />}>
        <ToggleRow
          title="Redes propias de este catálogo"
          hint={draft.links.length ? "Se muestran solo estos enlaces." : "Se usan las redes de Mi tienda."}
          checked={draft.links.length > 0}
          onChange={(next) => patch({ links: next ? (storeLinks.length ? storeLinks : [{ id: newLocalId("link"), type: "instagram", label: "Instagram", url: "" }]) : [] })}
        />
        {draft.links.length ? (
          <div className="mt-3 space-y-2">
            {draft.links.map((l) => (
              <div key={l.id} className="grid gap-2 rounded-2xl border p-3 sm:grid-cols-[150px_minmax(0,1fr)_minmax(0,1.4fr)_auto]" style={softBox}>
                <select className="rounded-lg border px-2 py-2 text-xs" style={inputStyle} value={l.type} onChange={(e) => patchLink(l.id, { type: e.target.value })}>
                  {LINK_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
                <input className={inputCls} style={inputStyle} value={l.label ?? ""} placeholder="Texto visible" onChange={(e) => patchLink(l.id, { label: e.target.value })} />
                <input className={inputCls} style={inputStyle} value={l.url} placeholder="https://…" onChange={(e) => patchLink(l.id, { url: e.target.value })} />
                <button type="button" onClick={() => patch({ links: draft.links.filter((x) => x.id !== l.id) })} className="grid h-9 w-9 place-items-center rounded-lg border text-rose-500" style={softBox} aria-label="Quitar enlace"><Trash2 size={14} /></button>
              </div>
            ))}
            <button type="button" onClick={() => patch({ links: [...draft.links, { id: newLocalId("link"), type: "instagram", label: "", url: "" }] })} className="inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold" style={softBox}>
              <Plus size={14} /> Agregar enlace
            </button>
          </div>
        ) : null}
      </Section>

      <Section title="Datos al pie del catálogo" hint="Dirección y datos de contacto que se muestran abajo." icon={<Globe size={18} />}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Dirección"><input className={inputCls} style={inputStyle} value={draft.address ?? ""} onChange={(e) => patch({ address: e.target.value || null })} placeholder="Calle 1 # 2-3" /></Field>
          <Field label="Ciudad"><input className={inputCls} style={inputStyle} value={draft.city ?? ""} onChange={(e) => patch({ city: e.target.value || null })} /></Field>
          <Field label="Teléfono"><div className="relative"><Phone size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--t-muted)" }} /><input className={inputCls} style={{ ...inputStyle, paddingLeft: "2rem" }} value={draft.phone ?? ""} onChange={(e) => patch({ phone: e.target.value || null })} /></div></Field>
          <Field label="Correo"><input className={inputCls} style={inputStyle} type="email" value={draft.email ?? ""} onChange={(e) => patch({ email: e.target.value || null })} /></Field>
          <Field label="Mensaje final" className="sm:col-span-2"><input className={inputCls} style={inputStyle} value={draft.footer_note ?? ""} maxLength={200} onChange={(e) => patch({ footer_note: e.target.value || null })} placeholder="¡Gracias por comprar con nosotros!" /></Field>
        </div>
      </Section>
    </div>
  );
}
