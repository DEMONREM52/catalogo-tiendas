"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Camera, ChevronRight, ImagePlus, Loader2, RotateCcw, ScanSearch, Search, Type, X } from "lucide-react";
import { embedImageBlob, imageSearchSupported, onEmbedProgress, warmUpImageSearch, type EmbedProgress } from "@/lib/image-search/embed";

export type FinderHit = {
  id: string;
  name: string;
  image_url: string | null;
  code?: string | null;
  price?: number | null;
  meta?: string | null;
  score?: number | null;
  disabled?: boolean;
};

export type FinderSource = {
  /** Búsqueda por nombre, código o código de barras. */
  searchText: (q: string) => Promise<FinderHit[]>;
  /** Búsqueda por foto: recibe la huella de la foto. indexed = productos con fotos analizadas. */
  searchPhoto?: (embedding: number[]) => Promise<{ items: FinderHit[]; indexed: number }>;
};

export type FinderMode = "text" | "photo";

type Props = {
  open: boolean;
  onClose: () => void;
  source: FinderSource;
  onPick: (hit: FinderHit) => void;
  title?: string;
  subtitle?: string;
  /** Texto del botón de cada resultado («Ver más», «Agregar», «Editar»…). */
  pickLabel?: string;
  initialMode?: FinderMode;
  /** Recuerda la última búsqueda (sessionStorage) para retomarla al volver. */
  storageKey?: string;
  /** Contenido extra al final de cada resultado (p. ej. existencias). */
  renderExtra?: (hit: FinderHit) => ReactNode;
};

type Saved = { mode: FinderMode; q: string; photoHits: FinderHit[] | null; photoUrl: string | null };

const money = (n: number) => `$${Number(n || 0).toLocaleString("es-CO")}`;

export function matchLabel(score: number) {
  if (score >= 0.85) return { text: "Casi idéntico", color: "#16a34a" };
  if (score >= 0.72) return { text: "Muy parecido", color: "#22c55e" };
  if (score >= 0.58) return { text: "Parecido", color: "#d97706" };
  return { text: "Poco parecido", color: "#94a3b8" };
}

function readSaved(key?: string): Saved | null {
  if (!key) return null;
  try {
    const raw = sessionStorage.getItem(`finder:${key}`);
    return raw ? (JSON.parse(raw) as Saved) : null;
  } catch {
    return null;
  }
}

function writeSaved(key: string | undefined, value: Saved) {
  if (!key) return;
  try {
    sessionStorage.setItem(`finder:${key}`, JSON.stringify(value));
  } catch {
    /* sin almacenamiento: no pasa nada */
  }
}

/** Buscador de productos por nombre, código o foto, en una ventana (abajo en celular, centrada en computador). */
export function ProductFinder(props: Props) {
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  if (!mounted) return null;
  return createPortal(
    <AnimatePresence>
      {props.open ? <FinderSheet key="finder" {...props} /> : null}
    </AnimatePresence>,
    document.body,
  );
}

