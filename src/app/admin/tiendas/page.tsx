"use client";

import { useEffect, useMemo, useState } from "react";
import Swal from "sweetalert2";
import { supabaseBrowser } from "@/lib/supabase/client";

type Store = {
  id: string;
  name: string;
  slug: string;
  whatsapp: string;
  owner_id: string;
  active: boolean;
  catalog_retail: boolean;
  catalog_wholesale: boolean;
  wholesale_key: string | null;
  created_at: string;
};

function inputBase() {
  return "rounded-2xl border border-white/10 bg-white/5 p-3 text-sm outline-none placeholder:text-white/40 backdrop-blur-xl";
}

function buttonGhost() {
  return "rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white/90 backdrop-blur-xl transition hover:bg-white/10 disabled:opacity-60";
}

function buttonPrimary() {
  return "rounded-2xl border border-fuchsia-400/30 bg-fuchsia-500/15 px-4 py-2 text-sm font-semibold text-fuchsia-100 shadow-[0_0_22px_rgba(217,70,239,0.15)] transition hover:bg-fuchsia-500/25 disabled:opacity-60";
}

function buttonWarn() {
  return "rounded-2xl border border-amber-400/30 bg-amber-400/10 px-4 py-2 text-sm font-semibold text-amber-100 transition hover:bg-amber-400/15 disabled:opacity-60";
}

function buttonDanger() {
  return "rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm font-semibold text-red-200 transition hover:bg-red-500/15 disabled:opacity-60";
}

function pill(on: boolean) {
  return on
    ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-100"
    : "border-white/10 bg-white/5 text-white/70";
}

