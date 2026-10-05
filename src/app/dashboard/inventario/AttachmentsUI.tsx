"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Btn, errorMessage, toast } from "./shared";
import { MAX_PDF_BYTES, compressImage, formatBytes } from "./attachments";

export type Staged = { id: string; kind: "invoice" | "manifest"; name: string; blob: Blob; mime: string; preview: string | null; original: number; product_id?: string; product_name?: string };
export type PurchaseFile = { id: string; kind: "invoice" | "manifest"; path: string; file_name: string; mime: string; size_bytes: number; product_id?: string | null; product_name?: string | null };

const BUCKET = "purchase-docs";
const uid = () => Math.random().toString(36).slice(2, 10);

export function AttachmentPicker({ staged, onChange }: { staged: Staged[]; onChange: (next: Staged[]) => void }) {
  const [working, setWorking] = useState(false);
  const [view, setView] = useState<Staged | null>(null);

  async function addImages(files: FileList | null) {
    if (!files?.length) return;
    setWorking(true);
    const added: Staged[] = [];
    for (const file of Array.from(files)) {
      if (file.type === "application/pdf") {
        if (file.size > MAX_PDF_BYTES) {
          void toast("PDF demasiado grande (máx. 10 MB)", "warning", file.name);
          continue;
        }
        added.push({ id: uid(), kind: "invoice", name: file.name, blob: file, mime: file.type, preview: URL.createObjectURL(file), original: file.size });
        continue;
      }
      if (!file.type.startsWith("image/")) {
        void toast("Sube imágenes o PDF", "warning", file.name);
        continue;
      }
      try {
        const { blob, type } = await compressImage(file);
        const ext = type === "image/webp" ? "webp" : "jpg";
        added.push({ id: uid(), kind: "invoice", name: `${file.name.replace(/\.[^.]+$/, "")}.${ext}`, blob, mime: type, preview: URL.createObjectURL(blob), original: file.size });
      } catch (e) {
        void toast("No se pudo procesar la imagen", "error", errorMessage(e));
      }
    }
    setWorking(false);
    onChange([...staged, ...added]);
  }

  function addPdfs(files: FileList | null) {
    if (!files?.length) return;
    const added: Staged[] = [];
    for (const file of Array.from(files)) {
      if (file.type !== "application/pdf") {
        void toast("Los manifiestos deben ser PDF", "warning", file.name);
        continue;
      }
      if (file.size > MAX_PDF_BYTES) {
        void toast("PDF demasiado grande (máx. 10 MB)", "warning", file.name);
        continue;
      }
      added.push({ id: uid(), kind: "manifest", name: file.name, blob: file, mime: file.type, preview: URL.createObjectURL(file), original: file.size });
    }
    onChange([...staged, ...added]);
  }

  function remove(item: Staged) {
    if (item.preview) URL.revokeObjectURL(item.preview);
    onChange(staged.filter((s) => s.id !== item.id));
  }

  const zone = "flex cursor-pointer flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed p-4 text-center text-sm transition hover:opacity-80";
  const zoneStyle = { borderColor: "var(--t-card-border)", color: "var(--t-muted)" };

  return (
    <div className="grid gap-3">
      {(["invoice"] as const).map((kind) => {
        const items = staged.filter((s) => s.kind === kind);
        return (
          <div key={kind} className="space-y-2">
            <label className={zone} style={zoneStyle}>
              <span className="text-2xl">{kind === "invoice" ? "🧾" : "📄"}</span>
              <b style={{ color: "var(--t-text)" }}>{kind === "invoice" ? "Facturas (imágenes o PDF)" : "Manifiestos (PDF)"}</b>
              <span className="text-xs">{kind === "invoice" ? "Varias a la vez. Las imágenes se reducen solas; los PDF van hasta 10 MB." : "Puedes subir varios PDF (máx. 10 MB c/u)."}</span>
              <input
                type="file"
                multiple
                className="hidden"
                accept={kind === "invoice" ? "image/*,application/pdf" : "application/pdf"}
                capture={undefined}
                onChange={(e) => {
                  if (kind === "invoice") void addImages(e.target.files);
                  else addPdfs(e.target.files);
                  e.target.value = "";
                }}
              />
              {working && kind === "invoice" ? <span className="text-xs">Optimizando…</span> : null}
            </label>
            {items.map((item) => (
              <div key={item.id} className="flex items-center gap-2 rounded-xl border p-2 text-xs" style={{ borderColor: "var(--t-card-border)" }}>
                {item.mime.startsWith("image/") && item.preview ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.preview} alt="" className="h-10 w-10 rounded-lg object-cover" />
                ) : <span className="text-2xl">📄</span>}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold" style={{ color: "var(--t-text)" }}>{item.name}</p>
                  <p style={{ color: "var(--t-muted)" }}>
                    {item.mime.startsWith("image/") ? `${formatBytes(item.original)} → ${formatBytes(item.blob.size)}` : formatBytes(item.blob.size)}
                  </p>
                </div>
                <button type="button" className="px-1" title="Ver" onClick={() => setView(item)}>👁️</button>
                <button type="button" className="px-1" title="Quitar" onClick={() => remove(item)}>🗑️</button>
              </div>
            ))}
          </div>
        );
      })}
      {view?.preview ? <Viewer url={view.preview} name={view.name} mime={view.mime} onClose={() => setView(null)} /> : null}
    </div>
  );
}

