"use client";

import { useEffect, useMemo, useState } from "react";
import Swal from "sweetalert2";
import { supabaseBrowser } from "@/lib/supabase/client";

type UserProfile = {
  user_id: string;
  role: "admin" | "store";
  created_at: string;
};

export default function AdminUsuariosPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<UserProfile[]>([]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) =>
      (r.user_id + " " + r.role).toLowerCase().includes(s)
    );
  }, [rows, q]);

  async function load() {
    setLoading(true);
    try {
      const sb = supabaseBrowser();

      const { data, error } = await sb
        .from("user_profiles")
        .select("user_id,role,created_at")
        .order("created_at", { ascending: false });

      if (error) throw error;

      setRows((data as UserProfile[]) ?? []);
    } catch (e: any) {
      await Swal.fire({
        icon: "error",
        title: "Error cargando usuarios",
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

  async function upsertUser() {
    const res = await Swal.fire({
      title: "Asignar rol",
      html: `
        <input id="uid" class="swal2-input" placeholder="user_id (uuid)">
        <select id="role" class="swal2-input">
          <option value="store">store</option>
          <option value="admin">admin</option>
        </select>
      `,
      showCancelButton: true,
      confirmButtonText: "Guardar",
      cancelButtonText: "Cancelar",
      background: "#0b0b0b",
      color: "#fff",
      preConfirm: () => {
        const user_id = (document.getElementById("uid") as HTMLInputElement).value.trim();
        const role = (document.getElementById("role") as HTMLSelectElement).value as
          | "admin"
          | "store";

        if (!user_id) {
          Swal.showValidationMessage("Escribe un user_id.");
          return;
        }
        return { user_id, role };
      },
    });

    if (!res.isConfirmed) return;

    setSaving(true);
    try {
      const sb = supabaseBrowser();

      const { data, error } = await sb
        .from("user_profiles")
        .upsert({ user_id: res.value.user_id, role: res.value.role }, { onConflict: "user_id" })
        .select("user_id,role,created_at")
        .single();

      if (error) throw error;

      setRows((prev) => {
        const next = prev.filter((x) => x.user_id !== data.user_id);
        return [data as UserProfile, ...next];
      });

      await Swal.fire({
        icon: "success",
        title: "Rol actualizado",
        timer: 1000,
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

  async function removeUser(r: UserProfile) {
    const res = await Swal.fire({
      icon: "warning",
      title: "Eliminar perfil",
      text: `Se eliminará user_profiles de ${r.user_id}.`,
      showCancelButton: true,
      confirmButtonText: "Eliminar",
      cancelButtonText: "Cancelar",
      confirmButtonColor: "#ef4444",
      background: "#0b0b0b",
      color: "#fff",
    });
    if (!res.isConfirmed) return;

    setSaving(true);
    try {
      const sb = supabaseBrowser();

      const { error } = await sb.from("user_profiles").delete().eq("user_id", r.user_id);
      if (error) throw error;

      setRows((prev) => prev.filter((x) => x.user_id !== r.user_id));
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

  async function toggleRole(r: UserProfile) {
    const nextRole: "admin" | "store" = r.role === "admin" ? "store" : "admin";

    setSaving(true);
    try {
      const sb = supabaseBrowser();

      const { error } = await sb
        .from("user_profiles")
        .update({ role: nextRole })
        .eq("user_id", r.user_id);

      if (error) throw error;

      setRows((prev) =>
        prev.map((x) => (x.user_id === r.user_id ? { ...x, role: nextRole } : x))
      );
    } catch (e: any) {
      await Swal.fire({
        icon: "error",
        title: "Error",
        text: e?.message ?? "Error",
        background: "#0b0b0b",
        color: "#fff",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Usuarios / Roles</h2>
          <p className="text-sm opacity-80">
            Administrar user_profiles (admin / store).
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
            onClick={upsertUser}
            disabled={saving}
          >
            + Asignar rol
          </button>
        </div>
      </div>

      <div className="mt-4">
        <input
          className="w-full rounded-xl border border-white/10 bg-black/30 p-3 outline-none"
          placeholder="Buscar por uuid o rol..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {loading ? (
        <p className="mt-4">Cargando...</p>
      ) : filtered.length === 0 ? (
        <div className="mt-4 rounded-2xl border border-white/10 p-4">
          <p className="font-semibold">No hay perfiles</p>
          <p className="text-sm opacity-80 mt-1">Crea uno con “+ Asignar rol”.</p>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {filtered.map((r) => (
            <div key={r.user_id} className="rounded-2xl border border-white/10 p-4">
              <p className="font-semibold">{r.user_id}</p>

              <p className="text-sm opacity-80">
                Rol: <b>{r.role}</b>
              </p>

              <p className="text-xs opacity-60 mt-1">
                Creado: {new Date(r.created_at).toLocaleString("es-CO")}
              </p>

              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  className="rounded-xl border border-white/10 px-4 py-2"
                  onClick={() => toggleRole(r)}
                  disabled={saving}
                >
                  Cambiar a {r.role === "admin" ? "store" : "admin"}
                </button>

                <button
                  className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 font-semibold text-red-200"
                  onClick={() => removeUser(r)}
                  disabled={saving}
                >
                  Eliminar perfil
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="mt-4 text-xs opacity-60">
        Nota: aquí manejas roles por uuid. Para ver emails, se necesita backend con service role.
      </p>
    </div>
  );
}
