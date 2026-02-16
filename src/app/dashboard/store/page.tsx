"use client";

import React, { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { ImageUpload } from "./ImageUpload";

/* =========================
   Types
========================= */
type Store = {
  id: string;
  name: string;
  slug: string;
  whatsapp: string;
  phone: string | null;
  email: string | null;
  active: boolean;
  catalog_retail: boolean;
  catalog_wholesale: boolean;
  theme: string;
  logo_url: string | null;
  banner_url: string | null;
};

type StoreProfile = {
  store_id: string;
  headline: string | null;
  description: string | null;
  address: string | null;
  city: string | null;
  department: string | null;
  google_maps_url: string | null;
  delivery_info: string | null;
  payment_methods: string | null;
  policies: string | null;
};

type StoreLink = {
  id: string;
  store_id: string;
  type: string;
  label: string | null;
  url: string;
  sort_order: number;
  active: boolean;
  icon_url: string | null;
};

type ThemeConfig = Partial<{
  bg: string;
  card: string;
  card_border: string;
  text: string;
  muted: string;
  accent: string;
  accent2: string;
  success: string;

  // soporta variantes posibles
  cta: string;
  ctaA: string;
  ctaB: string;
}>;

type ThemeRow = { id: string; name: string; config: ThemeConfig };

const DEFAULT_PROFILE = (storeId: string): StoreProfile => ({
  store_id: storeId,
  headline: "",
  description: "",
  address: "",
  city: "",
  department: "",
  google_maps_url: "",
  delivery_info: "",
  payment_methods: "",
  policies: "",
});

/* =========================
   Small helpers
========================= */
function normalizeLinks(arr: StoreLink[]) {
  // reindex sort_order
  return arr.map((l, idx) => ({ ...l, sort_order: idx }));
}
function pick(v?: string, fallback?: string) {
  const s = (v ?? "").trim();
  return s || (fallback ?? "");
}

/* =========================
   Theme -> CSS Vars (para preview)
========================= */
function themeConfigToVars(cfg?: ThemeConfig) {
  const bg = pick(
    cfg?.bg,
    "radial-gradient(circle at 18% 12%,rgba(168,85,247,0.45),transparent 48%),radial-gradient(circle at 82% 18%,rgba(217,70,239,0.28),transparent 52%),radial-gradient(circle at 50% 92%,rgba(99,102,241,0.20),transparent 58%), #07060d"
  );

  const cardBg = pick(cfg?.card, "rgba(255,255,255,0.06)");
  const border = pick(cfg?.card_border, "rgba(255,255,255,0.10)");
  const text = pick(cfg?.text, "rgba(255,255,255,0.92)");
  const muted = pick(cfg?.muted, "rgba(255,255,255,0.70)");
  const accent2 = pick(cfg?.accent2, cfg?.accent || "#a855f7");
  const cta = pick(cfg?.cta, pick(cfg?.ctaA, accent2));

  return {
    "--t-bg": bg,
    "--t-text": text,
    "--t-muted": muted,
    "--t-border": border,
    "--t-card-bg": cardBg,
    "--t-accent2": accent2,
    "--t-cta": cta,
  } as React.CSSProperties;
}

/* =========================
   ✅ UI helpers (tokens globales)
========================= */
function cardProps(extraClassName = "") {
  return {
    className: `rounded-[28px] border backdrop-blur-xl ${extraClassName}`,
    style: {
      borderColor: "var(--t-card-border)",
      background: "var(--t-card-bg)",
      boxShadow: "var(--t-shadow)",
      color: "var(--t-text)",
    } as React.CSSProperties,
  };
}
function inputProps(extraClassName = "") {
  return {
    className: `w-full rounded-2xl border p-3 outline-none ${extraClassName}`,
    style: {
      borderColor: "var(--t-card-border)",
      background: "color-mix(in oklab, var(--t-card-bg) 92%, transparent)",
      color: "var(--t-text)",
    } as React.CSSProperties,
  };
}
function btnSoftProps(extraClassName = "") {
  return {
    className: `rounded-2xl border px-4 py-2 text-sm font-semibold backdrop-blur-xl transition hover:brightness-110 disabled:opacity-60 ${extraClassName}`,
    style: {
      borderColor: "var(--t-card-border)",
      background: "color-mix(in oklab, var(--t-card-bg) 85%, transparent)",
      color: "color-mix(in oklab, var(--t-text) 92%, transparent)",
    } as React.CSSProperties,
  };
}
function btnPrimaryProps(extraClassName = "") {
  return {
    className: `rounded-2xl border px-5 py-2.5 text-sm font-semibold transition hover:brightness-110 disabled:opacity-60 ${extraClassName}`,
    style: {
      borderColor: "color-mix(in oklab, var(--t-accent) 45%, var(--t-card-border))",
      background: "var(--t-cta)",
      color: "#0b0b0b",
      boxShadow: "0 16px 40px color-mix(in oklab, var(--t-accent) 28%, transparent)",
    } as React.CSSProperties,
  };
}
function mutedStyle() {
  return { color: "var(--t-muted)" } as React.CSSProperties;
}
function faintStyle() {
  return { color: "color-mix(in oklab, var(--t-text) 60%, transparent)" } as React.CSSProperties;
}

/* =========================
   Preview REAL del catálogo
   (optimizado: NO se monta si el usuario no lo abre)
========================= */
function CatalogThemePreview({ theme }: { theme: ThemeRow }) {
  const vars = themeConfigToVars(theme.config);

  const outer = cardProps("p-4");
  return (
    <div {...outer}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.32em]" style={faintStyle()}>
            VISTA PREVIA DEL CATÁLOGO
          </p>
          <h3 className="mt-2 text-base font-semibold" style={{ color: "var(--t-text)" }}>
            {theme.name}
          </h3>
          <p className="mt-1 text-xs" style={faintStyle()}>
            ID: <span style={{ color: "color-mix(in oklab, var(--t-text) 80%, transparent)" }}>{theme.id}</span>
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span
            className="h-4 w-4 rounded-full border"
            style={{
              borderColor: "var(--t-card-border)",
              background: (theme.config?.accent2 ?? theme.config?.accent ?? "#a855f7") as any,
            }}
            title="accent2"
          />
          <span
            className="h-4 w-4 rounded-full border"
            style={{
              borderColor: "var(--t-card-border)",
              background: (theme.config?.cta ?? theme.config?.ctaA ?? theme.config?.accent2 ?? "#d946ef") as any,
            }}
            title="cta"
          />
        </div>
      </div>

      <div
        className="mt-4 overflow-hidden rounded-3xl border"
        style={{
          borderColor: "var(--t-card-border)",
          boxShadow: "0 20px 60px color-mix(in oklab, #000 35%, transparent)",
        }}
      >
        <div style={vars} className="min-h-[520px]">
          <main className="min-h-[520px]" style={{ background: "var(--t-bg)", color: "var(--t-text)" }}>
            <header className="border-b" style={{ borderColor: "var(--t-border)" }}>
              <div className="mx-auto max-w-[780px] p-5">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div
                      className="h-12 w-12 rounded-2xl border"
                      style={{
                        borderColor: "var(--t-border)",
                        background: "color-mix(in oklab, var(--t-card-bg) 70%, transparent)",
                      }}
                    />
                    <div>
                      <div className="text-lg font-bold leading-tight">Tu tienda</div>
                      <div className="text-sm" style={{ color: "var(--t-muted)" }}>
                        Catálogo Detal / Mayor
                      </div>
                    </div>
                  </div>

                  <a
                    className="rounded-xl border px-4 py-2 text-sm font-semibold"
                    style={{
                      borderColor: "var(--t-border)",
                      background: "color-mix(in oklab, var(--t-card-bg) 78%, transparent)",
                      color: "var(--t-text)",
                    }}
                    href="#"
                    onClick={(e) => e.preventDefault()}
                  >
                    Botón Header
                  </a>
                </div>

                <div
                  className="mt-4 rounded-2xl border p-4"
                  style={{ borderColor: "var(--t-border)", background: "var(--t-card-bg)" }}
                >
                  <div className="text-sm font-semibold">Headline / texto corto</div>
                  <div className="mt-1 text-xs" style={{ color: "var(--t-muted)" }}>
                    Aquí se ve el estilo de card, borde y texto.
                  </div>
                </div>

                <div
                  className="mt-4 h-28 w-full rounded-2xl border"
                  style={{
                    borderColor: "var(--t-border)",
                    background:
                      "linear-gradient(135deg, color-mix(in oklab, var(--t-accent2) 35%, transparent), transparent)",
                  }}
                />
              </div>
            </header>

            <section className="mx-auto max-w-[780px] p-5">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-lg font-semibold">Productos</div>
                  <div className="text-sm" style={{ color: "var(--t-muted)" }}>
                    12 disponibles
                  </div>
                </div>

                <button
                  className="rounded-xl border px-3 py-2 text-sm font-semibold"
                  style={{
                    borderColor: "var(--t-border)",
                    background: "color-mix(in oklab, var(--t-card-bg) 78%, transparent)",
                    color: "var(--t-text)",
                  }}
                  type="button"
                >
                  Ver todo
                </button>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {["Bebidas", "Snacks", "Aseo", "Ofertas"].map((c, idx) => (
                  <button
                    key={c}
                    type="button"
                    className={`rounded-2xl border p-2 text-left transition ${idx === 1 ? "ring-2 ring-white/30" : ""}`}
                    style={{
                      borderColor: "var(--t-border)",
                      background: "var(--t-card-bg)",
                    }}
                  >
                    <div
                      className="aspect-square w-full rounded-xl border"
                      style={{
                        borderColor: "var(--t-border)",
                        background: "linear-gradient(135deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02))",
                      }}
                    />
                    <p className="mt-2 line-clamp-2 text-sm font-semibold">{c}</p>
                  </button>
                ))}
              </div>

              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                {[1, 2, 3, 4].map((n) => (
                  <div
                    key={n}
                    className="rounded-2xl border p-4"
                    style={{
                      borderColor: "var(--t-border)",
                      background: "var(--t-card-bg)",
                    }}
                  >
                    <div
                      className="mb-3 aspect-square w-full rounded-xl border"
                      style={{
                        borderColor: "var(--t-border)",
                        background: "linear-gradient(135deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02))",
                      }}
                    />

                    <div className="flex items-start justify-between gap-3">
                      <div className="font-semibold leading-tight">Producto ejemplo {n}</div>
                      <span
                        className="rounded-full px-3 py-1 text-xs font-semibold"
                        style={{ background: "var(--t-accent2)", color: "#0b0b0b" }}
                      >
                        DETAL
                      </span>
                    </div>

                    <p className="mt-2 text-sm" style={{ color: "var(--t-muted)" }}>
                      Descripción corta para ver el texto muted.
                    </p>

                    <div className="mt-4 flex items-end justify-between">
                      <div>
                        <p className="text-xs" style={{ color: "var(--t-muted)" }}>
                          Precio
                        </p>
                        <p className="text-lg font-bold">$25.000</p>
                      </div>

                      <button
                        className="rounded-xl px-4 py-2 font-semibold"
                        style={{ background: "var(--t-cta)", color: "#0b0b0b" }}
                        type="button"
                      >
                        Agregar
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <footer className="border-t" style={{ borderColor: "var(--t-border)" }}>
              <div className="mx-auto max-w-[780px] p-5 text-sm" style={{ color: "var(--t-muted)" }}>
                Footer / dirección / ciudad…
              </div>
            </footer>
          </main>
        </div>
      </div>
    </div>
  );
}

/* =========================
   Page (Optimizada)
   - NO monta Preview ni ImageUpload hasta que el usuario los abra
   - Reduce requests guardando links con UPSERT + DELETE
========================= */
export default function StoreSettingsPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [userId, setUserId] = useState<string | null>(null);
  const [themes, setThemes] = useState<ThemeRow[]>([]);
  const [store, setStore] = useState<Store | null>(null);
  const [profile, setProfile] = useState<StoreProfile | null>(null);
  const [links, setLinks] = useState<StoreLink[]>([]);
  const [deletedLinkIds, setDeletedLinkIds] = useState<string[]>([]);

  // ✅ toggles: evita que se descarguen imágenes/preview si no los abres
  const [showImages, setShowImages] = useState(false);
  const [showThemePreview, setShowThemePreview] = useState(false);

  /* ---------------------------
     Load (mejor: paralelo)
  --------------------------- */
  useEffect(() => {
    let alive = true;

    (async () => {
      setLoading(true);
      setMsg(null);

      try {
        const sb = supabaseBrowser();

        const { data: userRes, error: userErr } = await sb.auth.getUser();
        if (userErr) throw userErr;

        if (!userRes.user) {
          router.replace("/login");
          return;
        }

        const uid = userRes.user.id;
        if (!alive) return;
        setUserId(uid);

        // themes + store en paralelo
        const [themesRes, storeRes] = await Promise.all([
          sb.from("themes").select("id,name,config").eq("active", true).order("sort_order", { ascending: true }),
          sb
            .from("stores")
            .select("id,name,slug,whatsapp,phone,email,active,catalog_retail,catalog_wholesale,theme,logo_url,banner_url")
            .eq("owner_id", uid)
            .maybeSingle(),
        ]);

        if (themesRes.error) throw themesRes.error;
        if (storeRes.error) throw storeRes.error;

        const themesList = (themesRes.data as ThemeRow[]) ?? [];
        if (!alive) return;
        setThemes(themesList);

        const st = storeRes.data as Store | null;
        if (!st) {
          setMsg("⚠️ Aún no tienes una tienda creada.");
          setStore(null);
          setProfile(null);
          setLinks([]);
          return;
        }

        const themeExists = themesList.some((t) => t.id === (st as any).theme);
        const safeTheme = themeExists ? (st as any).theme : themesList[0]?.id ?? (st as any).theme;

        const safeStore: Store = { ...(st as Store), theme: safeTheme };
        if (!alive) return;
        setStore(safeStore);

        // profile + links en paralelo
        const [profileRes, linksRes] = await Promise.all([
          sb
            .from("store_profiles")
            .select("store_id,headline,description,address,city,department,google_maps_url,delivery_info,payment_methods,policies")
            .eq("store_id", safeStore.id)
            .maybeSingle(),
          sb
            .from("store_links")
            .select("id,store_id,type,label,url,sort_order,active,icon_url")
            .eq("store_id", safeStore.id)
            .order("sort_order", { ascending: true }),
        ]);

        if (profileRes.error) throw profileRes.error;
        if (linksRes.error) throw linksRes.error;

        if (!alive) return;
        setProfile((profileRes.data as StoreProfile) ?? DEFAULT_PROFILE(safeStore.id));
        setLinks((linksRes.data as StoreLink[]) ?? []);
        setDeletedLinkIds([]);
      } catch (e: any) {
        if (!alive) return;
        setMsg("❌ Error cargando: " + (e?.message ?? "Error"));
      } finally {
        if (!alive) return;
        setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [router]);

  /* ---------------------------
     Helpers
  --------------------------- */
  function setStoreField<K extends keyof Store>(key: K, value: Store[K]) {
    setStore((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  function setProfileField<K extends keyof StoreProfile>(key: K, value: StoreProfile[K]) {
    setProfile((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  function addLink() {
    if (!store) return;

    // ✅ crea UUID REAL para poder upsert directo (sin prefijos raros)
    const id = crypto.randomUUID();

    setLinks((prev) => [
      ...prev,
      {
        id,
        store_id: store.id,
        type: "instagram",
        label: "Instagram",
        url: "",
        sort_order: prev.length,
        active: true,
        icon_url: null,
      },
    ]);
  }

  function updateLink(id: string, patch: Partial<StoreLink>) {
    setLinks((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }

  function removeLink(id: string) {
    // ✅ marca para borrar en DB al guardar
    setDeletedLinkIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
    setLinks((prev) => prev.filter((l) => l.id !== id));
  }

  /* ---------------------------
     Save (optimizado)
     - Store update
     - Profile upsert
     - Links: DELETE marcados + UPSERT masivo
  --------------------------- */
  async function saveAll() {
    if (!store || !profile) return;

    setSaving(true);
    setMsg(null);

    try {
      const sb = supabaseBrowser();

      if (!store.name.trim()) throw new Error("El nombre es obligatorio.");
      if (!store.whatsapp.trim()) throw new Error("El WhatsApp es obligatorio.");

      const normalizedLinks = normalizeLinks(links);
      setLinks(normalizedLinks);

      // 1) store
      const { error: storeErr } = await sb
        .from("stores")
        .update({
          name: store.name.trim(),
          whatsapp: store.whatsapp.trim(),
          phone: (store.phone ?? "").trim() || null,
          email: (store.email ?? "").trim() || null,
          active: store.active,
          catalog_retail: store.catalog_retail,
          catalog_wholesale: store.catalog_wholesale,
          theme: store.theme,
          logo_url: store.logo_url,
          banner_url: store.banner_url,
        })
        .eq("id", store.id);

      if (storeErr) throw storeErr;

      // 2) profile upsert
      const { error: profErr } = await sb.from("store_profiles").upsert({
        store_id: store.id,
        headline: (profile.headline ?? "").trim(),
        description: (profile.description ?? "").trim(),
        address: (profile.address ?? "").trim(),
        city: (profile.city ?? "").trim(),
        department: (profile.department ?? "").trim(),
        google_maps_url: (profile.google_maps_url ?? "").trim(),
        delivery_info: (profile.delivery_info ?? "").trim(),
        payment_methods: (profile.payment_methods ?? "").trim(),
        policies: (profile.policies ?? "").trim(),
      });

      if (profErr) throw profErr;

      // 3) delete links removed
      if (deletedLinkIds.length) {
        const { error: delErr } = await sb.from("store_links").delete().in("id", deletedLinkIds);
        if (delErr) throw delErr;
      }

      // 4) upsert links (uno solo request)
      if (normalizedLinks.length) {
        const payload = normalizedLinks
          .filter((l) => l.url.trim()) // si url vacío, no lo guardamos
          .map((l) => ({
            id: l.id,
            store_id: store.id,
            type: l.type,
            label: (l.label ?? "").trim() || null,
            url: l.url.trim(),
            sort_order: l.sort_order,
            active: l.active,
            icon_url: l.icon_url ?? null,
          }));

        if (payload.length) {
          const { error: upErr } = await sb.from("store_links").upsert(payload, { onConflict: "id" });
          if (upErr) throw upErr;
        }
      }

      // reload links
      const { data: ln, error: reloadErr } = await sb
        .from("store_links")
        .select("id,store_id,type,label,url,sort_order,active,icon_url")
        .eq("store_id", store.id)
        .order("sort_order", { ascending: true });

      if (reloadErr) throw reloadErr;

      setLinks((ln as StoreLink[]) ?? []);
      setDeletedLinkIds([]);
      setMsg("✅ Guardado correctamente.");
    } catch (e: any) {
      setMsg("❌ " + (e?.message ?? "Error guardando"));
    } finally {
      setSaving(false);
    }
  }

  /* ---------------------------
     UI Card
  --------------------------- */
  function Card({
    title,
    subtitle,
    children,
    right,
  }: {
    title: string;
    subtitle?: string;
    right?: React.ReactNode;
    children: React.ReactNode;
  }) {
    const c = cardProps("p-5");
    return (
      <section {...c}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold" style={{ color: "var(--t-text)" }}>
              {title}
            </h2>
            {subtitle ? (
              <p className="mt-1 text-sm" style={mutedStyle()}>
                {subtitle}
              </p>
            ) : null}
          </div>
          {right}
        </div>
        <div className="mt-4">{children}</div>
      </section>
    );
  }

  /* ---------------------------
     Render states
  --------------------------- */
  if (loading) {
    const shell = cardProps("p-6");
    return (
      <main className="min-h-screen px-6 py-10" style={{ color: "var(--t-text)" }}>
        <div className="mx-auto max-w-4xl">
          <div {...shell}>
            <p className="text-sm" style={mutedStyle()}>
              Cargando...
            </p>
          </div>
        </div>
      </main>
    );
  }

  if (!store || !profile) {
    const shell = cardProps("p-6");
    return (
      <main className="min-h-screen px-6 py-10" style={{ color: "var(--t-text)" }}>
        <div className="mx-auto max-w-4xl">
          <div {...shell}>
            <h1 className="text-2xl font-semibold">Mi tienda</h1>
            <p className="mt-3 text-sm" style={mutedStyle()}>
              {msg ?? "No hay tienda."}
            </p>
          </div>
        </div>
      </main>
    );
  }

  const selectedTheme = themes.find((t) => t.id === store.theme) ?? null;

  const headerCard = cardProps("p-5");
  const infoCard = cardProps("p-4");
  const saveBtn = btnPrimaryProps("");
  const toggleBtn = btnSoftProps("");
  const softBtn = btnSoftProps("");
  const input = inputProps("");

  return (
    <main className="min-h-screen" style={{ color: "var(--t-text)" }}>
      <div className="mx-auto max-w-6xl px-4 py-6 md:px-6 md:py-8 space-y-5">
        {/* Header */}
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div {...headerCard}>
            <h1 className="text-2xl font-semibold" style={{ color: "var(--t-text)" }}>
              Mi tienda
            </h1>
            <p className="mt-1 text-sm" style={mutedStyle()}>
              Configura tu perfil, enlaces y apariencia.
            </p>
            {msg ? <p className="mt-2 text-sm">{msg}</p> : null}
          </div>

          <button
            className={saveBtn.className}
            style={saveBtn.style}
            onClick={saveAll}
            disabled={saving}
          >
            {saving ? "Guardando..." : "Guardar cambios"}
          </button>
        </div>

        {/* Nota rápida para egress */}
        <div {...infoCard} style={{ ...infoCard.style, fontSize: 12 }}>
          💡 Para ahorrar datos/egress: las secciones de <b>Imágenes</b> y <b>Vista previa</b> están cerradas por defecto.
          Ábrelas solo cuando las necesites.
        </div>

        {/* Grid */}
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.1fr_.9fr]">
          <div className="space-y-5">
            <Card title="Datos básicos" subtitle="Nombre, WhatsApp y contacto.">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div>
                  <label className="text-sm" style={mutedStyle()}>
                    Nombre
                  </label>
                  <input
                    className={`mt-1 ${input.className}`}
                    style={input.style}
                    value={store.name}
                    onChange={(e) => setStoreField("name", e.target.value)}
                  />
                </div>

                <div>
                  <label className="text-sm" style={mutedStyle()}>
                    WhatsApp (57...)
                  </label>
                  <input
                    className={`mt-1 ${input.className}`}
                    style={input.style}
                    value={store.whatsapp}
                    onChange={(e) => setStoreField("whatsapp", e.target.value)}
                  />
                </div>

                <div>
                  <label className="text-sm" style={mutedStyle()}>
                    Teléfono
                  </label>
                  <input
                    className={`mt-1 ${input.className}`}
                    style={input.style}
                    value={store.phone ?? ""}
                    onChange={(e) => setStoreField("phone", e.target.value)}
                  />
                </div>

                <div>
                  <label className="text-sm" style={mutedStyle()}>
                    Email
                  </label>
                  <input
                    className={`mt-1 ${input.className}`}
                    style={input.style}
                    value={store.email ?? ""}
                    onChange={(e) => setStoreField("email", e.target.value)}
                  />
                </div>
              </div>
            </Card>

            <Card title="Catálogos y apariencia" subtitle="Activa/desactiva y elige tema.">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <label
                  className="flex items-center gap-3 rounded-2xl border p-3"
                  style={{
                    borderColor: "var(--t-card-border)",
                    background: "color-mix(in oklab, var(--t-card-bg) 85%, transparent)",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={store.catalog_retail}
                    onChange={(e) => setStoreField("catalog_retail", e.target.checked)}
                  />
                  <span className="text-sm">Catálogo Detal</span>
                </label>

                <label
                  className="flex items-center gap-3 rounded-2xl border p-3"
                  style={{
                    borderColor: "var(--t-card-border)",
                    background: "color-mix(in oklab, var(--t-card-bg) 85%, transparent)",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={store.catalog_wholesale}
                    onChange={(e) => setStoreField("catalog_wholesale", e.target.checked)}
                  />
                  <span className="text-sm">Catálogo Mayor</span>
                </label>

                <div
                  className="rounded-2xl border p-3"
                  style={{
                    borderColor: "var(--t-card-border)",
                    background: "color-mix(in oklab, var(--t-card-bg) 85%, transparent)",
                  }}
                >
                  <label className="text-sm" style={mutedStyle()}>
                    Tema
                  </label>
                  <select
                    className={`mt-1 ${input.className}`}
                    style={input.style}
                    value={store.theme}
                    onChange={(e) => setStoreField("theme", e.target.value)}
                  >
                    {themes.length ? (
                      themes.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))
                    ) : (
                      <option value={store.theme}>{store.theme}</option>
                    )}
                  </select>
                </div>
              </div>

              {/* ✅ Preview: solo si se abre */}
              <div className="mt-4">
                <button
                  type="button"
                  className={toggleBtn.className}
                  style={toggleBtn.style}
                  onClick={() => setShowThemePreview((v) => !v)}
                >
                  {showThemePreview ? "Ocultar vista previa" : "Ver vista previa del catálogo"}
                </button>

                {showThemePreview ? (
                  <div className="mt-4">
                    {selectedTheme ? (
                      <CatalogThemePreview theme={selectedTheme} />
                    ) : (
                      <div {...cardProps("p-4")} style={{ ...cardProps("p-4").style }}>
                        <div className="text-sm" style={mutedStyle()}>
                          No se encontró el theme seleccionado.
                        </div>
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            </Card>

            <Card title="Perfil público" subtitle="Texto que se verá en tu catálogo.">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="md:col-span-2">
                  <label className="text-sm" style={mutedStyle()}>
                    Headline
                  </label>
                  <input
                    className={`mt-1 ${input.className}`}
                    style={input.style}
                    value={profile.headline ?? ""}
                    onChange={(e) => setProfileField("headline", e.target.value)}
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="text-sm" style={mutedStyle()}>
                    Descripción
                  </label>
                  <textarea
                    className={`mt-1 ${inputProps("min-h-[120px]").className}`}
                    style={input.style}
                    value={profile.description ?? ""}
                    onChange={(e) => setProfileField("description", e.target.value)}
                  />
                </div>

                <div>
                  <label className="text-sm" style={mutedStyle()}>
                    Dirección
                  </label>
                  <input
                    className={`mt-1 ${input.className}`}
                    style={input.style}
                    value={profile.address ?? ""}
                    onChange={(e) => setProfileField("address", e.target.value)}
                  />
                </div>

                <div>
                  <label className="text-sm" style={mutedStyle()}>
                    Ciudad
                  </label>
                  <input
                    className={`mt-1 ${input.className}`}
                    style={input.style}
                    value={profile.city ?? ""}
                    onChange={(e) => setProfileField("city", e.target.value)}
                  />
                </div>

                <div>
                  <label className="text-sm" style={mutedStyle()}>
                    Departamento
                  </label>
                  <input
                    className={`mt-1 ${input.className}`}
                    style={input.style}
                    value={profile.department ?? ""}
                    onChange={(e) => setProfileField("department", e.target.value)}
                  />
                </div>

                <div>
                  <label className="text-sm" style={mutedStyle()}>
                    Google Maps
                  </label>
                  <input
                    className={`mt-1 ${input.className}`}
                    style={input.style}
                    value={profile.google_maps_url ?? ""}
                    onChange={(e) => setProfileField("google_maps_url", e.target.value)}
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="text-sm" style={mutedStyle()}>
                    Envíos
                  </label>
                  <textarea
                    className={`mt-1 ${inputProps("min-h-[90px]").className}`}
                    style={input.style}
                    value={profile.delivery_info ?? ""}
                    onChange={(e) => setProfileField("delivery_info", e.target.value)}
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="text-sm" style={mutedStyle()}>
                    Métodos de pago
                  </label>
                  <textarea
                    className={`mt-1 ${inputProps("min-h-[90px]").className}`}
                    style={input.style}
                    value={profile.payment_methods ?? ""}
                    onChange={(e) => setProfileField("payment_methods", e.target.value)}
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="text-sm" style={mutedStyle()}>
                    Políticas
                  </label>
                  <textarea
                    className={`mt-1 ${inputProps("min-h-[90px]").className}`}
                    style={input.style}
                    value={profile.policies ?? ""}
                    onChange={(e) => setProfileField("policies", e.target.value)}
                  />
                </div>
              </div>
            </Card>
          </div>

          <div className="space-y-5">
            <Card title="Logo y banner" subtitle="Se verán en tu catálogo.">
              <button
                type="button"
                className={btnSoftProps("").className}
                style={btnSoftProps("").style}
                onClick={() => setShowImages((v) => !v)}
              >
                {showImages ? "Ocultar imágenes" : "Administrar imágenes (logo/banner)"}
              </button>

              {showImages ? (
                !userId ? (
                  <p className="mt-3 text-sm" style={mutedStyle()}>
                    Cargando usuario...
                  </p>
                ) : (
                  <div className="mt-4 grid grid-cols-1 gap-4">
                    <ImageUpload
                      label="Logo"
                      currentUrl={store.logo_url}
                      pathPrefix={`${userId}/`}
                      fileName="logo.png"
                      onUploaded={(url) => setStoreField("logo_url", url)}
                    />

                    <ImageUpload
                      label="Banner"
                      currentUrl={store.banner_url}
                      pathPrefix={`${userId}/`}
                      fileName="banner.png"
                      onUploaded={(url) => setStoreField("banner_url", url)}
                    />
                  </div>
                )
              ) : (
                <p className="mt-3 text-xs" style={faintStyle()}>
                  (Cerrado para ahorrar datos. Al abrir, se mostrarán previews si existen.)
                </p>
              )}
            </Card>

            <Card
              title="Redes sociales y enlaces"
              subtitle="Instagram, TikTok, web, etc."
              right={
                <button
                  className={btnSoftProps("px-3 py-2").className}
                  style={btnSoftProps("px-3 py-2").style}
                  onClick={addLink}
                >
                  + Agregar
                </button>
              }
            >
              {links.length === 0 ? (
                <p className="text-sm" style={mutedStyle()}>
                  Aún no tienes enlaces. Agrega Instagram, Facebook, TikTok, web, etc.
                </p>
              ) : (
                <div className="space-y-3">
                  {links.map((l, idx) => (
                    <div
                      key={l.id}
                      className="rounded-2xl border p-4"
                      style={{
                        borderColor: "var(--t-card-border)",
                        background: "color-mix(in oklab, var(--t-card-bg) 85%, transparent)",
                      }}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-semibold">Enlace #{idx + 1}</p>
                        <button
                          className="rounded-xl border px-3 py-2 text-xs transition hover:brightness-110"
                          style={{
                            borderColor: "var(--t-card-border)",
                            background: "color-mix(in oklab, var(--t-card-bg) 85%, transparent)",
                            color: "color-mix(in oklab, var(--t-text) 90%, transparent)",
                          }}
                          onClick={() => removeLink(l.id)}
                        >
                          Eliminar
                        </button>
                      </div>

                      <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-4">
                        <select
                          className={input.className}
                          style={input.style}
                          value={l.type}
                          onChange={(e) => updateLink(l.id, { type: e.target.value })}
                        >
                          <option value="instagram">Instagram</option>
                          <option value="facebook">Facebook</option>
                          <option value="tiktok">TikTok</option>
                          <option value="youtube">YouTube</option>
                          <option value="website">Website</option>
                          <option value="whatsapp">WhatsApp</option>
                          <option value="other">Otro</option>
                        </select>

                        <input
                          className={input.className}
                          style={input.style}
                          placeholder="Etiqueta (opcional)"
                          value={l.label ?? ""}
                          onChange={(e) => updateLink(l.id, { label: e.target.value })}
                        />

                        <input
                          className={`md:col-span-2 ${input.className}`}
                          style={input.style}
                          placeholder="URL"
                          value={l.url}
                          onChange={(e) => updateLink(l.id, { url: e.target.value })}
                        />
                      </div>

                      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                        <label className="flex items-center gap-2 text-sm" style={{ color: "color-mix(in oklab, var(--t-text) 85%, transparent)" }}>
                          <input
                            type="checkbox"
                            checked={l.active}
                            onChange={(e) => updateLink(l.id, { active: e.target.checked })}
                          />
                          Activo
                        </label>

                        <div className="text-xs" style={faintStyle()}>
                          Orden: {l.sort_order}
                        </div>
                      </div>

                      {l.type === "other" && userId ? (
                        <div {...cardProps("mt-3 p-4")} style={{ ...cardProps("mt-3 p-4").style }}>
                          <p className="text-sm mb-2" style={{ color: "color-mix(in oklab, var(--t-text) 85%, transparent)" }}>
                            Icono personalizado (solo “Otro”)
                          </p>
                          <ImageUpload
                            label="Icono"
                            currentUrl={l.icon_url}
                            pathPrefix={`${userId}/links/`}
                            fileName={`${l.id}.png`}
                            onUploaded={(url) => updateLink(l.id, { icon_url: url })}
                          />
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <div {...cardProps("p-4")} style={{ ...cardProps("p-4").style, fontSize: 12 }}>
              ✅ Consejo de rendimiento: el mayor consumo de egress casi siempre viene de <b>imágenes</b>. Mantén estas secciones cerradas cuando no las estés usando.
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
