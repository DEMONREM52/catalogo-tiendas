"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { supabaseBrowser } from "@/lib/supabase/client";

/**
 * Contar escaneando (opcional): cada lectura suma 1 al producto.
 *  · Con la cámara del celular (navegadores con BarcodeDetector: Chrome en Android, Edge…).
 *  · Con un lector USB/Bluetooth o escribiendo el código y Enter (funciona en cualquier equipo).
 * Busca por código de barras o referencia. Si se da `allowed`, solo cuenta esos productos (ej. los del traslado).
 */

export type ScanCount = { product_id: string; name: string; sku: string | null; qty: number };
type Detector = { detect: (src: CanvasImageSource) => Promise<Array<{ rawValue: string }>> };
type DetectorCtor = new (o?: { formats?: string[] }) => Detector;

function beep(ok: boolean) {
  try {
    const Ctx = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
    const ctx = new Ctx();
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.frequency.value = ok ? 1250 : 220; g.gain.value = 0.08;
    o.connect(g); g.connect(ctx.destination); o.start();
    o.stop(ctx.currentTime + (ok ? 0.08 : 0.25));
    window.setTimeout(() => void ctx.close(), 400);
    if (navigator.vibrate) navigator.vibrate(ok ? 30 : [60, 40, 60]);
  } catch { /* sin sonido */ }
}

