"use client";

// «Mis temas y apariencia»: administrador de temas y editor con vista previa en vivo.
// Nada se guarda mientras se mueve un control: solo con «Guardar». «Cancelar» deja todo exactamente como estaba.
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, m as motion } from "framer-motion";
import Swal from "@/lib/swal";
import { ArrowLeft, Check, Copy, Download, Eye, Pencil, Plus, RotateCcw, Search, Star, Trash2, Upload, Wand2, X } from "lucide-react";
import {
  OBSIDIAN, OFFICIAL_THEMES, PEARL, accessibilityReport, cleanName, exportTheme, fixReadability, hexToRgb, importTheme, isReadable,
  normalizeColor, normalizeTheme, rgbToHsl, swatches, themeTokens, type BackgroundKind, type Density, type GlassLevel, type ThemeConfig,
} from "@/lib/appearance/theme";
import {
  activateTheme, deleteTheme, getAppearance, listThemes, saveTheme, setFavorite, setPreview, updatePrefs, type ThemeSort, type UserTheme,
} from "@/lib/appearance/store";
import { Dots, ThemesTip, useAppearanceState, type StudioOpen } from "../ThemeControl";

const swal = { background: "var(--t-bg-base)", color: "var(--t-text)", confirmButtonColor: "var(--t-accent)" } as const;

export function ThemeStudio({ open, onClose, onOpen }: { open: StudioOpen; onClose: () => void; onOpen: (v: StudioOpen) => void }) {
  // Al cerrar por cualquier lado, se quita la vista previa temporal.
  useEffect(() => () => setPreview(null), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && open.view === "manager") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open.view, onClose]);
  if (typeof document === "undefined") return null;
  return createPortal(
    <AnimatePresence>
      <motion.div className="fixed inset-0 z-[150] flex items-end justify-center sm:items-center sm:p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
        <button type="button" aria-label="Cerrar" className="absolute inset-0 cursor-default bg-black/55 backdrop-blur-[2px]" onClick={open.view === "manager" ? onClose : undefined} />
        <motion.section role="dialog" aria-modal="true" aria-label="Mis temas y apariencia"
          className="relative flex h-[94dvh] w-full flex-col overflow-hidden rounded-t-[28px] border shadow-2xl sm:h-[min(92dvh,52rem)] sm:max-w-5xl sm:rounded-[28px]"
          style={{ borderColor: "var(--t-card-border)", background: "var(--t-bg-base)", color: "var(--t-text)" }}
          initial={{ y: 40, scale: 0.985 }} animate={{ y: 0, scale: 1 }} transition={{ type: "spring", stiffness: 380, damping: 34 }}>
          {open.view === "manager"
            ? <Manager onClose={onClose} onEdit={(v) => onOpen(v)} />
            : <Editor key={open.theme?.id ?? "new"} theme={open.theme ?? null} from={open.from} name={open.name} onDone={() => onOpen({ view: "manager" })} onClose={onClose} />}
        </motion.section>
      </motion.div>
    </AnimatePresence>,
    document.body,
  );
}

/* =================================================================== ADMINISTRADOR */

