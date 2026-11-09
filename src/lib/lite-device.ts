/**
 * Celulares de pocos recursos (≤ 4 GB de memoria, ≤ 4 núcleos o «ahorro de datos»): el panel quita el vidrio
 * (backdrop-filter), el fondo animado, la luz del mouse y las animaciones de movimiento para que el POS
 * responda rápido. Se calcula una vez y se marca con la clase `lite` en <html>.
 */
let cached: boolean | null = null;

export function isLiteDevice(): boolean {
  if (cached !== null) return cached;
  if (typeof window === "undefined") return false;
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  const coarse = window.matchMedia?.("(pointer: coarse)").matches ?? false;
  const lowMem = typeof nav.deviceMemory === "number" && nav.deviceMemory <= 4;
  const fewCores = typeof nav.hardwareConcurrency === "number" && nav.hardwareConcurrency > 0 && nav.hardwareConcurrency <= 4;
  const saveData = Boolean(nav.connection?.saveData);
  cached = saveData || (coarse && (lowMem || fewCores));
  return cached;
}

/** Pone la clase `lite` en <html> (solo una vez). */
export function markLiteDevice() {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("lite", isLiteDevice());
}