export async function uploadStaged(storeId: string, purchaseId: string, staged: Staged[]) {
  const sb = supabaseBrowser();
  let failed = 0;
  for (const item of staged) {
    const safe = item.name.replace(/[^\w.\-]+/g, "_");
    const path = `${storeId}/${purchaseId}/${uid()}-${safe}`;
    const up = await sb.storage.from(BUCKET).upload(path, item.blob, { contentType: item.mime });
    if (up.error) { failed++; continue; }
    const ins = await sb.from("erp_purchase_files").insert({
      store_id: storeId, purchase_id: purchaseId, kind: item.kind, path, file_name: item.name, mime: item.mime, size_bytes: item.blob.size, product_id: item.product_id ?? null, product_name: item.product_name ?? null,
    });
    if (ins.error) { failed++; await sb.storage.from(BUCKET).remove([path]); }
  }
  return failed;
}

export function Viewer({ url, name, mime, onClose }: { url: string; name: string; mime: string; onClose: () => void }) {
  const isPdf = mime === "application/pdf";
  function print() {
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(isPdf
      ? `<iframe src="${url}" style="border:0;width:100%;height:100vh"></iframe>`
      : `<img src="${url}" style="max-width:100%" onload="window.print()">`);
    w.document.close();
  }
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-3" onClick={onClose}>
      <div className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl" style={{ background: "var(--t-card, #fff)", color: "var(--t-text)" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex flex-wrap items-center gap-2 border-b p-2" style={{ borderColor: "var(--t-card-border)" }}>
          <b className="min-w-0 flex-1 truncate text-sm">{name}</b>
          <a href={url} target="_blank" rel="noreferrer" className="rounded-lg border px-3 py-1 text-xs" style={{ borderColor: "var(--t-card-border)" }}>↗ Abrir</a>
          <Btn variant="ghost" onClick={print}>🖨️ Imprimir</Btn>
          <Btn variant="ghost" onClick={onClose}>✕</Btn>
        </div>
        <div className="flex-1 overflow-auto">
          {isPdf ? <iframe src={url} title={name} className="h-[80vh] w-full" /> : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt={name} className="mx-auto max-w-full" />
          )}
        </div>
      </div>
    </div>
  );
}

export function PurchaseFilesButton({ purchaseId }: { purchaseId: string }) {
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<PurchaseFile[] | null>(null);
  const [view, setView] = useState<{ url: string; name: string; mime: string } | null>(null);

  useEffect(() => {
    if (!open || files) return;
    void supabaseBrowser().from("erp_purchase_files").select("id,kind,path,file_name,mime,size_bytes,product_id,product_name").eq("purchase_id", purchaseId).order("created_at")
      .then(({ data, error }) => {
        if (error) void toast("No se pudieron cargar los archivos", "error", errorMessage(error));
        setFiles((data ?? []) as PurchaseFile[]);
      });
  }, [open, files, purchaseId]);

  async function show(file: PurchaseFile) {
    const { data, error } = await supabaseBrowser().storage.from(BUCKET).createSignedUrl(file.path, 600);
    if (error || !data) return void toast("No se pudo abrir el archivo", "error", errorMessage(error));
    setView({ url: data.signedUrl, name: file.file_name, mime: file.mime });
  }

  async function del(file: PurchaseFile) {
    const sb = supabaseBrowser();
    await sb.storage.from(BUCKET).remove([file.path]);
    const { error } = await sb.from("erp_purchase_files").delete().eq("id", file.id);
    if (error) return void toast("No se pudo eliminar", "error", errorMessage(error));
    setFiles((cur) => (cur ?? []).filter((f) => f.id !== file.id));
  }

  return (
    <>
      <Btn variant="ghost" onClick={() => setOpen((v) => !v)}>📎 Archivos</Btn>
      {open ? (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-3" onClick={() => setOpen(false)}>
          <div className="w-full max-w-md rounded-2xl border p-4" style={{ background: "var(--t-card, #fff)", color: "var(--t-text)", borderColor: "var(--t-card-border)" }} onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between"><b>Archivos del ingreso</b><button type="button" onClick={() => setOpen(false)}>✕</button></div>
            {files === null ? <p className="text-sm">Cargando…</p> : files.length === 0 ? <p className="text-sm" style={{ color: "var(--t-muted)" }}>Sin archivos adjuntos.</p> : (
              <ul className="space-y-2">
                {files.map((f) => (
                  <li key={f.id} className="flex items-center gap-2 rounded-xl border p-2 text-sm" style={{ borderColor: "var(--t-card-border)" }}>
                    <span>{f.mime === "application/pdf" ? "📄" : "🧾"}</span>
                    <span className="min-w-0 flex-1 truncate">{f.file_name}{f.product_name ? <span className="block text-xs">📦 {f.product_name}</span> : null}<span className="block text-xs" style={{ color: "var(--t-muted)" }}>{formatBytes(f.size_bytes)}</span></span>
                    <button type="button" title="Ver / imprimir" onClick={() => void show(f)}>👁️</button>
                    <button type="button" title="Eliminar" onClick={() => void del(f)}>🗑️</button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}
      {view ? <Viewer {...view} onClose={() => setView(null)} /> : null}
    </>
  );
}
