"use client";

import { useEffect, useMemo, useState } from "react";
import Swal from "sweetalert2";
import { AnimatePresence, motion } from "framer-motion";
import {
  AtSign, Copy, Crown, Eye, KeyRound, LayoutGrid, Link2, MapPin, MessageCircle, MoreHorizontal, Pencil, Power, Search, ShieldCheck, Table2, Trash2, UserPlus, Users,
} from "lucide-react";
import { AuditSpyButton } from "@/components/audit/AuditSpyButton";
import { supabaseBrowser } from "@/lib/supabase/client";
import { getDashboardStore, hasStorePermission, type DashboardAccess, type DashboardStore } from "@/lib/store-utils";
import { PERMISSION_GROUPS, PERMISSION_LIST, cleanPermissions, expandLegacyPermissions } from "@/lib/permissions";
import { type AccessOverview } from "./AccessLimits";
import { UserEditor, type EmployeeRow, type MemberRow, type PointRow } from "./UserEditor";
import { Avatar, RiskMeter, riskLevel, swalTheme } from "./ui";
import { scheduleText, startSimulation } from "../../AccessGuard";

type EditorState = { mode: "create" | "edit"; member: MemberRow | null; step?: "person" | "access" | "permissions" | "limits" | "summary"; area?: string } | null;
type Sort = "name" | "recent" | "risk";

async function authHeader() {
  const { data } = await supabaseBrowser().auth.getSession();
  return { "Content-Type": "application/json", Authorization: `Bearer ${data.session?.access_token ?? ""}` };
}

