"use client";

/**
 * ¿Qué tanto aguanta este celular o computador para la búsqueda por foto?
 *
 *  · weak: poca memoria (≤ 2 GB), pocos núcleos (≤ 4), sin WebAssembly SIMD, o se cayó la pestaña la última vez
 *    que analizó una foto aquí. Para estos, la huella de la foto la calcula RemHub («modo liviano») y el texto de
 *    la foto se lee solo si se pide.
 *  · saveData / slowNet: ahorro de datos activado o red lenta: no se descarga nada pesado en segundo plano.
 *
 * La persona puede forzar el modo liviano (se guarda en este navegador).
 */

const FORCE_KEY = "remhub:photo-lite";
const CRASH_KEY = "remhub:photo-local-running";

type Nav = Navigator & { deviceMemory?: number; connection?: { saveData?: boolean; effectiveType?: string } };

export type DeviceProfile = {
  /** El modelo puede correr en este navegador (WebAssembly con SIMD). */
  localPossible: boolean;
  weak: boolean;
  saveData: boolean;
  slowNet: boolean;
  /** Computador con mouse (aquí sí conviene preparar el modelo solo). */
  desktop: boolean;
  /** La persona activó el modo liviano a mano. */
  forcedLite: boolean;
  /** Por qué se considera lento (para mostrarlo). */
  reason: string | null;
};

let simd: boolean | null = null;
function wasmSimd() {
  if (simd !== null) return simd;
  try {
    simd = typeof WebAssembly === "object" && WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]));
  } catch {
    simd = false;
  }
  return simd;
}

function read(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* sin almacenamiento */
  }
}

export function deviceProfile(): DeviceProfile {
  if (typeof window === "undefined") return { localPossible: false, weak: true, saveData: false, slowNet: false, desktop: false, forcedLite: false, reason: null };
  const nav = navigator as Nav;
  const memory = nav.deviceMemory;
  const cores = nav.hardwareConcurrency;
  const conn = nav.connection;
  const localPossible = wasmSimd() && typeof createImageBitmap === "function";
  // Se recuerda 14 días (por si fue que cerraron la pestaña a mitad del análisis).
  const crashedAt = Number(read(CRASH_KEY) ?? 0);
  const crashed = crashedAt > 0 && Date.now() - crashedAt < 14 * 86_400_000;
  const reason = !localPossible ? "este navegador no puede correr el modelo"
    : crashed ? "la última vez la foto no alcanzó a analizarse aquí"
    : memory !== undefined && memory <= 2 ? "poca memoria"
    : cores !== undefined && cores > 0 && cores <= 4 ? "procesador sencillo"
    : null;
  return {
    localPossible,
    weak: reason !== null,
    saveData: Boolean(conn?.saveData),
    slowNet: /(^|-)2g|3g/.test(conn?.effectiveType ?? ""),
    desktop: window.matchMedia?.("(pointer: fine)").matches ?? false,
    forcedLite: read(FORCE_KEY) === "1",
    reason,
  };
}

export function setForcedLite(on: boolean) {
  write(FORCE_KEY, on ? "1" : null);
}

/**
 * Marca «analizando aquí» mientras el modelo corre en el navegador: si la pestaña se cae por memoria,
 * la marca queda y la próxima vez se usa el modo liviano sin preguntar.
 */
export function markLocalRun(running: boolean) {
  write(CRASH_KEY, running ? String(Date.now()) : null);
}
