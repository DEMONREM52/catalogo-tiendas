"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { IMAGE_MODEL } from "@/lib/image-search/embed";
import { ProductFinder, type FinderHit, type FinderMode, type FinderSource } from "./ProductFinder";

/** Dónde se busca: el catálogo clásico de la tienda o un catálogo de RemHub Social. */
export type CatalogFinderContext = {
  storeId: string;
  storeSlug: string;
  catalogSlug?: string | null;
  accessKey?: string | null;
  wholesale?: boolean;
};

type StoreProduct = { id: string; name: string; image_url: string | null; price_retail: number | null; price_wholesale: number | null; sku?: string | null };
type CatalogItem = { id: string; name: string; image_url: string | null; price: number | null; code?: string | null; score?: number };

async function storeProducts(storeId: string, ids: string[]) {
  if (!ids.length) return new Map<string, StoreProduct>();
  const sb = supabaseBrowser();
  const res = await sb.from("products").select("id,name,image_url,price_retail,price_wholesale,sku").eq("store_id", storeId).in("id", ids);
  if (res.error) throw res.error;
  return new Map(((res.data ?? []) as StoreProduct[]).map((p) => [p.id, p]));
}

export function useCatalogFinderSource(ctx: CatalogFinderContext): FinderSource {
  const { storeId, storeSlug, catalogSlug, accessKey, wholesale } = ctx;
  return useMemo<FinderSource>(() => {
    const sb = supabaseBrowser();
    const fromStore = (p: StoreProduct, score?: number): FinderHit => ({
      id: p.id,
      name: p.name,
      image_url: p.image_url,
      code: p.sku ?? null,
      price: Number((wholesale ? p.price_wholesale : p.price_retail) ?? 0),
      score: score ?? null,
    });
    const fromCatalog = (i: CatalogItem): FinderHit => ({ id: i.id, name: i.name, image_url: i.image_url, code: i.code ?? null, price: Number(i.price ?? 0), score: i.score ?? null });

    if (catalogSlug) {
      return {
        async searchText(q) {
          const { data, error } = await sb.rpc("catalog_public_products", {
            p_store: storeSlug, p_catalog: catalogSlug, p_key: accessKey ?? null, p_category: null, p_q: q, p_limit: 24, p_offset: 0,
          });
          if (error) throw error;
          return (((data as { items?: CatalogItem[] } | null)?.items ?? []) as CatalogItem[]).map(fromCatalog);
        },
        async searchPhoto(embedding) {
          const { data, error } = await sb.rpc("catalog_public_image_search", {
            p_store: storeSlug, p_catalog: catalogSlug, p_key: accessKey ?? null, p_embedding: embedding, p_model: IMAGE_MODEL, p_limit: 24,
          });
          if (error) throw error;
          const res = (data ?? {}) as { indexed?: number; items?: CatalogItem[] };
          return { indexed: Number(res.indexed ?? 0), items: (res.items ?? []).map(fromCatalog) };
        },
      };
    }

    return {
      async searchText(q) {
        const { data, error } = await sb.rpc("store_public_search", { p_store: storeId, p_q: q, p_category: null, p_limit: 24, p_offset: 0 });
        if (error) throw error;
        const ids = ((data as { ids?: string[] } | null)?.ids ?? []) as string[];
        const byId = await storeProducts(storeId, ids);
        return ids.flatMap((id) => (byId.get(id) ? [fromStore(byId.get(id)!)] : []));
      },
      async searchPhoto(embedding) {
        const { data, error } = await sb.rpc("store_public_image_search", { p_store: storeId, p_embedding: embedding, p_model: IMAGE_MODEL, p_limit: 24 });
        if (error) throw error;
        const res = (data ?? {}) as { indexed?: number; items?: Array<{ id: string; score: number }> };
        const items = res.items ?? [];
        const byId = await storeProducts(storeId, items.map((i) => i.id));
        return {
          indexed: Number(res.indexed ?? 0),
          items: items.flatMap((i) => (byId.get(i.id) ? [fromStore(byId.get(i.id)!, Number(i.score))] : [])),
        };
      },
    };
  }, [storeId, storeSlug, catalogSlug, accessKey, wholesale]);
}

export function productPageHref(ctx: CatalogFinderContext, productId: string) {
  if (!ctx.catalogSlug) return `/${ctx.storeSlug}/producto/${productId}`;
  return `/${ctx.storeSlug}/producto/${productId}?catalogo=${encodeURIComponent(ctx.catalogSlug)}${ctx.accessKey ? `&key=${encodeURIComponent(ctx.accessKey)}` : ""}`;
}

/** Botón que abre el buscador y lleva a la ficha completa («Ver más») del producto elegido. */
export function CatalogFinderButton({
  ctx,
  children,
  className,
  style,
  mode = "text",
  ariaLabel,
  title,
}: {
  ctx: CatalogFinderContext;
  children: ReactNode;
  className?: string;
  style?: React.CSSProperties;
  mode?: FinderMode;
  ariaLabel?: string;
  title?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<FinderMode | null>(null);
  const source = useCatalogFinderSource(ctx);
  const close = useCallback(() => setOpen(null), []);
  return (
    <>
      <button type="button" className={className} style={style} onClick={() => setOpen(mode)} aria-label={ariaLabel} title={title}>
        {children}
      </button>
      <ProductFinder
        open={open !== null}
        initialMode={open ?? mode}
        onClose={close}
        source={source}
        title="Buscar producto"
        subtitle="Busca por nombre, código o con una foto y mira toda su información."
        pickLabel="Ver más"
        storageKey={`catalog:${ctx.storeSlug}:${ctx.catalogSlug ?? "tienda"}`}
        onPick={(hit) => {
          setOpen(null);
          router.push(productPageHref(ctx, hit.id));
        }}
      />
    </>
  );
}
