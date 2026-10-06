"use client";

/* eslint-disable @next/next/no-img-element */
import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { ExternalLink, LayoutGrid, Loader2, Lock, MapPin, Star } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { MoneyInput } from "@/app/dashboard/MoneyInput";
import { catalogPrice, PRICE_LEVELS, type PriceLevel } from "@/lib/catalogs";

type CatalogLite = {
  id: string;
  slug: string;
  name: string;
  logo_url: string | null;
  price_level: PriceLevel;
  fallback_price_level: PriceLevel | null;
  include_all_products: boolean;
  access_key: string | null;
  point_id: string | null;
  active: boolean;
};

type Row = { catalog_id: string; included: boolean; price_override: number | null; featured: boolean };

type Prices = { price_1: number; price_2: number; price_3: number; price_4: number; price_5: number };

/** Catálogos en los que aparece este producto, con su precio en cada uno. */
export default function ProductCatalogsPanel({ storeId, productId, prices }: { storeId: string; productId: string; prices: Prices }) {
  const [catalogs, setCatalogs] = useState<CatalogLite[] | null>(null);
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [points, setPoints] = useState<Record<string, { name: string; qty: number }> | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    const sb = supabaseBrowser();
    void Promise.all([
      sb.from("store_catalogs").select("id,slug,name,logo_url,price_level,fallback_price_level,include_all_products,access_key,point_id,active").eq("store_id", storeId).order("sort_order"),
      sb.from("store_catalog_products").select("catalog_id,included,price_override,featured").eq("product_id", productId),
      sb.from("erp_warehouses").select("id,name").eq("store_id", storeId),
      sb.from("erp_stock_levels").select("warehouse_id,qty").eq("store_id", storeId).eq("product_id", productId),
      sb.rpc("erp_my_point", { p_store: storeId }),
    ]).then(([catalogsRes, rowsRes, warehousesRes, levelsRes, myPointRes]) => {
      if (!alive) return;
      if (catalogsRes.error) {
        setCatalogs([]);
        return;
      }
      setCatalogs((catalogsRes.data ?? []) as CatalogLite[]);
      const map: Record<string, Row> = {};
      for (const row of (rowsRes.data ?? []) as Row[]) map[row.catalog_id] = row;
      setRows(map);
      if (!warehousesRes.error && !levelsRes.error) {
        // Un usuario de punto solo puede leer las existencias de su propio punto.
        const myPoint = (myPointRes.data as string | null) ?? null;
        const qty = new Map(((levelsRes.data ?? []) as Array<{ warehouse_id: string; qty: number }>).map((l) => [l.warehouse_id, Number(l.qty)]));
        const byPoint: Record<string, { name: string; qty: number }> = {};
        for (const w of (warehousesRes.data ?? []) as Array<{ id: string; name: string }>) {
          if (myPoint && w.id !== myPoint) continue;
          byPoint[w.id] = { name: w.name, qty: Math.max(0, qty.get(w.id) ?? 0) };
        }
        setPoints(byPoint);
      }
    });
    return () => {
      alive = false;
    };
  }, [storeId, productId]);

  function rowFor(catalog: CatalogLite): Row {
    return rows[catalog.id] ?? { catalog_id: catalog.id, included: catalog.include_all_products, price_override: null, featured: false };
  }

  async function persist(catalog: CatalogLite, change: Partial<Row>) {
    const next = { ...rowFor(catalog), ...change };
    setRows((current) => ({ ...current, [catalog.id]: next }));
    setSavingId(catalog.id);
    setError("");
    const { error: upsertError } = await supabaseBrowser().from("store_catalog_products").upsert(
      {
        catalog_id: catalog.id,
        product_id: productId,
        store_id: storeId,
        included: next.included,
        price_override: next.price_override,
        featured: next.featured,
      },
      { onConflict: "catalog_id,product_id" },
    );
    setSavingId(null);
    if (upsertError) setError(upsertError.message);
  }

  if (catalogs === null) {
    return <div className="h-24 animate-pulse rounded-[28px]" style={{ background: "var(--t-card-bg-soft)" }} />;
  }
  if (catalogs.length === 0) return null;

  return (
    <section className="rounded-[28px] border p-5 sm:p-6" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)", color: "var(--t-text)" }}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold"><LayoutGrid size={18} /> Catálogos donde aparece</h2>
          <p className="mt-1 text-sm" style={{ color: "var(--t-muted)" }}>
            Actívalo o quítalo de cada catálogo y, si quieres, ponle un precio especial solo para ese catálogo. Se guarda al instante.
          </p>
        </div>
        <Link href="/dashboard/social" className="inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold" style={{ borderColor: "var(--t-card-border)" }}>
          Administrar catálogos <ExternalLink size={13} />
        </Link>
      </div>
      {error ? <p className="mt-3 rounded-xl border p-2.5 text-sm" style={{ borderColor: "#ef4444" }}>{error}</p> : null}
      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {catalogs.map((catalog) => {
          const row = rowFor(catalog);
          const price = catalogPrice(prices, catalog, row.price_override);
          const level = PRICE_LEVELS.find((p) => p.level === catalog.price_level);
          const point = catalog.point_id && points ? points[catalog.point_id] : undefined;
          return (
            <motion.div
              key={catalog.id}
              layout
              className="rounded-2xl border p-3"
              style={{
                borderColor: row.included ? "color-mix(in oklab, var(--t-accent) 45%, var(--t-card-border))" : "var(--t-card-border)",
                background: "color-mix(in oklab, var(--t-card-bg) 94%, transparent)",
                opacity: catalog.active ? 1 : 0.65,
              }}
            >
              <div className="flex items-center gap-3">
                {catalog.logo_url ? (
                  <img src={catalog.logo_url} alt="" className="h-10 w-10 rounded-xl object-cover" />
                ) : (
                  <span className="grid h-10 w-10 place-items-center rounded-xl text-lg" style={{ background: "var(--t-card-bg-soft)" }}>🛍️</span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 truncate text-sm font-bold">
                    {catalog.name}
                    {catalog.access_key ? <Lock size={12} /> : null}
                    {catalog.point_id ? <MapPin size={12} /> : null}
                  </p>
                  <p className="text-[11px]" style={{ color: "var(--t-muted)" }}>{level?.label} · {level?.hint}{catalog.active ? "" : " · pausado"}</p>
                  {point ? (
                    <p className="flex items-center gap-1 text-[11px] font-semibold" style={{ color: point.qty > 0 ? "var(--t-text)" : "#ef4444" }}>
                      <MapPin size={11} /> {point.name}: {point.qty > 0 ? `${point.qty} und.` : "sin unidades"}
                    </p>
                  ) : null}
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={row.included}
                  aria-label={`Mostrar en ${catalog.name}`}
                  onClick={() => void persist(catalog, { included: !row.included })}
                  className="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition"
                  style={{ background: row.included ? "var(--t-accent)" : "color-mix(in oklab, var(--t-text) 18%, transparent)" }}
                >
                  <motion.span layout className="inline-block h-5 w-5 rounded-full bg-white shadow" style={{ marginLeft: row.included ? 22 : 2 }} />
                </button>
              </div>
              {row.included ? (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <MoneyInput
                    allowEmpty
                    value={row.price_override}
                    onValueChange={(value) => setRows((current) => ({ ...current, [catalog.id]: { ...row, price_override: value } }))}
                    placeholder="Precio especial"
                    ariaLabel={`Precio especial en ${catalog.name}`}
                    className="w-36 rounded-xl border px-3 py-2 text-sm outline-none"
                    style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)", color: "var(--t-text)" }}
                  />
                  <button
                    type="button"
                    onClick={() => void persist(catalog, { price_override: row.price_override })}
                    className="rounded-xl px-3 py-2 text-xs font-bold text-white"
                    style={{ background: "var(--t-cta)" }}
                  >
                    Guardar precio
                  </button>
                  <button
                    type="button"
                    onClick={() => void persist(catalog, { featured: !row.featured })}
                    className="inline-flex items-center gap-1 rounded-xl border px-2.5 py-2 text-xs font-semibold"
                    style={{ borderColor: "var(--t-card-border)", color: row.featured ? "#f59e0b" : "var(--t-muted)" }}
                    title="Destacar en este catálogo"
                  >
                    <Star size={13} fill={row.featured ? "#f59e0b" : "none"} />
                  </button>
                  <p className="w-full text-xs" style={{ color: "var(--t-muted)" }}>
                    Se vende a <b style={{ color: price > 0 ? "var(--t-text)" : "#ef4444" }}>{price > 0 ? `$${price.toLocaleString("es-CO")}` : "sin precio (no se muestra)"}</b>
                    {savingId === catalog.id ? <Loader2 size={12} className="ml-1 inline animate-spin" /> : null}
                  </p>
                  {point && point.qty <= 0 ? (
                    <p className="w-full text-xs" style={{ color: "#ef4444" }}>
                      No se muestra hasta que lleguen unidades a {point.name}.
                    </p>
                  ) : null}
                </div>
              ) : (
                <p className="mt-2 text-xs" style={{ color: "var(--t-muted)" }}>No aparece en este catálogo.</p>
              )}
            </motion.div>
          );
        })}
      </div>
    </section>
  );
}
