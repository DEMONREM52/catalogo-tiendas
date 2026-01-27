"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Swal from "sweetalert2";

import { supabaseBrowser } from "@/lib/supabase/client";
import { SocialIconRow } from "./socials";
import { useCart } from "@/lib/cart/CartProvider";
import { CartDrawer } from "@/lib/cart/CartDrawer";

import { applyThemeToRoot, type ThemeConfig } from "@/lib/themes/applyTheme";

/* =========================
   Types
========================= */
type Mode = "detal" | "mayor";

type StoreRow = {
  id: string;
  name: string;
  slug: string;
  whatsapp: string;
  active: boolean;
  catalog_retail: boolean;
  catalog_wholesale: boolean;
  theme: string | null; // FK -> themes.id (text)
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

function pickStr(v: any) {
  const s = typeof v === "string" ? v.trim() : "";
  return s || undefined;
}

function asNum(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function isHexOrRgbaLike(s?: string) {
  if (!s) return false;
  const t = s.trim();
  if (!t) return false;
  // #rgb / #rrggbb / #rrggbbaa
  if (/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(t)) return true;
  // rgba(...) / rgb(...) / hsl(...)
  if (/^(rgb|rgba|hsl|hsla)\(/i.test(t)) return true;
  return false;
}

/* =========================
   Map DB theme.config -> ThemeConfig (applyThemeToRoot)
   DB config soportado (por tu schema + seeds):
   - bg (puede ser hex/rgba o puede ser un gradient string)
   - card, card_border, text, muted, accent, accent2
   - cta (solid) OR ctaA/ctaB (+ optional ctaAngle)
   - bgGradA/bgGradB/bgAngle (si lo manejas)
========================= */
function mapDbThemeToApplyTheme(dbCfg: any): ThemeConfig | undefined {
  if (!dbCfg || typeof dbCfg !== "object") return undefined;

  // Colors / tokens
  const bg = pickStr(dbCfg.bg);
  const card = pickStr(dbCfg.card);
  const cardBorder = pickStr(dbCfg.card_border);
  const text = pickStr(dbCfg.text);
  const muted = pickStr(dbCfg.muted);
  const accent = pickStr(dbCfg.accent);
  const accent2 = pickStr(dbCfg.accent2);

  // Background advanced (optional)
  const bgGradA = pickStr(dbCfg.bgGradA ?? dbCfg.bg_grad_a);
  const bgGradB = pickStr(dbCfg.bgGradB ?? dbCfg.bg_grad_b);
  const bgAngle = asNum(dbCfg.bgAngle ?? dbCfg.bg_angle);

  // CTA
  const cta = pickStr(dbCfg.cta);
  const ctaA = pickStr(dbCfg.ctaA ?? dbCfg.cta_a);
  const ctaB = pickStr(dbCfg.ctaB ?? dbCfg.cta_b);
  const ctaAngle = asNum(dbCfg.ctaAngle ?? dbCfg.cta_angle);

  const cfg: ThemeConfig = {};

  // ---- BG ----
  // Si bg viene como color => solid
  // Si bg viene como "linear-gradient(...)" => lo tratamos como gradient:
  //   (no podemos meter raw string en applyThemeToRoot, pero sí usando el fix de --t-bg en runtime)
  // Mejor: si tienes bgGradA/bgGradB úsalo como gradient real.
  if (bg) {
    if (isHexOrRgbaLike(bg)) {
      cfg.bgMode = "solid";
      cfg.bgSolid = bg;
    } else if (/gradient\(/i.test(bg)) {
      // si guardaste el string de gradient en dbCfg.bg, lo manejamos luego con el fix runtime
      // pero también setea modo gradient para que existan tokens consistentes
      cfg.bgMode = "gradient";
      // intenta extraer A/B si existen; si no, dejamos defaults del helper y luego fijamos --t-bg manual
      if (bgGradA) cfg.bgGradA = bgGradA;
      if (bgGradB) cfg.bgGradB = bgGradB;
      if (bgAngle != null) cfg.bgAngle = bgAngle;
      // nota: el raw gradient lo aplicaremos como --t-bg en runtime si hace falta
      (cfg as any).__rawBg = bg;
    }
  } else if (bgGradA || bgGradB) {
    cfg.bgMode = "gradient";
    if (bgGradA) cfg.bgGradA = bgGradA;
    if (bgGradB) cfg.bgGradB = bgGradB;
    if (bgAngle != null) cfg.bgAngle = bgAngle;
  }

  // ---- Text / borders ----
  if (text) cfg.text = text;
  if (muted) cfg.mutedText = muted;

  // tu UI usa var(--t-border) para bordes generales,
  // y cardBorder para cards. Si viene card_border, lo usamos en ambos.
  if (cardBorder) {
    cfg.border = cardBorder;
    cfg.cardBorder = cardBorder;
  }

  // ---- Cards ----
  if (card) cfg.cardBg = card;

  // ---- Accents ----
  if (accent) cfg.accent = accent;
  if (accent2) cfg.accent2 = accent2;

  // ---- CTA ----
  if (cta) {
    cfg.ctaMode = "solid";
    cfg.ctaSolid = cta;
  } else if (ctaA || ctaB) {
    cfg.ctaMode = "gradient";
    if (ctaA) cfg.ctaA = ctaA;
    if (ctaB) cfg.ctaB = ctaB;
    if (ctaAngle != null) cfg.ctaAngle = ctaAngle;
  } else if (accent2 || accent) {
    cfg.ctaMode = "solid";
    cfg.ctaSolid = accent2 ?? accent!;
  }

  return cfg;
}

/* =========================
   IMPORTANT FIX for your globals.css
   globals.css uses:
   body { background: var(--t-bg-base); background-image: var(--t-bg); }

   - If theme is SOLID => set --t-bg-base = color and --t-bg = none
   - If theme is GRADIENT => set --t-bg-base = dark base and --t-bg = gradient
========================= */
function syncGlobalBodyBackground(cfg?: ThemeConfig) {
  if (typeof document === "undefined") return;

  const r = document.documentElement;

  const isSolid = cfg?.bgMode === "solid" && !!cfg?.bgSolid;

  if (isSolid) {
    r.style.setProperty("--t-bg-base", cfg!.bgSolid!);
    // background-image necesita "none" (color NO vale)
    r.style.setProperty("--t-bg", "none");
    return;
  }

  // gradient mode
  r.style.setProperty("--t-bg-base", "#070014");

  // Si tu theme venía con bg string raw (linear-gradient...) lo ponemos directo
  const raw = (cfg as any)?.__rawBg as string | undefined;
  if (raw && /gradient\(/i.test(raw)) {
    r.style.setProperty("--t-bg", raw);
  }
  // si no hay raw, applyThemeToRoot ya setea --t-bg con gradient(...)
}

/* =========================
   Page
========================= */
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

  const [q, setQ] = useState("");
  const [imgLoaded, setImgLoaded] = useState(false);

  const { initCart, addItem } = useCart();

  const safeMode: Mode = useMemo(() => (isValidMode(mode) ? mode : "detal"), [mode]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setMsg(null);
      setLoading(true);

      try {
        const sb = supabaseBrowser();

        if (!slug || !isValidMode(mode)) {
          if (!cancelled) setMsg("❌ Ruta inválida.");
          return;
        }

        // 1) store
        const { data: storeData, error: storeErr } = await sb
          .from("stores")
          .select(
            "id,name,slug,whatsapp,active,catalog_retail,catalog_wholesale,theme,logo_url,banner_url,wholesale_key"
          )
          .eq("slug", slug)
          .maybeSingle();

        if (storeErr || !storeData) {
          if (!cancelled) setMsg("❌ Tienda no encontrada.");
          return;
        }

        const st = storeData as StoreRow;

        // mayorista key
        if (safeMode === "mayor") {
          if (!st.wholesale_key) {
            if (!cancelled) setMsg("❌ Este catálogo mayorista no está disponible.");
            return;
          }
          if (key !== st.wholesale_key) {
            if (!cancelled) setMsg("🔒 Catálogo mayorista privado. Solicita acceso por WhatsApp.");
            return;
          }
        }

        if (!st.active) {
          if (!cancelled) setMsg("❌ Esta tienda está desactivada.");
          return;
        }

        if (safeMode === "detal" && !st.catalog_retail) {
          if (!cancelled) setMsg("❌ Catálogo detal no disponible.");
          return;
        }

        if (safeMode === "mayor" && !st.catalog_wholesale) {
          if (!cancelled) setMsg("❌ Catálogo mayor no disponible.");
          return;
        }

        if (!cancelled) setStore(st);

        // 2) theme
        const themeId = st.theme?.trim() || null;
        let cfg: ThemeConfig | undefined;

        if (themeId) {
          const { data: themeRow } = await sb
            .from("themes")
            .select("id,active,config")
            .eq("id", themeId)
            .maybeSingle();

          cfg = mapDbThemeToApplyTheme(themeRow?.config);
        }

        if (!cfg) {
          const { data: fallback } = await sb
            .from("themes")
            .select("id,config")
            .eq("active", true)
            .order("sort_order", { ascending: true })
            .limit(1)
            .maybeSingle();

          cfg = mapDbThemeToApplyTheme(fallback?.config);
        }

        // apply vars + sync global background system
        applyThemeToRoot(cfg);
        syncGlobalBodyBackground(cfg);

        // init cart
        initCart({
          storeId: st.id,
          storeSlug: st.slug,
          storeName: st.name,
          whatsapp: st.whatsapp,
          mode: safeMode,
        });

        // 3) profile
        const { data: profData } = await sb
          .from("store_profiles")
          .select("*")
          .eq("store_id", st.id)
          .maybeSingle();
        if (!cancelled) setProfile(profData ?? null);

        // 4) links
        const { data: linksData } = await sb
          .from("store_links")
          .select("id,type,label,url,active,sort_order,icon_url")
          .eq("store_id", st.id)
          .eq("active", true)
          .order("sort_order", { ascending: true });
        if (!cancelled) setLinks(linksData ?? []);

        // 5) categories
        const { data: catData } = await sb
          .from("product_categories")
          .select("id,name,image_url,sort_order")
          .eq("store_id", st.id)
          .eq("active", true)
          .order("sort_order", { ascending: true });
        if (!cancelled) setCategories(catData ?? []);

        // 6) products
        const { data: prodData } = await sb
          .from("products")
          .select(
            "id,name,description,price_retail,price_wholesale,min_wholesale,active,image_url,category_id"
          )
          .eq("store_id", st.id)
          .eq("active", true)
          .order("name", { ascending: true });
        if (!cancelled) setProducts(prodData ?? []);
      } catch (err: any) {
        if (!cancelled) setMsg(err?.message ?? "Error cargando catálogo.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [slug, mode, key, initCart, safeMode]);

  // tab title + favicon
  useEffect(() => {
    if (!store?.name) return;

    document.title = `${store.name} - Catálogos online`;

    const favicon =
      (document.querySelector("link[rel~='icon']") as HTMLLinkElement | null) ||
      (document.createElement("link") as HTMLLinkElement);

    favicon.rel = "icon";
    favicon.href = store.logo_url ? `${store.logo_url}?v=${Date.now()}` : "/favicon.ico";
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

  const shownProductsBase = selectedCat
    ? products.filter((p) => p.category_id === selectedCat)
    : products;

  const shownProducts = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return shownProductsBase;
    return shownProductsBase.filter((p: any) => {
      const a = String(p?.name ?? "").toLowerCase();
      const b = String(p?.description ?? "").toLowerCase();
      return a.includes(s) || b.includes(s);
    });
  }, [shownProductsBase, q]);

  /* =========================
     Render
  ========================= */
  if (loading) {
    return (
      <main className="p-6" style={{ background: "var(--t-bg-base)", color: "var(--t-text)" }}>
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
      <main className="p-6" style={{ background: "var(--t-bg-base)", color: "var(--t-text)" }}>
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
    <main className="min-h-screen" style={{ background: "var(--t-bg-base)", color: "var(--t-text)" }}>
      {/* overlay SOLO si hay gradient (si solid, --t-bg = none por syncGlobalBodyBackground) */}
      <div className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute inset-0" style={{ background: "var(--t-bg-base)" }} />
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: "var(--t-bg)",
            opacity: 0.22,
          }}
        />
      </div>

      {/* helpers */}
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

      {/* Topbar */}
      <div
        className="sticky top-0 z-40 border-b t-glass"
        style={{ borderColor: "var(--t-border)", background: glassBg }}
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
                style={{ borderColor: "var(--t-border)", background: glassBg2 }}
              >
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: accentChipBg }} />
                {safeMode === "detal" ? "DETAL" : "MAYOR"}
              </span>

              {safeMode === "detal" ? (
                <a
                  className="t-btn rounded-2xl border px-3 py-2 text-xs font-semibold sm:px-4 sm:text-sm"
                  style={{ borderColor: "var(--t-border)", background: glassBg2 }}
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
                  style={{ borderColor: "var(--t-border)", background: glassBg2 }}
                  href={`/${store.slug}/detal`}
                >
                  Ver Detal
                </a>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Header */}
      <header className="mx-auto max-w-6xl px-4 pt-6 sm:px-6">
        <div
          className="rounded-[28px] border p-5 t-glass"
          style={{ borderColor: "var(--t-border)", background: glassBg }}
        >
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

        {/* Banner */}
        {store.banner_url ? (
          <div className="mt-5">
            <div className="relative overflow-hidden rounded-[28px] border" style={{ borderColor: "var(--t-border)" }}>
              <img
                src={store.banner_url}
                alt="Banner"
                className={cx("h-56 w-full object-cover sm:h-64 md:h-80", imgLoaded ? "opacity-100" : "opacity-0")}
                onLoad={() => setImgLoaded(true)}
              />

              {!imgLoaded ? (
                <div
                  className="absolute inset-0 animate-pulse"
                  style={{
                    background:
                      "linear-gradient(90deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02), rgba(255,255,255,0.06))",
                  }}
                />
              ) : null}
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
                    style={{ width: 150, borderColor: "var(--t-border)", background: glassBg }}
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
                      <div className="aspect-square w-full rounded-xl border" style={{ borderColor: "var(--t-border)" }} />
                    )}
                    <p className="mt-2 line-clamp-2 text-sm font-bold">{c.name}</p>
                  </button>
                );
              })}
            </div>

            {/* Buscador */}
            <div className="mt-4 rounded-2xl border p-3" style={{ borderColor: "var(--t-border)", background: glassBg2 }}>
              <label className="text-xs font-semibold" style={{ color: "var(--t-muted)" }}>
                Buscar producto
              </label>
              <input
                className="t-ring mt-2 w-full rounded-xl border px-3 py-2 text-sm"
                style={{
                  borderColor: "var(--t-border)",
                  background: "color-mix(in oklab, var(--t-bg-base) 70%, transparent)",
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
        ) : (
          // si no hay categorías, igual mostrar buscador
          <div className="mt-2 rounded-2xl border p-3" style={{ borderColor: "var(--t-border)", background: glassBg2 }}>
            <label className="text-xs font-semibold" style={{ color: "var(--t-muted)" }}>
              Buscar producto
            </label>
            <input
              className="t-ring mt-2 w-full rounded-xl border px-3 py-2 text-sm"
              style={{
                borderColor: "var(--t-border)",
                background: "color-mix(in oklab, var(--t-bg-base) 70%, transparent)",
                color: "var(--t-text)",
              }}
              placeholder="Ej: camiseta, bolso, perfume..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
        )}

        {/* Productos */}
        <div className="mt-7 flex items-end justify-between gap-4">
          <div>
            <h2 className="text-xl font-extrabold">Productos</h2>
            <p className="mt-1 text-sm" style={{ color: "var(--t-muted)" }}>
              {shownProducts.length} disponibles{q ? ` · filtrados por “${q}”` : ""}
            </p>
          </div>

          <span
            className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold"
            style={{ borderColor: "var(--t-border)", background: glassBg2 }}
          >
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: accentChipBg }} />
            {safeMode === "detal" ? "DETAL" : "MAYOR"}
          </span>
        </div>

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
                <div key={p.id} className="t-card rounded-[28px] border p-4" style={{ borderColor: "var(--t-border)", background: glassBg }}>
                  {p.image_url ? (
                    <img
                      src={p.image_url}
                      alt={p.name}
                      loading="lazy"
                      className="mb-3 aspect-square w-full rounded-2xl border object-cover"
                      style={{ borderColor: "var(--t-border)" }}
                    />
                  ) : (
                    <div className="mb-3 aspect-square w-full rounded-2xl border" style={{ borderColor: "var(--t-border)" }} />
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

        {/* Footer */}
        <div className="mt-10 border-t pt-6" style={{ borderColor: "var(--t-border)" }}>
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
        </div>
      </section>

      {/* Toast */}
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
