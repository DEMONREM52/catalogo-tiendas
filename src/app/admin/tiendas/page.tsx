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

export default function AdminTiendasPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [q, setQ] = useState("");
  const [stores, setStores] = useState<Store[]>([]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return stores;
    return stores.filter((x) =>
      (x.name + " " + x.slug + " " + x.whatsapp + " " + x.owner_id)
        .toLowerCase()
        .includes(s),
    );
  }, [q, stores]);

  async function load() {
    setLoading(true);
    const { data, error } = await supabaseBrowser
      .from("stores")
      .select(
        "id,name,slug,whatsapp,owner_id,active,catalog_retail,catalog_wholesale,wholesale_key,created_at",
      )
      .order("created_at", { ascending: false });

    if (error) {
      await Swal.fire({
        icon: "error",
        title: "Error cargando tiendas",
        text: error.message,
        background: "#0b0b0b",
        color: "#fff",
      });
      setLoading(false);
      return;
    }

    setStores((data as Store[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  function patch(id: string, p: Partial<Store>) {
    setStores((prev) => prev.map((s) => (s.id === id ? { ...s, ...p } : s)));
  }

  async function saveStore(s: Store) {
    setSaving(true);
    const { error } = await supabaseBrowser
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

    setSaving(false);

    if (error) {
      await Swal.fire({
        icon: "error",
        title: "No se pudo guardar",
        text: error.message,
        background: "#0b0b0b",
        color: "#fff",
        confirmButtonColor: "#ef4444",
      });
      return;
    }

    await Swal.fire({
      icon: "success",
      title: "Guardado",
      text: "Tienda actualizada.",
      timer: 1200,
      showConfirmButton: false,
      background: "#0b0b0b",
      color: "#fff",
    });
  }

  async function changeOwner(s: Store) {
    const res = await Swal.fire({
      icon: "warning",
      title: "Cambiar dueño (owner_id)",
      html: `
        <p style="margin:0 0 8px 0; opacity:.85">Tienda: <b>${s.name}</b></p>
        <input id="newOwner" class="swal2-input" placeholder="Nuevo owner_id (uuid)" value="${s.owner_id}">
      `,
      showCancelButton: true,
      confirmButtonText: "Transferir",
      cancelButtonText: "Cancelar",
      background: "#0b0b0b",
      color: "#fff",
      confirmButtonColor: "#f59e0b",
      preConfirm: () => {
        const v = (
          document.getElementById("newOwner") as HTMLInputElement
        ).value.trim();
        if (!v) {
          Swal.showValidationMessage("Escribe un uuid válido.");
          return;
        }
        return v;
      },
    });

    if (!res.isConfirmed) return;

    setSaving(true);
    const { error } = await supabaseBrowser
      .from("stores")
      .update({ owner_id: res.value })
      .eq("id", s.id);

    setSaving(false);

    if (error) {
      await Swal.fire({
        icon: "error",
        title: "No se pudo transferir",
        text: error.message,
        background: "#0b0b0b",
        color: "#fff",
        confirmButtonColor: "#ef4444",
      });
      return;
    }

    patch(s.id, { owner_id: res.value });

    await Swal.fire({
      icon: "success",
      title: "Transferida",
      text: "Owner actualizado.",
      timer: 1200,
      showConfirmButton: false,
      background: "#0b0b0b",
      color: "#fff",
    });
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
    const { error } = await supabaseBrowser
      .from("stores")
      .delete()
      .eq("id", s.id);
    setSaving(false);

    if (error) {
      await Swal.fire({
        icon: "error",
        title: "No se pudo eliminar",
        text: error.message,
        background: "#0b0b0b",
        color: "#fff",
      });
      return;
    }

    setStores((prev) => prev.filter((x) => x.id !== s.id));
    await Swal.fire({
      icon: "success",
      title: "Eliminada",
      timer: 1000,
      showConfirmButton: false,
      background: "#0b0b0b",
      color: "#fff",
    });
  }

  async function createStore() {
    const res = await Swal.fire({
      title: "Crear tienda",
      html: `
        <input id="name" class="swal2-input" placeholder="Nombre">
        <input id="slug" class="swal2-input" placeholder="Slug (ej: tienda-demo)">
        <input id="wa" class="swal2-input" placeholder="WhatsApp (57300...)">
        <input id="owner" class="swal2-input" placeholder="Owner ID (uuid del usuario)">
      `,
      focusConfirm: false,
      showCancelButton: true,
      confirmButtonText: "Crear",
      cancelButtonText: "Cancelar",
      background: "#0b0b0b",
      color: "#fff",
      preConfirm: () => {
        const name = (
          document.getElementById("name") as HTMLInputElement
        ).value.trim();
        const slug = (
          document.getElementById("slug") as HTMLInputElement
        ).value.trim();
        const whatsapp = (
          document.getElementById("wa") as HTMLInputElement
        ).value.trim();
        const owner_id = (
          document.getElementById("owner") as HTMLInputElement
        ).value.trim();
        if (!name || !slug || !whatsapp || !owner_id) {
          Swal.showValidationMessage("Completa todos los campos.");
          return;
        }
        return { name, slug, whatsapp, owner_id };
      },
    });

    if (!res.isConfirmed) return;

    setSaving(true);
    const { data, error } = await supabaseBrowser
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
        "id,name,slug,whatsapp,owner_id,active,catalog_retail,catalog_wholesale,wholesale_key,created_at",
      )
      .single();

    setSaving(false);

    if (error) {
      await Swal.fire({
        icon: "error",
        title: "No se pudo crear",
        text: error.message,
        background: "#0b0b0b",
        color: "#fff",
      });
      return;
    }

    setStores((prev) => [data as Store, ...prev]);
    await Swal.fire({
      icon: "success",
      title: "Tienda creada",
      timer: 1000,
      showConfirmButton: false,
      background: "#0b0b0b",
      color: "#fff",
    });
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Tiendas</h2>
          <p className="text-sm opacity-80">
            Crear/editar/activar/inactivar/eliminar + transferir owner.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            className="rounded-xl border border-white/10 px-4 py-2"
            onClick={load}
            disabled={saving}
          >
            Recargar
          </button>
          <button
            className="rounded-xl bg-white text-black px-4 py-2 font-semibold"
            onClick={createStore}
            disabled={saving}
          >
            + Nueva
          </button>
        </div>
      </div>

      <div className="mt-4">
        <input
          className="w-full rounded-xl border border-white/10 bg-black/30 p-3 outline-none"
          placeholder="Buscar tienda..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {loading ? (
        <p className="mt-4">Cargando...</p>
      ) : (
        <div className="mt-4 space-y-4">
          {filtered.map((s) => (
            <div key={s.id} className="rounded-2xl border border-white/10 p-4">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div>
                  <label className="text-xs opacity-70">Nombre</label>
                  <input
                    className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 p-3 outline-none"
                    value={s.name}
                    onChange={(e) => patch(s.id, { name: e.target.value })}
                  />
                </div>

                <div>
                  <label className="text-xs opacity-70">Slug</label>
                  <input
                    className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 p-3 outline-none"
                    value={s.slug}
                    onChange={(e) => patch(s.id, { slug: e.target.value })}
                  />
                </div>

                <div>
                  <label className="text-xs opacity-70">WhatsApp</label>
                  <input
                    className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 p-3 outline-none"
                    value={s.whatsapp}
                    onChange={(e) => patch(s.id, { whatsapp: e.target.value })}
                  />
                </div>

                <div>
                  <label className="text-xs opacity-70">Mayoristas key</label>
                  <input
                    className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 p-3 outline-none"
                    value={s.wholesale_key ?? ""}
                    onChange={(e) =>
                      patch(s.id, { wholesale_key: e.target.value || null })
                    }
                    placeholder="(opcional)"
                  />
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-3 text-sm">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={s.active}
                    onChange={(e) => patch(s.id, { active: e.target.checked })}
                  />
                  Activa
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={s.catalog_retail}
                    onChange={(e) =>
                      patch(s.id, { catalog_retail: e.target.checked })
                    }
                  />
                  Catálogo detal
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={s.catalog_wholesale}
                    onChange={(e) =>
                      patch(s.id, { catalog_wholesale: e.target.checked })
                    }
                  />
                  Catálogo mayor
                </label>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  className="rounded-xl bg-white text-black px-4 py-2 font-semibold"
                  onClick={() => saveStore(s)}
                  disabled={saving}
                >
                  Guardar
                </button>

                <a
                  href={`/${s.slug}/detal`}
                  target="_blank"
                  className="rounded-xl border border-white/10 px-4 py-2"
                >
                  Abrir catálogo Detal
                </a>

                <a
                  href={`/${s.slug}/mayor`}
                  target="_blank"
                  className="rounded-xl border border-white/10 px-4 py-2"
                >
                  Abrir catálogo Mayor
                </a>

                <button
                  className="rounded-xl border border-yellow-500/30 bg-yellow-500/10 px-4 py-2 font-semibold text-yellow-200"
                  onClick={() => changeOwner(s)}
                  disabled={saving}
                >
                  Cambiar owner
                </button>

                <button
                  className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 font-semibold text-red-200"
                  onClick={() => deleteStore(s)}
                  disabled={saving}
                >
                  Eliminar
                </button>
              </div>

              <p className="mt-3 text-xs opacity-60">
                ID: {s.id} · Owner: {s.owner_id}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