function FinderSheet({ onClose, source, onPick, title = "Buscar producto", subtitle, pickLabel = "Ver más", initialMode, storageKey, renderExtra }: Props) {
  const [saved] = useState(() => readSaved(storageKey));
  const photoOk = Boolean(source.searchPhoto) && imageSearchSupported();
  const [mode, setMode] = useState<FinderMode>(() => (initialMode === "photo" && photoOk ? "photo" : initialMode ?? (saved?.mode === "photo" && photoOk ? "photo" : "text")));
  const [q, setQ] = useState(saved?.q ?? "");
  const [textHits, setTextHits] = useState<FinderHit[] | null>(null);
  const [textLoading, setTextLoading] = useState(false);
  const [photoUrl, setPhotoUrl] = useState<string | null>(saved?.photoUrl ?? null);
  const [photoHits, setPhotoHits] = useState<FinderHit[] | null>(saved?.photoHits ?? null);
  const [photoState, setPhotoState] = useState<"idle" | "loading" | "searching" | "error">("idle");
  const [photoMsg, setPhotoMsg] = useState<string | null>(null);
  const [progress, setProgress] = useState<EmbedProgress | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const reqId = useRef(0);

  // Escape cierra; se bloquea el scroll de la página.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  useEffect(() => {
    if (mode === "text") window.setTimeout(() => inputRef.current?.focus(), 120);
    else warmUpImageSearch();
  }, [mode]);

  useEffect(() => onEmbedProgress((p) => setProgress(p)), []);

  // Búsqueda por texto con una pausa corta.
  useEffect(() => {
    const term = q.trim();
    const id = ++reqId.current;
    const t = window.setTimeout(async () => {
      if (!term) {
        setTextHits(null);
        return;
      }
      setTextLoading(true);
      try {
        const hits = await source.searchText(term);
        if (id === reqId.current) setTextHits(hits);
      } catch {
        if (id === reqId.current) setTextHits([]);
      } finally {
        if (id === reqId.current) setTextLoading(false);
      }
    }, 240);
    return () => window.clearTimeout(t);
  }, [q, source]);

  useEffect(() => {
    writeSaved(storageKey, { mode, q, photoHits, photoUrl: photoUrl?.startsWith("data:") ? photoUrl : null });
  }, [storageKey, mode, q, photoHits, photoUrl]);

  // Pegar una imagen (Ctrl+V) en modo foto.
  useEffect(() => {
    if (mode !== "photo") return;
    const onPaste = (e: ClipboardEvent) => {
      const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith("image/"));
      if (file) void searchByPhoto(file);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  });

  async function searchByPhoto(file: Blob) {
    if (!source.searchPhoto) return;
    setPhotoMsg(null);
    setPhotoHits(null);
    setPhotoState("loading");
    try {
      setPhotoUrl(await previewOf(file));
      const embedding = await embedImageBlob(file);
      setPhotoState("searching");
      const res = await source.searchPhoto(embedding);
      setPhotoHits(res.items);
      setPhotoState("idle");
      if (!res.indexed) setPhotoMsg("Las fotos de este catálogo todavía se están preparando para la búsqueda por foto. Intenta de nuevo en un rato o busca por nombre o código.");
      else if (!res.items.length) setPhotoMsg("No encontramos productos parecidos. Prueba con otra foto, más de cerca y con buena luz.");
    } catch (error) {
      setPhotoState("error");
      setPhotoMsg(error instanceof Error && /fetch|network|import/i.test(error.message)
        ? "No se pudo preparar la búsqueda por foto. Revisa tu conexión a internet e inténtalo de nuevo."
        : "No se pudo analizar la foto. Intenta con otra imagen.");
    }
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) void searchByPhoto(file);
  }

  const busyPhoto = photoState === "loading" || photoState === "searching";

  return (
    <motion.div className="fixed inset-0 z-[130] flex items-end justify-center sm:items-center sm:p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <button type="button" aria-label="Cerrar" className="absolute inset-0 cursor-default bg-black/55 backdrop-blur-[3px]" onClick={onClose} />
      <motion.section
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-[28px] border shadow-[0_30px_90px_rgba(0,0,0,0.45)] sm:max-h-[86dvh] sm:max-w-2xl sm:rounded-[28px]"
        style={{ borderColor: "var(--t-card-border)", background: "var(--t-bg-base)", color: "var(--t-text)" }}
        initial={{ y: 60, opacity: 0, scale: 0.98 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        exit={{ y: 60, opacity: 0, scale: 0.98 }}
        transition={{ type: "spring", stiffness: 380, damping: 34 }}
      >
        <header className="flex items-start justify-between gap-3 px-5 pb-3 pt-4">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-lg font-black"><ScanSearch size={20} style={{ color: "var(--t-accent)" }} /> {title}</h2>
            <p className="mt-0.5 text-xs" style={{ color: "var(--t-muted)" }}>{subtitle ?? "Busca por nombre, código o con una foto."}</p>
          </div>
          <button type="button" onClick={onClose} className="grid h-9 w-9 shrink-0 place-items-center rounded-full border transition hover:rotate-90" style={{ borderColor: "var(--t-card-border)" }} aria-label="Cerrar">
            <X size={16} />
          </button>
        </header>

        {photoOk ? (
          <div className="px-5">
            <div className="grid grid-cols-2 gap-1 rounded-2xl border p-1" style={{ borderColor: "var(--t-card-border)" }} role="tablist">
              {([["text", "Nombre o código", <Type key="t" size={15} />], ["photo", "Foto", <Camera key="c" size={15} />]] as const).map(([value, label, icon]) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={mode === value}
                  onClick={() => setMode(value)}
                  className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl px-2 py-2 text-sm font-bold transition-all duration-200"
                  style={mode === value
                    ? { color: "#fff", background: "linear-gradient(135deg, var(--t-accent), var(--t-accent2, var(--t-accent)))", boxShadow: "0 6px 18px color-mix(in oklab, var(--t-accent) 35%, transparent)" }
                    : { color: "var(--t-text)", background: "transparent" }}
                >
                  {icon}{label}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="mt-3 min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5">
          {mode === "text" ? (
            <>
              <div className="sticky top-0 z-10 pb-3" style={{ background: "var(--t-bg-base)" }}>
                <div className="relative">
                  <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 opacity-60" />
                  <input
                    ref={inputRef}
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && textHits?.[0] && !textHits[0].disabled) onPick(textHits[0]);
                    }}
                    type="search"
                    enterKeyHint="search"
                    placeholder="Nombre o código (ej: olla, 125, OLL-01)…"
                    className="w-full rounded-2xl border py-3 text-sm outline-none"
                    style={{ borderColor: "var(--t-card-border)", background: "color-mix(in oklab, var(--t-card-bg) 92%, transparent)", color: "var(--t-text)", paddingLeft: "2.6rem", paddingRight: "2.6rem" }}
                  />
                  {textLoading ? <Loader2 size={16} className="absolute right-3.5 top-1/2 -translate-y-1/2 animate-spin opacity-60" /> : null}
                </div>
              </div>
              {textHits === null ? (
                <Hint icon={<Search size={22} />} text="Escribe parte del nombre o el código del producto. No importan las tildes ni el orden de las palabras." />
              ) : textHits.length === 0 && !textLoading ? (
                <Hint icon="🔎" text={`No encontramos «${q.trim()}». Revisa el código o prueba con otra palabra${photoOk ? ", o busca con una foto" : ""}.`} />
              ) : (
                <ul className="space-y-2">
                  {textHits.map((hit) => <HitRow key={hit.id} hit={hit} pickLabel={pickLabel} onPick={onPick} extra={renderExtra?.(hit)} />)}
                </ul>
              )}
            </>
          ) : (
            <>
              <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onFile} />
              <input ref={galleryRef} type="file" accept="image/*" className="hidden" onChange={onFile} />
              {!photoUrl && !busyPhoto ? (
                <div
                  onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragging(false);
                    const file = [...e.dataTransfer.files].find((f) => f.type.startsWith("image/"));
                    if (file) void searchByPhoto(file);
                  }}
                  className="rounded-[24px] border-2 border-dashed p-5 text-center transition sm:p-8"
                  style={{ borderColor: dragging ? "var(--t-accent)" : "var(--t-card-border)", background: dragging ? "color-mix(in oklab, var(--t-accent) 8%, transparent)" : "transparent" }}
                >
                  <div className="mx-auto grid h-16 w-16 place-items-center rounded-3xl" style={{ background: "color-mix(in oklab, var(--t-accent) 14%, transparent)", color: "var(--t-accent)" }}>
                    <Camera size={30} />
                  </div>
                  <p className="mt-3 text-base font-black">Busca con una foto</p>
                  <p className="mx-auto mt-1 max-w-sm text-xs leading-5" style={{ color: "var(--t-muted)" }}>
                    Toma una foto del producto (o elige una imagen) y te mostramos los productos más parecidos del catálogo.
                  </p>
                  <div className="mt-4 grid gap-2 sm:grid-cols-2">
                    <button type="button" onClick={() => cameraRef.current?.click()} className="inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-bold text-white shadow-lg transition hover:-translate-y-0.5" style={{ background: "linear-gradient(135deg, var(--t-accent), var(--t-accent2, var(--t-accent)))" }}>
                      <Camera size={17} /> Tomar foto
                    </button>
                    <button type="button" onClick={() => galleryRef.current?.click()} className="inline-flex items-center justify-center gap-2 rounded-2xl border px-4 py-3 text-sm font-bold transition hover:-translate-y-0.5" style={{ borderColor: "var(--t-card-border)" }}>
                      <ImagePlus size={17} /> Elegir imagen
                    </button>
                  </div>
                  <p className="mt-3 hidden text-[11px] sm:block" style={{ color: "var(--t-muted)" }}>También puedes arrastrar una imagen aquí o pegarla con Ctrl + V.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-3 rounded-2xl border p-2.5" style={{ borderColor: "var(--t-card-border)" }}>
                    {photoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={photoUrl} alt="Tu foto" className="h-16 w-16 shrink-0 rounded-xl object-cover" />
                    ) : (
                      <span className="grid h-16 w-16 shrink-0 place-items-center rounded-xl" style={{ background: "color-mix(in oklab, var(--t-text) 6%, transparent)" }}><Camera size={22} /></span>
                    )}
                    <div className="min-w-0 flex-1">
                      {busyPhoto ? (
                        <>
                          <p className="flex items-center gap-2 text-sm font-bold"><Loader2 size={15} className="animate-spin" />
                            {photoState === "searching" ? "Buscando los más parecidos…" : progress && progress.stage !== "ready" ? "Preparando la búsqueda por foto…" : "Analizando la foto…"}
                          </p>
                          {photoState === "loading" && progress && progress.stage !== "ready" ? (
                            <>
                              <div className="mt-2 h-1.5 overflow-hidden rounded-full" style={{ background: "color-mix(in oklab, var(--t-text) 10%, transparent)" }}>
                                <motion.div className="h-full rounded-full" style={{ background: "var(--t-accent)" }} animate={{ width: `${Math.max(6, progress.percent)}%` }} />
                              </div>
                              <p className="mt-1 text-[11px]" style={{ color: "var(--t-muted)" }}>Solo la primera vez (unos segundos). Después es inmediato.</p>
                            </>
                          ) : null}
                        </>
                      ) : (
                        <>
                          <p className="text-sm font-bold">{photoHits?.length ? `${photoHits.length} productos parecidos` : "Resultado de tu foto"}</p>
                          <p className="text-[11px]" style={{ color: "var(--t-muted)" }}>Los más parecidos aparecen primero.</p>
                        </>
                      )}
                    </div>
                    {!busyPhoto ? (
                      <div className="grid w-full grid-cols-2 gap-1.5 sm:flex sm:w-auto sm:shrink-0">
                        <button type="button" onClick={() => cameraRef.current?.click()} className="inline-flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold text-white" style={{ background: "var(--t-accent)" }}>
                          <Camera size={14} /> Otra foto
                        </button>
                        <button type="button" onClick={() => galleryRef.current?.click()} className="inline-flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-bold" style={{ borderColor: "var(--t-card-border)" }}>
                          <ImagePlus size={14} /> Galería
                        </button>
                      </div>
                    ) : null}
                  </div>

                  {photoMsg ? (
                    <div className="flex items-start gap-2 rounded-2xl border p-3 text-xs leading-5" style={{ borderColor: "var(--t-card-border)", color: "var(--t-muted)" }}>
                      <span>ℹ️</span>
                      <span className="flex-1">{photoMsg}</span>
                      {photoState === "error" ? (
                        <button type="button" onClick={() => { setPhotoUrl(null); setPhotoState("idle"); setPhotoMsg(null); }} className="inline-flex items-center gap-1 font-bold" style={{ color: "var(--t-accent)" }}>
                          <RotateCcw size={12} /> Reintentar
                        </button>
                      ) : null}
                    </div>
                  ) : null}

                  {photoHits?.length ? (
                    <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                      {photoHits.map((hit, index) => <PhotoCard key={hit.id} hit={hit} index={index} pickLabel={pickLabel} onPick={onPick} extra={renderExtra?.(hit)} />)}
                    </ul>
                  ) : null}
                </div>
              )}
            </>
          )}
        </div>
      </motion.section>
    </motion.div>
  );
}

