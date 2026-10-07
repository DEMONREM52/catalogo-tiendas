"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Database, FileText, MessageCircle, Pencil, Plus, Power, Search, Trash2, Users, Wallet } from "lucide-react";
import Swal from "sweetalert2";
import { supabaseBrowser } from "@/lib/supabase/client";
import { getDashboardStore, hasStorePermission, type DashboardStore } from "@/lib/store-utils";
import { smartFilter } from "@/lib/search";
import { docWithDv } from "../nit";
import { CreditMeter, KindBadge } from "./CreditMeter";
import { ReceivablesTab } from "./ReceivablesTab";
import { StatementDrawer } from "./StatementDrawer";
import { ThirdPartyForm } from "./ThirdPartyForm";
import { KINDS, errorText, initials, kindInfo, loadBalances, loadThirdParties, money, waLink, type Balance, type ThirdKind, type ThirdParty } from "./terceros";

type Tab = "terceros" | "cartera";
type CreditFilter = "all" | "with" | "overdue" | "over" | "blocked";
const PAGE = 60;

export default function TercerosPage() {
  const [store, setStore] = useState<DashboardStore | null>(null);
  const [perm, setPerm] = useState({ clients: false, delete: false, credit: false, receivables: false });
  const [parties, setParties] = useState<ThirdParty[]>([]);
  const [balances, setBalances] = useState<Map<string, Balance>>(new Map());
  const [legacy, setLegacy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("terceros");
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<ThirdKind | "all">("all");
  const [status, setStatus] = useState<"active" | "inactive" | "all">("active");
  const [credit, setCredit] = useState<CreditFilter>("all");
  const [limit, setLimit] = useState(PAGE);
  const [form, setForm] = useState<{ open: boolean; row: ThirdParty | null; key: number }>({ open: false, row: null, key: 0 });
  const [statementFor, setStatementFor] = useState<ThirdParty | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const reloadBalances = useCallback(async (storeId: string) => setBalances(await loadBalances(storeId)), []);

  useEffect(() => {
    void (async () => {
      try {
        const access = await getDashboardStore();
        if (new URLSearchParams(window.location.search).get("tab") === "cartera") setTab("cartera");
        if (!access.store) throw new Error("No tienes acceso a ninguna tienda.");
        const can = (p: string) => hasStorePermission(access, p);
        setStore(access.store);
        setPerm({ clients: can("clients"), delete: can("clients_delete"), credit: can("credit"), receivables: can("receivables") || can("credit") });
        const { rows, legacy: isLegacy } = await loadThirdParties(access.store.id);
        setParties(rows);
        setLegacy(isLegacy);
        await reloadBalances(access.store.id);
      } catch (err) {
        void Swal.fire({ icon: "error", title: "No se pudieron cargar los terceros", text: errorText(err), background: "var(--t-bg-base)", color: "var(--t-text)" });
      } finally {
        setLoading(false);
      }
    })();
  }, [reloadBalances]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: 0 };
    parties.forEach((p) => {
      if (status !== "all" && p.active !== (status === "active")) return;
      c.all += 1;
      p.kinds.forEach((k) => { c[k] = (c[k] ?? 0) + 1; });
    });
    return c;
  }, [parties, status]);

  const filtered = useMemo(() => {
    const base = parties.filter((p) => {
      if (status !== "all" && p.active !== (status === "active")) return false;
      if (kind !== "all" && !p.kinds.includes(kind)) return false;
      const b = balances.get(p.id);
      if (credit === "with" && !p.credit_enabled) return false;
      if (credit === "overdue" && !(b && b.overdue_balance > 0)) return false;
      if (credit === "over" && !(p.credit_enabled && b && b.open_balance > p.credit_limit)) return false;
      if (credit === "blocked" && !p.credit_blocked) return false;
      return true;
    });
    return smartFilter(base, q, (p) =>
      `${p.name} ${p.trade_name ?? ""} ${p.document_number ?? ""} ${p.mobile ?? ""} ${p.phone ?? ""} ${p.email ?? ""} ${p.city ?? ""} ${p.contact_name ?? ""} ${p.tags.join(" ")}`,
    { keepOrder: !q.trim() });
  }, [parties, balances, q, kind, status, credit]);

  const stats = useMemo(() => {
    let open = 0, overdue = 0, withCredit = 0;
    balances.forEach((b) => { open += b.open_balance; overdue += b.overdue_balance; });
    parties.forEach((p) => { if (p.credit_enabled && p.active) withCredit += 1; });
    return { open, overdue, withCredit };
  }, [balances, parties]);

  function openForm(row: ThirdParty | null) {
    setForm((f) => ({ open: true, row, key: f.key + 1 }));
  }

  function onSaved(row: ThirdParty) {
    setParties((cur) => {
      const exists = cur.some((p) => p.id === row.id);
      const next = exists ? cur.map((p) => (p.id === row.id ? row : p)) : [row, ...cur];
      return next;
    });
  }

  async function toggleActive(p: ThirdParty) {
    const res = await Swal.fire({
      icon: "question",
      title: p.active ? `Desactivar a ${p.name}` : `Activar a ${p.name}`,
      text: p.active ? "No aparecerá para vender ni comprar; su historial y cartera se conservan." : "Volverá a aparecer en ventas y compras.",
      showCancelButton: true,
      confirmButtonText: p.active ? "Desactivar" : "Activar",
      cancelButtonText: "Cancelar",
      background: "var(--t-bg-base)",
      color: "var(--t-text)",
      confirmButtonColor: p.active ? "#ef4444" : "#22c55e",
    });
    if (!res.isConfirmed) return;
    const { error } = await supabaseBrowser().from("billing_customers").update({ active: !p.active }).eq("id", p.id);
    if (error) return void Swal.fire({ icon: "error", title: "No se pudo cambiar", text: errorText(error), background: "var(--t-bg-base)", color: "var(--t-text)" });
    setParties((cur) => cur.map((x) => (x.id === p.id ? { ...x, active: !p.active } : x)));
  }

  async function remove(p: ThirdParty) {
    const res = await Swal.fire({
      icon: "warning",
      title: `Eliminar a ${p.name}`,
      text: "Esta acción no se puede deshacer. Si tiene cartera o historial, mejor desactívalo.",
      showCancelButton: true,
      confirmButtonText: "Eliminar",
      cancelButtonText: "Cancelar",
      background: "var(--t-bg-base)",
      color: "var(--t-text)",
      confirmButtonColor: "#ef4444",
    });
    if (!res.isConfirmed) return;
    const { error } = await supabaseBrowser().from("billing_customers").delete().eq("id", p.id);
    if (error) {
      const fk = /foreign key|violates/i.test(error.message);
      return void Swal.fire({
        icon: "error",
        title: "No se pudo eliminar",
        text: fk ? "Tiene documentos o compras asociadas. Desactívalo para conservar su historial." : errorText(error),
        background: "var(--t-bg-base)",
        color: "var(--t-text)",
      });
    }
    setParties((cur) => cur.filter((x) => x.id !== p.id));
  }

  const canEdit = perm.clients || perm.credit;
  const visible = filtered.slice(0, limit);

  return (
    <main className="space-y-5">
      <section className="relative overflow-hidden rounded-[28px] border p-5 sm:p-7" style={{ borderColor: "var(--t-card-border)", background: "color-mix(in oklab, var(--t-card-bg) 94%, transparent)" }}>
        <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full blur-3xl" style={{ background: "color-mix(in oklab, var(--t-accent) 16%, transparent)" }} />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em]" style={{ color: "var(--t-accent)" }}>Terceros y cartera</p>
            <h1 className="mt-1 text-2xl font-black sm:text-3xl">Clientes, proveedores y más</h1>
            <p className="mt-1 max-w-2xl text-sm" style={{ color: "var(--t-muted)" }}>
              Un solo lugar para todas las personas y empresas con las que trabajas, sus créditos y lo que te deben.
            </p>
          </div>
          {canEdit && tab === "terceros" ? (
            <button type="button" onClick={() => openForm(null)} className="inline-flex items-center gap-2 rounded-2xl px-5 py-3 text-sm font-bold text-white shadow-lg transition hover:-translate-y-0.5" style={{ background: "linear-gradient(135deg, var(--t-accent), var(--t-accent2, var(--t-accent)))" }}>
              <Plus size={17} /> Nuevo tercero
            </button>
          ) : null}
        </div>
        <div className="relative mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            ["Terceros activos", String(parties.filter((p) => p.active).length), "var(--t-text)"],
            ["Con crédito", String(stats.withCredit), "var(--t-text)"],
            ["Cartera por cobrar", money(stats.open), "var(--t-text)"],
            ["Cartera vencida", money(stats.overdue), stats.overdue > 0 ? "#ef4444" : "var(--t-text)"],
          ].map(([label, value, color]) => (
            <div key={label} className="rounded-2xl border px-4 py-3" style={{ borderColor: "var(--t-card-border)" }}>
              <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--t-muted)" }}>{label}</p>
              <p className="mt-0.5 text-lg font-black tabular-nums" style={{ color }}>{loading ? "…" : value}</p>
            </div>
          ))}
        </div>
      </section>

      {legacy ? (
        <section role="status" className="flex items-start gap-3 rounded-2xl border border-amber-400/35 bg-amber-400/10 p-4 text-sm">
          <Database size={18} className="mt-0.5 shrink-0 text-amber-500" />
          <span>
            Para usar tipos de tercero, créditos y cartera ejecuta una vez en Supabase → SQL Editor el archivo{" "}
            <b className="font-mono">supabase/migrations/20261018_terceros_cartera.sql</b> y recarga.
          </span>
        </section>
      ) : null}

      <div className="flex gap-1 rounded-full border p-1 text-sm font-bold sm:w-fit" style={{ borderColor: "var(--t-card-border)" }}>
        {([["terceros", <Users key="u" size={15} />, "Terceros"], ...(perm.receivables ? [["cartera", <Wallet key="w" size={15} />, "Cartera"]] : [])] as Array<[Tab, React.ReactNode, string]>).map(([k, icon, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => {
              setTab(k);
              const url = new URL(window.location.href);
              if (k === "cartera") url.searchParams.set("tab", "cartera");
              else url.searchParams.delete("tab");
              window.history.replaceState(null, "", url.toString());
            }}
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-full px-5 py-2 transition sm:flex-none"
            style={tab === k ? { background: "var(--t-accent)", color: "#fff" } : { color: "var(--t-muted)" }}
          >
            {icon} {label}
          </button>
        ))}
      </div>

      {tab === "cartera" && store ? (
        <ReceivablesTab storeId={store.id} storeName={store.name} canPay={perm.receivables} parties={parties} onOpenStatement={setStatementFor} refreshKey={refreshKey} />
      ) : (
        <section className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-60 flex-1">
              <Search size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 opacity-60" />
              <input
                className="w-full rounded-2xl border py-3 pr-4 text-sm outline-none focus:ring-2 focus:ring-fuchsia-500/25"
                style={{ paddingLeft: "2.4rem", borderColor: "var(--t-card-border)", background: "var(--t-card-bg)", color: "var(--t-text)" }}
                placeholder="Buscar por nombre, documento, celular, ciudad o etiqueta…"
                value={q}
                onChange={(e) => { setQ(e.target.value); setLimit(PAGE); }}
              />
            </div>
            <select className="rounded-2xl border px-3 py-3 text-sm" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)", color: "var(--t-text)" }} value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
              <option value="active">Activos</option>
              <option value="inactive">Inactivos</option>
              <option value="all">Todos</option>
            </select>
            <select className="rounded-2xl border px-3 py-3 text-sm" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)", color: "var(--t-text)" }} value={credit} onChange={(e) => setCredit(e.target.value as CreditFilter)}>
              <option value="all">Crédito: todos</option>
              <option value="with">Con crédito activo</option>
              <option value="overdue">Con facturas vencidas</option>
              <option value="over">Sobre el cupo</option>
              <option value="blocked">Crédito bloqueado</option>
            </select>
          </div>

          <div className="flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none]">
            {[{ value: "all" as const, plural: "Todos", icon: "✨", color: "var(--t-accent)" }, ...KINDS].map((k) => {
              const on = kind === k.value;
              const n = counts[k.value] ?? 0;
              if (k.value !== "all" && n === 0 && !on) return null;
              return (
                <button key={k.value} type="button" onClick={() => { setKind(k.value); setLimit(PAGE); }} className="shrink-0 rounded-full border px-3.5 py-1.5 text-xs font-semibold transition" style={on ? { background: k.color, borderColor: "transparent", color: "#fff" } : { borderColor: "var(--t-card-border)" }}>
                  {k.icon} {k.plural} <span className="opacity-70">{n}</span>
                </button>
              );
            })}
          </div>

          {loading ? (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 6 }, (_, i) => <div key={i} className="h-44 animate-pulse rounded-3xl" style={{ background: "var(--t-card-bg)" }} />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="rounded-3xl border border-dashed p-10 text-center" style={{ borderColor: "var(--t-card-border)" }}>
              <p className="text-3xl">👥</p>
              <p className="mt-2 font-semibold">{parties.length ? "Nada coincide con tu búsqueda" : "Aún no tienes terceros"}</p>
              {canEdit ? (
                <button type="button" onClick={() => openForm(null)} className="mt-3 rounded-xl px-4 py-2 text-sm font-bold text-white" style={{ background: "var(--t-accent)" }}>
                  ➕ Crear tercero
                </button>
              ) : null}
            </div>
          ) : (
            <>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {visible.map((p, i) => {
                  const b = balances.get(p.id);
                  const k0 = kindInfo(p.kinds[0]);
                  const wa = waLink(p.mobile, `Hola ${p.name.split(" ")[0]}`);
                  const showCredit = p.kinds.includes("customer") && (p.credit_enabled || (b?.open_balance ?? 0) > 0);
                  return (
                    <motion.article
                      key={p.id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: Math.min(i, 12) * 0.02 }}
                      className="flex flex-col rounded-3xl border p-4 transition hover:-translate-y-0.5 hover:shadow-xl"
                      style={{
                        borderColor: b && b.overdue_balance > 0 ? "color-mix(in oklab, #ef4444 40%, transparent)" : "var(--t-card-border)",
                        background: "color-mix(in oklab, var(--t-card-bg) 92%, transparent)",
                        opacity: p.active ? 1 : 0.6,
                      }}
                    >
                      <div className="flex items-start gap-3">
                        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl text-sm font-black text-white" style={{ background: `linear-gradient(135deg, ${k0.color}, color-mix(in oklab, ${k0.color} 55%, #000))` }}>
                          {initials(p.name)}
                        </span>
                        <div className="min-w-0 flex-1">
                          <button type="button" onClick={() => canEdit && openForm(p)} className="block max-w-full truncate text-left font-bold hover:underline" title={p.name}>{p.name}</button>
                          <p className="truncate text-xs" style={{ color: "var(--t-muted)" }}>
                            {p.trade_name ? `${p.trade_name} · ` : ""}{p.document_number ? `${p.document_type} ${docWithDv(p.document_number)}` : "Sin documento"}
                          </p>
                        </div>
                        {!p.active ? <span className="rounded-full border px-2 py-0.5 text-[10px] font-bold" style={{ borderColor: "var(--t-card-border)" }}>Inactivo</span> : null}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {p.kinds.map((k) => <KindBadge key={k} {...kindInfo(k)} />)}
                        {p.tags.slice(0, 3).map((t) => <span key={t} className="rounded-full px-2 py-0.5 text-[11px]" style={{ background: "var(--t-card-border)" }}>#{t}</span>)}
                      </div>
                      <p className="mt-2 truncate text-xs" style={{ color: "var(--t-muted)" }}>
                        {[p.mobile, p.email, p.city].filter(Boolean).join(" · ") || "Sin datos de contacto"}
                      </p>
                      {showCredit ? (
                        <div className="mt-3 rounded-2xl border p-2.5" style={{ borderColor: "var(--t-card-border)" }}>
                          <CreditMeter size="sm" enabled={p.credit_enabled} blocked={p.credit_blocked} limit={p.credit_limit} used={b?.open_balance ?? 0} overdue={b?.overdue_balance} overdueCount={b?.overdue_count} />
                        </div>
                      ) : null}
                      <div className="mt-auto flex flex-wrap gap-1.5 pt-3">
                        {canEdit ? (
                          <button type="button" onClick={() => openForm(p)} className="inline-flex items-center gap-1 rounded-xl border px-2.5 py-1.5 text-xs font-semibold" style={{ borderColor: "var(--t-card-border)" }}>
                            <Pencil size={13} /> Editar
                          </button>
                        ) : null}
                        {(perm.receivables || perm.clients) && p.kinds.includes("customer") && !legacy ? (
                          <button type="button" onClick={() => setStatementFor(p)} className="inline-flex items-center gap-1 rounded-xl border px-2.5 py-1.5 text-xs font-semibold" style={{ borderColor: "var(--t-card-border)" }}>
                            <FileText size={13} /> Estado de cuenta
                          </button>
                        ) : null}
                        {wa ? (
                          <a href={wa} target="_blank" rel="noreferrer" className="grid h-8 w-8 place-items-center rounded-xl border" style={{ borderColor: "var(--t-card-border)" }} aria-label="WhatsApp" title="WhatsApp">
                            <MessageCircle size={14} />
                          </a>
                        ) : null}
                        <span className="flex-1" />
                        {canEdit && !legacy ? (
                          <button type="button" onClick={() => void toggleActive(p)} className="grid h-8 w-8 place-items-center rounded-xl border" style={{ borderColor: "var(--t-card-border)", color: p.active ? "#f59e0b" : "#22c55e" }} title={p.active ? "Desactivar" : "Activar"} aria-label={p.active ? "Desactivar" : "Activar"}>
                            <Power size={14} />
                          </button>
                        ) : null}
                        {perm.delete ? (
                          <button type="button" onClick={() => void remove(p)} className="grid h-8 w-8 place-items-center rounded-xl border text-red-400" style={{ borderColor: "color-mix(in oklab, #ef4444 35%, transparent)" }} title="Eliminar" aria-label="Eliminar">
                            <Trash2 size={14} />
                          </button>
                        ) : null}
                      </div>
                    </motion.article>
                  );
                })}
              </div>
              {filtered.length > visible.length ? (
                <div className="flex justify-center">
                  <button type="button" onClick={() => setLimit((l) => l + PAGE)} className="rounded-2xl border px-5 py-2.5 text-sm font-semibold" style={{ borderColor: "var(--t-card-border)" }}>
                    Ver más ({filtered.length - visible.length})
                  </button>
                </div>
              ) : null}
            </>
          )}
        </section>
      )}

      {store ? (
        <ThirdPartyForm
          key={form.key}
          open={form.open}
          onClose={() => setForm((f) => ({ ...f, open: false }))}
          storeId={store.id}
          initial={form.row}
          defaultKinds={kind !== "all" ? [kind] : ["customer"]}
          canCredit={perm.credit}
          balance={form.row ? balances.get(form.row.id) : null}
          existing={parties}
          onSaved={onSaved}
        />
      ) : null}
      <StatementDrawer
        party={statementFor}
        onClose={() => setStatementFor(null)}
        canPay={perm.receivables}
        canCredit={perm.credit}
        onChanged={() => {
          if (store) void reloadBalances(store.id);
          setRefreshKey((k) => k + 1);
        }}
      />
    </main>
  );
}