export default function StoreUsersPage() {
  const [access, setAccessInfo] = useState<DashboardAccess | null>(null);
  const [store, setStore] = useState<DashboardStore | null>(null);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [points, setPoints] = useState<PointRow[]>([]);
  const [employees, setEmployees] = useState<EmployeeRow[] | null>(null);
  const [limits, setLimits] = useState<AccessOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [editor, setEditor] = useState<EditorState>(null);
  const [view, setView] = useState<"team" | "map">("team");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | "active" | "inactive">("all");
  const [pointFilter, setPointFilter] = useState("any");
  const [permFilter, setPermFilter] = useState("");
  const [sort, setSort] = useState<Sort>("name");

  async function loadLimits(storeId: string) {
    const { data, error } = await supabaseBrowser().rpc("erp_access_overview", { p_store: storeId });
    setLimits(error ? null : (data as AccessOverview));
  }

  async function loadMembers(storeId: string) {
    const res = await fetch(`/api/store-team/users?store_id=${encodeURIComponent(storeId)}`, { headers: await authHeader() });
    const out = await res.json();
    if (!res.ok) throw new Error(out.error ?? "No se pudieron cargar los usuarios.");
    // Se muestran los permisos efectivos: lo guardado antes del desglose hereda los permisos nuevos.
    const list = ((out.users ?? []) as MemberRow[]).map((m) => ({ ...m, permissions: cleanPermissions(expandLegacyPermissions(m.permissions)) }));
    setMembers(list);
    return list;
  }

  useEffect(() => {
    void (async () => {
      setLoading(true);
      try {
        const a = await getDashboardStore();
        if (!a.store) throw new Error("No tienes acceso a ninguna tienda.");
        if (!hasStorePermission(a, "users")) throw new Error("El administrador de la tienda no te dio permiso para gestionar usuarios.");
        setAccessInfo(a);
        setStore(a.store);
        await loadMembers(a.store.id);
        void loadLimits(a.store.id);
        void supabaseBrowser().rpc("erp_employees_for_users", { p_store: a.store.id }).then(({ data, error }) => setEmployees(error ? null : (data as EmployeeRow[])));
        const { data: pointData } = await supabaseBrowser().from("erp_warehouses").select("id,name,kind").eq("store_id", a.store.id).eq("active", true).order("name");
        setPoints((pointData ?? []) as PointRow[]);
      } catch (err) {
        await Swal.fire({ ...swalTheme, icon: "error", title: "No se pudieron cargar los usuarios", text: err instanceof Error ? err.message : String(err) });
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const isOwner = !!access && (access.isOwner || access.profileRole === "admin");
  const fullManager = isOwner || access?.membership?.role === "store_admin";
  const grantable = useMemo(() => (fullManager || !access ? null : new Set(expandLegacyPermissions(access.membership?.permissions))), [fullManager, access]);
  const canPasswords = !!access && hasStorePermission(access, "users_passwords");
  const canDelete = !!access && hasStorePermission(access, "users_delete");
  const effective = (m: MemberRow) => (m.role === "store_admin" ? PERMISSION_LIST.map((p) => p.value) : m.permissions);

  const loginLink = useMemo(() => {
    if (!store || typeof window === "undefined") return "";
    const url = new URL(`/acceso/${encodeURIComponent(store.slug)}`, window.location.origin);
    url.searchParams.set("sid", store.id);
    return url.toString();
  }, [store]);

  const stats = useMemo(() => {
    const active = members.filter((m) => m.active).length;
    return {
      total: members.length,
      active,
      inactive: members.length - active,
      admins: members.filter((m) => m.role === "store_admin").length,
      critical: members.filter((m) => m.role !== "store_admin" && PERMISSION_LIST.some((p) => p.risk === "critical" && m.permissions.includes(p.value))).length,
    };
  }, [members]);

  const visible = useMemo(() => {
    const term = query.trim().toLowerCase();
    const list = members.filter((m) => {
      if (status === "active" && !m.active) return false;
      if (status === "inactive" && m.active) return false;
      if (pointFilter !== "any" && (m.point_id ?? "") !== pointFilter) return false;
      if (permFilter && !effective(m).includes(permFilter)) return false;
      if (!term) return true;
      const pointName = points.find((pt) => pt.id === m.point_id)?.name ?? "";
      return `${m.display_name ?? ""} ${m.username ?? ""} ${pointName}`.toLowerCase().includes(term);
    });
    const name = (m: MemberRow) => (m.display_name || m.username || "").toLowerCase();
    return list.sort((a, b) =>
      sort === "recent" ? b.created_at.localeCompare(a.created_at)
        : sort === "risk" ? riskLevel(effective(b), b.role === "store_admin").score - riskLevel(effective(a), a.role === "store_admin").score
          : name(a).localeCompare(name(b)));
  }, [members, query, status, pointFilter, permFilter, sort, points]);

  async function patch(member: MemberRow, body: Record<string, unknown>, okText: string) {
    if (!store) return;
    setBusy(true);
    try {
      const res = await fetch("/api/store-team/users", { method: "PATCH", headers: await authHeader(), body: JSON.stringify({ store_id: store.id, user_id: member.user_id, ...body }) });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error ?? "No se pudo guardar.");
      await loadMembers(store.id);
      void Swal.fire({ ...swalTheme, toast: true, position: "top", icon: "success", title: okText, timer: 1600, showConfirmButton: false });
    } catch (err) {
      await Swal.fire({ ...swalTheme, icon: "error", title: "No se pudo guardar", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(member: MemberRow) {
    const who = member.display_name || member.username || "este usuario";
    const res = await Swal.fire({
      ...swalTheme, icon: "warning", title: member.active ? `Desactivar a ${who}` : `Reactivar a ${who}`,
      text: member.active ? "Deja de entrar al panel. Sus permisos se conservan para cuando lo reactives." : "Podrá volver a entrar con su usuario y contraseña.",
      showCancelButton: true, confirmButtonText: member.active ? "Desactivar" : "Reactivar", cancelButtonText: "Cancelar", confirmButtonColor: member.active ? "#ef4444" : "#22c55e",
    });
    if (res.isConfirmed) await patch(member, { active: !member.active }, member.active ? "Usuario desactivado" : "Usuario reactivado");
  }

  async function remove(member: MemberRow) {
    if (!store) return;
    const who = member.display_name || member.username || "este usuario";
    const res = await Swal.fire({
      ...swalTheme, icon: "warning", title: `Eliminar a ${who}`,
      html: "Perderá el acceso de forma <b>permanente</b> y su usuario quedará libre.<br/><small>Las ventas, abonos y movimientos que hizo se conservan en el historial.</small>",
      input: "text", inputPlaceholder: "Escribe ELIMINAR para confirmar", showCancelButton: true, confirmButtonText: "Eliminar usuario", cancelButtonText: "Cancelar", confirmButtonColor: "#ef4444",
      inputValidator: (v) => (v.trim().toUpperCase() === "ELIMINAR" ? null : "Escribe ELIMINAR para confirmar."),
    });
    if (!res.isConfirmed) return;
    setBusy(true);
    try {
      const r = await fetch("/api/store-team/users", { method: "DELETE", headers: await authHeader(), body: JSON.stringify({ store_id: store.id, user_id: member.user_id }) });
      const out = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(out.error ?? "No se pudo eliminar el usuario.");
      setMembers((cur) => cur.filter((m) => m.user_id !== member.user_id));
      await Swal.fire({ ...swalTheme, icon: out.warning ? "info" : "success", title: "Usuario eliminado", text: out.warning ?? `${who} ya no tiene acceso a la tienda.`, timer: out.warning ? undefined : 1500, showConfirmButton: Boolean(out.warning) });
    } catch (err) {
      await Swal.fire({ ...swalTheme, icon: "error", title: "No se pudo eliminar", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  async function copy(text: string, title: string) {
    try {
      await navigator.clipboard.writeText(text);
      void Swal.fire({ ...swalTheme, toast: true, position: "top", icon: "success", title, timer: 1400, showConfirmButton: false });
    } catch {
      window.prompt("Copia el enlace:", text);
    }
  }
  function memberLink(member: MemberRow) {
    if (!store || !member.username) return "";
    const url = new URL(`/acceso/${encodeURIComponent(store.slug)}`, window.location.origin);
    url.searchParams.set("sid", store.id);
    url.searchParams.set("usuario", member.username);
    return url.toString();
  }

  const card = { borderColor: "var(--t-card-border)", background: "var(--t-card-bg)", color: "var(--t-text)" };

  return (
    <main className="space-y-5">
      {/* Encabezado */}
      <section className="relative overflow-hidden rounded-[28px] border p-5 sm:p-7" style={card}>
        <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full blur-3xl" style={{ background: "color-mix(in oklab, var(--t-accent) 18%, transparent)" }} />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-[0.2em]" style={{ color: "var(--t-accent)" }}>{store?.name ?? "Tu tienda"} · equipo</p>
            <h1 className="mt-1 flex items-center gap-2 text-2xl font-black sm:text-3xl"><Users size={26} /> Usuarios y permisos</h1>
            <p className="mt-1 max-w-2xl text-sm" style={{ color: "var(--t-muted)" }}>{PERMISSION_LIST.length} permisos en {PERMISSION_GROUPS.length} áreas. Decide qué ve y qué hace cada persona, en qué punto y a qué horas.</p>
          </div>
          <button type="button" onClick={() => setEditor({ mode: "create", member: null })} disabled={!store} className="inline-flex items-center gap-2 rounded-2xl px-5 py-3 text-sm font-black text-white shadow-lg transition hover:-translate-y-0.5 disabled:opacity-50" style={{ background: "linear-gradient(135deg, var(--t-accent), var(--t-accent2, var(--t-accent)))" }}>
            <UserPlus size={18} /> Nuevo usuario
          </button>
        </div>
        <div className="relative mt-5 grid grid-cols-2 gap-2 sm:grid-cols-5">
          {([["Usuarios", stats.total, "var(--t-text)", "all"], ["Activos", stats.active, "#10b981", "active"], ["Desactivados", stats.inactive, "#ef4444", "inactive"], ["Administradores", stats.admins, "var(--t-accent)", null], ["Con permisos críticos", stats.critical, "#f59e0b", null]] as Array<[string, number, string, "all" | "active" | "inactive" | null]>).map(([label, value, color, f]) => (
            <button key={label} type="button" disabled={!f} onClick={() => f && setStatus(f)} className="rounded-2xl border px-3 py-2.5 text-left transition enabled:hover:-translate-y-0.5" style={{ borderColor: f && status === f ? "var(--t-accent)" : "var(--t-card-border)", background: "color-mix(in oklab, var(--t-bg-base) 55%, transparent)" }}>
              <p className="text-2xl font-black tabular-nums" style={{ color }}>{loading ? "…" : value}</p>
              <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: "var(--t-muted)" }}>{label}</p>
            </button>
          ))}
        </div>
        {loginLink ? (
          <div className="relative mt-4 flex flex-col gap-3 rounded-2xl border p-3.5 sm:flex-row sm:items-center sm:justify-between" style={{ borderColor: "color-mix(in oklab, var(--t-accent) 40%, var(--t-card-border))", background: "color-mix(in oklab, var(--t-accent) 8%, transparent)" }}>
            <div className="flex min-w-0 items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl text-white" style={{ background: "var(--t-accent)" }}><Link2 size={18} /></span>
              <div className="min-w-0">
                <p className="text-sm font-bold">Enlace de acceso para todo el equipo</p>
                <p className="text-xs" style={{ color: "var(--t-muted)" }}>Cada persona entra con su usuario y contraseña. Guárdalo en los equipos de cada punto.</p>
                <p className="mt-0.5 truncate font-mono text-[11px]" style={{ color: "var(--t-muted)" }}>{loginLink}</p>
              </div>
            </div>
            <div className="grid shrink-0 grid-cols-2 gap-2 sm:flex">
              <button type="button" onClick={() => void copy(loginLink, "Enlace copiado")} className="inline-flex items-center justify-center gap-1.5 rounded-full px-4 py-2 text-sm font-bold text-white" style={{ background: "var(--t-accent)" }}><Copy size={15} /> Copiar</button>
              <a href={`https://wa.me/?text=${encodeURIComponent(`Acceso al sistema de ${store?.name ?? "la tienda"}. Entra con tu usuario y contraseña:\n${loginLink}`)}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center justify-center gap-1.5 rounded-full border px-4 py-2 text-sm font-bold" style={{ borderColor: "var(--t-card-border)" }}><MessageCircle size={15} /> WhatsApp</a>
            </div>
          </div>
        ) : null}
      </section>

      {/* Herramientas */}
      <section className="rounded-[28px] border p-4 sm:p-5" style={card}>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-full border p-0.5" style={{ borderColor: "var(--t-card-border)" }}>
            {([["team", "Equipo", <LayoutGrid key="g" size={14} />], ["map", "Mapa de permisos", <Table2 key="t" size={14} />]] as const).map(([k, l, icon]) => (
              <button key={k} type="button" onClick={() => setView(k)} className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold transition" style={view === k ? { background: "var(--t-accent)", color: "#fff" } : { color: "var(--t-muted)" }}>{icon}{l}</button>
            ))}
          </div>
          <span className="relative min-w-[180px] flex-1">
            <Search size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 opacity-55" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar persona, usuario o punto…" className="w-full rounded-full border py-2 pl-9 pr-3 text-base outline-none sm:text-sm" style={{ borderColor: "var(--t-card-border)", background: "color-mix(in oklab, var(--t-bg-base) 55%, transparent)", color: "var(--t-text)" }} />
          </span>
          <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className="rounded-full border px-3 py-2 text-xs font-bold" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)", color: "var(--t-text)" }} aria-label="Estado">
            <option value="all">Todos</option><option value="active">Activos</option><option value="inactive">Desactivados</option>
          </select>
          <select value={pointFilter} onChange={(e) => setPointFilter(e.target.value)} className="rounded-full border px-3 py-2 text-xs font-bold" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)", color: "var(--t-text)" }} aria-label="Punto">
            <option value="any">Cualquier punto</option><option value="">🌐 Todos los puntos (madre)</option>
            {points.map((p) => <option key={p.id} value={p.id}>{p.kind === "point" ? "📍" : "🏬"} {p.name}</option>)}
          </select>
          <select value={permFilter} onChange={(e) => setPermFilter(e.target.value)} className="max-w-[200px] rounded-full border px-3 py-2 text-xs font-bold" style={{ borderColor: permFilter ? "var(--t-accent)" : "var(--t-card-border)", background: "var(--t-card-bg)", color: "var(--t-text)" }} aria-label="Con el permiso">
            <option value="">Con cualquier permiso</option>
            {PERMISSION_GROUPS.map((g) => <optgroup key={g.key} label={`${g.icon} ${g.title}`}>{g.items.map((i) => <option key={i.value} value={i.value}>{i.label}</option>)}</optgroup>)}
          </select>
          <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="rounded-full border px-3 py-2 text-xs font-bold" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)", color: "var(--t-text)" }} aria-label="Ordenar">
            <option value="name">A → Z</option><option value="recent">Más recientes</option><option value="risk">Más acceso primero</option>
          </select>
        </div>

        {loading ? (
          <div className="mt-5 grid gap-3 lg:grid-cols-2">{[0, 1, 2, 3].map((i) => <div key={i} className="h-44 animate-pulse rounded-3xl" style={{ background: "color-mix(in oklab, var(--t-text) 6%, transparent)" }} />)}</div>
        ) : members.length === 0 ? (
          <div className="grid place-items-center gap-2 py-14 text-center">
            <span className="grid h-14 w-14 place-items-center rounded-3xl" style={{ background: "color-mix(in oklab, var(--t-accent) 14%, transparent)", color: "var(--t-accent)" }}><Users size={26} /></span>
            <p className="font-bold">Aún no hay usuarios</p>
            <p className="max-w-xs text-xs" style={{ color: "var(--t-muted)" }}>Crea el primero con «Nuevo usuario». Cada persona entra con su propio usuario.</p>
          </div>
        ) : visible.length === 0 ? (
          <p className="py-10 text-center text-sm" style={{ color: "var(--t-muted)" }}>Nadie coincide con los filtros.</p>
        ) : view === "team" ? (
          <ul className="mt-5 grid gap-3 lg:grid-cols-2">
            <AnimatePresence initial={false}>
              {visible.map((m) => (
                <MemberCard key={m.user_id} m={m} pointName={points.find((pt) => pt.id === m.point_id)?.name ?? null} extraNames={(m.point_ids ?? []).map((id) => points.find((pt) => pt.id === id)?.name ?? "Punto")}
                  limits={limits} busy={busy} canPasswords={canPasswords} canDelete={canDelete} canManageAdmin={isOwner} perms={effective(m)}
                  onEdit={(step, area) => setEditor({ mode: "edit", member: m, step, area })}
                  onSimulate={() => store && startSimulation({ storeId: store.id, userId: m.user_id, name: m.display_name || m.username || "usuario", permissions: effective(m), pointName: m.role === "store_admin" ? null : points.find((pt) => pt.id === m.point_id)?.name ?? null })}
                  onLink={() => { const l = memberLink(m); if (l) void copy(l, "Enlace del usuario copiado"); }}
                  onToggle={() => void toggleActive(m)} onDelete={() => void remove(m)} />
              ))}
            </AnimatePresence>
          </ul>
        ) : (
          <PermissionMap members={visible} effective={effective} onOpen={(m, area) => setEditor({ mode: "edit", member: m, step: "permissions", area })} />
        )}
      </section>

      {store ? (
        <UserEditor
          open={!!editor}
          mode={editor?.mode ?? "create"}
          member={editor?.member ?? null}
          startStep={editor?.step}
          startArea={editor?.area}
          store={{ id: store.id, slug: store.slug, name: store.name }}
          points={points}
          employees={employees}
          members={members}
          isOwner={isOwner}
          canPasswords={canPasswords}
          grantable={grantable}
          access={limits}
          onAccessChanged={() => { void loadLimits(store.id); }}
          onClose={() => setEditor(null)}
          onSaved={async () => { await loadMembers(store.id); }}
        />
      ) : null}
    </main>
  );
}

function MemberCard({ m, pointName, extraNames, limits, busy, canPasswords, canDelete, canManageAdmin, perms, onEdit, onSimulate, onLink, onToggle, onDelete }: {
  m: MemberRow; pointName: string | null; extraNames: string[]; limits: AccessOverview | null; busy: boolean; canPasswords: boolean; canDelete: boolean; canManageAdmin: boolean; perms: string[];
  onEdit: (step?: "person" | "access" | "permissions" | "limits" | "summary", area?: string) => void; onSimulate: () => void; onLink: () => void; onToggle: () => void; onDelete: () => void;
}) {
  const [more, setMore] = useState(false);
  const admin = m.role === "store_admin";
  const locked = admin && !canManageAdmin;
  const temps = (limits?.grants ?? []).filter((g) => g.user_id === m.user_id);
  const sch = (limits?.schedules ?? []).find((x) => x.user_id === m.user_id && x.active);
  const areas = PERMISSION_GROUPS.map((g) => ({ g, n: g.items.filter((i) => perms.includes(i.value)).length })).filter((x) => x.n > 0);
  return (
    <motion.li layout initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97 }}
      className="relative flex flex-col rounded-3xl border p-4" style={{ borderColor: "var(--t-card-border)", background: "color-mix(in oklab, var(--t-bg-base) 45%, var(--t-card-bg))", opacity: m.active ? 1 : 0.75 }}>
      <div className="flex items-start gap-3">
        <Avatar name={m.display_name || m.username || "?"} size={48} dim={!m.active} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="min-w-0 truncate text-base font-black">{m.display_name || m.username || "Usuario anterior"}</p>
            <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold" style={m.active ? { background: "rgba(16,185,129,.14)", color: "#10b981" } : { background: "rgba(239,68,68,.14)", color: "#ef4444" }}>
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: m.active ? "#10b981" : "#ef4444" }} />{m.active ? "Activo" : "Desactivado"}
            </span>
            {admin ? <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: "color-mix(in oklab, var(--t-accent) 15%, transparent)", color: "var(--t-accent)" }}><Crown size={10} /> Administrador</span> : null}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs" style={{ color: "var(--t-muted)" }}>
            <span className="inline-flex items-center gap-1 font-mono font-semibold" style={{ color: "var(--t-text)" }}><AtSign size={12} />{m.username ?? "acceso por correo"}</span>
            <span className="inline-flex items-center gap-1"><MapPin size={12} />{admin ? "Todos los puntos" : pointName ?? "Todos los puntos"}</span>
          </div>
          {extraNames.length && !admin ? <p className="mt-0.5 text-[11px]" style={{ color: "var(--t-muted)" }}>También consulta: <b>{extraNames.join(", ")}</b></p> : null}
        </div>
      </div>

      <div className="mt-3"><RiskMeter perms={perms} admin={admin} /></div>

      <div className="mt-3 flex flex-wrap gap-1">
        {admin ? <span className="text-[11px]" style={{ color: "var(--t-muted)" }}>Todos los permisos de todas las áreas.</span>
          : areas.length ? areas.map(({ g, n }) => (
            <button key={g.key} type="button" disabled={locked} onClick={() => onEdit("permissions", g.key)} title={`${g.title}: ${n} de ${g.items.length}`} className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold transition hover:-translate-y-0.5" style={{ borderColor: "var(--t-card-border)" }}>
              {g.icon} <span className="tabular-nums" style={{ color: "var(--t-muted)" }}>{n}/{g.items.length}</span>
            </button>
          )) : <span className="text-[11px]" style={{ color: "var(--t-muted)" }}>Sin permisos</span>}
      </div>

      {temps.length || sch ? (
        <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
          {temps.length ? <span className="rounded-full px-2 py-0.5 font-bold" style={{ background: "color-mix(in oklab, #f59e0b 16%, transparent)" }}>⏳ {temps.length} temporal{temps.length === 1 ? "" : "es"}{temps.some((t) => t.expired) ? " (vencido)" : ""}</span> : null}
          {sch ? <span className="rounded-full px-2 py-0.5 font-bold" style={{ background: "color-mix(in oklab, var(--t-accent) 14%, transparent)" }}>🕒 {scheduleText(sch)}</span> : null}
        </div>
      ) : null}

      <div className="mt-auto flex items-center gap-1.5 border-t pt-3" style={{ borderColor: "var(--t-card-border)", marginTop: 12 }}>
        <button type="button" disabled={busy || locked} onClick={() => onEdit()} className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold text-white transition hover:-translate-y-0.5 disabled:opacity-50" style={{ background: "linear-gradient(135deg, var(--t-accent), var(--t-accent2, var(--t-accent)))" }}>
          <Pencil size={14} /> Editar
        </button>
        <IconBtn label="Permisos" onClick={() => onEdit("permissions")} disabled={locked}><ShieldCheck size={15} /></IconBtn>
        <IconBtn label="Ver como esta persona" onClick={onSimulate}><Eye size={15} /></IconBtn>
        <IconBtn label="Copiar su enlace" onClick={onLink}><Link2 size={15} /></IconBtn>
        <div className="relative">
          <IconBtn label="Más" onClick={() => setMore((v) => !v)}><MoreHorizontal size={15} /></IconBtn>
          <AnimatePresence>
            {more ? (
              <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} onMouseLeave={() => setMore(false)}
                className="absolute bottom-11 right-0 z-20 grid w-56 gap-0.5 rounded-2xl border p-1.5 shadow-2xl" style={{ borderColor: "var(--t-popover-border, var(--t-card-border))", background: "var(--t-popover, var(--t-bg-base))" }}>
                {canPasswords && !locked ? <MenuItem icon={<KeyRound size={14} />} label="Cambiar contraseña" onClick={() => { setMore(false); onEdit("person"); }} /> : null}
                {!locked ? <MenuItem icon={<KeyRound size={14} />} label="Horario y temporales" onClick={() => { setMore(false); onEdit("limits"); }} /> : null}
                {!locked ? <MenuItem icon={<Power size={14} />} label={m.active ? "Desactivar" : "Reactivar"} tone={m.active ? "#f59e0b" : "#10b981"} onClick={() => { setMore(false); onToggle(); }} /> : null}
                {canDelete && !locked ? <MenuItem icon={<Trash2 size={14} />} label="Eliminar" tone="#ef4444" onClick={() => { setMore(false); onDelete(); }} /> : null}
                <div className="px-1 pt-1"><AuditSpyButton storeId={m.store_id} filters={{ entity_id: m.user_id }} title={`Historial de ${m.display_name || m.username || "este usuario"}`} size="sm" /></div>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      </div>
    </motion.li>
  );
}

function IconBtn({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={label} aria-label={label} className="grid h-9 w-9 place-items-center rounded-xl border transition hover:-translate-y-0.5 disabled:opacity-40" style={{ borderColor: "var(--t-card-border)" }}>
      {children}
    </button>
  );
}

function MenuItem({ icon, label, onClick, tone }: { icon: React.ReactNode; label: string; onClick: () => void; tone?: string }) {
  return (
    <button type="button" onClick={onClick} className="flex items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-semibold transition hover:bg-[color:var(--t-card-bg-soft)]" style={{ color: tone ?? "var(--t-text)" }}>
      {icon}{label}
    </button>
  );
}

/** Tabla de todo el equipo por área: de un vistazo, quién tiene qué. Tocar una celda abre esa área. */
function PermissionMap({ members, effective, onOpen }: { members: MemberRow[]; effective: (m: MemberRow) => string[]; onOpen: (m: MemberRow, area: string) => void }) {
  return (
    <div className="mt-5 overflow-x-auto rounded-2xl border" style={{ borderColor: "var(--t-card-border)" }}>
      <table className="w-full min-w-[900px] border-collapse text-xs">
        <thead>
          <tr style={{ background: "var(--t-card-bg-soft)" }}>
            <th className="sticky left-0 z-10 px-3 py-2 text-left font-black" style={{ background: "var(--t-card-bg)" }}>Persona</th>
            {PERMISSION_GROUPS.map((g) => <th key={g.key} className="px-1.5 py-2 text-center font-bold" title={g.title}><span className="block text-base">{g.icon}</span><span className="block max-w-[70px] truncate text-[10px]" style={{ color: "var(--t-muted)" }}>{g.title}</span></th>)}
          </tr>
        </thead>
        <tbody>
          {members.map((m) => {
            const perms = effective(m);
            const admin = m.role === "store_admin";
            return (
              <tr key={m.user_id} className="border-t" style={{ borderColor: "var(--t-card-border)", opacity: m.active ? 1 : 0.6 }}>
                <td className="sticky left-0 z-10 px-3 py-2" style={{ background: "var(--t-card-bg)" }}>
                  <div className="flex items-center gap-2"><Avatar name={m.display_name || m.username || "?"} size={28} dim={!m.active} /><span className="max-w-[140px] truncate font-bold">{m.display_name || m.username}</span>{admin ? <Crown size={12} style={{ color: "var(--t-accent)" }} /> : null}</div>
                </td>
                {PERMISSION_GROUPS.map((g) => {
                  const n = g.items.filter((i) => perms.includes(i.value)).length;
                  const f = n / g.items.length;
                  return (
                    <td key={g.key} className="px-1 py-1.5 text-center">
                      <button type="button" disabled={admin} onClick={() => onOpen(m, g.key)} title={`${g.title}: ${g.items.filter((i) => perms.includes(i.value)).map((i) => i.label).join(", ") || "nada"}`}
                        className="mx-auto grid h-8 w-12 place-items-center rounded-lg font-black tabular-nums transition enabled:hover:scale-105"
                        style={{ background: n ? `color-mix(in oklab, var(--t-accent) ${Math.round(15 + f * 60)}%, transparent)` : "color-mix(in oklab, var(--t-text) 5%, transparent)", color: n ? (f > 0.6 ? "#fff" : "var(--t-text)") : "var(--t-muted)" }}>
                        {n ? `${n}/${g.items.length}` : "·"}
                      </button>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
