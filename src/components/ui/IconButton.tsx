"use client";

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Loader2, X } from "lucide-react";

/**
 * Botón de solo ícono, accesible: el dibujo puede ser pequeño, pero el área que responde al toque mide al menos
 * 44 × 44 (clase tap-target) y siempre tiene nombre para lectores de pantalla (`label`).
 *   size: "sm" se ve de 36 px, "md" de 40 px, "lg" de 44 px (en el celular, todos responden en 44 px o más).
 */
type Tone = "neutral" | "accent" | "danger" | "success" | "ghost";
const TONE: Record<Tone, React.CSSProperties> = {
  neutral: { borderColor: "var(--t-card-border)", color: "var(--t-text)" },
  ghost: { borderColor: "transparent", color: "var(--t-text)" },
  accent: { borderColor: "transparent", background: "var(--t-accent)", color: "#fff" },
  danger: { borderColor: "color-mix(in oklab, #ef4444 40%, transparent)", color: "#ef4444" },
  success: { borderColor: "transparent", background: "#16a34a", color: "#fff" },
};
const SIZE = { sm: "h-9 w-9", md: "h-10 w-10", lg: "h-11 w-11" } as const;

export type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  label: string; icon: ReactNode; size?: keyof typeof SIZE; tone?: Tone; loading?: boolean;
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, size = "md", tone = "neutral", loading, disabled, className = "", style, type = "button", ...rest }, ref,
) {
  return (
    <button ref={ref} type={type} aria-label={label} title={rest.title ?? label} disabled={disabled || loading} aria-busy={loading || undefined}
      className={`tap-target grid ${SIZE[size]} shrink-0 place-items-center rounded-full border transition hover:-translate-y-0.5 hover:brightness-110 active:scale-95 disabled:pointer-events-none disabled:opacity-40 ${className}`}
      style={{ ...TONE[tone], ...style }} {...rest}>
      {loading ? <Loader2 size={18} className="animate-spin" aria-hidden /> : <span aria-hidden className="grid place-items-center">{icon}</span>}
    </button>
  );
});

/** Botón de cerrar de modales y paneles: X de 20 px, área de 44 px, siempre con «Cerrar». */
export function CloseButton({ onClick, label = "Cerrar", className = "" }: { onClick: () => void; label?: string; className?: string }) {
  return <IconButton label={label} icon={<X size={20} />} size="lg" onClick={onClick} className={`hover:rotate-90 ${className}`} />;
}
