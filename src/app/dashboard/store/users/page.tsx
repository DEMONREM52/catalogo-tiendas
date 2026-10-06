"use client";

import { useEffect, useMemo, useState } from "react";
import Swal from "sweetalert2";
import { supabaseBrowser } from "@/lib/supabase/client";
import { getDashboardStore, hasStorePermission, type DashboardStore } from "@/lib/store-utils";
import type { StoreMenuPermission } from "@/lib/store-user-auth";

type MemberRow = {
  store_id: string;
  user_id: string;
  username: string | null;
  display_name: string | null;
  role: "store_admin" | "seller" | "accounting" | "viewer";
  permissions: string[];
  point_id?: string | null;
  active: boolean;
  created_at: string;
};

type PointRow = { id: string; name: string; kind: string };

const PERMISSION_OPTIONS: Array<{ value: StoreMenuPermission; label: string; description: string }> = [
  { value: "store", label: "Mi tienda", description: "Datos y apariencia de la tienda" },
  { value: "billing", label: "Facturación", description: "Configuración de comprobantes y pagos" },
  { value: "pos", label: "POS / Facturación", description: "Ventas, documentos y caja" },
  { value: "clients", label: "Clientes", description: "Consultar y administrar clientes" },
  { value: "users", label: "Usuarios", description: "Crear usuarios y asignar permisos" },
  { value: "products", label: "Productos y catálogos", description: "Productos, catálogos, categorías por catálogo y campañas" },
  { value: "categories", label: "Categorías", description: "Organizar el catálogo" },
  { value: "orders", label: "Pedidos", description: "Consultar pedidos y actualizar sus estados" },
    { value: "inventory", label: "Inventario y kardex", description: "Ver existencias, bodegas y movimientos" },
    { value: "inventory_adjust", label: "Ajustes de inventario", description: "Corregir existencias con motivo" },
    { value: "transfers", label: "Traslados", description: "Mover productos entre bodegas" },
    { value: "purchases", label: "Compras", description: "Registrar y anular compras" },
    { value: "suppliers", label: "Proveedores", description: "Administrar proveedores" },
    { value: "payables", label: "Cuentas por pagar", description: "Registrar pagos a proveedores" },
    { value: "audit", label: "Auditoría e informes", description: "Ver informes de ventas, ganancias, inventario y el historial de operaciones" },
  ] as const;

function inputProps() {
  return {
    className: "w-full rounded-2xl border px-4 py-3 text-sm outline-none",
    style: {
      borderColor: "var(--t-card-border)",
      background: "color-mix(in oklab, var(--t-card-bg) 92%, transparent)",
      color: "var(--t-text)",
    } as React.CSSProperties,
  };
}

function cardProps() {
  return {
    className: "rounded-[28px] border p-6",
    style: {
      borderColor: "var(--t-card-border)",
      background: "var(--t-card-bg)",
      color: "var(--t-text)",
    } as React.CSSProperties,
  };
}

