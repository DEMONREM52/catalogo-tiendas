"use client";

import { useCallback, useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

/** Lo que la base dice del acceso del usuario ahora mismo (20261127). */
export type MyAccess = { outside_schedule: boolean; schedule: { days: number[]; from_time: string; to_time: string } | null; expired: string[] };

const DAYS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
export const scheduleText = (s: { days: number[]; from_time: string; to_time: string }) =>
  `${[...s.days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((d) => DAYS[d]).join(", ")} · ${s.from_time} a ${s.to_time}`;

/** Horario y permisos temporales vencidos del usuario (la base ya los bloquea; aquí se ajusta lo que se ve). */
export function useMyAccess(storeId: string | null | undefined, enabled: boolean) {
  const [access, setAccess] = useState<MyAccess | null>(null);
  const load = useCallback(async () => {
    if (!storeId || !enabled) return setAccess(null);
    const { data, error } = await supabaseBrowser().rpc("erp_my_access", { p_store: storeId });
    const r = data as (MyAccess & { ok?: boolean }) | null;
    if (error || !r?.ok) return setAccess(null); // sin la migración: como antes
    setAccess({ outside_schedule: Boolean(r.outside_schedule), schedule: r.schedule ?? null, expired: r.expired ?? [] });
  }, [storeId, enabled]);
  useEffect(() => {
    const first = window.setTimeout(() => void load(), 0);
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, 5 * 60_000);
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => { window.clearTimeout(first); window.clearInterval(timer); window.removeEventListener("focus", onFocus); };
  }, [load]);
  return access;
}

/* ----------------------------- «Ver como este usuario» ----------------------------- */

export type Simulation = { storeId: string; userId: string; name: string; permissions: string[] };
const SIM_KEY = "remhub:simulate";

export function readSimulation(storeId: string | null | undefined): Simulation | null {
  if (!storeId) return null;
  try {
    const s = JSON.parse(window.sessionStorage.getItem(SIM_KEY) ?? "null") as Simulation | null;
    return s && s.storeId === storeId ? s : null;
  } catch {
    return null;
  }
}

export function startSimulation(sim: Simulation) {
  try { window.sessionStorage.setItem(SIM_KEY, JSON.stringify(sim)); } catch { /* sin almacenamiento */ }
  // Recarga completa a propósito: el panel arranca de cero con la vista del otro usuario.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.href = "/dashboard";
}

export function stopSimulation() {
  try { window.sessionStorage.removeItem(SIM_KEY); } catch { /* sin almacenamiento */ }
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.href = "/dashboard/store/users";
}

export function SimulationBanner({ sim }: { sim: Simulation }) {
  return (
    <div className="sticky top-0 z-130 flex flex-wrap items-center justify-center gap-2 px-3 py-2 text-xs font-semibold text-white" style={{ background: "linear-gradient(90deg,#7c3aed,#db2777)" }}>
      <span>👁️ Estás viendo el menú como <b>{sim.name}</b>. Solo cambia lo que se ve (menús, pestañas y botones); los datos y acciones siguen siendo los tuyos.</span>
      <button type="button" onClick={stopSimulation} className="rounded-full bg-white/20 px-3 py-1 font-bold hover:bg-white/30">Salir de la vista</button>
    </div>
  );
}

/* ----------------------------- fuera de horario ----------------------------- */

export function OutsideScheduleScreen({ access, onSignOut }: { access: MyAccess; onSignOut: () => void }) {
  return (
    <div className="fixed inset-0 z-200 grid place-items-center p-4 backdrop-blur-md" style={{ background: "color-mix(in oklab, var(--t-bg-base) 88%, transparent)", color: "var(--t-text)" }}>
      <div className="w-[min(440px,100%)] rounded-3xl border p-6 text-center shadow-2xl" style={{ borderColor: "var(--t-card-border)", background: "var(--t-bg-base)" }}>
        <p className="text-4xl">🕒</p>
        <h2 className="mt-2 text-lg font-black">Fuera de tu horario de acceso</h2>
        <p className="mt-2 text-sm" style={{ color: "var(--t-muted)" }}>
          {access.schedule ? <>Tu horario es <b style={{ color: "var(--t-text)" }}>{scheduleText(access.schedule)}</b> (hora Colombia).</> : "Tu acceso está limitado en este momento."}
          {" "}Si necesitas entrar ahora, pídeselo al administrador de la tienda.
        </p>
        <button type="button" onClick={onSignOut} className="mt-4 rounded-2xl border px-4 py-2 text-sm font-bold" style={{ borderColor: "var(--t-card-border)" }}>Cerrar sesión</button>
      </div>
    </div>
  );
}
