"use client";

import { useEffect, useRef, useState } from "react";
import { ShieldCheck, ShieldAlert } from "lucide-react";
import { setSimulatedOffline, useNetStatus } from "@/lib/net/status";
import { askPersistentStorage, storageInfo, type StorageInfo } from "@/lib/offline/device";
import { cacheAge } from "@/lib/offline/cache";

type Props = {
  savedAt: number | null;
  products: number;
  clients: number;
  stockReady: boolean;
  fiscalOn: boolean;
  contingencyLeft: number;
  contingencyReason: string | null;
  pending: number;
  /** Al terminar la práctica se borran sus ventas. */
  onEndPractice: () => void;
};

/**
 * ¿Este equipo puede seguir vendiendo si se cae el internet? Muestra qué tiene guardado y deja
 * practicar con un «sin internet» simulado (solo esta pestaña, no toca nada real).
 */
export function OfflineReadiness(p: Props) {
  const net = useNetStatus();
  const [open, setOpen] = useState(false);
  const [storage, setStorage] = useState<StorageInfo | null>(null);
  // ¿La página del POS quedó guardada para abrirla sin internet? (la guarda el service worker al abrirla con conexión)
  const [pageSaved, setPageSaved] = useState<boolean | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    void storageInfo().then((s) => alive && setStorage(s));
    void (async () => {
      try {
        if (typeof caches === "undefined") return alive && setPageSaved(false);
        const names = (await caches.keys()).filter((k) => k.startsWith("remhub-pages-"));
        let hit = false;
        for (const n of names) if (await (await caches.open(n)).match("/dashboard/pos")) hit = true;
        if (alive) setPageSaved(hit);
      } catch {
        if (alive) setPageSaved(false);
      }
    })();
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => {
      alive = false;
      document.removeEventListener("mousedown", close);
    };
  }, [open]);

  const checks: Array<{ ok: boolean; label: string; detail: string }> = [
    {
      ok: Boolean(p.savedAt),
      label: "Productos y clientes guardados",
      detail: p.savedAt ? `${p.products.toLocaleString("es-CO")} productos · ${p.clients.toLocaleString("es-CO")} clientes · ${cacheAge(p.savedAt)}` : "Abre el POS con conexión una vez para guardarlos.",
    },
    {
      ok: pageSaved !== false,
      label: "Página del POS guardada",
      detail: pageSaved === null ? "Revisando…" : pageSaved ? "Abre aunque se recargue sin internet." : "Recarga esta página una vez con conexión (o instala la app) para que abra sin internet.",
    },
    { ok: p.stockReady, label: "Existencias del punto", detail: p.stockReady ? "Guardadas: sin conexión bajan con cada venta." : "Aún cargando o sin guardar." },
    ...(p.fiscalOn
      ? [{
          ok: p.contingencyLeft > 0,
          label: "Facturas de contingencia (papel)",
          detail: p.contingencyLeft > 0
            ? `${p.contingencyLeft} números listos en este equipo.`
            : p.contingencyReason ?? "Sin números: sin internet la factura electrónica se emitirá al volver.",
        }]
      : []),
    {
      ok: storage?.persisted !== false,
      label: "Almacenamiento del equipo",
      detail: storage === null ? "Revisando…" : storage.persisted ? `Protegido${storage.usageMb !== null ? ` · ${storage.usageMb} MB usados` : ""}.` : "El navegador podría borrarlo si se llena: toca «Proteger».",
    },
  ];
  const ready = checks.every((c) => c.ok);
  const color = net.simulated ? "#8b5cf6" : ready ? "#22c55e" : "#f59e0b";

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold"
        style={{ borderColor: `color-mix(in oklab, ${color} 55%, transparent)`, background: `color-mix(in oklab, ${color} 12%, transparent)` }}
        title="¿Este equipo puede vender sin internet?"
      >
        {ready ? <ShieldCheck size={14} style={{ color }} /> : <ShieldAlert size={14} style={{ color }} />}
        {net.simulated ? "Práctica sin internet" : ready ? "Listo sin internet" : "Preparar sin internet"}
        {p.pending ? <span className="rounded-full px-1.5 text-[10px] text-white" style={{ background: "#f59e0b" }}>{p.pending}</span> : null}
      </button>
      {open ? (
        <div className="absolute right-0 z-50 mt-2 w-[min(22rem,calc(100vw-2rem))] rounded-2xl border p-3 text-sm shadow-2xl"
          style={{ borderColor: "var(--t-card-border)", background: "var(--t-bg-base)", color: "var(--t-text)" }}>
          <p className="font-black">¿Puede este equipo vender sin internet?</p>
          <ul className="mt-2 space-y-2">
            {checks.map((c) => (
              <li key={c.label} className="flex gap-2">
                <span>{c.ok ? "✅" : "⚠️"}</span>
                <span className="min-w-0">
                  <b className="block text-xs">{c.label}</b>
                  <span className="text-xs" style={{ color: "var(--t-muted)" }}>{c.detail}</span>
                </span>
              </li>
            ))}
            <li className="flex gap-2">
              <span>☁️</span>
              <span className="text-xs"><b>Ventas sin enviar:</b> {p.pending}</span>
            </li>
          </ul>
          <div className="mt-3 flex flex-wrap gap-2">
            {storage && storage.persisted === false ? (
              <button type="button" className="rounded-full border px-3 py-1.5 text-xs font-bold" style={{ borderColor: "var(--t-card-border)" }}
                onClick={() => void askPersistentStorage().then(() => storageInfo()).then(setStorage)}>
                🔒 Proteger
              </button>
            ) : null}
            <button type="button" className="rounded-full px-3 py-1.5 text-xs font-bold text-white" style={{ background: net.simulated ? "#ef4444" : "#8b5cf6" }}
              onClick={() => {
                if (net.simulated) p.onEndPractice();
                setSimulatedOffline(!net.simulated);
              }}>
              {net.simulated ? "Terminar práctica" : "🎓 Practicar sin internet"}
            </button>
          </div>
          <p className="mt-2 text-[11px]" style={{ color: "var(--t-muted)" }}>
            La práctica simula la caída solo en esta pestaña. Sus ventas NO se registran (se borran al terminar) y sus facturas usan números «PRUEBA», no los reales de la DIAN.
          </p>
        </div>
      ) : null}
    </div>
  );
}
