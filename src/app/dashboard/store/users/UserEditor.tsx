"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft, ArrowRight, AtSign, Check, Copy, Crown, Eye, EyeOff, KeyRound, Loader2, MapPin, MessageCircle, ShieldCheck, Sparkles, UserRound, Users, X,
} from "lucide-react";
import { PasswordStrength } from "@/components/PasswordStrength";
import { supabaseBrowser } from "@/lib/supabase/client";
import { PERMISSION_GROUPS, PERMISSION_LIST, cleanPermissions, permissionInfo } from "@/lib/permissions";
import { PermissionMatrix } from "./PermissionMatrix";
import { AccessLimits, type AccessOverview } from "./AccessLimits";
import { Avatar, RiskMeter, fieldCls, fieldStyle } from "./ui";

export type MemberRow = {
  store_id: string;
  user_id: string;
  username: string | null;
  display_name: string | null;
  role: "store_admin" | "seller" | "accounting" | "viewer";
  /** Permisos efectivos (ya desglosados y sin la marca). */
  permissions: string[];
  point_id?: string | null;
  point_ids?: string[] | null;
  active: boolean;
  created_at: string;
};
export type PointRow = { id: string; name: string; kind: string };
export type EmployeeRow = { id: string; full_name: string; document: string | null; position: string | null; phone: string | null; point_id: string | null };

type Step = "person" | "access" | "permissions" | "limits" | "summary";
const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,31}$/;
const plain = (v: string) => v.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/ñ/g, "n").trim();

/** Usuario sugerido: el primer nombre; si ya existe, nombre.apellido; si no, con número. */
function suggestUsername(fullName: string, taken: Set<string>) {
  const words = plain(fullName).replace(/[^a-z0-9 ]/g, "").split(/\s+/).filter(Boolean);
  if (!words.length) return "";
  const first = words[0].slice(0, 24);
  const last = words.length > 2 ? words[2] : words[1];
  const options = [first, last ? `${first}.${last}` : "", last ? `${first}.${last[0]}` : ""].filter((x) => x.length >= 3 && !taken.has(x));
  if (options.length) return options[0];
  const base = first.length >= 3 ? first : `${first}${last ?? ""}`.padEnd(3, "0");
  for (let i = 2; i < 100; i++) if (!taken.has(`${base}${i}`)) return `${base}${i}`;
  return base;
}

async function authHeader() {
  const { data } = await supabaseBrowser().auth.getSession();
  return { "Content-Type": "application/json", Authorization: `Bearer ${data.session?.access_token ?? ""}` };
}

export type EditorProps = {
  mode: "create" | "edit";
  member?: MemberRow | null;
  startStep?: Step;
  startArea?: string;
  store: { id: string; slug: string; name: string };
  points: PointRow[];
  employees: EmployeeRow[] | null;
  members: MemberRow[];
  isOwner: boolean;
  canPasswords: boolean;
  /** Lo que quien edita puede dar (null = todo). */
  grantable: Set<string> | null;
  access: AccessOverview | null;
  onAccessChanged: () => void;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
};

export function UserEditor(props: EditorProps & { open: boolean }) {
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  if (!mounted) return null;
  return createPortal(
    <AnimatePresence>{props.open ? <Sheet key={props.member?.user_id ?? "new"} {...props} /> : null}</AnimatePresence>,
    document.body,
  );
}

