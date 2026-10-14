"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Clock, History, Plus, Search, Settings2, ShieldCheck, X } from "lucide-react";
import Swal from "sweetalert2";
import { supabaseBrowser } from "@/lib/supabase/client";
import { smartFilter } from "@/lib/search";
import { fetchProductCosts } from "@/lib/profit/costs";
import { pointPrice, toCents, type RoundingDir, type RoundingStep } from "@/lib/profit/engine";
import { cardStyle, cop, esc, inputStyle, rpcError, swalTheme, type Point } from "./shared";

export type ProfitSettings = {
  rounding_step: RoundingStep; rounding_dir: RoundingDir; point_min_pct: number; point_max_pct: number; require_approval: boolean;
  price_guard: "off" | "observe" | "enforce"; updated_by_name: string | null; updated_at: string | null;
  can_edit: boolean; can_rules: boolean; can_approve: boolean; can_view: boolean; my_points: string[] | null;
};
type Rule = {
  id: string; point_id: string; point_name: string; scope: "point" | "category" | "product"; target_id: string | null; target_name: string;
  kind: "pct" | "fixed" | "none"; value: number; valid_from: string; valid_to: string | null; status: "pending" | "active" | "rejected" | "retired";
  version: number; reason: string; created_by_name: string | null; created_at: string; decided_by_name: string | null; decided_at: string | null; decision_note: string | null; live: boolean;
};
type Prod = { id: string; name: string; sku: string | null; cost_price: number | null; price_1: number | null; price_2: number | null; price_3: number | null; price_4: number | null; price_5: number | null };
type Cat = { id: string; name: string };

const STATUS: Record<Rule["status"], { label: string; color: string }> = {
  pending: { label: "Pendiente de aprobación", color: "#eda100" },
  active: { label: "Vigente", color: "#22c55e" },
  rejected: { label: "Rechazada", color: "#e66767" },
  retired: { label: "Retirada", color: "#94a3b8" },
};
const ruleText = (r: { kind: Rule["kind"]; value: number }) =>
  r.kind === "pct" ? `${Number(r.value) >= 0 ? "+" : ""}${Number(r.value).toLocaleString("es-CO", { maximumFractionDigits: 4 })} % sobre el precio de la madre` : r.kind === "fixed" ? `Precio fijo ${cop(r.value)}` : "Sin ajuste (precio de la madre)";
