"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Copy, Download, Loader2, Minus, Pencil, Plus, Printer, Search, Trash2, X } from "lucide-react";
import Swal from "@/lib/swal";
import { productLabelData, tokensIn, type LabelData } from "@/lib/labels/data";
import { paginate, perPage, printDocument, rowsPerPage, validateProfile, type JobLabel } from "@/lib/labels/layout";
import { canvasMeasure } from "@/lib/labels/measure-browser";
import { renderLabel, labelSvg, type ElementIssue } from "@/lib/labels/render";
import { separatorDesign } from "@/lib/labels/templates";
import type { LabelTemplate, PrinterProfile } from "@/lib/labels/types";
import { printHtmlSilently, printHtmlWindow } from "@/lib/print/transports";
import { storeShareUrl } from "@/lib/share/store-host";
import { useSearchValue } from "@/lib/search-timing";
import { usePickKeys } from "@/lib/search-keys";
import type { DashboardStore } from "@/lib/store-utils";
import { Thumb } from "../inventario/LineEditor";
import { useErpFinderSource } from "../useErpFinder";
import { Button, inputCls, inputStyle } from "../fiscal/ui";
import { IssueList, PageSvg, segBtn } from "./parts";
import { loadLabelProducts, loadPointPrices, type LabelLine, type LabelProduct } from "./products";

const SUBDOMAINS = process.env.NEXT_PUBLIC_STORE_SUBDOMAINS === "1";
const MAX_LABELS = 5000;
const swal = { background: "var(--t-bg-base)", color: "var(--t-text)", confirmButtonColor: "#8b5cf6" };

/** auto: imprimir apenas esté todo cargado (p. ej. todas las etiquetas de un ingreso de factura). */
export type PrintSeed = { lines: LabelLine[]; point: string | null; label: string; key: number; auto?: boolean } | null;

