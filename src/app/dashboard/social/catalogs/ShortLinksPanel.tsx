"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarClock, Copy, History, Link2, Loader2, Pencil, Plus, QrCode, Trash2, X } from "lucide-react";
import Swal from "sweetalert2";
import { supabaseBrowser } from "@/lib/supabase/client";
import { storeShareUrl } from "@/lib/share/store-host";
import { DateField } from "@/components/forms/Fields";
import { QrDialog } from "@/components/pwa/QrDialog";
import { errorText, inputCls, inputStyle, softBox, swalTheme } from "./ui";

const SUBDOMAINS = process.env.NEXT_PUBLIC_STORE_SUBDOMAINS === "1";

type ShortLink = {
  id: string; code: string; target: string; kind: "manual" | "rename"; hits: number; last_hit_at: string | null;
  starts_at?: string | null; ends_at?: string | null; fallback_target?: string | null; source?: string | null; note?: string | null; now?: string;
};
type LinksData = {
  ok: boolean;
  slug: string;
  point_scope?: boolean;
  history: { slug: string; changed_at: string }[];
  links: ShortLink[];
  catalogs: { slug: string; name: string; active: boolean; private: boolean }[];
};
type Draft = { id: string | null; code: string; target: string; fallback: string; source: string; starts: string; ends: string; note: string };

const SOURCES = [
  ["", "Sin origen"], ["instagram", "Instagram"], ["facebook", "Facebook"], ["tiktok", "TikTok"], ["whatsapp", "WhatsApp"],
  ["google", "Google"], ["volante", "Volante / impreso"], ["mostrador", "QR del mostrador"],
] as const;

function cleanCode(value: string) {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
}

/** Fecha (DD/MM/AAAA en pantalla) ↔ inicio del día en Colombia. */
const dayStart = (d: string) => (d ? `${d}T00:00:00-05:00` : "");
const isoDay = (iso: string | null | undefined) => (iso ? new Date(new Date(iso).getTime() - 5 * 3600_000).toISOString().slice(0, 10) : "");
const fmtDay = (iso: string | null | undefined) => (iso ? isoDay(iso).split("-").reverse().join("/") : "");