function Sheet({ mode, member, startStep, startArea, store, points, employees, members, isOwner, canPasswords, grantable, access, onAccessChanged, onClose, onSaved }: EditorProps) {
  const editing = mode === "edit" && !!member;
  const [step, setStep] = useState<Step>(startStep ?? "person");
  const [name, setName] = useState(member?.display_name ?? "");
  const [user, setUser] = useState(member?.username ?? "");
  const [password, setPassword] = useState("");
  const [changePassword, setChangePassword] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [employeeId, setEmployeeId] = useState("");
  const [admin, setAdmin] = useState(member?.role === "store_admin");
  const [pointId, setPointId] = useState(member?.point_id ?? "");
  const [extraPoints, setExtraPoints] = useState<string[]>(member?.point_ids ?? []);
  const [perms, setPerms] = useState<string[]>(member?.permissions ?? ["pos", "messages"]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ username: string; link: string } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !saving) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = prev; window.removeEventListener("keydown", onKey); };
  }, [onClose, saving]);

  const cleanUser = user.replace(/\s+/g, "");
  const userOk = USERNAME_RE.test(cleanUser.toLowerCase());
  const taken = useMemo(() => new Set(members.filter((m) => m.user_id !== member?.user_id).map((m) => (m.username ?? "").toLowerCase())), [members, member]);
  const userTaken = taken.has(cleanUser.toLowerCase());
  const needPassword = !editing || changePassword;
  const passwordOk = !needPassword || password.length >= 4;
  const personOk = userOk && !userTaken && passwordOk;

  const steps: Array<{ key: Step; label: string; icon: React.ReactNode; ok: boolean }> = [
    { key: "person", label: "Persona", icon: <UserRound size={15} />, ok: personOk },
    { key: "access", label: "Acceso", icon: <MapPin size={15} />, ok: true },
    { key: "permissions", label: "Permisos", icon: <ShieldCheck size={15} />, ok: admin || perms.length > 0 },
    ...(editing ? [{ key: "limits" as Step, label: "Límites", icon: <KeyRound size={15} />, ok: true }] : []),
    { key: "summary", label: "Resumen", icon: <Sparkles size={15} />, ok: true },
  ];
  const idx = steps.findIndex((s) => s.key === step);

  const original = member?.permissions ?? [];
  const added = perms.filter((p) => !original.includes(p));
  const removed = original.filter((p) => !perms.includes(p));
  const nameChanged = editing && name.trim() !== (member!.display_name ?? "").trim();
  const userChanged = editing && cleanUser !== (member!.username ?? "");
  const pointChanged = editing && (pointId || null) !== (member!.point_id ?? null);
  const extraChanged = editing && JSON.stringify([...extraPoints].sort()) !== JSON.stringify([...(member!.point_ids ?? [])].sort());
  const roleChanged = editing && admin !== (member!.role === "store_admin");
  const permsChanged = editing && (added.length > 0 || removed.length > 0);
  const dirty = !editing || nameChanged || userChanged || pointChanged || extraChanged || roleChanged || permsChanged || (changePassword && password.length > 0);

  const employeeOptions = useMemo(() => {
    const names = new Set(members.map((m) => plain(m.display_name ?? "")).filter(Boolean));
    return (employees ?? []).map((e) => ({ ...e, hasUser: names.has(plain(e.full_name)) })).sort((a, b) => Number(a.hasUser) - Number(b.hasUser));
  }, [employees, members]);

  function pickEmployee(id: string) {
    setEmployeeId(id);
    const e = employees?.find((x) => x.id === id);
    if (!e) return;
    setName(e.full_name);
    setUser(suggestUsername(e.full_name, taken));
    setPointId(e.point_id && points.some((p) => p.id === e.point_id) ? e.point_id : "");
  }

  async function save() {
    setError(null);
    if (!personOk) { setStep("person"); return setError(userTaken ? "Ese usuario ya existe en la tienda." : !userOk ? "Revisa el usuario: de 3 a 32 caracteres (letras, números, punto, guion o guion bajo)." : "La contraseña debe tener al menos 4 caracteres."); }
    if (!admin && !perms.length) { setStep("permissions"); return setError("Dale al menos un permiso (o una plantilla)."); }
    setSaving(true);
    try {
      const headers = await authHeader();
      if (!editing) {
        const res = await fetch("/api/store-team/users", { method: "POST", headers, body: JSON.stringify({
          store_id: store.id, username: cleanUser, display_name: name.trim(), password, role: admin ? "store_admin" : "seller",
          permissions: admin ? [] : cleanPermissions(perms), point_id: admin ? null : pointId || null,
        }) });
        const out = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(out.error ?? "No se pudo crear el usuario.");
        setCreated({ username: String(out.user?.username ?? cleanUser), link: String(out.login_url ?? "") });
        await onSaved();
      } else {
        const body: Record<string, unknown> = { store_id: store.id, user_id: member!.user_id };
        if (nameChanged) body.display_name = name.trim();
        if (userChanged) body.username = cleanUser;
        if (changePassword && password) body.new_password = password;
        if (roleChanged) body.role = admin ? "store_admin" : "seller";
        if (!admin && (permsChanged || roleChanged)) body.permissions = cleanPermissions(perms);
        // Un administrador completo trabaja en todos los puntos: se le quita el punto asignado.
        if (admin && roleChanged) { body.point_id = null; body.point_ids = []; }
        else if (pointChanged || extraChanged) { body.point_id = pointId || null; body.point_ids = pointId ? extraPoints.filter((x) => x !== pointId) : []; }
        if (Object.keys(body).length <= 2) { onClose(); return; }
        const res = await fetch("/api/store-team/users", { method: "PATCH", headers, body: JSON.stringify(body) });
        const out = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(out.error ?? "No se pudo guardar.");
        await onSaved();
        onClose();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  const shownName = name.trim() || cleanUser || (editing ? "Usuario" : "Nuevo usuario");
  const copyFrom = members.filter((m) => m.user_id !== member?.user_id && m.permissions.length).map((m) => ({ label: m.display_name || m.username || "Usuario", permissions: m.permissions }));
  const effective = admin ? PERMISSION_LIST.map((p) => p.value) : perms;

  return (
    <motion.div className="fixed inset-0 z-[140] flex items-end justify-center sm:items-center sm:p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <button type="button" aria-label="Cerrar" className="absolute inset-0 cursor-default bg-black/60 backdrop-blur-[3px]" onClick={() => !saving && onClose()} />
      <motion.div
        role="dialog" aria-modal="true" aria-label={editing ? "Editar usuario" : "Nuevo usuario"}
        className="relative flex h-[96dvh] w-full flex-col overflow-hidden rounded-t-[28px] border shadow-[0_30px_90px_rgba(0,0,0,0.5)] sm:h-[92dvh] sm:max-w-6xl sm:rounded-[28px]"
        style={{ borderColor: "var(--t-card-border)", background: "var(--t-bg-base)", color: "var(--t-text)" }}
        initial={{ y: 60, opacity: 0, scale: 0.98 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ y: 60, opacity: 0, scale: 0.98 }}
        transition={{ type: "spring", stiffness: 360, damping: 34 }}
      >
        <div className="pointer-events-none absolute -right-24 -top-28 h-72 w-72 rounded-full blur-3xl" style={{ background: "color-mix(in oklab, var(--t-accent) 20%, transparent)" }} />

        {/* Encabezado */}
        <header className="relative flex items-center gap-3 border-b px-4 py-3 sm:px-6" style={{ borderColor: "var(--t-card-border)" }}>
          <Avatar name={shownName} size={44} />
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold uppercase tracking-[0.18em]" style={{ color: "var(--t-accent)" }}>{editing ? "Editar usuario" : "Nuevo usuario"}{admin ? " · Administrador" : ""}</p>
            <h2 className="truncate text-lg font-black">{shownName}{cleanUser ? <span className="ml-2 font-mono text-xs font-semibold" style={{ color: "var(--t-muted)" }}>@{cleanUser}</span> : null}</h2>
          </div>
          <div className="hidden w-48 md:block"><RiskMeter perms={effective} admin={admin} /></div>
          <button type="button" onClick={onClose} disabled={saving} className="grid h-10 w-10 shrink-0 place-items-center rounded-full border transition hover:rotate-90" style={{ borderColor: "var(--t-card-border)" }} aria-label="Cerrar"><X size={16} /></button>
        </header>

        {created ? (
          <CreatedScreen store={store} name={shownName} created={created} copied={copied} onCopy={async () => { try { await navigator.clipboard.writeText(created.link); setCopied(true); } catch { /* sin permiso */ } }} onClose={onClose} />
        ) : (
          <>
            {/* Pasos */}
            <nav className="relative flex gap-1 overflow-x-auto border-b px-3 py-2 sm:px-6" style={{ borderColor: "var(--t-card-border)" }}>
              {steps.map((s, i) => {
                const on = s.key === step;
                return (
                  <button key={s.key} type="button" onClick={() => setStep(s.key)} className="flex shrink-0 items-center gap-2 rounded-full px-3 py-1.5 text-xs font-bold transition"
                    style={on ? { background: "var(--t-accent)", color: "#fff" } : { color: "var(--t-muted)" }}>
                    <span className="grid h-5 w-5 place-items-center rounded-full text-[10px]" style={{ background: on ? "rgba(255,255,255,.25)" : s.ok ? "color-mix(in oklab, #10b981 22%, transparent)" : "color-mix(in oklab, var(--t-text) 12%, transparent)", color: on ? "#fff" : s.ok ? "#10b981" : "var(--t-muted)" }}>
                      {s.ok && !on ? <Check size={11} strokeWidth={3} /> : i + 1}
                    </span>
                    {s.icon}{s.label}
                  </button>
                );
              })}
            </nav>

            <div className="relative flex-1 overflow-y-auto px-4 py-4 sm:px-6">
              <AnimatePresence mode="wait">
                <motion.div key={step} initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} transition={{ duration: 0.18 }}>
                  {step === "person" ? (
                    <div className="mx-auto grid max-w-3xl gap-4 md:grid-cols-2">
                      {!editing && employeeOptions.length ? (
                        <label className="block rounded-2xl border p-3 md:col-span-2" style={{ borderColor: "color-mix(in oklab, var(--t-accent) 40%, transparent)", background: "color-mix(in oklab, var(--t-accent) 7%, transparent)" }}>
                          <span className="flex items-center gap-1.5 text-xs font-bold"><Users size={14} style={{ color: "var(--t-accent)" }} /> Llenar con un empleado de Nómina <span className="font-normal opacity-60">(opcional)</span></span>
                          <select className={`${fieldCls} mt-1.5`} style={fieldStyle} value={employeeId} onChange={(e) => pickEmployee(e.target.value)}>
                            <option value="">Escoge un empleado…</option>
                            {employeeOptions.map((e) => (
                              <option key={e.id} value={e.id}>{e.full_name}{e.position ? ` · ${e.position}` : ""}{e.point_id ? ` · ${points.find((p) => p.id === e.point_id)?.name ?? ""}` : ""}{e.hasUser ? " (ya tiene usuario)" : ""}</option>
                            ))}
                          </select>
                          <span className="mt-1.5 block text-[11px]" style={{ color: "var(--t-muted)" }}>Se llenan el nombre, un usuario sugerido y su punto.</span>
                        </label>
                      ) : null}
                      <Field label="Nombre visible" hint="Así aparece en ventas, chat y auditoría.">
                        <IconInput icon={<UserRound size={17} />}><input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} placeholder="Ej. María, vendedora de mostrador" className={fieldCls} style={{ ...fieldStyle, paddingLeft: "2.75rem" }} /></IconInput>
                      </Field>
                      <Field label="Usuario para entrar" hint={userTaken ? "⚠️ Ese usuario ya existe en la tienda." : "3 a 32: letras, números, punto, guion o guion bajo. Al entrar no importan mayúsculas."} bad={!!cleanUser && (!userOk || userTaken)}>
                        <IconInput icon={<AtSign size={17} />} badge={cleanUser ? (userOk && !userTaken ? "ok" : "bad") : null}>
                          <input value={user} onChange={(e) => setUser(e.target.value.replace(/\s+/g, ""))} maxLength={32} autoCapitalize="none" autoComplete="off" spellCheck={false} placeholder="Ej. maria"
                            className={`${fieldCls} font-semibold`} style={{ ...fieldStyle, paddingLeft: "2.75rem", paddingRight: "2.75rem", borderColor: cleanUser && (!userOk || userTaken) ? "#ef4444" : fieldStyle.borderColor }} />
                        </IconInput>
                        {editing && userChanged && userOk && !userTaken ? <span className="mt-1.5 block rounded-xl px-3 py-2 text-xs" style={{ background: "color-mix(in oklab, var(--t-accent) 10%, transparent)" }}>Desde ahora entrará con <b>{cleanUser}</b> y su misma contraseña.</span> : null}
                      </Field>
                      <div className="md:col-span-2">
                        {editing ? (
                          canPasswords ? (
                            <button type="button" onClick={() => setChangePassword((v) => !v)} className="mb-2 flex w-full items-center justify-between gap-2 rounded-2xl border p-3 text-left" style={{ borderColor: "var(--t-card-border)" }}>
                              <span className="flex items-center gap-2 text-sm font-bold"><KeyRound size={16} style={{ color: "var(--t-accent)" }} /> Poner una contraseña nueva</span>
                              <span className="relative h-6 w-11 rounded-full transition" style={{ background: changePassword ? "var(--t-accent)" : "color-mix(in oklab, var(--t-text) 18%, transparent)" }}>
                                <span className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all" style={{ left: changePassword ? 22 : 2 }} />
                              </span>
                            </button>
                          ) : <p className="rounded-2xl border p-3 text-xs" style={{ borderColor: "var(--t-card-border)", color: "var(--t-muted)" }}>🔒 Para cambiar contraseñas necesitas el permiso «Cambiar contraseñas del equipo».</p>
                        ) : null}
                        {needPassword ? (
                          <Field label={editing ? "Contraseña nueva" : "Contraseña inicial"} hint={password && password.length < 4 ? `Faltan ${4 - password.length} caracteres.` : "Compártela por un canal privado. La persona la puede cambiar después."} bad={!!password && password.length < 4}>
                            <IconInput icon={<KeyRound size={17} />}>
                              <input type={showPassword ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" placeholder="Mínimo 4 caracteres" className={fieldCls} style={{ ...fieldStyle, paddingLeft: "2.75rem", paddingRight: "3rem" }} />
                              <button type="button" onClick={() => setShowPassword((v) => !v)} className="absolute right-2 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-xl opacity-70 hover:opacity-100" aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}>
                                {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                              </button>
                            </IconInput>
                            <PasswordStrength password={password} hints={[cleanUser, name, store.name]} />
                          </Field>
                        ) : null}
                      </div>
                    </div>
                  ) : null}

                  {step === "access" ? (
                    <div className="mx-auto max-w-3xl space-y-5">
                      {(
                        <div>
                          <p className="mb-2 text-sm font-black">Tipo de acceso</p>
                          {!isOwner ? <p className="mb-2 rounded-xl border px-3 py-2 text-xs" style={{ borderColor: "var(--t-card-border)", color: "var(--t-muted)" }}>👑 Solo el dueño de la tienda puede nombrar administradores. Tú puedes darle la plantilla «Administrador» en Permisos (todos los permisos que tú tienes).</p> : null}
                          <div className="grid gap-2 sm:grid-cols-2">
                            {[
                              { on: !admin, icon: <ShieldCheck size={18} />, title: "Personalizado", text: "Solo lo que marques en Permisos. Lo recomendado.", set: () => setAdmin(false) },
                              { on: admin, icon: <Crown size={18} />, title: "Administrador de la tienda", text: "Todo, en todos los puntos, como el dueño (menos cambiarte a ti).", set: () => setAdmin(true) },
                            ].map((o) => (
                              <button key={o.title} type="button" onClick={o.set} disabled={!isOwner && !o.on} className="flex items-start gap-3 rounded-2xl border p-3 text-left transition disabled:opacity-45"
                                style={o.on ? { borderColor: "var(--t-accent)", background: "var(--t-accent-soft, color-mix(in oklab, var(--t-accent) 12%, transparent))" } : { borderColor: "var(--t-card-border)" }}>
                                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl" style={{ background: o.on ? "var(--t-accent)" : "var(--t-card-bg-soft)", color: o.on ? "#fff" : "var(--t-text)" }}>{o.icon}</span>
                                <span><b className="text-sm">{o.title}</b><span className="block text-xs" style={{ color: "var(--t-muted)" }}>{o.text}</span></span>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                      {!admin ? (
                        <>
                          <div>
                            <p className="text-sm font-black">¿Dónde trabaja?</p>
                            <p className="mb-2 text-xs" style={{ color: "var(--t-muted)" }}>Con un punto asignado solo ve y mueve el inventario, ventas y documentos de ese punto.</p>
                            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                              {[{ id: "", name: "Todos los puntos", kind: "all" }, ...points].map((pt) => {
                                const on = (pointId || "") === pt.id;
                                return (
                                  <button key={pt.id || "all"} type="button" onClick={() => setPointId(pt.id)} className="flex items-center gap-2.5 rounded-2xl border px-3 py-2.5 text-left transition"
                                    style={on ? { borderColor: "var(--t-accent)", background: "var(--t-accent-soft, color-mix(in oklab, var(--t-accent) 12%, transparent))" } : { borderColor: "var(--t-card-border)" }}>
                                    <span className="text-lg">{pt.kind === "all" ? "🌐" : pt.kind === "point" ? "📍" : "🏬"}</span>
                                    <span className="min-w-0 flex-1"><b className="block truncate text-sm">{pt.name}</b><span className="text-[11px]" style={{ color: "var(--t-muted)" }}>{pt.kind === "all" ? "Sin restricción (tienda madre)" : pt.kind === "point" ? "Punto de venta" : "Bodega"}</span></span>
                                    {on ? <Check size={16} style={{ color: "var(--t-accent)" }} /> : null}
                                  </button>
                                );
                              })}
                            </div>
                            {pointId && perms.includes("points") ? <p className="mt-2 rounded-xl border px-3 py-2 text-xs" style={{ borderColor: "rgba(245,158,11,.5)", background: "rgba(245,158,11,.08)" }}>⚠️ Con un punto asignado no podrá crear ni editar puntos (eso es de la tienda madre).</p> : null}
                          </div>
                          {pointId && editing ? (
                            <div>
                              <p className="text-sm font-black">También puede consultar</p>
                              <p className="mb-2 text-xs" style={{ color: "var(--t-muted)" }}>Opera solo en su punto; en estos ve documentos e informes según sus permisos.</p>
                              <div className="flex flex-wrap gap-1.5">
                                {points.filter((pt) => pt.id !== pointId).map((pt) => {
                                  const on = extraPoints.includes(pt.id);
                                  return (
                                    <button key={pt.id} type="button" onClick={() => setExtraPoints(on ? extraPoints.filter((x) => x !== pt.id) : [...extraPoints, pt.id])} className="rounded-full border px-3 py-1.5 text-xs font-semibold transition"
                                      style={on ? { background: "var(--t-accent)", color: "#fff", borderColor: "transparent" } : { borderColor: "var(--t-card-border)" }}>
                                      {pt.kind === "point" ? "📍" : "🏬"} {pt.name}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          ) : null}
                        </>
                      ) : <p className="rounded-2xl border p-4 text-sm" style={{ borderColor: "var(--t-card-border)" }}>👑 Un administrador trabaja en todos los puntos y tiene todos los permisos.</p>}
                    </div>
                  ) : null}

                  {step === "permissions" ? (
                    admin ? (
                      <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-3 rounded-2xl border p-4 text-sm" style={{ borderColor: "var(--t-card-border)" }}>
                        <span className="min-w-0 flex-1">👑 Es <b>administrador de la tienda</b>: tiene todos los permisos, en todos los puntos.</span>
                        {isOwner ? <button type="button" onClick={() => setAdmin(false)} className="rounded-xl border px-3 py-2 text-xs font-bold" style={{ borderColor: "var(--t-card-border)" }}>Escoger permisos uno por uno</button> : null}
                      </div>
                    ) : (
                      <>
                      {isOwner ? (
                        <div className="mb-3 flex flex-wrap items-center gap-3 rounded-2xl border p-3" style={{ borderColor: "color-mix(in oklab, var(--t-accent) 40%, var(--t-card-border))", background: "color-mix(in oklab, var(--t-accent) 7%, transparent)" }}>
                          <Crown size={18} style={{ color: "var(--t-accent)" }} />
                          <p className="min-w-0 flex-1 text-xs"><b className="text-sm">¿Debe manejar todo?</b><span className="block" style={{ color: "var(--t-muted)" }}>Hazlo <b>administrador de la tienda</b>: tiene todos los permisos en todos los puntos, también los que se agreguen en el futuro.</span></p>
                          <button type="button" onClick={() => setAdmin(true)} className="rounded-xl px-3 py-2 text-xs font-bold text-white" style={{ background: "linear-gradient(135deg, var(--t-accent), var(--t-accent2, var(--t-accent)))" }}>👑 Hacer administrador</button>
                        </div>
                      ) : null}
                      <PermissionMatrix value={perms} onChange={setPerms} disabled={saving} storeId={store.id} copyFrom={copyFrom} original={editing ? original : undefined} grantable={grantable} initialArea={startArea} />
                      </>
                    )
                  ) : null}

                  {step === "limits" && editing ? (
                    <div className="mx-auto max-w-4xl space-y-3">
                      <p className="text-xs" style={{ color: "var(--t-muted)" }}>Estos límites se guardan al instante (no esperan al botón Guardar).</p>
                      <AccessLimits storeId={store.id} userId={member!.user_id} name={shownName} permissions={member!.permissions} overview={access} onChanged={onAccessChanged} />
                    </div>
                  ) : null}

                  {step === "summary" ? <Summary perms={effective} admin={admin} added={editing ? added : []} removed={editing ? removed : []} pointName={admin ? null : points.find((p) => p.id === pointId)?.name ?? null} /> : null}
                </motion.div>
              </AnimatePresence>
            </div>

            <AnimatePresence>
              {error ? (
                <motion.p initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mx-4 mb-2 rounded-xl border px-3 py-2 text-xs font-semibold sm:mx-6" style={{ borderColor: "rgba(239,68,68,.45)", background: "rgba(239,68,68,.1)", color: "#ef4444" }}>
                  {error}
                </motion.p>
              ) : null}
            </AnimatePresence>

            {/* Pie */}
            <footer className="relative flex items-center gap-2 border-t px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6" style={{ borderColor: "var(--t-card-border)" }}>
              <button type="button" onClick={() => (idx > 0 ? setStep(steps[idx - 1].key) : onClose())} disabled={saving} className="inline-flex items-center gap-1.5 rounded-2xl border px-4 py-3 text-sm font-bold" style={{ borderColor: "var(--t-card-border)" }}>
                {idx > 0 ? <><ArrowLeft size={15} /> Atrás</> : "Cancelar"}
              </button>
              <span className="hidden flex-1 text-center text-xs sm:block" style={{ color: "var(--t-muted)" }}>
                {editing ? (dirty ? `${[nameChanged && "nombre", userChanged && "usuario", changePassword && password && "contraseña", (pointChanged || extraChanged) && "puntos", roleChanged && "tipo", permsChanged && `${added.length + removed.length} permisos`].filter(Boolean).join(" · ")} por guardar` : "Sin cambios") : `Paso ${idx + 1} de ${steps.length}`}
              </span>
              <span className="flex-1 sm:hidden" />
              {idx < steps.length - 1 ? (
                <button type="button" onClick={() => setStep(steps[idx + 1].key)} className="inline-flex items-center gap-1.5 rounded-2xl border px-4 py-3 text-sm font-bold" style={{ borderColor: "var(--t-card-border)" }}>
                  Siguiente <ArrowRight size={15} />
                </button>
              ) : null}
              {editing || idx === steps.length - 1 ? (
                <button type="button" onClick={() => void save()} disabled={saving || !dirty} className="inline-flex items-center gap-2 rounded-2xl px-5 py-3 text-sm font-bold text-white shadow-lg transition hover:-translate-y-0.5 disabled:pointer-events-none disabled:opacity-50" style={{ background: "linear-gradient(135deg, var(--t-accent), var(--t-accent2, var(--t-accent)))" }}>
                  {saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                  {saving ? "Guardando…" : editing ? "Guardar cambios" : "Crear usuario"}
                </button>
              ) : null}
            </footer>
          </>
        )}
      </motion.div>
    </motion.div>
  );
}

function Field({ label, hint, bad, children }: { label: string; hint?: string; bad?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-bold">{label}</span>
      <span className="mt-1.5 block">{children}</span>
      {hint ? <span className="mt-1.5 block text-[11px]" style={{ color: bad ? "#ef4444" : "var(--t-muted)" }}>{hint}</span> : null}
    </label>
  );
}

function IconInput({ icon, badge, children }: { icon: React.ReactNode; badge?: "ok" | "bad" | null; children: React.ReactNode }) {
  return (
    <span className="relative block">
      <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 opacity-55">{icon}</span>
      {children}
      {badge ? (
        <span className="absolute right-3.5 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-full text-white" style={{ background: badge === "ok" ? "#16a34a" : "#ef4444" }}>
          {badge === "ok" ? <Check size={13} /> : <X size={13} />}
        </span>
      ) : null}
    </span>
  );
}

/** Lo que la persona verá y podrá hacer, en palabras, y qué cambia frente a lo guardado. */
function Summary({ perms, admin, added, removed, pointName }: { perms: string[]; admin: boolean; added: string[]; removed: string[]; pointName: string | null }) {
  const has = (p: string) => perms.includes(p);
  const opens = [...new Set(PERMISSION_LIST.filter((p) => has(p.value) && p.opens).flatMap((p) => p.opens!.split(" · ")))];
  const sensitive = PERMISSION_LIST.filter((p) => p.sensitive && has(p.value));
  const notes: string[] = [];
  if (!admin) {
    if (has("products") && !has("costs_view")) notes.push("Edita productos, pero no ve costos ni % de ganancia 🔒");
    if (has("products") && !has("products_prices")) notes.push("No puede cambiar precios");
    if (has("products") && !has("products_delete")) notes.push("No puede eliminar productos");
    if ((has("inventory") || has("purchases")) && !has("costs_view")) notes.push("En inventario e informes los costos le salen ocultos");
    if (has("pos") && !has("sales_void")) notes.push("Vende, pero no anula ventas");
    if (has("pos") && !has("price_approve")) notes.push("No vende por debajo del precio permitido sin autorización");
    if (has("purchases") && !has("purchases_void")) notes.push("Ingresa facturas, pero no las anula");
    if (has("users") && !has("users_passwords")) notes.push("Administra usuarios, pero no cambia contraseñas");
    if (has("users") && !has("users_delete")) notes.push("Administra usuarios, pero no los elimina (solo desactiva)");
    if (!has("exports")) notes.push("No descarga listados a Excel");
    if (!has("messages")) notes.push("No ve Mensajes ni llamadas del equipo");
    if (pointName) notes.push(`Solo trabaja en ${pointName}`);
  }
  const card = { borderColor: "var(--t-card-border)", background: "var(--t-card-bg-soft)" };
  return (
    <div className="mx-auto grid max-w-5xl gap-3 md:grid-cols-2">
      <div className="rounded-2xl border p-4 md:col-span-2" style={card}>
        <p className="mb-2 text-sm font-black">{admin ? "👑 Administrador: acceso total" : `${perms.length} permisos`}{pointName ? ` · 📍 ${pointName}` : " · 🌐 Todos los puntos"}</p>
        <RiskMeter perms={perms} admin={admin} />
      </div>
      {added.length || removed.length ? (
        <div className="rounded-2xl border p-4 md:col-span-2" style={card}>
          <p className="mb-2 text-sm font-black">Cambios por guardar</p>
          <div className="flex flex-wrap gap-1.5">
            {added.map((p) => <span key={p} className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-bold text-emerald-500">+ {permissionInfo(p)?.label ?? p}</span>)}
            {removed.map((p) => <span key={p} className="rounded-full bg-red-500/15 px-2.5 py-1 text-xs font-bold text-red-500">− {permissionInfo(p)?.label ?? p}</span>)}
          </div>
        </div>
      ) : null}
      <div className="rounded-2xl border p-4" style={card}>
        <p className="mb-2 text-sm font-black">📂 Verá en el menú</p>
        <div className="flex flex-wrap gap-1.5">
          {opens.length ? opens.map((o) => <span key={o} className="rounded-full border px-2.5 py-1 text-xs font-semibold" style={{ borderColor: "var(--t-card-border)" }}>{o}</span>) : <span className="text-xs" style={{ color: "var(--t-muted)" }}>Solo el inicio.</span>}
        </div>
      </div>
      <div className="rounded-2xl border p-4" style={card}>
        <p className="mb-2 text-sm font-black">🧭 Por área</p>
        <ul className="space-y-1 text-xs">
          {PERMISSION_GROUPS.map((g) => {
            const n = g.items.filter((i) => has(i.value)).length;
            if (!n) return null;
            return <li key={g.key} className="flex items-center justify-between gap-2"><span>{g.icon} {g.title}</span><b className="tabular-nums">{n}/{g.items.length}</b></li>;
          })}
        </ul>
      </div>
      {sensitive.length ? (
        <div className="rounded-2xl border p-4" style={{ ...card, borderColor: "rgba(245,158,11,.45)" }}>
          <p className="mb-2 text-sm font-black">⚠️ Permisos sensibles ({sensitive.length})</p>
          <div className="flex flex-wrap gap-1.5">{sensitive.map((p) => <span key={p.value} className="rounded-full px-2.5 py-1 text-xs font-semibold" style={{ background: p.risk === "critical" ? "rgba(239,68,68,.14)" : "rgba(245,158,11,.14)" }}>{p.label}</span>)}</div>
        </div>
      ) : null}
      {notes.length ? (
        <div className="rounded-2xl border p-4" style={card}>
          <p className="mb-2 text-sm font-black">🚫 No podrá</p>
          <ul className="list-disc space-y-0.5 pl-4 text-xs" style={{ color: "var(--t-muted)" }}>{notes.map((n) => <li key={n}>{n}</li>)}</ul>
        </div>
      ) : null}
    </div>
  );
}

function CreatedScreen({ store, name, created, copied, onCopy, onClose }: { store: { name: string }; name: string; created: { username: string; link: string }; copied: boolean; onCopy: () => void; onClose: () => void }) {
  const msg = `Hola ${name}, ya tienes acceso al sistema de ${store.name}.\nUsuario: ${created.username}\nEntra aquí: ${created.link}\n(La contraseña te la doy aparte.)`;
  return (
    <div className="grid flex-1 place-items-center overflow-y-auto p-6">
      <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="w-full max-w-md text-center">
        <motion.span initial={{ rotate: -20, scale: 0.6 }} animate={{ rotate: 0, scale: 1 }} transition={{ type: "spring", stiffness: 300, damping: 14 }} className="mx-auto grid h-16 w-16 place-items-center rounded-3xl text-3xl text-white shadow-lg" style={{ background: "linear-gradient(135deg,#10b981,#0ea5e9)" }}>✓</motion.span>
        <h3 className="mt-4 text-xl font-black">¡{name} ya tiene acceso!</h3>
        <p className="mt-1 text-sm" style={{ color: "var(--t-muted)" }}>Entra con el usuario <b className="font-mono" style={{ color: "var(--t-text)" }}>{created.username}</b> y la contraseña que pusiste.</p>
        {created.link ? <p className="mt-3 break-all rounded-xl border px-3 py-2 font-mono text-[11px]" style={{ borderColor: "var(--t-card-border)", color: "var(--t-muted)" }}>{created.link}</p> : null}
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button type="button" onClick={onCopy} className="inline-flex items-center justify-center gap-1.5 rounded-2xl border px-3 py-3 text-sm font-bold" style={{ borderColor: "var(--t-card-border)" }}>{copied ? <Check size={15} /> : <Copy size={15} />} {copied ? "Copiado" : "Copiar enlace"}</button>
          <a href={`https://wa.me/?text=${encodeURIComponent(msg)}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center justify-center gap-1.5 rounded-2xl px-3 py-3 text-sm font-bold text-white" style={{ background: "#16a34a" }}><MessageCircle size={15} /> WhatsApp</a>
        </div>
        <button type="button" onClick={onClose} className="mt-3 w-full rounded-2xl px-4 py-3 text-sm font-bold text-white" style={{ background: "linear-gradient(135deg, var(--t-accent), var(--t-accent2, var(--t-accent)))" }}>Listo</button>
      </motion.div>
    </div>
  );
}