async function previewOf(file: Blob): Promise<string> {
  // Miniatura pequeña (se guarda para retomar la búsqueda al volver).
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 160 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return canvas.toDataURL("image/jpeg", 0.7);
  } catch {
    return URL.createObjectURL(file);
  }
}

function Hint({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <div className="grid place-items-center gap-2 px-4 py-10 text-center text-sm" style={{ color: "var(--t-muted)" }}>
      <span className="text-2xl">{icon}</span>
      <p className="max-w-sm leading-6">{text}</p>
    </div>
  );
}

function Thumb({ src, size }: { src: string | null; size: number }) {
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" loading="lazy" style={{ width: size, height: size }} className="shrink-0 rounded-xl object-cover" />
  ) : (
    <span style={{ width: size, height: size, background: "color-mix(in oklab, var(--t-text) 6%, transparent)" }} className="grid shrink-0 place-items-center rounded-xl text-xl" aria-hidden>📦</span>
  );
}

function HitRow({ hit, pickLabel, onPick, extra }: { hit: FinderHit; pickLabel: string; onPick: (h: FinderHit) => void; extra?: ReactNode }) {
  return (
    <li>
      <button
        type="button"
        disabled={hit.disabled}
        onClick={() => onPick(hit)}
        className="group flex w-full items-center gap-3 rounded-2xl border p-2.5 text-left transition hover:-translate-y-0.5 disabled:opacity-50"
        style={{ borderColor: "var(--t-card-border)", background: "color-mix(in oklab, var(--t-card-bg) 92%, transparent)" }}
      >
        <Thumb src={hit.image_url} size={56} />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold leading-snug">{hit.name}</span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]" style={{ color: "var(--t-muted)" }}>
            {hit.code ? <span className="rounded-md px-1.5 py-0.5 font-bold" style={{ background: "color-mix(in oklab, var(--t-text) 8%, transparent)" }}>Cód. {hit.code}</span> : null}
            {hit.price != null ? <span className="font-bold" style={{ color: "var(--t-text)" }}>{money(hit.price)}</span> : null}
            {hit.meta ? <span>{hit.meta}</span> : null}
          </span>
          {extra}
        </span>
        <span className="inline-flex shrink-0 items-center gap-0.5 rounded-xl px-2.5 py-1.5 text-xs font-bold transition group-hover:translate-x-0.5" style={{ color: "var(--t-accent)" }}>
          {pickLabel} <ChevronRight size={14} />
        </span>
      </button>
    </li>
  );
}

