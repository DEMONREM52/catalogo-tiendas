"use client";

/** Ajustes públicos de «Envío gratis desde $X» (20261312). Solo anima: no cobra ni descuenta nada. */
export type ShippingCfg = { min: number; missing: string; done: string; line: string; icon: string; color: string };

const money = (n: number) => `$${Math.round(Number(n) || 0).toLocaleString("es-CO")}`;

export function shippingReached(total: number, cfg: ShippingCfg | null | undefined) {
  return Boolean(cfg && cfg.min > 0 && total >= cfg.min);
}

export function ShippingBar({ total, cfg }: { total: number; cfg: ShippingCfg }) {
  if (!(cfg.min > 0)) return null;
  const pct = Math.max(4, Math.min(100, Math.round((total / cfg.min) * 100)));
  const done = total >= cfg.min;
  const text = done ? cfg.done : cfg.missing.replaceAll("{falta}", money(cfg.min - total));
  return (
    <div className={`ship-bar rounded-2xl border px-3 py-2.5 ${done ? "ship-bar-done" : ""}`}
      style={{ borderColor: `color-mix(in oklab, ${cfg.color} 45%, transparent)`, background: `color-mix(in oklab, ${cfg.color} 10%, transparent)`, ["--ship" as string]: cfg.color }}
      role="status" aria-live="polite">
      <p className="flex items-center gap-2 text-[13px] font-extrabold leading-tight">
        <span className={`ship-truck inline-block text-lg ${done ? "ship-truck-go" : ""}`} aria-hidden>{cfg.icon || "🚚"}</span>
        <span className="min-w-0">{text}</span>
      </p>
      <div className="mt-2 h-2 overflow-hidden rounded-full" style={{ background: `color-mix(in oklab, ${cfg.color} 18%, transparent)` }}>
        <div className="ship-fill h-full rounded-full" style={{ width: `${pct}%`, background: `linear-gradient(90deg, color-mix(in oklab, ${cfg.color} 70%, #fff), ${cfg.color})` }} />
      </div>
    </div>
  );
}