export default function StoreUsersPage() {
  const [store, setStore] = useState<DashboardStore | null>(null);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>(["pos"]);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editingPermissions, setEditingPermissions] = useState<string[]>([]);
  const [loginLink, setLoginLink] = useState("");
  const [points, setPoints] = useState<PointRow[]>([]);
  const [pointId, setPointId] = useState("");
  const [editingPointId, setEditingPointId] = useState("");

  useEffect(() => {
    load();
    // Load the current user's tenant memberships once when this screen opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function load() {
    setLoading(true);
    try {
      const access = await getDashboardStore();
      if (!access.store) {
        throw new Error("No tienes acceso a ninguna tienda.");
      }
      if (!hasStorePermission(access, "users")) {
        throw new Error("El administrador de la tienda no te dio permiso para gestionar usuarios.");
      }
      setStore(access.store);
      await loadMembers(access.store.id);
      const { data: pointData } = await supabaseBrowser()
        .from("erp_warehouses")
        .select("id,name,kind")
        .eq("store_id", access.store.id)
        .eq("active", true)
        .order("name");
      setPoints((pointData ?? []) as PointRow[]);
    } catch (err: unknown) {
      await Swal.fire({
        icon: "error",
        title: "No se pudieron cargar los usuarios de tienda",
        text: String((err as Error)?.message ?? err),
        background: "#0b0b0b",
        color: "#fff",
        confirmButtonColor: "#ef4444",
      });
    } finally {
      setLoading(false);
    }
  }

  async function loadMembers(storeId: string) {
    const sb = supabaseBrowser();
    const { data: sessionData, error: sessionError } = await sb.auth.getSession();
    if (sessionError) throw sessionError;
    const response = await fetch(`/api/store-team/users?store_id=${encodeURIComponent(storeId)}`, {
      headers: { Authorization: `Bearer ${sessionData.session?.access_token ?? ""}` },
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "No se pudieron cargar los usuarios.");
    setMembers((result.users ?? []) as MemberRow[]);
  }

  async function inviteUser() {
    if (!store) return;
    if (!username.trim() || !password.trim()) {
      await Swal.fire({
        icon: "warning",
        title: "Usuario y contraseña requeridos",
        text: "Escribe el usuario interno y la contraseña inicial.",
        background: "#0b0b0b",
        color: "#fff",
        confirmButtonColor: "#f59e0b",
      });
      return;
    }

    setSaving(true);

    try {
      const sb = supabaseBrowser();
      const { data: sessionData, error: sessionError } = await sb.auth.getSession();
      if (sessionError) throw sessionError;
      const response = await fetch("/api/store-team/users", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sessionData.session?.access_token ?? ""}`,
        },
        body: JSON.stringify({
          store_id: store.id,
          username,
          display_name: displayName,
          password,
          permissions: selectedPermissions,
          point_id: pointId || null,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "No se pudo crear el usuario.");

      await Swal.fire({
        icon: "success",
        title: "Acceso creado",
        text: `El usuario ${result.user.username} ya puede entrar con su contraseña y el enlace exclusivo de esta tienda.`,
        background: "#0b0b0b",
        color: "#fff",
        confirmButtonColor: "#22c55e",
      });

      setLoginLink(String(result.login_url ?? ""));
      setUsername("");
      setDisplayName("");
      setPassword("");
      setSelectedPermissions(["pos"]);
      setPointId("");
      await loadMembers(store.id);
    } catch (err: unknown) {
      await Swal.fire({
        icon: "error",
        title: "No se pudo invitar al usuario",
        text: String((err as Error)?.message ?? err),
        background: "#0b0b0b",
        color: "#fff",
        confirmButtonColor: "#ef4444",
      });
    } finally {
      setSaving(false);
    }
  }

  async function updateMember(
    member: MemberRow,
    changes: { permissions?: string[]; active?: boolean; point_id?: string | null },
  ) {
    if (!store) return;
    setSaving(true);
    try {
      const sb = supabaseBrowser();
      const { data: sessionData, error: sessionError } = await sb.auth.getSession();
      if (sessionError) throw sessionError;
      const response = await fetch("/api/store-team/users", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sessionData.session?.access_token ?? ""}`,
        },
        body: JSON.stringify({
          store_id: store.id,
          user_id: member.user_id,
          ...changes,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "No se pudieron actualizar los permisos.");
      setMembers((current) =>
        current.map((row) => row.user_id === member.user_id ? result.user as MemberRow : row),
      );
      setEditingUserId(null);
      await Swal.fire({
        icon: "success",
        title: "Acceso actualizado",
        timer: 1000,
        showConfirmButton: false,
        background: "#0b0b0b",
        color: "#fff",
      });
    } catch (error: unknown) {
      await Swal.fire({
        icon: "error",
        title: "No se pudo actualizar el acceso",
        text: String((error as Error)?.message ?? error),
        background: "#0b0b0b",
        color: "#fff",
        confirmButtonColor: "#ef4444",
      });
    } finally {
      setSaving(false);
    }
  }

  async function toggleMember(member: MemberRow) {
    const res = await Swal.fire({
      icon: "warning",
      title: member.active ? "Desactivar acceso" : "Reactivar acceso",
      text: member.active
        ? `El usuario ${member.username} dejará de entrar al dashboard de esta tienda.`
        : `El usuario ${member.username} podrá volver a entrar con su contraseña.`,
      showCancelButton: true,
      confirmButtonText: member.active ? "Desactivar" : "Reactivar",
      cancelButtonText: "Cancelar",
      background: "#0b0b0b",
      color: "#fff",
      confirmButtonColor: member.active ? "#ef4444" : "#22c55e",
    });
    if (!res.isConfirmed) return;
    await updateMember(member, { active: !member.active });
  }

  async function copyLoginLink(member: MemberRow) {
    if (!store || !member.username) {
      await Swal.fire({
        icon: "info",
        title: "Usuario anterior",
        text: "Este acceso se creó antes de habilitar usuarios internos. Crea un nuevo usuario para generar un enlace especial.",
        background: "#0b0b0b",
        color: "#fff",
      });
      return;
    }
    const url = new URL(`/acceso/${encodeURIComponent(store.slug)}`, window.location.origin);
    url.searchParams.set("sid", store.id);
    url.searchParams.set("usuario", member.username);
    try {
      await navigator.clipboard.writeText(url.toString());
      await Swal.fire({
        icon: "success",
        title: "Enlace copiado",
        text: "Compártelo con el trabajador junto con su usuario y contraseña.",
        timer: 1400,
        showConfirmButton: false,
        background: "#0b0b0b",
        color: "#fff",
      });
    } catch (error: unknown) {
      await Swal.fire({
        icon: "error",
        title: "No se pudo copiar el enlace",
        text: String((error as Error)?.message ?? error),
        background: "#0b0b0b",
        color: "#fff",
      });
    }
  }

  async function resetPassword(member: MemberRow) {
    if (!store) return;
    const result = await Swal.fire({
      title: `Nueva contraseña para ${member.username ?? member.display_name ?? "usuario"}`,
      input: "password",
      inputPlaceholder: "Mínimo 8 caracteres",
      inputAttributes: { minlength: "8", autocomplete: "new-password" },
      showCancelButton: true,
      confirmButtonText: "Asignar contraseña",
      cancelButtonText: "Cancelar",
      confirmButtonColor: "#8b5cf6",
      background: "#0b0b0b",
      color: "#fff",
      preConfirm: (value) => {
        if (!value || value.length < 8) {
          Swal.showValidationMessage("La contraseña debe tener al menos 8 caracteres.");
          return false;
        }
        return value;
      },
    });
    if (!result.isConfirmed || !result.value) return;

    setSaving(true);
    try {
      const sb = supabaseBrowser();
      const { data: sessionData, error: sessionError } = await sb.auth.getSession();
      if (sessionError) throw sessionError;
      const response = await fetch("/api/store-team/users", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sessionData.session?.access_token ?? ""}`,
        },
        body: JSON.stringify({
          store_id: store.id,
          user_id: member.user_id,
          new_password: result.value,
        }),
      });
      const responseData = await response.json();
      if (!response.ok) throw new Error(responseData.error ?? "No se pudo cambiar la contraseña.");
      await Swal.fire({
        icon: "success",
        title: "Contraseña actualizada",
        text: "Comparte la nueva contraseña con el usuario por un canal privado.",
        background: "#0b0b0b",
        color: "#fff",
      });
    } catch (error: unknown) {
      await Swal.fire({
        icon: "error",
        title: "No se pudo cambiar la contraseña",
        text: String((error as Error)?.message ?? error),
        background: "#0b0b0b",
        color: "#fff",
      });
    } finally {
      setSaving(false);
    }
  }

  // Enlace único de la tienda: el trabajador escribe su usuario al entrar.
  const storeLoginLink = useMemo(() => {
    if (!store || typeof window === "undefined") return "";
    const url = new URL(`/acceso/${encodeURIComponent(store.slug)}`, window.location.origin);
    url.searchParams.set("sid", store.id);
    return url.toString();
  }, [store]);

  async function copyStoreLoginLink() {
    try {
      await navigator.clipboard.writeText(storeLoginLink);
      await Swal.fire({
        icon: "success",
        title: "Enlace general copiado",
        text: "Sirve para todos los usuarios de esta tienda.",
        timer: 1400,
        showConfirmButton: false,
        background: "#0b0b0b",
        color: "#fff",
      });
    } catch {
      window.prompt("Copia el enlace:", storeLoginLink);
    }
  }

  async function copyNewLoginLink() {
    try {
      await navigator.clipboard.writeText(loginLink);
      await Swal.fire({
        icon: "success",
        title: "Enlace copiado",
        timer: 1000,
        showConfirmButton: false,
        background: "#0b0b0b",
        color: "#fff",
      });
    } catch (error: unknown) {
      await Swal.fire({
        icon: "error",
        title: "No se pudo copiar",
        text: String((error as Error)?.message ?? error),
        background: "#0b0b0b",
        color: "#fff",
      });
    }
  }

  return (
    <main className="space-y-6">
      <div {...cardProps()}>
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-2xl font-semibold">👤 Usuarios de tienda</h1>
            <p className="mt-2 text-sm" style={{ color: "var(--t-muted)" }}>
              Crea accesos internos para tu equipo y decide exactamente qué secciones puede ver cada persona.
            </p>
          </div>
        </div>
      </div>

      {storeLoginLink ? (
        <div
          className="flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-center sm:justify-between"
          style={{ borderColor: "color-mix(in oklab, var(--t-accent) 40%, var(--t-card-border))", background: "color-mix(in oklab, var(--t-accent) 8%, var(--t-card-bg))", color: "var(--t-text)" }}
        >
          <div className="min-w-0">
            <p className="font-semibold">🔗 Enlace de acceso para todo el equipo</p>
            <p className="mt-0.5 text-xs" style={{ color: "var(--t-muted)" }}>
              Un solo enlace para la tienda: cada trabajador entra con su usuario y contraseña. Guárdalo en los equipos de cada punto.
            </p>
            <p className="mt-1 truncate text-xs font-mono" style={{ color: "var(--t-muted)" }}>{storeLoginLink}</p>
          </div>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={() => void copyStoreLoginLink()}
              className="rounded-full px-4 py-2 text-sm font-semibold text-white"
              style={{ background: "var(--t-cta)" }}
            >
              Copiar enlace general
            </button>
            <a
              href={`https://wa.me/?text=${encodeURIComponent(`Acceso al sistema de ${store?.name ?? "la tienda"}. Entra con tu usuario y contraseña:\n${storeLoginLink}`)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-full border px-4 py-2 text-sm font-semibold"
              style={{ borderColor: "var(--t-card-border)" }}
            >
              WhatsApp
            </a>
          </div>
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[420px_1fr]">
        <div {...cardProps()}>
          <h2 className="text-lg font-semibold">Crear acceso para un trabajador</h2>
          <div className="mt-4 space-y-4">
            <div>
              <label className="text-sm font-semibold">Usuario interno</label>
              <input
                {...inputProps()}
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value.toLowerCase())}
                placeholder="Ej. USU01"
                autoComplete="off"
              />
              <p className="mt-1 text-xs" style={{ color: "var(--t-muted)" }}>
                De 3 a 32 caracteres: letras, números, punto, guion o guion bajo. Único dentro de esta tienda.
              </p>
            </div>

            <div>
              <label className="text-sm font-semibold">Nombre visible (opcional)</label>
              <input
                {...inputProps()}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Ej. Juan, vendedor de mostrador"
                maxLength={100}
              />
            </div>

            <div>
              <label className="text-sm font-semibold">Contraseña inicial</label>
              <input
                {...inputProps()}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Mínimo 8 caracteres"
                minLength={8}
                autoComplete="new-password"
              />
            </div>

            <div>
              <label className="text-sm font-semibold">Punto de venta / bodega asignado</label>
              <select {...inputProps()} value={pointId} onChange={(e) => setPointId(e.target.value)}>
                <option value="">Todos los puntos (sin restricción)</option>
                {points.map((pt) => (
                  <option key={pt.id} value={pt.id}>{pt.kind === "point" ? "📍" : "🏬"} {pt.name}</option>
                ))}
              </select>
              <p className="mt-1 text-xs" style={{ color: "var(--t-muted)" }}>
                Con un punto asignado, el usuario solo verá y moverá el inventario de ese punto. Los puntos se crean en Inventario → Puntos y bodegas.
              </p>
            </div>

            <div>
              <label className="text-sm font-semibold">Secciones permitidas</label>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {PERMISSION_OPTIONS.map((option) => (
                  <label
                    key={option.value}
                    className="flex cursor-pointer items-start gap-3 rounded-2xl border p-3 text-sm"
                    style={{ borderColor: "var(--t-card-border)" }}
                  >
                    <input
                      type="checkbox"
                      checked={selectedPermissions.includes(option.value)}
                      onChange={(e) => {
                        setSelectedPermissions((prev) =>
                          e.target.checked
                            ? [...new Set([...prev, option.value])]
                            : prev.filter((value) => value !== option.value),
                        );
                      }}
                      className="mt-0.5 h-4 w-4 shrink-0 rounded border"
                    />
                    <span>
                      <span className="block font-semibold">{option.label}</span>
                      <span className="text-xs" style={{ color: "var(--t-muted)" }}>
                        {option.description}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </div>

            <button
              onClick={inviteUser}
              disabled={saving}
              className="rounded-2xl border px-4 py-3 text-sm font-semibold transition hover:brightness-110 disabled:opacity-60"
              style={{
                borderColor: "color-mix(in oklab, var(--t-accent) 45%, var(--t-card-border))",
                background: "var(--t-cta)",
                color: "#0b0b0b",
              }}
            >
              {saving ? "Creando acceso..." : "Crear usuario de tienda"}
            </button>

            <p className="text-xs" style={{ color: "var(--t-muted)" }}>
              No necesita correo propio. Comparte el enlace especial de acceso, el usuario interno y la contraseña por un canal privado.
            </p>
            {loginLink ? (
              <div className="rounded-2xl border p-3" style={{ borderColor: "var(--t-card-border)" }}>
                <p className="text-xs font-semibold">Enlace de acceso recién creado</p>
                <p className="mt-1 break-all text-xs" style={{ color: "var(--t-muted)" }}>{loginLink}</p>
                <button
                  type="button"
                  className="btn-soft mt-3 w-full px-3 py-2 text-sm font-semibold"
                  onClick={copyNewLoginLink}
                >
                  Copiar enlace
                </button>
              </div>
            ) : null}
          </div>
        </div>

        <div {...cardProps()}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Usuarios asignados</h2>
              <p className="mt-1 text-sm" style={{ color: "var(--t-muted)" }}>
                {members.length} usuario{members.length === 1 ? "" : "s"} en esta tienda.
              </p>
            </div>
          </div>

          {loading ? (
            <p className="mt-6 text-sm" style={{ color: "var(--t-muted)" }}>
              Cargando usuarios...
            </p>
          ) : members.length === 0 ? (
            <p className="mt-6 text-sm" style={{ color: "var(--t-muted)" }}>
              No hay usuarios asignados aún.
            </p>
          ) : (
            <div className="mt-6 space-y-4">
              {members.map((member) => (
                <div
                  key={`${member.store_id}-${member.user_id}`}
                  className="rounded-[24px] border p-4"
                  style={{ borderColor: "var(--t-card-border)", background: "color-mix(in oklab, var(--t-card-bg) 94%, transparent)" }}
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold">{member.display_name || member.username || "Usuario anterior"}</p>
                        <span className="rounded-full border px-2 py-1 text-[10px] font-semibold" style={{
                          borderColor: member.active ? "rgba(16,185,129,.35)" : "rgba(239,68,68,.35)",
                          color: member.active ? "#34d399" : "#f87171",
                        }}>
                          {member.active ? "Activo" : "Desactivado"}
                        </span>
                      </div>
                      <p className="mt-1 text-sm" style={{ color: "var(--t-muted)" }}>
                        Usuario: <b>{member.username ?? "Acceso por correo existente"}</b>
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {member.permissions.map((permission) => (
                          <span
                            key={permission}
                            className="rounded-full border px-2 py-1 text-[10px]"
                            style={{ borderColor: "var(--t-card-border)", color: "var(--t-muted)" }}
                          >
                            {PERMISSION_OPTIONS.find((option) => option.value === permission)?.label ?? permission}
                          </span>
                        ))}
                        {member.permissions.length === 0 ? (
                          <span className="text-xs" style={{ color: "var(--t-muted)" }}>
                            Sin secciones habilitadas
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1 text-xs" style={{ color: "var(--t-muted)" }}>
                        Punto: <b>{points.find((pt) => pt.id === member.point_id)?.name ?? "Todos"}</b>
                      </p>
                      <p className="mt-1 text-xs" style={{ color: "var(--t-muted)" }}>
                        Agregado: {new Date(member.created_at).toLocaleString("es-CO")}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <button
                        type="button"
                        className="btn-soft rounded-xl px-3 py-2 text-xs font-semibold"
                        onClick={() => copyLoginLink(member)}
                      >
                        Copiar enlace
                      </button>
                      <button
                        type="button"
                        className="btn-soft rounded-xl px-3 py-2 text-xs font-semibold"
                        disabled={saving}
                        onClick={() => resetPassword(member)}
                      >
                        Cambiar clave
                      </button>
                      <button
                        type="button"
                        className="btn-soft rounded-xl px-3 py-2 text-xs font-semibold"
                        onClick={() => {
                          setEditingUserId(editingUserId === member.user_id ? null : member.user_id);
                          setEditingPermissions(member.permissions ?? []);
                          setEditingPointId(member.point_id ?? "");
                        }}
                      >
                        {editingUserId === member.user_id ? "Cancelar" : "Permisos"}
                      </button>
                      <button
                        type="button"
                        className="rounded-xl border px-3 py-2 text-xs font-semibold"
                        style={{
                          borderColor: member.active ? "rgba(239,68,68,.35)" : "rgba(16,185,129,.35)",
                          color: member.active ? "#f87171" : "#34d399",
                        }}
                        disabled={saving}
                        onClick={() => toggleMember(member)}
                      >
                        {member.active ? "Desactivar" : "Reactivar"}
                      </button>
                    </div>
                  </div>
                  {editingUserId === member.user_id ? (
                    <div className="mt-4 border-t pt-4" style={{ borderColor: "var(--t-card-border)" }}>
                      <p className="mb-2 text-sm font-semibold">Punto asignado</p>
                      <select {...inputProps()} value={editingPointId} onChange={(e) => setEditingPointId(e.target.value)}>
                        <option value="">Todos los puntos (sin restricción)</option>
                        {points.map((pt) => (
                          <option key={pt.id} value={pt.id}>{pt.kind === "point" ? "📍" : "🏬"} {pt.name}</option>
                        ))}
                      </select>
                      <p className="mb-2 mt-4 text-sm font-semibold">Permisos del usuario</p>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {PERMISSION_OPTIONS.map((option) => (
                          <label key={option.value} className="flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked={editingPermissions.includes(option.value)}
                              onChange={(event) => setEditingPermissions((current) =>
                                event.target.checked
                                  ? [...new Set([...current, option.value])]
                                  : current.filter((value) => value !== option.value),
                              )}
                            />
                            {option.label}
                          </label>
                        ))}
                      </div>
                      <button
                        type="button"
                        className="btn-cta mt-4 px-4 py-2 text-sm font-semibold"
                        disabled={saving}
                        onClick={() => updateMember(member, { permissions: editingPermissions, point_id: editingPointId || null })}
                      >
                        {saving ? "Guardando..." : "Guardar cambios"}
                      </button>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
