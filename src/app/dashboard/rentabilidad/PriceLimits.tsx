"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Lock, MapPin, RotateCcw, User } from "lucide-react";
import Swal from "sweetalert2";
import { supabaseBrowser } from "@/lib/supabase/client";
import { NumberField } from "@/components/forms/Fields";
import { cardStyle, esc, rpcError, swalTheme } from "./shared";

type Mode = "list" | "mother" | "margin" | "cost";
type PointRow = { point_id: string; name: string; kind: string; mode: Mode | null; margin_pct: number | null; updated_by_name: string | null };
type UserRow = { user_id: string; name: string; point_id: string | null; point_name: string | null; approver: boolean; mode: Mode | null; margin_pct: number | null };
type Data = { can_edit: boolean; points: PointRow[]; users: UserRow[] };

const MODES: Array<{ value: Mode; icon: string; label: string; hint: string }> = [
  { value: "list", icon: "🔒", label: "No puede bajar", hint: "Vende al precio de lista del punto (puede subirlo)." },
  { value: "mother", icon: "🏠", label: "Hasta el precio de la madre", hint: "Ej.: el punto vende a 23.000 y puede bajar hasta 19.000." },
  { value: "margin", icon: "📈", label: "Hasta costo + %", hint: "Siempre deja una ganancia mínima sobre el costo." },
  { value: "cost", icon: "⚖️", label: "Hasta el costo", hint: "Puede vender sin ganancia, nunca con pérdida." },
];
const modeText = (m: Mode | null, pct: number | null) => {
  const x = MODES.find((o) => o.value === (m ?? "list"))!;
  return `${x.icon} ${x.label}${m === "margin" ? ` ${Number(pct ?? 0).toLocaleString("es-CO")} %` : ""}`;
};

