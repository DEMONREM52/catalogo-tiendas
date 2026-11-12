"use client";

import { useEffect, useMemo, useState } from "react";
import { Camera, Loader2, RefreshCw } from "lucide-react";
import { ProductFinder, type FinderHit, type FinderSource, type FinderMode } from "@/components/product-finder/ProductFinder";
import { onIndexStatus, refreshIndexStatus, runImageIndex, type IndexStatus } from "@/lib/image-search/indexer";
import { useErpFinderSource } from "./useErpFinder";

/** Botón de cámara para poner al lado (o dentro) de un buscador del panel. */
export function PhotoSearchButton({
  source,
  onPick,
  pickLabel,
  title = "Buscar producto",
  subtitle,
  className = "",
  style,
  label,
  mode = "photo",
  storageKey,
  renderExtra,
}: {
  source: FinderSource;
  onPick: (hit: FinderHit) => void;
  pickLabel?: string;
  title?: string;
  subtitle?: string;
  className?: string;
  style?: React.CSSProperties;
  label?: string;
  mode?: FinderMode;
  storageKey?: string;
  renderExtra?: (hit: FinderHit) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`inline-flex shrink-0 items-center justify-center gap-1.5 rounded-xl border px-3 text-sm font-semibold transition hover:-translate-y-0.5 ${className}`}
        style={{ borderColor: "var(--t-card-border)", color: "var(--t-accent)", ...style }}
        title="Buscar con una foto o por código"
        aria-label="Buscar con una foto"
      >
        <Camera size={17} />
        {label ? <span>{label}</span> : null}
      </button>
      <ProductFinder
        open={open}
        onClose={() => setOpen(false)}
        source={source}
        title={title}
        subtitle={subtitle}
        pickLabel={pickLabel}
        initialMode={mode}
        storageKey={storageKey}
        renderExtra={renderExtra}
        onPick={(hit) => {
          setOpen(false);
          onPick(hit);
        }}
      />
    </>
  );
}

/** Estado de las fotos analizadas para la búsqueda por foto, con botón para analizar ya. */
export function PhotoIndexStatus({ storeId }: { storeId: string | null | undefined }) {
  const [status, setStatus] = useState<IndexStatus | null>(null);
  useEffect(() => onIndexStatus(setStatus), []);
  useEffect(() => {
    if (storeId) void refreshIndexStatus(storeId);
  }, [storeId]);
  if (!storeId || !status || status.state === "unavailable" || !status.total) return null;
  const running = status.state === "running" || status.state === "checking";
  const done = status.total - status.pending;
  const pct = status.total ? Math.round((done / status.total) * 100) : 100;
  return (
    <div className="flex flex-wrap items-center gap-2 text-[11px]" style={{ color: "var(--t-muted)" }}>
      <span className="inline-flex items-center gap-1.5">
        {running ? <Loader2 size={12} className="animate-spin" /> : <Camera size={12} />}
        Búsqueda por foto: {done} de {status.total} fotos listas
        {running && status.pending ? ` · analizando (${pct}%)` : ""}
      </span>
      {status.pending && !running ? (
        <button type="button" onClick={() => void runImageIndex(storeId)} className="inline-flex items-center gap-1 font-bold" style={{ color: "var(--t-accent)" }}>
          <RefreshCw size={11} /> Analizar ahora
        </button>
      ) : null}
      {status.state === "error" && status.message ? <span style={{ color: "#dc2626" }}>{status.message}</span> : null}
    </div>
  );
}

/**
 * Botón 📷 para cualquier buscador de productos del panel: abre la búsqueda por foto (o por nombre/código)
 * sobre todos los productos de la tienda y entrega el elegido. Cada pantalla decide qué hacer con él
 * (agregarlo, filtrar su lista, abrirlo…).
 */
export function ProductPhotoButton({
  storeId,
  onPick,
  title = "Buscar producto con una foto",
  subtitle,
  pickLabel = "Elegir",
  activeOnly,
  onlyIds,
  compact,
  className = "",
  style,
  label,
}: {
  storeId: string | null | undefined;
  onPick: (hit: FinderHit) => void;
  /** Solo estos productos (p. ej. los de una factura o un traslado). */
  onlyIds?: readonly string[];
  /** Sin alto mínimo (para meterlo dentro de un buscador pequeño). */
  compact?: boolean;
  title?: string;
  subtitle?: string;
  pickLabel?: string;
  activeOnly?: boolean;
  className?: string;
  style?: React.CSSProperties;
  label?: string;
}) {
  const base = useErpFinderSource(storeId, { activeOnly });
  const idsKey = onlyIds ? onlyIds.join(",") : null;
  const source = useMemo<FinderSource>(() => {
    if (idsKey === null) return base;
    const allowed = new Set(idsKey ? idsKey.split(",") : []);
    return {
      searchText: async (q) => (await base.searchText(q)).filter((h) => allowed.has(h.id)),
      searchPhoto: base.searchPhoto ? async (embedding, terms) => {
        const res = await base.searchPhoto!(embedding, terms);
        return { ...res, items: res.items.filter((h) => allowed.has(h.id)) };
      } : undefined,
    };
  }, [base, idsKey]);
  if (!storeId) return null;
  return (
    <PhotoSearchButton
      source={source}
      onPick={onPick}
      title={title}
      subtitle={subtitle ?? "Toma una foto del producto, de su caja o etiqueta. También puedes escribir el nombre o el código."}
      pickLabel={pickLabel}
      className={`${compact ? "" : "min-h-[2.5rem]"} ${className}`}
      style={style}
      label={label}
    />
  );
}

/** Texto para filtrar una lista con el producto elegido por foto: su referencia si tiene, si no su nombre. */
export function photoFilterText(hit: FinderHit) {
  return (hit.sku ?? "").trim() || hit.name;
}
