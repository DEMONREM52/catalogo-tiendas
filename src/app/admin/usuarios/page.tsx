"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Swal from "sweetalert2";
import { supabaseBrowser } from "@/lib/supabase/client";
import { fetchAdminData, requestAdmin } from "@/lib/admin-data";
import { STORE_MENU_PERMISSIONS, type StoreMenuPermission } from "@/lib/store-user-auth";
import { smartFilter } from "@/lib/search";

type UserProfile = {
  user_id: string;
  email: string | null;
  role: "admin" | "store" | "sin perfil";
  created_at: string | null;
  last_sign_in_at: string | null;
  display_name: string | null;
  owned_stores: Array<{ id: string; name: string; slug: string }>;
  memberships: Array<{
    store_id: string;
    store_name: string;
    store_slug: string;
    username: string | null;
    display_name: string | null;
    role: StoreMemberRole;
    active: boolean;
    permissions: string[];
    created_at: string;
  }>;
};

type StoreRow = { id: string; name: string; slug: string; owner_id: string };
type StoreMember = {
  store_id: string;
  user_id: string;
  username: string | null;
  display_name: string | null;
  role: "store_admin" | "seller" | "accounting" | "viewer";
  active: boolean;
  permissions: string[];
  created_at: string;
};
type StoreMemberRole = StoreMember["role"];