export function ScanCounter({ storeId, title, allowed, initial, onDone, onClose, zeroOthersLabel }: {
  storeId: string;
  title: string;
  /** Solo estos productos cuentan (id → nombre). Si no viene, cualquier producto de la tienda. */
  allowed?: Map<string, { name: string; sku: string | null; max?: number }>;
  initial?: ScanCount[];
  onDone: (counts: ScanCount[], zeroOthers: boolean) => void;
  onClose: () => void;
  /** Si viene, se ofrece «poner en 0 lo que no escaneé» con este texto. */
  zeroOthersLabel?: string;
}) {
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  const [counts, setCounts] = useState<ScanCount[]>(initial ?? []);
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [camera, setCamera] = useState<"off" | "on" | "unsupported" | "denied">("off");
  const [zeroOthers, setZeroOthers] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const lastRef = useRef<{ code: string; at: number }>({ code: "", at: 0 });
  const cache = useRef(new Map<string, { id: string; name: string; sku: string | null } | null>());

  const lookup = useCallback(async (raw: string) => {
    const c = raw.trim();
    if (!c) return null;
    if (cache.current.has(c)) return cache.current.get(c) ?? null;
    if (allowed) {
      for (const [id, p] of allowed) if (p.sku && p.sku.toLowerCase() === c.toLowerCase()) { const hit = { id, name: p.name, sku: p.sku }; cache.current.set(c, hit); return hit; }
    }
    const safe = c.replace(/[,()*%\\"]/g, "");
    const { data } = await supabaseBrowser().from("products").select("id,name,sku,barcode").eq("store_id", storeId)
      .or(`barcode.eq.${safe},sku.ilike.${safe}`).limit(5);
    const rows = (data ?? []) as Array<{ id: string; name: string; sku: string | null }>;
    const hit = (allowed ? rows.find((r) => allowed.has(r.id)) : rows[0]) ?? null;
    cache.current.set(c, hit);
    return hit;
  }, [storeId, allowed]);

  const register = useCallback(async (raw: string) => {
    const c = raw.trim();
    if (!c) return;
    const hit = await lookup(c);
    if (!hit) { beep(false); setMsg({ ok: false, text: allowed ? `«${c}» no está en esta lista` : `No hay ningún producto con el código «${c}»` }); return; }
    const max = allowed?.get(hit.id)?.max;
    let over = false;
    setCounts((cur) => {
      const found = cur.find((x) => x.product_id === hit.id);
      const next = (found?.qty ?? 0) + 1;
      if (max !== undefined && next > max) { over = true; return cur; }
      return found ? cur.map((x) => (x.product_id === hit.id ? { ...x, qty: next } : x)) : [{ product_id: hit.id, name: hit.name, sku: hit.sku, qty: 1 }, ...cur];
    });
    window.setTimeout(() => {
      if (over) { beep(false); setMsg({ ok: false, text: `${hit.name}: ya completaste las ${max} que se enviaron` }); }
      else { beep(true); setMsg({ ok: true, text: `+1 ${hit.name}` }); }
    }, 0);
  }, [lookup, allowed]);

  // Cámara: lee el código cada 250 ms; el mismo código no se repite antes de 1,2 s.
  useEffect(() => {
    if (camera !== "on") return;
    const Ctor = (window as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;
    if (!Ctor) { const t = window.setTimeout(() => setCamera("unsupported"), 0); return () => window.clearTimeout(t); }
    let alive = true;
    let timer = 0;
    const detector = new Ctor({ formats: ["ean_13", "ean_8", "code_128", "code_39", "upc_a", "upc_e", "itf", "qr_code"] });
    void navigator.mediaDevices?.getUserMedia({ video: { facingMode: "environment" }, audio: false }).then((stream) => {
      if (!alive) { stream.getTracks().forEach((t) => t.stop()); return; }
      streamRef.current = stream;
      const v = videoRef.current;
      if (!v) return;
      v.srcObject = stream;
      void v.play();
      const tick = async () => {
        if (!alive || !videoRef.current) return;
        try {
          const found = await detector.detect(videoRef.current);
          const value = found[0]?.rawValue;
          const now = Date.now();
          if (value && (value !== lastRef.current.code || now - lastRef.current.at > 1200)) {
            lastRef.current = { code: value, at: now };
            void register(value);
          }
        } catch { /* cuadro sin código */ }
        timer = window.setTimeout(() => void tick(), 250);
      };
      void tick();
    }).catch(() => setCamera("denied"));
    return () => {
      alive = false;
      window.clearTimeout(timer);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [camera, register]);

  useEffect(() => { const t = window.setTimeout(() => inputRef.current?.focus(), 50); return () => window.clearTimeout(t); }, []);

  const total = counts.reduce((s, c) => s + c.qty, 0);
  const setQty = (id: string, qty: number) => setCounts((cur) => cur.map((x) => (x.product_id === id ? { ...x, qty: Math.max(0, qty) } : x)).filter((x) => x.qty > 0));

  if (!mounted) return null;
  return createPortal(
    <div className="fixed inset-0 z-[160] flex items-end justify-center p-0 sm:items-center sm:p-3" style={{ background: "rgba(0,0,0,.6)" }}>
      <div role="dialog" aria-modal="true" aria-label={title} className="flex max-h-[95dvh] w-full max-w-lg flex-col rounded-t-2xl border p-4 shadow-2xl sm:rounded-2xl" style={{ borderColor: "var(--t-card-border)", background: "var(--t-bg-base)", color: "var(--t-text)" }}>
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-base font-black">📷 {title}</h3>
          <button type="button" onClick={onClose} className="rounded-lg border px-2.5 py-1 text-xs font-semibold" style={{ borderColor: "var(--t-card-border)" }}>Cancelar</button>
        </div>
        {camera === "on" ? (
          <video ref={videoRef} playsInline muted className="mt-3 aspect-video w-full rounded-xl bg-black object-cover" />
        ) : (
          <button type="button" onClick={() => setCamera("on")} className="mt-3 rounded-xl border px-3 py-2.5 text-sm font-bold" style={{ borderColor: "var(--t-card-border)" }}>
            📷 Usar la cámara
          </button>
        )}
        {camera === "unsupported" ? <p className="mt-1 text-xs text-amber-500">Este navegador no lee códigos con la cámara. Usa Chrome en Android, un lector USB o escribe el código.</p> : null}
        {camera === "denied" ? <p className="mt-1 text-xs text-amber-500">No se pudo abrir la cámara (permiso negado). Usa un lector o escribe el código.</p> : null}
        <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); void register(code); setCode(""); }}>
          <input ref={inputRef} value={code} onChange={(e) => setCode(e.target.value)} placeholder="Escanea con el lector o escribe el código y Enter"
            className="min-w-0 flex-1 rounded-xl border px-3 py-2.5 text-sm" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)", color: "var(--t-text)" }} aria-label="Código" />
          <button type="submit" className="rounded-xl px-3 text-sm font-bold text-white" style={{ background: "var(--t-cta)" }}>+1</button>
        </form>
        {msg ? <p className="mt-1 text-sm font-semibold" style={{ color: msg.ok ? "#10b981" : "#ef4444" }}>{msg.ok ? "✅" : "⚠️"} {msg.text}</p> : null}
        <div className="mt-3 flex-1 space-y-1 overflow-y-auto">
          {counts.length === 0 ? <p className="py-4 text-center text-sm" style={{ color: "var(--t-muted)" }}>Todavía no has escaneado nada.</p> : null}
          {counts.map((c) => (
            <div key={c.product_id} className="flex items-center gap-2 rounded-xl border px-3 py-2 text-sm" style={{ borderColor: "var(--t-card-border)" }}>
              <span className="min-w-0 flex-1 truncate"><b>{c.name}</b>{c.sku ? <span className="text-xs" style={{ color: "var(--t-muted)" }}> · {c.sku}</span> : null}</span>
              <button type="button" onClick={() => setQty(c.product_id, c.qty - 1)} className="h-8 w-8 rounded-lg border" style={{ borderColor: "var(--t-card-border)" }} aria-label="Menos">−</button>
              <b className="w-10 text-center tabular-nums">{c.qty}</b>
              <button type="button" onClick={() => setQty(c.product_id, c.qty + 1)} className="h-8 w-8 rounded-lg border" style={{ borderColor: "var(--t-card-border)" }} aria-label="Más">+</button>
            </div>
          ))}
        </div>
        {zeroOthersLabel ? (
          <label className="mt-2 flex items-center gap-2 text-xs"><input type="checkbox" checked={zeroOthers} onChange={(e) => setZeroOthers(e.target.checked)} /> {zeroOthersLabel}</label>
        ) : null}
        <button type="button" onClick={() => onDone(counts, zeroOthers)} disabled={!counts.length && !zeroOthers}
          className="mt-3 rounded-xl px-3 py-3 text-sm font-bold text-white disabled:opacity-50" style={{ background: "var(--t-cta)" }}>
          ✅ Usar este conteo ({counts.length} productos · {total} unidades)
        </button>
      </div>
    </div>,
    document.body,
  );
}
