"use client";

import { CartProvider } from "../lib/cart/CartProvider";
import { ThemeControl } from "@/components/ThemeControl";

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <CartProvider>
      {children}
      <ThemeControl />
    </CartProvider>
  );
}
