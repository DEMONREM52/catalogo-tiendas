"use client";

import { useCallback, useEffect, useState } from "react";
import Swal from "sweetalert2";
import { supabaseBrowser } from "@/lib/supabase/client";
import { getDashboardStore, hasStorePermission } from "@/lib/store-utils";

/**
 * Comisiones y metas (20261229). Quien administra pone el % (general, por categoría o por producto) y las metas
 * del mes por punto o por vendedor; cada vendedor ve solo lo suyo.
 */

type Seller = { seller_id: string | null; seller: string; sales: number; commission: number; orders: number };
type Goal = { id: string; point_id: string | null; point: string | null; seller_id: string | null; seller: string | null; amount: number; done: number; pct: number; projection: number; per_day_needed: number | null };
type Rule = { scope: "all" | "category" | "product"; ref_id: string | null; pct: number; name?: string };

const money = (n: number) => `$${Math.round(Number(n) || 0).toLocaleString("es-CO")}`;
const swal = { background: "var(--t-bg-base)", color: "var(--t-text)", confirmButtonColor: "#8b5cf6" } as const;
const card = { borderColor: "var(--t-card-border)", background: "color-mix(in oklab, var(--t-card-bg) 92%, transparent)" };
const monthStart = (offset = 0) => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth() + offset, 1); };
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export default function TeamPage() {
  const [store, setStore] = useState<{ id: string } | null>(null);
  const [canRules, setCanRules] = useState(false);
  const [offset, setOffset] = useState(0);
  const [sellers, setSellers] = useState<Seller[] | null>(null);
  const [manage, setManage] = useState(false);
  const [goals, setGoals] = useState<{ goals: Goal[]; days: number; elapsed: number } | null>(null);
  const [rules, setRules] = useState<Rule[]>([]);
  const [cats, setCats] = useState<Array<{ id: string; name: string }>>([]);
  const [points, setPoints] = useState<Array<{ id: string; name: string }>>([]);
  const [team, setTeam] = useState<Array<{ user_id: string; name: string }>>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    void (async () => {
      const access = await getDashboardStore().catch(() => null);
      const s = access?.store;
      if (!s) return;
      setStore({ id: s.id });
      setCanRules(hasStorePermission(access, "payroll") || hasStorePermission(access, "profit_rules"));
      const sb = supabaseBrowser();
      const [c, w, u] = await Promise.all([
        sb.from("product_categories").select("id,name").eq("store_id", s.id).order("name"),
        sb.from("erp_warehouses").select("id,name").eq("store_id", s.id).eq("active", true).order("name"),
        sb.rpc("erp_sellers", { p_store: s.id }),
      ]);
      setCats((c.data ?? []) as typeof cats);
      setPoints((w.data ?? []) as typeof points);
      setTeam(((u.data ?? []) as Array<{ user_id: string; name: string }>).filter((x) => x.user_id));
    })();
  }, []);

  const load = useCallback(async () => {
    if (!store) return;
    const sb = supabaseBrowser();
    const from = monthStart(offset), to = monthStart(offset + 1);
    const [c, g, r] = await Promise.all([
      sb.rpc("erp_commissions", { p_store: store.id, p_from: from.toISOString(), p_to: to.toISOString() }),
      sb.rpc("erp_goals_progress", { p_store: store.id, p_month: iso(from) }),
      sb.rpc("erp_commission_rules_get", { p_store: store.id }),
    ]);
    if (c.error && /Could not find the function|schema cache/i.test(c.error.message)) return setError("Falta ejecutar en Supabase la migración 20261229_equipo_y_posventa.sql.");
    const cv = c.data as { ok: boolean; all: boolean; sellers: Seller[] } | null;
    setSellers(cv?.ok ? cv.sellers : []);
    setManage(Boolean(cv?.all));
    const gv = g.data as { ok: boolean; goals: Goal[]; days: number; elapsed: number; manage: boolean } | null;
    setGoals(gv?.ok ? gv : null);
    setRules((Array.isArray(r.data) ? r.data : []) as Rule[]);
  }, [store, offset]);
  useEffect(() => { const t = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(t); }, [load]);

  async function saveRules(next: Rule[]) {
    if (!store) return;
    const { data, error: e } = await supabaseBrowser().rpc("erp_commission_rules_save", { p_store: store.id, p_rules: next });
    if (e || !(data as { ok?: boolean } | null)?.ok) return void Swal.fire({ icon: "error", title: "No se guardó", text: e?.message ?? (data as { error?: string } | null)?.error, ...swal });
    void load();
  }
  async function addRule() {
    const r = await Swal.fire({
      title: "Nueva comisión",
      html: `<select id="sc" class="swal2-select" style="display:block;margin:8px auto"><option value="all">Todos los productos</option><option value="category">Una categoría</option></select>
        <select id="cat" class="swal2-select" style="display:block;margin:8px auto"><option value="">(categoría)</option>${cats.map((c) => `<option value="${c.id}">${c.name.replace(/[<>&"]/g, "")}</option>`).join("")}</select>`,
      input: "text", inputPlaceholder: "% de comisión (ej. 3)", showCancelButton: true, confirmButtonText: "Agregar", cancelButtonText: "Cancelar",
      preConfirm: (v) => ({ scope: (document.getElementById("sc") as HTMLSelectElement).value, ref_id: (document.getElementById("cat") as HTMLSelectElement).value || null, pct: Number(String(v).replace(",", ".")) }), ...swal,
    });
    if (!r.isConfirmed || !(r.value.pct >= 0)) return;
    if (r.value.scope === "category" && !r.value.ref_id) return void Swal.fire({ icon: "warning", title: "Elige la categoría", ...swal });
    const v = { scope: r.value.scope as Rule["scope"], ref_id: r.value.scope === "all" ? null : r.value.ref_id, pct: r.value.pct };
    void saveRules([...rules.filter((x) => !(x.scope === v.scope && x.ref_id === v.ref_id)), v]);
  }
  async function setGoal(point: string | null, seller: { id: string; name: string } | null) {
    const r = await Swal.fire({ title: `Meta del mes · ${seller ? seller.name : points.find((p) => p.id === point)?.name ?? "Toda la tienda"}`, input: "text", inputPlaceholder: "Valor en ventas ($). Vacío = quitar", showCancelButton: true, confirmButtonText: "Guardar", cancelButtonText: "Cancelar", ...swal });
    if (!r.isConfirmed || !store) return;
    const amount = Number(String(r.value ?? "").replace(/\D/g, "")) || 0;
    await supabaseBrowser().rpc("erp_goal_save", { p_store: store.id, p_month: iso(monthStart(offset)), p_point: point, p_seller: seller?.id ?? null, p_seller_name: seller?.name ?? null, p_amount: amount });
    void load();
  }

  const monthName = monthStart(offset).toLocaleDateString("es-CO", { month: "long", year: "numeric" });
  const totalCom = (sellers ?? []).reduce((s, x) => s + Number(x.commission), 0);
  return (
    <main className="mx-auto max-w-5xl space-y-4 px-4 py-4 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-black">🏆 Comisiones y metas</h1>
          <p className="text-sm" style={{ color: "var(--t-muted)" }}>{manage ? "Lo que gana cada vendedor y cómo va cada punto frente a su meta." : "Tus ventas, tu comisión y tu meta del mes."}</p>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <button type="button" onClick={() => setOffset((o) => o - 1)} className="rounded-lg border px-2.5 py-1" style={{ borderColor: "var(--t-card-border)" }}>◀</button>
          <b className="first-letter:uppercase">{monthName}</b>
          <button type="button" disabled={offset >= 0} onClick={() => setOffset((o) => o + 1)} className="rounded-lg border px-2.5 py-1 disabled:opacity-40" style={{ borderColor: "var(--t-card-border)" }}>▶</button>
        </div>
      </header>
      {error ? <p className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm">{error}</p> : null}

      <section className="rounded-2xl border p-4" style={card}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-black">🎯 Metas</h2>
          {manage ? (
            <div className="flex flex-wrap gap-1.5 text-xs">
              {points.map((p) => <button key={p.id} type="button" onClick={() => void setGoal(p.id, null)} className="rounded-full border px-2.5 py-1 font-semibold" style={{ borderColor: "var(--t-card-border)" }}>+ {p.name}</button>)}
              {team.slice(0, 20).map((u) => <button key={u.user_id} type="button" onClick={() => void setGoal(null, { id: u.user_id, name: u.name })} className="rounded-full border px-2.5 py-1 font-semibold" style={{ borderColor: "var(--t-card-border)" }}>+ {u.name}</button>)}
            </div>
          ) : null}
        </div>
        {!goals?.goals.length ? <p className="mt-2 text-sm" style={{ color: "var(--t-muted)" }}>{manage ? "Ponle una meta del mes a cada punto o vendedor con los botones de arriba." : "Aún no tienes una meta este mes."}</p> : null}
        <div className="mt-3 space-y-3">
          {(goals?.goals ?? []).map((g) => {
            const onTrack = g.projection >= g.amount;
            return (
              <div key={g.id}>
                <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                  <b>{g.seller ? `👤 ${g.seller}` : `📍 ${g.point ?? "Toda la tienda"}`}</b>
                  <span>{money(g.done)} de {money(g.amount)} · <b style={{ color: g.pct >= 100 ? "#10b981" : onTrack ? "#0ea5e9" : "#f59e0b" }}>{g.pct} %</b></span>
                </div>
                <div className="mt-1 h-3 overflow-hidden rounded-full" style={{ background: "var(--t-card-bg-soft)" }}>
                  <div className="h-full rounded-full transition-all duration-700" style={{ width: `${Math.min(100, g.pct)}%`, background: g.pct >= 100 ? "#10b981" : "linear-gradient(90deg,#8b5cf6,#0ea5e9)" }} />
                </div>
                <p className="mt-0.5 text-[11px]" style={{ color: "var(--t-muted)" }}>
                  {g.pct >= 100 ? "🎉 ¡Meta cumplida!" : `A este ritmo cierra en ${money(g.projection)} ${onTrack ? "✅" : "⚠️"}${g.per_day_needed ? ` · faltan ${money(g.per_day_needed)} por día` : ""}`}
                  {manage ? <> · <button type="button" className="underline" onClick={() => void setGoal(g.point_id, g.seller_id ? { id: g.seller_id, name: g.seller ?? "" } : null)}>cambiar</button></> : null}
                </p>
              </div>
            );
          })}
        </div>
      </section>

      <section className="rounded-2xl border p-4" style={card}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-black">💰 Comisiones {manage && totalCom ? <span className="text-sm font-semibold" style={{ color: "var(--t-muted)" }}>· {money(totalCom)} en total</span> : null}</h2>
        </div>
        {!rules.length ? <p className="mt-2 text-sm" style={{ color: "var(--t-muted)" }}>{canRules ? "Aún no hay comisiones. Agrega un % general y, si quieres, uno distinto por categoría." : "La tienda aún no tiene comisiones configuradas."}</p> : (
          <p className="mt-2 text-xs" style={{ color: "var(--t-muted)" }}>{rules.map((r) => `${r.name ?? (r.scope === "all" ? "Todos" : "")}: ${r.pct} %`).join(" · ")}</p>
        )}
        {canRules ? (
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            <button type="button" onClick={() => void addRule()} className="rounded-lg px-3 py-1.5 font-bold text-white" style={{ background: "var(--t-cta)" }}>➕ Comisión</button>
            {rules.map((r) => <button key={`${r.scope}${r.ref_id}`} type="button" onClick={() => void saveRules(rules.filter((x) => x !== r))} className="rounded-lg border px-2.5 py-1" style={{ borderColor: "var(--t-card-border)" }}>✕ {r.name ?? "Todos"} {r.pct} %</button>)}
          </div>
        ) : null}
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[420px] text-sm">
            <thead><tr className="text-left text-[11px] uppercase" style={{ color: "var(--t-muted)" }}><th className="p-2">Vendedor</th><th className="p-2 text-right">Ventas</th><th className="p-2 text-right">Documentos</th><th className="p-2 text-right">Comisión</th></tr></thead>
            <tbody>
              {(sellers ?? []).map((s, i) => (
                <tr key={`${s.seller_id}-${i}`} className="border-t" style={{ borderColor: "var(--t-card-border)" }}>
                  <td className="p-2 font-semibold">{i === 0 && manage ? "🏆 " : ""}{s.seller}</td>
                  <td className="p-2 text-right tabular-nums">{money(s.sales)}</td>
                  <td className="p-2 text-right tabular-nums">{s.orders}</td>
                  <td className="p-2 text-right font-black tabular-nums" style={{ color: "#10b981" }}>{money(s.commission)}</td>
                </tr>
              ))}
              {sellers && !sellers.length ? <tr><td colSpan={4} className="p-4 text-center" style={{ color: "var(--t-muted)" }}>No hay ventas este mes.</td></tr> : null}
            </tbody>
          </table>
        </div>
        {manage ? <p className="mt-2 text-[11px]" style={{ color: "var(--t-muted)" }}>Para pagarlas, agrégalas como un pago en Gastos y nómina.</p> : null}
      </section>
    </main>
  );
}
