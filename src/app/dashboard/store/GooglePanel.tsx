"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import Swal from "sweetalert2";
import { Check, ExternalLink, Search, X } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { PRODUCTION_ORIGIN } from "@/lib/share/origin";
import { useRunOnChange } from "../inventario/shared";

/**
 * Aparecer en Google (20261232): código de verificación de Search Console y Bing,
 * qué tan lista está la tienda y qué productos conviene mejorar.
 */
type Health = {
  ok: boolean;
  store: { name: string; logo: boolean; banner: boolean; whatsapp: boolean; headline: boolean; city: boolean; address: boolean };
  verification: boolean;
  points: Array<{ slug: string; name: string; point: string; has_address: boolean; has_city: boolean; has_whatsapp: boolean }>;
  counts: { published: number; good: number; no_photo: number; code_name: number; short_name: number; no_description: number };
  products: Array<{ id: string; name: string; image: string | null; issues: string[] }>;
};

const swal = { background: "var(--t-bg-base)", color: "var(--t-text)", confirmButtonColor: "#8b5cf6" };
const box = { borderColor: "var(--t-card-border)", background: "color-mix(in oklab, var(--t-card-bg) 92%, transparent)", color: "var(--t-text)" } as const;
// El código solo, aunque peguen la etiqueta completa que da Google.
const codeOf = (v: string) => (v.match(/content\s*=\s*["']([^"']+)["']/i)?.[1] ?? v).trim();

function Item({ done, children }: { done: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <span className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full text-white" style={{ background: done ? "#22c55e" : "#f59e0b" }}>{done ? <Check size={11} /> : <X size={11} />}</span>
      <span style={{ color: done ? "var(--t-muted)" : "var(--t-text)" }}>{children}</span>
    </li>
  );
}

