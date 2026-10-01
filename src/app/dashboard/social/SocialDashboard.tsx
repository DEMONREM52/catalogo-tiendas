"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Copy,
  Megaphone,
  Pencil,
  Plus,
  Search,
  ShieldAlert,
  Sparkles,
  Trash2,
} from "lucide-react";
import Swal from "sweetalert2";
import { supabaseBrowser } from "@/lib/supabase/client";
import { getDashboardStore, hasStorePermission, type DashboardStore } from "@/lib/store-utils";
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

type Campaign = { id: string; name: string; description: string; created_at: string };
type Counts = Record<SocialPost["status"], number>;
const PAGE_SIZE = 24;
const EMPTY_COUNTS: Counts = { draft: 0, review: 0, ready: 0, scheduled: 0, published: 0, failed: 0 };

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
  return "Ocurrió un error inesperado.";
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
  const [counts, setCounts] = useState<Counts>(EMPTY_COUNTS);
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
  const [showCampaignForm, setShowCampaignForm] = useState(false);
  const [editingCampaignId, setEditingCampaignId] = useState<string | null>(null);

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

  const loadCounts = useCallback(async (storeId: string) => {
    const sb = supabaseBrowser();
    const statuses: SocialPost["status"][] = ["draft", "review", "ready", "scheduled", "published", "failed"];
    const results = await Promise.all(
      statuses.map(async (status) => {
        const { count, error: countError } = await sb
          .from("store_social_posts")
          .select("id", { count: "exact", head: true })
          .eq("store_id", storeId)
          .eq("status", status);
        if (countError) throw countError;
        return [status, count ?? 0] as const;
      }),
    );
    setCounts(Object.fromEntries(results) as Counts);
  }, []);

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
      await Promise.all([loadPosts(storeId, 0, false), loadCounts(storeId)]);
      const sb = supabaseBrowser();
      const { data, error: campaignsError } = await sb
        .from("store_social_campaigns")
        .select("id,name,description,created_at")
        .eq("store_id", storeId)
        .order("created_at", { ascending: false })
        .limit(30);
      if (campaignsError) throw campaignsError;
      setCampaigns((data ?? []) as Campaign[]);
    } catch (cause) {
      setError(readableError(cause));
    } finally {
      setLoading(false);
    }
  }, [loadCounts, loadPosts]);

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
        const queryProduct = new URLSearchParams(window.location.search).get("product");
        if (queryProduct) {
          setProductId(queryProduct);
          const { data: product, error: productError } = await sb
            .from("products")
            .select("id,name,description,price_retail,image_url,stock,active,product_details")
            .eq("store_id", access.store.id)
            .eq("id", queryProduct)
            .maybeSingle();
          if (productError) throw productError;
          if (product) {
            setProductOptions((current) => [
              product as ProductOption,
              ...current.filter((item) => item.id !== queryProduct),
            ]);
            const option = product as ProductOption;
            setTitle(option.name);
            setCaption(
              createSocialCaption(
                {
                  id: option.id,
                  name: option.name,
                  description: option.description,
                  price_retail: option.price_retail,
                  image_url: option.image_url,
                  stock: option.stock,
                  active: option.active,
                  details: normalizeProductDetails(option.product_details),
                },
                "instagram",
              ),
            );
          }
        }
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
    void loadCounts(store.id).catch((cause: unknown) => setError(readableError(cause)));
    const sb = supabaseBrowser();
    void sb
      .from("store_social_campaigns")
      .select("id,name,description,created_at")
      .eq("store_id", store.id)
      .order("created_at", { ascending: false })
      .limit(30)
      .then(({ data, error: campaignError }) => {
        if (campaignError) setError(readableError(campaignError));
        else setCampaigns((data ?? []) as Campaign[]);
      });
  }, [loadCounts, store]);

  useEffect(() => {
    if (!store) return;
    const timeout = window.setTimeout(() => {
      void loadPosts(store.id, 0, false).catch((cause: unknown) => setError(readableError(cause)));
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [loadPosts, store]);

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
        .select("product_id")
        .eq("store_id", store.id)
        .eq("campaign_id", campaign.id);
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

  function resetCampaignForm() {
    setEditingCampaignId(null);
    setCampaignName("");
    setCampaignDescription("");
    setCampaignProductIds([]);
    setShowCampaignForm(false);
  }

  async function createCampaign(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!store || !userId || !campaignName.trim() || campaignProductIds.length === 0) return;
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
      if (editingCampaignId) {
        const { error: updateError } = await sb
          .from("store_social_campaigns")
          .update({ name: campaignName.trim(), description: campaignDescription.trim() })
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
            name: campaignName.trim(),
            description: campaignDescription.trim(),
            created_by: userId,
          })
          .select("id")
          .single();
        if (campaignError) throw campaignError;
        targetCampaignId = campaign.id;
      }
      const { error: itemsError } = await sb.from("store_social_campaign_items").insert(
        campaignProductIds.map((selectedProductId) => ({
          store_id: store.id,
          campaign_id: targetCampaignId,
          product_id: selectedProductId,
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
  const statCards = [
    ["Borradores", counts.draft, "text-slate-600 dark:text-slate-300"],
    ["Necesitan revisión", counts.review, "text-amber-700 dark:text-amber-300"],
    ["Preparadas", counts.ready, "text-violet-700 dark:text-violet-300"],
    ["Programadas", counts.scheduled, "text-blue-700 dark:text-blue-300"],
    ["Publicadas", counts.published, "text-emerald-700 dark:text-emerald-300"],
    ["Con errores", counts.failed, "text-rose-700 dark:text-rose-300"],
  ] as const;

  return (
    <main className="min-h-screen space-y-6 px-3 py-4 text-slate-900 dark:text-white sm:p-6">
      <header className={`${cardClass} relative overflow-hidden p-5 sm:p-8`}>
        <div className="pointer-events-none absolute -right-10 -top-24 h-64 w-64 rounded-full bg-fuchsia-400/20 blur-3xl" />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="flex items-center gap-2 text-sm font-bold uppercase tracking-[0.2em] text-fuchsia-700 dark:text-fuchsia-300">
              <Sparkles size={16} /> RemHub Social
            </p>
            <h1 className="mt-2 text-3xl font-black sm:text-4xl">De tu catálogo a tus redes.</h1>
            <p className="mt-2 max-w-2xl text-sm opacity-70">
              {store?.name ?? "Tu tienda"} · Prepara contenido con datos reales, revísalo y compártelo cuando estés listo.
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

      <section className="grid gap-3 grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
        {statCards.map(([label, value, color]) => (
          <div key={label} className={`${cardClass} p-4`}>
            <p className="text-xs font-semibold uppercase tracking-wide opacity-60">{label}</p>
            <p className={`mt-2 text-3xl font-black ${color}`}>{value}</p>
          </div>
        ))}
      </section>

      {showCampaignForm ? (
        <form id="campaign-form" onSubmit={(event) => void createCampaign(event)} className={`${cardClass} space-y-4 p-5 transition`}>
          <div>
            <h2 className="flex items-center gap-2 text-xl font-bold">
              {editingCampaignId ? <Pencil size={18} className="text-fuchsia-600" /> : <Sparkles size={18} className="text-fuchsia-600" />}
              {editingCampaignId ? "Editar campaña" : "Crear campaña de esta tienda"}
            </h2>
            <p className="text-sm opacity-70">Modifica el nombre, el objetivo y los productos vinculados. Solo se pueden asociar productos de {store?.name}.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <input className={fieldClass} value={campaignName} onChange={(event) => setCampaignName(event.target.value)} placeholder="Nombre de campaña" required maxLength={160} />
            <input className={fieldClass} value={campaignDescription} onChange={(event) => setCampaignDescription(event.target.value)} placeholder="Objetivo o contexto (opcional)" maxLength={1000} />
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-3.5 opacity-40" size={17} />
            <input className={`${fieldClass} pl-10`} value={productSearch} onChange={(event) => setProductSearch(event.target.value)} placeholder="Busca productos para incluir…" />
          </div>
          <div className="flex max-h-52 flex-wrap gap-2 overflow-auto">
            {productOptions.map((product) => (
              <label key={product.id} className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-current/10 px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  checked={campaignProductIds.includes(product.id)}
                  onChange={(event) => setCampaignProductIds((current) =>
                    event.target.checked ? [...current, product.id] : current.filter((id) => id !== product.id),
                  )}
                />
                {product.name}
              </label>
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs opacity-70">{campaignProductIds.length} producto(s) seleccionado(s).</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={saving} onClick={resetCampaignForm} className="rounded-xl border border-current/10 px-4 py-2 text-sm font-semibold disabled:opacity-50">
                Cancelar
              </button>
              <button disabled={saving || campaignProductIds.length === 0} className="rounded-xl bg-violet-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-violet-700 disabled:opacity-50">
                {saving ? "Guardando…" : editingCampaignId ? "Guardar cambios" : "Guardar campaña"}
              </button>
            </div>
          </div>
        </form>
      ) : null}

      <section id="social-composer" className={`${cardClass} overflow-hidden`}>
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
      </section>

      <section className={`${cardClass} overflow-hidden`}>
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
      </section>

      <section className={`${cardClass} p-5`}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-black">Campañas</h2>
            <p className="text-sm opacity-65">Agrupa productos pertenecientes a esta misma tienda.</p>
          </div>
          <button type="button" onClick={() => {
            resetCampaignForm();
            setShowCampaignForm(true);
          }} className="inline-flex items-center gap-2 rounded-xl border border-current/10 px-3 py-2 text-sm font-semibold transition hover:bg-fuchsia-500/10">
            <Plus size={16} /> Crear
          </button>
        </div>
        {campaigns.length ? (
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {campaigns.map((campaign) => (
              <div key={campaign.id} className="group rounded-2xl border border-current/10 bg-white/30 p-4 transition duration-200 hover:-translate-y-0.5 hover:border-fuchsia-500/30 hover:shadow-lg hover:shadow-fuchsia-950/5 dark:bg-white/[0.02]">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-bold">{campaign.name}</p>
                    {campaign.description ? <p className="mt-1 line-clamp-3 text-sm opacity-70">{campaign.description}</p> : <p className="mt-1 text-sm opacity-50">Sin objetivo agregado</p>}
                    <p className="mt-2 text-xs opacity-55">{new Date(campaign.created_at).toLocaleDateString("es-CO")}</p>
                  </div>
                  <div className="flex shrink-0 gap-1">
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
          </div>
        ) : <p className="mt-4 text-sm opacity-65">Tus campañas aparecerán aquí.</p>}
      </section>
    </main>
  );
}
