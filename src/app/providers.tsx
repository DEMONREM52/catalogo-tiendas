"use client";

import { LazyMotion, MotionConfig } from "framer-motion";
import { CartProvider } from "../lib/cart/CartProvider";
import { ThemeControl } from "@/components/ThemeControl";
import { PwaProvider } from "@/components/pwa/PwaProvider";
import { RecoveryRedirect } from "@/components/RecoveryRedirect";

// Las funciones de animación llegan en un archivo aparte, apenas carga la página (ver lib/motion-features.ts):
// la página se puede usar antes y en celulares sencillos abre más rápido.
const loadMotion = () => import("@/lib/motion-features").then((m) => m.default);

export default function Providers({ children }: { children: React.ReactNode }) {
  // reducedMotion="user": si el celular o el computador pide «reducir movimiento», las animaciones se quitan.
  return (
    <MotionConfig reducedMotion="user">
      <LazyMotion features={loadMotion}>
        <CartProvider>
          {children}
          <ThemeControl />
          <PwaProvider />
          <RecoveryRedirect />
        </CartProvider>
      </LazyMotion>
    </MotionConfig>
  );
}
