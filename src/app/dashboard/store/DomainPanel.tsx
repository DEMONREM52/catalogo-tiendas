"use client";

import { useCallback, useState } from "react";
import { useRunOnChange } from "../inventario/shared";
import Swal from "sweetalert2";
import { Check, Copy, ExternalLink, Globe, Loader2, RefreshCw, Search, Star, Trash2 } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { PRODUCTION_HOST, PRODUCTION_ORIGIN } from "@/lib/share/origin";

type Dns = { type: string; name: string; value: string; why: string };
type DomainRow = { id: string; domain: string; target: string; status: "pending" | "active" | "error"; status_detail: string | null; dns: Dns[] | null; is_primary: boolean; checked_at: string | null };
type ListResult = { ok: boolean; error?: string; slug: string; domains: DomainRow[] };
type SiteCatalog = { slug: string; name: string; kind: string };
type Site = { ok: boolean; home_target: string; catalogs: SiteCatalog[] };

const swal = { background: "var(--t-bg-base)", color: "var(--t-text)", confirmButtonColor: "#8b5cf6" };
const box = { borderColor: "var(--t-card-border)", background: "color-mix(in oklab, var(--t-card-bg) 92%, transparent)", color: "var(--t-text)" } as const;
const STATUS: Record<DomainRow["status"], [string, string]> = { active: ["✅ Conectado", "#22c55e"], pending: ["⏳ Esperando el DNS", "#f59e0b"], error: ["⛔ Revisar", "#ef4444"] };