export function PrintPanel({ store, templates, template, onTemplate, profiles, profile, onProfile, points, seed, level, onLevel, point, onPoint, onEditTemplate, onLog, userName }: {
  store: DashboardStore;
  templates: LabelTemplate[];
  template: LabelTemplate;
  onTemplate: (id: string) => void;
  profiles: Array<{ id: string; name: string }>;
  profile: PrinterProfile;
  onProfile: (id: string) => void;
  points: Array<{ id: string; name: string }>;
  seed: PrintSeed;
  level: number;
  onLevel: (l: number) => void;
  point: string;
  onPoint: (p: string) => void;
  onEditTemplate: (t: LabelTemplate) => void;
  onLog: (j: { key: string; templateId: string | null; templateName: string; profileName: string; userName: string | null; items: Array<{ product_id: string; name: string; qty: number }>; total: number }) => Promise<void>;
  userName: string | null;
}) {
  const [lines, setLines] = useState<LabelLine[]>([]);
  const [products, setProducts] = useState<Map<string, LabelProduct>>(new Map());
  const [pointPrices, setPointPrices] = useState<Map<string, number[]> | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [start, setStart] = useState(0);
  const [busy, setBusy] = useState(false);
  const [showPages, setShowPages] = useState(12);
  const [error, setError] = useState<string | null>(null);
  const [autoMsg, setAutoMsg] = useState<string | null>(null);
  const autoDone = useRef<number | null>(null);
  // Etiqueta en blanco con franja negra entre un producto y el siguiente (se recuerda en este equipo).
  const [separate, setSeparate] = useState(() => { try { return window.localStorage.getItem("remhub:labels:separar") !== "0"; } catch { return true; } });
  const toggleSeparate = () => setSeparate((v) => { try { window.localStorage.setItem("remhub:labels:separar", v ? "0" : "1"); } catch { /* sin almacenamiento */ } return !v; });

  // Lo que llega por enlace (producto, ingreso, traslado o lista general) o de «Repetir» en el historial.
  const seedKey = seed?.key;
  useEffect(() => {
    if (!seed) return;
    const t = window.setTimeout(() => {
      setLines(seed.lines);
      setSource(seed.label);
      if (seed.point) onPoint(seed.point);
    }, 0);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedKey]);

  // Datos de los productos que faltan.
  const missingIds = useMemo(() => lines.map((l) => l.product_id).filter((id) => !products.has(id)), [lines, products]);
  useEffect(() => {
    if (!missingIds.length) return;
    let alive = true;
    void loadLabelProducts(missingIds).then((m) => {
      if (alive) setProducts((cur) => new Map([...cur, ...m]));
    }, (e: unknown) => { if (alive) setError(e instanceof Error ? e.message : "No se pudieron cargar los productos."); });
    return () => { alive = false; };
  }, [missingIds]);

  // Precios del punto elegido.
  useEffect(() => {
    let alive = true;
    if (!point) { const t = window.setTimeout(() => setPointPrices(null), 0); return () => { alive = false; window.clearTimeout(t); }; }
    void loadPointPrices(store.id, point).then((m) => { if (alive) setPointPrices(m); });
    return () => { alive = false; };
  }, [store.id, point]);

  const pointName = points.find((p) => p.id === point)?.name ?? "";
  const usesSeq = useMemo(() => template.design.elements.some((e) => "content" in e && tokensIn(e.content).includes("consecutivo")), [template]);
  const dataFor = useCallback((p: LabelProduct, seq?: number): LabelData => productLabelData(
    { ...p, prices: pointPrices?.get(p.id) ?? p.prices },
    { store: store.name, point: pointName, whatsapp: store.whatsapp, productUrl: p.active ? storeShareUrl(store.slug, `/producto/${p.id}`, SUBDOMAINS) : "", level, seq },
  ), [pointPrices, store, pointName, level]);

  const ready = useMemo(() => lines.filter((l) => products.has(l.product_id)), [lines, products]);
  const total = ready.reduce((s, l) => s + l.qty, 0);

  // Una etiqueta por producto para revisar errores (todas sus copias son iguales).
  const perProduct = useMemo(() => {
    const m = new Map<string, { body: string; issues: ElementIssue[] }>();
    for (const l of ready) {
      const p = products.get(l.product_id)!;
      if (m.has(p.id)) continue;
      m.set(p.id, renderLabel({ design: template.design, data: dataFor(p, 1), dpi: profile.dpi, measure: canvasMeasure, images: { logo: store.logo_url, foto: p.image_url } }));
    }
    return m;
  }, [ready, products, template, dataFor, profile.dpi, store.logo_url]);
  const errors = [...perProduct.entries()].filter(([, r]) => r.issues.some((i) => i.level === "error"));
  const allIssues = [...perProduct.values()].flatMap((r) => r.issues);
  const sizeMismatch = Math.abs(template.design.w - profile.labelW) > 0.3 || Math.abs(template.design.h - profile.labelH) > 0.3;
  const profileErrors = validateProfile(profile).filter((i) => i.level === "error");

  // Etiquetas en orden (cada copia) y sus páginas.
  const sepInput = useMemo(() => ({ design: separatorDesign(template.design.w, template.design.h), data: {}, dpi: profile.dpi, measure: canvasMeasure }), [template.design.w, template.design.h, profile.dpi]);
  const sepBody = useMemo(() => renderLabel(sepInput), [sepInput]);
  const jobLabels = useMemo<JobLabel[]>(() => {
    const out: JobLabel[] = [];
    let seq = 0;
    for (const [li, l] of ready.entries()) {
      if (separate && li > 0 && out.length < MAX_LABELS) out.push({ key: "sep", input: sepInput });
      const p = products.get(l.product_id)!;
      const images = { logo: store.logo_url, foto: p.image_url };
      for (let k = 0; k < l.qty && out.length < MAX_LABELS; k++) {
        seq++;
        out.push({ key: usesSeq ? `${p.id}#${seq}` : p.id, input: { design: template.design, data: usesSeq ? dataFor(p, seq) : dataFor(p, 1), dpi: profile.dpi, measure: canvasMeasure, images } });
      }
    }
    return out;
  }, [ready, products, template, dataFor, profile.dpi, usesSeq, store.logo_url, separate, sepInput]);
  const separators = jobLabels.filter((j) => j.key === "sep").length;
  const productLabels = jobLabels.length - separators;
  const pages = useMemo(() => paginate(jobLabels, profile, start), [jobLabels, profile, start]);
  const empty = pages.length * perPage(profile) - jobLabels.length;

  // «Imprimir de una vez»: cuando los productos y los precios del punto están cargados, se imprime una sola vez.
  const allLoaded = lines.length > 0 && ready.length === lines.length && (!point || pointPrices !== null);
  useEffect(() => {
    // Solo con la lista que llegó en el enlace (no con productos que ya estaban).
    if (!seed?.auto || autoDone.current === seed.key || lines !== seed.lines || !allLoaded || !jobLabels.length) return;
    autoDone.current = seed.key;
    const t = window.setTimeout(() => {
      setAutoMsg(errors.length || profileErrors.length
        ? `No se imprimió solo: hay avisos en rojo. Corrígelos y toca «Imprimir» (${productLabels.toLocaleString("es-CO")} etiquetas de ${seed.label}).`
        : `Se abrió la impresión de las ${productLabels.toLocaleString("es-CO")} etiquetas de ${seed.label} con «${template.name}» en «${profile.name}». Si no apareció la ventana, toca «Imprimir».`);
      void print(true);
    }, 0);
    return () => window.clearTimeout(t);
  });

  // ------------------------------------------------------------ búsqueda (y lector de códigos)
  const finder = useErpFinderSource(store.id, { priceLevel: 3 });
  const [q, setQ] = useState("");
  const search = useSearchValue(q);
  const term = search.value;
  const [hits, setHits] = useState<Array<{ id: string; name: string; code: string | null; image_url: string | null }>>([]);
  const [searching, setSearching] = useState(false);
  const searchRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    let alive = true;
    if (term.trim().length < 2) { const t = window.setTimeout(() => setHits([]), 0); return () => { alive = false; window.clearTimeout(t); }; }
    const t = window.setTimeout(() => setSearching(true), 0);
    void finder.searchText(term.trim()).then((r) => { if (alive) setHits(r.slice(0, 12).map((h) => ({ id: h.id, name: h.name, code: h.code ?? null, image_url: h.image_url ?? null }))); }, () => { if (alive) setHits([]); }).finally(() => { if (alive) setSearching(false); });
    return () => { alive = false; window.clearTimeout(t); };
  }, [term, finder]);

  function add(id: string, qty = 1) {
    setLines((cur) => (cur.some((l) => l.product_id === id) ? cur.map((l) => (l.product_id === id ? { ...l, qty: Math.min(MAX_LABELS, l.qty + qty) } : l)) : [...cur, { product_id: id, qty }]));
  }
  const setQty = (id: string, qty: number) => setLines((cur) => cur.map((l) => (l.product_id === id ? { ...l, qty: Math.max(1, Math.min(MAX_LABELS, Math.floor(qty) || 1)) } : l)));
  const remove = (id: string) => setLines((cur) => cur.filter((l) => l.product_id !== id));

  // Escribir o pistolear solo busca (Enter busca ya); se agrega con clic o con ↓/↑ y Enter.
  function pickHit(id: string) { add(id); setQ(""); setHits([]); searchRef.current?.focus(); }
  const keys = usePickKeys(q ? hits.length : 0, (i) => { if (hits[i]) pickHit(hits[i].id); }, { onSearch: search.flush, onEscape: () => { setQ(""); setHits([]); } });

  // ------------------------------------------------------------ imprimir
  async function print(auto = false) {
    if (busy || !jobLabels.length) return;
    if (profileErrors.length) return void Swal.fire({ ...swal, icon: "error", title: "Revisa la impresora", text: profileErrors[0].message });
    if (errors.length) return void Swal.fire({ ...swal, icon: "error", title: "Hay etiquetas con errores", text: "Corrige los avisos en rojo (por ejemplo un código que no cabe) antes de imprimir." });
    if (sizeMismatch) {
      const r = await Swal.fire({ ...swal, icon: "warning", title: "La plantilla es de otro tamaño", text: `La plantilla mide ${template.design.w} × ${template.design.h} mm y la etiqueta de la impresora ${profile.labelW} × ${profile.labelH} mm. Se puede imprimir igual, pero puede quedar corrida.`, showCancelButton: true, confirmButtonText: "Imprimir igual", cancelButtonText: "Volver" });
      if (!r.isConfirmed) return;
    }
    setBusy(true);
    // Deja respirar la pantalla antes de armar un trabajo grande.
    await new Promise((r) => window.setTimeout(r, 30));
    try {
      const doc = printDocument(pages, profile, `Etiquetas · ${template.name}`);
      // Sin un toque del usuario el navegador bloquea ventanas nuevas: en automático se imprime desde un marco oculto.
      if (auto) printHtmlSilently(doc.html); else printHtmlWindow(doc.html);
      const key = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}`;
      void onLog({
        key, templateId: template.id, templateName: template.name, profileName: profile.name, userName,
        items: ready.map((l) => ({ product_id: l.product_id, name: products.get(l.product_id)?.name ?? "", qty: l.qty })), total: productLabels,
      }).catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  function downloadOne(p: LabelProduct) {
    const { svg } = labelSvg({ design: template.design, data: dataFor(p, 1), dpi: profile.dpi, measure: canvasMeasure, images: { logo: store.logo_url, foto: p.image_url } });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    a.download = `etiqueta-${(p.sku || p.name).replace(/[^\w-]+/g, "_").slice(0, 40)}.svg`;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      {/* ------------------------------------------------ productos */}
      <section className="space-y-3 rounded-2xl border p-3 sm:p-4" style={{ borderColor: "var(--t-card-border)", background: "color-mix(in oklab, var(--t-card-bg) 90%, transparent)" }}>
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-black">1 · Productos y cantidades</h2>
          {source ? <span className="truncate rounded-full px-2 py-0.5 text-[11px] font-bold" style={{ background: "color-mix(in oklab, var(--t-accent) 14%, transparent)" }}>{source}</span> : null}
        </div>
        <div className="relative">
          <label className="flex items-center gap-2 rounded-xl border px-3" style={inputStyle}>
            {searching ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} style={{ color: "var(--t-muted)" }} />}
            <input ref={searchRef} value={q} onChange={(e) => { setQ(e.target.value); keys.reset(); }} onKeyDown={keys.onKeyDown} autoComplete="off"
              placeholder="Buscar o escanear (nombre, referencia o código)…" className="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none" />
            {q ? <button type="button" onClick={() => { setQ(""); setHits([]); }} aria-label="Limpiar"><X size={14} /></button> : null}
          </label>
          {hits.length && q ? (
            <ul className="absolute inset-x-0 top-full z-30 mt-1 max-h-80 overflow-y-auto rounded-xl border p-1 shadow-2xl" style={{ borderColor: "var(--t-card-border)", background: "var(--t-bg-base)" }}>
              {hits.map((h, i) => (
                <li key={h.id}>
                  <button type="button" onClick={() => pickHit(h.id)}
                    style={i === keys.active ? { background: "color-mix(in oklab, var(--t-accent) 16%, transparent)" } : undefined}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-[color:color-mix(in_oklab,var(--t-accent)_10%,transparent)]">
                    <Thumb src={h.image_url} size={32} />
                    <span className="min-w-0 flex-1"><span className="block truncate font-semibold">{h.name}</span>{h.code ? <span className="block text-[11px]" style={{ color: "var(--t-muted)" }}>Cód. {h.code}</span> : null}</span>
                    <Plus size={15} />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        {error ? <p className="rounded-xl border border-red-500/40 bg-red-500/10 p-2 text-xs text-red-400">{error}</p> : null}
        {autoMsg ? <p className="rounded-xl border px-3 py-2 text-xs font-semibold" style={{ borderColor: "var(--t-accent)", background: "color-mix(in oklab, var(--t-accent) 10%, transparent)" }}>🖨️ {autoMsg}</p> : null}
        {lines.length ? (
          <>
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="font-bold">{lines.length} producto{lines.length === 1 ? "" : "s"} · {total.toLocaleString("es-CO")} etiqueta{total === 1 ? "" : "s"}</span>
              <button type="button" className="ml-auto rounded-full border px-2 py-0.5" style={{ borderColor: "var(--t-card-border)" }} onClick={() => setLines((cur) => cur.map((l) => ({ ...l, qty: 1 })))}>Todas en 1</button>
              <button type="button" className="rounded-full border px-2 py-0.5 text-red-400" style={{ borderColor: "var(--t-card-border)" }} onClick={() => { setLines([]); setSource(null); }}>Vaciar</button>
            </div>
            <ul className="max-h-[52vh] space-y-1.5 overflow-y-auto pr-1">
              {lines.map((l) => {
                const p = products.get(l.product_id);
                const bad = perProduct.get(l.product_id)?.issues.some((i) => i.level === "error");
                return (
                  <li key={l.product_id} className="flex items-center gap-2 rounded-xl border p-1.5" style={{ borderColor: bad ? "#ef4444" : "var(--t-card-border)" }}>
                    <Thumb src={p?.image_url ?? null} size={36} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-bold">{p?.name ?? "Cargando…"}</p>
                      <p className="flex items-center gap-1 truncate text-[11px]" style={{ color: "var(--t-muted)" }}>
                        {p?.sku ? <>Ref. {p.sku}<button type="button" title="Copiar referencia" onClick={() => void navigator.clipboard?.writeText(p.sku ?? "")}><Copy size={11} /></button></> : "Sin referencia"}
                        {p?.barcode ? <span>· {p.barcode}</span> : null}
                        {p && !p.active ? <span className="text-amber-500">· inactivo (sin enlace al catálogo)</span> : null}
                      </p>
                    </div>
                    <div className="flex items-center gap-0.5">
                      <button type="button" onClick={() => setQty(l.product_id, l.qty - 1)} disabled={l.qty <= 1} className="grid h-8 w-7 place-items-center rounded-lg border disabled:opacity-40" style={{ borderColor: "var(--t-card-border)" }} aria-label="Una menos"><Minus size={13} /></button>
                      <input type="text" inputMode="numeric" value={l.qty} onFocus={(e) => e.currentTarget.select()} onChange={(e) => setQty(l.product_id, Number(e.target.value.replace(/\D/g, "")))}
                        className="h-8 w-12 rounded-lg border text-center text-sm font-black tabular-nums outline-none" style={{ borderColor: "var(--t-accent)", background: "var(--t-card-bg)", color: "var(--t-text)" }} aria-label="Cantidad de etiquetas" />
                      <button type="button" onClick={() => setQty(l.product_id, l.qty + 1)} className="grid h-8 w-7 place-items-center rounded-lg border" style={{ borderColor: "var(--t-card-border)" }} aria-label="Una más"><Plus size={13} /></button>
                    </div>
                    {p ? <button type="button" onClick={() => downloadOne(p)} title="Descargar esta etiqueta (SVG en mm)" className="grid h-8 w-8 place-items-center rounded-lg"><Download size={14} /></button> : null}
                    <button type="button" onClick={() => remove(l.product_id)} className="grid h-8 w-8 place-items-center rounded-lg text-red-400" aria-label="Quitar"><Trash2 size={14} /></button>
                  </li>
                );
              })}
            </ul>
          </>
        ) : (
          <p className="rounded-xl border border-dashed p-5 text-center text-sm" style={{ borderColor: "var(--t-card-border)", color: "var(--t-muted)" }}>
            Busca o escanea productos. También puedes llegar aquí desde un producto, un ingreso, un traslado o la Lista general con sus cantidades.
          </p>
        )}
      </section>

      {/* ------------------------------------------------ plantilla, impresora y vista previa */}
      <section className="space-y-3 rounded-2xl border p-3 sm:p-4" style={{ borderColor: "var(--t-card-border)", background: "color-mix(in oklab, var(--t-card-bg) 90%, transparent)" }}>
        <h2 className="text-sm font-black">2 · Plantilla, impresora y vista previa</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="text-[11px] font-bold" style={{ color: "var(--t-muted)" }}>Plantilla
            <span className="mt-0.5 flex gap-1">
              <select value={template.id} onChange={(e) => onTemplate(e.target.value)} className={inputCls} style={inputStyle}>
                {templates.map((t) => <option key={t.id} value={t.id}>{t.builtin ? "⭐ " : ""}{t.name}{t.builtin ? "" : ` · ${t.design.w}×${t.design.h}`}</option>)}
              </select>
              <button type="button" onClick={() => onEditTemplate(template)} title="Diseñar o cambiar esta plantilla" className="grid w-10 shrink-0 place-items-center rounded-xl border" style={{ borderColor: "var(--t-card-border)" }}><Pencil size={15} /></button>
            </span>
          </label>
          <label className="text-[11px] font-bold" style={{ color: "var(--t-muted)" }}>Impresora y papel
            <select value={profile.id ?? "local"} onChange={(e) => onProfile(e.target.value)} className={`${inputCls} mt-0.5`} style={inputStyle}>
              {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label className="text-[11px] font-bold" style={{ color: "var(--t-muted)" }}>Precios de
            <select value={point} onChange={(e) => onPoint(e.target.value)} className={`${inputCls} mt-0.5`} style={inputStyle}>
              <option value="">La tienda (sin reglas de punto)</option>
              {points.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <div className="text-[11px] font-bold" style={{ color: "var(--t-muted)" }}>{"{precio}"} es el precio
            <div className="mt-0.5 flex gap-1">
              {[1, 2, 3, 4, 5].map((l) => (
                <button key={l} type="button" onClick={() => onLevel(l)} className="h-10 flex-1 rounded-xl border text-sm font-bold" style={segBtn(level === l)} title={l === 2 ? "Por mayor" : l === 3 ? "Detal" : `Precio ${l}`}>{l}</button>
              ))}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-bold">Empezar en la posición</span>
          {Array.from({ length: Math.min(perPage(profile), 12) }, (_, i) => (
            <button key={i} type="button" onClick={() => setStart(i)} className="h-7 w-7 rounded-lg border font-bold" style={segBtn(start === i)}>{i + 1}</button>
          ))}
          <span style={{ color: "var(--t-muted)" }}>{profile.mode === "roll" ? "de la primera fila" : "de la primera hoja"} (para no desperdiciar)</span>
        </div>
        <button type="button" onClick={toggleSeparate} className="flex w-full items-center gap-2 rounded-xl border px-3 py-2 text-left text-xs" style={separate ? { borderColor: "var(--t-accent)", background: "color-mix(in oklab, var(--t-accent) 9%, transparent)" } : { borderColor: "var(--t-card-border)" }}>
          <span className="grid h-5 w-5 shrink-0 place-items-center rounded-md border font-black" style={separate ? { background: "var(--t-accent)", borderColor: "var(--t-accent)", color: "#fff" } : { borderColor: "var(--t-card-border)" }}>{separate ? "✓" : ""}</span>
          <span><b>Separar productos:</b> entre un producto y el siguiente va una etiqueta en blanco con una franja negra gruesa, para ver dónde termina cada uno{separators ? ` (${separators} separador${separators === 1 ? "" : "es"})` : ""}.</span>
        </button>

        {sizeMismatch ? (
          <p className="rounded-xl border px-3 py-2 text-xs" style={{ borderColor: "#f59e0b", color: "#d97706" }}>
            ⚠️ La plantilla mide {template.design.w} × {template.design.h} mm y la etiqueta de «{profile.name}» {profile.labelW} × {profile.labelH} mm. Elige otra plantilla o ábrela en el diseñador y usa «Tamaño de la impresora».
          </p>
        ) : null}
        {profileErrors.length ? <p className="rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-400">⛔ {profileErrors[0].message}</p> : null}
        <IssueList issues={allIssues} />

        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2 text-xs" style={{ borderColor: "var(--t-card-border)" }}>
          <span>
            <b>{productLabels.toLocaleString("es-CO")}</b> etiqueta{productLabels === 1 ? "" : "s"}{separators ? <> + {separators} separador{separators === 1 ? "" : "es"}</> : null} · <b>{pages.length}</b> {profile.mode === "roll" ? `fila${pages.length === 1 ? "" : "s"} de ${profile.cols}` : `hoja${pages.length === 1 ? "" : "s"} de ${perPage(profile)}`}
            {empty > 0 && jobLabels.length ? <> · {empty} posición{empty === 1 ? "" : "es"} vacía{empty === 1 ? "" : "s"}</> : null}
            {total > MAX_LABELS ? <span className="text-amber-500"> · máximo {MAX_LABELS.toLocaleString("es-CO")} por trabajo</span> : null}
          </span>
          <Button variant="primary" icon={busy ? <Loader2 size={15} className="animate-spin" /> : <Printer size={15} />} disabled={busy || !jobLabels.length || errors.length > 0} onClick={() => void print()}>
            Imprimir {productLabels ? productLabels.toLocaleString("es-CO") : ""}
          </Button>
        </div>

        {jobLabels.length ? (
          <div className="space-y-2">
            <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--t-muted)" }}>
              Vista previa · {profile.mode === "roll" ? `rollo de ${profile.pageW} mm, ${rowsPerPage(profile) * profile.cols} por fila` : `hoja de ${profile.pageW} × ${profile.pageH} mm`}
            </p>
            {pages.slice(0, showPages).map((page, i) => (
              <PageSvg key={i} profile={profile} cells={page.map((lbl) => {
                if (!lbl) return null;
                const pid = lbl.key.split("#")[0];
                const r = lbl.key === "sep" ? sepBody : usesSeq ? renderLabel(lbl.input) : perProduct.get(pid);
                return r ? { body: r.body, w: lbl.input.design.w, h: lbl.input.design.h, bad: r.issues.some((x) => x.level === "error") } : null;
              })} />
            ))}
            {pages.length > showPages ? (
              <button type="button" onClick={() => setShowPages((n) => n + 24)} className="w-full rounded-xl border py-2 text-xs font-bold" style={{ borderColor: "var(--t-card-border)" }}>
                Ver más ({pages.length - showPages} {profile.mode === "roll" ? "filas" : "hojas"} más)
              </button>
            ) : null}
          </div>
        ) : null}
        <p className="text-[11px]" style={{ color: "var(--t-muted)" }}>
          Se abre la ventana de impresión del sistema con páginas de {profile.pageW} × {profile.mode === "roll" ? profile.labelH : profile.pageH} mm. Elige tu impresora; en su configuración el papel debe medir lo mismo, sin márgenes y al 100 % (sin «ajustar a la página»).
          {" "}También puedes «Guardar como PDF» ahí mismo con las medidas exactas.
          {lines.length ? <> · <a className="underline" href={`/documento/etiquetas?productos=${lines.map((l) => l.product_id).join(",")}`} target="_blank" rel="noreferrer">Etiquetas para térmica de tirilla (ESC/POS)</a></> : null}
        </p>
      </section>
    </div>
  );
}
