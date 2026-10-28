// Código de prueba de la API de Conversiones (sin dependencias: lo usan el servidor y el panel).
// Con código, Meta deja los eventos en «Probar eventos» y no los usa para medir ni optimizar anuncios:
// si se olvida quitarlo, los pedidos reales no cuentan. Por eso vence solo.

export const CAPI_TEST_HOURS = 24;

/** Hasta cuándo vale el código de prueba guardado (null si no hay o ya venció). */
export function testCodeUntil(code: string | null | undefined, savedAt: string | null | undefined, now = Date.now()): Date | null {
  if (!code || !savedAt) return null;
  const until = Date.parse(savedAt) + CAPI_TEST_HOURS * 3_600_000;
  return Number.isFinite(until) && now < until ? new Date(until) : null;
}

/** El código de prueba guardado, solo mientras no haya vencido. */
export function activeTestCode(code: string | null | undefined, savedAt: string | null | undefined, now = Date.now()) {
  return testCodeUntil(code, savedAt, now) ? code ?? null : null;
}
