"use client";

import { motion } from "framer-motion";

type Level = { score: 0 | 1 | 2 | 3 | 4; label: string; color: string; tip: string };

const LEVELS: Array<Omit<Level, "score" | "tip">> = [
  { label: "Muy débil", color: "#ef4444" },
  { label: "Débil", color: "#f97316" },
  { label: "Aceptable", color: "#eab308" },
  { label: "Fuerte", color: "#84cc16" },
  { label: "Muy fuerte", color: "#16a34a" },
];

const COMMON = ["1234", "12345", "123456", "1234567", "12345678", "0000", "1111", "1212", "4321", "password", "contrasena", "clave", "qwerty", "abc123", "admin", "tienda", "remhub"];

/** Qué tan difícil de adivinar es una contraseña (0 a 4). Solo orienta: no obliga a nada. */
export function passwordStrength(password: string, hints: Array<string | null | undefined> = []): Level {
  const p = password;
  const lower = p.toLowerCase();
  const kinds = [/[a-z]/.test(p), /[A-Z]/.test(p), /\d/.test(p), /[^A-Za-z0-9]/.test(p)].filter(Boolean).length;

  let points = 0;
  points += Math.min(p.length, 16) * 4; // largo (lo que más cuenta)
  points += (kinds - 1) * 10; // mezcla de letras, mayúsculas, números y símbolos
  if (p.length >= 12) points += 10;

  // Patrones fáciles de adivinar.
  const repeated = /^(.)\1+$/.test(p) || /(.)\1{2,}/.test(p);
  const sequence = /0123|1234|2345|3456|4567|5678|6789|7890|9876|8765|7654|6543|5432|4321|abcd|bcde|qwer|asdf/i.test(p);
  // Común: es la palabra tal cual o casi solo eso (ej. «clave1»); dentro de una frase larga no cuenta.
  const common = COMMON.some((w) => lower === w || (w.length >= 5 && lower.includes(w) && p.length <= w.length + 3));
  const personal = hints.some((h) => {
    const v = (h ?? "").toLowerCase().replace(/\s+/g, "");
    return v.length >= 3 && lower.includes(v);
  });
  const onlyDigits = /^\d+$/.test(p);
  if (repeated) points -= 25;
  if (sequence) points -= 20;
  if (common) points -= 35;
  if (personal) points -= 20;
  if (onlyDigits) points -= 10;

  const score = (!p ? 0 : points < 25 ? 0 : points < 40 ? 1 : points < 55 ? 2 : points < 72 ? 3 : 4) as Level["score"];
  const tip =
    common ? "Es una contraseña muy común: fácil de adivinar."
    : personal ? "Contiene el nombre o el usuario: mejor evitarlo."
    : repeated || sequence ? "Tiene números o letras seguidos o repetidos."
    : score >= 4 ? "Excelente: difícil de adivinar."
    : p.length < 8 ? "Más larga es más segura (8 o más caracteres)."
    : kinds < 3 ? "Mezcla mayúsculas, minúsculas, números o símbolos para hacerla más fuerte."
    : "Buena. Un poco más larga la haría aún más segura.";
  return { score, ...LEVELS[score], tip };
}

/** Barra que muestra qué tan segura es la contraseña mientras se escribe. */
export function PasswordStrength({ password, hints, className = "" }: { password: string; hints?: Array<string | null | undefined>; className?: string }) {
  if (!password) return null;
  const level = passwordStrength(password, hints);
  return (
    <div className={`mt-2 ${className}`} aria-live="polite">
      <div className="grid grid-cols-5 gap-1">
        {[0, 1, 2, 3, 4].map((i) => (
          <span key={i} className="h-1.5 overflow-hidden rounded-full" style={{ background: "color-mix(in oklab, var(--t-text, #888) 12%, transparent)" }}>
            <motion.span
              className="block h-full rounded-full"
              initial={false}
              animate={{ width: i <= level.score ? "100%" : "0%", backgroundColor: level.color }}
              transition={{ duration: 0.35, ease: "easeOut", delay: i * 0.04 }}
            />
          </span>
        ))}
      </div>
      <p className="mt-1 flex flex-wrap items-baseline gap-x-1.5 text-[11px]">
        <b style={{ color: level.color }}>{level.label}</b>
        <span style={{ color: "var(--t-muted, #888)" }}>· {level.tip}</span>
      </p>
    </div>
  );
}