async function api(body: Record<string, unknown>) {
  const { data } = await supabaseBrowser().auth.getSession();
  const res = await fetch("/api/store-domains", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session?.access_token ?? ""}` },
    body: JSON.stringify(body),
  });
  return (await res.json().catch(() => ({ ok: false, error: "Sin respuesta" }))) as { ok: boolean; error?: string; automatic?: boolean; status?: string; detail?: string; dns?: Dns[] };
}

function CopyText({ value }: { value: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" onClick={() => void navigator.clipboard.writeText(value).then(() => { setDone(true); window.setTimeout(() => setDone(false), 1200); })}
      className="inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 font-mono text-xs" style={{ borderColor: "var(--t-card-border)" }} title="Copiar">
      {value} {done ? <Check size={12} /> : <Copy size={12} className="opacity-60" />}
    </button>
  );
}

/**
 * Dominio de la tienda: subdominio gratis (tienda.remhub.co), dominio propio y cómo aparecer en Google.
 * Multitienda: cada tienda conecta el suyo; RemHub sabe por el dominio qué catálogo mostrar.
 */
export function DomainPanel({ storeId, storeSlug, storeName, canEdit }: { storeId: string; storeSlug: string; storeName: string; canEdit: boolean }) {
  const [list, setList] = useState<ListResult | null>(null);
  const [missing, setMissing] = useState(false);
  const [domain, setDomain] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  // Qué abre la dirección de la tienda (20261130): un catálogo o la vitrina con todos.
  const [site, setSite] = useState<Site | null>(null);
  const [newTarget, setNewTarget] = useState("");
  const slug = (list?.slug ?? storeSlug).toLowerCase();
  const sub = `${slug}.${PRODUCTION_HOST}`;
  const subdomainsOn = process.env.NEXT_PUBLIC_STORE_SUBDOMAINS === "1";

  const load = useCallback(async () => {
    const { data, error } = await supabaseBrowser().rpc("store_domain_list", { p_store: storeId });
    if (error) { setMissing(/store_domain_list|Could not find the function|schema cache/i.test(error.message)); return; }
    setList(data as ListResult);
    const siteRes = await supabaseBrowser().rpc("store_site_get", { p_store: storeId });
    setSite(siteRes.error ? null : (siteRes.data as Site));
  }, [storeId]);

  const targetOptions = site?.ok ? [{ slug: "inicio", name: "🏪 Vitrina con todos tus catálogos" }, ...site.catalogs.map((c) => ({ slug: c.slug, name: `${c.kind === "wholesale" ? "📦" : c.kind === "retail" ? "🛍️" : "✨"} ${c.name}` }))] : [];
  async function saveTarget(fn: "store_site_save" | "store_domain_set_target", target: string, domainName?: string) {
    setBusy(`target:${domainName ?? "home"}`);
    const { error } = fn === "store_site_save"
      ? await supabaseBrowser().rpc(fn, { p_store: storeId, p_home_target: target })
      : await supabaseBrowser().rpc(fn, { p_store: storeId, p_domain: domainName, p_target: target });
    setBusy(null);
    if (error) return void Swal.fire({ ...swal, icon: "error", title: "No se pudo guardar", text: error.message });
    void Swal.fire({ ...swal, icon: "success", title: "Guardado", text: "Puede tardar hasta un minuto en verse.", timer: 1800, showConfirmButton: false });
    await load();
  }
  useRunOnChange(load);

  async function run(action: string, d: string, ok?: string) {
    setBusy(`${action}:${d}`);
    const r = await api({ store_id: storeId, action, domain: d, ...(action === "add" && newTarget ? { target: newTarget } : {}) });
    setBusy(null);
    if (!r.ok) return void Swal.fire({ ...swal, icon: "error", title: "No se pudo", text: r.error });
    if (ok) void Swal.fire({ ...swal, icon: r.status === "active" ? "success" : "info", title: ok, text: r.detail ?? undefined, timer: 2200, showConfirmButton: false });
    if (action === "add") setDomain("");
    await load();
  }

  if (missing) {
    return <p className="rounded-2xl border p-3 text-xs" style={{ borderColor: "var(--t-card-border)", color: "var(--t-muted)" }}>🌐 Para conectar dominios ejecuta en Supabase la migración 20261129_dominios_tiendas.sql.</p>;
  }

  const catalogUrl = list?.domains.find((d) => d.status === "active" && d.is_primary)?.domain;
  const publicUrl = catalogUrl ? `https://${catalogUrl}` : subdomainsOn ? `https://${sub}` : `${PRODUCTION_ORIGIN}/${slug}/detal`;

  return (
    <section className="space-y-4 rounded-3xl border p-4 sm:p-5" style={{ borderColor: "var(--t-card-border)" }}>
      <div>
        <h3 className="flex items-center gap-2 text-base font-black"><Globe size={18} /> Dominio y Google</h3>
        <p className="mt-0.5 text-xs" style={{ color: "var(--t-muted)" }}>La dirección de tu catálogo y cómo te encuentran en internet.</p>
      </div>

      {/* Dirección actual */}
      <div className="rounded-2xl border p-3" style={box}>
        <p className="text-xs font-bold" style={{ color: "var(--t-muted)" }}>Tu catálogo está en</p>
        <a href={publicUrl} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1.5 break-all text-sm font-black underline">{publicUrl.replace(/^https:\/\//, "")} <ExternalLink size={13} /></a>
        <p className="mt-2 text-xs" style={{ color: "var(--t-muted)" }}>
          {subdomainsOn ? <>También funciona gratis: <CopyText value={sub} /></> : <>Pronto también: <b>{sub}</b> (gratis para cada tienda).</>}
        </p>
        {targetOptions.length ? (
          <label className="mt-3 block text-xs font-bold">
            ¿Qué se abre al entrar?
            <select disabled={!canEdit || !!busy} value={site?.home_target ?? "detal"} onChange={(e) => void saveTarget("store_site_save", e.target.value)}
              className="mt-1 block w-full rounded-xl border px-3 py-2 text-sm font-normal" style={box}>
              {targetOptions.map((o) => <option key={o.slug} value={o.slug}>{o.name}</option>)}
            </select>
            <span className="mt-1 block font-normal" style={{ color: "var(--t-muted)" }}>Los demás catálogos siguen abriendo con su nombre al final (ej. <b>/{site?.catalogs.find((c) => c.slug !== (site?.home_target ?? ""))?.slug ?? "mayor"}</b>) y la vitrina siempre en <b>/inicio</b>.</span>
          </label>
        ) : null}
      </div>

      {/* Dominio propio */}
      <div className="rounded-2xl border p-3" style={box}>
        <p className="text-sm font-bold">Tu propio dominio</p>
        <p className="mb-2 text-xs" style={{ color: "var(--t-muted)" }}>Ej.: <b>catalogo.{slug}.com</b> o <b>{slug}.com</b>. Compra el dominio donde quieras (GoDaddy, Hostinger, .CO…) y conéctalo aquí.</p>
        {(list?.domains ?? []).map((d) => {
          const [label, color] = STATUS[d.status];
          return (
            <div key={d.id} className="mb-2 rounded-xl border p-3 text-sm" style={{ borderColor: d.status === "active" ? "color-mix(in oklab, #22c55e 45%, transparent)" : "var(--t-card-border)" }}>
              <div className="flex flex-wrap items-center gap-2">
                <a href={`https://${d.domain}`} target="_blank" rel="noreferrer" className="font-black underline">{d.domain}</a>
                <span className="rounded-full px-2 py-0.5 text-[11px] font-bold" style={{ background: `color-mix(in oklab, ${color} 16%, transparent)`, color }}>{label}</span>
                {d.is_primary ? <span className="text-[11px] font-bold" style={{ color: "var(--t-accent)" }}>★ Principal (el que ve Google)</span> : null}
                {targetOptions.length ? (
                  <select disabled={!canEdit || !!busy} value={d.target} onChange={(e) => void saveTarget("store_domain_set_target", e.target.value, d.domain)}
                    className="rounded-lg border px-2 py-1 text-xs" style={box} aria-label="Catálogo que abre este dominio">
                    {targetOptions.map((o) => <option key={o.slug} value={o.slug}>Abre: {o.name}</option>)}
                  </select>
                ) : null}
                <span className="ml-auto flex gap-1.5">
                  <button type="button" disabled={!!busy} onClick={() => void run("check", d.domain, "Revisado")} className="inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs font-semibold" style={{ borderColor: "var(--t-card-border)" }}>
                    {busy === `check:${d.domain}` ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Revisar
                  </button>
                  {!d.is_primary && canEdit ? <button type="button" disabled={!!busy} onClick={() => void run("primary", d.domain, "Ahora es el principal")} className="rounded-lg border px-2 py-1 text-xs" style={{ borderColor: "var(--t-card-border)" }} title="Hacer principal"><Star size={12} /></button> : null}
                  {canEdit ? <button type="button" disabled={!!busy} onClick={() => void Swal.fire({ ...swal, icon: "warning", title: `Quitar ${d.domain}`, text: "Ese dominio dejará de abrir tu catálogo.", showCancelButton: true, confirmButtonText: "Quitar", cancelButtonText: "Cancelar", confirmButtonColor: "#ef4444" }).then((r) => { if (r.isConfirmed) void run("remove", d.domain, "Dominio quitado"); })} className="rounded-lg border px-2 py-1 text-xs" style={{ borderColor: "var(--t-card-border)", color: "#ef4444" }} title="Quitar"><Trash2 size={12} /></button> : null}
                </span>
              </div>
              {d.status !== "active" ? (
                <div className="mt-2 text-xs">
                  <p style={{ color: "var(--t-muted)" }}>{d.status_detail === "manual" ? "Crea estos registros en el panel de tu dominio. Luego avísale a RemHub para activarlo." : `${d.status_detail ?? "Crea estos registros en el panel de tu dominio"} · luego toca «Revisar» (el DNS puede tardar de minutos a unas horas).`}</p>
                  <div className="mt-2 overflow-x-auto rounded-lg border" style={{ borderColor: "var(--t-card-border)" }}>
                    <table className="w-full min-w-[460px]">
                      <thead style={{ color: "var(--t-muted)" }}><tr><th className="px-2 py-1 text-left">Tipo</th><th className="px-2 py-1 text-left">Nombre</th><th className="px-2 py-1 text-left">Valor</th><th className="px-2 py-1 text-left">Para qué</th></tr></thead>
                      <tbody>
                        {(d.dns ?? []).map((r, i) => (
                          <tr key={i} className="border-t" style={{ borderColor: "var(--t-card-border)" }}>
                            <td className="px-2 py-1 font-bold">{r.type}</td><td className="px-2 py-1"><CopyText value={r.name} /></td><td className="px-2 py-1"><CopyText value={r.value} /></td><td className="px-2 py-1" style={{ color: "var(--t-muted)" }}>{r.why}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
        {canEdit ? (
          <form className="flex flex-col gap-2 sm:flex-row" onSubmit={(e) => { e.preventDefault(); if (domain.trim()) void run("add", domain.trim(), "Dominio agregado"); }}>
            <input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder={`catalogo.${slug}.com`} className="min-w-0 flex-1 rounded-xl border px-3 py-2 text-sm outline-none" style={box} />
            {targetOptions.length ? (
              <select value={newTarget || site?.home_target || "detal"} onChange={(e) => setNewTarget(e.target.value)} className="rounded-xl border px-3 py-2 text-sm" style={box} aria-label="Catálogo que abre">
                {targetOptions.map((o) => <option key={o.slug} value={o.slug}>Abre: {o.name}</option>)}
              </select>
            ) : null}
            <button type="submit" disabled={!!busy || !domain.trim()} className="rounded-xl px-4 py-2 text-sm font-bold text-white disabled:opacity-50" style={{ background: "linear-gradient(135deg, var(--t-accent), var(--t-accent2, var(--t-accent)))" }}>
              {busy?.startsWith("add") ? "Conectando…" : "Conectar dominio"}
            </button>
          </form>
        ) : null}
      </div>

      {/* Google */}
      <div className="rounded-2xl border p-3" style={box}>
        <p className="flex items-center gap-1.5 text-sm font-bold"><Search size={15} /> Así te puede ver Google</p>
        <div className="mt-2 rounded-xl border bg-white p-3 text-left" style={{ borderColor: "#e5e7eb" }}>
          <p className="truncate text-xs" style={{ color: "#202124" }}>{publicUrl.replace(/^https:\/\//, "")}</p>
          <p className="truncate text-base" style={{ color: "#1a0dab" }}>{storeName} · Catálogo y precios</p>
          <p className="line-clamp-2 text-xs" style={{ color: "#4d5156" }}>Catálogo online de {storeName}. Mira productos, precios y realiza pedidos por WhatsApp.</p>
        </div>
        <ol className="mt-3 list-decimal space-y-1 pl-5 text-xs" style={{ color: "var(--t-muted)" }}>
          <li>RemHub ya le da a Google el mapa de tu catálogo (<b>/sitemap.xml</b>) y la ficha de cada producto con foto y precio.</li>
          <li>Entra a <a className="underline" href="https://search.google.com/search-console" target="_blank" rel="noreferrer">Google Search Console</a>, verifícalo con el código (abajo, en «Aparecer en Google») y envía <b>{publicUrl.replace(/\/$/, "")}/sitemap.xml</b>. Así Google lo encuentra en días, no en semanas.</li>
          <li>Crea tu ficha gratis en <a className="underline" href="https://business.google.com" target="_blank" rel="noreferrer">Google Business</a> con el enlace de tu catálogo: es lo que aparece en Maps y al buscar tu negocio por nombre.</li>
          <li>Productos con buena foto, nombre claro y descripción aparecen mejor. Compartir el enlace en Instagram, Facebook y WhatsApp también ayuda.</li>
        </ol>
      </div>
    </section>
  );
}
