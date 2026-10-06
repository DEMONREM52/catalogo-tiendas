"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Copy,
  Filter,
  Megaphone,
  Pencil,
  Plus,
  Power,
  Search,
  ShieldAlert,
  Sparkles,
  Trash2,
} from "lucide-react";
import Swal from "sweetalert2";
import { supabaseBrowser } from "@/lib/supabase/client";
import { getDashboardStore, hasStorePermission, type DashboardStore } from "@/lib/store-utils";
import { ImageUpload } from "../store/ImageUpload";
import { hasProductLanding, normalizeProductDetails } from "@/lib/product-details";
import {
  createSocialCaption,
  reviewProductForPost,
  SOCIAL_PLATFORMS,
  type SocialPlatform,
} from "@/lib/social-content";
import { reviewCommercialContent } from "@/lib/content-review";

type ProductOption = {
  id: string;
  name: string;
  description: string | null;
  price_retail: number;
  image_url: string | null;
  stock: number | null;
  active: boolean;
  product_details: unknown;
};

type SocialPost = {
  id: string;
  product_id: string | null;
  campaign_id: string | null;
  platform: SocialPlatform;
  status: "draft" | "review" | "ready" | "scheduled" | "published" | "failed";
  title: string;
  caption: string;
  image_urls: string[];
  product_snapshot: Record<string, unknown>;
  policy_warnings: string[];
  error_message: string | null;
  created_at: string;
};

type StoreCategory = { id: string; name: string };
type Campaign = {
  id: string;
  name: string;
  description: string;
  cover_image_url: string | null;
  category_id: string | null;
  is_public: boolean;
  created_at: string;
  /** Vacío = se muestra en todos los catálogos. */
  catalog_ids?: string[] | null;
};
type CatalogOption = { id: string; name: string };
const PAGE_SIZE = 24;
const SOCIAL_PUBLISHING_TOOLS_ENABLED: boolean = false;

const fieldClass =
  "w-full rounded-2xl border border-slate-200 bg-white/80 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-fuchsia-400 focus:ring-4 focus:ring-fuchsia-200/50 dark:border-white/10 dark:bg-white/5 dark:text-white dark:focus:border-fuchsia-400";
const cardClass =
  "rounded-[18px] border border-slate-200/70 bg-white/85 shadow-lg shadow-violet-950/[0.035] backdrop-blur-xl dark:border-white/[0.08] dark:bg-[#171421]/75";

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character] ?? character;
  });
}

function readableError(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  return "Ocurrió un error inesperado.";
}

