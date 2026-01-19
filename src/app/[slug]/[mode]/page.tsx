"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Swal from "sweetalert2";

import { supabaseBrowser } from "@/lib/supabase/client";
import { SocialIconRow } from "./socials";
import { useCart } from "@/lib/cart/CartProvider";
import { CartDrawer } from "@/lib/cart/CartDrawer";

type Mode = "detal" | "mayor";

const THEME_VARS: Record<
  string,
  { brand: string; brand2: string; bg: string; card: string; text: string }
> = {
  ocean: {
    brand: "#3b82f6",
    brand2: "#06b6d4",
    bg: "#060a12",
    card: "#0b1220",
    text: "#e5e7eb",
  },
  forest: {
    brand: "#22c55e",
    brand2: "#84cc16",
    bg: "#050f0a",
    card: "#0a1a12",
    text: "#e5e7eb",
  },
  sunset: {
    brand: "#f97316",
    brand2: "#ef4444",
    bg: "#120805",
    card: "#1c0f0b",
    text: "#f3f4f6",
  },
  rose: {
    brand: "#ec4899",
    brand2: "#fb7185",
    bg: "#12060c",
    card: "#1b0b14",
    text: "#f3f4f6",
  },
  midnight: {
    brand: "#a78bfa",
    brand2: "#60a5fa",
    bg: "#050510",
    card: "#0b0b1a",
    text: "#e5e7eb",
  },
  lavender: {
    brand: "#a78bfa",
    brand2: "#f472b6",
    bg: "#0b0612",
    card: "#120b1d",
    text: "#f3f4f6",
  },
  mono: {
    brand: "#ffffff",
    brand2: "#a3a3a3",
    bg: "#050505",
    card: "#0d0d0d",
    text: "#f5f5f5",
  },
  gold: {
    brand: "#f59e0b",
    brand2: "#fde047",
    bg: "#120b05",
    card: "#1b1208",
    text: "#f3f4f6",
  },
};

function cssVars(theme: string) {
  const t = THEME_VARS[theme] ?? THEME_VARS.ocean;
  return {
    ["--brand" as any]: t.brand,
    ["--brand2" as any]: t.brand2,
    ["--bg" as any]: t.bg,
    ["--card" as any]: t.card,
    ["--text" as any]: t.text,
  };
}