const PERMISSION_LABELS: Record<StoreMenuPermission, string> = {
  store: "Mi tienda",
  billing: "Facturación",
  pos: "POS / ventas",
  clients: "Terceros",
  clients_delete: "Eliminar terceros",
  credit: "Créditos",
  receivables: "Cartera",
  users: "Usuarios",
  products: "Crear y editar productos y catálogos",
  products_view: "Ver lista general de productos",
  categories: "Categorías",
  orders: "Pedidos",
  inventory: "Inventario y kardex",
  inventory_adjust: "Ajustes de inventario",
  transfers: "Traslados",
  stock_requests: "Pedidos internos",
  stock_requests_manage: "Gestión de pedidos internos",
  purchases: "Compras",
  suppliers: "Proveedores",
  payables: "Cuentas por pagar",
  audit: "Auditoría e informes",
  points: "Puntos",
  fiscal: "Centro fiscal",
  fiscal_send: "Emitir documentos electrónicos",
  fiscal_notes: "Notas y anulaciones",
  fiscal_download: "Descargar XML/PDF",
  fiscal_config: "Configuración fiscal",
  fiscal_numbering: "Resoluciones y numeración",
  fiscal_provider: "Proveedor tecnológico",
  fiscal_audit: "Auditoría fiscal",
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

function rolePill(role: UserProfile["role"]) {
  // Solo clases base; colores se ponen con style inline para ser theme-aware
  return role === "admin" ? "border" : "border";
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
  const [stores, setStores] = useState<StoreRow[]>([]);
  const [storeId, setStoreId] = useState("");
  const [members, setMembers] = useState<StoreMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [membersError, setMembersError] = useState("");
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null);
  const [draftPermissions, setDraftPermissions] = useState<StoreMenuPermission[]>([]);
  const [draftActive, setDraftActive] = useState(true);
  const [draftRole, setDraftRole] = useState<StoreMemberRole>("seller");
  const [newUsername, setNewUsername] = useState("");
  const [newDisplayName, setNewDisplayName] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<StoreMemberRole>("seller");
  const [newPermissions, setNewPermissions] = useState<StoreMenuPermission[]>(["pos"]);
  const [newUserLoginUrl, setNewUserLoginUrl] = useState("");

  const filtered = useMemo(() => {
    return smartFilter(rows, q, (r) =>
      `${r.user_id} ${r.role} ${r.email ?? ""} ${r.display_name ?? ""} ${
        r.owned_stores.map((store) => `${store.name} ${store.slug}`).join(" ")
      } ${r.memberships.map((member) => `${member.store_name} ${member.username ?? ""}`).join(" ")}`,
    );
  }, [rows, q]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [data, availableStores] = await Promise.all([
        fetchAdminData<UserProfile[]>(new URLSearchParams({ resource: "users" })),
        fetchAdminData<StoreRow[]>(new URLSearchParams({ resource: "stores" })),
      ]);
      setRows(data);
      setStores(availableStores);
      const requestedStore = new URLSearchParams(window.location.search).get("store");
      const initialStore = availableStores.find((store) => store.id === requestedStore) ??
        availableStores.find((store) => store.id === storeId) ?? availableStores[0];
      if (initialStore && !storeId) setStoreId(initialStore.id);
    } catch (e: any) {
      await swalError("Error cargando usuarios", e?.message);
    } finally {
      setLoading(false);
    }
  }, [storeId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!storeId) {
      setMembers([]);
      return;
    }
    setEditingMemberId(null);
    void loadStoreMembers(storeId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeId]);

  async function requestStoreUsers(
    selectedStoreId: string,
    method: "GET" | "POST" | "PATCH",
    body?: Record<string, unknown>,
  ) {
    const sb = supabaseBrowser();
    const { data: sessionData, error: sessionError } = await sb.auth.getSession();
    if (sessionError) throw sessionError;
    const accessToken = sessionData.session?.access_token;
    if (!accessToken) throw new Error("La sesión expiró. Inicia sesión nuevamente.");

    const response = await fetch(
      `/api/store-team/users?store_id=${encodeURIComponent(selectedStoreId)}`,
      {
        method,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify({ store_id: selectedStoreId, ...body }) } : {}),
      },
    );
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "No se pudieron cargar los accesos de la tienda.");
    return result as { users?: StoreMember[]; user?: StoreMember | null; login_url?: string };
  }

  async function loadStoreMembers(selectedStoreId: string) {
    setMembersLoading(true);
    setMembersError("");
    try {
      const result = await requestStoreUsers(selectedStoreId, "GET");
      setMembers(result.users ?? []);
    } catch (err: unknown) {
      setMembers([]);
      setMembersError(String((err as Error)?.message ?? err));
    } finally {
      setMembersLoading(false);
    }
  }

  function startEditingMember(member: StoreMember) {
    setEditingMemberId(member.user_id);
    setDraftPermissions(member.permissions.filter((permission): permission is StoreMenuPermission =>
      STORE_MENU_PERMISSIONS.includes(permission as StoreMenuPermission)
    ));
    setDraftActive(member.active);
    setDraftRole(member.role);
  }

  async function saveStoreMember(member: StoreMember) {
    if (!storeId) return;
    setSaving(true);
    try {
      await requestStoreUsers(storeId, "PATCH", {
        user_id: member.user_id,
        permissions: draftPermissions,
        active: draftActive,
        role: draftRole,
      });
      setEditingMemberId(null);
      await loadStoreMembers(storeId);
    } catch (err: unknown) {
      await swalError("No se pudo actualizar el acceso", String((err as Error)?.message ?? err));
    } finally {
      setSaving(false);
    }
  }

  async function createStoreMember() {
    if (!storeId) return;
    setSaving(true);
    try {
      const result = await requestStoreUsers(storeId, "POST", {
        username: newUsername,
        display_name: newDisplayName,
        password: newPassword,
        role: newRole,
        permissions: newPermissions,
      });
      setNewUserLoginUrl(result.login_url ?? "");
      setNewUsername("");
      setNewDisplayName("");
      setNewPassword("");
      setNewRole("seller");
      setNewPermissions(["pos"]);
      await loadStoreMembers(storeId);
      await Swal.fire({
        icon: "success",
        title: "Acceso de tienda creado",
        timer: 1000,
        showConfirmButton: false,
        background: "var(--t-bg-base)",
        color: "var(--t-text)",
      });
    } catch (err: unknown) {
      await swalError("No se pudo crear el acceso", String((err as Error)?.message ?? err));
    } finally {
      setSaving(false);
    }
  }

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
      await requestAdmin("/api/admin/catalog", {
        method: "PATCH",
        body: JSON.stringify({ resource: "user-profile", id: res.value.user_id, role: res.value.role }),
      });
      await load();

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
      await requestAdmin(
        `/api/admin/catalog?resource=user-profile&id=${encodeURIComponent(r.user_id)}`,
        { method: "DELETE" },
      );
      await load();

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
      await requestAdmin("/api/admin/catalog", {
        method: "PATCH",
        body: JSON.stringify({ resource: "user-profile", id: r.user_id, role: nextRole }),
      });
      await load();

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
          <h2 className="text-2xl font-semibold">👤 Usuarios y roles</h2>
          <p className="text-sm" style={{ color: "var(--t-muted)" }}>
            Administra miembros y permisos por tienda, además de los roles globales de la plataforma.
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

      <section className="glass rounded-[28px] p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h3 className="font-semibold">Equipo de cada tienda</h3>
            <p className="mt-1 text-xs" style={{ color: "var(--t-muted)" }}>
              Consulta accesos, roles y permisos. Puedes activar/inactivar usuarios y crear nuevos accesos.
            </p>
          </div>
          <label className="w-full text-xs sm:max-w-sm" style={{ color: "var(--t-muted)" }}>
            Tienda
            <select className={`${inputBase()} mt-1 w-full`} value={storeId} onChange={(event) => setStoreId(event.target.value)}>
              {stores.map((store) => (
                <option key={store.id} value={store.id}>{store.name} · /{store.slug}</option>
              ))}
            </select>
          </label>
        </div>

        {!stores.length && !loading ? (
          <p className="mt-4 rounded-2xl border p-4 text-sm" style={{ borderColor: "var(--t-card-border)", color: "var(--t-muted)" }}>
            No hay tiendas registradas.
          </p>
        ) : null}

        {storeId ? (
          <>
            <div className="mt-4 rounded-2xl border p-3 text-sm" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)" }}>
              <span className="font-semibold">Propietario:</span>{" "}
              <span className="break-all" style={{ color: "var(--t-muted)" }}>
                {stores.find((store) => store.id === storeId)?.owner_id ?? "No disponible"}
              </span>
              <span className="ml-2 rounded-full border px-2 py-1 text-[11px]" style={{ borderColor: "var(--t-card-border)" }}>dueño de la tienda</span>
            </div>

            <div className="mt-4 rounded-2xl border p-4" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)" }}>
              <h4 className="font-semibold">Crear acceso para esta tienda</h4>
              <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                <input className={inputBase()} placeholder="Usuario interno" value={newUsername} onChange={(event) => setNewUsername(event.target.value)} />
                <input className={inputBase()} placeholder="Nombre visible (opcional)" value={newDisplayName} onChange={(event) => setNewDisplayName(event.target.value)} />
                <input className={inputBase()} type="password" autoComplete="new-password" placeholder="Contraseña inicial (mín. 8)" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
                <select
                  className={inputBase()}
                  value={newRole}
                  onChange={(event) => {
                    const role = event.target.value as StoreMemberRole;
                    setNewRole(role);
                    if (role === "store_admin") setNewPermissions([...STORE_MENU_PERMISSIONS]);
                  }}
                  aria-label="Rol del nuevo usuario"
                >
                  <option value="seller">Vendedor</option>
                  <option value="accounting">Contabilidad</option>
                  <option value="viewer">Solo lectura</option>
                  <option value="store_admin">Administrador de tienda</option>
                </select>
              </div>
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2">
                {STORE_MENU_PERMISSIONS.map((permission) => (
                  <label key={permission} className="inline-flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={newPermissions.includes(permission)}
                      onChange={(event) => setNewPermissions((current) =>
                        event.target.checked
                          ? [...current, permission]
                          : current.filter((item) => item !== permission)
                      )}
                    />
                    {PERMISSION_LABELS[permission]}
                  </label>
                ))}
              </div>
              <button
                type="button"
                className={`${buttonPrimary()} mt-4`}
                disabled={saving || !newUsername.trim() || newPassword.length < 8}
                onClick={createStoreMember}
                style={{ borderColor: "color-mix(in oklab, var(--t-cta) 35%, var(--t-card-border))", background: "color-mix(in oklab, var(--t-cta) 18%, transparent)", color: "var(--t-text)" }}
              >
                {saving ? "Guardando…" : "Crear usuario de tienda"}
              </button>
              {newUserLoginUrl ? (
                <div className="mt-4 rounded-2xl border p-3" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)" }}>
                  <p className="text-xs font-semibold">Enlace de acceso generado</p>
                  <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                    <input className={inputBase()} readOnly value={newUserLoginUrl} aria-label="Enlace de acceso del usuario" />
                    <button
                      type="button"
                      className={buttonGhost()}
                      style={{ borderColor: "var(--t-card-border)", color: "var(--t-text)" }}
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(newUserLoginUrl);
                          await Swal.fire({ icon: "success", title: "Enlace copiado", timer: 900, showConfirmButton: false, background: "var(--t-bg-base)", color: "var(--t-text)" });
                        } catch {
                          await swalError("No se pudo copiar el enlace", "El navegador bloqueó el portapapeles.");
                        }
                      }}
                    >
                      Copiar enlace
                    </button>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="mt-4">
              <h4 className="font-semibold">Miembros del equipo</h4>
              {membersLoading ? (
                <p className="mt-3 text-sm" style={{ color: "var(--t-muted)" }}>Cargando usuarios de la tienda…</p>
              ) : membersError ? (
                <div role="alert" className="mt-3 rounded-2xl border border-red-400/40 bg-red-500/10 p-4 text-sm text-red-200">
                  <p className="font-semibold">No se pudo consultar el equipo</p>
                  <p className="mt-1">{membersError}</p>
                </div>
              ) : members.length ? (
                <div className="mt-3 space-y-3">
                  {members.map((member) => {
                    const isEditing = editingMemberId === member.user_id;
                    return (
                      <article key={`${member.store_id}-${member.user_id}`} className="rounded-2xl border p-4" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)" }}>
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-semibold">{member.display_name || member.username || "Usuario"}</span>
                              <span className="rounded-full border px-2.5 py-1 text-xs" style={{ borderColor: "var(--t-card-border)" }}>{member.role}</span>
                              <span className={`rounded-full border px-2.5 py-1 text-xs ${member.active ? "text-emerald-500" : "text-amber-500"}`} style={{ borderColor: "var(--t-card-border)" }}>
                                {member.active ? "Activo" : "Inactivo"}
                              </span>
                            </div>
                            <p className="mt-1 break-all text-xs" style={{ color: "var(--t-muted)" }}>
                              @{member.username ?? "sin usuario"} · {member.user_id}
                            </p>
                          </div>
                          {!isEditing ? (
                            <button type="button" className={buttonGhost()} disabled={saving} onClick={() => startEditingMember(member)} style={{ borderColor: "var(--t-card-border)", color: "var(--t-text)" }}>
                              Editar accesos
                            </button>
                          ) : null}
                        </div>

                        {isEditing ? (
                          <div className="mt-4">
                            <label className="block max-w-xs text-xs" style={{ color: "var(--t-muted)" }}>
                              Rol en esta tienda
                              <select className={`${inputBase()} mt-1 w-full`} value={draftRole} onChange={(event) => setDraftRole(event.target.value as StoreMemberRole)}>
                                <option value="seller">Vendedor</option>
                                <option value="accounting">Contabilidad</option>
                                <option value="viewer">Solo lectura</option>
                                <option value="store_admin">Administrador de tienda</option>
                              </select>
                            </label>
                            <label className="inline-flex items-center gap-2 text-sm">
                              <input type="checkbox" checked={draftActive} onChange={(event) => setDraftActive(event.target.checked)} />
                              Acceso activo
                            </label>
                            <p className="mt-3 text-xs font-semibold" style={{ color: "var(--t-muted)" }}>Permisos habilitados</p>
                            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
                              {STORE_MENU_PERMISSIONS.map((permission) => (
                                <label key={permission} className="inline-flex items-center gap-2 text-xs">
                                  <input
                                    type="checkbox"
                                    checked={draftPermissions.includes(permission)}
                                    onChange={(event) => setDraftPermissions((current) =>
                                      event.target.checked
                                        ? [...current, permission]
                                        : current.filter((item) => item !== permission)
                                    )}
                                  />
                                  {PERMISSION_LABELS[permission]}
                                </label>
                              ))}
                            </div>
                            <div className="mt-4 flex flex-wrap gap-2">
                              <button type="button" className={buttonPrimary()} disabled={saving} onClick={() => saveStoreMember(member)} style={{ borderColor: "color-mix(in oklab, var(--t-cta) 35%, var(--t-card-border))", background: "color-mix(in oklab, var(--t-cta) 18%, transparent)", color: "var(--t-text)" }}>Guardar accesos</button>
                              <button type="button" className={buttonGhost()} disabled={saving} onClick={() => setEditingMemberId(null)} style={{ borderColor: "var(--t-card-border)", color: "var(--t-text)" }}>Cancelar</button>
                            </div>
                          </div>
                        ) : (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {member.permissions.length ? member.permissions.map((permission) => (
                              <span key={permission} className="rounded-full border px-2.5 py-1 text-[11px]" style={{ borderColor: "var(--t-card-border)", color: "var(--t-muted)" }}>
                                {PERMISSION_LABELS[permission as StoreMenuPermission] ?? permission}
                              </span>
                            )) : <span className="text-xs" style={{ color: "var(--t-muted)" }}>Sin permisos habilitados</span>}
                          </div>
                        )}
                      </article>
                    );
                  })}
                  <p className="text-xs" style={{ color: "var(--t-muted)" }}>{members.length} usuario(s) interno(s) en esta tienda.</p>
                </div>
              ) : (
                <p className="mt-3 rounded-2xl border p-4 text-sm" style={{ borderColor: "var(--t-card-border)", color: "var(--t-muted)" }}>
                  No hay usuarios internos creados. El propietario aparece arriba.
                </p>
              )}
            </div>
          </>
        ) : null}
      </section>

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
          placeholder="Buscar usuario por email, UUID, nombre o tienda..."
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
          <p className="font-semibold">No hay usuarios registrados</p>
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
                    <div className="min-w-0">
                      <p className="break-all text-sm font-semibold" style={{ color: "var(--t-text)" }}>
                        {r.display_name || r.email || r.user_id}
                      </p>
                      <p className="break-all text-xs" style={{ color: "var(--t-muted)" }}>
                        {r.email ? `${r.email} · ` : ""}{r.user_id}
                      </p>
                    </div>

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
                    Cuenta creada: {r.created_at ? new Date(r.created_at).toLocaleString("es-CO") : "No disponible"}
                    {r.last_sign_in_at ? ` · Último acceso: ${new Date(r.last_sign_in_at).toLocaleString("es-CO")}` : ""}
                  </p>
                  {r.owned_stores.length || r.memberships.length ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {r.owned_stores.map((store) => (
                        <span key={`owner-${store.id}`} className="rounded-full border px-2 py-1 text-[11px]" style={{ borderColor: "var(--t-card-border)" }}>
                          Propietario · {store.name} (/{store.slug})
                        </span>
                      ))}
                      {r.memberships.map((member) => (
                        <span key={`member-${member.store_id}`} className="rounded-full border px-2 py-1 text-[11px]" style={{ borderColor: "var(--t-card-border)" }}>
                          @{member.username ?? member.display_name ?? "equipo"} · {member.store_name} · {member.role} · {member.active ? "Activo" : "Inactivo"}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-1 text-xs" style={{ color: "var(--t-muted)" }}>Sin tienda o equipo asociado.</p>
                  )}
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
                    {r.role === "sin perfil" ? "Asignar rol admin" : `Cambiar a ${r.role === "admin" ? "store" : "admin"}`}
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
        <b>Nota:</b> esta lista reúne cuentas de autenticación, perfiles, propietarios y miembros de equipo. Los accesos internos pueden crearse con rol y permisos desde “Crear acceso para esta tienda”; el correo técnico de esos accesos puede no ser un correo personal.
      </div>
    </div>
  );
}
