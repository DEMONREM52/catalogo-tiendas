"use client";

import { MotionConfig } from "framer-motion";
import { CartProvider } from "../lib/cart/CartProvider";
import { ThemeControl } from "@/components/ThemeControl";
import { PwaProvider } from "@/components/pwa/PwaProvider";
import { RecoveryRedirect } from "@/components/RecoveryRedirect";

export default function Providers({ children }: { children: React.ReactNode }) {
  // reducedMotion="user": si el celular o el computador pide «reducir movimiento», las animaciones se quitan.
  return (
    <MotionConfig reducedMotion="user">
      <CartProvider>
        {children}
        <ThemeControl />
        <PwaProvider />
        <RecoveryRedirect />
      </CartProvider>
    </MotionConfig>
  );
}
