"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { History, LayoutTemplate, Printer, Settings2 } from "lucide-react";
import Swal from "@/lib/swal";
import { supabaseBrowser } from "@/lib/supabase/client";
import { getDashboardStore, type DashboardStore } from "@/lib/store-utils";
import { useCan } from "@/lib/permission-runtime";
import { productLabelData, SAMPLE_DATA, type LabelData } from "@/lib/labels/data";
import { STARPOS_IF4, normalizeProfile } from "@/lib/labels/layout";
import { builtinTemplates } from "@/lib/labels/templates";
import type { LabelDesign, LabelTemplate, PrinterProfile } from "@/lib/labels/types";
import { storeShareUrl } from "@/lib/share/store-host";
import { ErrorBox, Notice, Skeleton, Tabs } from "../fiscal/ui";
import { useErpFinderSource } from "../useErpFinder";
import { readPrefs, useLabelLibrary, writePrefs, type JobRow } from "./library";
import { PrintPanel, type PrintSeed } from "./PrintPanel";
import { ProfilesPanel } from "./ProfilesPanel";
import { TemplatesPanel } from "./TemplatesPanel";
import { loadLabelProducts, loadSourceLines } from "./products";

const Designer = dynamic(() => import("./Designer"), { ssr: false, loading: () => <div className="fixed inset-0 z-110 grid place-items-center" style={{ background: "var(--t-bg-base)" }}>Abriendo el diseñador…</div> });
const SUBDOMAINS = process.env.NEXT_PUBLIC_STORE_SUBDOMAINS === "1";
const swal = { background: "var(--t-bg-base)", color: "var(--t-text)", confirmButtonColor: "#8b5cf6" };
type Tab = "imprimir" | "plantillas" | "impresoras" | "historial";

/**
 * RemHub Label Studio: imprimir etiquetas (QR, código de barras, nombre, referencia, precio…) en cualquier papel,
 * diseñar plantillas, configurar impresoras y ver el historial.
 *   ?productos=id:cantidad,id2:cantidad · ?ingreso=<id> · ?traslado=<id> · ?tab=plantillas|impresoras|historial
 *   &imprimir=1 → imprime solo apenas carga (p. ej. todas las etiquetas de un ingreso de factura).
 */