function PhotoCard({ hit, index, pickLabel, onPick, extra }: { hit: FinderHit; index: number; pickLabel: string; onPick: (h: FinderHit) => void; extra?: ReactNode }) {
  const score = Number(hit.score ?? 0);
  const label = matchLabel(score);
  return (
    <motion.li initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(index, 12) * 0.03 }}>
      <button
        type="button"
        disabled={hit.disabled}
        onClick={() => onPick(hit)}
        className="group flex h-full w-full flex-col overflow-hidden rounded-2xl border text-left transition hover:-translate-y-0.5 disabled:opacity-50"
        style={{ borderColor: index === 0 && score >= 0.72 ? "var(--t-accent)" : "var(--t-card-border)", background: "color-mix(in oklab, var(--t-card-bg) 92%, transparent)" }}
      >
        <span className="relative block aspect-square w-full overflow-hidden" style={{ background: "color-mix(in oklab, var(--t-text) 5%, transparent)" }}>
          {hit.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={hit.image_url} alt="" loading="lazy" className="h-full w-full object-cover transition duration-300 group-hover:scale-105" />
          ) : (
            <span className="grid h-full w-full place-items-center text-3xl">📦</span>
          )}
          <span className="absolute left-1.5 top-1.5 rounded-full px-2 py-0.5 text-[10px] font-black text-white shadow" style={{ background: label.color }}>
            {Math.round(score * 100)}% · {label.text}
          </span>
        </span>
        <span className="flex flex-1 flex-col p-2.5">
          <span className="line-clamp-2 text-xs font-bold leading-snug">{hit.name}</span>
          <span className="mt-1 flex flex-wrap items-center gap-x-1.5 text-[11px]" style={{ color: "var(--t-muted)" }}>
            {hit.price != null ? <b style={{ color: "var(--t-text)" }}>{money(hit.price)}</b> : null}
            {hit.code ? <span>Cód. {hit.code}</span> : null}
          </span>
          {extra}
          <span className="mt-auto inline-flex items-center gap-0.5 pt-1.5 text-[11px] font-bold" style={{ color: "var(--t-accent)" }}>
            {pickLabel} <ChevronRight size={13} />
          </span>
        </span>
      </button>
    </motion.li>
  );
}
