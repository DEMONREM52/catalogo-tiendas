"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Flashlight, FlashlightOff, Loader2, Smartphone, X, ZoomIn } from "lucide-react";

/**
 * Cámara DENTRO de la página para la búsqueda por foto.
 *
 * Con <input capture> el celular abre su app de cámara y, si tiene poca memoria, Android cierra el navegador
 * mientras tanto: al volver la página se recarga y la foto se pierde. Aquí la cámara vive en la misma página:
 *  · pide una resolución moderada (720p; 480p en celulares lentos), suficiente para la huella y para leer texto;
 *  · enfoque continuo cuando la cámara lo permite, tocar para enfocar, linterna 🔦 y zoom ×2;
 *  · un recuadro muestra lo que el modelo mira (el cuadrado del centro);
 *  · si la persona sale de la app, la cámara se apaga (batería) y se vuelve a prender al volver.
 * Si no hay cámara o se niega el permiso, se usa la cámara del celular (onFallback).
 */

type Caps = MediaTrackCapabilities & { torch?: boolean; zoom?: { min: number; max: number }; focusMode?: string[] };
type Track = MediaStreamTrack;

export function cameraInPageSupported() {
  return typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia) && typeof window !== "undefined" && window.isSecureContext;
}

export function PhotoCamera({ weak, onShot, onFallback, onClose }: {
  weak: boolean;
  onShot: (photo: Blob) => void;
  /** No se pudo abrir aquí: usar la cámara del celular. */
  onFallback: () => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [state, setState] = useState<"starting" | "live" | "paused" | "shooting" | "error">("starting");
  const [caps, setCaps] = useState<Caps | null>(null);
  const [torch, setTorch] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  const [focusAt, setFocusAt] = useState<{ x: number; y: number } | null>(null);

  const track = () => streamRef.current?.getVideoTracks()[0] as Track | undefined;

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const start = useCallback(async () => {
    stop();
    setState("starting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: "environment" }, width: { ideal: weak ? 640 : 1280 }, height: { ideal: weak ? 480 : 720 }, frameRate: { ideal: weak ? 15 : 24, max: 30 } },
      });
      streamRef.current = stream;
      const v = videoRef.current;
      if (!v) return;
      v.srcObject = stream;
      await v.play().catch(() => {});
      const t = stream.getVideoTracks()[0] as Track | undefined;
      const c = (t?.getCapabilities?.() ?? null) as Caps | null;
      setCaps(c);
      if (c?.focusMode?.includes("continuous")) await t?.applyConstraints({ advanced: [{ focusMode: "continuous" } as MediaTrackConstraintSet] }).catch(() => {});
      setTorch(false);
      setZoomed(false);
      setState("live");
    } catch {
      // Sin permiso o sin cámara: se ofrece la del celular con un botón (abrirla sola no la deja el navegador).
      stop();
      setState("error");
    }
  }, [weak, stop]);

  useEffect(() => {
    const t = window.setTimeout(() => void start(), 0);
    const onVisibility = () => {
      if (document.hidden) {
        stop();
        setState("paused");
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("visibilitychange", onVisibility);
      stop();
    };
  }, [start, stop]);

  async function toggleTorch() {
    const next = !torch;
    try {
      await track()?.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] });
      setTorch(next);
    } catch {
      /* esta cámara no deja */
    }
  }

  async function toggleZoom() {
    const z = caps?.zoom;
    if (!z) return;
    const next = !zoomed;
    try {
      await track()?.applyConstraints({ advanced: [{ zoom: next ? Math.min(z.max, Math.max(z.min, 2)) : z.min } as MediaTrackConstraintSet] });
      setZoomed(next);
    } catch {
      /* esta cámara no deja */
    }
  }

  async function focusHere(e: React.PointerEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    setFocusAt({ x, y });
    window.setTimeout(() => setFocusAt(null), 700);
    const modes = caps?.focusMode ?? [];
    const mode = modes.includes("single-shot") ? "single-shot" : modes.includes("continuous") ? "continuous" : null;
    if (!mode) return;
    await track()?.applyConstraints({ advanced: [{ focusMode: mode, pointsOfInterest: [{ x, y }] } as MediaTrackConstraintSet] }).catch(() => {});
  }

  async function shoot() {
    const v = videoRef.current;
    if (!v || !v.videoWidth || state !== "live") return;
    setState("shooting");
    try {
      // El cuadro completo (hasta 1280 px), para que también se pueda leer el texto de la etiqueta.
      const scale = Math.min(1, 1280 / Math.max(v.videoWidth, v.videoHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(v.videoWidth * scale);
      canvas.height = Math.round(v.videoHeight * scale);
      canvas.getContext("2d")?.drawImage(v, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.9));
      if (!blob) throw new Error("sin foto");
      if (navigator.vibrate) navigator.vibrate(20);
      stop();
      onShot(blob);
    } catch {
      setState("live");
    }
  }

  return (
    <div className="absolute inset-0 z-40 flex flex-col bg-black text-white" role="dialog" aria-label="Cámara">
      <div className="relative min-h-0 flex-1 overflow-hidden" onPointerDown={(e) => void focusHere(e)}>
        <video ref={videoRef} playsInline muted autoPlay className="h-full w-full object-cover" />
        {/* Lo que mira el modelo: el cuadrado del centro */}
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <div className="aspect-square w-[min(78%,78vh)] max-w-[30rem] rounded-3xl border-2 border-white/85 shadow-[0_0_0_9999px_rgba(0,0,0,0.38)]" />
        </div>
        {focusAt ? (
          <span className="pointer-events-none absolute h-14 w-14 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-amber-300" style={{ left: `${focusAt.x * 100}%`, top: `${focusAt.y * 100}%` }} />
        ) : null}
        <p className="pointer-events-none absolute inset-x-0 top-3 px-14 text-center text-xs font-bold drop-shadow">Pon el producto dentro del cuadro · toca para enfocar</p>
        {state === "starting" || state === "shooting" ? (
          <div className="absolute inset-0 grid place-items-center bg-black/40"><Loader2 size={30} className="animate-spin" /></div>
        ) : null}
        {state === "error" ? (
          <div className="absolute inset-0 grid place-items-center bg-black/85 p-6 text-center">
            <div className="max-w-xs space-y-3">
              <p className="text-sm font-bold">No se pudo abrir la cámara aquí.</p>
              <p className="text-xs text-white/75">Puede que el permiso de cámara esté negado para RemHub. Usa la cámara del celular o vuelve a intentar.</p>
              <button type="button" onClick={onFallback} className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-white px-4 py-3 text-sm font-black text-black"><Smartphone size={17} /> Usar la cámara del celular</button>
              <button type="button" onClick={() => void start()} className="w-full rounded-2xl border border-white/30 px-4 py-2.5 text-xs font-bold">Intentar otra vez</button>
            </div>
          </div>
        ) : null}
        {state === "paused" ? (
          <button type="button" onClick={() => void start()} className="absolute inset-0 grid place-items-center bg-black/70 text-sm font-bold">
            <span className="inline-flex items-center gap-2 rounded-full bg-white/15 px-5 py-3"><Camera size={18} /> Toca para seguir</span>
          </button>
        ) : null}
        <button type="button" onClick={onClose} className="absolute right-3 top-3 grid h-10 w-10 place-items-center rounded-full bg-black/55" aria-label="Cerrar cámara">
          <X size={18} />
        </button>
      </div>
      <div className="flex shrink-0 items-center justify-between gap-3 px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
        <div className="flex w-24 gap-2">
          {caps?.torch ? (
            <button type="button" onClick={() => void toggleTorch()} className={`grid h-11 w-11 place-items-center rounded-full ${torch ? "bg-amber-400 text-black" : "bg-white/15"}`} aria-label={torch ? "Apagar linterna" : "Prender linterna"}>
              {torch ? <FlashlightOff size={18} /> : <Flashlight size={18} />}
            </button>
          ) : null}
          {caps?.zoom && caps.zoom.max >= 1.5 ? (
            <button type="button" onClick={() => void toggleZoom()} className={`grid h-11 w-11 place-items-center rounded-full text-xs font-black ${zoomed ? "bg-white text-black" : "bg-white/15"}`} aria-label="Acercar">
              {zoomed ? "×2" : <ZoomIn size={18} />}
            </button>
          ) : null}
        </div>
        <button type="button" onClick={() => void shoot()} disabled={state !== "live"} className="grid h-[72px] w-[72px] place-items-center rounded-full border-4 border-white/90 disabled:opacity-50" aria-label="Tomar foto">
          <span className="h-14 w-14 rounded-full bg-white transition active:scale-90" />
        </button>
        <div className="flex w-24 justify-end">
          <button type="button" onClick={() => { stop(); onFallback(); }} className="flex flex-col items-center gap-0.5 text-[10px] font-semibold text-white/80" title="Usar la app de cámara del celular">
            <Smartphone size={18} /> Cámara del celular
          </button>
        </div>
      </div>
    </div>
  );
}
