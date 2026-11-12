"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, m as motion } from "framer-motion";
import { Camera, Check, ChevronRight, ImagePlus, Loader2, Plus, RotateCcw, ScanSearch, ScanText, Search, Type, X, Zap } from "lucide-react";
import { embedPhoto, imageSearchSupported, onEmbedProgress, previewDataUrl, warmUpImageSearch, type EmbedEngine, type EmbedProgress } from "@/lib/image-search/embed";
import { deviceProfile, setForcedLite } from "@/lib/image-search/device";
import { PhotoCamera, cameraInPageSupported } from "./PhotoCamera";
import { readPhotoText, warmUpOcr } from "@/lib/image-search/ocr";
import { DROP_BLOCKED_MSG, dragHasImage, imageFileFrom, imageFromDrop } from "@/lib/image-drop";
import { searchDelay, useSearchValue } from "@/lib/search-timing";
import { SearchTimer } from "@/components/ui/SearchTimer";

export type FinderHit = {
  id: string;
  name: string;
  image_url: string | null;
  code?: string | null;
  /** Referencia (SKU) tal cual, para filtrar listas que buscan por SKU. */
  sku?: string | null;
  price?: number | null;
  meta?: string | null;
  score?: number | null;
  /** Por qué salió en la búsqueda por foto: su código o su texto coinciden con lo leído en la foto. */
  match?: "code" | "text" | null;
  disabled?: boolean;
};

export type FinderSource = {
  /** Búsqueda por nombre, código, código de barras o descripción. */
  searchText: (q: string) => Promise<FinderHit[]>;
  /** Búsqueda por foto: huella de la foto + palabras leídas en ella. indexed = productos con fotos analizadas. */
  searchPhoto?: (embedding: number[], terms: string[]) => Promise<{ items: FinderHit[]; indexed: number }>;
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
  /** Contenido extra en cada resultado (p. ej. existencias). */
  renderExtra?: (hit: FinderHit) => ReactNode;
};

type Saved = { mode: FinderMode; q: string; photoHits: FinderHit[] | null; photoUrl: string | null; terms: string[] | null };

const money = (n: number) => `$${Number(n || 0).toLocaleString("es-CO")}`;