export function GooglePanel({ storeId, storeSlug, canEdit }: { storeId: string; storeSlug: string; canEdit: boolean }) {
  const [health, setHealth] = useState<Health | null>(null);
  const [missing, setMissing] = useState(false);
  const [google, setGoogle] = useState("");
  const [bing, setBing] = useState("");
  const [saving, setSaving] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(async () => {
    const sb = supabaseBrowser();
    const [h, s] = await Promise.all([sb.rpc("store_seo_health", { p_store: storeId }), sb.rpc("store_seo_get", { p_store: storeId })]);
    if (h.error) { setMissing(/store_seo_health|Could not find the function|schema cache/i.test(h.error.message)); return; }
    setHealth(h.data as Health);
    const v = s.data as { ok: boolean; google: string | null; bing: string | null } | null;
    if (v?.ok) { setGoogle(v.google ?? ""); setBing(v.bing ?? ""); }
  }, [storeId]);
  useRunOnChange(load);

  async function save() {
    setSaving(true);
    const { error } = await supabaseBrowser().rpc("store_seo_save", { p_store: storeId, p_google: codeOf(google), p_bing: codeOf(bing) });
    setSaving(false);
    if (error) return void Swal.fire({ ...swal, icon: "error", title: "No se pudo guardar", text: error.message });
    void Swal.fire({ ...swal, icon: "success", title: "Guardado", text: "En unos 10 minutos ya está en tus páginas. Luego vuelve a Search Console y toca «Verificar».", timer: 3500, showConfirmButton: false });
    await load();
  }

  if (missing) return <p className="rounded-2xl border p-3 text-xs" style={{ borderColor: "var(--t-card-border)", color: "var(--t-muted)" }}>🔎 Para «Aparecer en Google» ejecuta en Supabase la migración 20261232_google.sql.</p>;
  if (!health?.ok) return null;

  const s = health.store;
  const c = health.counts;
  const score = c.published ? Math.round((c.good / c.published) * 100) : 0;
  const products = showAll ? health.products : health.products.slice(0, 8);

  return (
    <section className="space-y-4 rounded-3xl border p-4 sm:p-5" style={{ borderColor: "var(--t-card-border)" }}>
      <div>
        <h3 className="flex items-center gap-2 text-base font-black"><Search size={18} /> Aparecer en Google</h3>
        <p className="mt-0.5 text-xs" style={{ color: "var(--t-muted)" }}>Lo que hace que te encuentren al buscar tu nombre, tu punto o lo que vendes.</p>
      </div>

      {/* Lista de revisión */}
      <div className="rounded-2xl border p-3" style={box}>
        <p className="text-sm font-bold">Tu negocio</p>
        <ul className="mt-2 space-y-1.5 text-xs">
          <Item done={health.verification}>Verificado en Google Search Console (abajo te explico cómo).</Item>
          <Item done={s.logo}>Logo de la tienda.</Item>
          <Item done={s.headline}>Frase del negocio (qué vendes, ej. «Muebles y hogar al mejor precio»).</Item>
          <Item done={s.city}>Ciudad: Google la usa para «zapatero en tu ciudad».</Item>
          <Item done={s.address}>Dirección.</Item>
          <Item done={s.whatsapp}>WhatsApp.</Item>
        </ul>
        {!s.logo || !s.headline || !s.city || !s.address ? <p className="mt-2 text-[11px]" style={{ color: "var(--t-muted)" }}>Se llenan arriba, en los datos de la tienda.</p> : null}
      </div>

      {health.points.length ? (
        <div className="rounded-2xl border p-3" style={box}>
          <p className="text-sm font-bold">📍 Página de cada punto</p>
          <p className="text-xs" style={{ color: "var(--t-muted)" }}>Es la que sale al buscar «{s.name.toLowerCase()} + punto». Ponla como «Sitio web» en el perfil de Google de ese punto.</p>
          <ul className="mt-2 space-y-2 text-xs">
            {health.points.map((p) => {
              const url = `${PRODUCTION_ORIGIN}/${storeSlug}/${p.slug}`;
              const missingBits = [!p.has_address && "dirección", !p.has_city && "ciudad", !p.has_whatsapp && "WhatsApp"].filter(Boolean);
              return (
                <li key={p.slug} className="rounded-xl border p-2" style={{ borderColor: "var(--t-card-border)" }}>
                  <div className="flex flex-wrap items-center gap-2">
                    <b>{p.name}</b>
                    <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 break-all underline">{url.replace(/^https:\/\//, "")} <ExternalLink size={11} /></a>
                    <button type="button" onClick={() => void navigator.clipboard.writeText(url)} className="rounded-lg border px-2 py-0.5" style={{ borderColor: "var(--t-card-border)" }}>Copiar</button>
                  </div>
                  {missingBits.length ? (
                    <p className="mt-1" style={{ color: "#f59e0b" }}>Le falta: {missingBits.join(", ")}. <Link href="/dashboard/social" className="underline">Complétalo en Mis catálogos → Contacto</Link>.</p>
                  ) : <p className="mt-1" style={{ color: "#22c55e" }}>✓ Completo</p>}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {/* Productos */}
      <div className="rounded-2xl border p-3" style={box}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-bold">🛍️ Tus productos para Google</p>
          <span className="rounded-full px-2 py-0.5 text-xs font-black" style={{ background: `color-mix(in oklab, ${score >= 70 ? "#22c55e" : score >= 40 ? "#f59e0b" : "#ef4444"} 18%, transparent)` }}>{score}% bien</span>
        </div>
        <p className="mt-1 text-xs" style={{ color: "var(--t-muted)" }}>
          {c.published} publicados · {c.good} bien · {c.no_photo} sin foto · {c.code_name} con nombre tipo código · {c.short_name} con nombre muy corto · {c.no_description} sin descripción
        </p>
        <p className="mt-1 text-[11px]" style={{ color: "var(--t-muted)" }}>Google entiende «Zapatero de madera 4 niveles» pero no «ZAP-04». Usa el nombre como lo buscaría un cliente, una foto propia y dos líneas de descripción.</p>
        {products.length ? (
          <ul className="mt-2 divide-y text-xs" style={{ borderColor: "var(--t-card-border)" }}>
            {products.map((p) => (
              <li key={p.id} className="flex items-center gap-2 py-1.5">
                {p.image && /^https:\/\//i.test(p.image) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.image} alt="" className="h-8 w-8 shrink-0 rounded-lg object-cover" loading="lazy" />
                ) : <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg" style={{ background: "var(--t-card-border)" }}>📷</span>}
                <span className="min-w-0 flex-1"><b className="block truncate">{p.name}</b><span style={{ color: "#f59e0b" }}>{p.issues.join(" · ")}</span></span>
                {canEdit ? <Link href={`/dashboard/products/${p.id}`} className="shrink-0 rounded-lg border px-2 py-1 font-semibold" style={{ borderColor: "var(--t-card-border)" }}>Mejorar</Link> : null}
              </li>
            ))}
          </ul>
        ) : <p className="mt-2 text-xs" style={{ color: "#22c55e" }}>✓ Todos tus productos están bien para Google.</p>}
        {health.products.length > 8 ? (
          <button type="button" onClick={() => setShowAll((v) => !v)} className="mt-1 text-xs underline" style={{ color: "var(--t-muted)" }}>{showAll ? "Ver menos" : `Ver ${health.products.length - 8} más`}</button>
        ) : null}
      </div>

      {/* Verificación */}
      <div className="rounded-2xl border p-3" style={box}>
        <p className="text-sm font-bold">Verificar en Google Search Console</p>
        <ol className="mt-1 list-decimal space-y-1 pl-5 text-xs" style={{ color: "var(--t-muted)" }}>
          <li>Entra a <a className="underline" href="https://search.google.com/search-console" target="_blank" rel="noreferrer">Google Search Console</a> con tu Gmail y toca «Agregar propiedad» → <b>Prefijo de la URL</b> → pega la dirección de tu catálogo.</li>
          <li>Escoge el método <b>Etiqueta HTML</b> y copia la etiqueta (o solo el código).</li>
          <li>Pégala aquí y guarda. Espera unos 10 minutos y en Search Console toca <b>Verificar</b>.</li>
          <li>Ya verificado: menú <b>Sitemaps</b> → escribe <b>sitemap.xml</b> → Enviar.</li>
        </ol>
        {canEdit ? (
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <label className="text-xs font-bold">Código de Google
              <input value={google} onChange={(e) => setGoogle(e.target.value)} placeholder='<meta name="google-site-verification" content="…">' className="mt-1 block w-full rounded-xl border px-3 py-2 font-mono text-xs font-normal outline-none" style={box} />
            </label>
            <label className="text-xs font-bold">Código de Bing (opcional)
              <input value={bing} onChange={(e) => setBing(e.target.value)} placeholder='<meta name="msvalidate.01" content="…">' className="mt-1 block w-full rounded-xl border px-3 py-2 font-mono text-xs font-normal outline-none" style={box} />
            </label>
            <button type="button" disabled={saving} onClick={() => void save()} className="rounded-xl px-4 py-2 text-sm font-bold text-white disabled:opacity-50 sm:col-span-2 sm:justify-self-start" style={{ background: "linear-gradient(135deg, var(--t-accent), var(--t-accent2, var(--t-accent)))" }}>
              {saving ? "Guardando…" : "Guardar códigos"}
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
