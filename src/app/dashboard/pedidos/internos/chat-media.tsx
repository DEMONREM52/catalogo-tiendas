"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronLeft, ChevronRight, Download, Pause, Play, X } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";

/**
 * Archivos del chat de pedidos internos (20261267): fotos, videos y audios en el almacenamiento privado
 * «chat-media» (<tienda>/<pedido>/<archivo>), con enlaces firmados para verlos.
 */

export type Attachment = { type: "image" | "video" | "audio"; path: string; mime?: string; size?: number; duration?: number; width?: number; height?: number };
export type Pending = { id: string; file: File; type: Attachment["type"]; preview: string; progress: number; duration?: number; width?: number; height?: number };

export const MAX_BYTES = 50 * 1024 * 1024;
const BUCKET = "chat-media";

export function kindOf(file: File): Attachment["type"] | null {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("audio/")) return "audio";
  return null;
}

/** Foto más liviana: máximo 1600 px y JPG al 82 % (los GIF se dejan como están). */
export async function prepareImage(file: File): Promise<{ file: File; width?: number; height?: number }> {
  if (file.type === "image/gif") return { file };
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
    if (scale === 1 && file.size < 900_000) return { file, width: w, height: h };
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d")?.drawImage(bmp, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.82));
    if (!blob || blob.size >= file.size) return { file, width: w, height: h };
    return { file: new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" }), width: w, height: h };
  } catch {
    return { file };
  }
}

/** Duración y tamaño de un video o audio (para mostrarlos antes de abrirlos). */
export function mediaMeta(file: File, type: "video" | "audio"): Promise<{ duration?: number; width?: number; height?: number }> {
  return new Promise((resolve) => {
    const el = document.createElement(type);
    const url = URL.createObjectURL(file);
    const done = (v: { duration?: number; width?: number; height?: number }) => { URL.revokeObjectURL(url); resolve(v); };
    el.preload = "metadata";
    el.onloadedmetadata = () => done({
      duration: Number.isFinite(el.duration) ? Math.round(el.duration) : undefined,
      ...(type === "video" ? { width: (el as HTMLVideoElement).videoWidth || undefined, height: (el as HTMLVideoElement).videoHeight || undefined } : {}),
    });
    el.onerror = () => done({});
    el.src = url;
  });
}

const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov", "audio/webm": "webm", "audio/mp4": "m4a", "audio/mpeg": "mp3", "audio/ogg": "ogg" };

/** Sube un archivo con progreso real (XHR al almacenamiento, con la sesión del usuario). Devuelve la ruta. */
export async function uploadChatFile(storeId: string, requestId: string, file: File, onProgress: (p: number) => void): Promise<string> {
  const sb = supabaseBrowser();
  const { data } = await sb.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Inicia sesión de nuevo.");
  const ext = EXT[file.type.split(";")[0]] ?? (file.name.split(".").pop() || "bin").toLowerCase().slice(0, 5);
  const path = `${storeId}/${requestId}/${crypto.randomUUID()}.${ext}`;
  const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`;
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.setRequestHeader("apikey", process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "");
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.setRequestHeader("x-upsert", "false");
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(xhr.status === 413 ? "El archivo pesa demasiado (máximo 50 MB)." : /bucket not found/i.test(xhr.responseText) ? "Falta ejecutar en Supabase la migración 20261267_chat_multimedia.sql." : "No se pudo subir el archivo.")));
    xhr.onerror = () => reject(new Error("Sin conexión: no se pudo subir el archivo."));
    xhr.send(file);
  });
  return path;
}

// Enlaces firmados (1 hora), guardados para no pedirlos otra vez.
const signed = new Map<string, { url: string; until: number }>();
export function useSignedUrls(paths: string[]) {
  const key = paths.join("|");
  const [, bump] = useState(0);
  useEffect(() => {
    const now = Date.now();
    const missing = paths.filter((p) => !signed.has(p) || signed.get(p)!.until < now + 60_000);
    if (!missing.length) return;
    let alive = true;
    void supabaseBrowser().storage.from(BUCKET).createSignedUrls(missing, 3600).then(({ data }) => {
      for (const d of data ?? []) if (d.path && d.signedUrl) signed.set(d.path, { url: d.signedUrl, until: Date.now() + 3500_000 });
      if (alive) bump((x) => x + 1);
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return (p: string) => signed.get(p)?.url ?? null;
}

const clock = (s?: number) => {
  const v = Math.max(0, Math.round(s ?? 0));
  return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, "0")}`;
};

/* ------------------------------------------------------------------ grabar audio */

type RecState = { mr: MediaRecorder; chunks: Blob[]; stream: MediaStream; ctx: AudioContext; started: number; timer: number; raf: number; resolve?: (f: File | null) => void; cancel?: boolean };