export function matchLabel(score: number, match?: FinderHit["match"]) {
  if (match === "code") return { text: "Código coincide", color: "#16a34a" };
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

/** Buscador de productos por nombre, código o foto (abajo en celular, centrado en tablet y computador). */
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
  const typing = useSearchValue(q);
  const [textHits, setTextHits] = useState<FinderHit[] | null>(null);
  const [textLoading, setTextLoading] = useState(false);
  const [photoUrl, setPhotoUrl] = useState<string | null>(saved?.photoUrl ?? null);
  const [photoHits, setPhotoHits] = useState<FinderHit[] | null>(saved?.photoHits ?? null);
  const [photoState, setPhotoState] = useState<"idle" | "loading" | "searching" | "error">("idle");
  const [photoMsg, setPhotoMsg] = useState<string | null>(null);
  const [progress, setProgress] = useState<EmbedProgress | null>(null);
  // Texto leído en la foto: null = aún leyendo (o sin foto).
  const [terms, setTerms] = useState<string[] | null>(saved?.terms ?? null);
  const [reading, setReading] = useState(false);
  const [newTerm, setNewTerm] = useState("");
  const [adding, setAdding] = useState(false);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const reqId = useRef(0);
  const photoReq = useRef(0);
  const embeddingRef = useRef<number[] | null>(null);
  // La última foto (para leer su texto cuando se pide, en celulares lentos).
  const lastPhotoRef = useRef<Blob | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [engine, setEngine] = useState<EmbedEngine | null>(null);
  const [device] = useState(() => deviceProfile());
  const [lite, setLite] = useState(device.forcedLite);
  const autoLite = device.weak || !device.localPossible;

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
    if (mode === "text") {
      // En celular no se abre el teclado solo si ya hay resultados.
      const t = window.setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 160);
      return () => window.clearTimeout(t);
    }
    // En celulares lentos no se descarga nada al abrir: la foto la analiza RemHub y el texto se lee si se pide.
    warmUpImageSearch();
    if (!device.weak && !device.saveData) warmUpOcr();
  }, [mode, device]);

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
    }, searchDelay(term));
    return () => window.clearTimeout(t);
  }, [q, source]);

  useEffect(() => {
    writeSaved(storageKey, { mode, q, photoHits, terms, photoUrl: photoUrl?.startsWith("data:") ? photoUrl : null });
  }, [storageKey, mode, q, photoHits, photoUrl, terms]);

  // Pegar una imagen (Ctrl+V) en cualquier pestaña: cambia a «Foto» y busca.
  useEffect(() => {
    if (!photoOk) return;
    const onPaste = (e: ClipboardEvent) => {
      const file = imageFileFrom(e.clipboardData);
      if (!file) return;
      e.preventDefault();
      setMode("photo");
      void searchByPhoto(file);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  });

  async function runPhotoSearch(embedding: number[], words: string[], id: number) {
    if (!source.searchPhoto) return null;
    const res = await source.searchPhoto(embedding, words);
    if (id !== photoReq.current) return null;
    setPhotoHits(res.items);
    return res;
  }

  async function searchByPhoto(file: Blob) {
    if (!source.searchPhoto) return;
    const id = ++photoReq.current;
    embeddingRef.current = null;
    lastPhotoRef.current = file;
    setCameraOpen(false);
    setPhotoMsg(null);
    setPhotoHits(null);
    setTerms(null);
    setEngine(null);
    setPhotoState("loading");
    // Equipos buenos: el texto de la foto se lee al mismo tiempo que se calcula su huella.
    // Celulares lentos: solo si se pide (botón «Leer el texto»), para no pegar el celular.
    const autoOcr = !device.weak && !device.saveData;
    setReading(autoOcr);
    const ocr = autoOcr ? readPhotoText(file) : null;
    try {
      setPhotoUrl(await previewOf(file));
      const { embedding, engine: used } = await embedPhoto(file, "search");
      if (id !== photoReq.current) return;
      embeddingRef.current = embedding;
      setEngine(used);
      setPhotoState("searching");
      const first = await runPhotoSearch(embedding, [], id);
      if (!first) return;
      setPhotoState("idle");
      const words = ocr ? await ocr : null;
      if (id !== photoReq.current) return;
      setTerms(words);
      setReading(false);
      const res = words?.length ? (await runPhotoSearch(embedding, words, id)) ?? first : first;
      if (!res.indexed && !res.items.length) setPhotoMsg("Las fotos de este catálogo todavía se están preparando para la búsqueda por foto. Mientras tanto, busca por nombre o código.");
      else if (!res.items.length) setPhotoMsg("No encontramos productos parecidos. Prueba con otra foto, más de cerca y con buena luz.");
    } catch (error) {
      if (id !== photoReq.current) return;
      setReading(false);
      setPhotoState("error");
      const text = error instanceof Error ? error.message : "";
      setPhotoMsg(/fetch|network|import|Load failed|abort/i.test(text)
        ? "No se pudo analizar la foto: revisa tu conexión a internet e inténtalo de nuevo."
        : /Demasiadas|ocupado/i.test(text) ? text
        : "No se pudo analizar la foto. Intenta con otra imagen.");
    }
  }

  // Quitar o agregar palabras leídas vuelve a buscar con la misma foto.
  async function changeTerms(next: string[]) {
    setTerms(next);
    const embedding = embeddingRef.current;
    if (!embedding) {
      if (next.length) {
        setMode("text");
        setQ(next.join(" "));
      }
      return;
    }
    const id = ++photoReq.current;
    setPhotoState("searching");
    try {
      await runPhotoSearch(embedding, next, id);
    } finally {
      if (id === photoReq.current) setPhotoState("idle");
    }
  }

  // Celulares lentos: leer el texto de la foto solo cuando se pide.
  async function readTextNow() {
    const file = lastPhotoRef.current;
    if (!file || reading) return;
    setReading(true);
    try {
      const words = await readPhotoText(file);
      await changeTerms(words);
    } finally {
      setReading(false);
    }
  }

  function openCamera() {
    if (cameraInPageSupported()) setCameraOpen(true);
    else cameraRef.current?.click();
  }

  function toggleLite(on: boolean) {
    setForcedLite(on);
    setLite(on);
  }

  function addTerm() {
    const word = newTerm.trim().toUpperCase();
    setNewTerm("");
    setAdding(false);
    if (!word || terms?.includes(word)) return;
    void changeTerms([...(terms ?? []), word]);
  }

  // Arrastrar y soltar en TODA la ventana (no solo en el recuadro vacío).
  const dragDepth = useRef(0);
  function onSheetDragEnter(e: React.DragEvent) {
    if (!photoOk || !dragHasImage(e.dataTransfer)) return;
    e.preventDefault();
    dragDepth.current++;
    setDragging(true);
  }
  function onSheetDragOver(e: React.DragEvent) {
    if (!photoOk || !dragHasImage(e.dataTransfer)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }
  function onSheetDragLeave() {
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (!dragDepth.current) setDragging(false);
  }
  async function onSheetDrop(e: React.DragEvent) {
    if (!photoOk) return;
    e.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    setMode("photo");
    try {
      const file = await imageFromDrop(e.dataTransfer);
      if (file) void searchByPhoto(file);
      else setPhotoMsg("Eso no es una imagen. Arrastra una foto del producto.");
    } catch {
      setPhotoMsg(DROP_BLOCKED_MSG);
    }
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) void searchByPhoto(file);
  }

  const busyPhoto = photoState === "loading" || photoState === "searching";
  const preparing = photoState === "loading" && progress && progress.stage !== "ready";

  return (
    <motion.div className="fixed inset-0 z-[130] flex items-end justify-center sm:items-center sm:p-4 lg:p-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <button type="button" aria-label="Cerrar" className="absolute inset-0 cursor-default bg-black/55 backdrop-blur-[3px]" onClick={onClose} />
      <motion.section
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative flex h-[94dvh] w-full flex-col overflow-hidden rounded-t-[26px] border shadow-[0_30px_90px_rgba(0,0,0,0.45)] sm:h-auto sm:max-h-[min(88dvh,60rem)] sm:max-w-2xl sm:rounded-[28px] lg:max-w-4xl xl:max-w-5xl short:h-dvh short:max-h-dvh short:rounded-none short:sm:max-w-4xl"
        style={{ borderColor: "var(--t-card-border)", background: "var(--t-bg-base)", color: "var(--t-text)" }}
        initial={{ y: 60, opacity: 0, scale: 0.98 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        exit={{ y: 60, opacity: 0, scale: 0.98 }}
        transition={{ type: "spring", stiffness: 380, damping: 34 }}
        onDragEnter={onSheetDragEnter}
        onDragOver={onSheetDragOver}
        onDragLeave={onSheetDragLeave}
        onDrop={(e) => void onSheetDrop(e)}
      >
        {dragging ? (
          <div className="pointer-events-none absolute inset-2 z-50 grid place-items-center rounded-[22px] border-2 border-dashed" style={{ borderColor: "var(--t-accent)", background: "color-mix(in oklab, var(--t-bg-base) 70%, transparent)" }}>
            <span className="inline-flex items-center gap-2 rounded-full px-5 py-3 text-sm font-black shadow-xl" style={{ background: "var(--t-accent)", color: "#fff" }}>
              <Camera size={18} /> Suelta la foto para buscar
            </span>
          </div>
        ) : null}
        <span className="mx-auto mt-2 h-1.5 w-11 shrink-0 rounded-full sm:hidden short:hidden" style={{ background: "color-mix(in oklab, var(--t-text) 18%, transparent)" }} aria-hidden />
        <header className="flex shrink-0 items-start justify-between gap-3 px-4 pb-3 pt-2.5 sm:px-6 sm:pt-5 short:pb-2 short:pt-2">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-base font-black sm:text-lg"><ScanSearch size={20} className="shrink-0" style={{ color: "var(--t-accent)" }} /> <span className="truncate">{title}</span></h2>
            <p className="mt-0.5 line-clamp-2 text-xs short:hidden" style={{ color: "var(--t-muted)" }}>{subtitle ?? "Busca por nombre, código o con una foto."}</p>
          </div>
          <button type="button" onClick={onClose} className="grid h-10 w-10 shrink-0 place-items-center rounded-full border transition hover:rotate-90" style={{ borderColor: "var(--t-card-border)" }} aria-label="Cerrar">
            <X size={16} />
          </button>
        </header>

        {photoOk ? (
          <div className="shrink-0 px-4 sm:px-6">
            <div className="grid grid-cols-2 gap-1 rounded-2xl border p-1 lg:max-w-md short:max-w-sm" style={{ borderColor: "var(--t-card-border)" }} role="tablist">
              {([["text", <><span className="min-[400px]:hidden">Escribir</span><span className="hidden min-[400px]:inline">Nombre o código</span></>, <Type key="t" size={15} />], ["photo", "Foto", <Camera key="c" size={15} />]] as const).map(([value, label, icon]) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={mode === value}
                  onClick={() => setMode(value)}
                  className="inline-flex min-w-0 items-center justify-center gap-2 rounded-xl px-2 py-2 text-[13px] font-bold transition-all duration-200 sm:text-sm short:py-1.5"
                  style={mode === value
                    ? { color: "#fff", background: "linear-gradient(135deg, var(--t-accent), var(--t-accent2, var(--t-accent)))", boxShadow: "0 6px 18px color-mix(in oklab, var(--t-accent) 35%, transparent)" }
                    : { color: "var(--t-text)", background: "transparent" }}
                >
                  <span className="shrink-0">{icon}</span><span className="truncate">{label}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="mt-3 min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 short:mt-2 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:px-6">
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
                    autoComplete="off"
                    placeholder="Nombre, código o descripción (ej: olla, 125, V322)…"
                    className="w-full rounded-2xl border py-3 text-base outline-none sm:text-sm"
                    style={{ borderColor: "var(--t-card-border)", background: "color-mix(in oklab, var(--t-card-bg) 92%, transparent)", color: "var(--t-text)", paddingLeft: "2.6rem", paddingRight: "2.6rem" }}
                  />
                  {textLoading ? <Loader2 size={16} className="absolute right-3.5 top-1/2 -translate-y-1/2 animate-spin opacity-60" /> : null}
                  <SearchTimer pending={typing.pending} delay={typing.delay} term={q} />
                </div>
              </div>
              {textHits === null ? (
                <Hint icon={<Search size={22} />} text="Escribe parte del nombre, el código o algo de la descripción. No importan las tildes ni el orden de las palabras." />
              ) : textHits.length === 0 && !textLoading ? (
                <Hint icon="🔎" text={`No encontramos «${q.trim()}». Revisa el código o prueba con otra palabra${photoOk ? ", o busca con una foto" : ""}.`} />
              ) : (
                <ul className="grid gap-2 lg:grid-cols-2">
                  {textHits.map((hit) => <HitRow key={hit.id} hit={hit} pickLabel={pickLabel} onPick={onPick} extra={renderExtra?.(hit)} />)}
                </ul>
              )}
            </>
          ) : (
            <>
              <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onFile} />
              {cameraOpen ? (
                <PhotoCamera
                  weak={device.weak}
                  onShot={(photo) => void searchByPhoto(photo)}
                  onFallback={() => { setCameraOpen(false); cameraRef.current?.click(); }}
                  onClose={() => setCameraOpen(false)}
                />
              ) : null}
              <input ref={galleryRef} type="file" accept="image/*" className="hidden" onChange={onFile} />
              {!photoUrl && !busyPhoto ? (
                <div
                  className="mx-auto max-w-xl rounded-3xl border-2 border-dashed p-5 text-center transition sm:p-8"
                  style={{ borderColor: dragging ? "var(--t-accent)" : "var(--t-card-border)", background: dragging ? "color-mix(in oklab, var(--t-accent) 8%, transparent)" : "transparent" }}
                >
                  <div className="mx-auto grid h-16 w-16 place-items-center rounded-3xl" style={{ background: "color-mix(in oklab, var(--t-accent) 14%, transparent)", color: "var(--t-accent)" }}>
                    <Camera size={30} />
                  </div>
                  <p className="mt-3 text-base font-black">Busca con una foto</p>
                  <p className="mx-auto mt-1 max-w-sm text-xs leading-5" style={{ color: "var(--t-muted)" }}>
                    Toma una foto del producto, de su caja o de su etiqueta. Buscamos por cómo se ve y también por lo que diga escrito (código, marca, modelo…).
                  </p>
                  <div className="mt-4 grid gap-2 sm:grid-cols-2">
                    <button type="button" onClick={openCamera} className="inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-bold text-white shadow-lg transition hover:-translate-y-0.5" style={{ background: "linear-gradient(135deg, var(--t-accent), var(--t-accent2, var(--t-accent)))" }}>
                      <Camera size={17} /> Tomar foto
                    </button>
                    <button type="button" onClick={() => galleryRef.current?.click()} className="inline-flex items-center justify-center gap-2 rounded-2xl border px-4 py-3 text-sm font-bold transition hover:-translate-y-0.5" style={{ borderColor: "var(--t-card-border)" }}>
                      <ImagePlus size={17} /> Elegir imagen
                    </button>
                  </div>
                  <p className="mt-3 hidden text-[11px] sm:block" style={{ color: "var(--t-muted)" }}>También puedes arrastrar una imagen a esta ventana (de una carpeta o de otra página) o pegarla con Ctrl + V.</p>
                  {photoMsg ? <p className="mt-3 rounded-2xl border p-3 text-xs leading-5" style={{ borderColor: "var(--t-card-border)", color: "var(--t-muted)" }}>ℹ️ {photoMsg}</p> : null}
                  <LiteSwitch on={lite || autoLite} auto={autoLite} reason={device.reason} onChange={toggleLite} />
                </div>
              ) : (
                <div className="lg:grid lg:grid-cols-[17rem_minmax(0,1fr)] lg:items-start lg:gap-5 short:grid short:grid-cols-[14rem_minmax(0,1fr)] short:items-start short:gap-3">
                  {/* Tu foto y lo que se leyó en ella */}
                  <aside className="space-y-2.5 lg:sticky lg:top-0 short:sticky short:top-0">
                    <div className="rounded-2xl border p-2.5 lg:p-3" style={{ borderColor: "var(--t-card-border)" }}>
                      <div className="flex items-center gap-3 lg:block">
                        {photoUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={photoUrl} alt="Tu foto" className="h-16 w-16 shrink-0 rounded-xl object-cover sm:h-20 sm:w-20 lg:h-auto lg:max-h-56 lg:w-full lg:object-contain short:h-14 short:w-14 short:lg:h-14 short:lg:w-14" />
                        ) : (
                          <span className="grid h-16 w-16 shrink-0 place-items-center rounded-xl" style={{ background: "color-mix(in oklab, var(--t-text) 6%, transparent)" }}><Camera size={22} /></span>
                        )}
                        <div className="min-w-0 flex-1 lg:mt-2.5">
                          {busyPhoto ? (
                            <>
                              <p className="flex items-center gap-2 text-sm font-bold"><Loader2 size={15} className="shrink-0 animate-spin" />
                                {photoState === "searching" ? "Buscando los más parecidos…" : preparing ? "Preparando la búsqueda por foto…" : "Analizando la foto…"}
                              </p>
                              {preparing ? (
                                <>
                                  <div className="mt-2 h-1.5 overflow-hidden rounded-full" style={{ background: "color-mix(in oklab, var(--t-text) 10%, transparent)" }}>
                                    <motion.div className="h-full rounded-full" style={{ background: "var(--t-accent)" }} animate={{ width: `${Math.max(6, progress?.percent ?? 0)}%` }} />
                                  </div>
                                  <p className="mt-1 text-[11px]" style={{ color: "var(--t-muted)" }}>Solo la primera vez (unos segundos). Después es inmediato.</p>
                                </>
                              ) : null}
                            </>
                          ) : (
                            <>
                              <p className="text-sm font-bold">{photoHits?.length ? `${photoHits.length} resultados` : "Resultado de tu foto"}</p>
                              <p className="text-[11px]" style={{ color: "var(--t-muted)" }}>Primero los más parecidos.</p>
                              {engine === "server" ? (
                                <p className="mt-0.5 inline-flex items-center gap-1 text-[10px] font-bold" style={{ color: "var(--t-accent)" }} title="La foto se analizó en RemHub para no pegar el celular">
                                  <Zap size={10} /> Modo liviano
                                </p>
                              ) : null}
                            </>
                          )}
                        </div>
                      </div>
                      {!busyPhoto ? (
                        <div className="mt-2.5 grid grid-cols-2 gap-1.5">
                          <button type="button" onClick={openCamera} className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-xl px-2 py-2 text-xs font-bold text-white short:py-1.5" style={{ background: "var(--t-accent)" }}>
                            <Camera size={14} /> Otra foto
                          </button>
                          <button type="button" onClick={() => galleryRef.current?.click()} className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-xl border px-2 py-2 text-xs font-bold short:py-1.5" style={{ borderColor: "var(--t-card-border)" }}>
                            <ImagePlus size={14} /> Galería
                          </button>
                        </div>
                      ) : null}

                      {/* Texto leído en la foto: se puede quitar o agregar palabras */}
                      {photoUrl && !reading && terms === null && !busyPhoto && lastPhotoRef.current ? (
                        <button type="button" onClick={() => void readTextNow()} className="mt-2.5 inline-flex w-full items-center justify-center gap-1.5 rounded-xl border px-2 py-2 text-xs font-bold" style={{ borderColor: "var(--t-card-border)", color: "var(--t-accent)" }}>
                          <ScanText size={14} /> Leer el texto de la foto (código, marca…)
                        </button>
                      ) : null}
                      {photoUrl && (reading || terms) ? (
                        <div className="mt-2.5 border-t pt-2.5" style={{ borderColor: "var(--t-card-border)" }}>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="inline-flex items-center gap-1.5 text-xs font-bold">
                              {reading ? <Loader2 size={13} className="animate-spin" /> : <ScanText size={14} style={{ color: "var(--t-accent)" }} />}
                              {reading ? "Leyendo el texto de la foto…" : terms?.length ? "Texto leído:" : "No se leyó texto"}
                            </span>
                            {terms?.map((t) => (
                              <span key={t} className="inline-flex items-center gap-1 rounded-full border py-0.5 pl-2.5 pr-1 text-xs font-bold" style={{ borderColor: "color-mix(in oklab, var(--t-accent) 45%, var(--t-card-border))", background: "color-mix(in oklab, var(--t-accent) 10%, transparent)" }}>
                                {t}
                                <button type="button" onClick={() => void changeTerms(terms.filter((x) => x !== t))} className="grid h-5 w-5 place-items-center rounded-full opacity-70 hover:opacity-100" aria-label={`Quitar ${t}`}>
                                  <X size={11} />
                                </button>
                              </span>
                            ))}
                            {!reading && !adding ? (
                              <button type="button" onClick={() => setAdding(true)} className="inline-flex items-center gap-1 rounded-full border border-dashed px-2.5 py-0.5 text-xs font-bold" style={{ borderColor: "var(--t-card-border)", color: "var(--t-accent)" }}>
                                <Plus size={12} /> {terms?.length ? "Palabra" : "Escribir lo que dice"}
                              </button>
                            ) : null}
                          </div>
                          {adding ? (
                            <form
                              className="mt-2 flex gap-1.5"
                              onSubmit={(e) => {
                                e.preventDefault();
                                addTerm();
                              }}
                            >
                              <input
                                autoFocus
                                value={newTerm}
                                onChange={(e) => setNewTerm(e.target.value)}
                                onBlur={() => { if (!newTerm.trim()) setAdding(false); }}
                                placeholder="Código, marca, modelo…"
                                className="min-w-0 flex-1 rounded-xl border px-2.5 py-1.5 text-base uppercase outline-none placeholder:normal-case sm:text-xs"
                                style={{ borderColor: "var(--t-card-border)", background: "transparent", color: "var(--t-text)" }}
                              />
                              <button type="submit" className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-white sm:h-8 sm:w-8" style={{ background: "var(--t-accent)" }} aria-label="Agregar palabra">
                                <Plus size={14} />
                              </button>
                            </form>
                          ) : null}
                          {terms?.length ? (
                            <button type="button" onClick={() => { setMode("text"); setQ(terms.join(" ")); }} className="mt-2 inline-flex items-center gap-1 text-[11px] font-bold" style={{ color: "var(--t-accent)" }}>
                              <Search size={11} /> Buscar solo por este texto
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                    </div>

                    {photoMsg ? (
                      <div className="flex items-start gap-2 rounded-2xl border p-3 text-xs leading-5" style={{ borderColor: "var(--t-card-border)", color: "var(--t-muted)" }}>
                        <span>ℹ️</span>
                        <span className="flex-1">{photoMsg}</span>
                        {photoState === "error" ? (
                          <button type="button" onClick={() => { setPhotoUrl(null); setPhotoState("idle"); setPhotoMsg(null); setTerms(null); }} className="inline-flex items-center gap-1 font-bold" style={{ color: "var(--t-accent)" }}>
                            <RotateCcw size={12} /> Reintentar
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </aside>

                  <div className="mt-3 lg:mt-0 short:mt-0">
                    {photoHits?.length ? (
                      <ul className={`grid grid-cols-2 gap-2.5 transition-opacity sm:grid-cols-3 xl:grid-cols-4 short:grid-cols-3 short:lg:grid-cols-4 ${photoState === "searching" ? "opacity-60" : ""}`}>
                        {photoHits.map((hit, index) => <PhotoCard key={hit.id} hit={hit} index={index} pickLabel={pickLabel} onPick={onPick} extra={renderExtra?.(hit)} />)}
                      </ul>
                    ) : busyPhoto ? (
                      <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4" aria-hidden>
                        {Array.from({ length: 6 }, (_, i) => (
                          <li key={i} className="aspect-3/4 animate-pulse rounded-2xl" style={{ background: "color-mix(in oklab, var(--t-text) 6%, transparent)" }} />
                        ))}
                      </ul>
                    ) : null}
                  </div>
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
  // Miniatura (se guarda para retomar la búsqueda al volver). Se abre ya reducida: no llena la memoria.
  try {
    return await previewDataUrl(file, 360);
  } catch {
    return URL.createObjectURL(file);
  }
}

/** Modo liviano: la foto la analiza RemHub (para celulares lentos). Automático si el celular no da. */
function LiteSwitch({ on, auto, reason, onChange }: { on: boolean; auto: boolean; reason: string | null; onChange: (on: boolean) => void }) {
  return (
    <label className={`mt-3 flex items-start gap-2 rounded-2xl border p-2.5 text-left text-[11px] leading-4 ${auto ? "" : "cursor-pointer"}`} style={{ borderColor: "var(--t-card-border)", color: "var(--t-muted)" }}>
      <input type="checkbox" className="mt-0.5" checked={on} disabled={auto} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <b className="inline-flex items-center gap-1" style={{ color: "var(--t-text)" }}><Zap size={11} /> Modo liviano</b>
        {" "}— RemHub analiza la foto: el celular no descarga nada pesado ni se pega.
        {auto ? <> Activado solo en este equipo{reason ? ` (${reason})` : ""}.</> : " Actívalo si tu celular es lento."}
      </span>
    </label>
  );
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
        className="group flex h-full w-full items-center gap-3 rounded-2xl border p-2.5 text-left transition hover:-translate-y-0.5 disabled:opacity-50"
        style={{ borderColor: "var(--t-card-border)", background: "color-mix(in oklab, var(--t-card-bg) 92%, transparent)" }}
      >
        <Thumb src={hit.image_url} size={56} />
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 text-sm font-bold leading-snug">{hit.name}</span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]" style={{ color: "var(--t-muted)" }}>
            {hit.code ? <span className="rounded-md px-1.5 py-0.5 font-bold" style={{ background: "color-mix(in oklab, var(--t-text) 8%, transparent)" }}>Cód. {hit.code}</span> : null}
            {hit.price != null ? <span className="font-bold" style={{ color: "var(--t-text)" }}>{money(hit.price)}</span> : null}
            {hit.meta ? <span>{hit.meta}</span> : null}
          </span>
          {extra}
        </span>
        <span className="inline-flex shrink-0 items-center gap-0.5 rounded-xl px-1.5 py-1.5 text-xs font-bold transition group-hover:translate-x-0.5 sm:px-2.5" style={{ color: "var(--t-accent)" }}>
          <span className="hidden min-[400px]:inline">{pickLabel}</span> <ChevronRight size={14} />
        </span>
      </button>
    </li>
  );
}

function PhotoCard({ hit, index, pickLabel, onPick, extra }: { hit: FinderHit; index: number; pickLabel: string; onPick: (h: FinderHit) => void; extra?: ReactNode }) {
  const score = Number(hit.score ?? 0);
  const label = matchLabel(score, hit.match);
  const highlight = index === 0 && (score >= 0.72 || hit.match === "code");
  return (
    <motion.li initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(index, 12) * 0.03 }}>
      <button
        type="button"
        disabled={hit.disabled}
        onClick={() => onPick(hit)}
        className="group flex h-full w-full flex-col overflow-hidden rounded-2xl border text-left transition hover:-translate-y-0.5 disabled:opacity-50"
        style={{ borderColor: highlight ? "var(--t-accent)" : "var(--t-card-border)", background: "color-mix(in oklab, var(--t-card-bg) 92%, transparent)" }}
      >
        <span className="relative block aspect-square w-full overflow-hidden" style={{ background: "color-mix(in oklab, var(--t-text) 5%, transparent)" }}>
          {hit.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={hit.image_url} alt="" loading="lazy" className="h-full w-full object-cover transition duration-300 group-hover:scale-105" />
          ) : (
            <span className="grid h-full w-full place-items-center text-3xl">📦</span>
          )}
          <span className="absolute left-1.5 top-1.5 max-w-[calc(100%-0.75rem)] truncate rounded-full px-2 py-0.5 text-[10px] font-black text-white shadow" style={{ background: label.color }}>
            {hit.match === "code" ? <><Check size={10} className="mr-0.5 inline" />{label.text}</> : `${Math.round(score * 100)}% · ${label.text}`}
          </span>
          {hit.match === "text" ? (
            <span className="absolute bottom-1.5 left-1.5 rounded-full bg-black/65 px-2 py-0.5 text-[10px] font-bold text-white">Coincide el texto</span>
          ) : null}
        </span>
        <span className="flex flex-1 flex-col p-2.5">
          <span className="line-clamp-2 text-xs font-bold leading-snug sm:text-[13px]">{hit.name}</span>
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
