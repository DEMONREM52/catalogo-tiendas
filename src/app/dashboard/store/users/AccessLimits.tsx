"use client";

import { useState } from "react";
import Swal from "sweetalert2";
import { supabaseBrowser } from "@/lib/supabase/client";
import { DateField, ddmmyyyy } from "@/components/forms/Fields";
import { PERMISSION_LIST, permissionLabel } from "@/lib/permissions";
import { scheduleText } from "../../AccessGuard";

export type AccessGrant = { user_id: string; permission: string; expires_at: string; expired: boolean; note: string | null; by: string | null };
export type AccessSchedule = { user_id: string; active: boolean; days: number[]; from_time: string; to_time: string };
export type AccessOverview = { ok: boolean; grants: AccessGrant[]; schedules: AccessSchedule[] };

const swal = { background: "var(--t-bg-base)", color: "var(--t-text)", confirmButtonColor: "#8b5cf6" };
const DAY_CHIPS: Array<[number, string]> = [[1, "L"], [2, "M"], [3, "X"], [4, "J"], [5, "V"], [6, "S"], [0, "D"]];
const box = { borderColor: "var(--t-card-border)", background: "var(--t-card-bg)", color: "var(--t-text)" } as const;
const pad = (n: number) => String(n).padStart(2, "0");
/** «AAAA-MM-DDTHH:MM» en hora local dentro de N horas. */
const inHours = (h: number) => { const d = new Date(Date.now() + h * 3_600_000); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const tonight = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T23:59`; };
const whenText = (iso: string) => `${ddmmyyyy(iso.slice(0, 10))} ${new Date(iso).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" })}`;

function errText(e: unknown) { return (e as { message?: string })?.message ?? String(e); }

/** Permisos temporales y horario de acceso de un usuario (los valida la base). */
export function AccessLimits({ storeId, userId, name, permissions, overview, onChanged }: {
  storeId: string; userId: string; name: string; permissions: string[]; overview: AccessOverview | null; onChanged: () => void;
}) {
  const grants = (overview?.grants ?? []).filter((g) => g.user_id === userId);
  const current = (overview?.schedules ?? []).find((s) => s.user_id === userId) ?? null;
  const [perm, setPerm] = useState("");
  const [until, setUntil] = useState(inHours(24));
  const [note, setNote] = useState("");
  const [days, setDays] = useState<number[]>(current?.days ?? [1, 2, 3, 4, 5, 6]);
  const [from, setFrom] = useState(current?.from_time ?? "07:00");
  const [to, setTo] = useState(current?.to_time ?? "20:00");
  const [busy, setBusy] = useState(false);

  if (!overview?.ok) {
    return <p className="text-[11px]" style={{ color: "var(--t-muted)" }}>⏳ Para permisos temporales y horarios ejecuta la migración 20261127_permisos_temporales_horario.sql.</p>;
  }
  const temporal = new Set(grants.map((g) => g.permission));
  const options = PERMISSION_LIST.filter((p) => !permissions.includes(p.value) || temporal.has(p.value));

  async function run(fn: string, args: Record<string, unknown>, ok: string) {
    setBusy(true);
    const { error } = await supabaseBrowser().rpc(fn, args);
    setBusy(false);
    if (error) return void Swal.fire({ ...swal, icon: "error", title: "No se pudo guardar", text: errText(error) });
    void Swal.fire({ ...swal, icon: "success", title: ok, timer: 1300, showConfirmButton: false });
    onChanged();
  }

  const grant = () => {
    if (!perm) return void Swal.fire({ ...swal, icon: "warning", title: "Escoge el permiso" });
    if (!until) return void Swal.fire({ ...swal, icon: "warning", title: "Escoge hasta cuándo" });
    void run("erp_permission_grant_temp", { p_store: storeId, p_user: userId, p_permission: perm, p_expires: new Date(until).toISOString(), p_note: note || null },
      `${permissionLabel(perm)} para ${name} hasta ${whenText(new Date(until).toISOString())}`);
    setPerm(""); setNote("");
  };

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <div className="rounded-2xl border p-3" style={{ borderColor: "var(--t-card-border)" }}>
        <p className="text-sm font-bold">⏳ Permisos temporales</p>
        <p className="mb-2 text-[11px]" style={{ color: "var(--t-muted)" }}>Ej.: «puede anular hasta el viernes» para cubrir un turno. Al vencer deja de servir solo.</p>
        {grants.length ? (
          <ul className="mb-2 space-y-1.5 text-xs">
            {grants.map((g) => (
              <li key={g.permission} className="flex flex-wrap items-center gap-2 rounded-xl border px-2.5 py-1.5" style={{ borderColor: g.expired ? "rgba(239,68,68,.5)" : "var(--t-card-border)" }}>
                <span className="min-w-0 flex-1"><b>{permissionLabel(g.permission)}</b> · {g.expired ? "⛔ venció" : "hasta"} {whenText(g.expires_at)}{g.note ? ` · ${g.note}` : ""}</span>
                <button type="button" disabled={busy} className="underline" onClick={() => void run("erp_permission_temp_end", { p_store: storeId, p_user: userId, p_permission: g.permission, p_keep: true }, "Ahora es permanente")}>Dejar fijo</button>
                <button type="button" disabled={busy} className="underline" style={{ color: "#ef4444" }} onClick={() => void run("erp_permission_temp_end", { p_store: storeId, p_user: userId, p_permission: g.permission, p_keep: false }, "Permiso quitado")}>Quitar</button>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="grid gap-2">
          <select className="w-full rounded-xl border px-3 py-2 text-sm" style={box} value={perm} onChange={(e) => setPerm(e.target.value)}>
            <option value="">Escoge un permiso…</option>
            {options.map((p) => <option key={p.value} value={p.value}>{p.label}{temporal.has(p.value) ? " (cambiar fecha)" : ""}</option>)}
          </select>
          <DateField withTime value={until} onChange={setUntil} ariaLabel="Hasta" />
          <div className="flex flex-wrap gap-1.5 text-[11px]">
            {([["Hoy (fin del día)", tonight()], ["2 horas", inHours(2)], ["1 día", inHours(24)], ["3 días", inHours(72)], ["1 semana", inHours(168)]] as Array<[string, string]>).map(([l, v]) => (
              <button key={l} type="button" onClick={() => setUntil(v)} className="rounded-full border px-2.5 py-1 font-semibold" style={{ borderColor: "var(--t-card-border)" }}>{l}</button>
            ))}
          </div>
          <input className="w-full rounded-xl border px-3 py-2 text-sm" style={box} placeholder="Motivo (opcional)" value={note} onChange={(e) => setNote(e.target.value)} />
          <button type="button" disabled={busy} onClick={grant} className="rounded-xl px-3 py-2 text-sm font-bold text-white disabled:opacity-60" style={{ background: "linear-gradient(135deg, var(--t-accent), var(--t-accent2, var(--t-accent)))" }}>Dar permiso temporal</button>
        </div>
      </div>

      <div className="rounded-2xl border p-3" style={{ borderColor: "var(--t-card-border)" }}>
        <p className="text-sm font-bold">🕒 Horario de acceso</p>
        <p className="mb-2 text-[11px]" style={{ color: "var(--t-muted)" }}>
          {current ? <>Actual: <b>{scheduleText(current)}</b>. </> : "Sin horario: puede entrar a cualquier hora. "}Fuera del horario no puede hacer nada (hora Colombia).
        </p>
        <div className="mb-2 flex flex-wrap gap-1.5">
          {DAY_CHIPS.map(([d, l]) => {
            const on = days.includes(d);
            return (
              <button key={d} type="button" onClick={() => setDays(on ? days.filter((x) => x !== d) : [...days, d])} className="h-8 w-8 rounded-full border text-xs font-bold"
                style={on ? { background: "var(--t-accent)", color: "#fff", borderColor: "transparent" } : { borderColor: "var(--t-card-border)" }}>{l}</button>
            );
          })}
        </div>
        <div className="mb-2 grid grid-cols-2 gap-2 text-xs">
          <label>Entrada<input className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" style={box} inputMode="numeric" placeholder="07:00" value={from} onChange={(e) => setFrom(e.target.value.replace(/[^\d:]/g, "").slice(0, 5))} /></label>
          <label>Salida<input className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" style={box} inputMode="numeric" placeholder="20:00" value={to} onChange={(e) => setTo(e.target.value.replace(/[^\d:]/g, "").slice(0, 5))} /></label>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={() => {
            if (!/^\d{2}:\d{2}$/.test(from) || !/^\d{2}:\d{2}$/.test(to)) return void Swal.fire({ ...swal, icon: "warning", title: "Escribe las horas como HH:MM (24 horas)" });
            void run("erp_access_schedule_save", { p_store: storeId, p_user: userId, p_cfg: { active: true, days, from_time: from, to_time: to } }, "Horario guardado");
          }} className="rounded-xl px-3 py-2 text-sm font-bold text-white disabled:opacity-60" style={{ background: "linear-gradient(135deg, var(--t-accent), var(--t-accent2, var(--t-accent)))" }}>Guardar horario</button>
          {current ? <button type="button" disabled={busy} onClick={() => void run("erp_access_schedule_save", { p_store: storeId, p_user: userId, p_cfg: null }, "Horario quitado")} className="rounded-xl border px-3 py-2 text-sm font-bold" style={{ borderColor: "var(--t-card-border)" }}>Quitar horario</button> : null}
        </div>
      </div>
    </div>
  );
}