/** Grabadora de notas de voz con nivel en vivo (para la onda). */
export function useRecorder() {
  const [state, setState] = useState<"idle" | "recording">("idle");
  const [elapsed, setElapsed] = useState(0);
  const [levels, setLevels] = useState<number[]>([]);
  const rec = useRef<RecState | null>(null);

  const start = useCallback(async () => {
    if (rec.current) return;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    const type = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"].find((t) => MediaRecorder.isTypeSupported?.(t)) ?? "";
    const mr = new MediaRecorder(stream, type ? { mimeType: type, audioBitsPerSecond: 48000 } : undefined);
    const chunks: Blob[] = [];
    mr.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const buf = new Uint8Array(analyser.frequencyBinCount);
    const r: RecState = { mr, chunks, stream, ctx, started: Date.now(), timer: 0, raf: 0 };
    const tick = () => {
      analyser.getByteTimeDomainData(buf);
      let peak = 0;
      for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));
      setLevels((l) => [...l.slice(-39), Math.min(1, peak / 64)]);
      r.raf = requestAnimationFrame(tick);
    };
    r.raf = requestAnimationFrame(tick);
    r.timer = window.setInterval(() => setElapsed(Math.round((Date.now() - r.started) / 1000)), 250);
    mr.onstop = () => {
      cancelAnimationFrame(r.raf);
      window.clearInterval(r.timer);
      stream.getTracks().forEach((t) => t.stop());
      void ctx.close();
      const mime = (mr.mimeType || "audio/webm").split(";")[0];
      const file = r.cancel || !chunks.length ? null : new File(chunks, `audio.${mime.includes("mp4") ? "m4a" : "webm"}`, { type: mime });
      rec.current = null;
      setState("idle");
      setElapsed(0);
      setLevels([]);
      r.resolve?.(file);
    };
    rec.current = r;
    mr.start(250);
    setState("recording");
  }, []);

  /** Termina: devuelve el audio (o null si se canceló) y su duración. */
  const stop = useCallback((cancel = false) => new Promise<{ file: File | null; duration: number }>((resolve) => {
    const r = rec.current;
    if (!r) return resolve({ file: null, duration: 0 });
    const duration = Math.round((Date.now() - r.started) / 1000);
    r.cancel = cancel;
    r.resolve = (file) => resolve({ file, duration });
    r.mr.stop();
  }), []);

  useEffect(() => () => { if (rec.current) { rec.current.cancel = true; rec.current.mr.stop(); } }, []);
  return { state, elapsed, levels, start, stop };
}

/* ------------------------------------------------------------------ reproductor de audio */