function ModePicker({ mode, pct, disabled, onSave, allowInherit }: { mode: Mode | null; pct: number | null; disabled: boolean; onSave: (m: Mode | null, pct: number | null) => void; allowInherit?: boolean }) {
  const [m, setM] = useState<Mode | null>(mode);
  const [p, setP] = useState<number | null>(pct ?? 10);
  const dirty = m !== mode || (m === "margin" && Number(p) !== Number(pct));
  return (
    <div className="space-y-2">
      <div className="grid gap-1.5 sm:grid-cols-2">
        {MODES.map((o) => (
          <button key={o.value} type="button" disabled={disabled} onClick={() => setM(o.value)} className="rounded-xl border p-2.5 text-left transition disabled:opacity-60"
            style={m === o.value ? { borderColor: "var(--t-accent)", background: "color-mix(in oklab, var(--t-accent) 14%, transparent)" } : { borderColor: "var(--t-card-border)" }}>
            <span className="block text-xs font-black">{o.icon} {o.label}</span>
            <span className="block text-[11px]" style={{ color: "var(--t-muted)" }}>{o.hint}</span>
          </button>
        ))}
      </div>
      {m === "margin" ? (
        <div className="flex items-center gap-2 text-xs"><span className="flex-1 font-semibold">Ganancia mínima sobre el costo</span><div className="w-28"><NumberField value={p} onChange={setP} suffix="%" min={0} max={1000} /></div></div>
      ) : null}
      <div className="flex flex-wrap gap-2 text-xs">
        <button type="button" disabled={disabled || !dirty} onClick={() => onSave(m, m === "margin" ? p : null)} className="rounded-full px-4 py-1.5 text-xs font-black text-white disabled:opacity-40" style={{ background: "var(--t-accent)" }}>
          Guardar
        </button>
        {allowInherit && mode ? (
          <button type="button" disabled={disabled} onClick={() => onSave(null, null)} className="inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-bold" style={{ borderColor: "var(--t-card-border)" }}>
            <RotateCcw size={12} /> Usar el del punto
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** Límites para bajar el precio en el POS: por punto y excepciones por usuario. */
export function PriceLimits({ storeId }: { storeId: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const [tick, setTick] = useState(0);
  const load = useCallback(() => setTick((n) => n + 1), []);
  useEffect(() => {
    let alive = true;
    void supabaseBrowser().rpc("erp_price_limits_get", { p_store: storeId }).then(({ data: d, error: e }) => {
      if (!alive) return;
      if (e) return setError(/Could not find the function|schema cache/i.test(e.message) ? "Falta ejecutar en Supabase la migración 20261115_pos_limites_precio.sql." : rpcError(e));
      setError(null);
      setData(d as Data);
    });
    return () => { alive = false; };
  }, [storeId, tick]);

  async function save(point: string | null, user: string | null, mode: Mode | null, pct: number | null) {
    const { error: e } = await supabaseBrowser().rpc("erp_price_limit_save", { p_store: storeId, p_point: point, p_user: user, p_mode: mode, p_margin_pct: pct });
    if (e) return void Swal.fire({ icon: "error", title: "No se pudo guardar", html: esc(e.message), ...swalTheme });
    void Swal.fire({ icon: "success", title: "Límite guardado", timer: 1100, showConfirmButton: false, ...swalTheme });
    setOpen(null);
    load();
  }

  if (error) return <p className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm">{error}</p>;
  if (!data) return <p className="text-sm" style={{ color: "var(--t-muted)" }}>Cargando…</p>;
  const ro = !data.can_edit;

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border p-4" style={cardStyle}>
        <p className="text-sm font-black">🔐 ¿Hasta dónde pueden bajar el precio?</p>
        <p className="mt-1 text-xs" style={{ color: "var(--t-muted)" }}>
          Lo revisa la base de datos en cada venta (no solo la pantalla). Si un vendedor necesita más descuento, pide <b>autorización</b> y le llega un aviso con sonido a quien tenga el permiso <b>«Autorizar precios»</b>. El vendedor nunca ve el costo, solo hasta cuánto puede bajar.
          {ro ? " · Solo la madre con «Reglas de precio» puede cambiarlos." : ""}
        </p>
      </section>

      <section className="rounded-2xl border p-4" style={cardStyle}>
        <p className="flex items-center gap-1.5 text-sm font-black"><MapPin size={15} /> Por punto <span className="text-[11px] font-semibold" style={{ color: "var(--t-muted)" }}>(todos sus vendedores)</span></p>
        <ul className="mt-3 space-y-2">
          {data.points.map((p) => (
            <motion.li layout key={p.point_id} className="rounded-xl border p-3" style={{ borderColor: "var(--t-card-border)" }}>
              <button type="button" onClick={() => setOpen(open === p.point_id ? null : p.point_id)} className="flex w-full flex-wrap items-center gap-2 text-left">
                <span className="min-w-0 flex-1 text-sm font-bold">{p.kind === "warehouse" ? "🏬" : "📍"} {p.name}</span>
                <span className="rounded-full border px-2.5 py-0.5 text-[11px] font-bold" style={{ borderColor: "var(--t-card-border)" }}>{modeText(p.mode, p.margin_pct)}{p.mode ? "" : " (predeterminado)"}</span>
              </button>
              {open === p.point_id ? <div className="mt-3"><ModePicker mode={p.mode ?? "list"} pct={p.margin_pct} disabled={ro} onSave={(m, pct) => void save(p.point_id, null, m, pct)} /></div> : null}
            </motion.li>
          ))}
        </ul>
      </section>

      <section className="rounded-2xl border p-4" style={cardStyle}>
        <p className="flex items-center gap-1.5 text-sm font-black"><User size={15} /> Excepciones por usuario <span className="text-[11px] font-semibold" style={{ color: "var(--t-muted)" }}>(mandan sobre el punto)</span></p>
        <ul className="mt-3 space-y-2">
          {data.users.map((u) => {
            const pointMode = data.points.find((p) => p.point_id === u.point_id);
            return (
              <motion.li layout key={u.user_id} className="rounded-xl border p-3" style={{ borderColor: "var(--t-card-border)" }}>
                <button type="button" disabled={u.approver} onClick={() => setOpen(open === u.user_id ? null : u.user_id)} className="flex w-full flex-wrap items-center gap-2 text-left">
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-bold">{u.name}</span>
                    <span className="block text-[11px]" style={{ color: "var(--t-muted)" }}>{u.point_name ? `📍 ${u.point_name}` : "🏠 Madre"}</span>
                  </span>
                  {u.approver ? (
                    <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-[11px] font-bold text-emerald-400">🔓 Autoriza precios (sin límite)</span>
                  ) : (
                    <span className="rounded-full border px-2.5 py-0.5 text-[11px] font-bold" style={u.mode ? { borderColor: "var(--t-accent)" } : { borderColor: "var(--t-card-border)", color: "var(--t-muted)" }}>
                      {u.mode ? modeText(u.mode, u.margin_pct) : `Como su punto: ${modeText(pointMode?.mode ?? null, pointMode?.margin_pct ?? null)}`}
                    </span>
                  )}
                </button>
                {open === u.user_id && !u.approver ? (
                  <div className="mt-3"><ModePicker mode={u.mode} pct={u.margin_pct} disabled={ro} allowInherit onSave={(m, pct) => void save(null, u.user_id, m, pct)} /></div>
                ) : null}
              </motion.li>
            );
          })}
        </ul>
        <p className="mt-3 flex items-center gap-1 text-[11px]" style={{ color: "var(--t-muted)" }}><Lock size={11} /> Para que alguien no tenga límite y apruebe solicitudes, dale el permiso «Autorizar precios» en Usuarios.</p>
      </section>
    </div>
  );
}
