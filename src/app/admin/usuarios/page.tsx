"use client";

import { useEffect, useMemo, useState } from "react";
import Swal from "sweetalert2";
import { supabaseBrowser } from "@/lib/supabase/client";

type UserProfile = {
  user_id: string;
  role: "admin" | "store";
  created_at: string;
};

/** =========================
 * Theme-aware UI helpers
 * - Sin cambiar estructura/lógica
 * - Usa CSS vars (auto según tema del sistema)
 * ========================= */
function inputBase() {
  return "rounded-2xl border p-3 text-sm outline-none placeholder:opacity-60 backdrop-blur-xl";
}

function buttonGhost() {
  return "rounded-2xl border px-4 py-2 text-sm font-semibold backdrop-blur-xl transition hover:brightness-110 disabled:opacity-60";
}

function buttonPrimary() {
  return "rounded-2xl border px-4 py-2 text-sm font-semibold shadow-[0_0_22px_rgba(0,0,0,0.12)] transition hover:brightness-110 disabled:opacity-60";
}

function buttonDanger() {
  return "rounded-2xl border px-4 py-2 text-sm font-semibold transition hover:brightness-110 disabled:opacity-60";
}

function rolePill(role: "admin" | "store") {
  // Solo clases base; colores se ponen con style inline para ser theme-aware
  return role === "admin" ? "border" : "border";
}

function swalBase() {
  // SweetAlert no respeta Tailwind; usamos tokens por inline style
  return {
    background: "var(--t-bg-base)",
    color: "var(--t-text)",
    confirmButtonColor: "#22c55e",
  };
}

async function swalError(title: string, text?: string) {
  await Swal.fire({
    icon: "error",
    title,
    text: text ?? "Error",
    background: "var(--t-bg-base)",
    color: "var(--t-text)",
    confirmButtonColor: "#ef4444",
  });
}

