/**
 * Recuperación de contraseña.
 * El enlace del correo SIEMPRE abre la versión publicada (remhub.store), aunque se pida desde
 * otro dominio o desde el computador del desarrollador: así nunca llega un enlace a localhost.
 */
export const PRODUCTION_ORIGIN = "https://remhub.store";
export const RECOVERY_URL = `${PRODUCTION_ORIGIN}/reset-password`;
/** Segundos de espera antes de pedir otro correo (Supabase también limita los envíos). */
export const RESEND_SECONDS = 60;

export function isProductionOrigin(origin: string) {
  return origin === PRODUCTION_ORIGIN || origin === "https://www.remhub.store";
}

/** Errores de Supabase Auth → mensajes claros en español. */
export function authErrorText(message: string | null | undefined): string {
  const m = String(message ?? "");
  if (/only request this after (\d+) seconds?/i.test(m)) return `Por seguridad espera ${m.match(/after (\d+)/i)?.[1]} segundos antes de pedir otro correo.`;
  if (/rate limit|too many|over_email_send_rate_limit/i.test(m)) return "Se enviaron demasiados correos. Espera unos minutos y vuelve a intentarlo.";
  if (/should be different|same_password/i.test(m)) return "La nueva contraseña debe ser distinta a la anterior.";
  if (/at least (\d+) characters/i.test(m)) return `La contraseña debe tener al menos ${m.match(/at least (\d+)/i)?.[1]} caracteres.`;
  if (/weak|pwned|leaked|known to be/i.test(m)) return "Esa contraseña es muy común o apareció en filtraciones. Elige otra.";
  if (/expired|invalid|otp|token|flow state|code verifier|auth session missing|session_not_found/i.test(m)) return "El enlace venció o ya se usó. Pide un correo nuevo.";
  if (/invalid email|unable to validate email|email address .* invalid/i.test(m)) return "Ese correo no es válido.";
  if (/failed to fetch|network|load failed/i.test(m)) return "Sin conexión. Revisa tu internet e intenta de nuevo.";
  if (/smtp|sending (recovery )?email|error sending/i.test(m)) return "No se pudo enviar el correo en este momento. Intenta más tarde o escríbele a soporte.";
  return m || "Ocurrió un error. Intenta de nuevo.";
}

export const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());