const when = (d: string | null) => (d ? new Date(d).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" }) : "");

async function askReason(title: string, placeholder = "Motivo") {
  const res = await Swal.fire({ ...swalTheme, title: esc(title), input: "text", inputPlaceholder: placeholder, showCancelButton: true, confirmButtonText: "Confirmar", cancelButtonText: "Cancelar", inputValidator: (v) => (v.trim().length < 3 ? "Escribe al menos 3 letras" : null) });
  return res.isConfirmed ? String(res.value).trim() : null;
}

/** Reglas de precio por punto (encadenado sobre los precios 1-5 de la madre), con aprobación e historial. */
export function PointRules({ storeId, points, settings, onSettings }: { storeId: string; points: Point[]; settings: ProfitSettings; onSettings: () => void }) {
  const [rules, setRules] = useState<Rule[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [filterPoint, setFilterPoint] = useState("");
  const [showOld, setShowOld] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editingSettings, setEditingSettings] = useState(false);
  const myPoints = settings.my_points;
  const allowed = myPoints ? points.filter((p) => myPoints.includes(p.id)) : points;

  const load = useCallback(async () => {
    const { data, error: err } = await supabaseBrowser().rpc("erp_price_rules_list", { p_store: storeId, p_point: filterPoint || null });
    if (err) return setError(rpcError(err));
    setError(null);
    setRules((data ?? []) as Rule[]);
  }, [storeId, filterPoint]);
  useEffect(() => {
    const t = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(t);
  }, [load]);

  const pending = rules.filter((r) => r.status === "pending");
  const live = rules.filter((r) => r.live);
  const old = rules.filter((r) => r.status !== "pending" && !r.live);

  async function decide(r: Rule, approve: boolean) {
    const note = approve ? "" : await askReason("¿Por qué la rechazas?");
    if (!approve && note === null) return;
    const { error: err } = await supabaseBrowser().rpc("erp_price_rule_decide", { p_rule: r.id, p_approve: approve, p_note: note || null });
    if (err) return void Swal.fire({ ...swalTheme, icon: "error", title: "No se pudo", text: rpcError(err) });
    void Swal.fire({ ...swalTheme, icon: "success", title: approve ? "Regla aprobada" : "Regla rechazada", timer: 1300, showConfirmButton: false });
    void load();
  }
  async function retire(r: Rule) {
    const reason = await askReason(`¿Retirar la regla de ${r.point_name}?`, "Ej.: termina la temporada");
    if (!reason) return;
    const { error: err } = await supabaseBrowser().rpc("erp_price_rule_retire", { p_rule: r.id, p_reason: reason });
    if (err) return void Swal.fire({ ...swalTheme, icon: "error", title: "No se pudo", text: rpcError(err) });
    void load();
  }

  const RuleCard = ({ r }: { r: Rule }) => (
    <li className="rounded-2xl border p-3" style={{ ...cardStyle, borderColor: r.status === "pending" ? "color-mix(in oklab, #eda100 55%, transparent)" : "var(--t-card-border)" }}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full px-2 py-0.5 text-[11px] font-bold" style={{ background: `color-mix(in oklab, ${STATUS[r.status].color} 18%, transparent)`, color: STATUS[r.status].color }}>
          {r.live ? "Vigente" : STATUS[r.status].label}
        </span>
        <b className="text-sm">📍 {r.point_name}</b>
        <span className="text-sm">· {r.scope === "point" ? "Todo el punto" : r.scope === "category" ? `Categoría ${r.target_name}` : r.target_name}</span>
        <span className="ml-auto text-[11px]" style={{ color: "var(--t-muted)" }}>v{r.version}</span>
      </div>
      <p className="mt-1 text-sm font-bold">{ruleText(r)}</p>
      <p className="text-xs" style={{ color: "var(--t-muted)" }}>
        Desde {when(r.valid_from)}{r.valid_to ? ` hasta ${when(r.valid_to)}` : " · sin fecha final"} · «{r.reason}» · {r.created_by_name ?? "—"}
        {r.decided_by_name ? ` · ${r.status === "rejected" ? "rechazó" : "decidió"} ${r.decided_by_name}${r.decision_note ? `: ${r.decision_note}` : ""}` : ""}
      </p>
      {r.status === "pending" || r.live ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {r.status === "pending" && settings.can_approve ? (
            <>
              <button type="button" onClick={() => void decide(r, true)} className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-bold text-white" style={{ background: "#22c55e" }}><Check size={13} /> Aprobar</button>
              <button type="button" onClick={() => void decide(r, false)} className="inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-bold" style={{ borderColor: "var(--t-card-border)" }}><X size={13} /> Rechazar</button>
            </>
          ) : null}
          {settings.can_rules || settings.can_approve ? (
            <button type="button" onClick={() => void retire(r)} className="rounded-lg border px-3 py-1.5 text-xs font-bold" style={{ borderColor: "var(--t-card-border)" }}>{r.status === "pending" ? "Cancelar solicitud" : "Retirar"}</button>
          ) : null}
        </div>
      ) : null}
    </li>
  );

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border p-4" style={cardStyle}>
        <div className="flex flex-wrap items-start gap-3">
          <Settings2 size={18} className="mt-0.5 shrink-0" />
          <div className="min-w-0 flex-1 text-sm">
            <p className="font-bold">Cómo se calcula el precio del punto</p>
            <p style={{ color: "var(--t-muted)" }}>
              <b>Encadenado:</b> el punto aplica su porcentaje sobre el precio de la madre (precio 1 a 5 del producto). Redondeo:{" "}
              {settings.rounding_step ? `a $${settings.rounding_step.toLocaleString("es-CO")} ${settings.rounding_dir === "up" ? "hacia arriba" : settings.rounding_dir === "down" ? "hacia abajo" : "más cercano"}` : "sin redondeo"}.
              {" "}Los puntos pueden usar entre {settings.point_min_pct} % y {settings.point_max_pct} %{settings.require_approval ? " y la madre aprueba cada regla" : " sin aprobación"}.
            </p>
            <p className="mt-1 text-xs" style={{ color: "var(--t-muted)" }}>
              <ShieldCheck size={12} className="mr-1 inline align-[-2px]" />
              Guardián de precios: <b>{settings.price_guard === "enforce" ? "bloquea" : settings.price_guard === "observe" ? "solo observa" : "apagado"}</b>
              {settings.updated_by_name ? ` · último cambio: ${settings.updated_by_name}, ${when(settings.updated_at)}` : ""}
            </p>
          </div>
          {settings.can_edit ? (
            <button type="button" onClick={() => setEditingSettings(true)} className="rounded-full border px-3 py-1.5 text-xs font-bold" style={{ borderColor: "var(--t-card-border)" }}>Configurar</button>
          ) : null}
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-2">
        {allowed.length > 1 ? (
          <select value={filterPoint} onChange={(e) => setFilterPoint(e.target.value)} className="rounded-full border px-3 py-2 text-sm" style={inputStyle} aria-label="Filtrar por punto">
            <option value="">Todos los puntos</option>
            {allowed.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        ) : null}
        <span className="flex-1" />
        {settings.can_rules || settings.can_approve ? (
          <button type="button" onClick={() => setCreating(true)} className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-bold text-white shadow-lg" style={{ background: "linear-gradient(135deg,#3987e5,#d95926)" }}>
            <Plus size={16} /> Nueva regla
          </button>
        ) : null}
      </div>

      {error ? <p className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm">{error}</p> : null}

      {pending.length ? (
        <section>
          <p className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide" style={{ color: "#eda100" }}><Clock size={13} /> Esperando aprobación ({pending.length})</p>
          <ul className="grid gap-2 md:grid-cols-2">{pending.map((r) => <RuleCard key={r.id} r={r} />)}</ul>
        </section>
      ) : null}

      <section>
        <p className="mb-2 text-xs font-bold uppercase tracking-wide" style={{ color: "var(--t-muted)" }}>Vigentes ({live.length})</p>
        {live.length ? (
          <ul className="grid gap-2 md:grid-cols-2">{live.map((r) => <RuleCard key={r.id} r={r} />)}</ul>
        ) : (
          <p className="rounded-2xl border border-dashed p-6 text-center text-sm" style={{ borderColor: "var(--t-card-border)", color: "var(--t-muted)" }}>
            Ningún punto tiene precios propios: todos venden con los precios 1-5 de la madre.
          </p>
        )}
      </section>

      {old.length ? (
        <section>
          <button type="button" onClick={() => setShowOld((v) => !v)} className="mb-2 inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide" style={{ color: "var(--t-muted)" }}>
            <History size={13} /> Historial ({old.length}) {showOld ? "▲" : "▼"}
          </button>
          {showOld ? <ul className="grid gap-2 md:grid-cols-2">{old.map((r) => <RuleCard key={r.id} r={r} />)}</ul> : null}
        </section>
      ) : null}

      <AnimatePresence>{creating ? <RuleDialog key="new" storeId={storeId} points={allowed} settings={settings} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); void load(); }} /> : null}</AnimatePresence>
      <AnimatePresence>{editingSettings ? <SettingsDialog key="cfg" storeId={storeId} settings={settings} onClose={() => setEditingSettings(false)} onSaved={() => { setEditingSettings(false); onSettings(); }} /> : null}</AnimatePresence>
    </div>
  );
}