export default function AdminUsuariosPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [q, setQ] = useState("");
  const [rows, setRows] = useState<UserProfile[]>([]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) => `${r.user_id} ${r.role}`.toLowerCase().includes(s));
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
      await swalError("Error cargando usuarios", e?.message);
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
        <div style="text-align:left; opacity:.9">
          <div style="opacity:.75; font-size:12px; margin-bottom:8px">
            Pega el <b>UUID</b> del usuario (user_id) y selecciona el rol.
          </div>

          <input id="uid" class="swal2-input" placeholder="user_id (uuid)">
          <select id="role" class="swal2-input">
            <option value="store">store</option>
            <option value="admin">admin</option>
          </select>
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: "Guardar",
      cancelButtonText: "Cancelar",
      background: "var(--t-bg-base)",
      color: "var(--t-text)",
      confirmButtonColor: "#a855f7",
      preConfirm: () => {
        const user_id = (document.getElementById("uid") as HTMLInputElement).value.trim();
        const role = (document.getElementById("role") as HTMLSelectElement).value as "admin" | "store";

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
        background: "var(--t-bg-base)",
        color: "var(--t-text)",
      });
    } catch (e: any) {
      await swalError("No se pudo guardar", e?.message);
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
      background: "var(--t-bg-base)",
      color: "var(--t-text)",
    });
    if (!res.isConfirmed) return;

    setSaving(true);
    try {
      const sb = supabaseBrowser();

      const { error } = await sb.from("user_profiles").delete().eq("user_id", r.user_id);
      if (error) throw error;

      setRows((prev) => prev.filter((x) => x.user_id !== r.user_id));

      await Swal.fire({
        icon: "success",
        title: "Eliminado",
        timer: 900,
        showConfirmButton: false,
        background: "var(--t-bg-base)",
        color: "var(--t-text)",
      });
    } catch (e: any) {
      await swalError("No se pudo eliminar", e?.message);
    } finally {
      setSaving(false);
    }
  }

  async function toggleRole(r: UserProfile) {
    const nextRole: "admin" | "store" = r.role === "admin" ? "store" : "admin";

    const res = await Swal.fire({
      icon: "question",
      title: "Cambiar rol",
      text: `Cambiar ${r.user_id} a "${nextRole}"?`,
      showCancelButton: true,
      confirmButtonText: "Sí, cambiar",
      cancelButtonText: "Cancelar",
      background: "var(--t-bg-base)",
      color: "var(--t-text)",
      confirmButtonColor: "#a855f7",
    });

    if (!res.isConfirmed) return;

    setSaving(true);
    try {
      const sb = supabaseBrowser();

      const { error } = await sb.from("user_profiles").update({ role: nextRole }).eq("user_id", r.user_id);

      if (error) throw error;

      setRows((prev) => prev.map((x) => (x.user_id === r.user_id ? { ...x, role: nextRole } : x)));

      await Swal.fire({
        icon: "success",
        title: "Actualizado",
        timer: 900,
        showConfirmButton: false,
        background: "var(--t-bg-base)",
        color: "var(--t-text)",
      });
    } catch (e: any) {
      await swalError("Error", e?.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4 text-[color:var(--t-text)]">
      {/* Header */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-2xl font-semibold">👤 Usuarios / Roles</h2>
          <p className="text-sm" style={{ color: "var(--t-muted)" }}>
            Administrar <b>user_profiles</b> (admin / store).
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            className={buttonGhost()}
            onClick={load}
            disabled={saving}
            style={{
              borderColor: "var(--t-card-border)",
              background: "color-mix(in oklab, var(--t-card-bg) 86%, transparent)",
              color: "var(--t-text)",
            }}
          >
            Recargar
          </button>

          <button
            className={buttonPrimary()}
            onClick={upsertUser}
            disabled={saving}
            style={{
              borderColor: "color-mix(in oklab, var(--t-cta) 35%, var(--t-card-border))",
              background: "color-mix(in oklab, var(--t-cta) 22%, transparent)",
              color: "var(--t-text)",
            }}
          >
            + Asignar rol
          </button>
        </div>
      </div>

      {/* Search */}
      <div
        className="rounded-[28px] border p-3 backdrop-blur-xl"
        style={{
          borderColor: "var(--t-card-border)",
          background: "color-mix(in oklab, var(--t-card-bg) 86%, transparent)",
        }}
      >
        <input
          className="w-full bg-transparent outline-none placeholder:opacity-60"
          style={{ color: "var(--t-text)" }}
          placeholder="Buscar por uuid o rol..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {/* Content */}
      {loading ? (
        <div
          className="rounded-[28px] border p-6 text-sm"
          style={{
            borderColor: "var(--t-card-border)",
            background: "color-mix(in oklab, var(--t-card-bg) 86%, transparent)",
            color: "var(--t-muted)",
          }}
        >
          Cargando...
        </div>
      ) : filtered.length === 0 ? (
        <div
          className="rounded-[28px] border p-6"
          style={{
            borderColor: "var(--t-card-border)",
            background: "color-mix(in oklab, var(--t-card-bg) 86%, transparent)",
          }}
        >
          <p className="font-semibold">No hay perfiles</p>
          <p className="mt-1 text-sm" style={{ color: "var(--t-muted)" }}>
            Crea uno con “+ Asignar rol”.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((r) => (
            <div
              key={r.user_id}
              className="rounded-[28px] border p-4 backdrop-blur-xl"
              style={{
                borderColor: "var(--t-card-border)",
                background: "color-mix(in oklab, var(--t-card-bg) 86%, transparent)",
              }}
            >
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold" style={{ color: "var(--t-text)" }}>
                      {r.user_id}
                    </p>

                    <span
                      className={`rounded-full border px-3 py-1 text-xs font-semibold ${rolePill(r.role)}`}
                      style={{
                        borderColor:
                          r.role === "admin"
                            ? "color-mix(in oklab, var(--t-cta) 35%, var(--t-card-border))"
                            : "color-mix(in oklab, var(--t-accent2, var(--t-accent)) 35%, var(--t-card-border))",
                        background:
                          r.role === "admin"
                            ? "color-mix(in oklab, var(--t-cta) 18%, transparent)"
                            : "color-mix(in oklab, var(--t-accent2, var(--t-accent)) 16%, transparent)",
                        color: "var(--t-text)",
                      }}
                    >
                      {r.role}
                    </span>
                  </div>

                  <p className="mt-1 text-xs" style={{ color: "color-mix(in oklab, var(--t-muted) 85%, transparent)" }}>
                    Creado: {new Date(r.created_at).toLocaleString("es-CO")}
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    className={buttonGhost()}
                    onClick={() => toggleRole(r)}
                    disabled={saving}
                    style={{
                      borderColor: "var(--t-card-border)",
                      background: "color-mix(in oklab, var(--t-card-bg) 86%, transparent)",
                      color: "var(--t-text)",
                    }}
                  >
                    Cambiar a {r.role === "admin" ? "store" : "admin"}
                  </button>

                  <button
                    className={buttonDanger()}
                    onClick={() => removeUser(r)}
                    disabled={saving}
                    style={{
                      borderColor: "color-mix(in oklab, var(--t-danger, #ef4444) 35%, var(--t-card-border))",
                      background: "color-mix(in oklab, var(--t-danger, #ef4444) 12%, transparent)",
                      color: "var(--t-text)",
                    }}
                  >
                    Eliminar perfil
                  </button>
                </div>
              </div>
            </div>
          ))}

          <p className="text-xs" style={{ color: "var(--t-muted)" }}>
            Mostrando {filtered.length} perfil(es).
          </p>
        </div>
      )}

      <div
        className="rounded-[28px] border p-4 text-xs backdrop-blur-xl"
        style={{
          borderColor: "var(--t-card-border)",
          background: "color-mix(in oklab, var(--t-card-bg) 86%, transparent)",
          color: "var(--t-muted)",
        }}
      >
        <b>Nota:</b> aquí manejas roles por UUID. Para ver emails necesitas backend con Service Role.
      </div>
    </div>
  );
}
