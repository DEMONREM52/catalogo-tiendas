"use client";

import { useEffect, useMemo, useState } from "react";
import Swal from "sweetalert2";
import { AnimatePresence, motion } from "framer-motion";
import { AtSign, Check, Copy, Eye, EyeOff, KeyRound, Link2, Loader2, MapPin, MessageCircle, Pencil, Power, Search, ShieldCheck, Trash2, UserPlus, UserRound, Users, X } from "lucide-react";
import { Avatar, EditMemberDialog, type ProfileChanges } from "./EditMemberDialog";
import { PasswordStrength } from "@/components/PasswordStrength";
import { supabaseBrowser } from "@/lib/supabase/client";
import { getDashboardStore, hasStorePermission, type DashboardStore } from "@/lib/store-utils";
import { PERMISSION_LIST } from "@/lib/permissions";
import { PermissionPicker } from "./PermissionPicker";

type MemberRow = {
  store_id: string;
  user_id: string;
  username: string | null;
  display_name: string | null;
  role: "store_admin" | "seller" | "accounting" | "viewer";
  permissions: string[];
  point_id?: string | null;
  point_ids?: string[] | null;
  active: boolean;
  created_at: string;
};

type PointRow = { id: string; name: string; kind: string };

const PERMISSION_OPTIONS = PERMISSION_LIST;

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
  const [editingExtraPoints, setEditingExtraPoints] = useState<string[]>([]);
  const [editMember, setEditMember] = useState<MemberRow | null>(null);
  const [editFocusPassword, setEditFocusPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");

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
    const list = (result.users ?? []) as MemberRow[];
    setMembers(list);
    return list;
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
    changes: { permissions?: string[]; active?: boolean; point_id?: string | null; point_ids?: string[] },
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

  async function deleteMember(member: MemberRow) {
    if (!store) return;
    const who = member.display_name || member.username || "este usuario";
    const res = await Swal.fire({
      icon: "warning",
      title: `Eliminar a ${who}`,
      html: "Perderá el acceso de forma <b>permanente</b> y su usuario quedará libre.<br/><small>Las ventas, abonos y movimientos que hizo se conservan en el historial.</small>",
      input: "text",
      inputPlaceholder: `Escribe ELIMINAR para confirmar`,
      showCancelButton: true,
      confirmButtonText: "Eliminar usuario",
      cancelButtonText: "Cancelar",
      background: "#0b0b0b",
      color: "#fff",
      confirmButtonColor: "#ef4444",
      inputValidator: (value) => (value.trim().toUpperCase() === "ELIMINAR" ? null : "Escribe ELIMINAR para confirmar."),
    });
    if (!res.isConfirmed) return;
    setSaving(true);
    try {
      const { data: sessionData, error: sessionError } = await supabaseBrowser().auth.getSession();
      if (sessionError) throw sessionError;
      const response = await fetch("/api/store-team/users", {
        method: "DELETE",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionData.session?.access_token ?? ""}` },
        body: JSON.stringify({ store_id: store.id, user_id: member.user_id }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "No se pudo eliminar el usuario.");
      setMembers((current) => current.filter((row) => row.user_id !== member.user_id));
      await Swal.fire({
        icon: result.warning ? "info" : "success",
        title: "Usuario eliminado",
        text: result.warning ?? `${who} ya no tiene acceso a la tienda.`,
        timer: result.warning ? undefined : 1500,
        showConfirmButton: Boolean(result.warning),
        background: "#0b0b0b",
        color: "#fff",
      });
    } catch (error: unknown) {
      await Swal.fire({ icon: "error", title: "No se pudo eliminar", text: String((error as Error)?.message ?? error), background: "#0b0b0b", color: "#fff" });
    } finally {
      setSaving(false);
    }
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

  // Guarda nombre visible, usuario interno y/o contraseña. Los errores se muestran dentro de la ventana.
  async function saveProfile(member: { user_id: string }, changes: ProfileChanges) {
    if (!store) return;
    const sb = supabaseBrowser();
    const { data: sessionData, error: sessionError } = await sb.auth.getSession();
    if (sessionError) throw sessionError;
    const response = await fetch("/api/store-team/users", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${sessionData.session?.access_token ?? ""}`,
      },
      body: JSON.stringify({ store_id: store.id, user_id: member.user_id, ...changes }),
    });
    const responseData = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(responseData.error ?? "No se pudo guardar el usuario.");
    // Se vuelve a leer la lista desde la base para mostrar exactamente lo que quedó guardado.
    const fresh = await loadMembers(store.id);
    const saved = fresh.find((row) => row.user_id === member.user_id);
    if (changes.username && saved && saved.username !== changes.username) {
      throw new Error(`El cambio no quedó guardado (sigue como «${saved.username}»). Inténtalo de nuevo.`);
    }
    setEditMember(null);
    const parts = [
      changes.username ? `ahora entra con «${changes.username}»` : null,
      changes.new_password ? "tiene contraseña nueva" : null,
      changes.display_name !== undefined && !changes.username && !changes.new_password ? "nombre actualizado" : null,
    ].filter(Boolean);
    void Swal.fire({
      toast: true,
      position: "top",
      icon: "success",
      title: "Usuario actualizado",
      text: parts.length ? parts.join(" · ") : undefined,
      timer: 2600,
      showConfirmButton: false,
      background: "var(--t-bg-base)",
      color: "var(--t-text)",
    });
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

  const activeCount = members.filter((m) => m.active).length;
  const visibleMembers = useMemo(() => {
    const term = query.trim().toLowerCase();
    return members.filter((m) => {
      if (statusFilter === "active" && !m.active) return false;
      if (statusFilter === "inactive" && m.active) return false;
      if (!term) return true;
      const pointName = points.find((pt) => pt.id === m.point_id)?.name ?? "";
      return `${m.display_name ?? ""} ${m.username ?? ""} ${pointName}`.toLowerCase().includes(term);
    });
  }, [members, query, statusFilter, points]);
  const newUserClean = username.replace(/\s+/g, "");
  const newUserOk = /^[a-z0-9][a-z0-9._-]{2,31}$/.test(newUserClean.toLowerCase());

  return (
    <main className="space-y-5">
      <section className="relative overflow-hidden rounded-[28px] border p-5 sm:p-7" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)", color: "var(--t-text)" }}>
        <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full blur-3xl" style={{ background: "color-mix(in oklab, var(--t-accent) 18%, transparent)" }} />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-[0.2em]" style={{ color: "var(--t-accent)" }}>{store?.name ?? "Tu tienda"} · equipo</p>
            <h1 className="mt-1 flex items-center gap-2 text-2xl font-black sm:text-3xl"><Users size={26} /> Usuarios y vendedores</h1>
            <p className="mt-1 max-w-2xl text-sm" style={{ color: "var(--t-muted)" }}>
              Crea accesos para tu equipo y decide qué puede ver y hacer cada persona.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            {[["Usuarios", members.length, "var(--t-text)"], ["Activos", activeCount, "#16a34a"], ["Desactivados", members.length - activeCount, "#ef4444"]].map(([label, value, color]) => (
              <div key={String(label)} className="rounded-2xl border px-3 py-2 sm:px-4" style={{ borderColor: "var(--t-card-border)", background: "color-mix(in oklab, var(--t-bg-base) 55%, transparent)" }}>
                <p className="text-xl font-black tabular-nums" style={{ color: String(color) }}>{loading ? "…" : String(value)}</p>
                <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: "var(--t-muted)" }}>{String(label)}</p>
              </div>
            ))}
          </div>
        </div>

        {storeLoginLink ? (
          <div className="relative mt-5 flex flex-col gap-3 rounded-2xl border p-3.5 sm:flex-row sm:items-center sm:justify-between" style={{ borderColor: "color-mix(in oklab, var(--t-accent) 40%, var(--t-card-border))", background: "color-mix(in oklab, var(--t-accent) 8%, transparent)" }}>
            <div className="flex min-w-0 items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl text-white" style={{ background: "var(--t-accent)" }}><Link2 size={18} /></span>
              <div className="min-w-0">
                <p className="text-sm font-bold">Enlace de acceso para todo el equipo</p>
                <p className="text-xs" style={{ color: "var(--t-muted)" }}>Cada trabajador entra con su usuario y contraseña. Guárdalo en los equipos de cada punto.</p>
                <p className="mt-0.5 truncate font-mono text-[11px]" style={{ color: "var(--t-muted)" }}>{storeLoginLink}</p>
              </div>
            </div>
            <div className="grid shrink-0 grid-cols-2 gap-2 sm:flex">
              <button type="button" onClick={() => void copyStoreLoginLink()} className="inline-flex items-center justify-center gap-1.5 rounded-full px-4 py-2 text-sm font-bold text-white transition hover:-translate-y-0.5" style={{ background: "linear-gradient(135deg, var(--t-accent), var(--t-accent2, var(--t-accent)))" }}>
                <Copy size={15} /> Copiar
              </button>
              <a
                href={`https://wa.me/?text=${encodeURIComponent(`Acceso al sistema de ${store?.name ?? "la tienda"}. Entra con tu usuario y contraseña:\n${storeLoginLink}`)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-1.5 rounded-full border px-4 py-2 text-sm font-bold transition hover:-translate-y-0.5"
                style={{ borderColor: "var(--t-card-border)" }}
              >
                <MessageCircle size={15} /> WhatsApp
              </a>
            </div>
          </div>
        ) : null}
      </section>

      <div className="grid items-start gap-5 xl:grid-cols-[400px_minmax(0,1fr)]">
        {/* Crear acceso */}
        <section className="rounded-[28px] border p-5 sm:p-6 xl:sticky xl:top-4" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)", color: "var(--t-text)" }}>
          <h2 className="flex items-center gap-2 text-lg font-black"><UserPlus size={20} style={{ color: "var(--t-accent)" }} /> Crear acceso</h2>
          <p className="mt-0.5 text-xs" style={{ color: "var(--t-muted)" }}>No necesita correo: solo usuario y contraseña.</p>
          <div className="mt-4 space-y-4">
            <label className="block">
              <span className="text-xs font-bold">Usuario interno</span>
              <span className="relative mt-1.5 block">
                <AtSign size={17} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 opacity-55" />
                <input
                  {...inputProps()}
                  className={`${inputProps().className} pl-11 pr-11 font-semibold`}
                  style={{ ...inputProps().style, paddingLeft: "2.75rem", paddingRight: "2.75rem", borderColor: newUserClean && !newUserOk ? "#ef4444" : inputProps().style.borderColor }}
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value.replace(/\s+/g, ""))}
                  placeholder="Ej. USU01"
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  maxLength={32}
                />
                {newUserClean ? (
                  <span className="absolute right-3.5 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-full text-white" style={{ background: newUserOk ? "#16a34a" : "#ef4444" }}>
                    {newUserOk ? <Check size={13} /> : <X size={13} />}
                  </span>
                ) : null}
              </span>
              <span className="mt-1.5 block text-[11px]" style={{ color: "var(--t-muted)" }}>
                3 a 32 caracteres: letras, números, punto, guion o guion bajo. Se guarda como lo escribas; al entrar no importan mayúsculas.
              </span>
            </label>

            <label className="block">
              <span className="text-xs font-bold">Nombre visible <span className="font-normal opacity-60">(opcional)</span></span>
              <span className="relative mt-1.5 block">
                <UserRound size={17} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 opacity-55" />
                <input {...inputProps()} className={`${inputProps().className} pl-11`} style={{ ...inputProps().style, paddingLeft: "2.75rem", paddingRight: "2.75rem" }} value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Ej. Juan, vendedor de mostrador" maxLength={100} />
              </span>
            </label>

            <label className="block">
              <span className="text-xs font-bold">Contraseña inicial</span>
              <span className="relative mt-1.5 block">
                <KeyRound size={17} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 opacity-55" />
                <input
                  {...inputProps()}
                  className={`${inputProps().className} pl-11 pr-12`} style={{ ...inputProps().style, paddingLeft: "2.75rem", paddingRight: "2.75rem" }}
                  type={showNewPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Mínimo 4 caracteres"
                  minLength={4}
                  autoComplete="new-password"
                />
                <button type="button" onClick={() => setShowNewPassword((v) => !v)} className="absolute right-2 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-xl opacity-70 hover:opacity-100" aria-label={showNewPassword ? "Ocultar contraseña" : "Mostrar contraseña"}>
                  {showNewPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </span>
              {password && password.length < 4 ? <span className="mt-1.5 block text-[11px] text-red-500">Faltan {4 - password.length} caracteres.</span> : null}
              <PasswordStrength password={password} hints={[username, displayName, store?.name]} />
            </label>

            <label className="block">
              <span className="text-xs font-bold">Punto de venta o bodega</span>
              <span className="relative mt-1.5 block">
                <MapPin size={17} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 opacity-55" />
                <select {...inputProps()} className={`${inputProps().className} pl-11`} style={{ ...inputProps().style, paddingLeft: "2.75rem", paddingRight: "2.75rem" }} value={pointId} onChange={(e) => setPointId(e.target.value)}>
                  <option value="">Todos los puntos (sin restricción)</option>
                  {points.map((pt) => (
                    <option key={pt.id} value={pt.id}>{pt.kind === "point" ? "📍" : "🏬"} {pt.name}</option>
                  ))}
                </select>
              </span>
              <span className="mt-1.5 block text-[11px]" style={{ color: "var(--t-muted)" }}>Con un punto asignado solo verá y moverá el inventario de ese punto.</span>
            </label>

            <div>
              <span className="text-xs font-bold">Permisos</span>
              <div className="mt-2">
                <PermissionPicker value={selectedPermissions} onChange={setSelectedPermissions} disabled={saving} compact storeId={store?.id} />
              </div>
            </div>

            <button
              onClick={inviteUser}
              disabled={saving || !newUserOk || password.length < 4}
              className="inline-flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-3.5 text-sm font-bold text-white shadow-lg transition hover:-translate-y-0.5 disabled:pointer-events-none disabled:opacity-50"
              style={{ background: "linear-gradient(135deg, var(--t-accent), var(--t-accent2, var(--t-accent)))" }}
            >
              {saving ? <Loader2 size={16} className="animate-spin" /> : <UserPlus size={16} />}
              {saving ? "Creando acceso…" : "Crear usuario"}
            </button>

            <AnimatePresence>
              {loginLink ? (
                <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="rounded-2xl border p-3" style={{ borderColor: "color-mix(in oklab, #22c55e 45%, var(--t-card-border))", background: "color-mix(in oklab, #22c55e 8%, transparent)" }}>
                  <p className="flex items-center gap-1.5 text-xs font-bold"><Check size={14} className="text-green-500" /> Enlace del usuario recién creado</p>
                  <p className="mt-1 break-all font-mono text-[11px]" style={{ color: "var(--t-muted)" }}>{loginLink}</p>
                  <button type="button" className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-bold" style={{ borderColor: "var(--t-card-border)" }} onClick={copyNewLoginLink}>
                    <Copy size={13} /> Copiar enlace
                  </button>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>
        </section>

        {/* Equipo */}
        <section className="rounded-[28px] border p-4 sm:p-6" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)", color: "var(--t-text)" }}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-black">Tu equipo</h2>
              <p className="text-xs" style={{ color: "var(--t-muted)" }}>{members.length} usuario{members.length === 1 ? "" : "s"} en esta tienda</p>
            </div>
            <div className="flex w-full flex-wrap gap-2 sm:w-auto">
              <span className="relative min-w-0 flex-1 sm:w-56 sm:flex-none">
                <Search size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 opacity-55" />
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar persona o usuario…" className="w-full rounded-full border py-2 pl-9 pr-3 text-base outline-none sm:text-sm" style={{ borderColor: "var(--t-card-border)", background: "color-mix(in oklab, var(--t-bg-base) 55%, transparent)", color: "var(--t-text)" }} />
              </span>
              <div className="flex rounded-full border p-0.5" style={{ borderColor: "var(--t-card-border)" }}>
                {([["all", "Todos"], ["active", "Activos"], ["inactive", "Inactivos"]] as const).map(([value, label]) => (
                  <button key={value} type="button" onClick={() => setStatusFilter(value)} className="rounded-full px-3 py-1.5 text-xs font-bold transition" style={statusFilter === value ? { background: "var(--t-accent)", color: "#fff" } : { color: "var(--t-muted)" }}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {loading ? (
            <div className="mt-5 space-y-3">
              {[0, 1, 2].map((i) => <div key={i} className="h-28 animate-pulse rounded-3xl" style={{ background: "color-mix(in oklab, var(--t-text) 6%, transparent)" }} />)}
            </div>
          ) : members.length === 0 ? (
            <div className="grid place-items-center gap-2 py-14 text-center">
              <span className="grid h-14 w-14 place-items-center rounded-3xl" style={{ background: "color-mix(in oklab, var(--t-accent) 14%, transparent)", color: "var(--t-accent)" }}><Users size={26} /></span>
              <p className="font-bold">Aún no hay usuarios</p>
              <p className="max-w-xs text-xs" style={{ color: "var(--t-muted)" }}>Crea el primer acceso con el formulario. Cada persona entra con su propio usuario.</p>
            </div>
          ) : visibleMembers.length === 0 ? (
            <p className="py-10 text-center text-sm" style={{ color: "var(--t-muted)" }}>Nadie coincide con «{query}».</p>
          ) : (
            <ul className="mt-5 space-y-3">
              <AnimatePresence initial={false}>
                {visibleMembers.map((member) => {
                  const pointName = points.find((pt) => pt.id === member.point_id)?.name;
                  const open = editingUserId === member.user_id;
                  const shownPermissions = member.permissions.slice(0, 6);
                  return (
                    <motion.li
                      key={`${member.store_id}-${member.user_id}`}
                      layout
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.97 }}
                      className="rounded-3xl border p-4 transition"
                      style={{
                        borderColor: open ? "color-mix(in oklab, var(--t-accent) 55%, var(--t-card-border))" : "var(--t-card-border)",
                        background: "color-mix(in oklab, var(--t-bg-base) 45%, var(--t-card-bg))",
                      }}
                    >
                      <div className="flex items-start gap-3">
                        <Avatar name={member.display_name || member.username || "?"} dim={!member.active} />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="min-w-0 truncate text-base font-black">{member.display_name || member.username || "Usuario anterior"}</p>
                            <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold" style={member.active ? { background: "rgba(16,185,129,.14)", color: "#10b981" } : { background: "rgba(239,68,68,.14)", color: "#ef4444" }}>
                              <span className="h-1.5 w-1.5 rounded-full" style={{ background: member.active ? "#10b981" : "#ef4444" }} />
                              {member.active ? "Activo" : "Desactivado"}
                            </span>
                            {member.role === "store_admin" ? <span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: "color-mix(in oklab, var(--t-accent) 15%, transparent)", color: "var(--t-accent)" }}>Administrador</span> : null}
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs" style={{ color: "var(--t-muted)" }}>
                            <span className="inline-flex items-center gap-1 font-mono font-semibold" style={{ color: "var(--t-text)" }}><AtSign size={12} />{member.username ?? "acceso por correo"}</span>
                            <span className="inline-flex items-center gap-1"><MapPin size={12} />{pointName ?? "Todos los puntos"}</span>
                            <span className="hidden sm:inline">Desde {new Date(member.created_at).toLocaleDateString("es-CO", { day: "2-digit", month: "short", year: "numeric" })}</span>
                          </div>
                          {member.point_id && member.point_ids?.length ? (
                            <p className="mt-1 text-[11px]" style={{ color: "var(--t-muted)" }}>También consulta: <b>{member.point_ids.map((id) => points.find((pt) => pt.id === id)?.name ?? "Punto").join(", ")}</b></p>
                          ) : null}
                          <div className="mt-2 flex flex-wrap gap-1">
                            {shownPermissions.map((permission) => (
                              <span key={permission} className="rounded-full border px-2 py-0.5 text-[10px] font-semibold" style={{ borderColor: "var(--t-card-border)", color: "var(--t-muted)" }}>
                                {PERMISSION_OPTIONS.find((option) => option.value === permission)?.label ?? permission}
                              </span>
                            ))}
                            {member.permissions.length > shownPermissions.length ? (
                              <span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ color: "var(--t-accent)" }}>+{member.permissions.length - shownPermissions.length} más</span>
                            ) : null}
                            {member.permissions.length === 0 ? <span className="text-[11px]" style={{ color: "var(--t-muted)" }}>Sin permisos</span> : null}
                          </div>
                        </div>
                      </div>

                      <div className="mt-3 grid grid-cols-2 gap-1.5 border-t pt-3 min-[480px]:grid-cols-3 lg:flex lg:flex-wrap" style={{ borderColor: "var(--t-card-border)" }}>
                        <ActionButton icon={<Pencil size={14} />} label="Editar" onClick={() => { setEditFocusPassword(false); setEditMember(member); }} disabled={saving} primary />
                        <ActionButton
                          icon={<ShieldCheck size={14} />}
                          label={open ? "Cerrar permisos" : "Permisos"}
                          active={open}
                          onClick={() => {
                            setEditingUserId(open ? null : member.user_id);
                            setEditingPermissions(member.permissions ?? []);
                            setEditingPointId(member.point_id ?? "");
                            setEditingExtraPoints(member.point_ids ?? []);
                          }}
                        />
                        <ActionButton icon={<KeyRound size={14} />} label="Clave" onClick={() => { setEditFocusPassword(true); setEditMember(member); }} disabled={saving} />
                        <ActionButton icon={<Link2 size={14} />} label="Enlace" onClick={() => void copyLoginLink(member)} />
                        <ActionButton icon={<Power size={14} />} label={member.active ? "Desactivar" : "Reactivar"} tone={member.active ? "warn" : "good"} onClick={() => void toggleMember(member)} disabled={saving} />
                        <ActionButton icon={<Trash2 size={14} />} label="Eliminar" tone="bad" onClick={() => void deleteMember(member)} disabled={saving} />
                      </div>

                      <AnimatePresence initial={false}>
                        {open ? (
                          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                            <div className="mt-4 space-y-4 border-t pt-4" style={{ borderColor: "var(--t-card-border)" }}>
                              <label className="block">
                                <span className="text-xs font-bold">Punto asignado</span>
                                <select {...inputProps()} className={`${inputProps().className} mt-1.5`} value={editingPointId} onChange={(e) => setEditingPointId(e.target.value)}>
                                  <option value="">Todos los puntos (sin restricción)</option>
                                  {points.map((pt) => (
                                    <option key={pt.id} value={pt.id}>{pt.kind === "point" ? "📍" : "🏬"} {pt.name}</option>
                                  ))}
                                </select>
                              </label>
                              {editingPointId ? (
                                <div>
                                  <p className="text-xs font-bold">También puede consultar</p>
                                  <p className="mb-2 text-[11px]" style={{ color: "var(--t-muted)" }}>Opera solo en su punto principal; en estos puede ver documentos e informes según sus permisos.</p>
                                  <div className="flex flex-wrap gap-1.5">
                                    {points.filter((pt) => pt.id !== editingPointId).map((pt) => {
                                      const on = editingExtraPoints.includes(pt.id);
                                      return (
                                        <button key={pt.id} type="button" onClick={() => setEditingExtraPoints(on ? editingExtraPoints.filter((x) => x !== pt.id) : [...editingExtraPoints, pt.id])} className="rounded-full border px-3 py-1.5 text-xs font-semibold transition" style={on ? { background: "var(--t-accent)", color: "#fff", borderColor: "transparent" } : { borderColor: "var(--t-card-border)" }}>
                                          {pt.kind === "point" ? "📍" : "🏬"} {pt.name}
                                        </button>
                                      );
                                    })}
                                  </div>
                                </div>
                              ) : null}
                              <div>
                                <p className="mb-2 text-xs font-bold">Permisos del usuario</p>
                                <PermissionPicker value={editingPermissions} onChange={setEditingPermissions} disabled={saving} storeId={store?.id} />
                              </div>
                              <div className="flex flex-col gap-2 sm:flex-row">
                                <button type="button" onClick={() => setEditingUserId(null)} className="rounded-2xl border px-4 py-2.5 text-sm font-bold" style={{ borderColor: "var(--t-card-border)" }}>
                                  Cancelar
                                </button>
                                <button
                                  type="button"
                                  disabled={saving}
                                  onClick={() => updateMember(member, { permissions: editingPermissions, point_id: editingPointId || null, point_ids: editingPointId ? editingExtraPoints.filter((id) => id !== editingPointId) : [] })}
                                  className="inline-flex flex-1 items-center justify-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-bold text-white transition hover:-translate-y-0.5 disabled:opacity-60 sm:flex-none"
                                  style={{ background: "linear-gradient(135deg, var(--t-accent), var(--t-accent2, var(--t-accent)))" }}
                                >
                                  {saving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
                                  {saving ? "Guardando…" : "Guardar permisos"}
                                </button>
                              </div>
                            </div>
                          </motion.div>
                        ) : null}
                      </AnimatePresence>
                    </motion.li>
                  );
                })}
              </AnimatePresence>
            </ul>
          )}
        </section>
      </div>

      <EditMemberDialog member={editMember} focusPassword={editFocusPassword} onClose={() => setEditMember(null)} onSave={saveProfile} />
    </main>
  );
}

function ActionButton({ icon, label, onClick, disabled, primary, active, tone }: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
  active?: boolean;
  tone?: "warn" | "good" | "bad";
}) {
  const color = tone === "bad" ? "#ef4444" : tone === "warn" ? "#f59e0b" : tone === "good" ? "#10b981" : undefined;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-xl border px-3 py-2 text-xs font-bold transition hover:-translate-y-0.5 disabled:pointer-events-none disabled:opacity-50"
      style={
        primary
          ? { background: "linear-gradient(135deg, var(--t-accent), var(--t-accent2, var(--t-accent)))", color: "#fff", borderColor: "transparent" }
          : active
            ? { background: "color-mix(in oklab, var(--t-accent) 14%, transparent)", color: "var(--t-accent)", borderColor: "color-mix(in oklab, var(--t-accent) 45%, transparent)" }
            : color
              ? { color, borderColor: `color-mix(in oklab, ${color} 35%, transparent)`, background: `color-mix(in oklab, ${color} 7%, transparent)` }
              : { borderColor: "var(--t-card-border)", color: "var(--t-text)" }
      }
    >
      {icon}
      {label}
    </button>
  );
}