function Sheet({ title, onClose, children, footer }: { title: string; onClose: () => void; children: React.ReactNode; footer: React.ReactNode }) {
  return createPortal(
    <motion.div className="fixed inset-0 z-140 flex items-end justify-center bg-black/55 backdrop-blur-sm sm:items-center sm:p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div role="dialog" aria-modal="true" aria-label={title} initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }} transition={{ type: "spring", stiffness: 380, damping: 34 }} onClick={(e) => e.stopPropagation()}
        className="flex max-h-[92dvh] w-full max-w-xl flex-col overflow-hidden rounded-t-3xl border shadow-2xl sm:rounded-3xl" style={{ borderColor: "var(--t-card-border)", background: "var(--t-bg-base)", color: "var(--t-text)", paddingBottom: "env(safe-area-inset-bottom)" }}>
        <header className="flex items-center gap-3 border-b px-5 py-4" style={{ borderColor: "var(--t-card-border)" }}>
          <h2 className="flex-1 text-lg font-black">{title}</h2>
          <button type="button" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-full border" style={{ borderColor: "var(--t-card-border)" }} aria-label="Cerrar"><X size={16} /></button>
        </header>
        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">{children}</div>
        <footer className="flex items-center gap-2 border-t px-5 py-3" style={{ borderColor: "var(--t-card-border)" }}>{footer}</footer>
      </motion.div>
    </motion.div>,
    document.body,
  );
}

const label = "text-xs font-bold";
const field = "mt-1 w-full rounded-xl border px-3 py-2 text-sm outline-none";

