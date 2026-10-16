"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { RefreshCw, ShieldCheck } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { PERMISSION_GROUPS } from "@/lib/permissions";
import { playTone } from "@/lib/sounds/tones";

type Member = { permissions: string[] | null; role: string | null; point_id?: string | null; active: boolean | null };
type Change = { added: string[]; removed: string[]; role?: [string | null, string | null]; point?: string | null; pointChanged: boolean; deactivated: boolean };

const LABEL = new Map(PERMISSION_GROUPS.flatMap((g) => g.items.map((i) => [i.value as string, `${g.icon} ${i.label}`])));
const label = (p: string) => LABEL.get(p) ?? p;
const ROLE: Record<string, string> = { store_admin: "Administrador de la tienda", seller: "Vendedor", accounting: "Contabilidad", cashier: "Cajero" };

/**
 * Si el administrador cambia los permisos de este usuario mientras trabaja, le avisa al instante
 * qué se le dio y qué se le quitó, y le pide actualizar la página para que todo quede al día.
 * (Los permisos siempre los valida la base de datos; esto solo mantiene la pantalla al día.)
 */
export function PermissionChangeWatcher({ storeId, userId }: { storeId: string; userId: string }) {
  const base = useRef<Member | null>(null);
  const [change, setChange] = useState<Change | null>(null);
  const [minimized, setMinimized] = useState(false);

  const check = useCallback(async () => {
    const sb = supabaseBrowser();
    let res = await sb.from("store_users").select("permissions,role,point_id,active").eq("store_id", storeId).eq("user_id", userId).maybeSingle();
    if (res.error && /point_id/.test(res.error.message)) res = await sb.from("store_users").select("permissions,role,active").eq("store_id", storeId).eq("user_id", userId).maybeSingle();
    if (res.error) return;
    const now: Member = (res.data as Member | null) ?? { permissions: [], role: null, active: false };
    if (!base.current) { base.current = now; return; }
    const before = new Set(base.current.permissions ?? []);
    const after = new Set(now.permissions ?? []);
    const added = [...after].filter((p) => !before.has(p));
    const removed = [...before].filter((p) => !after.has(p));
    const roleChanged = (base.current.role ?? null) !== (now.role ?? null);
    const pointChanged = (base.current.point_id ?? null) !== (now.point_id ?? null);
    const deactivated = base.current.active !== false && now.active === false;
    if (!added.length && !removed.length && !roleChanged && !pointChanged && !deactivated) return;
    let point: string | null = null;
    if (pointChanged && now.point_id) {
      const { data } = await sb.from("erp_warehouses").select("name").eq("id", now.point_id).maybeSingle();
      point = (data as { name?: string } | null)?.name ?? null;
    }
    setChange((cur) => ({
      added: [...new Set([...(cur?.added ?? []), ...added])].filter((p) => !removed.includes(p)),
      removed: [...new Set([...(cur?.removed ?? []), ...removed])].filter((p) => !added.includes(p)),
      role: roleChanged ? [base.current!.role ?? null, now.role ?? null] : cur?.role,
      point: pointChanged ? point : cur?.point,
      pointChanged: pointChanged || Boolean(cur?.pointChanged),
      deactivated,
    }));
    base.current = now;
    setMinimized(false);
    playTone("campanita", 0.6);
  }, [storeId, userId]);

  useEffect(() => {
    const first = window.setTimeout(() => void check(), 1200);
    // Cada 60 s y al volver a la pestaña (sin conexión en vivo: la base igual valida cada permiso al instante).
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void check(); }, 60000);
    const onFocus = () => void check();
    window.addEventListener("focus", onFocus);
    return () => { window.clearTimeout(first); window.clearInterval(timer); window.removeEventListener("focus", onFocus); };
  }, [check, userId]);

  const reload = () => window.location.reload();

  return (
    <AnimatePresence>
      {change && !minimized ? (
        <motion.div key="perm" className="fixed inset-0 z-[160] grid place-items-center p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <div className="absolute inset-0 bg-black/55 backdrop-blur-sm" onClick={() => !change.deactivated && setMinimized(true)} />
          <motion.div role="alertdialog" aria-modal aria-labelledby="perm-title" initial={{ y: 24, scale: 0.96 }} animate={{ y: 0, scale: 1 }} exit={{ y: 24, scale: 0.96 }} transition={{ type: "spring", stiffness: 380, damping: 30 }}
            className="relative w-full max-w-md overflow-hidden rounded-3xl border shadow-2xl" style={{ borderColor: "var(--t-card-border)", background: "var(--t-bg-base)", color: "var(--t-text)" }}>
            <div className="h-1.5" style={{ background: change.deactivated ? "#ef4444" : "linear-gradient(90deg,#22c55e,#6366f1)" }} />
            <div className="p-5">
              <div className="flex items-center gap-3">
                <motion.span animate={{ rotate: [0, -10, 10, 0] }} transition={{ duration: 0.8, repeat: 2 }} className="grid h-11 w-11 place-items-center rounded-2xl" style={{ background: change.deactivated ? "rgba(239,68,68,.15)" : "rgba(99,102,241,.15)", color: change.deactivated ? "#f87171" : "#a5b4fc" }}>
                  <ShieldCheck size={22} />
                </motion.span>
                <div>
                  <p id="perm-title" className="text-lg font-black">{change.deactivated ? "⛔ Tu acceso fue desactivado" : "🔐 Tus permisos cambiaron"}</p>
                  <p className="text-xs" style={{ color: "var(--t-muted)" }}>{change.deactivated ? "Un administrador desactivó tu usuario en esta tienda." : "Un administrador acaba de actualizar tu acceso. Actualiza la página para verlo todo al día."}</p>
                </div>
              </div>

              {!change.deactivated ? (
                <div className="mt-4 max-h-[50vh] space-y-3 overflow-y-auto text-sm">
                  {change.added.length ? (
                    <div className="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-3">
                      <p className="text-xs font-black uppercase tracking-wide text-emerald-400">✅ Ahora puedes</p>
                      <ul className="mt-1.5 space-y-1">{change.added.map((p) => <li key={p} className="font-semibold">{label(p)}</li>)}</ul>
                    </div>
                  ) : null}
                  {change.removed.length ? (
                    <div className="rounded-2xl border border-red-500/40 bg-red-500/10 p-3">
                      <p className="text-xs font-black uppercase tracking-wide text-red-400">⛔ Ya no puedes</p>
                      <ul className="mt-1.5 space-y-1">{change.removed.map((p) => <li key={p} className="font-semibold">{label(p)}</li>)}</ul>
                    </div>
                  ) : null}
                  {change.role ? (
                    <p className="rounded-2xl border p-3" style={{ borderColor: "var(--t-card-border)" }}>👤 Tu rol ahora es <b>{ROLE[change.role[1] ?? ""] ?? change.role[1] ?? "—"}</b></p>
                  ) : null}
                  {change.pointChanged ? (
                    <p className="rounded-2xl border p-3" style={{ borderColor: "var(--t-card-border)" }}>📍 {change.point ? <>Ahora trabajas en <b>{change.point}</b></> : <>Ahora trabajas desde la <b>tienda madre</b></>}</p>
                  ) : null}
                </div>
              ) : null}

              <div className="mt-5 flex flex-col gap-2 text-sm sm:flex-row">
                <button type="button" onClick={reload} autoFocus className="inline-flex flex-1 items-center justify-center gap-2 rounded-2xl px-4 py-3 font-black text-white" style={{ background: change.deactivated ? "#ef4444" : "linear-gradient(135deg,#22c55e,#6366f1)" }}>
                  <RefreshCw size={16} /> {change.deactivated ? "Salir" : "Actualizar ahora"}
                </button>
                {!change.deactivated ? (
                  <button type="button" onClick={() => setMinimized(true)} className="rounded-2xl border px-4 py-3 font-bold" style={{ borderColor: "var(--t-card-border)" }}>Termino lo que hago</button>
                ) : null}
              </div>
            </div>
          </motion.div>
        </motion.div>
      ) : change && minimized ? (
        <motion.button key="pill" type="button" onClick={reload} initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 30, opacity: 0 }}
          className="fixed bottom-20 left-1/2 z-[140] inline-flex -translate-x-1/2 items-center gap-2 rounded-full px-4 py-2.5 text-sm font-black text-white shadow-2xl"
          style={{ background: "linear-gradient(135deg,#22c55e,#6366f1)" }}>
          <RefreshCw size={15} /> Tus permisos cambiaron · Actualizar
        </motion.button>
      ) : null}
    </AnimatePresence>
  );
}
