"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Database, Eye, EyeOff, Globe2, Info, Link2, MapPin, Plus, Power, Save, Star, Trash2, WandSparkles } from "lucide-react";
import Swal from "sweetalert2";
import { ImageUpload } from "./ImageUpload";
import { StoreContactIcon } from "@/components/StoreContactIcon";
import { getDashboardStore, type DashboardStore } from "@/lib/store-utils";
import { supabaseBrowser } from "@/lib/supabase/client";
import { normalizeStoreContactChannels, STORE_CONTACT_ICONS, type StoreContactChannel } from "@/lib/store-contacts";

type StoreProfileDraft = {
  headline: string;
  address: string;
  city: string;
  contact_channels: StoreContactChannel[];
  quick_access: string[];
  locations: StoreLocationDraft[];
};

type StoreProfileData = {
  headline?: unknown;
  address?: unknown;
  city?: unknown;
  contact_channels?: unknown;
  quick_access?: unknown;
  locations?: unknown;
} | null;

type StoreLocationDraft = {
  id: string;
  name: string;
  address: string;
  city: string;
  map_url: string;
  photo_url: string;
  description: string;
  active: boolean;
};

type StoreLinkDraft = {
  id: string;
  type: string;
  label: string;
  url: string;
  active: boolean;
  sort_order: number;
  icon_url: string | null;
};

type ThemeOption = { id: string; name: string; active: boolean; sort_order: number; config: unknown };

const QUICK_ACCESS_OPTIONS = [
  ["pos", "POS / Facturación", "💳"],
  ["orders", "Pedidos", "🧾"],
  ["products", "Productos", "📦"],
  ["social", "RemHub Social", "📣"],
  ["clients", "Clientes", "👥"],
  ["categories", "Categorías", "🗂️"],
  ["billing", "Facturación y pagos", "⚙️"],
  ["store", "Mi tienda", "🏪"],
  ["users", "Usuarios", "🔐"],
] as const;

const LINK_TYPES = [
  ["instagram", "Instagram"],
  ["facebook", "Facebook"],
  ["tiktok", "TikTok"],
  ["youtube", "YouTube"],
  ["whatsapp", "WhatsApp"],
  ["website", "Sitio web"],
  ["other", "Otro enlace"],
];

function normalizeStoreSlug(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/[._-]{2,}/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "");
}

