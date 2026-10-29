"use client";

/**
 * Con varias pestañas de RemHub abiertas, cada una se entera del mismo aviso; solo una debe sonar.
 * Gana la pestaña que estás mirando (sin espera); las de atrás esperan un poco y, si otra ya sonó, se callan.
 * El acuerdo se hace con un candado del navegador (Web Locks) y una marca en localStorage compartida.
 */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function claim(key: string, windowMs: number) {
  try {
    const k = `remhub:snd:${key}`;
    const last = Number(localStorage.getItem(k) || 0);
    if (Date.now() - last < windowMs) return false;
    localStorage.setItem(k, String(Date.now()));
    return true;
  } catch {
    return true; // sin almacenamiento: mejor que suene
  }
}

/** Ejecuta `play` en una sola pestaña para este aviso (`key`) dentro de `windowMs`. Devuelve si sonó aquí. */
export async function inOneTab(key: string, play: () => void, windowMs = 2500): Promise<boolean> {
  if (typeof window === "undefined") return false;
  const front = document.visibilityState === "visible" && document.hasFocus();
  // La pestaña al frente gana; una visible sin foco, después; las de atrás, de últimas.
  await sleep(front ? 0 : document.visibilityState === "visible" ? 150 : 350 + Math.random() * 120);
  const locks = (navigator as Navigator & { locks?: { request: (name: string, cb: () => Promise<boolean> | boolean) => Promise<boolean> } }).locks;
  const won = locks ? await locks.request("remhub-sound", () => claim(key, windowMs)).catch(() => claim(key, windowMs)) : claim(key, windowMs);
  if (won) play();
  return won;
}
