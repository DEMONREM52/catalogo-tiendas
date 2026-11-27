"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Flashlight, ScanBarcode, SwitchCamera, X } from "lucide-react";

/**
 * Lector con la cámara (aparte de la búsqueda por foto). Lo abre siempre una acción tuya y suelta la cámara al cerrar.
 *  · Con BarcodeDetector (Chrome/Edge en Android, Chrome en computador): códigos de barras y QR.
 *  · Sin él (iPhone/Safari, Firefox): solo QR, con jsQR (se carga al abrir). Para barras: lector USB/Bluetooth o Chrome en Android.
 * Una lectura (se cierra y entrega el código) o continua (sigue leyendo; el mismo código no se repite antes de 1,5 s).
 */

type Detector = { detect: (src: CanvasImageSource) => Promise<Array<{ rawValue: string; format?: string }>> };
type DetectorCtor = (new (o?: { formats?: string[] }) => Detector) & { getSupportedFormats?: () => Promise<string[]> };
const WANTED = ["qr_code", "code_128", "code_39", "code_93", "ean_13", "ean_8", "upc_a", "upc_e", "itf", "codabar", "data_matrix", "pdf417", "aztec"];
const FORMAT_LABEL: Record<string, string> = { qr_code: "QR", code_128: "CODE128", code_39: "CODE39", code_93: "CODE93", ean_13: "EAN-13", ean_8: "EAN-8", upc_a: "UPC-A", upc_e: "UPC-E", itf: "ITF", codabar: "Codabar", data_matrix: "Data Matrix", pdf417: "PDF417", aztec: "Aztec" };

export function scanBeep(ok: boolean) {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = ok ? 1250 : 220;
    g.gain.value = 0.08;
    o.connect(g); g.connect(ctx.destination); o.start();
    o.stop(ctx.currentTime + (ok ? 0.08 : 0.25));
    window.setTimeout(() => void ctx.close(), 400);
    navigator.vibrate?.(ok ? 30 : [60, 40, 60]);
  } catch { /* sin sonido */ }
}

const subscribeNoop = () => () => {};

