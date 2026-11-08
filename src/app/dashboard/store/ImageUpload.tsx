"use client";

import { useEffect, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { IMAGE_CACHE_SECONDS, prepareImage } from "@/lib/image-prepare";
import { DROP_BLOCKED_MSG, imageFileFrom as imageFrom, imageFromDroppedUrl as imageFromUrl } from "@/lib/image-drop";

type Props = {
  label: string;
  currentUrl: string | null;
  pathPrefix: string; // ej: `${userId}/products/`
  fileName: string; // ej: `${productId}.png`
  onUploaded: (publicUrl: string) => void;
  bucket?: string; // si no lo pasas, usa "store-assets"
};

/** ¿El foco está en un campo de texto? (ahí Ctrl+V debe pegar texto, no la foto). */
function typingTarget(el: EventTarget | null) {
  const node = el as HTMLElement | null;
  if (!node) return false;
  return node.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(node.tagName);
}

export function ImageUpload({
  label,
  currentUrl,
  pathPrefix,
  fileName,
  onUploaded,
  bucket,
  compact = false,
}: Props & { /** Solo la foto y los botones, sin textos (ficha del producto). */ compact?: boolean }) {
  const [uploading, setUploading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const hovered = useRef(false);
  const dragDepth = useRef(0);
  const busy = useRef(false);

  async function upload(file: File) {
    if (busy.current) return;
    busy.current = true;
    setUploading(true);
    setMsg(null);

    try {
      // Validaciones
      if (!file.type.startsWith("image/")) {
        setMsg("❌ Debe ser una imagen.");
        return;
      }
      // Se reduce y se pasa a WebP antes de subir (fotos de celular de varios MB quedan livianas).
      if (file.size > 15 * 1024 * 1024) {
        setMsg("❌ Máximo 15 MB.");
        return;
      }
      const prepared = await prepareImage(file);
      if (prepared.blob.size > 2 * 1024 * 1024) {
        setMsg("❌ La imagen sigue pesando más de 2 MB. Prueba con otra.");
        return;
      }

      const sb = supabaseBrowser(); // ✅ importante
      let filePath = `${pathPrefix}${fileName}`;
      const bucketName = bucket ?? "store-assets";
      const opts = { cacheControl: IMAGE_CACHE_SECONDS, contentType: prepared.contentType };

      let { error: upErr } = await sb.storage.from(bucketName).upload(filePath, prepared.blob, { ...opts, upsert: true });
      // Reemplazar un archivo que subió otra persona (o el script de optimización) lo bloquea la regla de Storage
      // («solo el dueño del archivo lo cambia»). En ese caso se guarda como archivo nuevo, que sí está permitido.
      if (upErr && /row-level security|unauthorized|403/i.test(upErr.message ?? "")) {
        const dot = fileName.lastIndexOf(".");
        const base = dot > 0 ? fileName.slice(0, dot) : fileName;
        const ext = dot > 0 ? fileName.slice(dot) : "";
        filePath = `${pathPrefix}${base}-${Date.now().toString(36)}${ext}`;
        ({ error: upErr } = await sb.storage.from(bucketName).upload(filePath, prepared.blob, { ...opts, upsert: false }));
      }

      if (upErr) throw upErr;

      const { data } = sb.storage.from(bucketName).getPublicUrl(filePath);
      const url = `${data.publicUrl}?t=${Date.now()}`;

      onUploaded(url);
      setMsg("✅ Subido correctamente.");
    } catch (err) {
      setMsg("❌ " + ((err as { message?: string } | null)?.message ?? "Error subiendo imagen"));
    } finally {
      busy.current = false;
      setUploading(false);
    }
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) await upload(file);
  }

  // Ctrl+V: si el mouse está encima del recuadro (o el recuadro tiene el foco) y no se está escribiendo en un campo.
  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      const box = boxRef.current;
      if (!box) return;
      const inside = hovered.current || box.contains(document.activeElement);
      if (!inside || typingTarget(e.target)) return;
      const file = imageFrom(e.clipboardData);
      if (!file) return;
      e.preventDefault();
      void upload(file);
    }
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  });

  // Si la foto se suelta fuera del recuadro, el navegador la abriría y se perderían los cambios sin guardar.
  useEffect(() => {
    const guard = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes("Files") && !typingTarget(e.target)) e.preventDefault();
    };
    window.addEventListener("dragover", guard);
    window.addEventListener("drop", guard);
    return () => { window.removeEventListener("dragover", guard); window.removeEventListener("drop", guard); };
  }, []);

  /** Botón «Pegar»: lee la imagen copiada (Chrome/Edge; en otros navegadores, Ctrl+V encima del recuadro). */
  async function pasteFromButton() {
    setMsg(null);
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const type = item.types.find((t) => t.startsWith("image/"));
        if (type) {
          const blob = await item.getType(type);
          await upload(new File([blob], "pegada", { type }));
          return;
        }
      }
      setMsg("❌ No hay una imagen copiada. Copia la foto (clic derecho → Copiar imagen) y vuelve a intentar.");
    } catch {
      setMsg("ℹ️ Pon el mouse sobre este recuadro y presiona Ctrl+V.");
    }
  }

  async function onDrop(e: React.DragEvent) {
    e.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    const file = imageFrom(e.dataTransfer);
    if (file) return upload(file);
    try {
      const remote = await imageFromUrl(e.dataTransfer);
      if (remote) return upload(remote);
      setMsg("❌ Eso no es una imagen.");
    } catch {
      setMsg("❌ " + DROP_BLOCKED_MSG);
    }
  }

  return (
    <div
      ref={boxRef}
      tabIndex={0}
      onMouseEnter={() => { hovered.current = true; }}
      onMouseLeave={() => { hovered.current = false; }}
      onDragEnter={(e) => { e.preventDefault(); dragDepth.current++; setDragging(true); }}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; }}
      onDragLeave={() => { dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDragging(false); }}
      onDrop={onDrop}
      className={`relative rounded-2xl border outline-none transition focus-visible:ring-2 ${compact ? "p-2" : "p-4"}`}
      style={{
        borderColor: dragging ? "var(--t-accent)" : "var(--t-card-border)",
        borderStyle: dragging ? "dashed" : "solid",
        background: dragging ? "color-mix(in oklab, var(--t-accent) 14%, var(--t-card-bg-soft))" : "var(--t-card-bg-soft)",
        color: "var(--t-text)",
      }}
    >
      {compact ? (
        <label className="block cursor-pointer" title="Toca para subir, arrastra la foto o pégala con Ctrl+V">
          {currentUrl ? (
            <img src={currentUrl} alt={label} className="aspect-square w-full rounded-xl object-cover" />
          ) : (
            <span className="grid aspect-square w-full place-items-center rounded-xl text-4xl" style={{ background: "color-mix(in oklab, var(--t-accent) 10%, transparent)" }}>📷</span>
          )}
          <input className="hidden" type="file" accept="image/*" onChange={handleFile} />
        </label>
      ) : null}
      <div className={compact ? "mt-2 flex gap-2" : "flex items-start justify-between gap-4"}>
        {compact ? null : (
          <div className="min-w-0">
            <h3 className="font-semibold">{label}</h3>
            <p className="text-sm" style={{ color: "var(--t-muted)" }}>Arrastra la foto aquí o pégala con Ctrl+V.</p>
          </div>
        )}

        <div className={compact ? "grid w-full grid-cols-2 gap-2" : "flex shrink-0 flex-wrap justify-end gap-2"}>
          <button type="button" onClick={pasteFromButton} disabled={uploading} className="btn-soft rounded-xl px-3 py-2 text-sm font-semibold" title="Pegar la imagen que copiaste">
            📋 Pegar
          </button>
          <label className={`btn-soft cursor-pointer rounded-xl font-semibold ${compact ? "px-2 py-2 text-center text-sm" : "px-4 py-2"}`}>
            {uploading ? "Subiendo..." : "Subir"}
            <input
              className="hidden"
              type="file"
              accept="image/*"
              onChange={handleFile}
            />
          </label>
        </div>
      </div>

      {compact ? null : currentUrl ? (
        <div className="mt-4">
          <img
            src={currentUrl}
            alt={label}
            className="max-h-40 rounded-xl border object-contain"
            style={{ borderColor: "var(--t-card-border)" }}
          />
        </div>
      ) : (
        <p className="mt-4 text-sm" style={{ color: "var(--t-muted)" }}>Aún no has subido imagen.</p>
      )}

      {dragging ? (
        <div className="pointer-events-none absolute inset-0 grid place-items-center rounded-2xl text-sm font-bold" style={{ color: "var(--t-accent)" }}>
          <span className="rounded-full px-4 py-2 shadow" style={{ background: "var(--t-bg-base)" }}>📥 Suelta la foto aquí</span>
        </div>
      ) : null}

      {msg && <p className="mt-3 text-sm">{msg}</p>}
    </div>
  );
}
