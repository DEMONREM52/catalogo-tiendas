"use client";

// Piezas visuales del módulo fiscal y de puntos (mismo estilo del resto del panel).
import { useEffect, useState, useSyncExternalStore, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Copy, Loader2, X } from "lucide-react";
import Swal from "sweetalert2";
import { ENV_INFO, STATUS_INFO, type FiscalEnvironment, type FiscalStatus, type FiscalTone } from "@/lib/fiscal/types";

export const swal = { background: "var(--t-bg-base)", color: "var(--t-text)", confirmButtonColor: "#8b5cf6" };

export const TONE: Record<FiscalTone, { fg: string; bg: string; border: string }> = {
  neutral: { fg: "var(--t-muted)", bg: "color-mix(in oklab, var(--t-text) 7%, transparent)", border: "var(--t-card-border)" },
  info: { fg: "#0284c7", bg: "color-mix(in oklab, #0ea5e9 14%, transparent)", border: "color-mix(in oklab, #0ea5e9 38%, transparent)" },
  good: { fg: "#16a34a", bg: "color-mix(in oklab, #22c55e 14%, transparent)", border: "color-mix(in oklab, #22c55e 38%, transparent)" },
  warn: { fg: "#d97706", bg: "color-mix(in oklab, #f59e0b 16%, transparent)", border: "color-mix(in oklab, #f59e0b 40%, transparent)" },
  bad: { fg: "#dc2626", bg: "color-mix(in oklab, #ef4444 14%, transparent)", border: "color-mix(in oklab, #ef4444 40%, transparent)" },
};

export const fmtMoney = (value: number | null | undefined) =>
  new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(Number(value ?? 0));
export const fmtNumber = (value: number | null | undefined) => new Intl.NumberFormat("es-CO").format(Number(value ?? 0));
export const fmtDate = (value: string | null | undefined) =>
  value ? new Date(value.length === 10 ? `${value}T12:00:00` : value).toLocaleDateString("es-CO", { day: "2-digit", month: "short", year: "numeric" }) : "—";
export const fmtDateTime = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" }) : "—";

