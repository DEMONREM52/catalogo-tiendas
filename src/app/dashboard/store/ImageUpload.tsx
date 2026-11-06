"use client";

import { useEffect, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { IMAGE_CACHE_SECONDS, prepareImage } from "@/lib/image-prepare";

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

/** Primera imagen de un portapapeles o de lo que se arrastró. */
function imageFrom(data: DataTransfer | null): File | null {
  if (!data) return null;
  for (const f of Array.from(data.files ?? [])) if (f.type.startsWith("image/")) return f;
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind === "file" && item.type.startsWith("image/")) {
      const f = item.getAsFile();
      if (f) return f;
    }
  }
  return null;
}

/** Imagen arrastrada desde otra página: viene como enlace. Se intenta descargar (si esa página lo permite). */
async function imageFromUrl(data: DataTransfer | null): Promise<File | null> {
  const html = data?.getData("text/html") ?? "";
  const fromHtml = /<img[^>]+src=["']([^"']+)["']/i.exec(html)?.[1];
  const raw = fromHtml || (data?.getData("text/uri-list") ?? "").split(/\r?\n/).find((l) => l && !l.startsWith("#")) || "";
  if (!raw) return null;
  if (raw.startsWith("data:image/")) {
    const blob = await (await fetch(raw)).blob();
    return new File([blob], "imagen", { type: blob.type });
  }
  if (!/^https?:\/\//i.test(raw)) return null;
  const res = await fetch(raw, { mode: "cors" });
  if (!res.ok) throw new Error("no se pudo descargar");
  const blob = await res.blob();
  if (!blob.type.startsWith("image/")) return null;
  return new File([blob], "imagen", { type: blob.type });
}

export function ImageUpload({
  label,
  currentUrl,
  pathPrefix,
  fileName,
  onUploaded,
  bucket,
}: Props) {
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
      const filePath = `${pathPrefix}${fileName}`;
      const bucketName = bucket ?? "store-assets";

      const { error: upErr } = await sb.storage
        .from(bucketName)
        .upload(filePath, prepared.blob, { upsert: true, cacheControl: IMAGE_CACHE_SECONDS, contentType: prepared.contentType });

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
      setMsg("❌ Esa página no deja copiar la foto arrastrándola. Guárdala en el computador o usa clic derecho → Copiar imagen y luego Ctrl+V aquí.");
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
      className="relative rounded-2xl border p-4 outline-none transition focus-visible:ring-2"
      style={{
        borderColor: dragging ? "var(--t-accent)" : "var(--t-card-border)",
        borderStyle: dragging ? "dashed" : "solid",
        background: dragging ? "color-mix(in oklab, var(--t-accent) 14%, var(--t-card-bg-soft))" : "var(--t-card-bg-soft)",
        color: "var(--t-text)",
      }}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="font-semibold">{label}</h3>
          <p className="text-sm" style={{ color: "var(--t-muted)" }}>Arrastra la foto aquí o pégala con Ctrl+V.</p>
        </div>

        <div className="flex shrink-0 flex-wrap justify-end gap-2">
          <button type="button" onClick={pasteFromButton} disabled={uploading} className="btn-soft rounded-xl px-3 py-2 text-sm font-semibold" title="Pegar la imagen que copiaste">
            📋 Pegar
          </button>
          <label className="btn-soft cursor-pointer rounded-xl px-4 py-2 font-semibold">
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

      {currentUrl ? (
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
