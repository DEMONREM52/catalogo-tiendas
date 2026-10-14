"use client";

import { CartProvider } from "../lib/cart/CartProvider";
import { ThemeControl } from "@/components/ThemeControl";
import { PwaProvider } from "@/components/pwa/PwaProvider";
import { RecoveryRedirect } from "@/components/RecoveryRedirect";

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <CartProvider>
      {children}
      <ThemeControl />
      <PwaProvider />
      <RecoveryRedirect />
    </CartProvider>
  );
}