export default function LabelStudioPage() {
  const [store, setStore] = useState<DashboardStore | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const canEdit = useCan("products");
  const canInventory = useCan("inventory");
  const lib = useLabelLibrary(store?.id ?? null);
  const [tab, setTab] = useState<Tab>("imprimir");
  const [prefs, setPrefs] = useState<ReturnType<typeof readPrefs>>({});
  const [points, setPoints] = useState<Array<{ id: string; name: string }>>([]);
  const [seed, setSeed] = useState<PrintSeed>(null);
  const [session, setSession] = useState<LabelTemplate | null>(null);
  const [designing, setDesigning] = useState<LabelTemplate | null>(null);
  const [sample, setSample] = useState<{ data: LabelData; images: { logo?: string | null; foto?: string | null }; label: string }>({ data: SAMPLE_DATA, images: {}, label: "datos de ejemplo" });
  const [jobs, setJobs] = useState<JobRow[] | null>(null);

  useEffect(() => {
    void getDashboardStore().then((a) => (a.store ? setStore(a.store) : setFatal("No tienes acceso a ninguna tienda.")), (e: unknown) => setFatal(e instanceof Error ? e.message : String(e)));
  }, []);

  // Preferencias de este equipo, puntos y lo que llega por el enlace.
  useEffect(() => {
    if (!store) return;
    const t = window.setTimeout(() => {
      setPrefs(readPrefs(store.id));
      setSample((s) => ({ ...s, images: { logo: store.logo_url }, data: { ...SAMPLE_DATA, tienda: store.name } }));
    }, 0);
    void supabaseBrowser().from("erp_warehouses").select("id,name").eq("store_id", store.id).eq("active", true).order("name")
      .then(({ data }) => setPoints((data ?? []) as Array<{ id: string; name: string }>));
    const params = new URLSearchParams(window.location.search);
    const tb = params.get("tab");
    if (tb === "plantillas" || tb === "impresoras" || tb === "historial") window.setTimeout(() => setTab(tb), 0);
    const productos = params.get("productos");
    const ingreso = params.get("ingreso");
    const traslado = params.get("traslado");
    // ?imprimir=1: se imprime solo apenas esté todo cargado (todas las etiquetas de un ingreso, de una vez).
    const auto = params.get("imprimir") === "1";
    if (productos) {
      const lines = productos.split(",").map((x) => x.split(":")).filter(([id]) => /^[0-9a-f-]{36}$/i.test(id ?? ""))
        .map(([id, q]) => ({ product_id: id, qty: Math.max(1, Math.min(5000, Math.round(Number(q) || 1))) }));
      if (lines.length) window.setTimeout(() => setSeed({ lines, point: null, label: lines.length === 1 ? "Desde el producto" : `${lines.length} productos elegidos`, key: Date.now(), auto }), 0);
    } else if (ingreso || traslado) {
      void loadSourceLines(ingreso ? "ingreso" : "traslado", (ingreso ?? traslado)!).then(
        (r) => setSeed({ ...r, key: Date.now(), auto }),
        (e: Error) => void Swal.fire({ ...swal, icon: "error", title: e.message }),
      );
    }
    return () => window.clearTimeout(t);
  }, [store]);

  const savePrefs = useCallback((patch: ReturnType<typeof readPrefs>) => {
    if (!store) return;
    writePrefs(store.id, patch);
    setPrefs((p) => ({ ...p, ...patch }));
  }, [store]);

  // Impresora: la elegida en este equipo, la predeterminada de la tienda o la STARPOS iF4 de ejemplo.
  const localProfile = useMemo<PrinterProfile & { id: string; is_default: boolean }>(() => ({ ...normalizeProfile(prefs.localProfile ?? STARPOS_IF4), id: "local", is_default: false, name: `${(prefs.localProfile ?? STARPOS_IF4).name}${lib.missing ? "" : " (solo este equipo)"}` }), [prefs.localProfile, lib.missing]);
  const profileList = lib.profiles.length ? lib.profiles : [localProfile];
  const profile = profileList.find((p) => p.id === prefs.profileId) ?? profileList.find((p) => p.is_default) ?? profileList[0];

  const builtins = useMemo(() => builtinTemplates(profile.labelW, profile.labelH), [profile.labelW, profile.labelH]);
  const saved = lib.templates.filter((t) => !t.archived_at);
  const allTemplates = useMemo(() => [...(session ? [session] : []), ...saved, ...builtins], [session, saved, builtins]);
  const template = allTemplates.find((t) => t.id === prefs.templateId) ?? saved.find((t) => t.is_default) ?? builtins[0];

  // Producto de muestra para el diseñador.
  const finder = useErpFinderSource(store?.id, { priceLevel: 3 });
  async function pickSample() {
    if (!store) return;
    const r = await Swal.fire({ ...swal, title: "Ver el diseño con un producto", input: "text", inputPlaceholder: "Nombre, referencia o código", showCancelButton: true, confirmButtonText: "Buscar", cancelButtonText: "Cancelar" });
    if (!r.isConfirmed || !String(r.value ?? "").trim()) return;
    const hits = await finder.searchText(String(r.value).trim()).catch(() => []);
    if (!hits.length) return void Swal.fire({ ...swal, icon: "info", title: "No encontré productos con eso" });
    let id = hits[0].id;
    if (hits.length > 1) {
      const c = await Swal.fire({ ...swal, title: "¿Cuál?", input: "select", inputOptions: Object.fromEntries(hits.slice(0, 15).map((h) => [h.id, `${h.name}${h.code ? ` · ${h.code}` : ""}`])), showCancelButton: true });
      if (!c.isConfirmed) return;
      id = String(c.value);
    }
    const p = (await loadLabelProducts([id])).get(id);
    if (!p) return;
    setSample({
      data: productLabelData(p, { store: store.name, whatsapp: store.whatsapp, productUrl: p.active ? storeShareUrl(store.slug, `/producto/${p.id}`, SUBDOMAINS) : "", level: prefs.level ?? 3, seq: 1 }),
      images: { logo: store.logo_url, foto: p.image_url }, label: p.name,
    });
  }

  useEffect(() => {
    if (tab !== "historial" || !store || lib.missing) return;
    let alive = true;
    void lib.jobs().then((j) => { if (alive) setJobs(j); }, () => { if (alive) setJobs([]); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, store, lib.missing]);

  if (fatal) return <ErrorBox message={fatal} />;
  if (!store || lib.loading) return <Skeleton rows={6} />;

  const fail = (e: unknown) => void Swal.fire({ ...swal, icon: "error", title: "No se pudo", text: e instanceof Error ? e.message : String(e) });

  return (
    <main className="space-y-4">
      <section className="rounded-[28px] border p-4 sm:p-6" style={{ borderColor: "var(--t-card-border)", background: "color-mix(in oklab, var(--t-card-bg) 94%, transparent)" }}>
        <p className="text-[11px] font-black uppercase tracking-[0.2em]" style={{ color: "var(--t-accent)" }}>{store.name} · Label Studio</p>
        <h1 className="mt-1 text-2xl font-black sm:text-3xl">🏷️ Etiquetas</h1>
        <p className="mt-1 max-w-3xl text-sm" style={{ color: "var(--t-muted)" }}>
          QR y códigos de barras reales con el nombre, la referencia y el precio, en el papel de tu impresora (por ejemplo 3 etiquetas de 31×25 mm por fila). Diseña tus plantillas y reúsalas con cualquier producto.
        </p>
      </section>
      {lib.missing ? <Notice tone="warn">Para guardar plantillas, impresoras e historial falta correr en Supabase la migración <b>20261347_etiquetas.sql</b>. Mientras tanto puedes imprimir con las plantillas de RemHub y la impresora se guarda en este equipo.</Notice> : null}
      {lib.error ? <ErrorBox message={lib.error} onRetry={() => void lib.reload()} /> : null}

      <Tabs<Tab> value={tab} onChange={setTab} layoutId="label-tabs" items={[
        { value: "imprimir", label: "Imprimir", icon: <Printer size={15} /> },
        { value: "plantillas", label: "Plantillas", icon: <LayoutTemplate size={15} />, badge: saved.length || null },
        { value: "impresoras", label: "Impresoras", icon: <Settings2 size={15} /> },
        { value: "historial", label: "Historial", icon: <History size={15} />, hidden: lib.missing },
      ]} />

      {tab === "imprimir" ? (
        <PrintPanel
          store={store} templates={allTemplates} template={template} onTemplate={(id) => savePrefs({ templateId: id })}
          profiles={profileList.map((p) => ({ id: p.id, name: p.name }))} profile={profile} onProfile={(id) => savePrefs({ profileId: id })}
          points={points} seed={seed} level={prefs.level ?? 3} onLevel={(l) => savePrefs({ level: l })} point={prefs.point ?? ""} onPoint={(p) => savePrefs({ point: p })}
          onEditTemplate={(t) => setDesigning(t)} userName={null}
          onLog={(j) => lib.logJob(j)}
        />
      ) : null}

      {tab === "plantillas" ? (
        <TemplatesPanel
          templates={lib.templates} builtins={builtins} canEdit={canEdit && !lib.missing}
          onOpen={(t) => setDesigning(t)}
          onUseForPrint={(t) => { savePrefs({ templateId: t.id }); setTab("imprimir"); }}
          onPatch={(id, p) => lib.patchTemplate(id, p)} onDelete={(id) => lib.deleteTemplate(id)} onSetDefault={(id) => lib.setDefault("template", id)}
          onImport={async (t) => { await lib.saveTemplate({ id: null, ...t }); }}
          loadVersions={(id) => lib.versions(id)}
        />
      ) : null}

      {tab === "impresoras" ? (
        <ProfilesPanel
          key={profile.id} profiles={lib.profiles} current={profile} canEdit={(canEdit || canInventory) && !lib.missing} missing={lib.missing}
          onUse={(id) => savePrefs({ profileId: id })}
          onSave={async (p) => {
            if (lib.missing || p.id === "local") {
              if (!lib.missing && (canEdit || canInventory)) {
                try { return await lib.saveProfile({ ...p, id: undefined }); } catch (e) { fail(e); return null; }
              }
              savePrefs({ localProfile: { ...p, id: undefined }, profileId: "local" });
              return "local";
            }
            try { return await lib.saveProfile(p); } catch (e) { fail(e); return null; }
          }}
          onDelete={(id) => lib.deleteProfile(id)} onSetDefault={(id) => lib.setDefault("profile", id)}
        />
      ) : null}

      {tab === "historial" ? (
        <section className="space-y-2">
          <p className="text-xs" style={{ color: "var(--t-muted)" }}>Lo que se mandó a imprimir desde RemHub (los últimos 50). RemHub no recibe confirmación de la impresora: que salió bien en papel lo confirma quien imprime.</p>
          {!jobs ? <Skeleton rows={3} /> : !jobs.length ? <p className="rounded-xl border border-dashed p-4 text-center text-sm" style={{ borderColor: "var(--t-card-border)", color: "var(--t-muted)" }}>Todavía no hay impresiones.</p> : (
            <ul className="space-y-1.5">
              {jobs.map((j) => (
                <li key={j.id} className="flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 text-sm" style={{ borderColor: "var(--t-card-border)" }}>
                  <span className="font-bold tabular-nums">{new Date(j.created_at).toLocaleString("es-CO", { dateStyle: "short", timeStyle: "short" })}</span>
                  <span className="min-w-0 flex-1 truncate">{j.total_labels} etiqueta{j.total_labels === 1 ? "" : "s"} · {j.items.length} producto{j.items.length === 1 ? "" : "s"} · {j.template_name} · {j.profile_name}{j.user_name ? ` · ${j.user_name}` : ""}</span>
                  <button type="button" className="rounded-lg border px-2.5 py-1 text-xs font-bold" style={{ borderColor: "var(--t-accent)", color: "var(--t-accent)" }}
                    onClick={() => { setSeed({ lines: j.items.map((i) => ({ product_id: i.product_id, qty: i.qty })), point: null, label: `Repetir ${new Date(j.created_at).toLocaleDateString("es-CO")}`, key: Date.now() }); setTab("imprimir"); }}>
                    Repetir
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {designing ? (
        <Designer
          key={designing.id + (designing.updated_at ?? "")}
          storeId={store.id} template={designing} profile={profile} canSave={canEdit && !lib.missing}
          sample={sample} onPickSample={() => void pickSample()}
          onClose={() => setDesigning(null)}
          onUse={(design: LabelDesign, name: string) => {
            setSession({ id: "session", name: `${name} (sin guardar)`, category: null, design });
            savePrefs({ templateId: "session" });
            setDesigning(null);
            setTab("imprimir");
          }}
          onSave={async (t) => {
            try {
              const id = await lib.saveTemplate(t);
              savePrefs({ templateId: id });
              return id;
            } catch (e) { fail(e); return null; }
          }}
        />
      ) : null}
    </main>
  );
}
