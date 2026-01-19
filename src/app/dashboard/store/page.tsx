"use client";

import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { ImageUpload } from "./ImageUpload";

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

const THEMES = [
  { id: "ocean", name: "Ocean (Azul)" },
  { id: "forest", name: "Forest (Verde)" },
  { id: "sunset", name: "Sunset (Naranja)" },
  { id: "rose", name: "Rose (Rosa)" },
  { id: "midnight", name: "Midnight (Oscuro)" },
  { id: "lavender", name: "Lavender (Morado)" },
  { id: "mono", name: "Mono (Blanco/Negro)" },
  { id: "gold", name: "Gold (Dorado)" },
];

export default function StoreSettingsPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [store, setStore] = useState<Store | null>(null);
  const [profile, setProfile] = useState<StoreProfile | null>(null);
  const [links, setLinks] = useState<StoreLink[]>([]);
  const [userId, setUserId] = useState<string | null>(null);

  // Helpers UI: crear link nuevo localmente
  const newLinkTemplate = useMemo(
    () => ({
      id: "new-" + crypto.randomUUID(),
      store_id: store?.id ?? "",
      type: "instagram",
      label: "Instagram",
      url: "",
      sort_order: links.length,
      active: true,
    }),
    [store?.id, links.length],
  );

  useEffect(() => {
    (async () => {
      setMsg(null);
      const { data: userData } = await supabaseBrowser.auth.getUser();
      if (!userData.user) {
        router.push("/login");
        return;
      }
      setUserId(userData.user.id);

      // 1) Buscar la tienda del usuario (por owner_id)
      const { data: storeData, error: storeErr } = await supabaseBrowser
        .from("stores")
        .select("*")
        .eq("owner_id", userData.user.id)
        .maybeSingle();

      if (storeErr) {
        setMsg("❌ Error cargando tienda: " + storeErr.message);
        setLoading(false);
        return;
      }

      if (!storeData) {
        setMsg(
          "⚠️ Aún no tienes una tienda creada. (Luego haremos el flujo de solicitud/creación automática).",
        );
        setLoading(false);
        return;
      }

      setStore(storeData as Store);

      // 2) Cargar perfil
      const { data: profData, error: profErr } = await supabaseBrowser
        .from("store_profiles")
        .select("*")
        .eq("store_id", storeData.id)
        .maybeSingle();

      if (profErr) {
        setMsg("❌ Error cargando perfil: " + profErr.message);
      } else {
        // si no existe, creamos uno en memoria (se insertará al guardar)
        setProfile(
          (profData as StoreProfile) ?? {
            store_id: storeData.id,
            headline: "",
            description: "",
            address: "",
            city: "",
            department: "",
            google_maps_url: "",
            delivery_info: "",
            payment_methods: "",
            policies: "",
          },
        );
      }

      // 3) Cargar redes/links
      const { data: linksData, error: linksErr } = await supabaseBrowser
        .from("store_links")
        .select("*")
        .eq("store_id", storeData.id)
        .order("sort_order", { ascending: true });

      if (linksErr) setMsg("❌ Error cargando redes: " + linksErr.message);
      else setLinks((linksData as StoreLink[]) ?? []);

      setLoading(false);
    })();
  }, [router]);

  function setStoreField<K extends keyof Store>(key: K, value: Store[K]) {
    if (!store) return;
    setStore({ ...store, [key]: value });
  }

  function setProfileField<K extends keyof StoreProfile>(
    key: K,
    value: StoreProfile[K],
  ) {
    if (!profile) return;
    setProfile({ ...profile, [key]: value });
  }

  function addLink() {
  if (!store) return;

  setLinks([
    ...links,
    {
      ...newLinkTemplate,
      store_id: store.id,
      icon_url: null, // 👈 importante para "Otro"
    },
  ]);
}

  function updateLink(id: string, patch: Partial<StoreLink>) {
    setLinks((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }

  function removeLink(id: string) {
    setLinks((prev) => prev.filter((l) => l.id !== id));
  }

  async function saveAll() {
    if (!store || !profile) return;

    setSaving(true);
    setMsg(null);

    // Validación mínima
    if (!store.name.trim()) {
      setMsg("❌ El nombre es obligatorio.");
      setSaving(false);
      return;
    }
    if (!store.whatsapp.trim()) {
      setMsg("❌ El WhatsApp es obligatorio.");
      setSaving(false);
      return;
    }

    // 1) Guardar store
    const { error: storeErr } = await supabaseBrowser
      .from("stores")
      .update({
        name: store.name,
        whatsapp: store.whatsapp,
        phone: store.phone,
        email: store.email,
        active: store.active,
        catalog_retail: store.catalog_retail,
        catalog_wholesale: store.catalog_wholesale,
        theme: store.theme,
        logo_url: store.logo_url,
        banner_url: store.banner_url,
      })
      .eq("id", store.id);

    if (storeErr) {
      setMsg("❌ Error guardando tienda: " + storeErr.message);
      setSaving(false);
      return;
    }

    // 2) Upsert profile (insert si no existe / update si existe)
    const { error: profErr } = await supabaseBrowser
      .from("store_profiles")
      .upsert({
        store_id: store.id,
        headline: profile.headline,
        description: profile.description,
        address: profile.address,
        city: profile.city,
        department: profile.department,
        google_maps_url: profile.google_maps_url,
        delivery_info: profile.delivery_info,
        payment_methods: profile.payment_methods,
        policies: profile.policies,
      });

    if (profErr) {
      setMsg("❌ Error guardando perfil: " + profErr.message);
      setSaving(false);
      return;
    }

    // 3) Guardar links: separar nuevos vs existentes
    const newOnes = links.filter(
      (l) => l.id.startsWith("new-") && l.url.trim(),
    );
    const existing = links.filter((l) => !l.id.startsWith("new-"));

    if (newOnes.length) {
      const payload = newOnes.map((l, idx) => ({
        store_id: store.id,
        type: l.type,
        label: l.label,
        url: l.url,
        sort_order: l.sort_order ?? idx,
        active: l.active,
        icon_url: l.icon_url,
      }));

      const { error } = await supabaseBrowser
        .from("store_links")
        .insert(payload);
      if (error) {
        setMsg("❌ Error creando redes: " + error.message);
        setSaving(false);
        return;
      }
    }

    // Actualizar existentes (uno por uno; simple para empezar)
    for (const l of existing) {
      const { error } = await supabaseBrowser
        .from("store_links")
        .update({
          type: l.type,
          label: l.label,
          url: l.url,
          sort_order: l.sort_order,
          active: l.active,
          icon_url: l.icon_url,
        })
        .eq("id", l.id);

      if (error) {
        setMsg("❌ Error actualizando una red: " + error.message);
        setSaving(false);
        return;
      }
    }

    setMsg("✅ Guardado correctamente.");
    setSaving(false);

    // recargar links para obtener IDs reales de los nuevos
    const { data: linksData } = await supabaseBrowser
      .from("store_links")
      .select("*")
      .eq("store_id", store.id)
      .order("sort_order", { ascending: true });
    setLinks((linksData as StoreLink[]) ?? []);
  }

  if (loading) {
    return (
      <main className="p-6">
        <p>Cargando...</p>
      </main>
    );
  }

  if (!store || !profile) {
    return (
      <main className="p-6">
        <h1 className="text-2xl font-bold">Mi tienda</h1>
        <p className="mt-4">{msg ?? "No hay tienda."}</p>
      </main>
    );
  }

  return (
    <main className="p-6 space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Mi tienda</h1>
        <button
          className="rounded-xl bg-white text-black px-4 py-2 font-semibold disabled:opacity-60"
          onClick={saveAll}
          disabled={saving}
        >
          {saving ? "Guardando..." : "Guardar cambios"}
        </button>
      </div>

      {msg && <p className="text-sm">{msg}</p>}

      {/* Básico */}
      <section className="rounded-2xl border border-white/10 p-4">
        <h2 className="text-lg font-semibold">Datos básicos</h2>

        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="text-sm opacity-80">Nombre</label>
            <input
              className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 p-3 outline-none"
              value={store.name}
              onChange={(e) => setStoreField("name", e.target.value)}
            />
          </div>

          <div>
            <label className="text-sm opacity-80">WhatsApp (57...)</label>
            <input
              className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 p-3 outline-none"
              value={store.whatsapp}
              onChange={(e) => setStoreField("whatsapp", e.target.value)}
            />
          </div>

          <div>
            <label className="text-sm opacity-80">Teléfono</label>
            <input
              className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 p-3 outline-none"
              value={store.phone ?? ""}
              onChange={(e) => setStoreField("phone", e.target.value)}
            />
          </div>

          <div>
            <label className="text-sm opacity-80">Email</label>
            <input
              className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 p-3 outline-none"
              value={store.email ?? ""}
              onChange={(e) => setStoreField("email", e.target.value)}
            />
          </div>
        </div>
      </section>

      {/* Catálogos + tema */}
      <section className="rounded-2xl border border-white/10 p-4">
        <h2 className="text-lg font-semibold">Catálogos y apariencia</h2>

        <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
          <label className="flex items-center gap-3 rounded-xl border border-white/10 p-3">
            <input
              type="checkbox"
              checked={store.catalog_retail}
              onChange={(e) =>
                setStoreField("catalog_retail", e.target.checked)
              }
            />
            <span>Catálogo Detal activo</span>
          </label>

          <label className="flex items-center gap-3 rounded-xl border border-white/10 p-3">
            <input
              type="checkbox"
              checked={store.catalog_wholesale}
              onChange={(e) =>
                setStoreField("catalog_wholesale", e.target.checked)
              }
            />
            <span>Catálogo Mayor activo</span>
          </label>

          <div className="rounded-xl border border-white/10 p-3">
            <label className="text-sm opacity-80">Tema (paleta)</label>
            <select
              className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 p-3 outline-none"
              value={store.theme}
              onChange={(e) => setStoreField("theme", e.target.value)}
            >
              {THEMES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      {/* Perfil */}
      <section className="rounded-2xl border border-white/10 p-4">
        <h2 className="text-lg font-semibold">Perfil público</h2>

        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="md:col-span-2">
            <label className="text-sm opacity-80">Frase corta (headline)</label>
            <input
              className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 p-3 outline-none"
              value={profile.headline ?? ""}
              onChange={(e) => setProfileField("headline", e.target.value)}
            />
          </div>

          <div className="md:col-span-2">
            <label className="text-sm opacity-80">Descripción</label>
            <textarea
              className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 p-3 outline-none min-h-[120px]"
              value={profile.description ?? ""}
              onChange={(e) => setProfileField("description", e.target.value)}
            />
          </div>

          <div>
            <label className="text-sm opacity-80">Dirección</label>
            <input
              className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 p-3 outline-none"
              value={profile.address ?? ""}
              onChange={(e) => setProfileField("address", e.target.value)}
            />
          </div>

          <div>
            <label className="text-sm opacity-80">Ciudad</label>
            <input
              className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 p-3 outline-none"
              value={profile.city ?? ""}
              onChange={(e) => setProfileField("city", e.target.value)}
            />
          </div>

          <div>
            <label className="text-sm opacity-80">Departamento</label>
            <input
              className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 p-3 outline-none"
              value={profile.department ?? ""}
              onChange={(e) => setProfileField("department", e.target.value)}
            />
          </div>

          <div>
            <label className="text-sm opacity-80">Link Google Maps</label>
            <input
              className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 p-3 outline-none"
              value={profile.google_maps_url ?? ""}
              onChange={(e) =>
                setProfileField("google_maps_url", e.target.value)
              }
            />
          </div>

          <div className="md:col-span-2">
            <label className="text-sm opacity-80">Envíos</label>
            <textarea
              className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 p-3 outline-none min-h-[90px]"
              value={profile.delivery_info ?? ""}
              onChange={(e) => setProfileField("delivery_info", e.target.value)}
            />
          </div>

          <div className="md:col-span-2">
            <label className="text-sm opacity-80">Métodos de pago</label>
            <textarea
              className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 p-3 outline-none min-h-[90px]"
              value={profile.payment_methods ?? ""}
              onChange={(e) =>
                setProfileField("payment_methods", e.target.value)
              }
            />
          </div>

          <div className="md:col-span-2">
            <label className="text-sm opacity-80">
              Políticas (garantías, devoluciones)
            </label>
            <textarea
              className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 p-3 outline-none min-h-[90px]"
              value={profile.policies ?? ""}
              onChange={(e) => setProfileField("policies", e.target.value)}
            />
          </div>
        </div>
      </section>

      {/* Redes */}
      <section className="rounded-2xl border border-white/10 p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Redes sociales y enlaces</h2>
          <button
            className="rounded-xl border border-white/10 px-3 py-2"
            onClick={addLink}
          >
            + Agregar red
          </button>
        </div>

        <div className="mt-4 space-y-3">
          {links.length === 0 && (
            <p className="text-sm opacity-80">
              Aún no tienes redes. Agrega Instagram, Facebook, TikTok, web, etc.
            </p>
          )}

          {links.map((l) => (
            <div
              key={l.id}
              className="grid grid-cols-1 md:grid-cols-5 gap-2 rounded-xl border border-white/10 p-3"
            >
              <select
                className="rounded-xl border border-white/10 bg-black/30 p-3 outline-none"
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
                className="rounded-xl border border-white/10 bg-black/30 p-3 outline-none"
                placeholder="Etiqueta (opcional)"
                value={l.label ?? ""}
                onChange={(e) => updateLink(l.id, { label: e.target.value })}
              />

              <input
                className="md:col-span-2 rounded-xl border border-white/10 bg-black/30 p-3 outline-none"
                placeholder="URL"
                value={l.url}
                onChange={(e) => updateLink(l.id, { url: e.target.value })}
              />
              {l.type === "other" && userId && (
                <div className="md:col-span-5 rounded-xl border border-white/10 p-3">
                  <p className="text-sm opacity-80 mb-2">
                    Icono personalizado (solo para “Otro”)
                  </p>

                  <ImageUpload
                    label="Icono"
                    currentUrl={l.icon_url}
                    pathPrefix={`${userId}/links/`}
                    fileName={`${l.id}.png`}
                    onUploaded={(url) => updateLink(l.id, { icon_url: url })}
                  />
                </div>
              )}

              <div className="flex items-center justify-between gap-2">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={l.active}
                    onChange={(e) =>
                      updateLink(l.id, { active: e.target.checked })
                    }
                  />
                  Activo
                </label>

                <button
                  className="rounded-xl border border-white/10 px-3 py-2"
                  onClick={() => removeLink(l.id)}
                >
                  Eliminar
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Nota logo/banner */}
      <section className="rounded-2xl border border-white/10 p-4">
        <h2 className="text-lg font-semibold">Logo y banner</h2>
        <p className="mt-2 text-sm opacity-80">
          Sube tus imágenes y luego guarda cambios para que queden fijas en tu
          tienda.
        </p>

        {!userId ? (
          <p className="mt-4 text-sm">Cargando usuario...</p>
        ) : (
          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
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
        )}
      </section>
    </main>
  );
}
