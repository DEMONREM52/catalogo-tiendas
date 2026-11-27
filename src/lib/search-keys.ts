"use client";

import { useState, type KeyboardEvent } from "react";

/**
 * Teclas de los buscadores con lista de resultados (2026-11-27, pedido del usuario).
 *
 * Escribir —o pistolear con el lector de códigos— SOLO escribe y busca; nunca elige.
 *   · Enter sin haber bajado con las flechas → busca ya lo escrito (no agrega nada).
 *   · ↓ / ↑ → marcan un resultado; ahí sí, Enter lo elige.
 *   · Clic en un resultado → lo elige.
 *   · Escribir otra cosa → se desmarca (hay que volver a bajar con las flechas).
 *
 * Motivo: el lector escribe el código y manda Enter enseguida; con la búsqueda aún en camino,
 * Enter elegía el primero de la lista anterior (otro producto).
 */
export type PickKeysState = { index: number; armed: boolean };
export type PickKeyResult = { state: PickKeysState; action: "none" | "pick" | "search" | "escape"; handled: boolean };

export const PICK_KEYS_START: PickKeysState = { index: 0, armed: false };

/** Lógica pura (probada en tests/search/pick-keys.test.ts). */
export function pickKeyReduce(state: PickKeysState, key: string, count: number): PickKeyResult {
  const armed = state.armed && count > 0;
  const index = count ? Math.min(Math.max(state.index, 0), count - 1) : 0;
  if (key === "ArrowDown") {
    if (!count) return { state, action: "none", handled: true };
    return { state: { index: armed ? (index + 1) % count : 0, armed: true }, action: "none", handled: true };
  }
  if (key === "ArrowUp") {
    if (!count) return { state, action: "none", handled: true };
    return { state: { index: armed ? (index - 1 + count) % count : count - 1, armed: true }, action: "none", handled: true };
  }
  if (key === "Enter") {
    if (armed) return { state: PICK_KEYS_START, action: "pick", handled: true };
    return { state, action: "search", handled: true };
  }
  if (key === "Escape") return { state: PICK_KEYS_START, action: "escape", handled: false };
  return { state, action: "none", handled: false };
}

/**
 * Hook para un input con lista: `onKeyDown` en el input, `reset()` al cambiar el texto,
 * `active` es el índice marcado con las flechas (−1 si no hay ninguno: no se resalta nada).
 */
export function usePickKeys(
  count: number,
  onPick: (index: number) => void,
  opts?: { onSearch?: () => void; onEscape?: () => void },
) {
  const [state, setState] = useState<PickKeysState>(PICK_KEYS_START);
  const armed = state.armed && count > 0;
  const index = count ? Math.min(state.index, count - 1) : 0;
  type Handlers = { onPick?: (index: number) => void; onSearch?: () => void; onEscape?: () => void };
  /** `over`: para cuando lo que hacer al elegir solo se conoce en el JSX. */
  function onKeyDown(e: KeyboardEvent<HTMLElement>, over?: Handlers) {
    // Composición de teclado (tildes en móvil): no tocar.
    if (e.nativeEvent.isComposing) return;
    const r = pickKeyReduce({ index, armed }, e.key, count);
    if (r.handled) e.preventDefault();
    if (r.state !== state) setState(r.state);
    const h = { onPick, ...opts, ...over };
    if (r.action === "pick") h.onPick?.(index);
    else if (r.action === "search") h.onSearch?.();
    else if (r.action === "escape") h.onEscape?.();
  }
  return {
    /** Índice marcado con las flechas; −1 si no hay ninguno. */
    active: armed ? index : -1,
    onKeyDown,
    /** Llamar al cambiar lo escrito: se desmarca. */
    reset: () => setState(PICK_KEYS_START),
    /** Con el mouse: solo mueve la marca si ya se venía usando el teclado (pasar el mouse no deja nada listo para Enter). */
    hover: (i: number) => { if (armed && i !== index) setState({ index: i, armed: true }); },
  };
}
