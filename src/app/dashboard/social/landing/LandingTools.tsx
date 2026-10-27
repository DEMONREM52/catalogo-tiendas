"use client";

import { useEffect, useMemo, useState } from "react";
import Swal from "sweetalert2";
import { ArrowLeft, Check, Copy, ExternalLink, MessageCircle, QrCode, RefreshCw } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { fiscalApi } from "@/lib/fiscal/client";
import { QrDialog } from "@/components/pwa/QrDialog";
import { normalizeLanding, type LandingConfig } from "@/lib/landing/config";
import { AD_CHANNELS, adCopies, trackedLink } from "@/lib/landing/templates";
import { landingInsights, type LandingTotals, type SourceRow } from "@/lib/landing/insights";
import { DateField } from "@/components/forms/Fields";
import { Pill, Section, errorText, inputCls, inputStyle, money, softBox, swalTheme } from "../catalogs/ui";

type Lead = { id: string; name: string | null; whatsapp: string; city: string | null; selection: string | null; status: string; at: string };
export type Money = { visits: number; wa_people: number; wa_clicks: number; shares: number; engaged: number; orders: number; confirmed: number; revenue: number; revenue_confirmed?: number; spend: number; cost: number | null; profit: number | null; roas: number | null; cpa: number | null };
type Spend = { id: string; day: string; channel: string; amount: number; note: string | null };
type Stats = { money: Money; spend: Spend[]; totals: LandingTotals; by_day: Array<{ day: string; visits: number; orders: number; revenue: number }>; by_source: SourceRow[]; leads: Lead[] };

async function copy(text: string) {
  try { await navigator.clipboard.writeText(text); return true; } catch { window.prompt("Copia:", text); return false; }
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl border p-3" style={softBox}>
      <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--t-muted)" }}>{label}</p>
      <p className="mt-0.5 text-xl font-black tabular-nums">{value}</p>
      {hint ? <p className="text-[11px]" style={{ color: "var(--t-muted)" }}>{hint}</p> : null}
    </div>
  );
}

const pct = (a: number, b: number) => (b > 0 ? `${((a / b) * 100).toFixed(1).replace(".", ",")} %` : "—");