function RuleDialog({ storeId, points, settings, onClose, onSaved }: { storeId: string; points: Point[]; settings: ProfitSettings; onClose: () => void; onSaved: () => void }) {
  const [pointId, setPointId] = useState(points[0]?.id ?? "");
  const [scope, setScope] = useState<Rule["scope"]>("product");
  const [kind, setKind] = useState<Rule["kind"]>("pct");
  const [value, setValue] = useState(15);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [reason, setReason] = useState("");
  const [q, setQ] = useState("");
  const [products, setProducts] = useState<Prod[]>([]);
  const [cats, setCats] = useState<Cat[]>([]);
  const [target, setTarget] = useState<{ id: string; name: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const sb = supabaseBrowser();
    void Promise.all([
      sb.from("products").select("id,name,sku,price_1,price_2,price_3,price_4,price_5").eq("store_id", storeId).eq("active", true).order("name").limit(5000),
      sb.from("product_categories").select("id,name").eq("store_id", storeId).order("name"),
    ]).then(async ([p, c]) => {
      const list = (p.data ?? []) as Prod[];
      const costs = await fetchProductCosts(storeId, list.map((x) => x.id)).catch(() => null);
      setProducts(list.map((x) => ({ ...x, cost_price: costs?.get(x.id) ?? null })));
      setCats((c.data ?? []) as Cat[]);
    });
  }, [storeId]);

  const found = useMemo(() => {
    if (!q.trim()) return [];
    return scope === "product" ? smartFilter(products, q, (p) => `${p.name} ${p.sku ?? ""}`).slice(0, 8).map((p) => ({ id: p.id, name: p.name })) : smartFilter(cats, q, (c) => c.name).slice(0, 8);
  }, [q, scope, products, cats]);

  const product = scope === "product" && target ? products.find((p) => p.id === target.id) : undefined;
  const approver = settings.can_approve;
  const outOfLimits = kind === "pct" && !approver && (value < settings.point_min_pct || value > settings.point_max_pct);
  const belowCost = kind === "fixed" && product && value < Number(product.cost_price ?? 0);
  const ready = pointId && (scope === "point" || target) && reason.trim().length >= 3 && Number.isFinite(value) && !outOfLimits && !(belowCost && !approver);

  async function save() {
    setSaving(true);
    const { data, error } = await supabaseBrowser().rpc("erp_price_rule_save", {
      p_store: storeId, p_point: pointId, p_scope: scope, p_target: scope === "point" ? null : target?.id, p_kind: kind, p_value: kind === "none" ? 0 : value,
      p_valid_from: from ? new Date(from).toISOString() : null, p_valid_to: to ? new Date(to).toISOString() : null, p_reason: reason.trim(),
    });
    setSaving(false);
    if (error) return void Swal.fire({ ...swalTheme, icon: "error", title: "No se guardó", text: rpcError(error) });
    const st = (data as { status?: string } | null)?.status;
    void Swal.fire({ ...swalTheme, icon: "success", title: st === "pending" ? "Enviada para aprobación" : "Regla vigente", text: st === "pending" ? "La madre debe aprobarla antes de que cambie los precios." : "El POS de ese punto ya usa el nuevo precio.", timer: 2200, showConfirmButton: false });
    onSaved();
  }

  return (
    <Sheet title="Nueva regla de precio" onClose={onClose} footer={
      <>
        <span className="flex-1 text-xs" style={{ color: "var(--t-muted)" }}>{approver || !settings.require_approval ? "Quedará vigente al guardar." : "La madre la revisará antes de aplicarla."}</span>
        <button type="button" disabled={!ready || saving} onClick={() => void save()} className="rounded-full px-5 py-2 text-sm font-bold text-white disabled:opacity-40" style={{ background: "linear-gradient(135deg,#3987e5,#d95926)" }}>{saving ? "Guardando…" : "Guardar regla"}</button>
      </>
    }>
      <label className="block"><span className={label}>Punto</span>
        <select value={pointId} onChange={(e) => setPointId(e.target.value)} className={field} style={inputStyle}>{points.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
      </label>
      <div>
        <span className={label}>¿A qué productos aplica?</span>
        <div className="mt-1 flex flex-wrap gap-1.5 text-xs font-bold">
          {([["product", "Un producto"], ["category", "Una categoría"], ["point", "Todo el punto"]] as const).map(([k, l]) => (
            <button key={k} type="button" onClick={() => { setScope(k); setTarget(null); setQ(""); if (k === "point" && kind === "fixed") setKind("pct"); }} className="rounded-full px-3 py-1.5" style={scope === k ? { background: "var(--t-accent)", color: "#fff" } : { border: "1px solid var(--t-card-border)" }}>{l}</button>
          ))}
        </div>
        {scope !== "point" ? (
          target ? (
            <p className="mt-2 flex items-center gap-2 rounded-xl px-3 py-2 text-sm" style={{ background: "color-mix(in oklab, var(--t-accent) 10%, transparent)" }}>
              <b className="min-w-0 flex-1 truncate">{target.name}</b>
              <button type="button" onClick={() => setTarget(null)} className="text-xs font-bold underline">Cambiar</button>
            </p>
          ) : (
            <div className="relative mt-2">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 opacity-60" />
              <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={scope === "product" ? "Buscar producto por nombre o código…" : "Buscar categoría…"} className="w-full rounded-xl border py-2 pr-3 text-sm outline-none" style={{ ...inputStyle, paddingLeft: "2.1rem" }} />
              {found.length ? (
                <ul className="mt-1 max-h-48 space-y-1 overflow-y-auto">
                  {found.map((f) => <li key={f.id}><button type="button" onClick={() => setTarget(f)} className="w-full truncate rounded-lg border px-3 py-1.5 text-left text-sm" style={{ borderColor: "var(--t-card-border)" }}>{f.name}</button></li>)}
                </ul>
              ) : null}
            </div>
          )
        ) : null}
      </div>
      <div>
        <span className={label}>Ajuste</span>
        <div className="mt-1 flex flex-wrap gap-1.5 text-xs font-bold">
          {([["pct", "% sobre el precio de la madre"], ...(scope === "product" ? [["fixed", "Precio fijo"]] : []), ["none", "Sin ajuste (0 %)"]] as Array<[Rule["kind"], string]>).map(([k, l]) => (
            <button key={k} type="button" onClick={() => setKind(k)} className="rounded-full px-3 py-1.5" style={kind === k ? { background: "var(--t-accent)", color: "#fff" } : { border: "1px solid var(--t-card-border)" }}>{l}</button>
          ))}
        </div>
        {kind !== "none" ? (
          <div className="mt-2 flex items-center gap-2 rounded-xl border px-3 py-2" style={inputStyle}>
            <input type="number" inputMode="decimal" value={value} onChange={(e) => setValue(Number(e.target.value))} step={kind === "pct" ? 0.5 : 100} className="w-full bg-transparent text-lg font-black tabular-nums outline-none" aria-label="Valor" />
            <span className="font-bold" style={{ color: "var(--t-muted)" }}>{kind === "pct" ? "%" : "COP"}</span>
          </div>
        ) : null}
        {outOfLimits ? <p className="mt-1 text-xs text-amber-400">La madre permite entre {settings.point_min_pct} % y {settings.point_max_pct} %.</p> : null}
        {belowCost ? <p className="mt-1 text-xs text-amber-400">Ese precio está por debajo del costo ({cop(product?.cost_price)}).{approver ? " Como aprobador, puedes guardarlo; quedará auditado." : " Necesita aprobación de la madre."}</p> : null}
      </div>

      {product ? (
        <div className="rounded-2xl border p-3" style={cardStyle}>
          <p className="mb-2 text-xs font-bold uppercase tracking-wide" style={{ color: "var(--t-muted)" }}>Vista previa · costo {cop(product.cost_price)}</p>
          <div className="grid grid-cols-5 gap-1 text-center text-xs">
            {[1, 2, 3, 4, 5].map((l) => {
              const mother = toCents(Number(product[`price_${l}` as keyof Prod] ?? 0));
              const p = pointPrice(mother, { kind, value }, settings.rounding_step, settings.rounding_dir);
              const loss = p < toCents(Number(product.cost_price ?? 0));
              return (
                <div key={l} className="rounded-xl border px-1 py-2" style={{ borderColor: "var(--t-card-border)" }}>
                  <p style={{ color: "var(--t-muted)" }}>Precio {l}</p>
                  <p className="line-through opacity-60">{cop(mother / 100)}</p>
                  <p className="font-black tabular-nums" style={loss ? { color: "#e66767" } : undefined}>{cop(p / 100)}</p>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3">
        <label className="block"><span className={label}>Desde (opcional)</span><input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} className={field} style={inputStyle} /></label>
        <label className="block"><span className={label}>Hasta (opcional)</span><input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} className={field} style={inputStyle} /></label>
      </div>
      <label className="block"><span className={label}>Motivo (queda en el historial)</span>
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ej.: punto con más gastos de arriendo" className={field} style={inputStyle} />
      </label>
    </Sheet>
  );
}

function SettingsDialog({ storeId, settings, onClose, onSaved }: { storeId: string; settings: ProfitSettings; onClose: () => void; onSaved: () => void }) {
  const [s, setS] = useState({ rounding_step: settings.rounding_step, rounding_dir: settings.rounding_dir, point_min_pct: settings.point_min_pct, point_max_pct: settings.point_max_pct, require_approval: settings.require_approval, price_guard: settings.price_guard });
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  async function save() {
    if (s.price_guard === "enforce" && settings.price_guard !== "enforce") {
      const go = await Swal.fire({ ...swalTheme, icon: "warning", title: "¿Bloquear precios no autorizados?", html: "Las ventas con un precio que no sea de la madre, de un punto o de un catálogo serán <b>rechazadas</b>.<br/><small>Revisa antes en Resumen que el guardián no haya anotado precios legítimos.</small>", showCancelButton: true, confirmButtonText: "Sí, bloquear", cancelButtonText: "Cancelar" });
      if (!go.isConfirmed) return;
    }
    setSaving(true);
    const { error } = await supabaseBrowser().rpc("erp_profit_settings_save", { p_store: storeId, p_settings: s, p_reason: reason.trim() });
    setSaving(false);
    if (error) return void Swal.fire({ ...swalTheme, icon: "error", title: "No se guardó", text: rpcError(error) });
    onSaved();
  }
  return (
    <Sheet title="Configuración de la madre" onClose={onClose} footer={
      <>
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Motivo del cambio" className="min-w-0 flex-1 rounded-full border px-3 py-2 text-sm" style={inputStyle} />
        <button type="button" disabled={reason.trim().length < 3 || saving || s.point_min_pct > s.point_max_pct} onClick={() => void save()} className="rounded-full px-5 py-2 text-sm font-bold text-white disabled:opacity-40" style={{ background: "linear-gradient(135deg,#3987e5,#d95926)" }}>Guardar</button>
      </>
    }>
      <label className="block"><span className={label}>Redondeo del precio del punto</span>
        <select value={`${s.rounding_step}:${s.rounding_dir}`} onChange={(e) => { const [a, b] = e.target.value.split(":"); setS({ ...s, rounding_step: Number(a) as RoundingStep, rounding_dir: b as RoundingDir }); }} className={field} style={inputStyle}>
          <option value="0:nearest">Sin redondeo (con centavos)</option>
          {[1, 50, 100, 500, 1000].flatMap((st) => (["nearest", "up"] as const).map((d) => <option key={`${st}:${d}`} value={`${st}:${d}`}>A ${st.toLocaleString("es-CO")} {d === "up" ? "hacia arriba" : "más cercano"}</option>))}
        </select>
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block"><span className={label}>Mínimo para los puntos (%)</span><input type="number" value={s.point_min_pct} onChange={(e) => setS({ ...s, point_min_pct: Number(e.target.value) })} className={field} style={inputStyle} /></label>
        <label className="block"><span className={label}>Máximo para los puntos (%)</span><input type="number" value={s.point_max_pct} onChange={(e) => setS({ ...s, point_max_pct: Number(e.target.value) })} className={field} style={inputStyle} /></label>
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={s.require_approval} onChange={(e) => setS({ ...s, require_approval: e.target.checked })} className="h-4 w-4 accent-violet-500" /> Las reglas de los puntos necesitan aprobación de la madre</label>
      <div>
        <span className={label}>Guardián de precios</span>
        <div className="mt-1 grid gap-1.5 text-sm">
          {([["observe", "👀 Observar", "Deja pasar todo y anota los precios que no coinciden (recomendado al empezar)"], ["enforce", "🛡️ Bloquear", "Rechaza ventas con precios no autorizados"], ["off", "⏸️ Apagado", "No revisa los precios"]] as const).map(([k, t, d]) => (
            <button key={k} type="button" onClick={() => setS({ ...s, price_guard: k })} className="rounded-xl border px-3 py-2 text-left" style={s.price_guard === k ? { borderColor: "var(--t-accent)", background: "color-mix(in oklab, var(--t-accent) 12%, transparent)" } : { borderColor: "var(--t-card-border)" }}>
              <b>{t}</b> <span className="text-xs" style={{ color: "var(--t-muted)" }}>· {d}</span>
            </button>
          ))}
        </div>
      </div>
    </Sheet>
  );
}