/** Enlaces cortos de la tienda: lavitrina.remhub.co/z → catálogo de Zamora. */
export function ShortLinksPanel({ storeId, canEdit }: { storeId: string; canEdit: boolean }) {
  const [data, setData] = useState<LinksData | null>(null);
  const [missing, setMissing] = useState(false);
  const [editing, setEditing] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [qr, setQr] = useState<ShortLink | null>(null);

  const load = useCallback(async () => {
    const { data: res, error } = await supabaseBrowser().rpc("store_links_get", { p_store: storeId });
    if (error) {
      setMissing(/store_links_get|schema cache|Could not find/i.test(error.message));
      return;
    }
    setData(res as LinksData);
  }, [storeId]);

  useEffect(() => {
    void load();
  }, [load]);

  const destinations = useMemo(() => {
    // Un usuario de punto solo enlaza a los catálogos de su punto.
    const list: { value: string; label: string }[] = data?.point_scope ? [] : [
      { value: "/", label: "🏠 Inicio de la tienda" },
      { value: "/inicio", label: "🏪 Vitrina (todos los catálogos)" },
      { value: "/detal", label: "🛍️ Catálogo detal" },
    ];
    for (const c of data?.catalogs ?? []) {
      list.push({ value: `/${c.slug}`, label: `✨ ${c.name}${c.private ? " (privado)" : ""}${c.active ? "" : " (apagado)"}` });
    }
    return list;
  }, [data]);

  if (missing) {
    return (
      <section className="rounded-3xl border border-dashed p-5 text-sm" style={{ borderColor: "var(--t-accent)" }}>
        <p className="font-bold">Enlaces cortos</p>
        <p className="mt-1" style={{ color: "var(--t-muted)" }}>
          Ejecuta en Supabase <b>20261201_nombres_enlaces_cortos.sql</b> y <b>20261202_espacio_tienda.sql</b> y recarga esta página.
        </p>
      </section>
    );
  }
  if (!data?.ok) return null;

  const url = (path: string) => storeShareUrl(data.slug, path, SUBDOMAINS);
  const labelFor = (target: string) => destinations.find((d) => d.value === target)?.label ?? target;
  const blank = (): Draft => ({
    id: null, code: "", fallback: "", source: "", starts: "", ends: "", note: "",
    target: destinations.find((d) => !["/", "/inicio", "/detal"].includes(d.value))?.value ?? destinations[0]?.value ?? "/",
  });

  async function copy(link: ShortLink) {
    const text = url(`/${link.code}`);
    try {
      await navigator.clipboard.writeText(text);
      await Swal.fire({ icon: "success", title: "Enlace copiado", text, timer: 1500, showConfirmButton: false, ...swalTheme });
    } catch {
      await Swal.fire({ icon: "info", title: "Copia este enlace", text, ...swalTheme });
    }
  }

  async function save() {
    if (!editing) return;
    setBusy(true);
    try {
      const { error } = await supabaseBrowser().rpc("store_short_link_save", {
        p_store: storeId, p_id: editing.id, p_code: cleanCode(editing.code), p_target: editing.target,
        p_opts: {
          fallback_target: editing.fallback || null, source: editing.source || null, note: editing.note.trim() || null,
          starts_at: dayStart(editing.starts) || null, ends_at: dayStart(editing.ends) || null,
        },
      });
      if (error) throw error;
      setEditing(null);
      await load();
    } catch (cause) {
      await Swal.fire({ icon: "warning", title: "No se guardó el enlace", text: errorText(cause), ...swalTheme });
    } finally {
      setBusy(false);
    }
  }

  async function remove(link: ShortLink) {
    const confirm = await Swal.fire({
      icon: "warning",
      title: `¿Borrar /${link.code}?`,
      text: link.kind === "rename"
        ? "Es el nombre viejo de un catálogo: quien tenga el enlace viejo ya no llegará al catálogo."
        : "Quien tenga este enlace (o su QR impreso) ya no llegará a ningún lado.",
      showCancelButton: true,
      confirmButtonText: "Borrar",
      cancelButtonText: "Cancelar",
      ...swalTheme,
    });
    if (!confirm.isConfirmed) return;
    const { error } = await supabaseBrowser().rpc("store_short_link_delete", { p_store: storeId, p_id: link.id });
    if (error) await Swal.fire({ icon: "error", title: "No se borró", text: errorText(error), ...swalTheme });
    await load();
  }

  const totalHits = data.links.reduce((sum, l) => sum + Number(l.hits ?? 0), 0);

  return (
    <section className="rounded-3xl border p-5" style={softBox}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl">
          <h2 className="flex items-center gap-2 text-lg font-black"><Link2 size={18} /> Enlaces cortos</h2>
          <p className="mt-1 text-sm" style={{ color: "var(--t-muted)" }}>
            Direcciones fáciles de dictar o poner en Instagram, por ejemplo <b>{url("/z")}</b>. Imprime su QR una vez y cambia a dónde lleva cuando quieras.
            Si renombras un catálogo, su nombre viejo queda aquí y sigue llevando al catálogo.
          </p>
          {data.links.length > 0 ? <p className="mt-1 text-xs" style={{ color: "var(--t-muted)" }}>{totalHits} visitas en total por estos enlaces.</p> : null}
        </div>
        {canEdit && destinations.length > 0 ? (
          <button type="button" className="btn-soft inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold" onClick={() => setEditing(blank())}>
            <Plus size={16} /> Nuevo enlace
          </button>
        ) : null}
      </div>

      {editing ? (
        <div className="mt-4 grid gap-3 rounded-2xl border p-4 md:grid-cols-2" style={{ borderColor: "var(--t-card-border)" }}>
          <label className="text-xs font-bold">
            Enlace
            <div className="mt-1 flex items-center gap-1">
              <span className="shrink-0 text-xs font-normal" style={{ color: "var(--t-muted)" }}>…/</span>
              <input className={inputCls} style={inputStyle} value={editing.code} placeholder="z" autoCapitalize="none" autoCorrect="off" spellCheck={false}
                onChange={(e) => setEditing({ ...editing, code: e.target.value })} />
            </div>
            <span className="mt-1 block break-all font-normal" style={{ color: "var(--t-muted)" }}>{url(`/${cleanCode(editing.code) || "z"}`)}</span>
          </label>
          <label className="text-xs font-bold">
            Lleva a
            <select className={`${inputCls} mt-1`} style={inputStyle} value={editing.target} onChange={(e) => setEditing({ ...editing, target: e.target.value })}>
              {destinations.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
              {destinations.some((d) => d.value === editing.target) ? null : <option value={editing.target}>{editing.target}</option>}
            </select>
          </label>
          <label className="text-xs font-bold">
            ¿De dónde llegan? <span className="font-normal" style={{ color: "var(--t-muted)" }}>(para saber qué red trae más clientes)</span>
            <select className={`${inputCls} mt-1`} style={inputStyle} value={editing.source} onChange={(e) => setEditing({ ...editing, source: e.target.value })}>
              {SOURCES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <label className="text-xs font-bold">
            Nota interna
            <input className={`${inputCls} mt-1`} style={inputStyle} value={editing.note} maxLength={200} placeholder="Ej. volante de la feria"
              onChange={(e) => setEditing({ ...editing, note: e.target.value })} />
          </label>
          <div className="text-xs font-bold">
            Desde (opcional)
            <DateField className="mt-1" value={editing.starts} onChange={(v) => setEditing({ ...editing, starts: v })} ariaLabel="Desde" />
          </div>
          <div className="text-xs font-bold">
            Hasta (opcional)
            <DateField className="mt-1" value={editing.ends} min={editing.starts || undefined} onChange={(v) => setEditing({ ...editing, ends: v })} ariaLabel="Hasta" />
          </div>
          {editing.starts || editing.ends ? (
            <label className="text-xs font-bold md:col-span-2">
              Fuera de esas fechas lleva a
              <select className={`${inputCls} mt-1`} style={inputStyle} value={editing.fallback} onChange={(e) => setEditing({ ...editing, fallback: e.target.value })}>
                <option value="">🏠 Inicio de la tienda</option>
                {destinations.filter((d) => d.value !== "/").map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
              </select>
            </label>
          ) : null}
          <div className="flex items-end gap-2 md:col-span-2">
            <button type="button" disabled={busy || !cleanCode(editing.code)} onClick={() => void save()}
              className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50" style={{ background: "var(--t-accent)" }}>
              {busy ? <Loader2 size={16} className="animate-spin" /> : null} Guardar
            </button>
            <button type="button" className="btn-soft grid h-10 w-10 place-items-center rounded-xl" aria-label="Cancelar" onClick={() => setEditing(null)}><X size={16} /></button>
          </div>
        </div>
      ) : null}

      {data.links.length > 0 ? (
        <ul className="mt-4 divide-y" style={{ borderColor: "var(--t-card-border)" }}>
          {data.links.map((link) => {
            const dated = Boolean(link.starts_at || link.ends_at);
            const active = !link.now || link.now.split("?")[0] === link.target.split("?")[0];
            return (
              <li key={link.id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="break-all text-sm font-bold">/{link.code} <span className="font-normal" style={{ color: "var(--t-muted)" }}>→ {labelFor(link.target)}</span></p>
                  <p className="text-xs" style={{ color: "var(--t-muted)" }}>
                    {link.kind === "rename" ? "Nombre viejo de un catálogo · " : ""}
                    {link.source ? `Origen: ${SOURCES.find(([v]) => v === link.source)?.[1] ?? link.source} · ` : ""}
                    {link.hits} {link.hits === 1 ? "visita" : "visitas"}
                    {link.note ? ` · ${link.note}` : ""}
                  </p>
                  {dated ? (
                    <p className="mt-0.5 flex items-center gap-1 text-xs" style={{ color: active ? "var(--t-muted)" : "#f59e0b" }}>
                      <CalendarClock size={12} />
                      {link.starts_at ? `Desde ${fmtDay(link.starts_at)} ` : ""}{link.ends_at ? `hasta ${fmtDay(link.ends_at)}` : ""}
                      {active ? "" : ` · hoy lleva a ${labelFor((link.fallback_target ?? "/").split("?")[0])}`}
                    </p>
                  ) : null}
                </div>
                <button type="button" className="btn-soft grid h-9 w-9 place-items-center rounded-xl" aria-label="Copiar" title="Copiar" onClick={() => void copy(link)}><Copy size={15} /></button>
                <button type="button" className="btn-soft grid h-9 w-9 place-items-center rounded-xl" aria-label="Código QR" title="Código QR" onClick={() => setQr(link)}><QrCode size={15} /></button>
                {canEdit ? (
                  <>
                    <button type="button" className="btn-soft grid h-9 w-9 place-items-center rounded-xl" aria-label="Editar" title="Editar"
                      onClick={() => setEditing({
                        id: link.id, code: link.code, target: link.target, fallback: link.fallback_target ?? "", source: link.source ?? "",
                        starts: isoDay(link.starts_at), ends: isoDay(link.ends_at), note: link.note ?? "",
                      })}><Pencil size={15} /></button>
                    <button type="button" className="btn-soft grid h-9 w-9 place-items-center rounded-xl" aria-label="Borrar" title="Borrar" onClick={() => void remove(link)}><Trash2 size={15} /></button>
                  </>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : editing ? null : (
        <p className="mt-4 text-sm" style={{ color: "var(--t-muted)" }}>Aún no tienes enlaces cortos.</p>
      )}

      {data.history.length > 0 ? (
        <p className="mt-4 flex items-start gap-2 text-xs" style={{ color: "var(--t-muted)" }}>
          <History size={14} className="mt-0.5 shrink-0" />
          Nombres anteriores de la tienda que siguen llevando aquí: {data.history.map((h) => h.slug).join(", ")}.
        </p>
      ) : null}

      <QrDialog
        open={Boolean(qr)}
        onClose={() => setQr(null)}
        path={qr ? (SUBDOMAINS ? url(`/${qr.code}`) : `/${data.slug}/${qr.code}`) : "/"}
        title={qr ? `/${qr.code}` : "Enlace"}
        subtitle="Imprímelo una sola vez: si cambias a dónde lleva el enlace, el QR sigue sirviendo."
      />
    </section>
  );
}