function newId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `contact-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function themePreview(theme: ThemeOption | undefined) {
  const config = theme?.config && typeof theme.config === "object"
    ? theme.config as Record<string, unknown>
    : {};
  const stringValue = (key: string, fallback: string) =>
    typeof config[key] === "string" ? config[key] as string : fallback;
  const mode = config.bgMode === "solid" ? "solid" : "gradient";
  const legacyBg = stringValue("bg", "");
  const background = mode === "solid"
    ? stringValue("bgSolid", "#100b18")
    : legacyBg
      ? legacyBg
      : `linear-gradient(${typeof config.bgAngle === "number" ? config.bgAngle : 135}deg, ${stringValue("bgGradA", "#2a0a5e")}, ${stringValue("bgGradB", "#060620")})`;
  const legacyCta = stringValue("cta", "");
  const cta = legacyCta || (config.ctaMode === "solid"
    ? stringValue("ctaSolid", stringValue("accent", "#d946ef"))
    : `linear-gradient(${typeof config.ctaAngle === "number" ? config.ctaAngle : 90}deg, ${stringValue("ctaA", "#d946ef")}, ${stringValue("ctaB", "#8b5cf6")})`);
  return {
    background,
    card: stringValue("card", stringValue("cardBg", "rgba(255,255,255,0.08)")),
    border: stringValue("card_border", stringValue("cardBorder", stringValue("border", "rgba(255,255,255,0.18)"))),
    text: stringValue("text", "#ffffff"),
    muted: stringValue("muted", stringValue("mutedText", "rgba(255,255,255,0.72)")),
    accent: stringValue("accent", "#d946ef"),
    cta,
  };
}

function inputClass() {
  return "mt-1 w-full rounded-xl border px-3 py-2.5 text-sm outline-none transition focus:ring-2 focus:ring-fuchsia-500/25";
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  return String(error);
}

function isMissingStoreSettingsMigration(error: unknown) {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  const message = errorMessage(error).toLowerCase();
  return ["42703", "PGRST204"].includes(code) &&
    ["quick_access", "contact_channels", "locations"].some((column) => message.includes(column)) ||
    (["quick_access", "contact_channels", "locations"].some((column) => message.includes(column)) &&
      (message.includes("does not exist") || message.includes("schema cache") || message.includes("could not find")));
}

function Panel({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="glass-soft overflow-hidden rounded-3xl border" style={{ borderColor: "var(--t-card-border)" }}>
      <div className="border-b px-5 py-4 sm:px-6" style={{ borderColor: "var(--t-card-border)" }}>
        <h2 className="font-bold">{title}</h2>
        <p className="mt-1 text-sm" style={{ color: "var(--t-muted)" }}>{description}</p>
      </div>
      <div className="space-y-4 p-5 sm:p-6">{children}</div>
    </section>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block min-w-0 text-sm font-semibold">
      {label}
      {children}
      {hint ? <span className="mt-1 block text-xs font-normal" style={{ color: "var(--t-muted)" }}>{hint}</span> : null}
    </label>
  );
}

export default function StoreSettings() {
  const [store, setStore] = useState<DashboardStore | null>(null);
  const [profile, setProfile] = useState<StoreProfileDraft>({
    headline: "",
    address: "",
    city: "",
    contact_channels: [],
    quick_access: QUICK_ACCESS_OPTIONS.map(([key]) => key),
    locations: [],
  });
  const [links, setLinks] = useState<StoreLinkDraft[]>([]);
  const [removedLinkIds, setRemovedLinkIds] = useState<string[]>([]);
  const [themes, setThemes] = useState<ThemeOption[]>([]);
  const [siteOrigin, setSiteOrigin] = useState("");
  const [canEdit, setCanEdit] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingContacts, setSavingContacts] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [settingsMigrationMissing, setSettingsMigrationMissing] = useState(false);
  const [expandedContactId, setExpandedContactId] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    setSiteOrigin(window.location.origin);
    void (async () => {
      try {
        const access = await getDashboardStore();
        if (!access.store) throw new Error("No se encontró la tienda de esta cuenta.");
        const sb = supabaseBrowser();
        setStore(access.store);
        setCanEdit(access.isOwner || access.profileRole === "admin");
        const [profileResult, linksResult, themeResult] = await Promise.all([
          sb.from("store_profiles").select("headline,address,city,contact_channels,quick_access,locations").eq("store_id", access.store.id).maybeSingle(),
          sb.from("store_links").select("id,type,label,url,active,sort_order,icon_url").eq("store_id", access.store.id).order("sort_order", { ascending: true }),
          sb.from("themes").select("id,name,active,sort_order,config").order("sort_order", { ascending: true }),
        ]);
        let profileData: StoreProfileData = profileResult.data;
        if (profileResult.error) {
          if (!isMissingStoreSettingsMigration(profileResult.error)) throw profileResult.error;
          setSettingsMigrationMissing(true);
          const legacyProfile = await sb.from("store_profiles")
            .select("headline,address,city")
            .eq("store_id", access.store.id)
            .maybeSingle();
          if (legacyProfile.error) throw legacyProfile.error;
          profileData = legacyProfile.data;
        }
        if (linksResult.error) throw linksResult.error;
        if (themeResult.error) throw themeResult.error;
        if (!mounted) return;

        const primaryPhone = access.store.whatsapp || "";
        const profileChannels = normalizeStoreContactChannels(profileData?.contact_channels, primaryPhone);
        const currentChannels = [
          profileChannels.find((channel) => channel.id === "primary")
            ?? { id: "primary", label: "WhatsApp principal", phone: primaryPhone, icon: "other", active: true },
          ...profileChannels.filter((channel) => channel.id !== "primary"),
        ];
        const validQuickAccess = QUICK_ACCESS_OPTIONS.map(([key]) => key);
        const savedQuickAccess = Array.isArray(profileData?.quick_access)
          ? profileData.quick_access.filter((key: unknown): key is string => typeof key === "string" && validQuickAccess.some((validKey) => validKey === key))
          : validQuickAccess;

        const savedLocations = Array.isArray(profileData?.locations)
          ? profileData.locations.map((location: Partial<StoreLocationDraft>, index: number) => ({
              id: typeof location.id === "string" && location.id ? location.id : `location-${index + 1}`,
              name: typeof location.name === "string" ? location.name : "",
              address: typeof location.address === "string" ? location.address : "",
              city: typeof location.city === "string" ? location.city : "",
              map_url: typeof location.map_url === "string" ? location.map_url : "",
              photo_url: typeof location.photo_url === "string" ? location.photo_url : "",
              description: typeof location.description === "string" ? location.description : "",
              active: location.active !== false,
            }))
          : [];
        if (savedLocations.length === 0 && (profileData?.address || profileData?.city)) {
          savedLocations.push({
            id: "primary-location",
            name: "Punto principal",
            address: typeof profileData.address === "string" ? profileData.address : "",
            city: typeof profileData.city === "string" ? profileData.city : "",
            map_url: "",
            photo_url: "",
            description: "",
            active: true,
          });
        }
        setProfile({
          headline: typeof profileData?.headline === "string" ? profileData.headline : "",
          address: typeof profileData?.address === "string" ? profileData.address : "",
          city: typeof profileData?.city === "string" ? profileData.city : "",
          contact_channels: currentChannels,
          quick_access: savedQuickAccess,
          locations: savedLocations,
        });
        setLinks((linksResult.data ?? []).map((link) => ({
          id: String(link.id),
          type: String(link.type ?? "other"),
          label: String(link.label ?? ""),
          url: String(link.url ?? ""),
          active: link.active !== false,
          sort_order: Number(link.sort_order ?? 0),
          icon_url: link.icon_url == null ? null : String(link.icon_url),
        })));
        setThemes((themeResult.data ?? []) as ThemeOption[]);
      } catch (error) {
        await Swal.fire({
          icon: "error",
          title: "No se pudo cargar la configuración",
          text: errorMessage(error),
          background: "var(--t-bg-base)",
          color: "var(--t-text)",
        });
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const slugPreview = useMemo(() => normalizeStoreSlug(store?.slug ?? ""), [store?.slug]);
  const selectedTheme = themes.find((theme) => theme.id === store?.theme);
  const preview = themePreview(selectedTheme);

  async function copyLink(path: string) {
    try {
      await navigator.clipboard.writeText(`${siteOrigin}${path}`);
      await Swal.fire({ icon: "success", title: "Enlace copiado", timer: 1300, showConfirmButton: false, background: "var(--t-bg-base)", color: "var(--t-text)" });
    } catch (error) {
      await Swal.fire({ icon: "error", title: "No se pudo copiar", text: errorMessage(error), background: "var(--t-bg-base)", color: "var(--t-text)" });
    }
  }

  function patchStore(patch: Partial<DashboardStore>) {
    setStore((current) => current ? { ...current, ...patch } : current);
  }

  function patchContact(id: string, patch: Partial<StoreContactChannel>) {
    setProfile((current) => ({
      ...current,
      contact_channels: current.contact_channels.map((channel) =>
        channel.id === id ? { ...channel, ...patch } : channel,
      ),
    }));
  }

  function addContact() {
    const id = newId();
    setProfile((current) => ({
      ...current,
      contact_channels: [...current.contact_channels, { id, label: "", phone: "", icon: "other", active: true }],
    }));
    setExpandedContactId(id);
  }

  function removeContact(id: string) {
    if (expandedContactId === id) setExpandedContactId(null);
    setProfile((current) => ({
      ...current,
      contact_channels: current.contact_channels.filter((channel) => channel.id !== id),
    }));
  }

  async function saveWhatsAppContacts() {
    if (!store || !canEdit || savingContacts || saving) return;
    if (settingsMigrationMissing) {
      await Swal.fire({
        icon: "info",
        title: "Falta actualizar Supabase",
        text: "Ejecuta la migración de configuración de tienda antes de guardar los contactos de WhatsApp.",
        background: "var(--t-bg-base)",
        color: "var(--t-text)",
      });
      return;
    }

    const cleanChannels = profile.contact_channels.map((channel) => ({
      ...channel,
      label: channel.id === "primary" ? "WhatsApp principal" : channel.label.trim(),
      phone: channel.phone.trim(),
    }));
    const activeChannels = cleanChannels.filter((channel) => channel.active);
    if (!activeChannels.length) {
      await Swal.fire({
        icon: "warning",
        title: "Activa al menos un WhatsApp",
        text: "Debe haber al menos un contacto activo para que tus clientes puedan enviar pedidos.",
        background: "var(--t-bg-base)",
        color: "var(--t-text)",
      });
      return;
    }
    if (activeChannels.some((channel) => !channel.label || channel.phone.replace(/\D/g, "").length < 8)) {
      await Swal.fire({
        icon: "warning",
        title: "Revisa los contactos activos",
        text: "Cada WhatsApp activo necesita un nombre y un número válido de al menos 8 dígitos.",
        background: "var(--t-bg-base)",
        color: "var(--t-text)",
      });
      return;
    }

    setSavingContacts(true);
    try {
      const primary = cleanChannels.find((channel) => channel.id === "primary");
      if (!primary) throw new Error("No se encontró el contacto WhatsApp principal.");
      const sb = supabaseBrowser();
      const { data: updatedStore, error: storeError } = await sb
        .from("stores")
        .update({ whatsapp: primary.phone })
        .eq("id", store.id)
        .select("id")
        .maybeSingle();
      if (storeError) throw storeError;
      if (!updatedStore) throw new Error("No se pudo guardar el WhatsApp principal. Verifica tus permisos.");

      const { error: profileError } = await sb.from("store_profiles").upsert({
        store_id: store.id,
        contact_channels: cleanChannels,
      }, { onConflict: "store_id" });
      if (profileError) throw profileError;

      patchStore({ whatsapp: primary.phone });
      setProfile((current) => ({ ...current, contact_channels: cleanChannels }));
      await Swal.fire({
        icon: "success",
        title: "WhatsApp guardados",
        text: "Los contactos activos ya están disponibles en tu catálogo.",
        timer: 1800,
        showConfirmButton: false,
        background: "var(--t-bg-base)",
        color: "var(--t-text)",
      });
    } catch (error) {
      await Swal.fire({
        icon: "error",
        title: "No se pudieron guardar los WhatsApp",
        text: errorMessage(error),
        background: "var(--t-bg-base)",
        color: "var(--t-text)",
      });
    } finally {
      setSavingContacts(false);
    }
  }

  function addLocation() {
    setProfile((current) => ({
      ...current,
      locations: [...current.locations, {
        id: newId(),
        name: "",
        address: "",
        city: "",
        map_url: "",
        photo_url: "",
        description: "",
        active: true,
      }],
    }));
  }

  function patchLocation(id: string, patch: Partial<StoreLocationDraft>) {
    setProfile((current) => ({
      ...current,
      locations: current.locations.map((location) =>
        location.id === id ? { ...location, ...patch } : location,
      ),
    }));
  }

  function removeLocation(id: string) {
    setProfile((current) => ({
      ...current,
      locations: current.locations.filter((location) => location.id !== id),
    }));
  }

  function patchLink(id: string, patch: Partial<StoreLinkDraft>) {
    setLinks((current) => current.map((link) => link.id === id ? { ...link, ...patch } : link));
  }

  function addLink() {
    setLinks((current) => [...current, {
      id: `new-${newId()}`,
      type: "instagram",
      label: "",
      url: "",
      active: true,
      sort_order: current.length,
      icon_url: null,
    }]);
  }

  function removeLink(link: StoreLinkDraft) {
    if (!link.id.startsWith("new-")) setRemovedLinkIds((current) => [...current, link.id]);
    setLinks((current) => current.filter((item) => item.id !== link.id));
  }

  function generateWholesaleKey() {
    const bytes = new Uint8Array(18);
    crypto.getRandomValues(bytes);
    patchStore({ wholesale_key: Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("") });
  }

  async function saveSettings() {
    if (!store || !canEdit || saving) return;
    if (settingsMigrationMissing) {
      await Swal.fire({
        icon: "info",
        title: "Falta actualizar Supabase",
        text: "La configuración nueva no está instalada en tu base de datos. Ejecuta la migración 20261002_store_contact_and_quick_access_settings.sql y vuelve a guardar.",
        background: "var(--t-bg-base)",
        color: "var(--t-text)",
        confirmButtonText: "Entendido",
      });
      return;
    }
    const cleanName = store.name.trim();
    const cleanSlug = normalizeStoreSlug(store.slug);
    const cleanChannels = profile.contact_channels.map((channel) => ({
      ...channel,
      label: channel.label.trim(),
      phone: channel.phone.trim(),
    }));
    if (!cleanName || !cleanSlug) {
      await Swal.fire({ icon: "warning", title: "Faltan datos", text: "El nombre y el enlace corto de la tienda son obligatorios.", background: "var(--t-bg-base)", color: "var(--t-text)" });
      return;
    }
    if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(cleanSlug)) {
      await Swal.fire({ icon: "warning", title: "Enlace inválido", text: "No se pudo convertir el texto en una dirección pública segura. Prueba con otro nombre.", background: "var(--t-bg-base)", color: "var(--t-text)" });
      return;
    }
    if (!cleanChannels.some((channel) => channel.id === "primary") ||
      !cleanChannels.some((channel) => channel.active) ||
      cleanChannels.some((channel) => channel.active && (!channel.label || channel.phone.replace(/\D/g, "").length < 8))) {
      await Swal.fire({ icon: "warning", title: "Revisa tus contactos", text: "Debe haber al menos un WhatsApp activo con nombre y un número válido de al menos 8 dígitos.", background: "var(--t-bg-base)", color: "var(--t-text)" });
      return;
    }
    const invalidLink = links.find((link) => {
      if (!link.label.trim() || !link.url.trim()) return true;
      try {
        const url = new URL(/^https?:\/\//i.test(link.url) ? link.url : `https://${link.url}`);
        return !["http:", "https:"].includes(url.protocol);
      } catch {
        return true;
      }
    });
    if (invalidLink) {
      await Swal.fire({ icon: "warning", title: "Revisa los enlaces", text: "Cada red debe tener un nombre y una dirección web válida.", background: "var(--t-bg-base)", color: "var(--t-text)" });
      return;
    }
    const cleanLocations = profile.locations.map((location) => ({
      ...location,
      name: location.name.trim(),
      address: location.address.trim(),
      city: location.city.trim(),
      map_url: location.map_url.trim(),
      photo_url: location.photo_url.trim(),
      description: location.description.trim(),
    }));
    const invalidLocation = cleanLocations.find((location) => {
      if (!location.name || (!location.address && !location.city && !location.map_url)) return true;
      for (const candidate of [location.map_url, location.photo_url].filter(Boolean)) {
        try {
          if (!["https:", "http:"].includes(new URL(candidate).protocol)) return true;
        } catch {
          return true;
        }
      }
      return false;
    });
    if (invalidLocation) {
      await Swal.fire({
        icon: "warning",
        title: "Revisa los puntos de atención",
        text: "Cada punto necesita un nombre y al menos una dirección, ciudad o enlace de Google Maps.",
        background: "var(--t-bg-base)",
        color: "var(--t-text)",
      });
      return;
    }

    setSaving(true);
    try {
      const sb = supabaseBrowser();
      const primary = cleanChannels.find((channel) => channel.id === "primary");
      if (!primary) throw new Error("Debe haber un WhatsApp principal configurado.");
      const extraChannels = cleanChannels.map((channel, index) => ({
        ...channel,
        id: channel.id === "primary" ? "primary" : channel.id || `contact-${index}`,
      }));
      const { data: updatedStore, error: storeError } = await sb.from("stores").update({
        name: cleanName,
        slug: cleanSlug,
        whatsapp: primary.phone,
        wholesale_key: store.wholesale_key?.trim() || null,
        catalog_retail: store.catalog_retail,
        catalog_wholesale: store.catalog_wholesale,
        theme: store.theme || null,
        logo_url: store.logo_url,
        banner_url: store.banner_url,
      }).eq("id", store.id).select("id").maybeSingle();
      if (storeError) throw storeError;
      if (!updatedStore) throw new Error("No se guardó la tienda. Comprueba que tu usuario tenga permisos de administración.");

      const { error: profileError } = await sb.from("store_profiles").upsert({
        store_id: store.id,
        headline: profile.headline.trim() || null,
        address: profile.address.trim() || null,
        city: profile.city.trim() || null,
        contact_channels: extraChannels,
        quick_access: profile.quick_access,
        locations: cleanLocations,
      }, { onConflict: "store_id" });
      if (profileError) {
        throw new Error(`Se guardaron los datos principales, pero no el perfil/contactos. Ejecuta la migración de configuración de tienda y vuelve a guardar. ${profileError.message}`);
      }

      for (const [index, link] of links.entries()) {
        const url = /^https?:\/\//i.test(link.url.trim()) ? link.url.trim() : `https://${link.url.trim()}`;
        const values = {
          type: link.type,
          label: link.label.trim(),
          url,
          active: link.active,
          sort_order: index,
          icon_url: link.icon_url,
          store_id: store.id,
        };
        const result = link.id.startsWith("new-")
          ? await sb.from("store_links").insert(values).select("id").maybeSingle()
          : await sb.from("store_links").update(values).eq("id", link.id).eq("store_id", store.id).select("id").maybeSingle();
        if (result.error) throw new Error(`Se guardó la tienda, pero falló un enlace (${link.label}). ${result.error.message}`);
        if (!result.data) throw new Error(`No se guardó el enlace “${link.label}”. Verifica permisos de edición.`);
      }
      if (removedLinkIds.length) {
        const { error: removeError } = await sb.from("store_links").delete().eq("store_id", store.id).in("id", removedLinkIds);
        if (removeError) throw new Error(`Se guardó la tienda, pero no se pudieron eliminar algunos enlaces. ${removeError.message}`);
      }

      const { data: savedLinks, error: savedLinksError } = await sb
        .from("store_links")
        .select("id,type,label,url,active,sort_order,icon_url")
        .eq("store_id", store.id)
        .order("sort_order", { ascending: true });
      if (savedLinksError) throw savedLinksError;
      if (removedLinkIds.some((id) => (savedLinks ?? []).some((link) => String(link.id) === id))) {
        throw new Error("La tienda se actualizó, pero no se pudieron quitar algunos enlaces. Verifica tus permisos.");
      }

      setStore({ ...store, name: cleanName, slug: cleanSlug, whatsapp: primary.phone });
      setProfile((current) => ({ ...current, contact_channels: extraChannels, locations: cleanLocations }));
      setLinks((savedLinks ?? []).map((link) => ({
        id: String(link.id),
        type: String(link.type),
        label: String(link.label ?? ""),
        url: String(link.url),
        active: link.active !== false,
        sort_order: Number(link.sort_order ?? 0),
        icon_url: link.icon_url == null ? null : String(link.icon_url),
      })));
      setRemovedLinkIds([]);
      window.dispatchEvent(new Event("remhub-store-settings-updated"));
      await Swal.fire({
        icon: "success",
        title: "Tienda actualizada",
        text: "La información, los contactos y los accesos rápidos quedaron guardados.",
        timer: 1800,
        showConfirmButton: false,
        background: "var(--t-bg-base)",
        color: "var(--t-text)",
      });
    } catch (error) {
      await Swal.fire({
        icon: "error",
        title: "No se pudo guardar todo",
        text: errorMessage(error),
        background: "var(--t-bg-base)",
        color: "var(--t-text)",
      });
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="p-4 text-sm" style={{ color: "var(--t-muted)" }}>Cargando configuración de tienda…</p>;
  if (!store) return <p className="p-4 text-sm text-rose-500">No se pudo cargar la tienda.</p>;

  const inputStyle = {
    borderColor: "var(--t-card-border)",
    background: "color-mix(in oklab, var(--t-card-bg) 92%, transparent)",
    color: "var(--t-text)",
  };

  return (
    <main className="space-y-5 pb-8">
      <section className="glass overflow-hidden rounded-3xl border" style={{ borderColor: "var(--t-card-border)" }}>
        <div className="bg-gradient-to-r from-fuchsia-500/15 via-violet-500/10 to-transparent p-6 sm:p-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em]" style={{ color: "var(--t-accent)" }}>
                <WandSparkles size={15} /> Personaliza tu espacio
              </p>
              <h1 className="mt-2 text-2xl font-black sm:text-3xl">{store.name}</h1>
              <p className="mt-2 max-w-2xl text-sm" style={{ color: "var(--t-muted)" }}>
                Administra la identidad, los catálogos, los puntos de contacto y lo que aparece en el escaparate público.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void saveSettings()}
              disabled={!canEdit || saving}
              className="btn-cta inline-flex items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-bold disabled:opacity-50"
            >
              <Save size={16} /> {saving ? "Guardando…" : "Guardar cambios"}
            </button>
          </div>
          {!canEdit ? (
            <p role="status" className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-200">
              Tu rol permite consultar esta configuración, pero solo la persona propietaria o una administradora global puede modificarla.
            </p>
          ) : null}
        </div>
      </section>

      {settingsMigrationMissing ? (
        <section role="status" className="rounded-2xl border border-amber-400/35 bg-amber-400/10 p-4 sm:p-5">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-amber-400/15 text-amber-700 dark:text-amber-200"><Database size={19} /></span>
            <div className="min-w-0">
              <h2 className="font-bold text-amber-900 dark:text-amber-100">Falta aplicar la actualización de Supabase</h2>
              <p className="mt-1 text-sm text-amber-800/90 dark:text-amber-100/75">
                La configuración antigua ya se puede consultar, pero para guardar sucursales, varios WhatsApp y accesos rápidos debes ejecutar una vez el SQL de actualización.
              </p>
              <p className="mt-2 break-all rounded-lg bg-black/5 px-3 py-2 font-mono text-xs text-amber-950 dark:bg-black/20 dark:text-amber-100">
                supabase/migrations/20261002_store_contact_and_quick_access_settings.sql
              </p>
              <p className="mt-2 flex items-start gap-2 text-xs text-amber-800 dark:text-amber-100/80">
                <Info size={14} className="mt-0.5 shrink-0" /> Supabase → SQL Editor → pega el contenido del archivo → Run. Luego recarga esta página.
              </p>
            </div>
          </div>
        </section>
      ) : null}

      <fieldset disabled={!canEdit || saving} className="space-y-5 disabled:opacity-90">
        <Panel title="Identidad y acceso" description="Estos datos forman los enlaces públicos y de acceso a tu catálogo.">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Nombre de la tienda">
              <input className={inputClass()} style={inputStyle} value={store.name} onChange={(event) => patchStore({ name: event.target.value })} />
            </Field>
            <Field label="Dirección pública de la tienda" hint="Puedes escribir espacios, tildes y símbolos; al guardar se convertirán automáticamente en una dirección web segura.">
              <div className="flex gap-2">
                <input className={`${inputClass()} min-w-0`} style={inputStyle} value={store.slug} onChange={(event) => patchStore({ slug: event.target.value })} placeholder="Nombre de tu tienda" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
                <button type="button" className="btn-soft mt-1 shrink-0 rounded-xl px-3 text-xs font-bold" onClick={() => patchStore({ slug: normalizeStoreSlug(store.name) })}>Usar nombre</button>
              </div>
              <span className="mt-2 block break-all rounded-lg border px-3 py-2 font-mono text-xs font-normal" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg-soft)", color: "var(--t-muted)" }}>
                {siteOrigin}/{slugPreview || "tu-tienda"}/detal
              </span>
            </Field>
            <Field label="Llave secreta mayorista" hint="Solo quien tenga esta clave podrá abrir el catálogo mayorista. Al cambiarla, el enlace anterior dejará de funcionar.">
              <div className="flex gap-2">
                <input className={`${inputClass()} min-w-0 font-mono`} style={inputStyle} type={showKey ? "text" : "password"} value={store.wholesale_key ?? ""} onChange={(event) => patchStore({ wholesale_key: event.target.value || null })} autoComplete="new-password" />
                <button type="button" className="btn-soft mt-1 grid h-11 w-11 shrink-0 place-items-center rounded-xl" aria-label={showKey ? "Ocultar llave" : "Mostrar llave"} onClick={() => setShowKey((value) => !value)}>{showKey ? <EyeOff size={17} /> : <Eye size={17} />}</button>
                <button type="button" className="btn-soft mt-1 shrink-0 rounded-xl px-3 text-xs font-bold" onClick={generateWholesaleKey}>Generar</button>
              </div>
            </Field>
            <Field label="Tema del catálogo" hint="El tema elegido solo cambia el catálogo público de esta tienda.">
              <select className={inputClass()} style={inputStyle} value={store.theme ?? ""} onChange={(event) => patchStore({ theme: event.target.value || null })}>
                <option value="">Tema predeterminado</option>
                {themes.map((theme) => <option key={theme.id} value={theme.id}>{theme.name}{theme.active ? "" : " (inactivo)"}</option>)}
              </select>
            </Field>
          </div>
          <div
            className="overflow-hidden rounded-2xl border p-4 transition-all duration-300"
            style={{ borderColor: preview.border, background: preview.background, color: preview.text }}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-[10px] font-extrabold tracking-[0.2em]" style={{ color: preview.muted }}>VISTA PREVIA DEL CATÁLOGO</p>
                <p className="mt-1 text-lg font-black">{selectedTheme?.name ?? "Tema predeterminado"}</p>
              </div>
              <span className="rounded-full border px-3 py-1 text-xs font-bold" style={{ borderColor: preview.accent, color: preview.text, background: `color-mix(in srgb, ${preview.accent} 20%, transparent)` }}>
                Colores del tema
              </span>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
              <div className="rounded-xl border p-3" style={{ borderColor: preview.border, background: preview.card }}>
                <p className="font-bold">{store.name || "Nombre de tu tienda"}</p>
                <p className="mt-1 text-xs" style={{ color: preview.muted }}>Explora productos, novedades y puntos de atención.</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {["Encuéntranos", "Contáctanos"].map((label) => (
                    <span key={label} className="rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold" style={{ borderColor: preview.border, background: preview.card }}>{label}</span>
                  ))}
                </div>
              </div>
              <div className="flex flex-col justify-between gap-3 sm:w-44">
                <div className="flex gap-2">
                  {[preview.accent, preview.muted, preview.border].map((color, index) => (
                    <span key={`${color}-${index}`} className="h-7 flex-1 rounded-lg border" style={{ background: color, borderColor: preview.border }} />
                  ))}
                </div>
                <span className="rounded-xl px-4 py-2.5 text-center text-xs font-bold text-white shadow-lg" style={{ background: preview.cta }}>Botón principal</span>
              </div>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {[
              ["catalog_retail", "Catálogo detal", "Permite que tus clientes consulten precios al detal."],
              ["catalog_wholesale", "Catálogo mayorista", "Permite el acceso mayorista con la llave secreta."],
            ].map(([key, label, description]) => (
              <label key={key} className="flex items-start gap-3 rounded-2xl border p-4 transition hover:border-fuchsia-400/40" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg-soft)" }}>
                <input className="mt-1 h-4 w-4 accent-fuchsia-600" type="checkbox" checked={store[key as "catalog_retail" | "catalog_wholesale"]} onChange={(event) => patchStore({ [key]: event.target.checked })} />
                <span><b className="block text-sm">{label}</b><span className="mt-1 block text-xs" style={{ color: "var(--t-muted)" }}>{description}</span></span>
              </label>
            ))}
          </div>
        </Panel>

        <Panel title="Apariencia del catálogo" description="Sube imágenes que hagan reconocible tu marca en la página pública.">
          <div className="grid gap-4 lg:grid-cols-2">
            <ImageUpload label="Logo de tienda" currentUrl={store.logo_url} pathPrefix={`${store.id}/store/`} fileName="logo.png" onUploaded={(logo_url) => patchStore({ logo_url })} />
            <ImageUpload label="Banner del catálogo" currentUrl={store.banner_url} pathPrefix={`${store.id}/store/`} fileName="banner.png" onUploaded={(banner_url) => patchStore({ banner_url })} />
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Frase de bienvenida"><input className={inputClass()} style={inputStyle} maxLength={180} value={profile.headline} onChange={(event) => setProfile({ ...profile, headline: event.target.value })} placeholder="Ej: Calidad y estilo para cada día" /></Field>
            <Field label="Ciudad"><input className={inputClass()} style={inputStyle} maxLength={100} value={profile.city} onChange={(event) => setProfile({ ...profile, city: event.target.value })} placeholder="Ciudad" /></Field>
            <Field label="Dirección"><input className={inputClass()} style={inputStyle} maxLength={180} value={profile.address} onChange={(event) => setProfile({ ...profile, address: event.target.value })} placeholder="Dirección del local" /></Field>
          </div>
        </Panel>

        <Panel title="WhatsApp y pedidos" description="Configura asesores y puntos de atención. Tus clientes podrán identificar cada contacto por su icono y elegir el más cercano antes de enviar el pedido.">
          <div className="space-y-3">
            {profile.contact_channels.map((channel) => {
              const expanded = expandedContactId === channel.id;
              const contactName = channel.id === "primary" ? "WhatsApp principal" : channel.label.trim() || "Nuevo contacto";
              return (
                <div key={channel.id} className="overflow-hidden rounded-2xl border" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg-soft)", opacity: channel.active ? 1 : 0.68 }}>
                  <div className="flex items-center gap-2 p-2 sm:p-3">
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-2 py-1.5 text-left transition hover:bg-black/5 dark:hover:bg-white/5"
                      aria-expanded={expanded}
                      aria-controls={`contact-details-${channel.id}`}
                      onClick={() => setExpandedContactId(expanded ? null : channel.id)}
                    >
                      <StoreContactIcon icon={channel.icon} size={38} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5 truncate text-sm font-bold">
                          {contactName}
                          {channel.id === "primary" ? <Star size={14} className="shrink-0 fill-amber-400 text-amber-500" aria-label="Contacto principal" /> : null}
                        </span>
                        <span className="mt-0.5 block truncate text-xs" style={{ color: "var(--t-muted)" }}>{channel.phone || "Agrega un número de WhatsApp"} · {channel.active ? "Activo" : "Inactivo"}</span>
                      </span>
                      <span className="hidden text-xs font-semibold sm:inline" style={{ color: "var(--t-muted)" }}>{expanded ? "Ocultar" : "Editar"}</span>
                      <ChevronDown size={18} className={`shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`} />
                    </button>
                    <button
                      type="button"
                      aria-pressed={channel.active}
                      aria-label={`${channel.active ? "Desactivar" : "Activar"} ${contactName}`}
                      title={channel.active ? "Desactivar WhatsApp" : "Activar WhatsApp"}
                      onClick={() => patchContact(channel.id, { active: !channel.active })}
                      className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-500 focus-visible:ring-offset-2 ${
                        channel.active
                          ? "border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-200 dark:hover:bg-amber-500/20"
                          : "border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 dark:border-emerald-400/30 dark:bg-emerald-500/10 dark:text-emerald-200 dark:hover:bg-emerald-500/20"
                      }`}
                    >
                      <Power size={17} />
                    </button>
                    {channel.id !== "primary" ? (
                      <button type="button" className="btn-soft inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl px-3 text-xs font-bold text-rose-600 dark:text-rose-300" onClick={() => removeContact(channel.id)} aria-label={`Quitar ${contactName}`}><Trash2 size={15} /><span className="hidden sm:inline">Quitar</span></button>
                    ) : null}
                  </div>
                  {expanded ? (
                    <div id={`contact-details-${channel.id}`} className="grid gap-4 border-t p-4 md:grid-cols-2" style={{ borderColor: "var(--t-card-border)" }}>
                      <Field label={channel.id === "primary" ? "Nombre que verán los clientes" : "Nombre del contacto"}>
                        {channel.id === "primary" ? (
                          <div className={`${inputClass()} flex items-center gap-2`} style={inputStyle}>
                            <StoreContactIcon icon={channel.icon} size={20} />
                            <span className="font-bold">WhatsApp principal</span>
                            <Star size={15} className="ml-auto fill-amber-400 text-amber-500" aria-label="Contacto principal" />
                          </div>
                        ) : (
                          <input className={inputClass()} style={inputStyle} maxLength={48} value={channel.label} onChange={(event) => patchContact(channel.id, { label: event.target.value })} placeholder="Ej: Ventas, Sucursal norte" />
                        )}
                      </Field>
                      <Field label="Número de WhatsApp" hint="Incluye el código de país; por ejemplo +57.">
                        <input className={inputClass()} style={inputStyle} type="tel" inputMode="tel" maxLength={24} value={channel.phone} onChange={(event) => {
                          patchContact(channel.id, { phone: event.target.value });
                          if (channel.id === "primary") patchStore({ whatsapp: event.target.value });
                        }} placeholder="+57 300 123 4567" />
                      </Field>
                      <div className="space-y-2 md:col-span-2">
                        <p className="text-xs font-semibold">Elige el avatar que verán tus clientes en el carrito y el catálogo.</p>
                        <div className="space-y-3">
                          {[
                            { group: "other", title: "Otro" },
                            { group: "woman", title: "Avatares de mujer" },
                            { group: "man", title: "Avatares de hombre" },
                          ].map(({ group, title }) => {
                            const options = STORE_CONTACT_ICONS.filter((option) => option.group === group);
                            return (
                              <fieldset key={group}>
                                <legend className="mb-1.5 text-[11px] font-bold opacity-70">{title}</legend>
                                <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-7 xl:grid-cols-10">
                                  {options.map((option) => {
                                    const selected = channel.icon === option.value;
                                    return (
                                      <button
                                        key={option.value}
                                        type="button"
                                        onClick={() => patchContact(channel.id, { icon: option.value })}
                                        aria-pressed={selected}
                                        aria-label={`Usar avatar ${option.label}`}
                                        className="flex min-h-[5.75rem] min-w-0 flex-col items-center justify-center gap-1.5 rounded-2xl border p-2 text-center text-[10px] font-bold leading-tight transition hover:-translate-y-0.5"
                                        style={{
                                          borderColor: selected ? "var(--t-accent)" : "var(--t-card-border)",
                                          background: selected ? "color-mix(in oklab, var(--t-accent) 12%, var(--t-card-bg))" : "var(--t-card-bg)",
                                          boxShadow: selected ? "0 0 0 2px color-mix(in oklab, var(--t-accent) 22%, transparent)" : undefined,
                                        }}
                                      >
                                        <StoreContactIcon icon={option.value} size={44} />
                                        <span className="max-w-full truncate">{option.label}</span>
                                      </button>
                                    );
                                  })}
                                </div>
                              </fieldset>
                            );
                          })}
                        </div>
                        <div className="flex items-center gap-3 rounded-xl border p-3 md:col-span-2" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)" }}>
                          <StoreContactIcon icon={channel.icon} size={48} />
                          <span className="min-w-0">
                            <span className="block text-[10px] font-bold uppercase tracking-wide opacity-60">Vista previa en catálogo y carrito</span>
                            <span className="mt-0.5 block truncate text-xs font-bold">{contactName}</span>
                            <span className="block truncate text-[11px] opacity-70">{channel.phone.trim() || "Número de WhatsApp"}</span>
                          </span>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button type="button" onClick={addContact} className="btn-soft inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold"><Plus size={16} /> Agregar WhatsApp</button>
              <button
                type="button"
                onClick={() => void saveWhatsAppContacts()}
                disabled={!canEdit || savingContacts || saving}
                className="btn-cta inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Save size={16} /> {savingContacts ? "Guardando..." : "Guardar WhatsApp"}
              </button>
            </div>
          </div>
        </Panel>

        <Panel title="Encuéntranos" description="Estos enlaces se mostrarán en el botón fijo “Encuéntranos” del catálogo.">
          <div className="space-y-3">
            {links.map((link) => (
              <div key={link.id} className="grid gap-3 rounded-2xl border p-4 md:grid-cols-[160px_minmax(0,1fr)_minmax(0,1.4fr)_auto]" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg-soft)" }}>
                <Field label="Plataforma">
                  <select className={inputClass()} style={inputStyle} value={link.type} onChange={(event) => patchLink(link.id, { type: event.target.value })}>
                    {LINK_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </Field>
                <Field label="Nombre visible"><input className={inputClass()} style={inputStyle} maxLength={48} value={link.label} onChange={(event) => patchLink(link.id, { label: event.target.value })} placeholder="Ej: Instagram oficial" /></Field>
                <Field label="Enlace"><input className={inputClass()} style={inputStyle} type="url" value={link.url} onChange={(event) => patchLink(link.id, { url: event.target.value })} placeholder="https://..." /></Field>
                <div className="flex items-end gap-3 pb-1">
                  <label className="flex h-10 items-center gap-2 text-xs font-semibold"><input className="h-4 w-4 accent-fuchsia-600" type="checkbox" checked={link.active} onChange={(event) => patchLink(link.id, { active: event.target.checked })} /> Visible</label>
                  <button type="button" className="btn-soft grid h-10 w-10 place-items-center rounded-xl text-rose-600 dark:text-rose-300" aria-label={`Eliminar enlace ${link.label || link.type}`} onClick={() => removeLink(link)}><Trash2 size={16} /></button>
                </div>
              </div>
            ))}
            <button type="button" onClick={addLink} className="btn-soft inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold"><Plus size={16} /> Agregar red o enlace</button>
          </div>
        </Panel>

        <Panel title="Puntos para encontrarnos" description="Agrega sucursales, locales o puntos de entrega con ubicación, mapa, horarios en la descripción y fotos.">
          <div className="space-y-4">
            {profile.locations.map((location) => (
              <article key={location.id} className="rounded-2xl border p-4 sm:p-5" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg-soft)" }}>
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 font-bold"><MapPin size={17} className="text-fuchsia-500" /> Punto de atención</div>
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-2 text-xs font-semibold">
                      <input type="checkbox" className="h-4 w-4 accent-fuchsia-600" checked={location.active} onChange={(event) => patchLocation(location.id, { active: event.target.checked })} />
                      Visible en catálogo
                    </label>
                    <button type="button" className="btn-soft grid h-9 w-9 place-items-center rounded-xl text-rose-600 dark:text-rose-300" aria-label={`Eliminar punto ${location.name || "sin nombre"}`} onClick={() => removeLocation(location.id)}><Trash2 size={15} /></button>
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <Field label="Nombre del punto">
                    <input className={inputClass()} style={inputStyle} maxLength={72} value={location.name} onChange={(event) => patchLocation(location.id, { name: event.target.value })} placeholder="Ej: Sucursal Centro" />
                  </Field>
                  <Field label="Ciudad o municipio">
                    <input className={inputClass()} style={inputStyle} maxLength={100} value={location.city} onChange={(event) => patchLocation(location.id, { city: event.target.value })} placeholder="Ciudad" />
                  </Field>
                  <Field label="Dirección completa">
                    <input className={inputClass()} style={inputStyle} maxLength={180} value={location.address} onChange={(event) => patchLocation(location.id, { address: event.target.value })} placeholder="Calle, carrera, barrio, local…" />
                  </Field>
                  <Field label="Enlace de Google Maps (opcional)" hint="Pega el enlace para abrir indicaciones directas. El mapa se ubica usando la dirección.">
                    <input className={inputClass()} style={inputStyle} type="url" value={location.map_url} onChange={(event) => patchLocation(location.id, { map_url: event.target.value })} placeholder="https://maps.google.com/…" />
                  </Field>
                  <Field label="Detalle, horarios o referencia">
                    <textarea className={`${inputClass()} min-h-20 resize-y`} style={inputStyle} maxLength={240} value={location.description} onChange={(event) => patchLocation(location.id, { description: event.target.value })} placeholder="Horario, cómo llegar, punto de referencia…" />
                  </Field>
                  <Field label="URL de foto (opcional)" hint="También puedes subir una imagen en el espacio de abajo.">
                    <input className={inputClass()} style={inputStyle} type="url" value={location.photo_url} onChange={(event) => patchLocation(location.id, { photo_url: event.target.value })} placeholder="https://…" />
                  </Field>
                  <div className="sm:col-span-2 lg:col-span-3">
                    <ImageUpload
                      label={`Foto de ${location.name || "este punto"}`}
                      currentUrl={location.photo_url || null}
                      pathPrefix={`${store.id}/locations/${location.id}/`}
                      fileName="location.png"
                      onUploaded={(photo_url) => patchLocation(location.id, { photo_url })}
                    />
                  </div>
                </div>
              </article>
            ))}
            <button type="button" onClick={addLocation} className="btn-soft inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold"><Plus size={16} /> Agregar punto de atención</button>
          </div>
        </Panel>

        <Panel title="Enlaces de acceso" description="Abre o comparte tus catálogos y el acceso privado de tu equipo.">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {[
              ...(store.catalog_retail ? [["Catálogo detal", `/${store.slug}/detal`]] : []),
              ...(store.catalog_wholesale && store.wholesale_key ? [["Catálogo mayorista", `/${store.slug}/mayor?key=${encodeURIComponent(store.wholesale_key)}`]] : []),
              ["Acceso de equipo", `/acceso/${encodeURIComponent(store.slug)}?sid=${encodeURIComponent(store.id)}`],
            ].map(([label, path]) => (
              <div key={label} className="rounded-2xl border p-4" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg-soft)" }}>
                <p className="text-sm font-bold">{label}</p>
                <p className="mt-1 break-all text-xs" style={{ color: "var(--t-muted)" }}>{siteOrigin}{path}</p>
                <div className="mt-3 flex gap-2">
                  <a href={path} target="_blank" rel="noreferrer" className="btn-soft inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-bold"><Globe2 size={14} /> Abrir</a>
                  <button type="button" onClick={() => void copyLink(path)} className="btn-soft inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-bold"><Link2 size={14} /> Copiar</button>
                </div>
              </div>
            ))}
          </div>
          {store.catalog_wholesale && !store.wholesale_key ? <p className="text-xs text-amber-700 dark:text-amber-300">Configura primero la llave secreta para habilitar el enlace mayorista.</p> : null}
          <p className="text-xs" style={{ color: "var(--t-muted)" }}>
            Estado de la tienda: <b>{store.active ? "Activa" : "Inactiva"}</b>
            {store.active_until ? ` · Vigencia hasta ${new Date(store.active_until).toLocaleDateString("es-CO")}` : " · Sin vencimiento configurado"}.
            El estado de suscripción se administra desde el panel administrativo.
          </p>
        </Panel>

        <Panel title="Acceso rápido" description="Elige qué accesos mostrar como tarjetas en la página inicial del dashboard.">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {QUICK_ACCESS_OPTIONS.map(([key, label, icon]) => {
              const enabled = profile.quick_access.includes(key);
              return (
                <label key={key} className={`flex cursor-pointer items-center gap-3 rounded-2xl border p-3 transition ${enabled ? "border-fuchsia-400/40 bg-fuchsia-500/10" : ""}`} style={{ borderColor: enabled ? undefined : "var(--t-card-border)", background: enabled ? undefined : "var(--t-card-bg-soft)" }}>
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-fuchsia-600"
                    checked={enabled}
                    onChange={(event) => setProfile((current) => ({
                      ...current,
                      quick_access: event.target.checked
                        ? [...current.quick_access, key]
                        : current.quick_access.filter((item) => item !== key),
                    }))}
                  />
                  <span className="text-lg">{icon}</span>
                  <span className="text-sm font-semibold">{label}</span>
                </label>
              );
            })}
          </div>
          <p className="flex items-center gap-2 text-xs" style={{ color: "var(--t-muted)" }}><Globe2 size={14} /> Solo se muestran accesos para los que tu usuario tiene permiso.</p>
        </Panel>
      </fieldset>

      <div className="flex flex-wrap justify-end gap-3">
        <a href={`/${store.slug}/detal`} target="_blank" rel="noreferrer" className="btn-soft inline-flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-bold"><Link2 size={16} /> Vista previa del catálogo</a>
        <button type="button" onClick={() => void saveSettings()} disabled={!canEdit || saving} className="btn-cta inline-flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-bold disabled:opacity-50"><Save size={16} /> {saving ? "Guardando…" : "Guardar cambios"}</button>
      </div>
    </main>
  );
}
