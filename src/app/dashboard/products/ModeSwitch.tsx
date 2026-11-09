"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { LayoutGrid, Radar } from "lucide-react";

/** Interruptor entre la vista sencilla de productos y el Radar (súper administración). */
export function ProductsModeSwitch({ mode }: { mode: "simple" | "radar" }) {
  const items = [
    { key: "simple", href: "/dashboard/products", label: "Sencilla", icon: <LayoutGrid size={14} />, color: "var(--t-accent)" },
    { key: "radar", href: "/dashboard/products/radar", label: "Radar", icon: <Radar size={14} />, color: "#10b981" },
  ] as const;
  return (
    <div role="tablist" aria-label="Modo de productos" className="relative inline-flex rounded-2xl border p-1" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg-soft, transparent)" }}>
      {items.map((it) => {
        const on = it.key === mode;
        return (
          <Link key={it.key} href={it.href} role="tab" aria-selected={on} className="relative inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-black"
            style={{ color: on ? "#fff" : "var(--t-muted)" }} title={it.key === "radar" ? "Radar: falencias, publicaciones y productos quietos" : "Vista sencilla de siempre"}>
            {on ? <motion.span layoutId="products-mode" className="absolute inset-0 rounded-xl" style={{ background: it.color }} transition={{ type: "spring", stiffness: 420, damping: 32 }} /> : null}
            <span className="relative">{it.key === "radar" && !on ? <motion.span className="inline-grid" animate={{ rotate: 360 }} transition={{ duration: 6, repeat: Infinity, ease: "linear" }}>{it.icon}</motion.span> : it.icon}</span>
            <span className="relative">{it.label}</span>
          </Link>
        );
      })}
    </div>
  );
}