export function CameraScanner({ title = "Escanear código", continuous = false, onCode, onClose, hint }: {
  title?: string;
  /** Sigue leyendo después de cada código (empacar, contar). */
  continuous?: boolean;
  onCode: (code: string, format: string | null) => void;
  onClose: () => void;
  hint?: string;
}) {
  const mounted = useSyncExternalStore(subscribeNoop, () => true, () => false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [state, setState] = useState<"starting" | "on" | "denied" | "nocamera">("starting");
  const [engine, setEngine] = useState<"native" | "qr" | null>(null);
  const [facing, setFacing] = useState<"environment" | "user">("environment");
  const [torch, setTorch] = useState<{ available: boolean; on: boolean }>({ available: false, on: false });
  const [last, setLast] = useState<{ code: string; format: string | null } | null>(null);
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const onCodeRef = useRef(onCode);
  useEffect(() => { onCodeRef.current = onCode; });

  useEffect(() => {
    let alive = true;
    let timer = 0;
    let stream: MediaStream | null = null;
    let lastHit = { code: "", at: 0 };
    void (async () => {
      if (!navigator.mediaDevices?.getUserMedia) { setState("nocamera"); return; }
      const Ctor = (window as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;
      let detector: Detector | null = null;
      if (Ctor) {
        try {
          const supported = (await Ctor.getSupportedFormats?.()) ?? WANTED;
          const formats = WANTED.filter((f) => supported.includes(f));
          detector = new Ctor({ formats: formats.length ? formats : undefined });
        } catch { detector = null; }
      }
      const jsqr = detector ? null : (await import("jsqr")).default;
      if (!alive) return;
      setEngine(detector ? "native" : "qr");
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      } catch (e) {
        if (alive) setState(e instanceof DOMException && e.name === "NotFoundError" ? "nocamera" : "denied");
        return;
      }
      if (!alive) { stream.getTracks().forEach((t) => t.stop()); return; }
      const track = stream.getVideoTracks()[0] ?? null;
      trackRef.current = track;
      const caps = (track?.getCapabilities?.() ?? {}) as MediaTrackCapabilities & { torch?: boolean };
      setTorch({ available: Boolean(caps.torch), on: false });
      const v = videoRef.current;
      if (!v) return;
      v.srcObject = stream;
      await v.play().catch(() => undefined);
      setState("on");
      const tick = async () => {
        if (!alive || !videoRef.current) return;
        let value: string | null = null;
        let format: string | null = null;
        try {
          if (detector) {
            const found = await detector.detect(videoRef.current);
            value = found[0]?.rawValue ?? null;
            format = found[0]?.format ?? null;
          } else if (jsqr && v.videoWidth) {
            const c = canvasRef.current ?? (canvasRef.current = document.createElement("canvas"));
            // Se lee el centro (zona del recuadro) a una resolución moderada: rápido en celulares.
            const side = Math.min(v.videoWidth, v.videoHeight) * 0.8;
            const scale = Math.min(1, 640 / side);
            c.width = Math.round(side * scale); c.height = c.width;
            const ctx = c.getContext("2d", { willReadFrequently: true });
            if (ctx) {
              ctx.drawImage(v, (v.videoWidth - side) / 2, (v.videoHeight - side) / 2, side, side, 0, 0, c.width, c.height);
              const img = ctx.getImageData(0, 0, c.width, c.height);
              const hit = jsqr(img.data, img.width, img.height, { inversionAttempts: "dontInvert" });
              if (hit?.data) { value = hit.data; format = "qr_code"; }
            }
          }
        } catch { /* cuadro sin código */ }
        const now = Date.now();
        if (value && (value !== lastHit.code || now - lastHit.at > 1500)) {
          lastHit = { code: value, at: now };
          scanBeep(true);
          setLast({ code: value, format });
          onCodeRef.current(value, format);
          if (!continuous) return;
        }
        timer = window.setTimeout(() => void tick(), detector ? 180 : 250);
      };
      void tick();
    })();
    return () => {
      alive = false;
      window.clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
      trackRef.current = null;
    };
  }, [facing, continuous]);

  // Esc cierra el lector (y no el pedido o la ventana de atrás).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  async function toggleTorch() {
    const t = trackRef.current;
    if (!t) return;
    try {
      await t.applyConstraints({ advanced: [{ torch: !torch.on } as MediaTrackConstraintSet] });
      setTorch((cur) => ({ ...cur, on: !cur.on }));
    } catch { setTorch({ available: false, on: false }); }
  }

  if (!mounted) return null;
  return createPortal(
    <div className="fixed inset-0 z-170 flex items-end justify-center bg-black/70 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={title}>
      <section className="w-full max-w-md overflow-hidden rounded-t-[26px] border sm:rounded-[26px]" style={{ borderColor: "var(--t-card-border)", background: "var(--t-bg-base)", color: "var(--t-text)" }}>
        <header className="flex items-center justify-between gap-2 px-4 py-3">
          <h3 className="flex items-center gap-2 text-base font-black"><ScanBarcode size={18} /> {title}</h3>
          <button type="button" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-full border" style={{ borderColor: "var(--t-card-border)" }} aria-label="Cerrar el lector"><X size={16} /></button>
        </header>
        <div className="relative aspect-[4/3] w-full bg-black">
          <video ref={videoRef} playsInline muted className="h-full w-full object-cover" />
          {state === "on" ? (
            <div className="pointer-events-none absolute inset-[12%] rounded-2xl border-2" style={{ borderColor: "rgba(255,255,255,.85)", boxShadow: "0 0 0 9999px rgba(0,0,0,.35)" }}>
              <div className="absolute inset-x-3 top-1/2 h-0.5 animate-pulse bg-red-500" />
            </div>
          ) : null}
          {state !== "on" ? (
            <p className="absolute inset-0 grid place-items-center p-6 text-center text-sm font-semibold text-white">
              {state === "starting" ? "Abriendo la cámara…" : state === "denied" ? "No se pudo abrir la cámara (permiso negado). Actívala en el candado de la barra de direcciones o usa un lector USB." : "Este equipo no tiene cámara. Usa un lector USB o Bluetooth."}
            </p>
          ) : null}
          <div className="absolute bottom-2 right-2 flex gap-2">
            {torch.available ? (
              <button type="button" onClick={() => void toggleTorch()} className="grid h-10 w-10 place-items-center rounded-full text-white" style={{ background: torch.on ? "#f59e0b" : "rgba(0,0,0,.55)" }} aria-label={torch.on ? "Apagar linterna" : "Encender linterna"}><Flashlight size={18} /></button>
            ) : null}
            <button type="button" onClick={() => setFacing((f) => (f === "environment" ? "user" : "environment"))} className="grid h-10 w-10 place-items-center rounded-full text-white" style={{ background: "rgba(0,0,0,.55)" }} aria-label="Cambiar de cámara"><SwitchCamera size={18} /></button>
          </div>
        </div>
        <div className="space-y-1 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 text-xs">
          {last ? <p className="rounded-xl px-3 py-2 font-bold" style={{ background: "color-mix(in oklab, #22c55e 14%, transparent)" }}>✓ {last.code}{last.format ? <span className="ml-1 font-semibold opacity-70">({FORMAT_LABEL[last.format] ?? last.format})</span> : null}</p> : null}
          <p style={{ color: "var(--t-muted)" }}>
            {engine === "qr" ? "En este navegador la cámara solo lee QR. Para códigos de barras usa un lector USB/Bluetooth o Chrome en Android." : "Apunta al código dentro del recuadro. Lee códigos de barras y QR."}
            {continuous ? " Sigue leyendo: escanea uno tras otro." : ""}
          </p>
          {hint ? <p style={{ color: "var(--t-muted)" }}>{hint}</p> : null}
        </div>
      </section>
    </div>,
    document.body,
  );
}
