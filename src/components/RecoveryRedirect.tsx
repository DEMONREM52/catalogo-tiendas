"use client";

import { useEffect } from "react";

/**
 * Si un enlace de recuperación de contraseña cae en otra página (por ejemplo en la página de inicio,
 * porque Supabase usó la «Site URL»), lo lleva a /reset-password sin perder los datos del enlace.
 * Solo reacciona a enlaces de recuperación o a sus errores; no toca ningún otro inicio de sesión.
 */
export function RecoveryRedirect() {
  useEffect(() => {
    const { pathname, search, hash } = window.location;
    if (pathname.startsWith("/reset-password")) return;
    const h = new URLSearchParams(hash.replace(/^#/, ""));
    const q = new URLSearchParams(search);
    const isRecovery =
      (h.get("type") === "recovery" && h.get("access_token")) ||
      (q.get("type") === "recovery" && q.get("token_hash")) ||
      // Errores típicos del enlace del correo (vencido o ya usado).
      /otp_expired|access_denied/.test(h.get("error_code") ?? "") ||
      (h.get("error") === "access_denied" && /link/i.test(h.get("error_description") ?? ""));
    if (isRecovery) window.location.replace(`/reset-password${search}${hash}`);
  }, []);
  return null;
}
