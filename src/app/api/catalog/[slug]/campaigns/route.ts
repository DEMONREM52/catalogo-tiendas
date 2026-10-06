import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type ProductRow = {
  id: string;
  name: string;
  description: string | null;
  price_retail: number | string | null;
  price_wholesale: number | string | null;
  min_wholesale: number | string | null;
  active: boolean;
  image_url: string | null;
  category_id: string | null;
  stock: number | string | null;
};

function slugCandidates(rawSlug: string) {
  const slug = rawSlug.trim();
  const withoutCom = slug.replace(/\.com$/i, "");
  return [...new Set([slug, slug.toLowerCase(), withoutCom, withoutCom.toLowerCase()].filter(Boolean))];
}

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Error cargando campañas.";
  console.error("Error cargando campañas públicas:", message);
  return NextResponse.json(
    { error: "No fue posible leer las campañas públicas. Verifica el esquema de RemHub Social en Supabase." },
    { status: 500, headers: { "Cache-Control": "no-store" } },
  );
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug: rawSlug } = await params;
    const searchParams = new URL(request.url).searchParams;
    const mode = searchParams.get("mode") ?? "detal";
    const wholesaleKey = searchParams.get("key") ?? "";
    if (mode !== "detal" && mode !== "mayor") {
      return NextResponse.json({ error: "Tipo de catálogo no válido." }, { status: 400 });
    }
    if (!rawSlug || rawSlug.length > 180) {
      return NextResponse.json({ campaigns: [] }, { headers: { "Cache-Control": "no-store" } });
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceRoleKey) {
      return NextResponse.json(
        { error: "El servidor no tiene configurada la llave privada de Supabase para leer las campañas." },
        { status: 500, headers: { "Cache-Control": "no-store" } },
      );
    }

    const supabase = createClient(url, serviceRoleKey, { auth: { persistSession: false } });
    let store: { id: string; wholesale_key: string | null } | null = null;
    for (const candidate of slugCandidates(rawSlug)) {
      let storeQuery = supabase
        .from("stores")
        .select("id,wholesale_key")
        .eq("slug", candidate)
        .eq("active", true);
      storeQuery = mode === "detal"
        ? storeQuery.eq("catalog_retail", true)
        : storeQuery.eq("catalog_wholesale", true);
      const { data, error } = await storeQuery.maybeSingle();
      if (error) throw error;
      if (data) {
        store = data;
        break;
      }
    }
    if (!store) {
      return NextResponse.json({ campaigns: [] }, { headers: { "Cache-Control": "no-store" } });
    }
    if (mode === "mayor" && (!wholesaleKey || wholesaleKey !== store.wholesale_key)) {
      return NextResponse.json({ campaigns: [] }, { headers: { "Cache-Control": "no-store" } });
    }

    const { data: campaignRows, error: campaignsError } = await supabase
      .from("store_social_campaigns")
      .select("*")
      .eq("store_id", store.id)
      .eq("is_public", true)
      .not("cover_image_url", "is", null)
      .order("created_at", { ascending: false })
      .limit(30);
    if (campaignsError) throw campaignsError;

    // Las campañas asignadas a catálogos de RemHub Social solo se ven en esos catálogos.
    const campaigns = (campaignRows ?? []).filter(
      (campaign) =>
        typeof campaign.cover_image_url === "string" && campaign.cover_image_url.trim() &&
        (!Array.isArray(campaign.catalog_ids) || campaign.catalog_ids.length === 0),
    );
    if (!campaigns.length) {
      return NextResponse.json({ campaigns: [] }, { headers: { "Cache-Control": "no-store" } });
    }

    const campaignIds = campaigns.map((campaign) => String(campaign.id));
    const orderedItems = await supabase
      .from("store_social_campaign_items")
      .select("campaign_id,product_id,sort_order")
      .eq("store_id", store.id)
      .in("campaign_id", campaignIds)
      .order("sort_order", { ascending: true });

    let items: Array<{ campaign_id: string; product_id: string; sort_order?: number }> = [];
    if (
      orderedItems.error?.code === "42703" &&
      orderedItems.error.message.toLowerCase().includes("sort_order")
    ) {
      const fallbackItems = await supabase
        .from("store_social_campaign_items")
        .select("campaign_id,product_id")
        .eq("store_id", store.id)
        .in("campaign_id", campaignIds);
      if (fallbackItems.error) throw fallbackItems.error;
      items = (fallbackItems.data ?? []) as typeof items;
    } else {
      if (orderedItems.error) throw orderedItems.error;
      items = (orderedItems.data ?? []) as typeof items;
    }

    const productIds = [...new Set(items.map((item) => String(item.product_id)))];
    const { data: productRows, error: productsError } = productIds.length
      ? await supabase
          .from("products")
          .select("id,name,description,price_retail,price_wholesale,min_wholesale,active,image_url,category_id,stock")
          .eq("store_id", store.id)
          .in("id", productIds)
          .eq("active", true)
          .or("stock.is.null,stock.gt.0")
      : { data: [], error: null };
    if (productsError) throw productsError;

    const productById = new Map(
      ((productRows ?? []) as ProductRow[]).map((product) => [
        product.id,
        {
          ...product,
          price_retail: Number(product.price_retail ?? 0),
          price_wholesale: Number(product.price_wholesale ?? 0),
          min_wholesale: product.min_wholesale == null ? null : Number(product.min_wholesale),
          stock: product.stock == null ? null : Number(product.stock),
          product_details: null,
        },
      ]),
    );
    const itemsByCampaign = new Map<string, ProductRow[]>();
    for (const item of items) {
      const product = productById.get(String(item.product_id));
      if (!product) continue;
      const campaignId = String(item.campaign_id);
      itemsByCampaign.set(campaignId, [...(itemsByCampaign.get(campaignId) ?? []), product]);
    }

    const result = campaigns.map((campaign) => ({
      id: String(campaign.id),
      name: String(campaign.name),
      description: String(campaign.description ?? ""),
      cover_image_url: String(campaign.cover_image_url),
      category_id: typeof campaign.category_id === "string" ? campaign.category_id : null,
      products: itemsByCampaign.get(String(campaign.id)) ?? [],
    }));

    return NextResponse.json({ campaigns: result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