export function AudioPlayer({ src, duration, mine }: { src: string | null; duration?: number; mine?: boolean }) {
  const el = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0);
  const [dur, setDur] = useState(duration ?? 0);
  const [rate, setRate] = useState(1);
  // Onda fija (decorativa) a partir de la ruta: siempre igual para el mismo audio.
  const bars = Array.from({ length: 32 }, (_, i) => 0.25 + 0.75 * Math.abs(Math.sin((i + 1) * 1.7 + (src?.length ?? 3))));
  const pct = dur ? Math.min(1, t / dur) : 0;
  const color = mine ? "#fff" : "var(--t-accent)";
  return (
    <div className="flex w-64 max-w-full items-center gap-2.5">
      <button type="button" disabled={!src} onClick={() => { const a = el.current; if (!a) return; if (a.paused) void a.play(); else a.pause(); }}
        className="grid h-10 w-10 shrink-0 place-items-center rounded-full transition active:scale-95 disabled:opacity-50" style={{ background: mine ? "rgba(255,255,255,.22)" : "color-mix(in oklab, var(--t-accent) 18%, transparent)", color }} aria-label={playing ? "Pausar" : "Reproducir"}>
        {playing ? <Pause size={18} /> : <Play size={18} className="translate-x-px" />}
      </button>
      <div className="min-w-0 flex-1">
        <div className="relative flex h-7 cursor-pointer items-center gap-[2px]" onClick={(e) => {
          const a = el.current; if (!a || !dur) return;
          const r = e.currentTarget.getBoundingClientRect();
          a.currentTime = ((e.clientX - r.left) / r.width) * dur;
        }}>
          {bars.map((h, i) => (
            <span key={i} className="flex-1 rounded-full" style={{ height: `${h * 100}%`, background: color, opacity: i / bars.length <= pct ? 1 : 0.35 }} />
          ))}
        </div>
        <div className="mt-0.5 flex items-center justify-between text-[10px] opacity-80">
          <span className="tabular-nums">{clock(playing || t ? t : dur)}</span>
          <button type="button" onClick={() => { const n = rate === 1 ? 1.5 : rate === 1.5 ? 2 : 1; setRate(n); if (el.current) el.current.playbackRate = n; }} className="rounded-full px-1.5 font-bold" style={{ background: mine ? "rgba(255,255,255,.2)" : "var(--t-card-bg-soft)" }}>{rate}×</button>
        </div>
      </div>
      {src ? (
        <audio ref={el} src={src} preload="metadata" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => { setPlaying(false); setT(0); }}
          onTimeUpdate={(e) => setT(e.currentTarget.currentTime)} onLoadedMetadata={(e) => { if (Number.isFinite(e.currentTarget.duration)) setDur(e.currentTarget.duration); }} />
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ archivos de un mensaje */

export function MessageMedia({ items, mine }: { items: Attachment[]; mine?: boolean }) {
  const url = useSignedUrls(items.map((a) => a.path));
  const [view, setView] = useState<number | null>(null);
  const images = items.filter((a) => a.type === "image");
  const others = items.filter((a) => a.type !== "image");
  return (
    <div className="space-y-1.5">
      {images.length ? (
        <div className={`grid gap-1 overflow-hidden rounded-xl ${images.length === 1 ? "grid-cols-1" : "grid-cols-2"}`}>
          {images.slice(0, 4).map((a, i) => {
            const src = url(a.path);
            const more = i === 3 && images.length > 4 ? images.length - 4 : 0;
            return (
              <button key={a.path} type="button" onClick={() => setView(i)} className="relative block overflow-hidden bg-black/20" style={{ aspectRatio: images.length === 1 && a.width && a.height ? `${a.width} / ${a.height}` : "1 / 1", maxHeight: 320 }}>
                {src ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={src} alt="Foto" loading="lazy" className="h-full w-full object-cover transition hover:scale-105" />
                ) : <span className="block h-full w-full animate-pulse bg-white/10" />}
                {more ? <span className="absolute inset-0 grid place-items-center bg-black/55 text-xl font-black text-white">+{more}</span> : null}
              </button>
            );
          })}
        </div>
      ) : null}
      {others.map((a) => {
        const src = url(a.path);
        return a.type === "video" ? (
          <video key={a.path} src={src ?? undefined} controls playsInline preload="metadata" className="max-h-80 w-full rounded-xl bg-black" />
        ) : (
          <AudioPlayer key={a.path} src={src} duration={a.duration} mine={mine} />
        );
      })}
      <Lightbox items={images.map((a) => url(a.path))} index={view} onClose={() => setView(null)} onIndex={setView} />
    </div>
  );
}

/** Visor de fotos a pantalla completa: flechas, deslizar con el teclado y descargar. */
function Lightbox({ items, index, onClose, onIndex }: { items: Array<string | null>; index: number | null; onClose: () => void; onIndex: (i: number) => void }) {
  useEffect(() => {
    if (index === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") onIndex((index + 1) % items.length);
      if (e.key === "ArrowLeft") onIndex((index - 1 + items.length) % items.length);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, items.length, onClose, onIndex]);
  if (typeof document === "undefined") return null;
  return createPortal(
    <AnimatePresence>
      {index !== null ? (
        <motion.div key="lb" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[300] grid place-items-center bg-black/90 p-4" onClick={onClose}>
          <AnimatePresence mode="wait">
            <motion.img key={index} src={items[index] ?? undefined} alt="Foto" initial={{ scale: 0.92, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ opacity: 0 }}
              drag="x" dragConstraints={{ left: 0, right: 0 }} onDragEnd={(_, i) => { if (i.offset.x < -60) onIndex((index + 1) % items.length); if (i.offset.x > 60) onIndex((index - 1 + items.length) % items.length); }}
              onClick={(e) => e.stopPropagation()} className="max-h-[88dvh] max-w-full rounded-lg object-contain shadow-2xl" />
          </AnimatePresence>
          <div className="absolute right-4 top-4 flex gap-2" onClick={(e) => e.stopPropagation()}>
            {items[index] ? <a href={items[index]!} download target="_blank" rel="noreferrer" className="grid h-10 w-10 place-items-center rounded-full bg-white/15 text-white" aria-label="Descargar"><Download size={18} /></a> : null}
            <button type="button" onClick={onClose} className="grid h-10 w-10 place-items-center rounded-full bg-white/15 text-white" aria-label="Cerrar"><X size={18} /></button>
          </div>
          {items.length > 1 ? (
            <>
              <button type="button" onClick={(e) => { e.stopPropagation(); onIndex((index - 1 + items.length) % items.length); }} className="absolute left-3 grid h-11 w-11 place-items-center rounded-full bg-white/15 text-white" aria-label="Anterior"><ChevronLeft /></button>
              <button type="button" onClick={(e) => { e.stopPropagation(); onIndex((index + 1) % items.length); }} className="absolute right-3 grid h-11 w-11 place-items-center rounded-full bg-white/15 text-white" aria-label="Siguiente"><ChevronRight /></button>
              <p className="absolute bottom-4 text-sm text-white/80">{index + 1} / {items.length}</p>
            </>
          ) : null}
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}

export { clock };