export function Badge({ tone = "neutral", children, title, className = "" }: { tone?: FiscalTone; children: ReactNode; title?: string; className?: string }) {
  const t = TONE[tone];
  return (
    <span title={title} className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-bold ${className}`} style={{ color: t.fg, background: t.bg, borderColor: t.border }}>
      {children}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const info = STATUS_INFO[status as FiscalStatus];
  return <Badge tone={info?.tone ?? "neutral"} title={info?.help}>{info?.label ?? status}</Badge>;
}

export function EnvBadge({ env }: { env: string }) {
  const info = ENV_INFO[env as FiscalEnvironment];
  return <Badge tone={info?.tone ?? "neutral"} title={info?.label}>{info?.badge ?? env}</Badge>;
}

export function Dot({ tone, pulse = false }: { tone: FiscalTone; pulse?: boolean }) {
  return (
    <span className="relative inline-flex h-2.5 w-2.5 shrink-0">
      {pulse ? <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60" style={{ background: TONE[tone].fg }} /> : null}
      <span className="relative inline-flex h-2.5 w-2.5 rounded-full" style={{ background: TONE[tone].fg }} />
    </span>
  );
}

export function Card({ children, className = "", style, as = "div" }: { children: ReactNode; className?: string; style?: CSSProperties; as?: "div" | "section" | "article" }) {
  const Tag = as;
  return (
    <Tag className={`rounded-[22px] border p-4 sm:p-5 ${className}`} style={{ borderColor: "var(--t-card-border)", background: "color-mix(in oklab, var(--t-card-bg) 94%, transparent)", ...style }}>
      {children}
    </Tag>
  );
}

export function SectionTitle({ title, subtitle, actions, icon }: { title: string; subtitle?: ReactNode; actions?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="flex items-center gap-2 text-base font-black sm:text-lg">{icon}{title}</h2>
        {subtitle ? <p className="mt-0.5 text-xs sm:text-sm" style={{ color: "var(--t-muted)" }}>{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

type BtnVariant = "primary" | "soft" | "ghost" | "danger" | "good";
export function Button({ variant = "soft", icon, busy = false, children, className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; icon?: ReactNode; busy?: boolean }) {
  const styles: Record<BtnVariant, CSSProperties> = {
    primary: { background: "linear-gradient(135deg, var(--t-accent), var(--t-accent2, var(--t-accent)))", color: "#fff", borderColor: "transparent" },
    soft: { background: "color-mix(in oklab, var(--t-card-bg) 80%, transparent)", color: "var(--t-text)", borderColor: "var(--t-card-border)" },
    ghost: { background: "transparent", color: "var(--t-text)", borderColor: "transparent" },
    danger: { background: "color-mix(in oklab, #ef4444 12%, transparent)", color: "#dc2626", borderColor: "color-mix(in oklab, #ef4444 40%, transparent)" },
    good: { background: "#16a34a", color: "#fff", borderColor: "transparent" },
  };
  return (
    <button
      type="button"
      {...props}
      disabled={props.disabled || busy}
      className={`inline-flex items-center justify-center gap-2 rounded-xl border px-3.5 py-2 text-sm font-semibold transition hover:-translate-y-0.5 active:translate-y-0 disabled:pointer-events-none disabled:opacity-55 ${className}`}
      style={{ ...styles[variant], ...props.style }}
    >
      {busy ? <Loader2 size={15} className="animate-spin" /> : icon}
      {children}
    </button>
  );
}

export type TabItem<T extends string> = { value: T; label: string; icon?: ReactNode; badge?: number | string | null; hidden?: boolean };

export function Tabs<T extends string>({ value, onChange, items, layoutId = "tabs" }: { value: T; onChange: (v: T) => void; items: TabItem<T>[]; layoutId?: string }) {
  return (
    <nav className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 [scrollbar-width:none]" aria-label="Secciones">
      {items.filter((i) => !i.hidden).map((item) => {
        const on = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            onClick={() => onChange(item.value)}
            className="relative shrink-0 rounded-full border px-3.5 py-2 text-xs font-bold transition sm:text-sm"
            style={{ borderColor: on ? "transparent" : "var(--t-card-border)", color: on ? "#fff" : "var(--t-text)" }}
            aria-current={on ? "page" : undefined}
          >
            {on ? (
              <motion.span layoutId={layoutId} className="absolute inset-0 rounded-full" style={{ background: "linear-gradient(135deg, var(--t-accent), var(--t-accent2, var(--t-accent)))" }} transition={{ type: "spring", stiffness: 420, damping: 34 }} />
            ) : null}
            <span className="relative inline-flex items-center gap-1.5">
              {item.icon}
              {item.label}
              {item.badge ? (
                <span className="rounded-full px-1.5 text-[10px] font-black" style={{ background: on ? "rgba(255,255,255,.25)" : TONE.bad.bg, color: on ? "#fff" : TONE.bad.fg }}>{item.badge}</span>
              ) : null}
            </span>
          </button>
        );
      })}
    </nav>
  );
}

const useMounted = () => useSyncExternalStore(() => () => {}, () => true, () => false);

/** Panel lateral (pantalla completa en celular). */
export function Drawer({ open, onClose, kicker, title, subtitle, children, footer, width = "max-w-2xl" }: {
  open: boolean; onClose: () => void; kicker?: string; title: ReactNode; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode; width?: string;
}) {
  const mounted = useMounted();
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);
  if (!mounted) return null;
  return createPortal(
    <AnimatePresence>
      {open ? (
        <motion.div key="drawer" className="fixed inset-0 z-120 flex justify-end" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <button type="button" aria-label="Cerrar" className="absolute inset-0 cursor-default bg-black/55 backdrop-blur-[3px]" onClick={onClose} />
          <motion.aside
            role="dialog"
            aria-modal="true"
            className={`relative flex h-dvh w-full ${width} flex-col border-l`}
            style={{ borderColor: "var(--t-card-border)", background: "var(--t-bg-base)", color: "var(--t-text)" }}
            initial={{ x: 60, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 60, opacity: 0 }}
            transition={{ type: "spring", stiffness: 360, damping: 34 }}
          >
            <header className="flex items-start justify-between gap-3 border-b px-4 py-4 sm:px-5" style={{ borderColor: "var(--t-card-border)" }}>
              <div className="min-w-0">
                {kicker ? <p className="text-xs font-bold uppercase tracking-widest" style={{ color: "var(--t-accent)" }}>{kicker}</p> : null}
                <h3 className="mt-0.5 truncate text-lg font-black">{title}</h3>
                {subtitle ? <div className="mt-1 text-xs" style={{ color: "var(--t-muted)" }}>{subtitle}</div> : null}
              </div>
              <button type="button" onClick={onClose} className="grid h-9 w-9 shrink-0 place-items-center rounded-full border transition hover:rotate-90" style={{ borderColor: "var(--t-card-border)" }} aria-label="Cerrar">
                <X size={16} />
              </button>
            </header>
            <div className="flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5">{children}</div>
            {footer ? <footer className="flex flex-wrap items-center justify-end gap-2 border-t px-4 py-3 sm:px-5" style={{ borderColor: "var(--t-card-border)" }}>{footer}</footer> : null}
          </motion.aside>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}

export function Skeleton({ rows = 3, className = "" }: { rows?: number; className?: string }) {
  return (
    <div className={`space-y-2 ${className}`} aria-busy="true" aria-label="Cargando">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-16 animate-pulse rounded-2xl" style={{ background: "var(--t-card-bg)", opacity: 1 - i * 0.12 }} />
      ))}
    </div>
  );
}

export function EmptyState({ icon = "✨", title, text, action }: { icon?: ReactNode; title: string; text?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-[22px] border border-dashed px-5 py-9 text-center" style={{ borderColor: "var(--t-card-border)" }}>
      <div className="text-3xl">{icon}</div>
      <p className="mt-2 text-base font-bold">{title}</p>
      {text ? <p className="mx-auto mt-1 max-w-md text-sm" style={{ color: "var(--t-muted)" }}>{text}</p> : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border p-4 text-sm" style={{ borderColor: TONE.bad.border, background: TONE.bad.bg }}>
      <span style={{ color: TONE.bad.fg }}>{message}</span>
      {onRetry ? <Button onClick={onRetry}>Reintentar</Button> : null}
    </div>
  );
}

export function Notice({ tone = "info", icon, children }: { tone?: FiscalTone; icon?: ReactNode; children: ReactNode }) {
  const t = TONE[tone];
  return (
    <div className="flex items-start gap-3 rounded-2xl border p-3.5 text-sm" style={{ borderColor: t.border, background: t.bg }}>
      {icon ? <span className="mt-0.5 shrink-0" style={{ color: t.fg }}>{icon}</span> : null}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export const inputCls = "w-full rounded-xl border px-3 py-2.5 text-sm outline-none transition focus:ring-2 focus:ring-[color:color-mix(in_oklab,var(--t-accent)_35%,transparent)]";
export const inputStyle: CSSProperties = { borderColor: "var(--t-card-border)", background: "color-mix(in oklab, var(--t-card-bg) 92%, transparent)", color: "var(--t-text)" };

export function Field({ label, hint, required, children, className = "" }: { label: string; hint?: ReactNode; required?: boolean; children: ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-xs font-bold" style={{ color: "var(--t-muted)" }}>
        {label}
        {required ? <span className="text-red-500"> *</span> : null}
      </span>
      {children}
      {hint ? <span className="mt-1 block text-[11px]" style={{ color: "var(--t-muted)" }}>{hint}</span> : null}
    </label>
  );
}

export function Toggle({ checked, onChange, label, hint, disabled = false }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; hint?: ReactNode; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)} className="flex w-full items-start gap-3 rounded-2xl border p-3 text-left transition disabled:opacity-55" style={{ borderColor: checked ? TONE.good.border : "var(--t-card-border)", background: checked ? TONE.good.bg : "transparent" }}>
      <span className="relative mt-0.5 inline-flex h-5 w-9 shrink-0 rounded-full transition" style={{ background: checked ? "#16a34a" : "color-mix(in oklab, var(--t-text) 20%, transparent)" }}>
        <motion.span layout className="absolute top-0.5 h-4 w-4 rounded-full bg-white shadow" style={{ left: checked ? 18 : 2 }} transition={{ type: "spring", stiffness: 500, damping: 30 }} />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{label}</span>
        {hint ? <span className="mt-0.5 block text-xs" style={{ color: "var(--t-muted)" }}>{hint}</span> : null}
      </span>
    </button>
  );
}

/** Lista de valores tipo «chips» (responsabilidades del RUT, actividades CIIU…). */
export function ChipsInput({ values, onChange, suggestions = [], placeholder, normalize = (v) => v.trim().toUpperCase(), validate }: {
  values: string[]; onChange: (v: string[]) => void; suggestions?: Array<[string, string]>; placeholder?: string;
  normalize?: (v: string) => string; validate?: (v: string) => string | null;
}) {
  const [draft, setDraft] = useState("");
  const [err, setErr] = useState<string | null>(null);
  function add(raw: string) {
    const v = normalize(raw);
    if (!v) return;
    const problem = validate?.(v) ?? null;
    if (problem) return setErr(problem);
    setErr(null);
    if (!values.includes(v)) onChange([...values, v]);
    setDraft("");
  }
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5 rounded-xl border p-2" style={inputStyle}>
        {values.map((v) => (
          <span key={v} className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold" style={{ background: "color-mix(in oklab, var(--t-accent) 16%, transparent)" }}>
            {v}
            <button type="button" aria-label={`Quitar ${v}`} onClick={() => onChange(values.filter((x) => x !== v))} className="opacity-70 hover:opacity-100"><X size={12} /></button>
          </span>
        ))}
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              add(draft);
            } else if (e.key === "Backspace" && !draft && values.length) onChange(values.slice(0, -1));
          }}
          onBlur={() => draft && add(draft)}
          placeholder={values.length ? "" : placeholder}
          className="min-w-24 flex-1 bg-transparent px-1 py-1 text-sm outline-none"
        />
      </div>
      {err ? <p className="text-[11px] text-red-500">{err}</p> : null}
      {suggestions.length ? (
        <div className="flex flex-wrap gap-1.5">
          {suggestions.filter(([v]) => !values.includes(v)).map(([v, label]) => (
            <button key={v} type="button" onClick={() => add(v)} className="rounded-full border px-2.5 py-1 text-[11px] font-semibold transition hover:-translate-y-0.5" style={{ borderColor: "var(--t-card-border)" }} title={label}>
              + {v} <span style={{ color: "var(--t-muted)" }}>{label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function Stat({ label, value, tone, hint, icon }: { label: string; value: ReactNode; tone?: FiscalTone; hint?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="rounded-2xl border px-4 py-3" style={{ borderColor: tone ? TONE[tone].border : "var(--t-card-border)", background: tone ? TONE[tone].bg : "transparent" }}>
      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--t-muted)" }}>{icon}{label}</p>
      <p className="mt-0.5 text-lg font-black tabular-nums" style={{ color: tone ? TONE[tone].fg : "var(--t-text)" }}>{value}</p>
      {hint ? <p className="text-[11px]" style={{ color: "var(--t-muted)" }}>{hint}</p> : null}
    </div>
  );
}

export function Progress({ value, tone = "info" }: { value: number; tone?: FiscalTone }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full" style={{ background: "color-mix(in oklab, var(--t-text) 10%, transparent)" }}>
      <motion.div className="h-full rounded-full" style={{ background: TONE[tone].fg }} initial={{ width: 0 }} animate={{ width: `${Math.max(0, Math.min(100, value))}%` }} transition={{ duration: 0.6, ease: "easeOut" }} />
    </div>
  );
}

export function CopyButton({ text, label = "Copiar" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      variant="soft"
      icon={done ? <Check size={14} /> : <Copy size={14} />}
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        });
      }}
    >
      {done ? "Copiado" : label}
    </Button>
  );
}

export async function askReasonDialog(title: string, text?: string, placeholder = "Motivo (queda en la auditoría)") {
  const res = await Swal.fire({
    ...swal,
    title,
    text,
    input: "text",
    inputPlaceholder: placeholder,
    showCancelButton: true,
    confirmButtonText: "Continuar",
    cancelButtonText: "Cancelar",
    inputValidator: (v) => (v.trim().length >= 5 ? null : "Escribe el motivo (mínimo 5 caracteres)."),
  });
  return res.isConfirmed ? String(res.value).trim() : null;
}

export async function confirmDialog(title: string, text: string, confirmText = "Confirmar", danger = false) {
  const res = await Swal.fire({
    ...swal,
    icon: danger ? "warning" : "question",
    title,
    html: text,
    showCancelButton: true,
    confirmButtonText: confirmText,
    cancelButtonText: "Cancelar",
    confirmButtonColor: danger ? "#ef4444" : swal.confirmButtonColor,
  });
  return res.isConfirmed;
}

export function notify(title: string, icon: "success" | "error" | "warning" | "info" = "success", text?: string) {
  if (icon === "success" || icon === "info") {
    return Swal.fire({ ...swal, toast: true, position: "top-end", icon, title, text, timer: 2600, showConfirmButton: false, timerProgressBar: true });
  }
  return Swal.fire({ ...swal, icon, title, text });
}