export function LandingStats({ storeId, page, config, onBack, url }: { storeId: string; page: { id: string; name: string }; config: unknown; onBack: () => void; url: string }) {
  const [days, setDays] = useState(30);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const cfg = useMemo(() => normalizeLanding(config), [config]);

  async function load() {
    setLoading(true);
    const { data, error } = await supabaseBrowser().rpc("erp_landing_stats", { p_store: storeId, p_id: page.id, p_days: days });
    setLoading(false);
    if (error || !(data as { ok?: boolean })?.ok) { void Swal.fire({ icon: "error", title: "No se pudieron leer las estadísticas", text: error?.message ?? (data as { message?: string })?.message, ...swalTheme }); return; }
    setStats(data as Stats);
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [days, page.id]);

  async function mark(lead: Lead, status: "contacted" | "discarded") {
    await supabaseBrowser().rpc("erp_landing_lead_mark", { p_store: storeId, p_lead: lead.id, p_status: status });
    setStats((s) => (s ? { ...s, leads: status === "discarded" ? s.leads.filter((l) => l.id !== lead.id) : s.leads.map((l) => (l.id === lead.id ? { ...l, status } : l)) } : s));
  }

  const t = stats?.totals;
  const openLeads = stats?.leads.filter((l) => l.status === "open").length ?? 0;
  const tips = t ? landingInsights(t, stats!.by_source, { upsellOn: cfg.upsell.enabled, openLeads }) : [];
  const funnel = t ? [
    ["Entraron", t.visits], ["Bajaron a ver más", t.scroll50], ["Tocaron «Comprar»", t.form], ["Empezaron a llenar", t.started], ["Hicieron el pedido", t.orders],
  ] as const : [];
  const maxDay = Math.max(1, ...(stats?.by_day.map((d) => d.visits) ?? [1]));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={onBack} className="inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold" style={softBox}><ArrowLeft size={15} /> Volver</button>
        <h2 className="min-w-0 flex-1 truncate text-lg font-black">📊 {page.name}</h2>
        <select value={days} onChange={(e) => setDays(Number(e.target.value))} className={`${inputCls} w-auto`} style={inputStyle}>
          {[1, 7, 30, 90].map((d) => <option key={d} value={d}>{d === 1 ? "Hoy" : `Últimos ${d} días`}</option>)}
        </select>
        <button type="button" onClick={() => void load()} className="grid h-10 w-10 place-items-center rounded-xl border" style={softBox} title="Actualizar"><RefreshCw size={15} className={loading ? "animate-spin" : ""} /></button>
        <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold" style={softBox}><ExternalLink size={15} /> Abrir</a>
      </div>

      {t ? (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <Kpi label="Viendo ahora" value={`${t.live}`} hint="en este momento" />
            <Kpi label="Visitas" value={t.visits.toLocaleString("es-CO")} />
            <Kpi label="Pedidos" value={t.orders.toLocaleString("es-CO")} hint={`${t.units} unidades`} />
            <Kpi label="Conversión" value={pct(t.orders, t.visits)} hint="visitas que compran" />
            <Kpi label="Ventas" value={money(t.revenue)} hint={t.orders ? `ticket ${money(t.revenue / t.orders)}` : undefined} />
            <Kpi label="Tiempo promedio" value={`${t.avg_seconds} s`} hint={`${pct(t.mobile, t.visits)} en celular`} />
          </div>

          <Section title="¿Está dejando plata?" hint="Ventas de esta landing − costo de la mercancía − inversión en pauta" icon={<span>💰</span>}>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Kpi label="Ventas" value={money(stats!.money.revenue)} hint={`${stats!.money.confirmed} confirmados`} />
              <Kpi label="Inversión en pauta" value={money(stats!.money.spend)} hint={stats!.money.cpa ? `${money(stats!.money.cpa)} por pedido` : undefined} />
              <Kpi label="Costo mercancía" value={stats!.money.cost === null ? "🔒" : money(stats!.money.cost)} hint={stats!.money.cost === null ? "Necesitas ver costos" : undefined} />
              <Kpi label="Ganancia" value={stats!.money.profit === null ? "🔒" : money(stats!.money.profit)} hint={stats!.money.roas ? `Retorno ${String(stats!.money.roas).replace(".", ",")}x la pauta` : undefined} />
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Kpi label="Escribieron por WhatsApp" value={`${stats!.money.wa_people}`} hint={`${stats!.money.wa_clicks} clics`} />
              <Kpi label="Interactuaron" value={`${stats!.money.engaged}`} hint={`${pct(stats!.money.engaged, stats!.money.visits)} de las visitas`} />
              <Kpi label="Compartieron" value={`${stats!.money.shares}`} />
              <Kpi label="Por recuperar" value={`${openLeads}`} hint="dejaron su WhatsApp" />
            </div>
            {stats!.money.profit !== null && stats!.money.spend > 0 ? (
              <p className="mt-3 rounded-2xl p-3 text-sm font-semibold" style={{ background: Number(stats!.money.profit) > 0 ? "color-mix(in oklab, #16a34a 14%, transparent)" : "color-mix(in oklab, #ef4444 14%, transparent)" }}>
                {Number(stats!.money.profit) > 0 ? `✅ Por cada $1.000 de pauta vuelven ${money(Number(stats!.money.roas ?? 0) * 1000)} en ventas y te quedan ${money(Number(stats!.money.profit))} de ganancia.` : "⚠️ La pauta está costando más de lo que deja. Revisa los consejos de abajo antes de invertir más."}
              </p>
            ) : null}
            <SpendBox storeId={storeId} pageId={page.id} rows={stats!.spend} onChange={() => void load()} />
          </Section>

          <Section title="¿En qué mejoro?" hint="Consejos según lo que hacen tus visitas" icon={<span>💡</span>}>
            <div className="space-y-2">
              {tips.map((tip, i) => (
                <div key={i} className="rounded-2xl border p-3" style={{ ...softBox, borderColor: tip.tone === "bad" ? "rgba(239,68,68,.5)" : tip.tone === "warn" ? "rgba(245,158,11,.5)" : tip.tone === "good" ? "rgba(22,163,74,.5)" : "var(--t-card-border)" }}>
                  <p className="text-sm font-bold">{tip.tone === "bad" ? "🔴" : tip.tone === "warn" ? "🟠" : tip.tone === "good" ? "🟢" : "🔵"} {tip.title}</p>
                  <p className="mt-0.5 text-sm" style={{ color: "var(--t-muted)" }}>{tip.text}</p>
                </div>
              ))}
            </div>
          </Section>

          <div className="grid gap-4 lg:grid-cols-2">
            <Section title="Embudo de compra" hint="Dónde se quedan las personas" icon={<span>🔻</span>}>
              <div className="space-y-2">
                {funnel.map(([label, n], i) => (
                  <div key={label}>
                    <div className="flex justify-between text-xs font-semibold"><span>{label}</span><span>{n.toLocaleString("es-CO")} {i ? <span style={{ color: "var(--t-muted)" }}>· {pct(n, funnel[i - 1][1])} del paso anterior</span> : null}</span></div>
                    <div className="mt-1 h-3 overflow-hidden rounded-full" style={{ background: "color-mix(in oklab, var(--t-text) 8%, transparent)" }}>
                      <div className="h-full rounded-full" style={{ width: `${t.visits ? Math.max(2, (n / t.visits) * 100) : 0}%`, background: "var(--t-cta)" }} />
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <Pill>💵 Contraentrega {t.cod}</Pill><Pill>💳 En línea {t.online}</Pill><Pill>🗓️ Addi {t.addi}</Pill><Pill>➕ Adicionales {t.upsells}</Pill><Pill tone="good">✅ Confirmados {t.confirmed}</Pill>
              </div>
            </Section>

            <Section title="¿De dónde vienen?" hint="Visitas y pedidos por fuente (utm, Facebook, Instagram, TikTok…)" icon={<span>📣</span>}>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-xs" style={{ color: "var(--t-muted)" }}><th className="py-1">Fuente</th><th>Visitas</th><th>Compran</th><th>Pedidos</th><th>Tiempo</th></tr></thead>
                  <tbody>
                    {stats!.by_source.map((s) => (
                      <tr key={s.source} className="border-t" style={{ borderColor: "var(--t-card-border)" }}>
                        <td className="py-1.5 font-semibold capitalize">{s.source}</td><td>{s.visits}</td><td>{pct(s.orders, s.visits)}</td><td>{s.orders}</td><td>{s.avg_seconds} s</td>
                      </tr>
                    ))}
                    {!stats!.by_source.length ? <tr><td colSpan={5} className="py-3 text-center text-xs" style={{ color: "var(--t-muted)" }}>Aún no hay visitas.</td></tr> : null}
                  </tbody>
                </table>
              </div>
            </Section>
          </div>

          {stats!.by_day.length > 1 ? (
            <Section title="Día a día" icon={<span>📅</span>}>
              <div className="flex h-36 items-end gap-1">
                {stats!.by_day.map((d) => (
                  <div key={d.day} className="group relative flex flex-1 flex-col items-center justify-end" title={`${d.day.slice(8, 10)}/${d.day.slice(5, 7)}: ${d.visits} visitas · ${d.orders} pedidos · ${money(d.revenue)}`}>
                    <div className="w-full rounded-t" style={{ height: `${(d.visits / maxDay) * 100}%`, minHeight: d.visits ? 3 : 0, background: "color-mix(in oklab, var(--t-accent) 35%, transparent)" }} />
                    {d.orders ? <span className="absolute -top-4 text-[10px] font-black">{d.orders}</span> : null}
                  </div>
                ))}
              </div>
              <p className="mt-1 text-[11px]" style={{ color: "var(--t-muted)" }}>Barras: visitas por día. Número arriba: pedidos.</p>
            </Section>
          ) : null}

          <Section title={`Clientes por recuperar (${openLeads})`} hint="Dejaron su WhatsApp pero no terminaron el pedido. Escríbeles hoy: es la venta más barata." icon={<span>📲</span>}>
            {stats!.leads.length ? (
              <div className="space-y-2">
                {stats!.leads.map((l) => {
                  const first = (l.name ?? "").trim().split(/\s+/)[0];
                  const msg = `Hola${first ? ` ${first}` : ""} 👋 Vimos que estabas pidiendo ${page.name}${l.selection ? ` (${l.selection})` : ""}. ¿Te ayudamos a terminar tu pedido? Te lo enviamos y pagas al recibir 🚚\n${url}`;
                  return (
                    <div key={l.id} className="flex flex-wrap items-center gap-2 rounded-2xl border p-3" style={softBox}>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-bold">{l.name || "Sin nombre"} · {l.whatsapp}{l.city ? ` · ${l.city}` : ""}</p>
                        <p className="text-xs" style={{ color: "var(--t-muted)" }}>{l.selection || "—"} · {new Date(l.at).toLocaleString("es-CO", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</p>
                      </div>
                      {l.status === "contacted" ? <Pill tone="good"><Check size={12} /> Contactado</Pill> : null}
                      <a href={`https://wa.me/57${l.whatsapp}?text=${encodeURIComponent(msg)}`} target="_blank" rel="noopener noreferrer" onClick={() => void mark(l, "contacted")} className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-500 px-3 py-2 text-xs font-bold text-white"><MessageCircle size={14} /> Escribir</a>
                      <button type="button" onClick={() => void mark(l, "discarded")} className="rounded-xl border px-3 py-2 text-xs font-semibold" style={softBox}>Descartar</button>
                    </div>
                  );
                })}
              </div>
            ) : <p className="text-sm" style={{ color: "var(--t-muted)" }}>Nadie pendiente. 🎉</p>}
          </Section>
        </>
      ) : <p className="py-10 text-center text-sm" style={{ color: "var(--t-muted)" }}>{loading ? "Cargando…" : "Sin datos."}</p>}
    </div>
  );
}

const CHANNELS: Array<[string, string]> = [["facebook", "📘 Facebook / Instagram"], ["tiktok", "🎵 TikTok"], ["google", "🔎 Google"], ["influencer", "⭐ Influenciador"], ["otro", "Otro"]];
const today = () => new Date(Date.now() - 5 * 3600_000).toISOString().slice(0, 10);

/** Inversión en pauta: lo que gastas por día en anuncios (con esto sale la ganancia real). */
function SpendBox({ storeId, pageId, rows, onChange }: { storeId: string; pageId: string; rows: Spend[]; onChange: () => void }) {
  const [day, setDay] = useState(today());
  const [amount, setAmount] = useState("");
  const [channel, setChannel] = useState("facebook");
  const [busy, setBusy] = useState(false);
  async function add() {
    const n = Number(amount.replace(/\D/g, ""));
    if (!n) return;
    setBusy(true);
    const { data, error } = await supabaseBrowser().rpc("erp_landing_spend_save", { p_store: storeId, p_page: pageId, p_day: day, p_amount: n, p_channel: channel, p_note: null });
    setBusy(false);
    if (error || !(data as { ok?: boolean })?.ok) { void Swal.fire({ icon: "error", title: "No se pudo anotar", text: error?.message ?? (data as { message?: string })?.message, ...swalTheme }); return; }
    setAmount("");
    onChange();
  }
  async function remove(id: string) {
    await supabaseBrowser().rpc("erp_landing_spend_delete", { p_store: storeId, p_id: id });
    onChange();
  }
  return (
    <div className="mt-4 rounded-2xl border p-3" style={softBox}>
      <p className="text-sm font-bold">📣 Anotar inversión en pauta</p>
      <p className="text-xs" style={{ color: "var(--t-muted)" }}>Lo que gastaste ese día en anuncios de esta landing (míralo en el Administrador de anuncios).</p>
      <div className="mt-2 grid gap-2 sm:grid-cols-[150px_1fr_1fr_auto]">
        <DateField value={day} max={today()} onChange={(v) => setDay(v || today())} />
        <input inputMode="numeric" value={amount ? Number(amount.replace(/\D/g, "")).toLocaleString("es-CO") : ""} onChange={(e) => setAmount(e.target.value)} placeholder="$ valor" className={inputCls} style={inputStyle} />
        <select value={channel} onChange={(e) => setChannel(e.target.value)} className={inputCls} style={inputStyle}>{CHANNELS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <button type="button" disabled={busy || !amount} onClick={() => void add()} className="rounded-xl px-4 py-2 text-sm font-bold text-white disabled:opacity-50" style={{ background: "var(--t-cta)" }}>Anotar</button>
      </div>
      {rows.length ? (
        <div className="mt-2 max-h-48 space-y-1 overflow-y-auto">
          {rows.map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-2 text-xs">
              <span>{r.day.split("-").reverse().join("/")} · {CHANNELS.find((c) => c[0] === r.channel)?.[1] ?? r.channel}</span>
              <span className="flex items-center gap-2 font-bold">{money(r.amount)}<button type="button" onClick={() => void remove(r.id)} className="text-red-500" title="Borrar">✕</button></span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Resultados de todas las landings juntas: el negocio de la pauta por aparte. */
export function LandingSummary({ storeId, onOpen }: { storeId: string; onOpen: (id: string) => void }) {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<{ costs: boolean; totals: Money; items: Array<Money & { id: string; name: string; status: string }> } | null>(null);
  useEffect(() => {
    void supabaseBrowser().rpc("erp_landing_summary", { p_store: storeId, p_days: days }).then(({ data: d }) => {
      if ((d as { ok?: boolean })?.ok) setData(d as typeof data);
    });
  }, [storeId, days]);
  if (!data) return null;
  const t = data.totals;
  const roas = t.spend > 0 ? t.revenue / t.spend : null;
  return (
    <Section title="Resultados de tus landings" hint="Todo lo de la pauta, por aparte del resto de la tienda" icon={<span>📊</span>}
      actions={<select value={days} onChange={(e) => setDays(Number(e.target.value))} className={`${inputCls} w-auto`} style={inputStyle}>{[7, 30, 90, 365].map((d) => <option key={d} value={d}>Últimos {d} días</option>)}</select>}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
        <Kpi label="Entraron" value={Number(t.visits).toLocaleString("es-CO")} />
        <Kpi label="Interactuaron" value={Number(t.engaged).toLocaleString("es-CO")} hint={pct(t.engaged, t.visits)} />
        <Kpi label="WhatsApp" value={Number(t.wa_people).toLocaleString("es-CO")} hint="personas que escribieron" />
        <Kpi label="Pedidos" value={Number(t.orders).toLocaleString("es-CO")} hint={`conversión ${pct(t.orders, t.visits)}`} />
        <Kpi label="Ventas" value={money(t.revenue)} />
        <Kpi label="Pauta" value={money(t.spend)} hint={roas ? `retorno ${roas.toFixed(1).replace(".", ",")}x` : undefined} />
        <Kpi label="Costo" value={data.costs ? money(t.cost) : "🔒"} />
        <Kpi label="Ganancia" value={data.costs ? money(t.profit) : "🔒"} />
      </div>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead><tr className="text-left text-xs" style={{ color: "var(--t-muted)" }}><th className="py-1">Landing</th><th>Visitas</th><th>WhatsApp</th><th>Pedidos</th><th>Ventas</th><th>Pauta</th><th>Retorno</th><th>Ganancia</th></tr></thead>
          <tbody>
            {data.items.map((r) => (
              <tr key={r.id} className="cursor-pointer border-t hover:opacity-80" style={{ borderColor: "var(--t-card-border)" }} onClick={() => onOpen(r.id)}>
                <td className="py-1.5 font-semibold">{r.name}</td><td>{r.visits}</td><td>{r.wa_people}</td><td>{r.orders}</td><td>{money(r.revenue)}</td><td>{money(r.spend)}</td>
                <td>{r.roas ? `${String(r.roas).replace(".", ",")}x` : "—"}</td>
                <td className="font-bold" style={{ color: r.profit === null ? undefined : Number(r.profit) >= 0 ? "#16a34a" : "#ef4444" }}>{r.profit === null ? "🔒" : money(r.profit)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

export function AdKit({ page, config, url, price, onBack }: { page: { name: string; slug: string }; config: LandingConfig; url: string; price: number | null; onBack: () => void }) {
  const [campaign, setCampaign] = useState(() => `${page.slug}-${new Date().toISOString().slice(0, 7)}`);
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState("");
  const bundleMax = Math.max(0, ...config.bundles.map((b) => b.pct));
  const ends = config.promo_ends_at ? new Date(Date.parse(config.promo_ends_at) - 5 * 3600_000).toISOString().slice(0, 10).split("-").reverse().join("/") : null;
  const ads = adCopies({ product: page.name, price: price ? money(price) : "", before: config.compare_at_price ? money(config.compare_at_price) : null, bundlePct: bundleMax, cod: config.payments.cod, freeShipping: config.shipping.free, endsAt: ends });
  const doCopy = async (key: string, text: string) => { await copy(text); setCopied(key); window.setTimeout(() => setCopied(""), 1500); };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={onBack} className="inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold" style={softBox}><ArrowLeft size={15} /> Volver</button>
        <h2 className="min-w-0 flex-1 truncate text-lg font-black">🚀 Kit de pauta · {page.name}</h2>
      </div>

      <Section title="1. Enlaces con seguimiento" hint="Usa uno distinto en cada red: así sabes cuál vende más (sale en las estadísticas)" icon={<span>🔗</span>}>
        <label className="block text-xs font-semibold" style={{ color: "var(--t-muted)" }}>Nombre de la campaña
          <input value={campaign} onChange={(e) => setCampaign(e.target.value)} className={`${inputCls} mt-1`} style={inputStyle} />
        </label>
        <div className="mt-3 space-y-2">
          {AD_CHANNELS.map((ch) => {
            const link = trackedLink(url, ch, campaign);
            return (
              <div key={ch.key} className="flex items-center gap-2 rounded-2xl border p-2.5" style={softBox}>
                <span className="text-xl">{ch.emoji}</span>
                <div className="min-w-0 flex-1"><p className="text-sm font-bold">{ch.name}</p><p className="truncate text-[11px]" style={{ color: "var(--t-muted)" }}>{link}</p></div>
                <button type="button" onClick={() => void doCopy(ch.key, link)} className="inline-flex items-center gap-1 rounded-xl border px-2.5 py-1.5 text-xs font-semibold" style={softBox}>{copied === ch.key ? <Check size={13} /> : <Copy size={13} />} Copiar</button>
                <button type="button" onClick={() => setQr(link)} className="grid h-8 w-8 place-items-center rounded-xl border" style={softBox} title="Código QR"><QrCode size={14} /></button>
              </div>
            );
          })}
        </div>
      </Section>

      <Section title="2. Textos para tus anuncios" hint="Listos para pegar. Solo usan datos reales de tu landing" icon={<span>✍️</span>}>
        <div className="grid gap-2 md:grid-cols-2">
          {ads.map((a, i) => (
            <div key={i} className="rounded-2xl border p-3" style={softBox}>
              <div className="flex items-center justify-between gap-2"><p className="text-sm font-bold">{a.title}</p>
                <button type="button" onClick={() => void doCopy(`ad${i}`, a.text)} className="inline-flex items-center gap-1 rounded-xl border px-2.5 py-1 text-xs font-semibold" style={softBox}>{copied === `ad${i}` ? <Check size={13} /> : <Copy size={13} />} Copiar</button>
              </div>
              <p className="mt-2 whitespace-pre-line text-sm">{a.text}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section title="3. Cómo montar la campaña en Meta (Facebook e Instagram)" icon={<span>📘</span>}>
        <ol className="list-decimal space-y-1.5 pl-5 text-sm">
          <li>Pon el píxel de tu tienda en <b>Mi tienda → Marketing</b>. Para que Meta reciba también los pedidos desde el servidor (más exacto), conecta el token aquí abajo.</li>
          <li>En el Administrador de anuncios crea una campaña de <b>Ventas</b> y elige el píxel. Evento de conversión: <b>Compra</b> (o «Cliente potencial» si así lo configuraste).</li>
          <li>Pega el enlace de <b>Facebook</b> o <b>Instagram</b> de arriba como URL del sitio web.</li>
          <li>Usa 3 a 5 videos o fotos distintas del producto en uso, con el texto «Oferta directa» o «Problema → solución».</li>
          <li>Empieza con poco presupuesto diario por 3 a 4 días. Mira aquí qué fuente convierte más y mueve el dinero ahí.</li>
          <li>Confirma cada pedido por WhatsApp rápido y escríbele a los «Clientes por recuperar».</li>
        </ol>
      </Section>

      <Section title="4. TikTok, WhatsApp e influenciadores" icon={<span>🎵</span>}>
        <ul className="list-disc space-y-1.5 pl-5 text-sm">
          <li><b>TikTok Ads:</b> pon el ID de tu píxel de TikTok en el editor de la landing (Píxeles propios). Los pedidos llegan como «Realizar pedido».</li>
          <li><b>Estados de WhatsApp:</b> sube el video del producto con el texto de WhatsApp y el enlace de «Estados y grupos».</li>
          <li><b>Influenciadores:</b> dale su propio enlace («Influenciador», cambiando el nombre de la campaña por el de la persona) y mira cuánto vende cada uno.</li>
          <li><b>Tienda física:</b> imprime el QR y ponlo en la vitrina o en las bolsas.</li>
        </ul>
      </Section>

      <QrDialog open={Boolean(qr)} onClose={() => setQr(null)} path={qr ?? ""} title={page.name} subtitle="Escanea para ver la oferta" />
    </div>
  );
}

export function MetaConnect({ storeId }: { storeId: string }) {
  const [status, setStatus] = useState<{ configured: boolean; test_code: string | null; last_ok_at: string | null; last_error: string | null; is_owner: boolean } | null>(null);
  const [token, setToken] = useState("");
  const [testCode, setTestCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [pixel, setPixel] = useState<string | null>(null);

  async function load() {
    const sb = supabaseBrowser();
    const [{ data }, { data: tr }] = await Promise.all([
      sb.rpc("erp_meta_capi_status", { p_store: storeId }),
      sb.from("store_tracking").select("meta_pixel_id,meta_enabled").eq("store_id", storeId).maybeSingle(),
    ]);
    const s = data as typeof status & { ok?: boolean };
    if (s?.ok) { setStatus(s); setTestCode(s.test_code ?? ""); }
    setPixel((tr as { meta_pixel_id?: string } | null)?.meta_pixel_id || null);
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [storeId]);

  async function act(action: "save" | "clear" | "test") {
    setBusy(true);
    try {
      const r = await fiscalApi<{ received?: number }>("/api/landing/meta", { store_id: storeId, action, token: action === "save" ? token : undefined, test_code: testCode });
      if (action === "test") void Swal.fire({ icon: "success", title: "¡Meta recibió la prueba!", text: `Revisa en el Administrador de eventos → Probar eventos${testCode ? ` (código ${testCode})` : ""}.`, ...swalTheme });
      else void Swal.fire({ icon: "success", title: action === "save" ? "Guardado y cifrado 🔒" : "Token quitado", timer: 1500, showConfirmButton: false, ...swalTheme });
      void r;
      setToken("");
      await load();
    } catch (e) {
      void Swal.fire({ icon: "error", title: "No se pudo", text: errorText(e), ...swalTheme });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="Meta: API de Conversiones" hint="Los pedidos llegan a Meta desde el servidor, aunque el cliente tenga bloqueador o iPhone. Meta optimiza mejor tus anuncios." icon={<span>📘</span>}>
      <div className="space-y-3 text-sm">
        <div className="flex flex-wrap gap-1.5">
          {pixel ? <Pill tone="good">✅ Píxel {pixel}</Pill> : <Pill tone="warn">Falta el píxel: Mi tienda → Marketing</Pill>}
          {status?.configured ? <Pill tone="good">🔒 Token conectado</Pill> : <Pill>Sin token</Pill>}
          {status?.last_ok_at ? <Pill tone="good">Último envío {new Date(status.last_ok_at).toLocaleString("es-CO")}</Pill> : null}
          {status?.last_error ? <Pill tone="danger">Error: {status.last_error.slice(0, 80)}</Pill> : null}
        </div>
        {status?.is_owner ? (
          <>
            <ol className="list-decimal space-y-1 pl-5 text-xs" style={{ color: "var(--t-muted)" }}>
              <li>Entra a <b>business.facebook.com → Administrador de eventos</b> y elige tu píxel.</li>
              <li>Ve a <b>Configuración → API de Conversiones → Generar token de acceso</b>.</li>
              <li>Pégalo aquí. Se guarda cifrado y nadie lo puede volver a ver (ni tú ni RemHub).</li>
            </ol>
            <input value={token} onChange={(e) => setToken(e.target.value.trim())} placeholder={status.configured ? "Token guardado ••••  (pega uno nuevo para cambiarlo)" : "Pega el token de acceso"} className={inputCls} style={inputStyle} autoComplete="off" data-1p-ignore data-lpignore="true" />
            <input value={testCode} onChange={(e) => setTestCode(e.target.value.trim())} placeholder="Código de prueba (opcional, ej. TEST12345)" className={inputCls} style={inputStyle} />
            <p className="text-[11px]" style={{ color: "var(--t-muted)" }}>El código de prueba sirve para ver los eventos en «Probar eventos». Quítalo cuando veas que funciona, para que los pedidos cuenten normal.</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={busy || (!token && !status.configured)} onClick={() => void act("save")} className="rounded-xl px-4 py-2 text-sm font-bold text-white disabled:opacity-50" style={{ background: "var(--t-cta)" }}>Guardar</button>
              <button type="button" disabled={busy || !status.configured} onClick={() => void act("test")} className="rounded-xl border px-4 py-2 text-sm font-semibold disabled:opacity-50" style={softBox}>Enviar prueba</button>
              {status.configured ? <button type="button" disabled={busy} onClick={() => void act("clear")} className="rounded-xl border px-4 py-2 text-sm font-semibold text-red-500" style={softBox}>Quitar token</button> : null}
            </div>
          </>
        ) : <p className="text-xs" style={{ color: "var(--t-muted)" }}>Solo el dueño de la tienda conecta el token de Meta.</p>}
      </div>
    </Section>
  );
}

// ------------------------------------------------------------ pedidos que entran por las landings

type LandingOrderRow = {
  order_id: string; receipt_no: number | null; created_at: string; status: string; payment_status: string | null; total: number;
  customer_name: string | null; customer_whatsapp: string | null; note: string | null;
  landing: { id: string; name: string; slug: string }; units: number; payment: string; upsell: boolean;
  city: string | null; department: string | null; source: string | null; campaign: string | null;
  items: Array<{ name: string | null; quantity: number; price: number }>;
};

const ORDER_STATUS: Record<string, [string, string]> = {
  draft: ["🕓 Por confirmar", "#f59e0b"], sent: ["🕓 Por confirmar", "#f59e0b"], confirmed: ["✅ Confirmado", "#16a34a"],
  completed: ["📦 Entregado", "#2563eb"], cancelled: ["✖ Anulado", "#ef4444"],
};
const PAY: Record<string, string> = { cod: "💵 Contraentrega", online: "💳 En línea", addi: "🗓️ Addi" };
const ago = (iso: string) => {
  const m = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 60000));
  return m < 1 ? "hace un momento" : m < 60 ? `hace ${m} min` : m < 1440 ? `hace ${Math.floor(m / 60)} h` : new Date(iso).toLocaleString("es-CO", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
};

/** Panel de los pedidos de las landings: ver, escribirle al cliente, confirmar y abrir en Pedidos. */
export function LandingOrders({ storeId, storeName, landings }: { storeId: string; storeName: string; landings: Array<{ id: string; name: string }> }) {
  const [days, setDays] = useState(30);
  const [page, setPage] = useState("");
  const [filter, setFilter] = useState<"all" | "pending" | "confirmed" | "completed" | "cancelled">("all");
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<LandingOrderRow[] | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    const { data, error: err } = await supabaseBrowser().rpc("erp_landing_orders_list", { p_store: storeId, p_days: days, p_page: page || null });
    if (err) { setError(/Could not find the function|schema cache/i.test(err.message) ? "Falta ejecutar la migración 20261258_landing_pedidos.sql en Supabase." : err.message); return; }
    const r = data as { ok: boolean; items?: LandingOrderRow[]; message?: string };
    if (!r.ok) { setError(r.message ?? "Sin permiso."); return; }
    setError("");
    setRows(r.items ?? []);
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [days, page]);

  async function setStatus(o: LandingOrderRow, next: "confirmed" | "completed") {
    const ok = await Swal.fire({ icon: "question", title: next === "confirmed" ? `¿Confirmar el pedido #${o.receipt_no}?` : `¿Marcar el pedido #${o.receipt_no} como entregado?`, text: next === "confirmed" ? "Confírmalo cuando ya hablaste con el cliente por WhatsApp." : "", showCancelButton: true, confirmButtonText: "Sí", cancelButtonText: "No", ...swalTheme });
    if (!ok.isConfirmed) return;
    setBusy(o.order_id);
    const { error: err } = await supabaseBrowser().rpc("store_team_set_order_status", { p_order_id: o.order_id, p_status: next });
    setBusy(null);
    if (err) { void Swal.fire({ icon: "error", title: "No se pudo cambiar", text: err.message, ...swalTheme }); return; }
    setRows((rs) => (rs ?? []).map((x) => (x.order_id === o.order_id ? { ...x, status: next } : x)));
  }

  const pending = (s: string) => s === "draft" || s === "sent";
  const all = rows ?? [];
  const list = all.filter((o) =>
    (filter === "all" || (filter === "pending" ? pending(o.status) : o.status === filter))
    && (!q.trim() || `${o.receipt_no ?? ""} ${o.customer_name ?? ""} ${o.customer_whatsapp ?? ""} ${o.city ?? ""}`.toLowerCase().includes(q.trim().toLowerCase())));
  const toConfirm = all.filter((o) => pending(o.status)).length;
  const counts = { all: all.length, pending: toConfirm, confirmed: all.filter((o) => o.status === "confirmed").length, completed: all.filter((o) => o.status === "completed").length, cancelled: all.filter((o) => o.status === "cancelled").length };
  const FILTERS: Array<[keyof typeof counts, string]> = [["all", "Todos"], ["pending", "🕓 Por confirmar"], ["confirmed", "✅ Confirmados"], ["completed", "📦 Entregados"], ["cancelled", "✖ Anulados"]];

  return (
    <Section title="Pedidos de tus landings" hint="Los que llegan por el botón «Comprar» de las landings: escríbele al cliente, confírmalo y despáchalo" icon={<span>🛍️</span>}
      actions={toConfirm ? <span className="animate-pulse rounded-full px-3 py-1 text-xs font-black text-white" style={{ background: "#f59e0b" }}>🕓 {toConfirm} por confirmar</span> : null}>
      {error ? <p className="rounded-xl border p-3 text-sm" style={softBox}>⚠️ {error}</p> : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <select value={days} onChange={(e) => setDays(Number(e.target.value))} className={`${inputCls} w-auto`} style={inputStyle}>{[7, 30, 90, 365].map((d) => <option key={d} value={d}>Últimos {d} días</option>)}</select>
            {landings.length > 1 ? (
              <select value={page} onChange={(e) => setPage(e.target.value)} className={`${inputCls} w-auto`} style={inputStyle}>
                <option value="">Todas las landings</option>
                {landings.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            ) : null}
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar: nombre, WhatsApp, ciudad o #" className={`${inputCls} min-w-52 flex-1`} style={inputStyle} />
            <button type="button" onClick={() => void load()} className="grid h-10 w-10 place-items-center rounded-xl border" style={softBox} title="Actualizar"><RefreshCw size={15} /></button>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {FILTERS.map(([k, l]) => (
              <button key={k} type="button" onClick={() => setFilter(k)} className="rounded-full px-3 py-1 text-xs font-bold" style={filter === k ? { background: "var(--t-cta)", color: "#fff" } : { ...softBox, border: "1px solid var(--t-card-border)" }}>{l} ({counts[k]})</button>
            ))}
          </div>

          <div className="mt-3 space-y-2">
            {rows === null ? <p className="py-6 text-center text-sm" style={{ color: "var(--t-muted)" }}>Cargando pedidos…</p> : null}
            {rows && !list.length ? <p className="py-6 text-center text-sm" style={{ color: "var(--t-muted)" }}>{rows.length ? "Ningún pedido con ese filtro." : "Aún no hay pedidos de las landings en este periodo."}</p> : null}
            {list.map((o) => {
              const [label, color] = ORDER_STATUS[o.status] ?? [o.status, "#64748b"];
              const first = (o.customer_name ?? "").trim().split(/\s+/)[0] || "";
              const wa = (o.customer_whatsapp ?? "").replace(/\D/g, "").replace(/^57(?=\d{10}$)/, "");
              const product = o.items.map((i) => `${i.quantity} × ${i.name ?? "producto"}`).join(", ");
              const msg = `Hola${first ? ` ${first}` : ""} 👋 Te escribimos de ${storeName} por tu pedido #${o.receipt_no ?? ""} (${product}) por ${money(o.total)}. ¿Confirmamos la entrega? 🚚`;
              const isOpen = open === o.order_id;
              return (
                <article key={o.order_id} className="rounded-2xl border p-3" style={{ ...softBox, borderColor: pending(o.status) ? "rgba(245,158,11,.55)" : "var(--t-card-border)" }}>
                  <div className="flex flex-wrap items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-sm font-black">#{o.receipt_no ?? "—"}</span>
                        <span className="rounded-full px-2 py-0.5 text-[11px] font-bold" style={{ background: `color-mix(in oklab, ${color} 18%, transparent)`, color }}>{label}</span>
                        <Pill>{PAY[o.payment] ?? o.payment}</Pill>
                        {o.payment_status === "paid" ? <Pill tone="good">Pagado</Pill> : null}
                        {o.source ? <Pill>📣 {o.source}{o.campaign ? ` · ${o.campaign}` : ""}</Pill> : null}
                        {o.upsell ? <Pill tone="accent">➕ Adicional</Pill> : null}
                        <span className="text-[11px]" style={{ color: "var(--t-muted)" }}>{ago(o.created_at)}</span>
                      </div>
                      <p className="mt-1 text-sm font-bold">
                        {o.customer_name ?? "Cliente"}
                        {wa ? <span className="font-medium" style={{ color: "var(--t-muted)" }}> · 📱 {wa}</span> : null}
                        {o.city ? <span className="font-medium" style={{ color: "var(--t-muted)" }}> · 📍 {o.city}{o.department ? `, ${o.department}` : ""}</span> : null}
                      </p>
                      <p className="text-xs" style={{ color: "var(--t-muted)" }}>🚀 {o.landing.name} · {product}</p>
                    </div>
                    <p className="text-lg font-black">{money(o.total)}</p>
                  </div>
                  {isOpen && o.note ? <p className="mt-2 whitespace-pre-line rounded-xl border p-3 text-xs leading-5" style={softBox}>{o.note}</p> : null}
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {wa ? <a href={`https://wa.me/57${wa}?text=${encodeURIComponent(msg)}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-xl bg-emerald-500 px-3 py-1.5 text-xs font-bold text-white"><MessageCircle size={13} /> Escribirle</a> : null}
                    {pending(o.status) ? <button type="button" disabled={busy === o.order_id} onClick={() => void setStatus(o, "confirmed")} className="rounded-xl px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50" style={{ background: "var(--t-cta)" }}>✅ Confirmar</button> : null}
                    {o.status === "confirmed" ? <button type="button" disabled={busy === o.order_id} onClick={() => void setStatus(o, "completed")} className="rounded-xl px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50" style={{ background: "#2563eb" }}>📦 Marcar entregado</button> : null}
                    <button type="button" onClick={() => setOpen(isOpen ? null : o.order_id)} className="rounded-xl border px-3 py-1.5 text-xs font-semibold" style={softBox}>{isOpen ? "Ocultar datos" : "📍 Datos de entrega"}</button>
                    <button type="button" onClick={() => void copy(`Pedido #${o.receipt_no}\n${o.customer_name ?? ""} · ${wa}\n${product}\nTotal: ${money(o.total)}\n${o.note ?? ""}`)} className="inline-flex items-center gap-1 rounded-xl border px-3 py-1.5 text-xs font-semibold" style={softBox}><Copy size={12} /> Copiar</button>
                    <a href={`/dashboard/pedidos?pedido=${o.receipt_no ?? ""}`} className="inline-flex items-center gap-1 rounded-xl border px-3 py-1.5 text-xs font-semibold" style={softBox}><ExternalLink size={12} /> Abrir en Pedidos</a>
                  </div>
                </article>
              );
            })}
          </div>
        </>
      )}
    </Section>
  );
}
