"use client";

import React, { createContext, useContext, useMemo, useState } from "react";
import { CartItem, CartMode, CartState } from "./types";
import { clearCart, loadCart, saveCart } from "./storage";

type CartCtx = {
  cart: (CartState & { customerName?: string; customerNote?: string }) | null;
  isOpen: boolean;
  open: () => void;
  close: () => void;

  initCart: (s: {
    storeId: string;
    storeSlug: string;
    storeName: string;
    whatsapp: string;
    mode: CartMode;
  }) => void;

  addItem: (item: CartItem, opts?: { openDrawer?: boolean }) => void;
  setQty: (productId: string, qty: number) => void;
  removeItem: (productId: string) => void;
  empty: () => void;

  // ✅ NUEVO
  setCustomerName: (name: string) => void;
  setCustomerNote: (note: string) => void;

  total: number;
  count: number;
};

const Ctx = createContext<CartCtx | null>(null);

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [cart, setCart] = useState<(CartState & { customerName?: string; customerNote?: string }) | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  function open() {
    setIsOpen(true);
  }

  function close() {
    setIsOpen(false);
  }

  function initCart(s: {
    storeId: string;
    storeSlug: string;
    storeName: string;
    whatsapp: string;
    mode: CartMode;
  }) {
    const existing = loadCart(s.storeId, s.mode);
    if (existing) {
      // ✅ asegura campos nuevos
      setCart({
        ...(existing as any),
        customerName: (existing as any).customerName ?? "",
        customerNote: (existing as any).customerNote ?? "",
      });
      return;
    }

    const fresh = { ...s, items: [], customerName: "", customerNote: "" };
    setCart(fresh as any);
    saveCart(fresh as any);
  }

  function update(next: any) {
    setCart(next);
    saveCart(next);
  }

  function addItem(item: CartItem, opts?: { openDrawer?: boolean }) {
    if (!cart) return;

    const idx = cart.items.findIndex((i) => i.productId === item.productId);
    const items = [...cart.items];

    const min = cart.mode === "mayor" ? (item.minWholesale ?? null) : null;
    const baseQty = min ? Math.max(item.qty, min) : item.qty;

    if (idx >= 0) {
      const current = items[idx];
      const newQty = current.qty + baseQty;
      items[idx] = { ...current, qty: min ? Math.max(newQty, min) : newQty };
    } else {
      items.push({ ...item, qty: baseQty });
    }

    update({ ...cart, items });

    if (opts?.openDrawer) open();
  }

  function setQty(productId: string, qty: number) {
    if (!cart) return;

    const items = cart.items
      .map((i) => {
        if (i.productId !== productId) return i;

        const safeQty = Math.max(0, Math.floor(qty || 0));
        const min = cart.mode === "mayor" ? (i.minWholesale ?? null) : null;
        const finalQty = min ? Math.max(safeQty, min) : safeQty;

        return { ...i, qty: finalQty };
      })
      .filter((i) => i.qty > 0);

    update({ ...cart, items });
  }

  function removeItem(productId: string) {
    if (!cart) return;
    update({ ...cart, items: cart.items.filter((i) => i.productId !== productId) });
  }

  function empty() {
    if (!cart) return;
    clearCart(cart.storeId, cart.mode);
    update({ ...cart, items: [] });
  }

  // ✅ NUEVO: setters de cliente
  function setCustomerName(name: string) {
    if (!cart) return;
    update({ ...cart, customerName: name });
  }

  function setCustomerNote(note: string) {
    if (!cart) return;
    update({ ...cart, customerNote: note });
  }

  const total = useMemo(
    () => (cart?.items ?? []).reduce((a, i) => a + i.price * i.qty, 0),
    [cart]
  );

  const count = useMemo(
    () => (cart?.items ?? []).reduce((a, i) => a + i.qty, 0),
    [cart]
  );

  const value: CartCtx = {
    cart,
    isOpen,
    open,
    close,
    initCart,
    addItem,
    setQty,
    removeItem,
    empty,
    setCustomerName,
    setCustomerNote,
    total,
    count,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCart() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useCart debe usarse dentro de CartProvider");
  return v;
}