function Manager({ onClose, onEdit }: { onClose: () => void; onEdit: (v: StudioOpen) => void }) {
  const s = useAppearanceState();
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<ThemeSort>("updated");
  const [favorites, setFavorites] = useState(false);
  const [items, setItems] = useState<UserTheme[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const PAGE = 24;

  useEffect(() => {
    let alive = true;
    const t = window.setTimeout(() => {
      setLoading(true);
      listThemes({ q, sort, favorites, offset: 0, limit: PAGE }).then(
        (r) => { if (alive) { setItems(r.items); setTotal(r.total); setError(null); setLoading(false); } },
        (e: Error) => { if (alive) { setError(e.message); setLoading(false); } },
      );
    }, q ? 250 : 0);
    return () => { alive = false; window.clearTimeout(t); };
  }, [q, sort, favorites, tick]);

  async function more() {
    setLoading(true);
    try { const r = await listThemes({ q, sort, favorites, offset: items.length, limit: PAGE }); setItems((cur) => [...cur, ...r.items]); setTotal(r.total); }
    catch (e) { setError((e as Error).message); }
    setLoading(false);
  }

  const p = s.prefs;
  const activeId = p.mode === "custom" ? p.themeId : null;

  async function remove(t: UserTheme) {
    const active = activeId === t.id || p.systemLight === t.id || p.systemDark === t.id;
    const res = await Swal.fire({ ...swal, icon: "warning", title: `¿Eliminar «${t.name}»?`,
      html: active ? `Es el tema que estás usando. Al eliminarlo pasas a <b>${t.base_mode === "dark" ? "Obsidian Amethyst" : "Pearl Amethyst"}</b>.` : "No se puede deshacer (si lo exportaste, lo puedes volver a importar).",
      showCancelButton: true, confirmButtonText: "Eliminar", cancelButtonText: "Cancelar", confirmButtonColor: "#dc2626" });
    if (!res.isConfirmed) return;
    try { await deleteTheme(t); setTick((x) => x + 1); }
    catch (e) { void Swal.fire({ ...swal, icon: "error", title: "No se pudo eliminar", text: (e as Error).message }); }
  }

  async function duplicate(name: string, config: ThemeConfig) {
    try { await saveTheme({ name: `${name} (copia)`.slice(0, 60), config }); setTick((x) => x + 1); }
    catch (e) { void Swal.fire({ ...swal, icon: "error", title: "No se pudo duplicar", text: (e as Error).message }); }
  }

  async function rename(t: UserTheme) {
    const res = await Swal.fire({ ...swal, title: "Renombrar tema", input: "text", inputValue: t.name, inputAttributes: { maxlength: "60" }, showCancelButton: true, confirmButtonText: "Guardar", cancelButtonText: "Cancelar",
      inputValidator: (v) => (cleanName(v) ? null : "Escribe un nombre.") });
    if (!res.isConfirmed) return;
    try { await saveTheme({ id: t.id, name: cleanName(res.value), description: t.description, config: t.config }); setTick((x) => x + 1); }
    catch (e) { void Swal.fire({ ...swal, icon: "error", title: "No se pudo renombrar", text: (e as Error).message }); }
  }

  function download(name: string, config: ThemeConfig) {
    const blob = new Blob([exportTheme(name, config)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `tema-${name.toLowerCase().replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "remhub"}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  async function onImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      if (file.size > 20000) throw new Error("El archivo es demasiado grande para ser un tema.");
      const { name, config } = importTheme(await file.text());
      await saveTheme({ name, config });
      setTick((x) => x + 1);
      void Swal.fire({ ...swal, icon: "success", title: "Tema importado", text: `«${name}» quedó en Mis temas.`, timer: 1600, showConfirmButton: false });
    } catch (err) {
      void Swal.fire({ ...swal, icon: "error", title: "No se pudo importar", text: (err as Error).message });
    }
  }

  return (
    <>
      <header className="flex shrink-0 items-start gap-3 border-b px-4 py-3 sm:px-6 sm:py-4" style={{ borderColor: "var(--t-card-border)" }}>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-black uppercase tracking-[0.18em]" style={{ color: "var(--t-accent)" }}>💎 Amethyst Glass</p>
          <h2 className="text-lg font-black sm:text-xl">Mis temas y apariencia</h2>
          <p className="text-xs" style={{ color: "var(--t-muted)" }}>Tus temas son solo tuyos: se ven en todos tus dispositivos y no cambian nada de la tienda ni de otros usuarios.</p>
        </div>
        <button type="button" onClick={onClose} className="grid h-10 w-10 shrink-0 place-items-center rounded-full border" style={{ borderColor: "var(--t-card-border)" }} aria-label="Cerrar"><X size={16} /></button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-6 pt-4 sm:px-6">
        <h3 className="text-xs font-black uppercase tracking-wider" style={{ color: "var(--t-muted)" }}>Temas oficiales</h3>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {OFFICIAL_THEMES.map((t) => {
            const active = (t.config.base === "light" ? p.mode === "light" : p.mode === "dark");
            return (
              <ThemeCard key={t.id} name={t.name} subtitle={t.description ?? ""} config={t.config} active={active} official
                onUse={() => void updatePrefs({ mode: t.config.base })}
                onDuplicate={() => onEdit({ view: "editor", from: t.config, name: `Mi ${t.name}` })}
                onExport={() => download(t.name, t.config)} />
            );
          })}
        </div>

        <SystemPairs />

        <div className="mt-6 flex flex-wrap items-center gap-2">
          <h3 className="mr-auto text-xs font-black uppercase tracking-wider" style={{ color: "var(--t-muted)" }}>Mis temas {total ? `· ${total}` : ""}</h3>
          <button type="button" onClick={() => fileRef.current?.click()} className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold" style={{ borderColor: "var(--t-card-border)" }}><Upload size={13} /> Importar</button>
          <button type="button" onClick={() => onEdit({ view: "editor", from: getAppearance().prefs.mode === "light" ? PEARL : OBSIDIAN, name: "Mi tema" })}
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-black" style={{ background: "var(--t-accent)", color: "var(--t-on-accent, #fff)" }}><Plus size={13} /> Crear tema</button>
          <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={onImport} />
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <label className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border px-3 py-2" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)" }}>
            <Search size={15} style={{ color: "var(--t-muted)" }} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar tema…" className="min-w-0 flex-1 bg-transparent text-sm outline-none" style={{ border: 0, padding: 0, minHeight: 0 }} />
          </label>
          <select value={sort} onChange={(e) => setSort(e.target.value as ThemeSort)} aria-label="Ordenar" className="rounded-xl border px-3 py-2 text-sm" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)", color: "var(--t-text)" }}>
            <option value="updated">Editados hace poco</option>
            <option value="created">Creados hace poco</option>
            <option value="name">Por nombre</option>
          </select>
          <button type="button" onClick={() => setFavorites((v) => !v)} aria-pressed={favorites} className="inline-flex items-center gap-1 rounded-xl border px-3 py-2 text-sm font-bold"
            style={favorites ? { background: "#f59e0b", borderColor: "#f59e0b", color: "#fff" } : { borderColor: "var(--t-card-border)" }}><Star size={14} /> Favoritos</button>
        </div>

        {total > 2 && !p.tipDismissed ? <ThemesTip onManage={() => setSort("updated")} /> : null}
        {p.tipDismissed && total > 2 ? (
          <button type="button" onClick={() => void updatePrefs({ tipDismissed: false })} className="mt-2 text-[11px] font-semibold underline" style={{ color: "var(--t-muted)" }}>Mostrar de nuevo el consejo para organizar temas</button>
        ) : null}

        {error ? <p className="mt-4 rounded-2xl border p-3 text-sm" style={{ borderColor: "var(--t-warning)", color: "var(--t-warning)" }}>{error}</p> : null}
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((t) => (
            <ThemeCard key={t.id} name={t.name} subtitle={`${t.base_mode === "dark" ? "Oscuro" : "Claro"} · editado ${new Date(t.updated_at).toLocaleDateString("es-CO", { day: "2-digit", month: "2-digit", year: "numeric" })}`}
              config={t.config} active={activeId === t.id} favorite={t.favorite}
              onUse={() => void activateTheme(t)}
              onEdit={() => onEdit({ view: "editor", theme: t })}
              onDuplicate={() => void duplicate(t.name, t.config)}
              onRename={() => void rename(t)}
              onExport={() => download(t.name, t.config)}
              onFavorite={async () => { await setFavorite(t.id, !t.favorite).catch(() => undefined); setItems((cur) => cur.map((x) => (x.id === t.id ? { ...x, favorite: !t.favorite } : x))); }}
              onDelete={() => void remove(t)} />
          ))}
        </div>
        {!loading && !error && !items.length ? (
          <div className="mt-4 rounded-3xl border border-dashed p-6 text-center" style={{ borderColor: "var(--t-card-border)" }}>
            <p className="text-3xl">🎨</p>
            <p className="mt-1 font-bold">{q || favorites ? "Ningún tema coincide." : "Aún no tienes temas propios."}</p>
            <p className="text-xs" style={{ color: "var(--t-muted)" }}>Crea los que quieras: azul, dorado, minimalista… no hay límite.</p>
          </div>
        ) : null}
        {items.length < total ? (
          <button type="button" disabled={loading} onClick={() => void more()} className="mx-auto mt-3 block rounded-full border px-4 py-2 text-sm font-bold disabled:opacity-50" style={{ borderColor: "var(--t-card-border)" }}>
            {loading ? "Cargando…" : `Cargar más (${total - items.length})`}
          </button>
        ) : null}
      </div>
    </>
  );
}

/** Modo automático: qué tema usar cuando el equipo está en claro y cuando está en oscuro. */
function SystemPairs() {
  const s = useAppearanceState();
  const [light, setLight] = useState<UserTheme[]>([]);
  const [dark, setDark] = useState<UserTheme[]>([]);
  useEffect(() => {
    let alive = true;
    listThemes({ limit: 100, sort: "name" }).then((r) => {
      if (!alive) return;
      setLight(r.items.filter((t) => t.base_mode === "light"));
      setDark(r.items.filter((t) => t.base_mode === "dark"));
    }, () => undefined);
    return () => { alive = false; };
  }, [s.version]);
  if (!light.length && !dark.length) return null;
  const pickFor = (key: "systemLight" | "systemDark", list: UserTheme[]) => (
    <select value={s.prefs[key] ?? ""} aria-label={key === "systemLight" ? "Tema cuando el equipo está en claro" : "Tema cuando el equipo está en oscuro"}
      onChange={(e) => { const t = list.find((x) => x.id === e.target.value); void updatePrefs({ [key]: e.target.value || null }, t ? { id: t.id, name: t.name, config: t.config } : undefined); }}
      className="w-full rounded-xl border px-3 py-2 text-sm" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)", color: "var(--t-text)" }}>
      <option value="">{key === "systemLight" ? "Pearl Amethyst (oficial)" : "Obsidian Amethyst (oficial)"}</option>
      {list.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
    </select>
  );
  return (
    <div className="mt-4 rounded-2xl border p-3" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)" }}>
      <p className="text-sm font-bold">🖥️ Modo automático</p>
      <p className="text-xs" style={{ color: "var(--t-muted)" }}>Cuando eliges «Automático», RemHub cambia solo según tu equipo. Puedes usar tus temas para cada caso.</p>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <label className="text-xs font-semibold">☀️ Equipo en claro{pickFor("systemLight", light)}</label>
        <label className="text-xs font-semibold">🌙 Equipo en oscuro{pickFor("systemDark", dark)}</label>
      </div>
      {s.prefs.mode !== "system" ? (
        <button type="button" onClick={() => void updatePrefs({ mode: "system" })} className="mt-2 text-xs font-bold" style={{ color: "var(--t-accent)" }}>Usar «Automático» ahora →</button>
      ) : null}
    </div>
  );
}

function ThemeCard({ name, subtitle, config, active, official, favorite, onUse, onEdit, onDuplicate, onRename, onExport, onFavorite, onDelete }: {
  name: string; subtitle: string; config: ThemeConfig; active: boolean; official?: boolean; favorite?: boolean;
  onUse: () => void; onEdit?: () => void; onDuplicate: () => void; onRename?: () => void; onExport: () => void; onFavorite?: () => void; onDelete?: () => void;
}) {
  const c = config.colors;
  return (
    <div className="overflow-hidden rounded-2xl border" style={{ borderColor: active ? "var(--t-accent)" : "var(--t-card-border)", boxShadow: active ? "0 0 0 2px color-mix(in oklab, var(--t-accent) 35%, transparent)" : undefined, background: "var(--t-card-bg)" }}>
      {/* Mini vista del tema */}
      <button type="button" onClick={onUse} className="relative block h-20 w-full text-left" style={{ background: c.bg }} aria-label={`Usar ${name}`}>
        <span className="absolute inset-y-2 left-2 w-10 rounded-lg" style={{ background: c.menu, border: `1px solid ${c.text}22` }} />
        <span className="absolute left-14 right-2 top-2 h-7 rounded-lg" style={{ background: c.surface, border: `1px solid ${c.text}1f` }}>
          <span className="absolute left-2 top-2 h-1.5 w-16 rounded" style={{ background: c.text, opacity: 0.85 }} />
          <span className="absolute left-2 top-4 h-1 w-10 rounded" style={{ background: c.muted }} />
        </span>
        <span className="absolute bottom-2 left-14 h-6 w-16 rounded-lg" style={{ background: `linear-gradient(135deg, ${c.accent}, ${c.accent2})` }} />
        <span className="absolute bottom-2 left-32 h-6 w-6 rounded-full" style={{ background: c.accent3 }} />
        {active ? <span className="absolute right-2 top-11 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-black text-white" style={{ background: "var(--t-accent)" }}><Check size={11} /> En uso</span> : null}
        {official ? <span className="absolute right-2 bottom-2 rounded-full px-2 py-0.5 text-[10px] font-black" style={{ background: c.surface, color: c.accent }}>Oficial</span> : null}
      </button>
      <div className="flex items-center gap-2 p-2.5">
        <Dots colors={swatches(config)} size={22} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold">{name}</p>
          <p className="truncate text-[11px]" style={{ color: "var(--t-muted)" }}>{subtitle}</p>
        </div>
        {onFavorite ? (
          <button type="button" onClick={onFavorite} aria-pressed={favorite} aria-label={favorite ? "Quitar de favoritos" : "Marcar favorito"} className="grid h-8 w-8 place-items-center rounded-full" style={{ color: favorite ? "#f59e0b" : "var(--t-muted)" }}>
            <Star size={15} fill={favorite ? "#f59e0b" : "none"} />
          </button>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-1 border-t px-2 py-2" style={{ borderColor: "var(--t-card-border)" }}>
        <Mini onClick={onUse} strong>{active ? "✓ En uso" : "Usar"}</Mini>
        {onEdit ? <Mini onClick={onEdit}><Pencil size={12} /> Editar</Mini> : null}
        <Mini onClick={onDuplicate}><Copy size={12} /> {official ? "Personalizar copia" : "Duplicar"}</Mini>
        {onRename ? <Mini onClick={onRename}>Renombrar</Mini> : null}
        <Mini onClick={onExport}><Download size={12} /> Exportar</Mini>
        {onDelete ? <Mini onClick={onDelete} danger><Trash2 size={12} /></Mini> : null}
      </div>
    </div>
  );
}

function Mini({ children, onClick, strong, danger }: { children: React.ReactNode; onClick: () => void; strong?: boolean; danger?: boolean }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-bold transition hover:-translate-y-px"
      style={strong ? { background: "var(--t-accent)", borderColor: "transparent", color: "var(--t-on-accent, #fff)" } : danger ? { borderColor: "color-mix(in oklab, var(--t-danger) 45%, transparent)", color: "var(--t-danger)" } : { borderColor: "var(--t-card-border)" }}>
      {children}
    </button>
  );
}

/* =================================================================== EDITOR */

type Tab = "identity" | "backgrounds" | "glass" | "components" | "type" | "effects" | "a11y";
const TABS: Array<[Tab, string, string]> = [
  ["identity", "🎨", "Identidad"], ["backgrounds", "🖼️", "Fondos"], ["glass", "✨", "Vidrio"], ["components", "🧩", "Componentes"],
  ["type", "🔤", "Tipografía"], ["effects", "🌌", "Efectos"], ["a11y", "♿", "Accesibilidad"],
];

function Editor({ theme, from, name, onDone, onClose }: { theme: UserTheme | null; from?: ThemeConfig; name?: string; onDone: () => void; onClose: () => void }) {
  const initial = useMemo(() => normalizeTheme(theme?.config ?? from ?? OBSIDIAN), [theme, from]);
  const [draft, setDraft] = useState<ThemeConfig>(initial);
  const [title, setTitle] = useState(theme?.name ?? name ?? "Mi tema");
  const [description, setDescription] = useState(theme?.description ?? "");
  const [tab, setTab] = useState<Tab>("identity");
  const [mobile, setMobile] = useState<"edit" | "preview">("edit");
  const [live, setLive] = useState(false);
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial) || title !== (theme?.name ?? name ?? "Mi tema") || description !== (theme?.description ?? "");

  // «Aplicar temporalmente»: todo el panel (solo esta pestaña) se ve con el borrador mientras se edita.
  useEffect(() => { if (live) setPreview(draft); }, [live, draft]);
  useEffect(() => () => setPreview(null), []);

  const up = <K extends keyof ThemeConfig>(k: K, patch: Partial<ThemeConfig[K]>) => setDraft((d) => normalizeTheme({ ...d, [k]: { ...(d[k] as object), ...patch } }));
  const report = accessibilityReport(draft);
  const readable = isReadable(draft);

  async function save(asNew: boolean) {
    const clean = cleanName(title);
    if (!clean) { void Swal.fire({ ...swal, icon: "info", title: "Ponle un nombre al tema" }); setTab("identity"); return; }
    if (!readable) {
      const r = await Swal.fire({ ...swal, icon: "warning", title: "Hay texto que no se lee bien", text: "Para guardar, el texto debe tener buen contraste con el fondo (WCAG AA). ¿Lo corregimos automáticamente?", showCancelButton: true, confirmButtonText: "Corregir y guardar", cancelButtonText: "Revisar" });
      if (!r.isConfirmed) { setTab("a11y"); return; }
    }
    const config = readable ? draft : fixReadability(draft);
    setBusy(true);
    try {
      const saved = await saveTheme({ id: asNew ? undefined : theme?.id, name: asNew && theme ? `${clean} (nuevo)`.slice(0, 60) : clean, description, config });
      setPreview(null);
      const use = await Swal.fire({ ...swal, icon: "success", title: "Tema guardado", text: "¿Lo quieres usar ahora?", showCancelButton: true, confirmButtonText: "Usar ahora", cancelButtonText: "Después" });
      if (use.isConfirmed) await activateTheme(saved);
      onDone();
    } catch (e) {
      void Swal.fire({ ...swal, icon: "error", title: "No se pudo guardar", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function cancel(closeAll = false) {
    if (dirty) {
      const r = await Swal.fire({ ...swal, icon: "question", title: "¿Salir sin guardar?", text: "Se descartan los cambios y vuelve el tema que tenías.", showCancelButton: true, confirmButtonText: "Salir sin guardar", cancelButtonText: "Seguir editando" });
      if (!r.isConfirmed) return;
    }
    setPreview(null);
    if (closeAll) onClose(); else onDone();
  }

  return (
    <>
      <header className="flex shrink-0 items-center gap-2 border-b px-3 py-2.5 sm:px-5" style={{ borderColor: "var(--t-card-border)" }}>
        <button type="button" onClick={() => void cancel()} className="grid h-9 w-9 shrink-0 place-items-center rounded-full border" style={{ borderColor: "var(--t-card-border)" }} aria-label="Volver"><ArrowLeft size={16} /></button>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-black uppercase tracking-[0.18em]" style={{ color: "var(--t-accent)" }}>{theme ? "Editar tema" : "Nuevo tema"}</p>
          <p className="truncate text-sm font-black sm:text-base">{cleanName(title) || "Sin nombre"}{dirty ? <span className="ml-1.5 text-[11px] font-semibold" style={{ color: "var(--t-warning)" }}>· sin guardar</span> : null}</p>
        </div>
        <button type="button" onClick={() => setLive((v) => { if (v) setPreview(null); return !v; })} aria-pressed={live}
          className="hidden items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold sm:inline-flex"
          style={live ? { background: "var(--t-accent)", color: "var(--t-on-accent,#fff)", borderColor: "transparent" } : { borderColor: "var(--t-card-border)" }}
          title="Ver todo el panel con este tema (solo en esta pestaña, sin guardar)"><Eye size={13} /> {live ? "Aplicado temporalmente" : "Aplicar temporalmente"}</button>
        <button type="button" onClick={() => void cancel(true)} className="grid h-9 w-9 shrink-0 place-items-center rounded-full border" style={{ borderColor: "var(--t-card-border)" }} aria-label="Cerrar"><X size={16} /></button>
      </header>

      {/* Celular: editar o ver la vista previa (nunca una encima de la otra). */}
      <div className="flex shrink-0 gap-1 border-b p-1.5 md:hidden" style={{ borderColor: "var(--t-card-border)" }}>
        {(["edit", "preview"] as const).map((k) => (
          <button key={k} type="button" onClick={() => setMobile(k)} className="flex-1 rounded-full py-1.5 text-xs font-bold"
            style={mobile === k ? { background: "var(--t-accent)", color: "var(--t-on-accent,#fff)" } : undefined}>{k === "edit" ? "✏️ Editar" : "👁️ Vista previa"}</button>
        ))}
      </div>

      <div className="grid min-h-0 flex-1 md:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
        <div className={`min-h-0 flex-col md:flex md:border-r ${mobile === "edit" ? "flex" : "hidden"}`} style={{ borderColor: "var(--t-card-border)" }}>
          <nav className="flex shrink-0 gap-1 overflow-x-auto border-b px-2 py-2 [scrollbar-width:none]" style={{ borderColor: "var(--t-card-border)" }} role="tablist">
            {TABS.map(([k, icon, label]) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
                className="shrink-0 rounded-full px-3 py-1.5 text-xs font-bold transition"
                style={tab === k ? { background: "var(--t-accent)", color: "var(--t-on-accent,#fff)" } : { color: "var(--t-text)" }}>
                {icon} {label}{k === "a11y" && !readable ? " ⚠️" : ""}
              </button>
            ))}
          </nav>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-4">
            {tab === "identity" ? (
              <>
                <Field label="Nombre del tema"><input value={title} maxLength={60} onChange={(e) => setTitle(e.target.value)} className={inputCls} style={inputStyle} /></Field>
                <Field label="Descripción (opcional)"><input value={description} maxLength={200} onChange={(e) => setDescription(e.target.value)} placeholder="Ej: para trabajar de noche" className={inputCls} style={inputStyle} /></Field>
                <Field label="Tipo base">
                  <Segment value={draft.base} options={[["light", "☀️ Claro"], ["dark", "🌙 Oscuro"]]}
                    onChange={(v) => setDraft((d) => normalizeTheme({ ...(v === "dark" ? OBSIDIAN : PEARL), colors: { ...(v === "dark" ? OBSIDIAN : PEARL).colors, accent: d.colors.accent, accent2: d.colors.accent2, accent3: d.colors.accent3 } }))} />
                  <p className="mt-1 text-[11px]" style={{ color: "var(--t-muted)" }}>Al cambiar el tipo se ajustan fondos y textos para que se lean; tus colores de acento se conservan.</p>
                </Field>
                <ColorRow label="Color principal" hint="Botones, seleccionado, enlaces" value={draft.colors.accent} onChange={(v) => up("colors", { accent: v })} />
                <ColorRow label="Color secundario" hint="Degradados y detalles" value={draft.colors.accent2} onChange={(v) => up("colors", { accent2: v })} />
                <ColorRow label="Color de énfasis" hint="Brillos y destacados (úsalo con moderación)" value={draft.colors.accent3} onChange={(v) => up("colors", { accent3: v })} />
                <div className="flex gap-1 overflow-hidden rounded-xl">{swatches(draft).map((c, i) => <span key={i} className="h-8 flex-1" style={{ background: c }} title={c} />)}</div>
                <QuickPalettes onPick={(a, b, c) => up("colors", { accent: a, accent2: b, accent3: c })} />
              </>
            ) : null}

            {tab === "backgrounds" ? (
              <>
                <ColorRow label="Fondo principal" value={draft.colors.bg} onChange={(v) => up("colors", { bg: v })} />
                <ColorRow label="Fondo de tarjetas" value={draft.colors.surface} onChange={(v) => up("colors", { surface: v })} />
                <Field label="Estilo del fondo">
                  <Segment value={draft.background.kind} options={[["solid", "Sólido"], ["gradient", "Degradado"], ["glow", "Luces suaves"]] as Array<[BackgroundKind, string]>} onChange={(v) => up("background", { kind: v })} />
                </Field>
                {draft.background.kind !== "solid" ? (
                  <>
                    <ColorRow label={draft.background.kind === "gradient" ? "Color inicial" : "Color de la luz"} value={draft.background.from} onChange={(v) => up("background", { from: v })} />
                    {draft.background.kind === "gradient" ? (
                      <>
                        <ColorRow label="Color final" value={draft.background.to} onChange={(v) => up("background", { to: v })} />
                        <Slider label="Dirección" unit="°" min={0} max={360} value={draft.background.angle} onChange={(v) => up("background", { angle: v })} />
                      </>
                    ) : null}
                    <Slider label="Intensidad" unit="%" min={0} max={100} value={draft.background.intensity} onChange={(v) => up("background", { intensity: v })} />
                  </>
                ) : null}
              </>
            ) : null}

            {tab === "glass" ? (
              <>
                <p className="text-xs" style={{ color: "var(--t-muted)" }}>Se nota con «Vidrio» encendido en Apariencia. Los límites evitan diseños que no se lean o que pongan lento el equipo.</p>
                <Field label="Nivel">
                  <Segment value={draft.glass.level} options={[["off", "Sin vidrio"], ["subtle", "Sutil"], ["elegant", "Elegante"], ["premium", "Premium"], ["custom", "Personal"]] as Array<[GlassLevel, string]>} onChange={(v) => up("glass", { level: v })} />
                </Field>
                {draft.glass.level === "custom" ? (
                  <>
                    <Slider label="Opacidad de las tarjetas" unit="%" min={45} max={100} value={draft.glass.opacity} onChange={(v) => up("glass", { opacity: v })} />
                    <Slider label="Desenfoque" unit="px" min={0} max={32} value={draft.glass.blur} onChange={(v) => up("glass", { blur: v })} />
                    <Slider label="Saturación" unit="%" min={100} max={200} value={draft.glass.saturation} onChange={(v) => up("glass", { saturation: v })} />
                    <Slider label="Reflejos" unit="%" min={0} max={100} value={draft.glass.sheen} onChange={(v) => up("glass", { sheen: v })} />
                  </>
                ) : null}
                <Slider label="Intensidad de bordes" unit="%" min={0} max={40} value={draft.glass.border} onChange={(v) => up("glass", { border: v })} />
                <Slider label="Intensidad de sombras" unit="%" min={0} max={100} value={draft.glass.shadow} onChange={(v) => up("glass", { shadow: v })} />
              </>
            ) : null}

            {tab === "components" ? (
              <>
                <p className="text-xs" style={{ color: "var(--t-muted)" }}>Cada color pinta a toda su familia de componentes en todo RemHub.</p>
                <ColorRow label="Menú lateral y barra superior" value={draft.colors.menu} onChange={(v) => up("colors", { menu: v })} />
                <ColorRow label="Ventanas, menús y notificaciones" value={draft.colors.dialog} onChange={(v) => up("colors", { dialog: v })} />
                <ColorRow label="Campos de formulario" value={draft.colors.input} onChange={(v) => up("colors", { input: v })} />
                <Slider label="Bordes redondeados (tarjetas, botones, campos)" unit="px" min={0} max={28} value={draft.layout.radius} onChange={(v) => up("layout", { radius: v })} />
                <Slider label="Intensidad de separadores y bordes" unit="%" min={4} max={30} value={draft.layout.dividers} onChange={(v) => up("layout", { dividers: v })} />
              </>
            ) : null}

            {tab === "type" ? (
              <>
                <ColorRow label="Texto principal" value={draft.colors.text} onChange={(v) => up("colors", { text: v })} />
                <ColorRow label="Texto secundario" value={draft.colors.muted} onChange={(v) => up("colors", { muted: v })} />
                <Slider label="Tamaño del texto" unit="%" min={90} max={115} value={draft.layout.fontScale} onChange={(v) => up("layout", { fontScale: v })} />
                <Field label="Densidad">
                  <Segment value={draft.layout.density} options={[["compact", "Compacta"], ["normal", "Normal"], ["comfortable", "Cómoda"]] as Array<[Density, string]>} onChange={(v) => up("layout", { density: v })} />
                </Field>
                <p className="text-[11px]" style={{ color: "var(--t-muted)" }}>La letra es Geist, la de RemHub (ya incluida; no se descargan fuentes de afuera).</p>
              </>
            ) : null}

            {tab === "effects" ? (
              <>
                <Toggle label="Halo en lo seleccionado" hint="Un brillo suave alrededor de lo activo" on={draft.effects.halo} onChange={(v) => up("effects", { halo: v })} />
                <Toggle label="Movimiento al pasar el mouse" hint="Los botones y tarjetas se levantan un poco" on={draft.effects.hover} onChange={(v) => up("effects", { hover: v })} />
                <EffectsPrefs />
              </>
            ) : null}

            {tab === "a11y" ? (
              <>
                <p className="text-xs" style={{ color: "var(--t-muted)" }}>Revisión de contraste WCAG 2.2 (AA): texto normal 4.5:1, elementos grandes 3:1. El foco del teclado siempre queda visible.</p>
                <ul className="space-y-1.5">
                  {report.map((r) => (
                    <li key={r.key} className="flex items-center gap-2 rounded-xl border px-3 py-2 text-sm" style={{ borderColor: r.ok ? "var(--t-card-border)" : "var(--t-danger)" }}>
                      <span>{r.ok ? "✅" : "⚠️"}</span>
                      <span className="min-w-0 flex-1">{r.label}</span>
                      <b className="tabular-nums" style={{ color: r.ok ? "var(--t-success)" : "var(--t-danger)" }}>{r.ratio.toFixed(2)}:1</b>
                      <span className="text-[11px]" style={{ color: "var(--t-muted)" }}>mín. {r.min}</span>
                    </li>
                  ))}
                </ul>
                {!readable ? (
                  <button type="button" onClick={() => setDraft((d) => fixReadability(d))} className="inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-sm font-bold" style={{ background: "var(--t-accent)", color: "var(--t-on-accent,#fff)" }}>
                    <Wand2 size={14} /> Corregir el texto automáticamente
                  </button>
                ) : <p className="text-sm font-semibold" style={{ color: "var(--t-success)" }}>Todo el texto se lee bien. 👌</p>}
              </>
            ) : null}
          </div>
        </div>

        <div className={`min-h-0 overflow-y-auto overscroll-contain p-3 md:block sm:p-4 ${mobile === "preview" ? "block" : "hidden"}`}>
          <Preview theme={draft} />
        </div>
      </div>

      <footer className="flex shrink-0 flex-wrap items-center gap-2 border-t px-3 py-2.5 pb-[max(0.6rem,env(safe-area-inset-bottom))] sm:px-5" style={{ borderColor: "var(--t-card-border)" }}>
        <button type="button" onClick={() => void cancel()} className="rounded-full border px-4 py-2 text-sm font-bold" style={{ borderColor: "var(--t-card-border)" }}>Cancelar</button>
        <button type="button" disabled={!dirty} onClick={() => { setDraft(initial); setTitle(theme?.name ?? name ?? "Mi tema"); setDescription(theme?.description ?? ""); }}
          className="inline-flex items-center gap-1 rounded-full px-3 py-2 text-sm font-bold disabled:opacity-40" title="Volver a como estaba al abrir el editor"><RotateCcw size={14} /> Restaurar cambios</button>
        <span className="flex-1" />
        {theme ? <button type="button" disabled={busy} onClick={() => void save(true)} className="rounded-full border px-4 py-2 text-sm font-bold disabled:opacity-50" style={{ borderColor: "var(--t-card-border)" }}>Guardar como nuevo</button> : null}
        <button type="button" disabled={busy || (!dirty && Boolean(theme))} onClick={() => void save(false)} className="rounded-full px-5 py-2 text-sm font-black shadow disabled:opacity-50" style={{ background: "var(--t-accent)", color: "var(--t-on-accent,#fff)" }}>
          {busy ? "Guardando…" : theme ? "Guardar cambios" : "Guardar tema"}
        </button>
      </footer>
    </>
  );
}

function EffectsPrefs() {
  const s = useAppearanceState();
  return (
    <div className="rounded-2xl border p-3" style={{ borderColor: "var(--t-card-border)" }}>
      <p className="text-xs font-bold" style={{ color: "var(--t-muted)" }}>Para todos tus temas (se guarda en tu cuenta al instante)</p>
      <Toggle label="🌌 Fondo animado" hint="Movimiento lento; se apaga solo si pides reducir animaciones" on={s.prefs.animated} onChange={(v) => void updatePrefs({ animated: v })} />
      <Toggle label="🐢 Reducir animaciones" hint="También se respeta si tu equipo lo pide" on={s.prefs.reducedMotion} onChange={(v) => void updatePrefs({ reducedMotion: v })} />
    </div>
  );
}

/* ------------------------------------------------------------------ vista previa (aislada: usa los tokens del borrador solo dentro de este recuadro) */

function Preview({ theme }: { theme: ThemeConfig }) {
  const tokens = themeTokens(theme);
  const style: React.CSSProperties & Record<string, string> = { colorScheme: tokens["color-scheme"] as "light" | "dark" } as React.CSSProperties & Record<string, string>;
  for (const [k, v] of Object.entries(tokens)) if (k.startsWith("--")) style[k] = v;
  const c = theme.colors;
  const radius = `${theme.layout.radius}px`;
  const card: React.CSSProperties = { background: "var(--t-card-bg)", border: "1px solid var(--t-card-border)", borderRadius: radius, boxShadow: "var(--t-shadow)" };
  const [modal, setModal] = useState(false);
  return (
    <div className="relative overflow-hidden p-3 text-[13px]" style={{ ...style, background: `${tokens["--t-bg"] === "none" ? "" : `${tokens["--t-bg"]}, `}${c.bg}`, color: "var(--t-text)", borderRadius: radius, border: "1px solid var(--t-card-border)", fontSize: `${(theme.layout.fontScale / 100) * 13}px` }}>
      <p className="mb-2 text-[10px] font-black uppercase tracking-[0.18em]" style={{ color: "var(--t-muted)" }}>Vista previa en vivo</p>
      <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-2">
        <aside className="space-y-1 p-2" style={{ background: "var(--t-menu-bg)", border: "1px solid var(--t-card-border)", borderRadius: radius }}>
          {["Inicio", "POS", "Pedidos", "Inventario", "Caja"].map((x, i) => (
            <div key={x} className="truncate px-2 py-1 text-[11px] font-semibold" style={i === 2 ? { background: "color-mix(in oklab, var(--t-accent) 18%, transparent)", color: "var(--t-accent)", borderRadius: radius, boxShadow: theme.effects.halo ? "0 0 14px -4px var(--t-accent)" : undefined } : { color: "var(--t-muted)" }}>{x}</div>
          ))}
        </aside>
        <div className="min-w-0 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div className="p-2.5" style={card}><p className="text-[10px] font-bold uppercase" style={{ color: "var(--t-muted)" }}>Ventas de hoy</p><p className="text-lg font-black">$ 2.480.000</p><p className="text-[10px] font-bold" style={{ color: "var(--t-success)" }}>▲ 12 % vs ayer</p></div>
            <div className="p-2.5" style={card}><p className="text-[10px] font-bold uppercase" style={{ color: "var(--t-muted)" }}>Pedidos</p><p className="text-lg font-black">38</p><p className="text-[10px] font-bold" style={{ color: "var(--t-warning)" }}>4 por confirmar</p></div>
          </div>
          <div className="overflow-hidden" style={card}>
            <div className="grid grid-cols-[1fr_auto_auto] gap-2 px-2.5 py-1.5 text-[10px] font-bold uppercase" style={{ color: "var(--t-muted)", borderBottom: "1px solid var(--t-card-border)" }}><span>Producto</span><span>Stock</span><span>Precio</span></div>
            {[["Olla arrocera 1.8 L", "24", "$ 89.000"], ["Batidora 5 vel.", "3", "$ 65.000"], ["Soporte TV P4", "0", "$ 43.500"]].map(([n, q, pr]) => (
              <div key={n} className="grid grid-cols-[1fr_auto_auto] gap-2 px-2.5 py-1.5" style={{ borderBottom: "1px solid var(--t-card-border)" }}>
                <span className="truncate">{n}</span><b style={{ color: q === "0" ? "var(--t-danger)" : "var(--t-text)" }}>{q}</b><span>{pr}</span>
              </div>
            ))}
          </div>
          <div className="space-y-1.5 p-2.5" style={card}>
            <input readOnly value="Buscar producto…" className="w-full px-2.5 py-1.5 text-[12px] outline-none" style={{ background: "var(--t-input-bg)", border: "1px solid var(--t-card-border)", borderRadius: radius, color: "var(--t-muted)" }} />
            <select className="w-full px-2.5 py-1.5 text-[12px]" style={{ background: "var(--t-input-bg)", border: "1px solid var(--t-card-border)", borderRadius: radius, color: "var(--t-text)" }} defaultValue="a"><option value="a">SEDE ZAMORA</option></select>
            <div className="flex flex-wrap gap-1.5">
              <button type="button" onClick={() => setModal(true)} className="px-3 py-1.5 text-[12px] font-black" style={{ background: `linear-gradient(135deg, ${c.accent}, ${c.accent2})`, color: "var(--t-on-accent)", borderRadius: radius }}>Botón principal</button>
              <button type="button" className="px-3 py-1.5 text-[12px] font-bold" style={{ border: "1px solid var(--t-card-border)", borderRadius: radius }}>Secundario</button>
              <button type="button" className="px-3 py-1.5 text-[12px] font-bold outline outline-2 outline-offset-2" style={{ border: "1px solid var(--t-card-border)", borderRadius: radius, outlineColor: c.accent }}>Con foco</button>
            </div>
            <div className="flex flex-wrap gap-1.5 text-[11px] font-bold">
              <span className="rounded-full px-2 py-0.5" style={{ background: "color-mix(in oklab, var(--t-success) 16%, transparent)", color: "var(--t-success)" }}>✓ Pagado</span>
              <span className="rounded-full px-2 py-0.5" style={{ background: "color-mix(in oklab, var(--t-warning) 16%, transparent)", color: "var(--t-warning)" }}>⚠ Pendiente</span>
              <span className="rounded-full px-2 py-0.5" style={{ background: "color-mix(in oklab, var(--t-danger) 16%, transparent)", color: "var(--t-danger)" }}>✕ Anulado</span>
            </div>
          </div>
          <div className="flex items-start gap-2 p-2.5" style={{ ...card, background: "var(--t-glass-dialog)" }}>
            <span>🔔</span><div className="min-w-0"><p className="text-[12px] font-bold">Notificación</p><p className="text-[11px]" style={{ color: "var(--t-muted)" }}>2 pedidos internos por atender.</p></div>
          </div>
        </div>
      </div>
      {modal ? (
        <div className="absolute inset-0 grid place-items-center bg-black/40 p-4" onClick={() => setModal(false)}>
          <div className="w-full max-w-xs p-4" style={{ ...card, background: "var(--t-glass-dialog)" }}>
            <p className="font-black">Ventana de ejemplo</p>
            <p className="mt-1 text-[12px]" style={{ color: "var(--t-muted)" }}>Así se ven los modales con este tema.</p>
            <button type="button" className="mt-3 px-3 py-1.5 text-[12px] font-black" style={{ background: c.accent, color: "var(--t-on-accent)", borderRadius: radius }}>Aceptar</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ controles */

const inputCls = "mt-1 w-full rounded-xl border px-3 py-2 text-sm outline-none";
const inputStyle: React.CSSProperties = { borderColor: "var(--t-card-border)", background: "var(--t-card-bg)", color: "var(--t-text)" };

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block text-xs font-bold">{label}{children}</label>;
}

function ColorRow({ label, hint, value, onChange }: { label: string; hint?: string; value: string; onChange: (v: string) => void }) {
  const [text, setText] = useState(value);
  const [bad, setBad] = useState(false);
  const [r, g, b] = hexToRgb(value);
  const [h, s, l] = rgbToHsl(r, g, b);
  // Si el valor cambia desde afuera (otra pestaña del editor, corrección automática), el campo lo muestra.
  const shown = bad ? text : value;
  return (
    <div className="flex items-center gap-3">
      <input type="color" value={value} onChange={(e) => { onChange(e.target.value); setBad(false); setText(e.target.value); }} aria-label={label}
        className="h-11 w-11 shrink-0 cursor-pointer rounded-xl border p-0.5" style={{ borderColor: "var(--t-card-border)", background: "transparent" }} />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-bold">{label}</p>
        {hint ? <p className="text-[11px]" style={{ color: "var(--t-muted)" }}>{hint}</p> : null}
        <p className="text-[10px] tabular-nums" style={{ color: "var(--t-muted)" }}>RGB {r}, {g}, {b} · HSL {h}°, {s}%, {l}%</p>
      </div>
      <input value={shown} onChange={(e) => { setText(e.target.value); const n = normalizeColor(e.target.value); setBad(!n); if (n) onChange(n); }}
        onBlur={() => { setBad(false); setText(value); }} spellCheck={false} aria-label={`${label} (HEX, RGB o HSL)`} placeholder="#a78bfa"
        className="w-28 shrink-0 rounded-xl border px-2 py-2 text-center font-mono text-xs outline-none" style={{ ...inputStyle, borderColor: bad ? "var(--t-danger)" : "var(--t-card-border)" }} />
    </div>
  );
}

function Slider({ label, unit, min, max, value, onChange }: { label: string; unit: string; min: number; max: number; value: number; onChange: (v: number) => void }) {
  return (
    <label className="block">
      <span className="flex items-center justify-between text-xs font-bold">{label}<span className="tabular-nums" style={{ color: "var(--t-muted)" }}>{value}{unit}</span></span>
      <input type="range" min={min} max={max} value={value} onChange={(e) => onChange(Number(e.target.value))} className="mt-2 h-6 w-full cursor-pointer" style={{ accentColor: "var(--t-accent)" }} />
    </label>
  );
}

function Segment<T extends string>({ value, options, onChange }: { value: T; options: Array<[T, string]>; onChange: (v: T) => void }) {
  return (
    <div className="mt-1 flex flex-wrap gap-1 rounded-xl border p-1" style={{ borderColor: "var(--t-card-border)" }} role="radiogroup">
      {options.map(([k, l]) => (
        <button key={k} type="button" role="radio" aria-checked={value === k} onClick={() => onChange(k)} className="min-w-[4.5rem] flex-1 rounded-lg px-2 py-2 text-xs font-bold transition"
          style={value === k ? { background: "var(--t-accent)", color: "var(--t-on-accent,#fff)" } : undefined}>{l}</button>
      ))}
    </div>
  );
}

function Toggle({ label, hint, on, onChange }: { label: string; hint?: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={() => onChange(!on)} className="flex w-full items-center gap-3 py-2 text-left">
      <span className="min-w-0 flex-1"><span className="block text-sm font-bold">{label}</span>{hint ? <span className="block text-[11px]" style={{ color: "var(--t-muted)" }}>{hint}</span> : null}</span>
      <span className="inline-flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition" style={{ background: on ? "var(--t-accent)" : "var(--t-card-border)" }}>
        <span className="h-5 w-5 rounded-full bg-white shadow transition" style={{ transform: on ? "translateX(20px)" : "none" }} />
      </span>
    </button>
  );
}

function QuickPalettes({ onPick }: { onPick: (a: string, b: string, c: string) => void }) {
  const list: Array<[string, string, string, string]> = [
    ["Amatista", "#a78bfa", "#8b5cf6", "#d946ef"], ["Zafiro", "#60a5fa", "#2563eb", "#22d3ee"], ["Esmeralda", "#34d399", "#059669", "#a3e635"],
    ["Dorado", "#fbbf24", "#d97706", "#f472b6"], ["Rubí", "#fb7185", "#e11d48", "#f59e0b"], ["Grafito", "#a1a1aa", "#52525b", "#e4e4e7"],
  ];
  return (
    <div>
      <p className="text-xs font-bold">Paletas rápidas</p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {list.map(([n, a, b, c]) => (
          <button key={n} type="button" onClick={() => onPick(a, b, c)} className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold" style={{ borderColor: "var(--t-card-border)" }}>
            <span className="h-3.5 w-3.5 rounded-full" style={{ background: `linear-gradient(135deg, ${a}, ${b}, ${c})` }} /> {n}
          </button>
        ))}
      </div>
    </div>
  );
}
