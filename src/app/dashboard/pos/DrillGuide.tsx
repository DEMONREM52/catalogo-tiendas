"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import Swal from "sweetalert2";
import { GraduationCap, X } from "lucide-react";
import { setSimulatedOffline, useNetStatus } from "@/lib/net/status";
import type { PosDraft } from "@/lib/pos/drafts";
import { draftKind } from "@/lib/pos/drafts";
import {
  PRACTICE_PRINT_EVENT, completeDrill, dayMonth, flushPendingDrill, loadDrillStatus, monthName, readActiveDrill, startDrill, writeActiveDrill,
  type ActiveDrill, type DrillStatus,
} from "@/lib/pos/drill";

const swalTheme = { background: "#0b0b0b", color: "#fff" } as const;

function Row({ ok, children }: { ok: boolean; children: ReactNode }) {
  return <li className="flex gap-2"><span>{ok ? "✅" : "⬜"}</span><span className="min-w-0">{children}</span></li>;
}

/**
 * Simulacro mensual en el POS: aviso para empezarlo y guía paso a paso mientras se practica
 * (sin internet simulado → venta de contado → factura de contingencia si el punto factura → imprimir → terminar).
 */
export function DrillGuide({ storeId, pointId, fiscalOn, practice }: { storeId: string | undefined; pointId: string; fiscalOn: boolean; practice: PosDraft[] }) {
  const net = useNetStatus();
  const reach = net.online && net.db !== "down";
  const [status, setStatus] = useState<DrillStatus | null>(null);
  const [active, setActive] = useState<ActiveDrill | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [open, setOpen] = useState(true);

  const refresh = useCallback(async () => {
    if (!storeId) return;
    await flushPendingDrill(storeId);
    setStatus(await loadDrillStatus(storeId));
  }, [storeId]);

  useEffect(() => {
    if (!storeId) return;
    // Un simulacro empezado sigue aunque se recargue la página (mientras la pestaña siga abierta).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setActive(readActiveDrill(storeId));
  }, [storeId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (reach && !net.simulated) void refresh();
  }, [reach, net.simulated, refresh]);

  // Paso «imprimir»: el POS avisa cuando se imprime un comprobante de práctica.
  useEffect(() => {
    if (!storeId || !active) return;
    const onPrint = () => {
      const next = { ...active, printed: true };
      writeActiveDrill(storeId, next);
      setActive(next);
    };
    window.addEventListener(PRACTICE_PRINT_EVENT, onPrint);
    return () => window.removeEventListener(PRACTICE_PRINT_EVENT, onPrint);
  }, [storeId, active]);

  const begin = useCallback(async () => {
    if (!storeId) return;
    const go = await Swal.fire({
      ...swalTheme,
      icon: "info",
      title: "🎓 Simulacro: vender sin internet",
      html: `<div style="text-align:left;line-height:1.6">Vamos a fingir que se cayó el internet (solo en esta pestaña). Nada de lo que hagas se registra.<br/><br/>
        1. Haz una venta de contado.<br/>${fiscalOn && status?.include_fiscal !== false ? "2. Haz una factura (sale como factura de contingencia de práctica).<br/>3. Imprime el comprobante.<br/>4. Toca «Terminar simulacro»." : "2. Imprime el comprobante.<br/>3. Toca «Terminar simulacro»."}</div>`,
      showCancelButton: true,
      confirmButtonText: "Empezar",
      cancelButtonText: "Ahora no",
      confirmButtonColor: "#8b5cf6",
    });
    if (!go.isConfirmed) return;
    try {
      await startDrill(storeId, pointId);
    } catch (e) {
      await Swal.fire({ ...swalTheme, icon: "warning", title: "No se pudo empezar", text: e instanceof Error ? e.message : String(e) });
      return;
    }
    const a: ActiveDrill = { startedAt: Date.now(), printed: false, skipPrint: false };
    writeActiveDrill(storeId, a);
    setActive(a);
    setOpen(true);
    setSimulatedOffline(true);
  }, [storeId, pointId, fiscalOn, status?.include_fiscal]);

  // /dashboard/pos?simulacro=1 (desde la campana o el recordatorio): abre el inicio del simulacro.
  useEffect(() => {
    if (!storeId || !status) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("simulacro") !== "1") return;
    params.delete("simulacro");
    window.history.replaceState(null, "", `${window.location.pathname}${params.toString() ? `?${params}` : ""}`);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!readActiveDrill(storeId)) void begin();
  }, [storeId, status, begin]);

  if (!storeId) return null;

  if (!active) {
    const pending = status?.enabled && status.must && !status.mine?.completed_at;
    if (!pending || dismissed) return null;
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border p-3 text-sm" style={{ borderColor: "color-mix(in oklab, #8b5cf6 50%, transparent)", background: "color-mix(in oklab, #8b5cf6 10%, var(--t-card-bg))" }}>
        <GraduationCap size={20} style={{ color: "#8b5cf6" }} />
        <span className="min-w-0 flex-1">
          <b className="block">Simulacro de {monthName(status!.period)}: practica vender sin internet</b>
          <span className="text-xs" style={{ color: "var(--t-muted)" }}>2 minutos, no se registra nada. {status!.overdue ? "Ya pasó el día límite." : `Hazlo antes del ${dayMonth(status!.due_date)}.`}</span>
        </span>
        <button type="button" onClick={() => void begin()} className="rounded-full px-4 py-1.5 text-xs font-bold text-white" style={{ background: "#8b5cf6" }}>Empezar</button>
        <button type="button" onClick={() => setDismissed(true)} className="text-xs underline" style={{ color: "var(--t-muted)" }}>Ahora no</button>
      </div>
    );
  }

  const since = (d: PosDraft) => new Date(d.createdAt).getTime() >= active.startedAt - 1000;
  const mine = practice.filter(since);
  const needContingency = fiscalOn && status?.include_fiscal !== false;
  const steps = {
    offline: net.simulated,
    sale: mine.length > 0,
    contingency: needContingency ? mine.some((d) => draftKind(d) === "contingencia") : null,
    print: active.printed || active.skipPrint,
  };
  const ready = steps.sale && (steps.contingency ?? true) && steps.print;

  async function finish() {
    if (!storeId || !active) return;
    setSimulatedOffline(false);
    const seconds = (Date.now() - active.startedAt) / 1000;
    const r = await completeDrill(storeId, { sale: steps.sale, contingency: steps.contingency, print: active.printed ? true : "skip", ended: true }, seconds);
    if (!r.ok) {
      await Swal.fire({ ...swalTheme, icon: "warning", title: "No se pudo guardar el simulacro", text: r.message });
      return;
    }
    writeActiveDrill(storeId, null);
    setActive(null);
    await Swal.fire({
      ...swalTheme,
      icon: "success",
      title: "¡Simulacro completo! ✅",
      html: `Ya sabes qué hacer si se cae el internet.${r.queued ? "<br/><small>Se guarda en RemHub apenas vuelva la conexión.</small>" : ""}<br/><small>Las ventas de práctica se borraron.</small>`,
      confirmButtonColor: "#22c55e",
    });
    void refresh();
  }

  async function quit() {
    if (!storeId) return;
    const go = await Swal.fire({ ...swalTheme, icon: "question", title: "¿Salir del simulacro?", text: "Las ventas de práctica se borran. Puedes hacerlo otra vez cuando quieras.", showCancelButton: true, confirmButtonText: "Salir", cancelButtonText: "Seguir practicando" });
    if (!go.isConfirmed) return;
    setSimulatedOffline(false);
    writeActiveDrill(storeId, null);
    setActive(null);
  }

  return (
    <div className="fixed bottom-24 right-3 z-[160] w-[min(20rem,calc(100vw-1.5rem))] rounded-2xl border p-3 text-sm shadow-2xl lg:bottom-5"
      style={{ borderColor: "color-mix(in oklab, #8b5cf6 55%, transparent)", background: "var(--t-bg-base)", color: "var(--t-text)" }}>
      <div className="flex items-center gap-2">
        <GraduationCap size={18} style={{ color: "#8b5cf6" }} />
        <b className="min-w-0 flex-1">Simulacro sin internet</b>
        <button type="button" onClick={() => setOpen((v) => !v)} className="text-xs underline">{open ? "Ocultar" : "Ver pasos"}</button>
        <button type="button" onClick={() => void quit()} aria-label="Salir del simulacro"><X size={15} /></button>
      </div>
      {open ? (
        <>
          <ul className="mt-2 space-y-1.5 text-xs">
            <Row ok={steps.offline}>
              Sin internet simulado{!steps.offline ? <> · <button type="button" className="font-bold underline" onClick={() => setSimulatedOffline(true)}>volver a simular</button></> : null}
            </Row>
            <Row ok={steps.sale}>Haz una venta de contado (escoge productos y cobra)</Row>
            {steps.contingency !== null ? <Row ok={steps.contingency}>Haz una <b>factura</b>: sale como factura de contingencia de práctica</Row> : null}
            <Row ok={steps.print}>
              Imprime el comprobante{!steps.print ? <> · <button type="button" className="underline" onClick={() => { const n = { ...active, skipPrint: true }; writeActiveDrill(storeId, n); setActive(n); }}>no tengo impresora</button></> : null}
            </Row>
          </ul>
          <button type="button" disabled={!ready} onClick={() => void finish()} className="mt-3 w-full rounded-full px-4 py-2 text-xs font-bold text-white disabled:opacity-40" style={{ background: "#22c55e" }}>
            Terminar simulacro
          </button>
        </>
      ) : null}
    </div>
  );
}
