"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Swal from "sweetalert2";

import { supabaseBrowser } from "@/lib/supabase/client";
import { SocialIconRow } from "./socials";
import { useCart } from "@/lib/cart/CartProvider";
import { CartDrawer } from "@/lib/cart/CartDrawer";

// ✅ helper centralizado
import { applyThemeToRoot, type ThemeConfig } from "@/lib/themes/applyTheme";

type Mode = "detal" | "mayor";

type StoreRow = {
  id: string;
  name: string;
  slug: string;
  whatsapp: string;
  active: boolean;
  catalog_retail: boolean;
  catalog_wholesale: boolean;
  theme: string | null;
  logo_url: string | null;
  banner_url: string | null;
  wholesale_key: string | null;
};

function isValidMode(x: any): x is Mode {
  return x === "detal" || x === "mayor";
}

function cx(...s: Array<string | false | null | undefined>) {
  return s.filter(Boolean).join(" ");
}

function money(n: number) {
  return `$${Number(n || 0).toLocaleString("es-CO")}`;
}

export default function StoreCatalogPage() {
  const params = useParams<{ slug: string; mode: string }>();
  const searchParams = useSearchParams();

  const slug = String(params?.slug ?? "");
  const mode = String(params?.mode ?? "detal");
  const key = searchParams.get("key");

  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  const [store, setStore] = useState<StoreRow | null>(null);
  const [profile, setProfile] = useState<any>(null);
  const [links, setLinks] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);

  const [categories, setCategories] = useState<any[]>([]);
  const [selectedCat, setSelectedCat] = useState<string | null>(null);

  // ✅ buscador (se moverá debajo de categorías)
  const [q, setQ] = useState("");
  const [imgLoaded, setImgLoaded] = useState(false);

  const { initCart, addItem } = useCart();

  const safeMode: Mode = useMemo(() => (isValidMode(mode) ? mode : "detal"), [mode]);

  useEffect(() => {
    (async () => {
      setMsg(null);
      setLoading(true);

      try {
        const sb = supabaseBrowser();

        if (!slug || !isValidMode(mode)) {
          setMsg("❌ Ruta inválida.");
          setLoading(false);
          return;
        }

        // 1) Tienda
        const { data: storeData, error: storeErr } = await sb
          .from("stores")
          .select(
            "id,name,slug,whatsapp,active,catalog_retail,catalog_wholesale,theme,logo_url,banner_url,wholesale_key"
          )
          .eq("slug", slug)
          .maybeSingle();

        if (storeErr || !storeData) {
          setMsg("❌ Tienda no encontrada.");
          setLoading(false);
          return;
        }

        const st = storeData as StoreRow;

        // Acceso mayorista por key
        if (safeMode === "mayor") {
          if (!st.wholesale_key) {
            setMsg("❌ Este catálogo mayorista no está disponible.");
            setLoading(false);
            return;
          }
          if (key !== st.wholesale_key) {
            setMsg("🔒 Catálogo mayorista privado. Solicita acceso por WhatsApp.");
            setLoading(false);
            return;
          }
        }

        if (!st.active) {
          setMsg("❌ Esta tienda está desactivada.");
          setLoading(false);
          return;
        }

        if (safeMode === "detal" && !st.catalog_retail) {
          setMsg("❌ Catálogo detal no disponible.");
          setLoading(false);
          return;
        }

        if (safeMode === "mayor" && !st.catalog_wholesale) {
          setMsg("❌ Catálogo mayor no disponible.");
          setLoading(false);
          return;
        }

        setStore(st);

        // ✅ THEME real desde DB
        const themeId = st.theme?.trim() || null;
        let cfg: ThemeConfig | undefined;

        if (themeId) {
          const { data: themeRow, error: thErr } = await sb
            .from("themes")
            .select("id,active,config")
            .eq("id", themeId)
            .maybeSingle();

          if (!thErr && themeRow?.config) cfg = themeRow.config as ThemeConfig;
        }

        if (!cfg) {
          const { data: fallback } = await sb
            .from("themes")
            .select("id,config")
            .eq("active", true)
            .order("sort_order", { ascending: true })
            .limit(1)
            .maybeSingle();

          cfg = (fallback?.config ?? undefined) as ThemeConfig | undefined;
        }

        // ✅ aplica a :root
        applyThemeToRoot(cfg);

        // carrito
        initCart({
          storeId: st.id,
          storeSlug: st.slug,
          storeName: st.name,
          whatsapp: st.whatsapp,
          mode: safeMode,
        });

        // 2) Perfil
        const { data: profData } = await sb
          .from("store_profiles")
          .select("*")
          .eq("store_id", st.id)
          .maybeSingle();
        setProfile(profData ?? null);

        // 3) Redes
        const { data: linksData } = await sb
          .from("store_links")
          .select("id,type,label,url,active,sort_order,icon_url")
          .eq("store_id", st.id)
          .eq("active", true)
          .order("sort_order", { ascending: true });
        setLinks(linksData ?? []);

        // 4) Categorías
        const { data: catData } = await sb
          .from("product_categories")
          .select("id,name,image_url,sort_order")
          .eq("store_id", st.id)
          .eq("active", true)
          .order("sort_order", { ascending: true });
        setCategories(catData ?? []);

        // 5) Productos
        const { data: prodData } = await sb
          .from("products")
          .select(
            "id,name,description,price_retail,price_wholesale,min_wholesale,active,image_url,category_id"
          )
          .eq("store_id", st.id)
          .eq("active", true)
          .order("name", { ascending: true });
        setProducts(prodData ?? []);
      } catch (err: any) {
        setMsg(err?.message ?? "Error cargando catálogo.");
      } finally {
        setLoading(false);
      }
    })();
  }, [slug, mode, key, initCart, safeMode]);

  // ✅ TITULO + LOGO EN LA PESTAÑA (cuando ya existe store)
  useEffect(() => {
    if (!store?.name) return;

    // Título de la pestaña
    document.title = `${store.name} - Catálogos online`;

    // Favicon (logo en la pestaña)
    const favicon =
      (document.querySelector("link[rel~='icon']") as HTMLLinkElement | null) ||
      (document.createElement("link") as HTMLLinkElement);

    favicon.rel = "icon";

    // Cache-buster para que el navegador no se quede con el favicon viejo
    const iconUrl = store.logo_url ? `${store.logo_url}?v=${Date.now()}` : "/favicon.ico";
    favicon.href = iconUrl;

    document.head.appendChild(favicon);
  }, [store]);

  async function addToCartWithQty(p: any, price: number) {
    const min = safeMode === "mayor" ? Number(p.min_wholesale ?? 1) : 1;

    const res = await Swal.fire({
      title: "Agregar al carrito",
      html: `
        <div style="text-align:left; opacity:.92">
          <div style="font-weight:800; margin-bottom:6px;">${p.name}</div>
          <div style="opacity:.85; margin-bottom:12px;">
            Precio: <b>${money(price)}</b>
          </div>
          <label style="font-size:12px; opacity:.8;">Cantidad</label>
          <input id="qty" type="number" class="swal2-input" value="${min}" min="${min}" style="margin-top:6px;" />
          ${
            safeMode === "mayor"
              ? `<div style="font-size:12px; opacity:.75; margin-top:6px;">Mínimo mayorista: ${min}</div>`
              : ""
          }
        </div>
      `,
      background: "#0b0b0b",
      color: "#fff",
      showCancelButton: true,
      confirmButtonText: "Agregar",
      cancelButtonText: "Cancelar",
      confirmButtonColor: "#22c55e",
      preConfirm: () => {
        const el = document.getElementById("qty") as HTMLInputElement | null;
        const qty = Number(el?.value ?? min);
        return Math.max(min, Math.floor(qty || min));
      },
    });

    if (!res.isConfirmed) return;

    const qty = Number(res.value ?? min);

    try {
      (addItem as any)(
        {
          productId: p.id,
          name: p.name,
          price: Number(price ?? 0),
          qty,
          minWholesale: p.min_wholesale ?? null,
        },
        { openDrawer: false }
      );
    } catch {
      addItem({
        productId: p.id,
        name: p.name,
        price: Number(price ?? 0),
        qty,
        minWholesale: p.min_wholesale ?? null,
      });
    }

    await Swal.fire({
      icon: "success",
      title: "Agregado",
      text: `Se agregó ${qty} × ${p.name} al carrito.`,
      timer: 950,
      showConfirmButton: false,
      background: "#0b0b0b",
      color: "#fff",
    });
  }

  const shownProductsBase = selectedCat ? products.filter((p) => p.category_id === selectedCat) : products;

  const shownProducts = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return shownProductsBase;
    return shownProductsBase.filter((p: any) => {
      const a = String(p?.name ?? "").toLowerCase();
      const b = String(p?.description ?? "").toLowerCase();
      return a.includes(s) || b.includes(s);
    });
  }, [shownProductsBase, q]);

  if (loading) {
    return (
      <main className="p-6" style={{ background: "var(--t-bg)", color: "var(--t-text)" }}>
        <div className="mx-auto max-w-6xl">
          <div
            className="rounded-3xl border p-5"
            style={{
              borderColor: "var(--t-border)",
              background: "color-mix(in oklab, var(--t-card-bg) 88%, transparent)",
            }}
          >
            <p className="text-sm" style={{ color: "var(--t-muted)" }}>
              Cargando catálogo...
            </p>
          </div>
        </div>
      </main>
    );
  }

  if (!store) {
    return (
      <main className="p-6" style={{ background: "var(--t-bg)", color: "var(--t-text)" }}>
        <div className="mx-auto max-w-6xl">
          <p>{msg ?? "No se pudo cargar."}</p>
        </div>
      </main>
    );
  }

  const accentChipBg = "color-mix(in oklab, var(--t-accent2) 70%, white 0%)";
  const glassBg = "color-mix(in oklab, var(--t-card-bg) 78%, transparent)";
  const glassBg2 = "color-mix(in oklab, var(--t-card-bg) 64%, transparent)";

  return (
    <main className="min-h-screen" style={{ background: "var(--t-bg)", color: "var(--t-text)" }}>
      {/* ✅ Premium background overlay */}
      <div className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute inset-0" style={{ background: "var(--t-bg)" }} />
        <div
          className="absolute inset-0 opacity-[0.22]"
          style={{
            background:
              "radial-gradient(900px 420px at 12% 10%, color-mix(in oklab, var(--t-accent2) 55%, transparent), transparent 60%), radial-gradient(800px 420px at 88% 16%, color-mix(in oklab, var(--t-cta) 45%, transparent), transparent 58%), radial-gradient(900px 520px at 50% 92%, color-mix(in oklab, var(--t-accent2) 35%, transparent), transparent 64%)",
          }}
        />
        <div
          className="absolute inset-0 opacity-[0.09]"
          style={{
            backgroundImage: "radial-gradient(currentColor 1px, transparent 1px)",
            backgroundSize: "24px 24px",
            color: "rgba(255,255,255,0.35)",
          }}
        />
        <div className="absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-black/30 to-transparent" />
      </div>

      {/* ✅ CSS extra */}
      <style jsx global>{`
        .t-glass {
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
        }
        .t-ring:focus {
          outline: none;
          box-shadow: 0 0 0 3px color-mix(in oklab, var(--t-accent2) 35%, transparent);
        }
        .t-card {
          transition: transform 220ms ease, box-shadow 220ms ease, border-color 220ms ease;
        }
        .t-card:hover {
          transform: translateY(-2px);
          box-shadow: 0 22px 55px rgba(0, 0, 0, 0.28);
          border-color: color-mix(in oklab, var(--t-border) 60%, white 15%);
        }
        .t-btn {
          transition: transform 180ms ease, filter 180ms ease, box-shadow 180ms ease;
        }
        .t-btn:active {
          transform: scale(0.99);
        }
        .t-btn:hover {
          filter: brightness(1.05);
        }
      `}</style>

      {/* ✅ Sticky Topbar */}
      <div
        className="sticky top-0 z-40 border-b t-glass"
        style={{
          borderColor: "var(--t-border)",
          background: glassBg,
        }}
      >
        <div className="mx-auto max-w-6xl px-4 py-3 sm:px-6">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              {store.logo_url ? (
                <img
                  src={store.logo_url}
                  alt={store.name}
                  className="h-10 w-10 rounded-2xl border object-cover"
                  style={{ borderColor: "var(--t-border)" }}
                />
              ) : (
                <div className="h-10 w-10 rounded-2xl border" style={{ borderColor: "var(--t-border)" }} />
              )}

              <div className="min-w-0">
                <p className="truncate text-sm font-extrabold">{store.name}</p>
                <p className="text-[11px]" style={{ color: "var(--t-muted)" }}>
                  {safeMode === "detal" ? "Catálogo Detal" : "Catálogo Mayoristas"}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span
                className="hidden sm:inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold"
                style={{
                  borderColor: "var(--t-border)",
                  background: glassBg2,
                }}
              >
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: accentChipBg }} />
                {safeMode === "detal" ? "DETAL" : "MAYOR"}
              </span>

              {safeMode === "detal" ? (
                <a
                  className="t-btn rounded-2xl border px-3 py-2 text-xs font-semibold sm:px-4 sm:text-sm"
                  style={{
                    borderColor: "var(--t-border)",
                    background: glassBg2,
                  }}
                  href={`https://wa.me/${store.whatsapp}?text=${encodeURIComponent(
                    `Hola! Quiero acceso al catálogo MAYORISTA de ${store.name}.`
                  )}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Solicitar mayoristas
                </a>
              ) : (
                <a
                  className="t-btn rounded-2xl border px-3 py-2 text-xs font-semibold sm:px-4 sm:text-sm"
                  style={{
                    borderColor: "var(--t-border)",
                    background: glassBg2,
                  }}
                  href={`/${store.slug}/detal`}
                >
                  Ver Detal
                </a>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ✅ Header principal (SIN buscador aquí) */}
      <header className="mx-auto max-w-6xl px-4 pt-6 sm:px-6">
        <div
          className="rounded-[28px] border p-5 t-glass"
          style={{
            borderColor: "var(--t-border)",
            background: glassBg,
          }}
        >
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="min-w-0">
              <h1 className="text-2xl font-black tracking-tight">{store.name}</h1>
              <p className="mt-1 text-sm" style={{ color: "var(--t-muted)" }}>
                {safeMode === "detal" ? "Compra al detal" : "Compra al por mayor"} · {shownProducts.length} productos
              </p>

              {profile?.headline ? <p className="mt-3 text-sm opacity-90">{profile.headline}</p> : null}

              {links.length ? (
                <div className="mt-4">
                  <SocialIconRow links={links} />
                </div>
              ) : null}
            </div>
          </div>
        </div>

        {/* Banner premium */}
        {store.banner_url ? (
          <div className="mt-5">
            <div className="relative overflow-hidden rounded-[28px] border" style={{ borderColor: "var(--t-border)" }}>
              <img
                src={store.banner_url}
                alt="Banner"
                className={cx("h-56 w-full object-cover sm:h-64 md:h-80", imgLoaded ? "opacity-100" : "opacity-0")}
                onLoad={() => setImgLoaded(true)}
              />

              <div
                className="pointer-events-none absolute inset-0"
                style={{
                  background:
                    "linear-gradient(180deg, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0.08) 55%, rgba(0,0,0,0.35) 100%)",
                }}
              />

              {!imgLoaded ? (
                <div
                  className="absolute inset-0 animate-pulse"
                  style={{
                    background: "linear-gradient(90deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02), rgba(255,255,255,0.06))",
                  }}
                />
              ) : null}

              <div className="absolute bottom-4 left-4 right-4">
                <div
                  className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold t-glass"
                  style={{
                    borderColor: "color-mix(in oklab, var(--t-border) 70%, transparent)",
                    background: "rgba(0,0,0,0.25)",
                    color: "rgba(255,255,255,0.95)",
                  }}
                >
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: accentChipBg }} />
                  {safeMode === "detal" ? "Compra rápida" : "Precios mayoristas"}
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </header>

      {/* BODY */}
      <section className="mx-auto max-w-6xl px-4 pb-10 pt-6 sm:px-6">
        {/* Categorías */}
        {categories.length > 0 ? (
          <div className="mt-2">
            <div className="flex items-end justify-between gap-3">
              <div>
                <h2 className="text-lg font-extrabold">Categorías</h2>
                <p className="mt-1 text-sm" style={{ color: "var(--t-muted)" }}>
                  Filtra para encontrar más rápido
                </p>
              </div>

              {selectedCat ? (
                <button
                  className="t-btn rounded-2xl border px-3 py-2 text-xs font-semibold sm:text-sm"
                  style={{ borderColor: "var(--t-border)", background: glassBg2 }}
                  onClick={() => setSelectedCat(null)}
                >
                  Ver todo
                </button>
              ) : null}
            </div>

            <div className="mt-3 flex gap-3 overflow-x-auto pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {categories.map((c) => {
                const active = selectedCat === c.id;
                return (
                  <button
                    key={c.id}
                    onClick={() => setSelectedCat(c.id)}
                    className={cx("t-btn shrink-0 rounded-2xl border p-2 text-left", active && "ring-2 ring-white/25")}
                    style={{
                      width: 150,
                      borderColor: "var(--t-border)",
                      background: glassBg,
                    }}
                  >
                    {c.image_url ? (
                      <img
                        src={c.image_url}
                        alt={c.name}
                        className="aspect-square w-full rounded-xl border object-cover"
                        style={{ borderColor: "var(--t-border)" }}
                        loading="lazy"
                      />
                    ) : (
                      <div
                        className="aspect-square w-full rounded-xl border"
                        style={{
                          borderColor: "var(--t-border)",
                          background: "rgba(255,255,255,0.05)",
                        }}
                      />
                    )}
                    <p className="mt-2 line-clamp-2 text-sm font-bold">{c.name}</p>
                  </button>
                );
              })}
            </div>

            {/* ✅ BUSCADOR DEBAJO DE CATEGORÍAS */}
            <div className="mt-4">
              <div
                className="rounded-2xl border p-3"
                style={{
                  borderColor: "var(--t-border)",
                  background: glassBg2,
                }}
              >
                <label className="text-xs font-semibold" style={{ color: "var(--t-muted)" }}>
                  Buscar producto
                </label>
                <input
                  className="t-ring mt-2 w-full rounded-xl border px-3 py-2 text-sm"
                  style={{
                    borderColor: "var(--t-border)",
                    background: "color-mix(in oklab, var(--t-bg) 70%, transparent)",
                    color: "var(--t-text)",
                  }}
                  placeholder="Ej: camiseta, bolso, perfume..."
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                />

                {q ? (
                  <button
                    type="button"
                    className="mt-2 text-xs underline opacity-80"
                    onClick={() => setQ("")}
                    style={{ color: "var(--t-muted)" }}
                  >
                    Limpiar búsqueda
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        ) : (
          // Si NO hay categorías, mostramos el buscador igualmente
          <div className="mt-2">
            <div
              className="rounded-2xl border p-3"
              style={{
                borderColor: "var(--t-border)",
                background: glassBg2,
              }}
            >
              <label className="text-xs font-semibold" style={{ color: "var(--t-muted)" }}>
                Buscar producto
              </label>
              <input
                className="t-ring mt-2 w-full rounded-xl border px-3 py-2 text-sm"
                style={{
                  borderColor: "var(--t-border)",
                  background: "color-mix(in oklab, var(--t-bg) 70%, transparent)",
                  color: "var(--t-text)",
                }}
                placeholder="Ej: camiseta, bolso, perfume..."
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />

              {q ? (
                <button
                  type="button"
                  className="mt-2 text-xs underline opacity-80"
                  onClick={() => setQ("")}
                  style={{ color: "var(--t-muted)" }}
                >
                  Limpiar búsqueda
                </button>
              ) : null}
            </div>
          </div>
        )}

        {/* Productos header */}
        <div className="mt-7 flex items-end justify-between gap-4">
          <div>
            <h2 className="text-xl font-extrabold">Productos</h2>
            <p className="mt-1 text-sm" style={{ color: "var(--t-muted)" }}>
              {shownProducts.length} disponibles
              {q ? ` · filtrados por “${q}”` : ""}
            </p>
          </div>

          <span
            className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold"
            style={{
              borderColor: "var(--t-border)",
              background: glassBg2,
            }}
          >
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: accentChipBg }} />
            {safeMode === "detal" ? "DETAL" : "MAYOR"}
          </span>
        </div>

        {/* Grid productos */}
        {shownProducts.length === 0 ? (
          <div className="mt-5 rounded-[28px] border p-6" style={{ borderColor: "var(--t-border)", background: glassBg }}>
            <p className="text-sm" style={{ color: "var(--t-muted)" }}>
              No hay productos con ese filtro.
            </p>
          </div>
        ) : (
          <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {shownProducts.map((p: any) => {
              const price = safeMode === "detal" ? p.price_retail : p.price_wholesale;

              return (
                <div
                  key={p.id}
                  className="t-card rounded-[28px] border p-4"
                  style={{
                    borderColor: "var(--t-border)",
                    background: glassBg,
                  }}
                >
                  {p.image_url ? (
                    <img
                      src={p.image_url}
                      alt={p.name}
                      loading="lazy"
                      className="mb-3 aspect-square w-full rounded-2xl border object-cover"
                      style={{ borderColor: "var(--t-border)" }}
                    />
                  ) : (
                    <div
                      className="mb-3 aspect-square w-full rounded-2xl border"
                      style={{ borderColor: "var(--t-border)", background: "rgba(255,255,255,0.05)" }}
                    />
                  )}

                  <div className="flex items-start justify-between gap-3">
                    <h3 className="font-extrabold leading-tight">{p.name}</h3>
                    <span className="rounded-full px-3 py-1 text-[11px] font-extrabold" style={{ background: accentChipBg, color: "#0b0b0b" }}>
                      {safeMode === "detal" ? "DETAL" : "MAYOR"}
                    </span>
                  </div>

                  {p.description ? (
                    <p className="mt-2 line-clamp-3 text-sm" style={{ color: "var(--t-muted)" }}>
                      {p.description}
                    </p>
                  ) : null}

                  <div className="mt-4 flex items-end justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold" style={{ color: "var(--t-muted)" }}>
                        Precio
                      </p>
                      <p className="text-lg font-black">{money(price)}</p>
                      {safeMode === "mayor" && p.min_wholesale ? (
                        <p className="text-xs" style={{ color: "var(--t-muted)" }}>
                          Mínimo: <b>{p.min_wholesale}</b>
                        </p>
                      ) : null}
                    </div>

                    <button
                      className="t-btn rounded-2xl px-4 py-2 text-sm font-extrabold"
                      style={{
                        background: "var(--t-cta)",
                        color: "#0b0b0b",
                        boxShadow: "0 18px 48px rgba(0,0,0,0.22)",
                      }}
                      onClick={() => addToCartWithQty(p, Number(price ?? 0))}
                    >
                      Agregar
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* FOOTER */}
        <div className="mt-10">
          <footer className="border-t pt-6" style={{ borderColor: "var(--t-border)" }}>
            <div className="text-sm" style={{ color: "var(--t-muted)" }}>
              {profile?.address || profile?.city ? (
                <p>
                  {profile?.address ? profile.address + " · " : ""}
                  {profile?.city ?? ""}
                </p>
              ) : (
                <p>Catálogo generado por la tienda.</p>
              )}
            </div>
          </footer>
        </div>
      </section>

      {/* Toast msg */}
      {msg ? (
        <div className="fixed bottom-4 left-4 right-4 z-50 mx-auto max-w-md">
          <div
            className="rounded-2xl border px-4 py-3 text-sm t-glass"
            style={{
              borderColor: "var(--t-border)",
              background: "rgba(0,0,0,0.55)",
              color: "rgba(255,255,255,0.92)",
              boxShadow: "0 20px 60px rgba(0,0,0,0.45)",
            }}
          >
            {msg}
          </div>
        </div>
      ) : null}

      <CartDrawer />
    </main>
  );
}