function slugifyHint(v: string) {
  return (v || "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

export default function AdminTiendasPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [q, setQ] = useState("");
  const [stores, setStores] = useState<Store[]>([]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return stores;
    return stores.filter((x) =>
      `${x.name} ${x.slug} ${x.whatsapp} ${x.owner_id}`
        .toLowerCase()
        .includes(s)
    );
  }, [q, stores]);

  async function load() {
    setLoading(true);
    try {
      const sb = supabaseBrowser();

      const { data, error } = await sb
        .from("stores")
        .select(
          "id,name,slug,whatsapp,owner_id,active,catalog_retail,catalog_wholesale,wholesale_key,created_at"
        )
        .order("created_at", { ascending: false });

      if (error) throw error;
      setStores((data as Store[]) ?? []);
    } catch (e: any) {
      await Swal.fire({
        icon: "error",
        title: "Error cargando tiendas",
        text: e?.message ?? "Error",
        background: "#0b0b0b",
        color: "#fff",
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function patch(id: string, p: Partial<Store>) {
    setStores((prev) => prev.map((s) => (s.id === id ? { ...s, ...p } : s)));
  }

  async function saveStore(s: Store) {
    setSaving(true);
    try {
      const sb = supabaseBrowser();

      const { error } = await sb
        .from("stores")
        .update({
          name: s.name,
          slug: s.slug,
          whatsapp: s.whatsapp,
          active: s.active,
          catalog_retail: s.catalog_retail,
          catalog_wholesale: s.catalog_wholesale,
          wholesale_key: s.wholesale_key,
        })
        .eq("id", s.id);

      if (error) throw error;

      await Swal.fire({
        icon: "success",
        title: "Guardado",
        text: "Tienda actualizada.",
        timer: 1100,
        showConfirmButton: false,
        background: "#0b0b0b",
        color: "#fff",
      });
    } catch (e: any) {
      await Swal.fire({
        icon: "error",
        title: "No se pudo guardar",
        text: e?.message ?? "Error",
        background: "#0b0b0b",
        color: "#fff",
        confirmButtonColor: "#ef4444",
      });
    } finally {
      setSaving(false);
    }
  }

  async function changeOwner(s: Store) {
    const res = await Swal.fire({
      icon: "warning",
      title: "Cambiar dueño (owner_id)",
      html: `
        <div style="text-align:left; opacity:.9">
          <div style="margin-bottom:10px">
            Tienda: <b>${s.name}</b><br/>
            <span style="opacity:.7; font-size:12px">Pega aquí el UUID del nuevo usuario.</span>
          </div>
          <input id="newOwner" class="swal2-input" placeholder="Nuevo owner_id (uuid)" value="${s.owner_id}">
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: "Transferir",
      cancelButtonText: "Cancelar",
      background: "#0b0b0b",
      color: "#fff",
      confirmButtonColor: "#f59e0b",
      preConfirm: () => {
        const v = (document.getElementById("newOwner") as HTMLInputElement).value.trim();
        if (!v) {
          Swal.showValidationMessage("Escribe un uuid válido.");
          return;
        }
        return v;
      },
    });

    if (!res.isConfirmed) return;

    setSaving(true);
    try {
      const sb = supabaseBrowser();

      const { error } = await sb.from("stores").update({ owner_id: res.value }).eq("id", s.id);
      if (error) throw error;

      patch(s.id, { owner_id: res.value });

      await Swal.fire({
        icon: "success",
        title: "Transferida",
        text: "Owner actualizado.",
        timer: 1100,
        showConfirmButton: false,
        background: "#0b0b0b",
        color: "#fff",
      });
    } catch (e: any) {
      await Swal.fire({
        icon: "error",
        title: "No se pudo transferir",
        text: e?.message ?? "Error",
        background: "#0b0b0b",
        color: "#fff",
        confirmButtonColor: "#ef4444",
      });
    } finally {
      setSaving(false);
    }
  }

  async function deleteStore(s: Store) {
    const res = await Swal.fire({
      icon: "warning",
      title: "Eliminar tienda",
      text: `Se eliminará "${s.name}". Esto puede afectar pedidos/productos.`,
      showCancelButton: true,
      confirmButtonText: "Sí, eliminar",
      cancelButtonText: "Cancelar",
      confirmButtonColor: "#ef4444",
      background: "#0b0b0b",
      color: "#fff",
    });
    if (!res.isConfirmed) return;

    setSaving(true);
    try {
      const sb = supabaseBrowser();

      const { error } = await sb.from("stores").delete().eq("id", s.id);
      if (error) throw error;

      setStores((prev) => prev.filter((x) => x.id !== s.id));

      await Swal.fire({
        icon: "success",
        title: "Eliminada",
        timer: 900,
        showConfirmButton: false,
        background: "#0b0b0b",
        color: "#fff",
      });
    } catch (e: any) {
      await Swal.fire({
        icon: "error",
        title: "No se pudo eliminar",
        text: e?.message ?? "Error",
        background: "#0b0b0b",
        color: "#fff",
      });
    } finally {
      setSaving(false);
    }
  }

  async function createStore() {
    const res = await Swal.fire({
      title: "Crear tienda",
      html: `
        <div style="text-align:left; opacity:.9">
          <div style="opacity:.75; font-size:12px; margin-bottom:8px">
            Consejo: el <b>slug</b> es el link público. Ej: <code>mi-tienda</code>
          </div>

          <input id="name" class="swal2-input" placeholder="Nombre">
          <input id="slug" class="swal2-input" placeholder="Slug (ej: mi-tienda)">
          <input id="wa" class="swal2-input" placeholder="WhatsApp (57300...)">
          <input id="owner" class="swal2-input" placeholder="Owner ID (uuid del usuario)">
        </div>
      `,
      focusConfirm: false,
      showCancelButton: true,
      confirmButtonText: "Crear",
      cancelButtonText: "Cancelar",
      background: "#0b0b0b",
      color: "#fff",
      preConfirm: () => {
        const name = (document.getElementById("name") as HTMLInputElement).value.trim();
        const slug = (document.getElementById("slug") as HTMLInputElement).value.trim();
        const whatsapp = (document.getElementById("wa") as HTMLInputElement).value.trim();
        const owner_id = (document.getElementById("owner") as HTMLInputElement).value.trim();

        if (!name || !slug || !whatsapp || !owner_id) {
          Swal.showValidationMessage("Completa todos los campos.");
          return;
        }
        return { name, slug, whatsapp, owner_id };
      },
    });

    if (!res.isConfirmed) return;

    setSaving(true);
    try {
      const sb = supabaseBrowser();

      const { data, error } = await sb
        .from("stores")
        .insert({
          name: res.value.name,
          slug: res.value.slug,
          whatsapp: res.value.whatsapp,
          owner_id: res.value.owner_id,
          active: true,
          catalog_retail: true,
          catalog_wholesale: true,
          theme: "ocean",
          ui_radius: 12,
        })
        .select(
          "id,name,slug,whatsapp,owner_id,active,catalog_retail,catalog_wholesale,wholesale_key,created_at"
        )
        .single();

      if (error) throw error;

      setStores((prev) => [data as Store, ...prev]);

      await Swal.fire({
        icon: "success",
        title: "Tienda creada",
        timer: 1000,
        showConfirmButton: false,
        background: "#0b0b0b",
        color: "#fff",
      });
    } catch (e: any) {
      await Swal.fire({
        icon: "error",
        title: "No se pudo crear",
        text: e?.message ?? "Error",
        background: "#0b0b0b",
        color: "#fff",
      });
    } finally {
      setSaving(false);
    }
  }

  function openRetail(s: Store) {
    window.open(`/${s.slug}/detal`, "_blank");
  }

  async function openWholesale(s: Store) {
    if (!s.wholesale_key) {
      await Swal.fire({
        icon: "info",
        title: "Falta clave mayorista",
        text: "Esta tienda no tiene wholesale_key configurada.",
        background: "#0b0b0b",
        color: "#fff",
      });
      return;
    }
    const url = `/${s.slug}/mayor?key=${encodeURIComponent(s.wholesale_key)}`;
    window.open(url, "_blank");
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-2xl font-semibold">🏪 Tiendas</h2>
          <p className="text-sm text-white/70">
            Crear · editar · activar/inactivar · catálogos · transferir owner.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button className={buttonGhost()} onClick={load} disabled={saving}>
            Recargar
          </button>

          <button className={buttonPrimary()} onClick={createStore} disabled={saving}>
            + Nueva
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="rounded-[28px] border border-white/10 bg-white/5 p-3 backdrop-blur-xl">
        <input
          className="w-full bg-transparent outline-none placeholder:text-white/45"
          placeholder="Buscar por nombre, slug, whatsapp, owner..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {q ? (
          <div className="mt-2 text-xs text-white/50">
            Tip: si escribes el nombre, te sugiero slug:{" "}
            <span className="text-fuchsia-200 font-semibold">{slugifyHint(q)}</span>
          </div>
        ) : null}
      </div>

      {/* Content */}
      {loading ? (
        <div className="rounded-[28px] border border-white/10 bg-white/5 p-6 text-sm text-white/70">
          Cargando...
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-[28px] border border-white/10 bg-white/5 p-6">
          <p className="font-semibold">No hay tiendas</p>
          <p className="mt-1 text-sm text-white/70">Crea una con “+ Nueva”.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((s) => (
            <div
              key={s.id}
              className="rounded-[28px] border border-white/10 bg-white/5 p-4 backdrop-blur-xl"
            >
              {/* Top row */}
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-lg font-semibold">{s.name}</p>

                    <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/80">
                      /{s.slug}
                    </span>

                    <span
                      className={`rounded-full border px-3 py-1 text-xs font-semibold ${pill(
                        s.active
                      )}`}
                    >
                      {s.active ? "Activa" : "Inactiva"}
                    </span>
                  </div>

                  <p className="mt-1 text-sm text-white/70">
                    WhatsApp: <b className="text-white/90">{s.whatsapp}</b>
                  </p>

                  <p className="mt-1 text-xs text-white/50">
                    Owner: {s.owner_id} · Creada:{" "}
                    {new Date(s.created_at).toLocaleString("es-CO")}
                  </p>
                </div>

                {/* Quick actions */}
                <div className="flex flex-wrap gap-2">
                  <button className={buttonGhost()} onClick={() => openRetail(s)}>
                    Abrir Detal
                  </button>

                  <button
                    className={buttonGhost()}
                    onClick={() => openWholesale(s)}
                    disabled={!s.catalog_wholesale}
                    title={!s.catalog_wholesale ? "Catálogo mayor desactivado" : ""}
                  >
                    Abrir Mayor
                  </button>

                  <button className={buttonPrimary()} onClick={() => saveStore(s)} disabled={saving}>
                    Guardar
                  </button>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                <div>
                  <label className="text-xs text-white/70">Nombre</label>
                  <input
                    className={inputBase() + " mt-1 w-full"}
                    value={s.name}
                    onChange={(e) => patch(s.id, { name: e.target.value })}
                  />
                </div>

                <div>
                  <label className="text-xs text-white/70">Slug</label>
                  <input
                    className={inputBase() + " mt-1 w-full"}
                    value={s.slug}
                    onChange={(e) => patch(s.id, { slug: e.target.value })}
                  />
                  <p className="mt-1 text-xs text-white/45">
                    Link: <span className="text-fuchsia-200">/{s.slug}</span>
                  </p>
                </div>

                <div>
                  <label className="text-xs text-white/70">WhatsApp</label>
                  <input
                    className={inputBase() + " mt-1 w-full"}
                    value={s.whatsapp}
                    onChange={(e) => patch(s.id, { whatsapp: e.target.value })}
                  />
                </div>

                <div>
                  <label className="text-xs text-white/70">Wholesale key (opcional)</label>
                  <input
                    className={inputBase() + " mt-1 w-full"}
                    value={s.wholesale_key ?? ""}
                    onChange={(e) => patch(s.id, { wholesale_key: e.target.value || null })}
                    placeholder="Ej: CLAVE-123"
                  />
                </div>
              </div>

              {/* Switches */}
              <div className="mt-4 flex flex-wrap gap-2">
                <label className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs ${pill(s.active)}`}>
                  <input
                    type="checkbox"
                    checked={s.active}
                    onChange={(e) => patch(s.id, { active: e.target.checked })}
                  />
                  Activa
                </label>

                <label
                  className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs ${pill(
                    s.catalog_retail
                  )}`}
                >
                  <input
                    type="checkbox"
                    checked={s.catalog_retail}
                    onChange={(e) => patch(s.id, { catalog_retail: e.target.checked })}
                  />
                  Catálogo Detal
                </label>

                <label
                  className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs ${pill(
                    s.catalog_wholesale
                  )}`}
                >
                  <input
                    type="checkbox"
                    checked={s.catalog_wholesale}
                    onChange={(e) => patch(s.id, { catalog_wholesale: e.target.checked })}
                  />
                  Catálogo Mayor
                </label>
              </div>

              {/* Danger zone */}
              <div className="mt-4 flex flex-wrap gap-2">
                <button className={buttonWarn()} onClick={() => changeOwner(s)} disabled={saving}>
                  Cambiar owner
                </button>

                <button className={buttonDanger()} onClick={() => deleteStore(s)} disabled={saving}>
                  Eliminar
                </button>
              </div>
            </div>
          ))}

          <p className="text-xs text-white/50">
            Mostrando {filtered.length} tienda(s).
          </p>
        </div>
      )}
    </div>
  );
}