function newCampaignAssetId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `campaign-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function platformName(value: string) {
  return SOCIAL_PLATFORMS.find((platform) => platform.id === value)?.label ?? value;
}

function snapshotProduct(product: ProductOption) {
  return {
    name: product.name,
    description: product.description,
    price_retail: Number(product.price_retail ?? 0),
    image_url: product.image_url,
    stock: product.stock,
    active: product.active,
    product_details: normalizeProductDetails(product.product_details),
  };
}

export default function SocialDashboard() {
  const [store, setStore] = useState<DashboardStore | null>(null);
  const [userId, setUserId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [posts, setPosts] = useState<SocialPost[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [categories, setCategories] = useState<StoreCategory[]>([]);
  const [campaignSearch, setCampaignSearch] = useState("");
  const [campaignVisibilityFilter, setCampaignVisibilityFilter] = useState<"all" | "visible" | "hidden">("all");
  const [campaignCategoryFilter, setCampaignCategoryFilter] = useState("all");
  const [campaignSort, setCampaignSort] = useState<"newest" | "oldest" | "name">("newest");
  const [updatingCampaignId, setUpdatingCampaignId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [productSearch, setProductSearch] = useState("");
  const [productOptions, setProductOptions] = useState<ProductOption[]>([]);
  const [productId, setProductId] = useState("");
  const [eligibleCampaignIds, setEligibleCampaignIds] = useState<string[]>([]);
  const [platform, setPlatform] = useState<SocialPlatform>("instagram");
  const [socialStyle, setSocialStyle] = useState("cercano");
  const [socialObjective, setSocialObjective] = useState("conversaciones");
  const [title, setTitle] = useState("");
  const [caption, setCaption] = useState("");
  const [campaignId, setCampaignId] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingStatus, setEditingStatus] = useState<SocialPost["status"]>("draft");
  const [campaignName, setCampaignName] = useState("");
  const [campaignDescription, setCampaignDescription] = useState("");
  const [campaignProductIds, setCampaignProductIds] = useState<string[]>([]);
  const [campaignCoverUrl, setCampaignCoverUrl] = useState("");
  const [campaignCategoryId, setCampaignCategoryId] = useState("");
  const [campaignIsPublic, setCampaignIsPublic] = useState(true);
  const [campaignAssetId, setCampaignAssetId] = useState(newCampaignAssetId);
  const [showCampaignForm, setShowCampaignForm] = useState(false);
  const [editingCampaignId, setEditingCampaignId] = useState<string | null>(null);
  const [catalogOptions, setCatalogOptions] = useState<CatalogOption[]>([]);
  const [campaignCatalogIds, setCampaignCatalogIds] = useState<string[]>([]);

  const chosenProduct = useMemo(
    () => productOptions.find((product) => product.id === productId) ?? null,
    [productId, productOptions],
  );
  const chosenDetails = useMemo(
    () => normalizeProductDetails(chosenProduct?.product_details),
    [chosenProduct],
  );
  const warnings = useMemo(() => {
    if (!chosenProduct) return [];
    return reviewProductForPost({
      id: chosenProduct.id,
      name: chosenProduct.name,
      description: chosenProduct.description,
      price_retail: chosenProduct.price_retail,
      image_url: chosenProduct.image_url,
      stock: chosenProduct.stock,
      active: chosenProduct.active,
      details: chosenDetails,
    });
  }, [chosenDetails, chosenProduct]);
  const composerFindings = useMemo(() => {
    if (!chosenProduct) return reviewCommercialContent([title, caption].filter(Boolean).join("\n"));
    return reviewCommercialContent([
      title,
      caption,
      chosenProduct.name,
      chosenProduct.description ?? "",
      JSON.stringify(chosenDetails),
    ].filter(Boolean).join("\n"));
  }, [caption, chosenDetails, chosenProduct, title]);

  function moderatePost(post: SocialPost) {
    const snapshot = post.product_snapshot ?? {};
    const productDetails =
      snapshot.product_details && typeof snapshot.product_details === "object"
        ? snapshot.product_details
        : {};
    const reviewedText = [
      post.title,
      post.caption,
      snapshot.name,
      snapshot.description,
      JSON.stringify(productDetails),
    ]
      .filter((value): value is string => typeof value === "string")
      .join("\n");
    return reviewCommercialContent(reviewedText);
  }

  async function showModerationFindings(post: SocialPost) {
    const findings = moderatePost(post);
    if (!findings.length) return true;
    const items = findings
      .map(
        (finding) =>
          `<li><strong>${escapeHtml(finding.category)}</strong>: “${escapeHtml(finding.phrase || "contexto")}” — ${escapeHtml(finding.explanation)}</li>`,
      )
      .join("");
    await Swal.fire({
      icon: "warning",
      title: "Revisa el contenido antes de continuar",
      html: `<p class="mb-3 text-left">Encontramos expresiones que pueden resultar ofensivas, sensibles o restringidas:</p><ul class="list-disc space-y-2 pl-5 text-left">${items}</ul><p class="mt-4 text-left text-sm">La palabra “cuchillo” por sí sola no se bloquea; se revisan frases con contexto de amenaza o daño. Corrige el texto y vuelve a solicitar revisión.</p>`,
      confirmButtonText: "Volver a editar",
      confirmButtonColor: "#a21caf",
      width: "min(640px, calc(100vw - 32px))",
    });
    return false;
  }

  const loadPosts = useCallback(async (storeId: string, nextOffset: number, append: boolean) => {
    const sb = supabaseBrowser();
    let query = sb
      .from("store_social_posts")
      .select("id,product_id,campaign_id,platform,status,title,caption,image_urls,product_snapshot,policy_warnings,error_message,created_at")
      .eq("store_id", storeId)
      .order("created_at", { ascending: false })
      .range(nextOffset, nextOffset + PAGE_SIZE - 1);
    if (statusFilter !== "all") query = query.eq("status", statusFilter);
    const term = search.trim().replace(/[,%()]/g, " ");
    if (term) query = query.ilike("title", `%${term}%`);
    const { data, error: queryError } = await query;
    if (queryError) throw queryError;
    const rows = (data ?? []) as SocialPost[];
    setPosts((current) => (append ? [...current, ...rows] : rows));
    setOffset(nextOffset + rows.length);
    setHasMore(rows.length === PAGE_SIZE);
  }, [search, statusFilter]);

  const reload = useCallback(async (storeId: string) => {
    setLoading(true);
    setError("");
    try {
      const sb = supabaseBrowser();
      const { data, error: campaignsError } = await sb
        .from("store_social_campaigns")
        .select("*")
        .eq("store_id", storeId)
        .order("created_at", { ascending: false });
      if (campaignsError) throw campaignsError;
      setCampaigns((data ?? []) as Campaign[]);
    } catch (cause) {
      setError(readableError(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const access = await getDashboardStore();
        if (!access.store) throw new Error("No se encontró la tienda de esta sesión.");
        if (!hasStorePermission(access, "products")) {
          throw new Error("Necesitas el permiso de Productos para administrar RemHub Social.");
        }
        const sb = supabaseBrowser();
        const { data, error: userError } = await sb.auth.getUser();
        if (userError) throw userError;
        if (!data.user) throw new Error("Tu sesión expiró. Inicia sesión nuevamente.");
        if (cancelled) return;
        setStore(access.store);
        setUserId(data.user.id);
        const { data: categoryRows, error: categoryError } = await sb
          .from("product_categories")
          .select("id,name")
          .eq("store_id", access.store.id)
          .eq("active", true)
          .order("sort_order", { ascending: true })
          .order("name", { ascending: true });
        if (categoryError) throw categoryError;
        if (!cancelled) setCategories((categoryRows ?? []) as StoreCategory[]);
      } catch (cause) {
        if (!cancelled) setError(readableError(cause));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!store) return;
    const sb = supabaseBrowser();
    void sb
      .from("store_social_campaigns")
      .select("*")
      .eq("store_id", store.id)
      .order("created_at", { ascending: false })
      .then(({ data, error: campaignError }) => {
        if (campaignError) setError(readableError(campaignError));
        else setCampaigns((data ?? []) as Campaign[]);
      });
    // Si los catálogos múltiples no están instalados, las campañas se muestran en todos los catálogos.
    void sb
      .from("store_catalogs")
      .select("id,name")
      .eq("store_id", store.id)
      .order("sort_order")
      .then(({ data, error: catalogsError }) => {
        if (!catalogsError) setCatalogOptions((data ?? []) as CatalogOption[]);
      });
  }, [store]);

  useEffect(() => {
    if (!store) return;
    let cancelled = false;
    const timeout = window.setTimeout(async () => {
      const sb = supabaseBrowser();
      let query = sb
        .from("products")
        .select("id,name,description,price_retail,image_url,stock,active,product_details")
        .eq("store_id", store.id)
        .order("name", { ascending: true })
        .limit(20);
      const term = productSearch.trim().replace(/[,%()]/g, " ");
      if (term) query = query.ilike("name", `%${term}%`);
      const { data, error: productError } = await query;
      if (cancelled) return;
      if (productError) {
        setError(readableError(productError));
        return;
      }
      const rows = (data ?? []) as ProductOption[];
      setProductOptions((current) => {
        const retained = current.filter(
          (item) => item.id === productId || campaignProductIds.includes(item.id),
        );
        const merged = new Map(rows.map((item) => [item.id, item]));
        for (const item of retained) if (!merged.has(item.id)) merged.set(item.id, item);
        return [...merged.values()];
      });
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [campaignProductIds, productId, productSearch, store]);

  useEffect(() => {
    if (!store || !chosenProduct) {
      setEligibleCampaignIds([]);
      return;
    }
    let cancelled = false;
    void supabaseBrowser()
      .from("store_social_campaign_items")
      .select("campaign_id")
      .eq("store_id", store.id)
      .eq("product_id", chosenProduct.id)
      .then(({ data, error: queryError }) => {
        if (cancelled) return;
        if (queryError) {
          setError(readableError(queryError));
          return;
        }
        setEligibleCampaignIds((data ?? []).map((row) => String(row.campaign_id)));
      });
    return () => {
      cancelled = true;
    };
  }, [chosenProduct, store]);

  function buildCaption(product: ProductOption, targetPlatform: SocialPlatform) {
    return createSocialCaption(
      {
        id: product.id,
        name: product.name,
        description: product.description,
        price_retail: product.price_retail,
        image_url: product.image_url,
        stock: product.stock,
        active: product.active,
        details: normalizeProductDetails(product.product_details),
      },
      targetPlatform,
      { style: socialStyle, objective: socialObjective },
    );
  }

  function selectProduct(nextProductId: string) {
    setProductId(nextProductId);
    const selected = productOptions.find((product) => product.id === nextProductId);
    if (!selected || editingId) return;
    setTitle(selected.name);
    setCaption(buildCaption(selected, platform));
  }

  function regenerateSuggestion() {
    if (!chosenProduct) return;
    setCaption(buildCaption(chosenProduct, platform));
  }

  async function saveDraft(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!store || !userId || !chosenProduct || !title.trim() || !caption.trim()) return;
    setSaving(true);
    setError("");
    try {
      const sb = supabaseBrowser();
      const snapshot = snapshotProduct(chosenProduct);
      const post = {
        store_id: store.id,
        product_id: chosenProduct.id,
        campaign_id: campaignId || null,
        platform,
        status: editingId ? editingStatus : "draft",
        title: title.trim(),
        caption: caption.trim(),
        image_urls: [chosenProduct.image_url, ...chosenDetails.gallery_urls].filter(Boolean),
        product_snapshot: {
          ...snapshot,
          content_style: socialStyle,
          content_objective: socialObjective,
        },
        policy_warnings: warnings,
      };
      const result = editingId
        ? await sb.from("store_social_posts").update(post).eq("id", editingId).eq("store_id", store.id)
        : await sb.from("store_social_posts").insert({ ...post, created_by: userId });
      if (result.error) throw result.error;
      clearComposer();
      await reload(store.id);
    } catch (cause) {
      setError(readableError(cause));
    } finally {
      setSaving(false);
    }
  }

  function clearComposer() {
    setEditingId(null);
    setEditingStatus("draft");
    setProductId("");
    setEligibleCampaignIds([]);
    setPlatform("instagram");
    setTitle("");
    setCaption("");
    setCampaignId("");
    setSocialStyle("cercano");
    setSocialObjective("conversaciones");
  }

  async function editPost(post: SocialPost, duplicate = false) {
    if (!duplicate && ["published", "scheduled"].includes(post.status)) {
      setError("Una publicación publicada o programada no se modifica desde RemHub. Duplica el contenido para crear una nueva versión.");
      return;
    }
    let selected = productOptions.find((item) => item.id === post.product_id);
    if (post.product_id && store) {
      const sb = supabaseBrowser();
      const { data, error: productError } = await sb
        .from("products")
        .select("id,name,description,price_retail,image_url,stock,active,product_details")
        .eq("store_id", store.id)
        .eq("id", post.product_id)
        .maybeSingle();
      if (productError) {
        setError(readableError(productError));
        return;
      }
      selected = (data as ProductOption | null) ?? undefined;
      if (selected) setProductOptions((current) => [selected!, ...current.filter((item) => item.id !== selected!.id)]);
    }
    if (!selected) {
      setError("El producto de esta publicación ya no está disponible. Puedes revisar el texto y elegir otro producto.");
      setTitle(post.title);
      setCaption(post.caption);
      setPlatform(post.platform);
      setProductId("");
      setEditingId(duplicate ? null : post.id);
      setCampaignId(post.campaign_id ?? "");
      return;
    }
    setProductId(selected.id);
    setPlatform(post.platform);
    setTitle(post.title);
    setCaption(post.caption);
    setCampaignId(post.campaign_id ?? "");
    setSocialStyle(String(post.product_snapshot.content_style ?? "cercano"));
    setSocialObjective(String(post.product_snapshot.content_objective ?? "conversaciones"));
    setEditingId(duplicate ? null : post.id);
    setEditingStatus(post.status);
    document.getElementById("social-composer")?.scrollIntoView({ behavior: "smooth" });
  }

  async function markReady(post: SocialPost) {
    if (!store) return;
    if (!(await showModerationFindings(post))) return;
    const { error: updateError } = await supabaseBrowser()
      .from("store_social_posts")
      .update({ status: "ready", error_message: null })
      .eq("id", post.id)
      .eq("store_id", store.id);
    if (updateError) {
      setError(readableError(updateError));
      return;
    }
    await reload(store.id);
  }

  async function requestReview(post: SocialPost) {
    if (!store) return;
    if (!(await showModerationFindings(post))) return;
    const { error: updateError } = await supabaseBrowser()
      .from("store_social_posts")
      .update({ status: "review" })
      .eq("id", post.id)
      .eq("store_id", store.id);
    if (updateError) {
      setError(readableError(updateError));
      return;
    }
    await reload(store.id);
    await Swal.fire({
      icon: "success",
      title: "Contenido revisado",
      text: "No encontramos coincidencias con el filtro preventivo. La revisión de la plataforma todavía aplica.",
      timer: 2200,
      showConfirmButton: false,
    });
  }

  async function copyCaption(post: SocialPost) {
    try {
      await navigator.clipboard.writeText(post.caption);
      await Swal.fire({ toast: true, position: "top", icon: "success", title: "Texto copiado", timer: 1400, showConfirmButton: false });
    } catch (cause) {
      setError(readableError(cause));
    }
  }

  async function deletePost(post: SocialPost) {
    if (!store) return;
    const confirmation = await Swal.fire({
      icon: "warning",
      title: "¿Eliminar esta publicación?",
      text: `Se eliminará el contenido “${post.title || "Sin título"}”. Esta acción no se puede deshacer.`,
      showCancelButton: true,
      confirmButtonText: "Eliminar publicación",
      cancelButtonText: "Conservar",
      confirmButtonColor: "#e11d48",
      width: "min(520px, calc(100vw - 32px))",
    });
    if (!confirmation.isConfirmed) return;

    setSaving(true);
    setError("");
    try {
      const { data, error: deleteError } = await supabaseBrowser()
        .from("store_social_posts")
        .delete()
        .eq("id", post.id)
        .eq("store_id", store.id)
        .select("id");
      if (deleteError) throw deleteError;
      if (!data?.length) throw new Error("No se eliminó la publicación. Verifica tus permisos y vuelve a intentarlo.");
      await reload(store.id);
      await Swal.fire({
        toast: true,
        position: "top",
        icon: "success",
        title: "Publicación eliminada",
        timer: 1800,
        showConfirmButton: false,
      });
    } catch (cause) {
      setError(readableError(cause));
    } finally {
      setSaving(false);
    }
  }

  async function openPlatform(post: SocialPost) {
    const destinations: Record<SocialPlatform, string> = {
      facebook: "https://www.facebook.com/",
      instagram: "https://www.instagram.com/",
      facebook_marketplace: "https://www.facebook.com/marketplace/",
      whatsapp: `https://wa.me/?text=${encodeURIComponent(post.caption)}`,
      tiktok: "https://www.tiktok.com/",
      pinterest: "https://www.pinterest.com/",
      mercadolibre: "https://www.mercadolibre.com/",
    };
    window.open(destinations[post.platform], "_blank", "noopener,noreferrer");
    if (post.platform !== "whatsapp") {
      try {
        await navigator.clipboard.writeText(post.caption);
        await Swal.fire({ toast: true, position: "top", icon: "success", title: "Texto y enlaces copiados; pégalos en la publicación", timer: 2200, showConfirmButton: false });
      } catch (cause) {
        setError(readableError(cause));
      }
    }
  }

  async function editCampaign(campaign: Campaign) {
    if (!store) return;
    setError("");
    setSaving(true);
    try {
      const sb = supabaseBrowser();
      const { data: items, error: itemsError } = await sb
        .from("store_social_campaign_items")
        .select("product_id,sort_order")
        .eq("store_id", store.id)
        .eq("campaign_id", campaign.id)
        .order("sort_order", { ascending: true });
      if (itemsError) throw itemsError;
      const ids = (items ?? []).map((item) => String(item.product_id));
      if (ids.length) {
        const { data: products, error: productsError } = await sb
          .from("products")
          .select("id,name,description,price_retail,image_url,stock,active,product_details")
          .eq("store_id", store.id)
          .in("id", ids);
        if (productsError) throw productsError;
        setProductOptions((current) => {
          const merged = new Map(current.map((product) => [product.id, product]));
          for (const product of (products ?? []) as ProductOption[]) merged.set(product.id, product);
          return [...merged.values()];
        });
      }
      setEditingCampaignId(campaign.id);
      setCampaignName(campaign.name);
      setCampaignDescription(campaign.description);
      setCampaignProductIds(ids);
      setCampaignCoverUrl(campaign.cover_image_url ?? "");
      setCampaignCategoryId(campaign.category_id ?? "");
      setCampaignIsPublic(campaign.is_public);
      setCampaignCatalogIds(Array.isArray(campaign.catalog_ids) ? campaign.catalog_ids : []);
      setCampaignAssetId(campaign.id);
      setProductSearch("");
      setShowCampaignForm(true);
      window.requestAnimationFrame(() => {
        document.getElementById("campaign-form")?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    } catch (cause) {
      setError(readableError(cause));
    } finally {
      setSaving(false);
    }
  }

  async function deleteCampaign(campaign: Campaign) {
    if (!store) return;
    const confirmation = await Swal.fire({
      icon: "warning",
      title: "¿Eliminar esta campaña?",
      text: `Se eliminará “${campaign.name}” y su lista de productos. Las publicaciones existentes se conservarán sin campaña.`,
      showCancelButton: true,
      confirmButtonText: "Eliminar campaña",
      cancelButtonText: "Conservar",
      confirmButtonColor: "#e11d48",
      width: "min(560px, calc(100vw - 32px))",
    });
    if (!confirmation.isConfirmed) return;
    setSaving(true);
    setError("");
    try {
      const { data, error: deleteError } = await supabaseBrowser()
        .from("store_social_campaigns")
        .delete()
        .eq("id", campaign.id)
        .eq("store_id", store.id)
        .select("id");
      if (deleteError) throw deleteError;
      if (!data?.length) throw new Error("No se eliminó la campaña. Verifica tus permisos y vuelve a intentarlo.");
      if (campaignId === campaign.id) setCampaignId("");
      if (editingCampaignId === campaign.id) resetCampaignForm();
      await reload(store.id);
    } catch (cause) {
      setError(readableError(cause));
    } finally {
      setSaving(false);
    }
  }

  async function toggleCampaignVisibility(campaign: Campaign) {
    if (!store || updatingCampaignId) return;
    if (!campaign.is_public && (!campaign.cover_image_url || !campaign.category_id)) {
      setError("Para publicar esta campaña, edítala y agrega una portada y una categoría primero.");
      return;
    }
    setUpdatingCampaignId(campaign.id);
    setError("");
    try {
      const nextVisibility = !campaign.is_public;
      const { data, error: updateError } = await supabaseBrowser()
        .from("store_social_campaigns")
        .update({ is_public: nextVisibility })
        .eq("id", campaign.id)
        .eq("store_id", store.id)
        .select("id")
        .maybeSingle();
      if (updateError) throw updateError;
      if (!data) throw new Error("No se pudo actualizar la campaña. Comprueba tus permisos e inténtalo de nuevo.");
      setCampaigns((current) => current.map((item) =>
        item.id === campaign.id ? { ...item, is_public: nextVisibility } : item,
      ));
    } catch (cause) {
      setError(readableError(cause));
    } finally {
      setUpdatingCampaignId(null);
    }
  }

  function resetCampaignForm() {
    setEditingCampaignId(null);
    setCampaignName("");
    setCampaignDescription("");
    setCampaignProductIds([]);
    setCampaignCoverUrl("");
    setCampaignCategoryId("");
    setCampaignIsPublic(true);
    setCampaignCatalogIds([]);
    setCampaignAssetId(newCampaignAssetId());
    setShowCampaignForm(false);
  }

  async function createCampaign(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!store || !userId || !campaignName.trim() || campaignProductIds.length === 0 || !campaignCoverUrl || !campaignCategoryId) return;
    const campaignFindings = reviewCommercialContent([
      campaignName,
      campaignDescription,
      ...campaignProductIds.map((id) => productOptions.find((product) => product.id === id)?.name ?? ""),
    ].join("\n"));
    if (campaignFindings.length) {
      const findingsList = campaignFindings
        .map((finding) => `<li><strong>${escapeHtml(finding.category)}</strong>: “${escapeHtml(finding.phrase)}” — ${escapeHtml(finding.explanation)}</li>`)
        .join("");
      await Swal.fire({
        icon: "warning",
        title: "Revisa el nombre y la descripción",
        html: `<p class="mb-3 text-left">La campaña contiene texto que podría ser ofensivo, amenazante o restringido:</p><ul class="list-disc space-y-2 pl-5 text-left">${findingsList}</ul>`,
        confirmButtonText: "Volver a editar",
        confirmButtonColor: "#a21caf",
        width: "min(640px, calc(100vw - 32px))",
      });
      return;
    }
    setSaving(true);
    setError("");
    try {
      const sb = supabaseBrowser();
      let targetCampaignId = editingCampaignId;
      const campaignValues = {
        name: campaignName.trim(),
        description: campaignDescription.trim(),
        cover_image_url: campaignCoverUrl,
        category_id: campaignCategoryId,
        is_public: campaignIsPublic,
        ...(catalogOptions.length ? { catalog_ids: campaignCatalogIds } : {}),
      };
      if (editingCampaignId) {
        const { error: updateError } = await sb
          .from("store_social_campaigns")
          .update(campaignValues)
          .eq("id", editingCampaignId)
          .eq("store_id", store.id);
        if (updateError) throw updateError;
        const { error: deleteItemsError } = await sb
          .from("store_social_campaign_items")
          .delete()
          .eq("store_id", store.id)
          .eq("campaign_id", editingCampaignId);
        if (deleteItemsError) {
          await reload(store.id);
          throw new Error(`Se guardó el nombre y la descripción, pero no se pudo actualizar la lista de productos: ${deleteItemsError.message}`);
        }
      } else {
        const { data: campaign, error: campaignError } = await sb
          .from("store_social_campaigns")
          .insert({
            store_id: store.id,
            ...campaignValues,
            created_by: userId,
          })
          .select("id")
          .single();
        if (campaignError) throw campaignError;
        targetCampaignId = campaign.id;
      }
      const { error: itemsError } = await sb.from("store_social_campaign_items").insert(
        campaignProductIds.map((selectedProductId, sortOrder) => ({
          store_id: store.id,
          campaign_id: targetCampaignId,
          product_id: selectedProductId,
          sort_order: sortOrder,
        })),
      );
      if (itemsError) {
        await reload(store.id);
        throw new Error(`La campaña se guardó, pero no se pudo completar la lista de productos. Vuelve a editarla para corregirla: ${itemsError.message}`);
      }
      resetCampaignForm();
      await reload(store.id);
    } catch (cause) {
      setError(readableError(cause));
    } finally {
      setSaving(false);
    }
  }

  const visiblePosts = useMemo(() => posts, [posts]);
  const filteredCampaigns = useMemo(() => {
    const term = campaignSearch.trim().toLocaleLowerCase("es");
    return campaigns
      .filter((campaign) => {
        const categoryName = categories.find((category) => category.id === campaign.category_id)?.name ?? "";
        const matchesSearch = !term ||
          campaign.name.toLocaleLowerCase("es").includes(term) ||
          campaign.description.toLocaleLowerCase("es").includes(term) ||
          categoryName.toLocaleLowerCase("es").includes(term);
        const matchesVisibility = campaignVisibilityFilter === "all" ||
          (campaignVisibilityFilter === "visible" ? campaign.is_public : !campaign.is_public);
        const matchesCategory = campaignCategoryFilter === "all" || campaign.category_id === campaignCategoryFilter;
        return matchesSearch && matchesVisibility && matchesCategory;
      })
      .sort((a, b) => {
        if (campaignSort === "name") return a.name.localeCompare(b.name, "es");
        const dateOrder = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
        return campaignSort === "oldest" ? dateOrder : -dateOrder;
      });
  }, [campaignCategoryFilter, campaignSearch, campaignSort, campaignVisibilityFilter, campaigns, categories]);
  return (
    <main className="min-h-screen space-y-6 px-3 py-4 text-slate-900 dark:text-white sm:p-6">
      <header className={`${cardClass} relative overflow-hidden p-5 sm:p-8`}>
        <div className="pointer-events-none absolute -right-10 -top-24 h-64 w-64 rounded-full bg-fuchsia-400/20 blur-3xl" />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="flex items-center gap-2 text-sm font-bold uppercase tracking-[0.2em] text-fuchsia-700 dark:text-fuchsia-300">
              <Sparkles size={16} /> RemHub Social
            </p>
            <h1 className="mt-2 text-3xl font-black sm:text-4xl">Campañas de tu catálogo.</h1>
            <p className="mt-2 max-w-2xl text-sm opacity-70">
              {store?.name ?? "Tu tienda"} · Crea campañas y elige cuáles se muestran en tu catálogo.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              if (showCampaignForm) resetCampaignForm();
              else {
                resetCampaignForm();
                setShowCampaignForm(true);
              }
            }}
            className="inline-flex items-center gap-2 rounded-2xl bg-fuchsia-600 px-4 py-3 text-sm font-bold text-white shadow-lg shadow-fuchsia-950/20 transition hover:bg-fuchsia-700"
          >
            <Plus size={17} /> Nueva campaña
          </button>
        </div>
      </header>

      {error ? (
        <div role="alert" className="rounded-2xl border border-rose-400/40 bg-rose-500/10 p-4 text-sm text-rose-800 dark:text-rose-200">
          {error}
        </div>
      ) : null}

      {showCampaignForm ? (
        <form id="campaign-form" onSubmit={(event) => void createCampaign(event)} className={`${cardClass} space-y-4 p-5 transition`}>
          <div>
            <h2 className="flex items-center gap-2 text-xl font-bold">
              {editingCampaignId ? <Pencil size={18} className="text-fuchsia-600" /> : <Sparkles size={18} className="text-fuchsia-600" />}
              {editingCampaignId ? "Editar campaña del catálogo" : "Crear campaña para el catálogo"}
            </h2>
            <p className="text-sm opacity-70">Agrega una portada, asígnala a una categoría y elige los productos que aparecerán en el catálogo de {store?.name}.</p>
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            <input className={fieldClass} value={campaignName} onChange={(event) => setCampaignName(event.target.value)} placeholder="Nombre de campaña" required maxLength={160} />
            <input className={fieldClass} value={campaignDescription} onChange={(event) => setCampaignDescription(event.target.value)} placeholder="Objetivo o contexto (opcional)" maxLength={1000} />
            <label className="block text-sm font-semibold">
              Categoría asociada
              <select className={`${fieldClass} mt-1`} value={campaignCategoryId} onChange={(event) => setCampaignCategoryId(event.target.value)} required>
                <option value="">Selecciona una categoría…</option>
                {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
              </select>
              {categories.length === 0 ? <span className="mt-1 block text-xs font-normal text-amber-700 dark:text-amber-300">Crea primero una categoría en Productos → Categorías para asociarla a esta campaña.</span> : null}
            </label>
            <label className="flex items-center gap-3 rounded-2xl border border-current/10 px-4 py-3 text-sm">
              <input
                type="checkbox"
                checked={campaignIsPublic}
                onChange={(event) => setCampaignIsPublic(event.target.checked)}
                className="h-4 w-4 accent-fuchsia-600"
              />
              <span><strong>Mostrar en el catálogo</strong><span className="mt-0.5 block text-xs font-normal opacity-65">Si lo desactivas, solo será visible en RemHub Social.</span></span>
            </label>
            {catalogOptions.length ? (
              <div className="lg:col-span-2">
                <p className="text-sm font-semibold">¿En qué catálogos aparece?</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setCampaignCatalogIds([])}
                    className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${campaignCatalogIds.length === 0 ? "border-fuchsia-500 bg-fuchsia-500/15" : "border-current/15"}`}
                  >
                    🌐 Todos los catálogos
                  </button>
                  {catalogOptions.map((option) => {
                    const selected = campaignCatalogIds.includes(option.id);
                    return (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => setCampaignCatalogIds((current) =>
                          current.includes(option.id) ? current.filter((id) => id !== option.id) : [...current, option.id],
                        )}
                        className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${selected ? "border-fuchsia-500 bg-fuchsia-500/15" : "border-current/15"}`}
                      >
                        {selected ? "✓ " : ""}{option.name}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-1 text-xs opacity-65">Los precios de la campaña se muestran con la lista de precios de cada catálogo.</p>
              </div>
            ) : null}
            <div className="lg:col-span-2">
              <ImageUpload
                label="Imagen principal de portada"
                currentUrl={campaignCoverUrl || null}
                pathPrefix={`${store?.id ?? "store"}/campaign-covers/`}
                fileName={`${campaignAssetId}.jpg`}
                onUploaded={setCampaignCoverUrl}
              />
              {!campaignCoverUrl ? <p className="mt-2 text-xs font-medium text-amber-700 dark:text-amber-300">Sube una imagen de portada para poder guardar la campaña.</p> : null}
            </div>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-3.5 opacity-40" size={17} />
            <input className={`${fieldClass} pl-10`} value={productSearch} onChange={(event) => setProductSearch(event.target.value)} placeholder="Busca productos para incluir…" />
          </div>
          <div className="grid max-h-80 gap-2 overflow-auto sm:grid-cols-2 xl:grid-cols-3">
            {productOptions.map((product) => (
              <label key={product.id} className="flex min-w-0 cursor-pointer items-center gap-3 rounded-xl border border-current/10 p-2.5 text-sm transition hover:border-fuchsia-500/40 hover:bg-fuchsia-500/5">
                <input
                  type="checkbox"
                  checked={campaignProductIds.includes(product.id)}
                  onChange={(event) => setCampaignProductIds((current) =>
                    event.target.checked ? [...current, product.id] : current.filter((id) => id !== product.id),
                  )}
                />
                {product.image_url ? (
                  <img src={product.image_url} alt="" className="h-12 w-12 shrink-0 rounded-lg object-cover" loading="lazy" />
                ) : (
                  <span className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-fuchsia-500/10 text-lg">📦</span>
                )}
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{product.name}</span>
                  <span className="block text-xs opacity-60">${Number(product.price_retail ?? 0).toLocaleString("es-CO")}</span>
                </span>
              </label>
            ))}
            {productOptions.length === 0 ? <p className="text-sm opacity-65">No encontramos productos. Prueba otra búsqueda o crea productos en tu catálogo.</p> : null}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs opacity-70">{campaignProductIds.length} producto(s) seleccionado(s){campaignCategoryId ? ` · ${categories.find((category) => category.id === campaignCategoryId)?.name ?? ""}` : ""}.</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={saving} onClick={resetCampaignForm} className="rounded-xl border border-current/10 px-4 py-2 text-sm font-semibold disabled:opacity-50">
                Cancelar
              </button>
              <button disabled={saving || campaignProductIds.length === 0 || !campaignCoverUrl || !campaignCategoryId} className="rounded-xl bg-violet-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-violet-700 disabled:opacity-50">
                {saving ? "Guardando…" : editingCampaignId ? "Guardar cambios" : "Guardar campaña"}
              </button>
            </div>
          </div>
        </form>
      ) : null}

      {SOCIAL_PUBLISHING_TOOLS_ENABLED && <section id="social-composer" className={`${cardClass} overflow-hidden`}>
        <div className="border-b border-current/10 bg-gradient-to-r from-violet-500/10 via-fuchsia-500/10 to-amber-500/10 p-5">
          <h2 className="flex items-center gap-2 text-xl font-black">
            <Megaphone size={20} className="text-fuchsia-600" />
            {editingId ? "Editar borrador" : "Preparar una publicación"}
          </h2>
          <p className="mt-1 text-sm opacity-70">El contenido queda guardado como borrador o preparado; no se publica automáticamente. Al solicitar revisión se detectan insultos, referencias sexuales, alcohol y frases de daño o amenaza.</p>
        </div>
        <form onSubmit={(event) => void saveDraft(event)} className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(280px,0.9fr)]">
          <div className="space-y-3">
            <label className="block text-sm font-semibold">
              Buscar producto
              <input className={`${fieldClass} mt-1`} value={productSearch} onChange={(event) => setProductSearch(event.target.value)} placeholder="Escribe para buscar en tu tienda…" />
            </label>
            <label className="block text-sm font-semibold">
              Producto
              <select className={`${fieldClass} mt-1`} value={productId} onChange={(event) => selectProduct(event.target.value)} required>
                <option value="">Selecciona un producto…</option>
                {productOptions.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
              </select>
            </label>
            {chosenProduct ? (
              <div className="flex items-center gap-3 rounded-2xl bg-violet-500/5 p-3">
                {chosenProduct.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={chosenProduct.image_url} alt="" className="h-14 w-14 rounded-xl object-cover" />
                ) : <div className="grid h-14 w-14 place-items-center rounded-xl bg-fuchsia-500/10">📦</div>}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-bold">{chosenProduct.name}</p>
                  {store?.catalog_retail &&
                  hasProductLanding(chosenProduct.product_details, {
                    description: chosenProduct.description,
                    imageUrl: chosenProduct.image_url,
                  }) ? (
                    <Link className="text-xs font-semibold text-violet-600 hover:underline" href={`/${store?.slug}/producto/${chosenProduct.id}`} target="_blank">
                      Abrir página pública →
                    </Link>
                  ) : (
                    <p className="text-xs text-amber-700 dark:text-amber-300">
                      {store?.catalog_retail
                        ? "Completa la ficha ampliada para habilitar el enlace público."
                        : "Activa el catálogo al detal para habilitar el enlace público."}
                    </p>
                  )}
                </div>
              </div>
            ) : null}
            {composerFindings.length ? (
              <div role="status" className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4">
                <p className="flex items-center gap-2 text-sm font-bold text-amber-800 dark:text-amber-200">
                  <ShieldAlert size={17} /> Atención antes de enviar a redes
                </p>
                <ul className="mt-2 space-y-1.5 text-xs text-amber-900 dark:text-amber-100">
                  {composerFindings.map((finding, index) => (
                    <li key={`${finding.category}-${finding.phrase}-${index}`}>
                      <strong>{finding.category}:</strong> {finding.explanation}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-[11px] text-amber-900/75 dark:text-amber-100/70">
                  Puedes guardar como borrador, pero se solicitará corregir estas coincidencias antes de marcar la publicación como lista o pedir revisión.
                </p>
              </div>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm font-semibold">
                Plataforma
                <select className={`${fieldClass} mt-1`} value={platform} onChange={(event) => setPlatform(event.target.value as SocialPlatform)}>
                  {SOCIAL_PLATFORMS.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}
                </select>
              </label>
              <label className="block text-sm font-semibold">
                Campaña (opcional)
                <select className={`${fieldClass} mt-1`} value={campaignId} onChange={(event) => setCampaignId(event.target.value)}>
                  <option value="">Sin campaña</option>
                  {campaigns
                    .filter((campaign) => eligibleCampaignIds.includes(campaign.id))
                    .map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}
                </select>
              </label>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm font-semibold">
                Estilo
                <select className={`${fieldClass} mt-1`} value={socialStyle} onChange={(event) => setSocialStyle(event.target.value)}>
                  <option value="cercano">Cercano</option>
                  <option value="directo">Directo</option>
                </select>
              </label>
              <label className="block text-sm font-semibold">
                Objetivo
                <select className={`${fieldClass} mt-1`} value={socialObjective} onChange={(event) => setSocialObjective(event.target.value)}>
                  <option value="conversaciones">Recibir consultas</option>
                  <option value="visitas">Visitar el catálogo</option>
                  <option value="informacion">Compartir información</option>
                </select>
              </label>
            </div>
            <label className="block text-sm font-semibold">
              Título
              <input className={`${fieldClass} mt-1`} value={title} onChange={(event) => setTitle(event.target.value)} required maxLength={300} />
            </label>
            <label className="block text-sm font-semibold">
              Texto comercial editable
              <button
                type="button"
                onClick={regenerateSuggestion}
                disabled={!chosenProduct}
                className="ml-2 text-xs font-bold text-violet-600 underline disabled:opacity-40"
              >
                Actualizar sugerencia
              </button>
              <textarea className={`${fieldClass} mt-1 min-h-48 resize-y`} value={caption} onChange={(event) => setCaption(event.target.value)} required maxLength={5000} />
            </label>
          </div>

          <aside className="space-y-4">
            <div className="rounded-3xl border border-fuchsia-300/40 bg-fuchsia-500/5 p-4 dark:border-fuchsia-300/15">
              <p className="font-bold">Vista previa · {platformName(platform)}</p>
              <p className="mt-1 text-xs opacity-60">Formato de texto. Verifica manualmente los requisitos actuales de cada red.</p>
              <div className="mt-4 rounded-2xl bg-white p-4 text-sm text-slate-800 shadow dark:bg-[#201c2d] dark:text-white">
                <p className="whitespace-pre-wrap">{caption || "Tu texto aparecerá aquí…"}</p>
              </div>
            </div>
            <div className="rounded-3xl border border-amber-400/40 bg-amber-400/10 p-4">
              <h3 className="flex items-center gap-2 font-bold"><AlertTriangle size={17} /> Revisión preventiva</h3>
              <p className="mt-1 text-xs opacity-70">No sustituye las políticas ni la revisión de la plataforma.</p>
              <ul className="mt-3 space-y-2 text-sm">
                {(warnings.length ? warnings : ["El borrador usa solo información disponible del producto."]).map((warning) => (
                  <li key={warning} className="flex gap-2"><span aria-hidden>•</span><span>{warning}</span></li>
                ))}
              </ul>
            </div>
            <div className="flex flex-wrap gap-2">
              <button disabled={saving || !chosenProduct} className="inline-flex items-center gap-2 rounded-2xl bg-fuchsia-600 px-5 py-3 font-bold text-white shadow-lg shadow-fuchsia-950/20 disabled:opacity-50">
                <Sparkles size={17} /> {saving ? "Guardando…" : editingId ? "Guardar cambios" : "Guardar borrador"}
              </button>
              {editingId ? <button type="button" onClick={clearComposer} className="rounded-2xl border border-current/15 px-4 py-3 text-sm font-semibold">Cancelar edición</button> : null}
            </div>
          </aside>
        </form>
      </section>}

      {SOCIAL_PUBLISHING_TOOLS_ENABLED && <section className={`${cardClass} overflow-hidden`}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-current/10 p-5">
          <div>
            <h2 className="text-xl font-black">Publicaciones de {store?.name ?? "tu tienda"}</h2>
            <p className="text-sm opacity-65">Borradores, preparación y registro por plataforma.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <input className={`${fieldClass} w-48`} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar títulos…" aria-label="Buscar publicaciones" />
            <select className={`${fieldClass} w-auto`} value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="all">Todos los estados</option>
              <option value="draft">Borradores</option>
              <option value="review">Necesitan revisión</option>
              <option value="ready">Preparados</option>
              <option value="scheduled">Programados</option>
              <option value="published">Publicados</option>
              <option value="failed">Fallidos</option>
            </select>
          </div>
        </div>
        {loading ? <p className="p-6 text-sm opacity-65">Cargando actividad…</p> : null}
        {!loading && visiblePosts.length === 0 ? (
          <div className="p-8 text-center">
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-fuchsia-500/10 text-fuchsia-700"><Megaphone /></div>
            <p className="mt-3 font-bold">Aún no tienes publicaciones guardadas</p>
            <p className="mt-1 text-sm opacity-65">Prepara un borrador desde aquí o desde la edición de un producto.</p>
          </div>
        ) : null}
        <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
          {visiblePosts.map((post) => (
            <article key={post.id} className="overflow-hidden rounded-3xl border border-current/10 bg-white/50 dark:bg-black/10">
              {post.image_urls?.[0] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={post.image_urls[0]} alt="" className="h-40 w-full object-cover" />
              ) : null}
              <div className="space-y-3 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="line-clamp-1 font-bold">{post.title || String(post.product_snapshot.name ?? "Publicación")}</p>
                    <p className="mt-1 text-xs opacity-65">{platformName(post.platform)} · {new Date(post.created_at).toLocaleDateString("es-CO")}</p>
                  </div>
                  <span className="shrink-0 rounded-full border border-current/10 px-2.5 py-1 text-[11px] font-bold">{post.status}</span>
                </div>
                <p className="line-clamp-3 whitespace-pre-wrap text-sm opacity-75">{post.caption}</p>
                {post.error_message ? <p className="rounded-xl bg-rose-500/10 p-2 text-xs text-rose-700 dark:text-rose-200">Error: {post.error_message}</p> : null}
                {post.policy_warnings?.length ? <p className="line-clamp-2 text-xs text-amber-700 dark:text-amber-300">{post.policy_warnings[0]}</p> : null}
                <div className="flex flex-wrap gap-2">
                  {post.product_id &&
                  store?.catalog_retail &&
                  hasProductLanding(post.product_snapshot.product_details, {
                    description: post.product_snapshot.description,
                    imageUrl: post.product_snapshot.image_url,
                  }) ? (
                    <Link href={`/${store?.slug}/producto/${post.product_id}`} target="_blank" className="rounded-xl border border-current/10 px-3 py-2 text-xs font-semibold">
                      Ver producto
                    </Link>
                  ) : null}
                  <button type="button" onClick={() => void copyCaption(post)} className="inline-flex items-center gap-1 rounded-xl border border-current/10 px-3 py-2 text-xs font-semibold"><Copy size={14} /> Copiar</button>
                  <button type="button" onClick={() => openPlatform(post)} className="rounded-xl bg-fuchsia-600 px-3 py-2 text-xs font-bold text-white">Abrir plataforma</button>
                  {post.image_urls?.[0] ? (
                    <a href={post.image_urls[0]} target="_blank" rel="noreferrer" className="rounded-xl border border-current/10 px-3 py-2 text-xs font-semibold">
                      Abrir foto
                    </a>
                  ) : null}
                  {!["published", "scheduled"].includes(post.status) ? (
                    <button type="button" onClick={() => void editPost(post)} className="inline-flex items-center gap-1 rounded-xl border border-current/10 px-3 py-2 text-xs font-semibold"><Pencil size={14} /> Editar</button>
                  ) : null}
                  <button type="button" onClick={() => void editPost(post, true)} className="rounded-xl border border-current/10 px-3 py-2 text-xs font-semibold">Duplicar</button>
                  <button
                    type="button"
                    onClick={() => void deletePost(post)}
                    disabled={saving}
                    className="inline-flex items-center gap-1 rounded-xl border border-rose-500/25 px-3 py-2 text-xs font-semibold text-rose-700 transition hover:bg-rose-500/10 disabled:opacity-50 dark:text-rose-200"
                    aria-label={`Eliminar publicación ${post.title || ""}`}
                  >
                    <Trash2 size={14} /> Eliminar
                  </button>
                  {["draft", "review"].includes(post.status) ? (
                    <>
                      {post.status === "draft" ? (
                        <button type="button" onClick={() => void requestReview(post)} className="rounded-xl border border-amber-500/30 px-3 py-2 text-xs font-semibold">Solicitar revisión</button>
                      ) : null}
                      <button type="button" onClick={() => void markReady(post)} className="rounded-xl bg-emerald-600 px-3 py-2 text-xs font-bold text-white">Marcar listo</button>
                    </>
                  ) : null}
                </div>
                {post.status === "ready" ? <p className="text-xs text-emerald-700 dark:text-emerald-300">Preparado para compartir manualmente · no publicado en la plataforma.</p> : null}
              </div>
            </article>
          ))}
        </div>
        {hasMore ? (
          <div className="p-5 text-center">
            <button
              type="button"
              className="rounded-2xl border border-current/15 px-5 py-3 text-sm font-bold"
              onClick={() => store && loadPosts(store.id, offset, true).catch((cause: unknown) => setError(readableError(cause)))}
            >
              Cargar más publicaciones
            </button>
          </div>
        ) : null}
      </section>}

      <section className={`${cardClass} p-5`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-black">Campañas</h2>
            <p className="text-sm opacity-65">
              Busca, filtra y controla qué campañas se muestran en el catálogo.
              {campaigns.length ? ` ${filteredCampaigns.length} de ${campaigns.length} campañas.` : ""}
            </p>
          </div>
          <button type="button" onClick={() => {
            resetCampaignForm();
            setShowCampaignForm(true);
          }} className="inline-flex items-center gap-2 rounded-xl border border-current/10 px-3 py-2 text-sm font-semibold transition hover:bg-fuchsia-500/10">
            <Plus size={16} /> Crear
          </button>
        </div>
        <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50/80 p-3 dark:border-white/10 dark:bg-black/15 sm:p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Filter size={16} className="text-fuchsia-600 dark:text-fuchsia-300" />
              <p className="text-sm font-bold">Buscar y filtrar campañas</p>
            </div>
            <button
              type="button"
              onClick={() => {
                setCampaignSearch("");
                setCampaignVisibilityFilter("all");
                setCampaignCategoryFilter("all");
                setCampaignSort("newest");
              }}
              disabled={!campaignSearch && campaignVisibilityFilter === "all" && campaignCategoryFilter === "all" && campaignSort === "newest"}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-45 dark:border-white/10 dark:bg-white/5 dark:text-white/80 dark:hover:bg-white/10"
            >
              Limpiar filtros
            </button>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <label className="relative block sm:col-span-2 xl:col-span-1">
              <span className="sr-only">Buscar campañas</span>
              <Search size={16} className="absolute left-3 top-3.5 opacity-45" />
              <input
                className={`${fieldClass} pl-9`}
                value={campaignSearch}
                onChange={(event) => setCampaignSearch(event.target.value)}
                placeholder="Nombre, descripción o categoría…"
                type="search"
              />
            </label>
            <label>
              <span className="sr-only">Filtrar por visibilidad</span>
              <select className={fieldClass} value={campaignVisibilityFilter} onChange={(event) => setCampaignVisibilityFilter(event.target.value as typeof campaignVisibilityFilter)}>
                <option value="all">Todas las campañas</option>
                <option value="visible">Visibles en catálogo</option>
                <option value="hidden">Ocultas / inactivas</option>
              </select>
            </label>
            <label>
              <span className="sr-only">Filtrar por categoría</span>
              <select className={fieldClass} value={campaignCategoryFilter} onChange={(event) => setCampaignCategoryFilter(event.target.value)}>
                <option value="all">Todas las categorías</option>
                {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
              </select>
            </label>
            <label>
              <span className="sr-only">Ordenar campañas</span>
              <select className={fieldClass} value={campaignSort} onChange={(event) => setCampaignSort(event.target.value as typeof campaignSort)}>
                <option value="newest">Más recientes</option>
                <option value="oldest">Más antiguas</option>
                <option value="name">Nombre A–Z</option>
              </select>
            </label>
          </div>
        </div>
        {campaigns.length ? (
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filteredCampaigns.map((campaign) => (
              <div key={campaign.id} className="group rounded-2xl border border-current/10 bg-white/30 p-4 transition duration-200 hover:-translate-y-0.5 hover:border-fuchsia-500/30 hover:shadow-lg hover:shadow-fuchsia-950/5 dark:bg-white/[0.02]">
                {campaign.cover_image_url ? (
                  <img src={campaign.cover_image_url} alt={`Portada de ${campaign.name}`} className="mb-3 aspect-[16/8] w-full rounded-xl object-cover" loading="lazy" />
                ) : (
                  <div className="mb-3 grid aspect-[16/8] w-full place-items-center rounded-xl bg-fuchsia-500/10 text-sm opacity-65">Sin portada</div>
                )}
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-bold">{campaign.name}</p>
                    {campaign.description ? <p className="mt-1 line-clamp-3 text-sm opacity-70">{campaign.description}</p> : <p className="mt-1 text-sm opacity-50">Sin objetivo agregado</p>}
                    <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                      <span className="rounded-full bg-fuchsia-500/10 px-2.5 py-1 font-semibold text-fuchsia-800 dark:text-fuchsia-200">
                        {categories.find((category) => category.id === campaign.category_id)?.name ?? "Sin categoría"}
                      </span>
                      <span className={`rounded-full px-2.5 py-1 font-semibold ${campaign.is_public ? "bg-emerald-500/10 text-emerald-800 dark:text-emerald-200" : "bg-slate-500/10 opacity-70"}`}>
                        {campaign.is_public ? "Activa · visible" : "Inactiva · oculta"}
                      </span>
                      {catalogOptions.length ? (
                        <span className="rounded-full bg-violet-500/10 px-2.5 py-1 font-semibold text-violet-800 dark:text-violet-200">
                          {campaign.catalog_ids?.length
                            ? catalogOptions.filter((option) => campaign.catalog_ids?.includes(option.id)).map((option) => option.name).join(", ") || "Catálogo eliminado"
                            : "Todos los catálogos"}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-2 text-xs opacity-55">{new Date(campaign.created_at).toLocaleDateString("es-CO")}</p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <button
                      type="button"
                      onClick={() => void toggleCampaignVisibility(campaign)}
                      disabled={saving || updatingCampaignId !== null}
                      className={`grid h-9 w-9 place-items-center rounded-xl border transition disabled:cursor-wait disabled:opacity-50 ${
                        campaign.is_public
                          ? "border-amber-500/25 text-amber-700 hover:bg-amber-500/10 dark:text-amber-200"
                          : "border-emerald-500/25 text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-200"
                      }`}
                      aria-label={`${campaign.is_public ? "Desactivar" : "Activar"} campaña ${campaign.name}`}
                      title={campaign.is_public ? "Desactivar y ocultar del catálogo" : "Activar y mostrar en el catálogo"}
                    >
                      <Power size={16} className={updatingCampaignId === campaign.id ? "animate-pulse" : ""} />
                    </button>
                    <button
                      type="button"
                      onClick={() => void editCampaign(campaign)}
                      disabled={saving}
                      className="grid h-9 w-9 place-items-center rounded-xl border border-current/10 transition hover:bg-fuchsia-500/10 disabled:opacity-50"
                      aria-label={`Editar campaña ${campaign.name}`}
                      title="Editar campaña"
                    >
                      <Pencil size={15} />
                    </button>
                    <button
                      type="button"
                      onClick={() => void deleteCampaign(campaign)}
                      disabled={saving}
                      className="grid h-9 w-9 place-items-center rounded-xl border border-rose-500/20 text-rose-700 transition hover:bg-rose-500/10 disabled:opacity-50 dark:text-rose-200"
                      aria-label={`Eliminar campaña ${campaign.name}`}
                      title="Eliminar campaña"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
            {filteredCampaigns.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-current/15 p-5 text-sm opacity-65 sm:col-span-2 lg:col-span-3">
                No hay campañas que coincidan con esos filtros. Prueba otra búsqueda o limpia los filtros.
              </p>
            ) : null}
          </div>
        ) : <p className="mt-4 text-sm opacity-65">Tus campañas aparecerán aquí.</p>}
      </section>
    </main>
  );
}
