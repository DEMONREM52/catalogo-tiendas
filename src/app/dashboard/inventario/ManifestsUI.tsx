"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { ProductPicker } from "./LineEditor";
import { Viewer, type PurchaseFile } from "./AttachmentsUI";
import { MAX_PDF_BYTES, formatBytes } from "./attachments";
import { Thumb, useThumbs } from "./LineEditor";
import { Btn, Empty, Panel, errorMessage, inputClass, inputStyle, toast, type ErpCtx, type ProductHit } from "./shared";

const BUCKET = "purchase-docs";

type Row = PurchaseFile & { created_at: string };

export function ManifestsTab({ ctx }: { ctx: ErpCtx }) {
  const [version, setVersion] = useState(0);
  return (
    <div className="space-y-5">
      {ctx.can("inventory") || ctx.can("purchases") ? <ManifestUpload storeId={ctx.storeId} onDone={() => setVersion((v) => v + 1)} /> : null}
      <ManifestLibrary storeId={ctx.storeId} version={version} />
    </div>
  );
}

function ManifestUpload({ storeId, onDone }: { storeId: string; onDone: () => void }) {
  const [product, setProduct] = useState<ProductHit | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const thumbs = useThumbs(product ? [product.id] : []);

  function addFiles(list: FileList | null) {
    if (!list) return;
    const ok: File[] = [];
    for (const f of Array.from(list)) {
      if (f.type !== "application/pdf") { void toast("El manifiesto debe ser PDF", "warning", f.name); continue; }
      if (f.size > MAX_PDF_BYTES) { void toast("PDF demasiado grande (máx. 10 MB)", "warning", f.name); continue; }
      ok.push(f);
    }
    setFiles((cur) => [...cur, ...ok]);
  }

  async function save() {
    if (!product) return void toast("Primero elige el producto", "warning");
    if (!files.length) return void toast("Agrega al menos un PDF", "warning");
    setBusy(true);
    const sb = supabaseBrowser();
    let failed = 0;
    for (const f of files) {
      const safe = f.name.replace(/[^\w.\-]+/g, "_");
      const path = `${storeId}/manifests/${product.id}/${Math.random().toString(36).slice(2, 10)}-${safe}`;
      const up = await sb.storage.from(BUCKET).upload(path, f, { contentType: "application/pdf" });
      if (up.error) { failed++; continue; }
      const ins = await sb.from("erp_purchase_files").insert({
        store_id: storeId, purchase_id: null, kind: "manifest", path, file_name: f.name, mime: "application/pdf",
        size_bytes: f.size, product_id: product.id, product_name: product.name,
      });
      if (ins.error) { failed++; await sb.storage.from(BUCKET).remove([path]); }
    }
    setBusy(false);
    if (failed) void toast("Algunos manifiestos no se subieron", "warning", "Revisa que ejecutaste erp_purchase_files.sql");
    else void toast("Manifiestos guardados ✅");
    setFiles([]);
    onDone();
  }

  return (
    <Panel title="➕ Nuevo manifiesto" subtitle="Elige el producto y sube sus PDF. Quedan enlazados para encontrarlos después.">
      {product ? (
        <div className="mb-3 flex items-center gap-3 rounded-2xl border p-2" style={{ borderColor: "var(--t-card-border)" }}>
          <Thumb src={thumbs[product.id]} size={56} />
          <div className="min-w-0 flex-1"><b className="block truncate">{product.name}</b>{product.sku ? <span className="text-xs" style={{ color: "var(--t-muted)" }}>{product.sku}</span> : null}</div>
          <Btn variant="ghost" onClick={() => setProduct(null)}>Cambiar</Btn>
        </div>
      ) : (
        <div className="mb-3"><ProductPicker storeId={storeId} placeholder="1️⃣ Busca el producto del manifiesto…" onPick={setProduct} /></div>
      )}
      <label
        className="flex cursor-pointer flex-col items-center gap-1 rounded-2xl border-2 border-dashed p-5 text-center text-sm transition"
        style={{ borderColor: drag ? "var(--t-accent)" : "var(--t-card-border)", color: "var(--t-muted)" }}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); addFiles(e.dataTransfer.files); }}
      >
        <span className="text-3xl">📄</span>
        <b style={{ color: "var(--t-text)" }}>2️⃣ Arrastra o toca para elegir los PDF</b>
        <span className="text-xs">Varios a la vez · máx. 10 MB c/u</span>
        <input type="file" multiple accept="application/pdf" className="hidden" onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
      </label>
      {files.length ? (
        <ul className="mt-2 space-y-1">
          {files.map((f, i) => (
            <li key={i} className="flex items-center gap-2 rounded-xl border px-2 py-1 text-sm" style={{ borderColor: "var(--t-card-border)" }}>
              <span>📄</span><span className="min-w-0 flex-1 truncate">{f.name}</span><span className="text-xs">{formatBytes(f.size)}</span>
              <button type="button" onClick={() => setFiles((cur) => cur.filter((_, j) => j !== i))}>✕</button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="mt-3 flex justify-end"><Btn onClick={() => void save()} disabled={busy}>{busy ? "Subiendo…" : "💾 Guardar manifiestos"}</Btn></div>
    </Panel>
  );
}

function ManifestLibrary({ storeId, version }: { storeId: string; version: number }) {
  const [picked, setPicked] = useState<ProductHit | null>(null);
  const [text, setText] = useState("");
  const [exact, setExact] = useState<Row[]>([]);
  const [similar, setSimilar] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<{ url: string; name: string; mime: string } | null>(null);

  useEffect(() => {
    const term = (picked?.name ?? text).trim();
    if (!term) return;
    let alive = true;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      const sb = supabaseBrowser();
      const cols = "id,kind,path,file_name,mime,size_bytes,product_id,product_name,created_at";
      const words = term.split(/\s+/).filter((w) => w.length >= 3).map((w) => w.replace(/[%,()]/g, ""));
      const orSimilar = (words.length ? words : [term]).flatMap((w) => [`product_name.ilike.%${w}%`, `file_name.ilike.%${w}%`]).join(",");
      const [a, b] = await Promise.all([
        picked
          ? sb.from("erp_purchase_files").select(cols).eq("store_id", storeId).eq("kind", "manifest").eq("product_id", picked.id).order("created_at", { ascending: false }).limit(30)
          : Promise.resolve({ data: [] as Row[], error: null }),
        sb.from("erp_purchase_files").select(cols).eq("store_id", storeId).eq("kind", "manifest").or(orSimilar).order("created_at", { ascending: false }).limit(40),
      ]);
      if (!alive) return;
      setLoading(false);
      if (a.error || b.error) return void toast("No se pudo buscar", "error", errorMessage(a.error ?? b.error));
      const ex = (a.data ?? []) as Row[];
      const ids = new Set(ex.map((r) => r.id));
      if (picked) { setExact(ex); setSimilar(((b.data ?? []) as Row[]).filter((r) => !ids.has(r.id))); }
      else { setExact(((b.data ?? []) as Row[])); setSimilar([]); }
    }, 250);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [picked, text, storeId, version]);

  const active = Boolean(picked || text.trim());

  async function open(f: Row) {
    const { data, error } = await supabaseBrowser().storage.from(BUCKET).createSignedUrl(f.path, 600);
    if (error || !data) return void toast("No se pudo abrir", "error", errorMessage(error));
    setView({ url: data.signedUrl, name: f.file_name, mime: f.mime });
  }

  const card = (f: Row, soft?: boolean) => (
    <button key={f.id} type="button" onClick={() => void open(f)}
      className="flex items-center gap-3 rounded-xl border p-2 text-left text-sm transition hover:-translate-y-0.5 hover:shadow-lg"
      style={{ borderColor: "var(--t-card-border)", opacity: soft ? 0.85 : 1 }}>
      <span className="text-2xl">📄</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold">{f.file_name}</span>
        <span className="block truncate text-xs" style={{ color: "var(--t-muted)" }}>
          {f.product_name ? `📦 ${f.product_name} · ` : ""}{formatBytes(f.size_bytes)} · {new Date(f.created_at).toLocaleDateString("es-CO")}
        </span>
      </span>
      <span>👁️</span>
    </button>
  );

  return (
    <Panel title="📚 Biblioteca de manifiestos" subtitle="Busca por producto y mira sus manifiestos; también te mostramos los de productos parecidos.">
      <div className="grid gap-2 md:grid-cols-2">
        <ProductPicker storeId={storeId} placeholder="🔎 Elegir producto…" onPick={(h) => { setPicked(h); setText(""); }} />
        <input className={inputClass} style={inputStyle} placeholder="…o escribe una palabra (modelo, marca)" value={text} onChange={(e) => { setText(e.target.value); setPicked(null); }} />
      </div>
      {picked ? (
        <p className="mt-2 text-sm">Producto: <b>{picked.name}</b> <button type="button" className="ml-2 text-xs underline" onClick={() => setPicked(null)}>limpiar</button></p>
      ) : null}
      <div className="mt-3 space-y-3">
        {!active ? <Empty text="Elige un producto para ver sus manifiestos." /> : loading && !exact.length && !similar.length ? <p className="text-sm" style={{ color: "var(--t-muted)" }}>Buscando…</p> : (
          <>
            {exact.length === 0 ? <Empty text={picked ? "Este producto aún no tiene manifiestos." : "Sin resultados."} /> : (
              <div className="grid gap-2 md:grid-cols-2">{exact.map((f) => card(f))}</div>
            )}
            {similar.length ? (
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--t-muted)" }}>✨ Manifiestos de productos parecidos</p>
                <div className="grid gap-2 md:grid-cols-2">{similar.map((f) => card(f, true))}</div>
              </div>
            ) : null}
          </>
        )}
      </div>
      {view ? <Viewer {...view} onClose={() => setView(null)} /> : null}
    </Panel>
  );
}
