import { CartState } from "./types";

export function cartKey(storeId: string, mode: string) {
  return `cart:${storeId}:${mode}`;
}

export function loadCart(storeId: string, mode: string): CartState | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(cartKey(storeId, mode));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CartState;
  } catch {
    return null;
  }
}

export function saveCart(state: CartState) {
  if (typeof window === "undefined") return;
  localStorage.setItem(cartKey(state.storeId, state.mode), JSON.stringify(state));
}

export function clearCart(storeId: string, mode: string) {
  if (typeof window === "undefined") return;
  localStorage.removeItem(cartKey(storeId, mode));
}
