"use client";

import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

type Props = {
  label: string;
  currentUrl: string | null;
  pathPrefix: string; // ej: `${userId}/products/`
  fileName: string; // ej: `${productId}.png`
  onUploaded: (publicUrl: string) => void;
  bucket?: string; // si no lo pasas, usa "store-assets"
};

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

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setMsg(null);

    try {
      // Validaciones
      if (!file.type.startsWith("image/")) {
        setMsg("❌ Debe ser una imagen.");
        return;
      }
      if (file.size > 2 * 1024 * 1024) {
        setMsg("❌ Máximo 2MB.");
        return;
      }

      const sb = supabaseBrowser(); // ✅ importante
      const filePath = `${pathPrefix}${fileName}`;
      const bucketName = bucket ?? "store-assets";

      const { error: upErr } = await sb.storage
        .from(bucketName)
        .upload(filePath, file, { upsert: true, cacheControl: "3600" });

      if (upErr) throw upErr;

      const { data } = sb.storage.from(bucketName).getPublicUrl(filePath);
      const url = `${data.publicUrl}?t=${Date.now()}`;

      onUploaded(url);
      setMsg("✅ Subido correctamente.");
    } catch (err: any) {
      setMsg("❌ " + (err?.message ?? "Error subiendo imagen"));
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  return (
    <div className="rounded-2xl border border-white/10 p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-semibold">{label}</h3>
          <p className="text-sm opacity-80">PNG/JPG, máximo 2MB.</p>
        </div>

        <label className="cursor-pointer rounded-xl bg-white text-black px-4 py-2 font-semibold">
          {uploading ? "Subiendo..." : "Subir"}
          <input
            className="hidden"
            type="file"
            accept="image/*"
            onChange={handleFile}
          />
        </label>
      </div>

      {currentUrl ? (
        <div className="mt-4">
          <img
            src={currentUrl}
            alt={label}
            className="max-h-40 rounded-xl border border-white/10 object-contain"
          />
        </div>
      ) : (
        <p className="mt-4 text-sm opacity-70">Aún no has subido imagen.</p>
      )}

      {msg && <p className="mt-3 text-sm">{msg}</p>}
    </div>
  );
}