export default function StoreCatalogPage() {
  const params = useParams<{ slug: string; mode: string }>();
  const searchParams = useSearchParams();

  const slug = params?.slug as string;
  const mode = (params?.mode as Mode) ?? "detal";
  const key = searchParams.get("key");

  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  const [store, setStore] = useState<any>(null);
  const [profile, setProfile] = useState<any>(null);
  const [links, setLinks] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);

  const [categories, setCategories] = useState<any[]>([]);
  const [selectedCat, setSelectedCat] = useState<string | null>(null);

  const theme = useMemo(() => store?.theme ?? "ocean", [store?.theme]);

  // ✅ ya NO traemos open, porque no queremos abrir el carrito al agregar
  const { initCart, addItem } = useCart();

  useEffect(() => {
    (async () => {
      setMsg(null);
      setLoading(true);

      if (!slug || !mode || (mode !== "detal" && mode !== "mayor")) {
        setMsg("❌ Ruta inválida.");
        setLoading(false);
        return;
      }

      // 1) Tienda
      const { data: storeData, error: storeErr } = await supabaseBrowser
        .from("stores")
        .select(
          "id,name,slug,whatsapp,active,catalog_retail,catalog_wholesale,theme,logo_url,banner_url,wholesale_key",
        )
        .eq("slug", slug)
        .maybeSingle();

      if (storeErr || !storeData) {
        setMsg("❌ Tienda no encontrada.");
        setLoading(false);
        return;
      }

      // Acceso mayorista por key
      if (mode === "mayor") {
        if (!storeData.wholesale_key) {
          setMsg("❌ Este catálogo mayorista no está disponible.");
          setLoading(false);
          return;
        }
        if (key !== storeData.wholesale_key) {
          setMsg(
            "🔒 Catálogo mayorista privado. Solicita acceso por WhatsApp.",
          );
          setLoading(false);
          return;
        }
      }

      if (!storeData.active) {
        setMsg("❌ Esta tienda está desactivada.");
        setLoading(false);
        return;
      }

      if (mode === "detal" && !storeData.catalog_retail) {
        setMsg("❌ Catálogo detal no disponible.");
        setLoading(false);
        return;
      }

      if (mode === "mayor" && !storeData.catalog_wholesale) {
        setMsg("❌ Catálogo mayor no disponible.");
        setLoading(false);
        return;
      }

      setStore(storeData);

      // Inicializa carrito (localStorage)
      initCart({
        storeId: storeData.id,
        storeSlug: storeData.slug,
        storeName: storeData.name,
        whatsapp: storeData.whatsapp,
        mode,
      });

      // 2) Perfil
      const { data: profData } = await supabaseBrowser
        .from("store_profiles")
        .select("*")
        .eq("store_id", storeData.id)
        .maybeSingle();
      setProfile(profData ?? null);

      // 3) Redes
      const { data: linksData } = await supabaseBrowser
        .from("store_links")
        .select("id,type,label,url,active,sort_order,icon_url")
        .eq("store_id", storeData.id)
        .eq("active", true)
        .order("sort_order", { ascending: true });
      setLinks(linksData ?? []);

      // 4) Categorías
      const { data: catData } = await supabaseBrowser
        .from("product_categories")
        .select("id,name,image_url,sort_order")
        .eq("store_id", storeData.id)
        .eq("active", true)
        .order("sort_order", { ascending: true });
      setCategories(catData ?? []);

      // 5) Productos
      const { data: prodData } = await supabaseBrowser
        .from("products")
        .select(
          "id,name,description,price_retail,price_wholesale,min_wholesale,active,image_url,category_id",
        )
        .eq("store_id", storeData.id)
        .eq("active", true)
        .order("name", { ascending: true });
      setProducts(prodData ?? []);

      setLoading(false);
    })();
  }, [slug, mode, key, initCart]);

  async function addToCartWithQty(p: any, price: number) {
    const min = mode === "mayor" ? Number(p.min_wholesale ?? 1) : 1;

    const res = await Swal.fire({
      title: "Agregar al carrito",
      html: `
        <div style="text-align:left; opacity:.9">
          <div style="font-weight:600; margin-bottom:6px;">${p.name}</div>
          <div style="opacity:.8; margin-bottom:10px;">
            Precio: $${Number(price ?? 0).toLocaleString("es-CO")}
          </div>
          <label style="font-size:12px; opacity:.8;">Cantidad</label>
          <input id="qty" type="number" class="swal2-input" value="${min}" min="${min}" style="margin-top:6px;" />
          ${
            mode === "mayor"
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

    // ✅ NO abre el carrito
    addItem(
      {
        productId: p.id,
        name: p.name,
        price: Number(price ?? 0),
        qty,
        minWholesale: p.min_wholesale ?? null,
      },
      { openDrawer: false },
    );

    await Swal.fire({
      icon: "success",
      title: "Agregado",
      text: `Se agregó ${qty} × ${p.name} al carrito.`,
      timer: 1100,
      showConfirmButton: false,
      background: "#0b0b0b",
      color: "#fff",
    });
  }

  const shownProducts = selectedCat
    ? products.filter((p) => p.category_id === selectedCat)
    : products;

  if (loading) {
    return (
      <main className="p-6">
        <p>Cargando catálogo...</p>
      </main>
    );
  }

  if (!store) {
    return (
      <main className="p-6">
        <p>{msg ?? "No se pudo cargar."}</p>
      </main>
    );
  }

  return (
    <main style={cssVars(theme)} className="min-h-screen">
      <div
        className="min-h-screen"
        style={{ background: "var(--bg)", color: "var(--text)" }}
      >
        {/* HEADER */}
        <header className="border-b border-white/10">
          <div className="mx-auto max-w-6xl p-6">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div className="flex items-center gap-4">
                {store.logo_url ? (
                  <img
                    src={store.logo_url}
                    alt={store.name}
                    className="h-14 w-14 rounded-2xl border border-white/10 object-cover"
                  />
                ) : (
                  <div className="h-14 w-14 rounded-2xl border border-white/10" />
                )}

                <div>
                  <h1 className="text-2xl font-bold">{store.name}</h1>
                  <p className="text-sm opacity-80">
                    Catálogo {mode === "detal" ? "Detal" : "Mayoristas"}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {mode === "detal" ? (
                  <a
                    className="rounded-xl border border-white/10 px-4 py-2"
                    href={`https://wa.me/${store.whatsapp}?text=${encodeURIComponent(
                      `Hola! Quiero acceso al catálogo MAYORISTA de ${store.name}.`,
                    )}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Solicitar mayoristas
                  </a>
                ) : (
                  <a
                    className="rounded-xl border border-white/10 px-4 py-2"
                    href={`/${store.slug}/detal`}
                  >
                    Ver Detal
                  </a>
                )}
              </div>
            </div>

            {profile?.headline ? (
              <p className="mt-4 text-sm opacity-90">{profile.headline}</p>
            ) : null}

            {links.length ? (
              <div className="mt-4">
                <SocialIconRow links={links} />
              </div>
            ) : null}
          </div>

          {store.banner_url ? (
            <div className="mx-auto max-w-6xl px-6 pb-6">
              <img
                src={store.banner_url}
                alt="Banner"
                className="h-44 w-full rounded-2xl border border-white/10 object-cover"
              />
            </div>
          ) : null}
        </header>

        {/* BODY */}
        <section className="mx-auto max-w-6xl p-6">
          <div className="flex items-end justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold">Productos</h2>
              <p className="mt-1 text-sm opacity-80">
                {shownProducts.length} disponibles
              </p>
            </div>
          </div>

          {/* CATEGORÍAS */}
          {categories.length > 0 && (
            <div className="mt-6">
              <div className="flex items-end justify-between">
                <h3 className="text-lg font-semibold">Categorías</h3>
                {selectedCat && (
                  <button
                    className="rounded-xl border border-white/10 px-3 py-1 text-sm"
                    onClick={() => setSelectedCat(null)}
                  >
                    Ver todo
                  </button>
                )}
              </div>

              <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                {categories.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setSelectedCat(c.id)}
                    className={`rounded-2xl border border-white/10 p-2 text-left ${
                      selectedCat === c.id ? "ring-2 ring-white/30" : ""
                    }`}
                    style={{ background: "var(--card)" }}
                  >
                    {c.image_url ? (
                      <img
                        src={c.image_url}
                        alt={c.name}
                        className="aspect-square w-full rounded-xl border border-white/10 object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div className="aspect-square w-full rounded-xl border border-white/10 bg-white/5" />
                    )}
                    <p className="mt-2 text-sm font-semibold line-clamp-2">
                      {c.name}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* PRODUCTOS */}
          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {shownProducts.map((p: any) => {
              const price =
                mode === "detal" ? p.price_retail : p.price_wholesale;

              return (
                <div
                  key={p.id}
                  className="rounded-2xl border border-white/10 p-4"
                  style={{ background: "var(--card)" }}
                >
                  {p.image_url ? (
                    <img
                      src={p.image_url}
                      alt={p.name}
                      loading="lazy"
                      className="mb-3 aspect-square w-full rounded-xl border border-white/10 object-cover"
                    />
                  ) : (
                    <div className="mb-3 aspect-square w-full rounded-xl border border-white/10 bg-white/5" />
                  )}

                  <div className="flex items-start justify-between gap-3">
                    <h3 className="font-semibold leading-tight">{p.name}</h3>
                    <span
                      className="rounded-full px-3 py-1 text-xs font-semibold"
                      style={{ background: "var(--brand2)", color: "#0b0b0b" }}
                    >
                      {mode === "detal" ? "DETAL" : "MAYOR"}
                    </span>
                  </div>

                  {p.description ? (
                    <p className="mt-2 text-sm opacity-80 line-clamp-3">
                      {p.description}
                    </p>
                  ) : null}

                  <div className="mt-4 flex items-end justify-between">
                    <div>
                      <p className="text-xs opacity-70">Precio</p>
                      <p className="text-lg font-bold">
                        ${Number(price ?? 0).toLocaleString("es-CO")}
                      </p>
                      {mode === "mayor" && p.min_wholesale ? (
                        <p className="text-xs opacity-70">
                          Mínimo: {p.min_wholesale}
                        </p>
                      ) : null}
                    </div>

                    <button
                      className="rounded-xl px-4 py-2 font-semibold"
                      style={{ background: "var(--brand)", color: "#0b0b0b" }}
                      onClick={() => addToCartWithQty(p, Number(price ?? 0))}
                    >
                      Agregar
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* FOOTER */}
        <footer className="border-t border-white/10">
          <div className="mx-auto max-w-6xl p-6 text-sm opacity-70">
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

        {msg && (
          <div className="fixed bottom-4 left-4 rounded-xl border border-white/10 bg-black/60 px-4 py-2 text-sm">
            {msg}
          </div>
        )}
      </div>

      {/* Carrito */}
      <CartDrawer />
    </main>
  );
}
