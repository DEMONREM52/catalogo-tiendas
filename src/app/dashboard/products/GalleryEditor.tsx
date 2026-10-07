"use client";

import { useState } from "react";
import { Reorder, useDragControls } from "framer-motion";
import { ArrowDown, ArrowUp, GripVertical, Star, Trash2 } from "lucide-react";
import { ImageUpload } from "../store/ImageUpload";

const textStyle: React.CSSProperties = {
  borderColor: "var(--t-card-border)",
  background: "color-mix(in oklab, var(--t-card-bg) 92%, transparent)",
  color: "var(--t-text)",
};

const newKey = () => Math.random().toString(36).slice(2, 10);
type Slot = { key: string; url: string };

/**
 * Galería de fotos con orden editable: arrastra desde ⠿, o usa ↑ ↓ y "Primera".
 * Cada foto tiene una clave fija, así al reordenar nunca se pisan los archivos.
 */
export function GalleryEditor({
  urls,
  onChange,
  userId,
  productId,
  uploadId,
  max = 6,
}: {
  urls: string[];
  onChange: (urls: string[]) => void;
  userId: string | null;
  productId?: string;
  uploadId: string;
  max?: number;
}) {
  const [slots, setSlots] = useState<Slot[]>(() => urls.map((url) => ({ key: newKey(), url })));
  // Si la galería cambia desde fuera (por ejemplo al cargar el producto), se sincroniza.
  const synced = slots.length === urls.length && slots.every((s, i) => s.url === urls[i]) ? slots : urls.map((url, i) => ({ key: slots[i]?.key ?? newKey(), url }));

  function commit(next: Slot[]) {
    setSlots(next);
    onChange(next.map((s) => s.url));
  }

  function move(from: number, to: number) {
    if (to < 0 || to >= synced.length || from === to) return;
    const next = [...synced];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    commit(next);
  }

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-semibold">Galería de fotos</h3>
          <p className="text-xs opacity-70">
            Hasta {max} imágenes extra, máximo 2 MB cada una. {synced.length > 1 ? "Arrastra ⠿ o usa las flechas para cambiar el orden." : ""}
          </p>
        </div>
        {synced.length < max ? (
          <button type="button" className="rounded-xl border px-3 py-2 text-sm font-semibold" style={textStyle} onClick={() => commit([...synced, { key: newKey(), url: "" }])}>
            + Agregar foto
          </button>
        ) : null}
      </div>

      {synced.length > 1 ? (
        <div className="mb-3 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]" aria-label="Vista rápida del orden">
          {synced.map((s, i) => (
            <div key={s.key} className="relative shrink-0">
              {s.url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={s.url} alt="" className="h-14 w-14 rounded-xl border object-cover" style={{ borderColor: "var(--t-card-border)" }} />
              ) : (
                <span className="grid h-14 w-14 place-items-center rounded-xl border text-lg" style={{ borderColor: "var(--t-card-border)" }}>📷</span>
              )}
              <span className="absolute -left-1 -top-1 grid h-5 w-5 place-items-center rounded-full text-[10px] font-black text-white" style={{ background: "var(--t-accent)" }}>{i + 1}</span>
            </div>
          ))}
        </div>
      ) : null}

      <Reorder.Group axis="y" values={synced} onReorder={commit} className="space-y-2">
        {synced.map((slot, index) => (
          <GalleryRow
            key={slot.key}
            slot={slot}
            index={index}
            total={synced.length}
            userId={userId}
            fileName={`${productId ?? `new-${uploadId}`}-gallery-${slot.key}.jpg`}
            onUrl={(url) => commit(synced.map((s) => (s.key === slot.key ? { ...s, url } : s)))}
            onMove={(to) => move(index, to)}
            onRemove={() => commit(synced.filter((s) => s.key !== slot.key))}
          />
        ))}
      </Reorder.Group>
    </div>
  );
}

function GalleryRow({
  slot, index, total, userId, fileName, onUrl, onMove, onRemove,
}: {
  slot: Slot; index: number; total: number; userId: string | null; fileName: string;
  onUrl: (url: string) => void; onMove: (to: number) => void; onRemove: () => void;
}) {
  const controls = useDragControls();
  const btn = "grid h-9 w-9 place-items-center rounded-xl border transition hover:brightness-125 disabled:opacity-30";
  return (
    <Reorder.Item
      value={slot}
      dragListener={false}
      dragControls={controls}
      className="flex items-stretch gap-2 rounded-2xl"
      whileDrag={{ scale: 1.02, boxShadow: "0 18px 40px rgba(0,0,0,0.35)", zIndex: 10 }}
      style={{ position: "relative" }}
    >
      <button
        type="button"
        onPointerDown={(e) => controls.start(e)}
        className="grid w-9 shrink-0 cursor-grab touch-none place-items-center rounded-xl border active:cursor-grabbing"
        style={textStyle}
        aria-label={`Arrastrar foto ${index + 1} para cambiar el orden`}
        title="Arrastra para mover"
      >
        <GripVertical size={18} />
      </button>
      <div className="min-w-0 flex-1">
        {userId ? (
          <ImageUpload label={`Foto ${index + 1}${index === 0 ? " · primera" : ""}`} currentUrl={slot.url || null} pathPrefix={`${userId}/products/`} fileName={fileName} bucket="product-images" onUploaded={onUrl} />
        ) : (
          <input className="w-full rounded-2xl border p-3" style={textStyle} type="url" value={slot.url} onChange={(e) => onUrl(e.target.value)} placeholder="URL pública de imagen" />
        )}
      </div>
      <div className="flex shrink-0 flex-col gap-1.5">
        <button type="button" className={btn} style={textStyle} disabled={index === 0} onClick={() => onMove(index - 1)} aria-label={`Subir foto ${index + 1}`} title="Subir">
          <ArrowUp size={15} />
        </button>
        <button type="button" className={btn} style={textStyle} disabled={index === total - 1} onClick={() => onMove(index + 1)} aria-label={`Bajar foto ${index + 1}`} title="Bajar">
          <ArrowDown size={15} />
        </button>
        <button type="button" className={btn} style={textStyle} disabled={index === 0} onClick={() => onMove(0)} aria-label={`Poner foto ${index + 1} de primera`} title="Poner de primera">
          <Star size={15} />
        </button>
        <button type="button" className={btn} style={{ ...textStyle, color: "#f87171" }} onClick={onRemove} aria-label={`Quitar foto ${index + 1}`} title="Quitar">
          <Trash2 size={15} />
        </button>
      </div>
    </Reorder.Item>
  );
}
