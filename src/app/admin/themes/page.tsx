"use client";

import { useEffect, useState } from "react";
import Swal from "sweetalert2";
import { supabaseBrowser } from "@/lib/supabase/client";

type ThemeRow = {
  id: string;
  name: string;
  active: boolean;
  sort_order: number;
};

export default function AdminThemesPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [rows, setRows] = useState<ThemeRow[]>([]);

  async function load() {
    setLoading(true);
    const { data, error } = await supabaseBrowser
      .from("themes")
      .select("id,name,active,sort_order")
      .order("sort_order", { ascending: true });

    if (error) {
      await Swal.fire({
        icon: "error",
        title: "Error cargando themes",
        text: error.message,
        background: "#0b0b0b",
        color: "#fff",
      });
      setLoading(false);
      return;
    }

    setRows((data as ThemeRow[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  function patch(id: string, p: Partial<ThemeRow>) {
    setRows((prev) => prev.map((x) => (x.id === id ? { ...x, ...p } : x)));
  }

  async function save(t: ThemeRow) {
    setSaving(true);
    const { error } = await supabaseBrowser
      .from("themes")
      .update({ name: t.name, active: t.active, sort_order: t.sort_order })
      .eq("id", t.id);

    setSaving(false);

    if (error) {
      await Swal.fire({
        icon: "error",
        title: "No se pudo guardar",
        text: error.message,
        background: "#0b0b0b",
        color: "#fff",
      });
      return;
    }

    await Swal.fire({
      icon: "success",
      title: "Guardado",
      timer: 900,
      showConfirmButton: false,
      background: "#0b0b0b",
      color: "#fff",
    });
  }

  async function create() {
    const res = await Swal.fire({
      title: "Nuevo theme",
      html: `
        <input id="id" class="swal2-input" placeholder="id (ej: ocean2)">
        <input id="name" class="swal2-input" placeholder="name (texto)">
      `,
      showCancelButton: true,
      confirmButtonText: "Crear",
      cancelButtonText: "Cancelar",
      background: "#0b0b0b",
      color: "#fff",
      preConfirm: () => {
        const id = (document.getElementById("id") as HTMLInputElement).value.trim();
        const name = (document.getElementById("name") as HTMLInputElement).value.trim();
        if (!id || !name) {
          Swal.showValidationMessage("Completa id y name.");
          return;
        }
        return { id, name };
      },
    });

    if (!res.isConfirmed) return;

    setSaving(true);
    const { data, error } = await supabaseBrowser
      .from("themes")
      .insert({ id: res.value.id, name: res.value.name, active: true, sort_order: 0 })
      .select("id,name,active,sort_order")
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

    setRows((prev) => [data as ThemeRow, ...prev]);
  }

  async function remove(t: ThemeRow) {
    const res = await Swal.fire({
      icon: "warning",
      title: "Eliminar theme",
      text: `Eliminar "${t.id}"`,
      showCancelButton: true,
      confirmButtonText: "Eliminar",
      cancelButtonText: "Cancelar",
      confirmButtonColor: "#ef4444",
      background: "#0b0b0b",
      color: "#fff",
    });
    if (!res.isConfirmed) return;

    setSaving(true);
    const { error } = await supabaseBrowser.from("themes").delete().eq("id", t.id);
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

    setRows((prev) => prev.filter((x) => x.id !== t.id));
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Themes</h2>
          <p className="text-sm opacity-80">CRUD de themes.</p>
        </div>
        <div className="flex gap-2">
          <button className="rounded-xl border border-white/10 px-4 py-2" onClick={load} disabled={saving}>
            Recargar
          </button>
          <button className="rounded-xl bg-white text-black px-4 py-2 font-semibold" onClick={create} disabled={saving}>
            + Nuevo
          </button>
        </div>
      </div>

      {loading ? (
        <p className="mt-4">Cargando...</p>
      ) : (
        <div className="mt-4 space-y-3">
          {rows.map((t) => (
            <div key={t.id} className="rounded-2xl border border-white/10 p-4">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div>
                  <label className="text-xs opacity-70">ID</label>
                  <input
                    className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 p-3 outline-none opacity-80"
                    value={t.id}
                    disabled
                  />
                </div>

                <div>
                  <label className="text-xs opacity-70">Nombre</label>
                  <input
                    className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 p-3 outline-none"
                    value={t.name}
                    onChange={(e) => patch(t.id, { name: e.target.value })}
                  />
                </div>

                <div>
                  <label className="text-xs opacity-70">Orden</label>
                  <input
                    type="number"
                    className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 p-3 outline-none"
                    value={t.sort_order}
                    onChange={(e) => patch(t.id, { sort_order: Number(e.target.value) })}
                  />
                </div>

                <div className="flex items-end">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={t.active}
                      onChange={(e) => patch(t.id, { active: e.target.checked })}
                    />
                    Activo
                  </label>
                </div>
              </div>

              <div className="mt-3 flex gap-2">
                <button className="rounded-xl bg-white text-black px-4 py-2 font-semibold" onClick={() => save(t)} disabled={saving}>
                  Guardar
                </button>
                <button className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 font-semibold text-red-200" onClick={() => remove(t)} disabled={saving}>
                  Eliminar
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
