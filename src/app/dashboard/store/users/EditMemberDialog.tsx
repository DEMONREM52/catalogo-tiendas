"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { AtSign, Check, Eye, EyeOff, KeyRound, Loader2, UserRound, X } from "lucide-react";
import { PasswordStrength } from "@/components/PasswordStrength";

export type EditableMember = { user_id: string; username: string | null; display_name: string | null };
export type ProfileChanges = { display_name?: string; username?: string; new_password?: string };

const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,31}$/;

/** Ventana para editar nombre visible, usuario interno y (opcional) contraseña de un trabajador. */
export function EditMemberDialog({
  member,
  focusPassword = false,
  onClose,
  onSave,
}: {
  member: EditableMember | null;
  focusPassword?: boolean;
  onClose: () => void;
  onSave: (member: EditableMember, changes: ProfileChanges) => Promise<void>;
}) {
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  if (!mounted) return null;
  return createPortal(
    <AnimatePresence>
      {member ? <Sheet key={member.user_id} member={member} focusPassword={focusPassword} onClose={onClose} onSave={onSave} /> : null}
    </AnimatePresence>,
    document.body,
  );
}

function Sheet({ member, focusPassword, onClose, onSave }: { member: EditableMember; focusPassword: boolean; onClose: () => void; onSave: (m: EditableMember, c: ProfileChanges) => Promise<void> }) {
  const [name, setName] = useState(member.display_name ?? "");
  const [user, setUser] = useState(member.username ?? "");
  const [changePassword, setChangePassword] = useState(focusPassword);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose, saving]);

  const cleanUser = user.replace(/\s+/g, "");
  const userOk = USERNAME_RE.test(cleanUser.toLowerCase());
  const userChanged = cleanUser !== (member.username ?? "");
  const loginChanged = cleanUser.toLowerCase() !== (member.username ?? "").toLowerCase();
  const nameChanged = name.trim() !== (member.display_name ?? "").trim();
  const passwordOk = !changePassword || password.length >= 4;
  const dirty = userChanged || nameChanged || (changePassword && password.length > 0);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!userOk) return setError("El usuario debe tener de 3 a 32 caracteres: letras, números, punto, guion o guion bajo.");
    if (!passwordOk) return setError("La contraseña debe tener al menos 4 caracteres.");
    if (!dirty) return onClose();
    const changes: ProfileChanges = {};
    if (nameChanged) changes.display_name = name.trim();
    if (userChanged) changes.username = cleanUser;
    if (changePassword && password) changes.new_password = password;
    setSaving(true);
    try {
      await onSave(member, changes);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  }

  const field = "w-full rounded-2xl border py-3 pl-11 pr-4 text-base outline-none transition focus:ring-2 focus:ring-[color:color-mix(in_oklab,var(--t-accent)_35%,transparent)] sm:text-sm";
  const fieldStyle = { borderColor: "var(--t-card-border)", background: "color-mix(in oklab, var(--t-card-bg) 92%, transparent)", color: "var(--t-text)", paddingLeft: "2.75rem", paddingRight: "2.75rem" };

  return (
    <motion.div className="fixed inset-0 z-[140] flex items-end justify-center sm:items-center sm:p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <button type="button" aria-label="Cerrar" className="absolute inset-0 cursor-default bg-black/55 backdrop-blur-[3px]" onClick={() => !saving && onClose()} />
      <motion.form
        onSubmit={submit}
        role="dialog"
        aria-modal="true"
        aria-label="Editar usuario"
        className="relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-[28px] border shadow-[0_30px_90px_rgba(0,0,0,0.45)] sm:max-w-lg sm:rounded-[28px]"
        style={{ borderColor: "var(--t-card-border)", background: "var(--t-bg-base)", color: "var(--t-text)" }}
        initial={{ y: 50, opacity: 0, scale: 0.98 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        exit={{ y: 50, opacity: 0, scale: 0.98 }}
        transition={{ type: "spring", stiffness: 380, damping: 34 }}
      >
        <div className="pointer-events-none absolute -right-20 -top-24 h-56 w-56 rounded-full blur-3xl" style={{ background: "color-mix(in oklab, var(--t-accent) 22%, transparent)" }} />
        <span className="mx-auto mt-2 h-1.5 w-11 shrink-0 rounded-full sm:hidden" style={{ background: "color-mix(in oklab, var(--t-text) 18%, transparent)" }} aria-hidden />
        <header className="relative flex items-start justify-between gap-3 px-5 pb-2 pt-3 sm:px-6 sm:pt-6">
          <div className="flex min-w-0 items-center gap-3">
            <Avatar name={name || cleanUser || "?"} size={46} />
            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-[0.18em]" style={{ color: "var(--t-accent)" }}>Editar usuario</p>
              <h2 className="truncate text-lg font-black">{name.trim() || cleanUser || "Sin nombre"}</h2>
            </div>
          </div>
          <button type="button" onClick={onClose} disabled={saving} className="grid h-9 w-9 shrink-0 place-items-center rounded-full border transition hover:rotate-90" style={{ borderColor: "var(--t-card-border)" }} aria-label="Cerrar">
            <X size={16} />
          </button>
        </header>

        <div className="relative space-y-4 overflow-y-auto px-5 pb-4 pt-2 sm:px-6">
          <label className="block">
            <span className="text-xs font-bold">Nombre visible</span>
            <span className="relative mt-1.5 block">
              <UserRound size={17} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 opacity-55" />
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} placeholder="Ej. María, vendedora de mostrador" className={field} style={fieldStyle} />
            </span>
          </label>

          <label className="block">
            <span className="text-xs font-bold">Usuario interno</span>
            <span className="relative mt-1.5 block">
              <AtSign size={17} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 opacity-55" />
              <input
                value={user}
                onChange={(e) => setUser(e.target.value.replace(/\s+/g, ""))}
                maxLength={32}
                autoCapitalize="none"
                autoComplete="off"
                spellCheck={false}
                placeholder="Ej. USU01"
                className={`${field} font-semibold`}
                style={{ ...fieldStyle, borderColor: cleanUser && !userOk ? "#ef4444" : fieldStyle.borderColor }}
              />
              {cleanUser ? (
                <span className="absolute right-3.5 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-full text-white" style={{ background: userOk ? "#16a34a" : "#ef4444" }}>
                  {userOk ? <Check size={13} /> : <X size={13} />}
                </span>
              ) : null}
            </span>
            <AnimatePresence initial={false}>
              {loginChanged && userOk ? (
                <motion.span initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="mt-2 block overflow-hidden rounded-xl px-3 py-2 text-xs" style={{ background: "color-mix(in oklab, var(--t-accent) 10%, transparent)" }}>
                  Desde ahora entrará con <b>{cleanUser}</b> y su misma contraseña.
                </motion.span>
              ) : null}
            </AnimatePresence>
            <span className="mt-1.5 block text-[11px]" style={{ color: "var(--t-muted)" }}>
              Se guarda como lo escribas; para entrar no importa si usa mayúscula o minúscula.
            </span>
          </label>

          <div className="rounded-2xl border p-3" style={{ borderColor: "var(--t-card-border)" }}>
            <button type="button" onClick={() => setChangePassword((v) => !v)} className="flex w-full items-center justify-between gap-2 text-left">
              <span className="flex items-center gap-2 text-sm font-bold"><KeyRound size={16} style={{ color: "var(--t-accent)" }} /> Cambiar contraseña</span>
              <span className="relative h-6 w-11 rounded-full transition" style={{ background: changePassword ? "var(--t-accent)" : "color-mix(in oklab, var(--t-text) 18%, transparent)" }}>
                <motion.span layout className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow" style={{ left: changePassword ? 22 : 2 }} />
              </span>
            </button>
            <AnimatePresence initial={false}>
              {changePassword ? (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                  <span className="relative mt-3 block">
                    <KeyRound size={17} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 opacity-55" />
                    <input
                      autoFocus={focusPassword}
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      autoComplete="new-password"
                      placeholder="Nueva contraseña (mínimo 4)"
                      className={`${field} pr-12`}
                      style={fieldStyle}
                    />
                    <button type="button" onClick={() => setShowPassword((v) => !v)} className="absolute right-2 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-xl opacity-70 hover:opacity-100" aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}>
                      {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                    </button>
                  </span>
                  <span className="mt-1.5 block text-[11px]" style={{ color: password && password.length < 4 ? "#ef4444" : "var(--t-muted)" }}>
                    {password && password.length < 4 ? `Faltan ${4 - password.length} caracteres.` : "Compártela con el trabajador por un canal privado."}
                  </span>
                  <PasswordStrength password={password} hints={[cleanUser, name]} />
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>

          <AnimatePresence>
            {error ? (
              <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="rounded-xl border px-3 py-2 text-xs font-semibold" style={{ borderColor: "rgba(239,68,68,.45)", background: "rgba(239,68,68,.1)", color: "#ef4444" }}>
                {error}
              </motion.p>
            ) : null}
          </AnimatePresence>
        </div>

        <footer className="relative flex gap-2 border-t px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6 sm:py-4" style={{ borderColor: "var(--t-card-border)" }}>
          <button type="button" onClick={onClose} disabled={saving} className="flex-1 rounded-2xl border px-4 py-3 text-sm font-bold transition hover:-translate-y-0.5" style={{ borderColor: "var(--t-card-border)" }}>
            Cancelar
          </button>
          <button
            type="submit"
            disabled={saving || !dirty || !userOk || !passwordOk}
            className="inline-flex flex-[1.4] items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-bold text-white shadow-lg transition hover:-translate-y-0.5 disabled:pointer-events-none disabled:opacity-50"
            style={{ background: "linear-gradient(135deg, var(--t-accent), var(--t-accent2, var(--t-accent)))" }}
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
            {saving ? "Guardando…" : "Guardar cambios"}
          </button>
        </footer>
      </motion.form>
    </motion.div>
  );
}

const AVATAR_COLORS = [["#8b5cf6", "#ec4899"], ["#0ea5e9", "#6366f1"], ["#10b981", "#0ea5e9"], ["#f59e0b", "#ef4444"], ["#14b8a6", "#84cc16"], ["#f43f5e", "#a855f7"]];

/** Círculo con iniciales y color propio de cada persona. */
export function Avatar({ name, size = 44, dim = false }: { name: string; size?: number; dim?: boolean }) {
  const clean = name.trim() || "?";
  const parts = clean.split(/\s+/).filter(Boolean);
  const initials = (parts.length > 1 ? parts[0][0] + parts[1][0] : clean.slice(0, 2)).toUpperCase();
  let hash = 0;
  for (const ch of clean.toLowerCase()) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const [a, b] = AVATAR_COLORS[hash % AVATAR_COLORS.length];
  return (
    <span
      className="grid shrink-0 place-items-center rounded-2xl font-black text-white shadow-md"
      style={{ width: size, height: size, fontSize: size * 0.36, background: `linear-gradient(135deg, ${a}, ${b})`, filter: dim ? "grayscale(0.9)" : undefined, opacity: dim ? 0.6 : 1 }}
      aria-hidden
    >
      {initials}
    </span>
  );
}
