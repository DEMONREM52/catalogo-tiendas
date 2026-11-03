"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";

/**
 * Esqueletos de carga: dibujan la forma del contenido que viene (no una pantalla vacía ni un «Cargando…»).
 * Lo de los lectores de pantalla va en `label` (role="status"), lo visual es decorativo.
 */

export function Skeleton({ className = "", style }: { className?: string; style?: CSSProperties }) {
  return <span aria-hidden className={`skeleton block ${className}`} style={style} />;
}

function Status({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true" className={className}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

/** Lista de filas con avatar o foto (chats, pedidos, productos). */
export function SkeletonList({ rows = 6, avatar = true, label = "Cargando…", className = "" }: { rows?: number; avatar?: boolean; label?: string; className?: string }) {
  return (
    <Status label={label} className={`space-y-2 ${className}`}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-2xl p-2.5">
          {avatar ? <Skeleton className="h-11 w-11 shrink-0 rounded-full" /> : null}
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-3.5" style={{ width: `${70 - ((i * 13) % 30)}%` }} />
            <Skeleton className="h-3" style={{ width: `${45 - ((i * 7) % 20)}%` }} />
          </div>
        </div>
      ))}
    </Status>
  );
}

/** Tarjetas en cuadrícula (pedidos internos, catálogos, tableros). */
export function SkeletonCards({ count = 4, label = "Cargando…", className = "" }: { count?: number; label?: string; className?: string }) {
  return (
    <Status label={label} className={`grid gap-3 sm:grid-cols-2 ${className}`}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="space-y-3 rounded-2xl border p-4" style={{ borderColor: "var(--t-card-border)" }}>
          <div className="flex gap-2"><Skeleton className="h-5 w-12 rounded-full" /><Skeleton className="h-5 w-20 rounded-full" /></div>
          <Skeleton className="h-5 w-4/5" />
          <Skeleton className="h-3.5 w-3/5" />
          <Skeleton className="h-10 w-full rounded-xl" />
        </div>
      ))}
    </Status>
  );
}

/** Cifras arriba + tarjetas (inicio del panel y tableros). */
export function SkeletonDashboard({ label = "Cargando el panel…" }: { label?: string }) {
  return (
    <Status label={label} className="space-y-4">
      <Skeleton className="h-8 w-56" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="space-y-3 rounded-2xl border p-4" style={{ borderColor: "var(--t-card-border)" }}>
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="h-7 w-16" />
            <Skeleton className="h-3 w-28" />
          </div>
        ))}
      </div>
      <SkeletonCards count={4} label={label} />
    </Status>
  );
}

/** Tabla: encabezado y filas. */
export function SkeletonTable({ rows = 8, cols = 5, label = "Cargando…" }: { rows?: number; cols?: number; label?: string }) {
  return (
    <Status label={label} className="overflow-hidden rounded-2xl border" >
      <div className="grid gap-3 border-b p-3" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, borderColor: "var(--t-card-border)" }}>
        {Array.from({ length: cols }, (_, i) => <Skeleton key={i} className="h-3.5 w-2/3" />)}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="grid gap-3 p-3" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
          {Array.from({ length: cols }, (_, c) => <Skeleton key={c} className="h-3.5" style={{ width: `${55 + ((r + c) * 11) % 40}%` }} />)}
        </div>
      ))}
    </Status>
  );
}

/** Conversación: burbujas a los dos lados. */
export function SkeletonChat({ label = "Cargando la conversación…" }: { label?: string }) {
  return (
    <Status label={label} className="space-y-3 py-2">
      {[62, 40, 70, 34, 55].map((w, i) => (
        <div key={i} className={`flex ${i % 2 ? "justify-end" : "justify-start"}`}>
          <Skeleton className="h-12 rounded-2xl" style={{ width: `${w}%` }} />
        </div>
      ))}
    </Status>
  );
}

/**
 * Muestra el esqueleto solo si la carga tarda (por defecto 250 ms): lo que carga rápido no parpadea.
 */
export function Deferred({ children, delay = 250 }: { children: ReactNode; delay?: number }) {
  const [show, setShow] = useState(false);
  useEffect(() => { const t = window.setTimeout(() => setShow(true), delay); return () => window.clearTimeout(t); }, [delay]);
  return show ? <>{children}</> : null;
}
