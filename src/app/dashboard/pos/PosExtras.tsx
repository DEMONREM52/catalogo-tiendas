"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import Swal from "sweetalert2";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useLoyaltyBrand, type LoyaltyBrand } from "@/lib/loyalty/brand";
import { DateField } from "@/components/forms/Fields";
import { friendlyStockError } from "@/lib/stock/live-stock";
import type { ApprovalState } from "./usePriceFloors";

/**
 * Lo nuevo del POS (20261228 / 20261229), aparte para no cargar más la página:
 *  · usePromotions: precio de promoción vigente de cada producto en el punto.
 *  · PosToolbar: 🎁 combos, 📌 apartar, 📝 cotizar, ⭐ canje de puntos y 📱 cobro con QR.
 * Los precios de promociones, combos, apartados y canjes llevan su «pase» (autorización automática de la base).
 */

export type Passes = Record<string, ApprovalState>;
export type CartLite = { productId: string; name: string; qty: number; price: number };
type Promo = { id: string; name: string; kind: "pct" | "price"; value: number; scope: "all" | "category" | "product"; category_id: string | null; product_ids: string[] };

const money = (n: number) => `$${Math.round(Number(n) || 0).toLocaleString("es-CO")}`;
const swal = { background: "var(--t-bg-base)", color: "var(--t-text)", confirmButtonColor: "#8b5cf6" } as const;
const isMissing = (e: { message: string } | null) => Boolean(e && /Could not find the function|schema cache|does not exist/i.test(e.message));

/** Promociones vigentes del punto: precio con descuento por producto (null = sin promoción). */
export function usePromotions(storeId: string | undefined, pointId: string) {
  const [promos, setPromos] = useState<Promo[]>([]);
  const [byCategory, setByCategory] = useState<Map<string, Set<string>>>(new Map());
  useEffect(() => {
    if (!storeId) return;
    let alive = true;
    const load = async () => {
      const sb = supabaseBrowser();
      const { data } = await sb.rpc("erp_promotions_list", { p_store: storeId, p_point: pointId || null, p_active_only: true });
      if (!alive) return;
      const list = (Array.isArray(data) ? data : []) as Promo[];
      setPromos(list);
      // Productos de las categorías con promoción (categoría principal y las adicionales).
      const cats = [...new Set(list.filter((p) => p.scope === "category" && p.category_id).map((p) => p.category_id as string))];
      const map = new Map<string, Set<string>>();
      for (const c of cats) {
        const set = new Set<string>();
        const [a, b] = await Promise.all([
          sb.from("products").select("id").eq("store_id", storeId).eq("category_id", c).limit(5000),
          sb.from("product_category_links").select("product_id").eq("category_id", c).limit(5000),
        ]);
        for (const r of (a.data ?? []) as Array<{ id: string }>) set.add(r.id);
        for (const r of (b.data ?? []) as Array<{ product_id: string }>) set.add(r.product_id);
        map.set(c, set);
      }
      if (alive) setByCategory(map);
    };
    void load();
    const t = window.setInterval(() => void load(), 5 * 60 * 1000);
    return () => { alive = false; window.clearInterval(t); };
  }, [storeId, pointId]);

  const promoFor = useCallback((productId: string, base: number): { price: number; name: string } | null => {
    let best: { price: number; name: string } | null = null;
    for (const p of promos) {
      const applies = p.scope === "all" || (p.scope === "product" && p.product_ids.includes(productId)) || (p.scope === "category" && p.category_id && byCategory.get(p.category_id)?.has(productId));
      if (!applies) continue;
      const price = p.kind === "price" ? Number(p.value) : Math.round(base * (1 - Number(p.value) / 100));
      if (price > 0 && price < base && (!best || price < best.price)) best = { price, name: p.name };
    }
    return best;
  }, [promos, byCategory]);

  return { promoFor, count: promos.length };
}

/** Pide a la base los pases de precio (promoción, combo o apartado). Sin la migración devuelve {}. */
export async function requestPasses(storeId: string, pointId: string, source: "promo" | "combo" | "layaway", ref: string | null, items: Array<{ product_id: string; price: number; qty: number }>): Promise<Passes> {
  if (!items.length) return {};
  const { data, error } = await supabaseBrowser().rpc("erp_price_passes", { p_store: storeId, p_point: pointId || null, p_source: source, p_ref: ref, p_items: items });
  const r = data as { ok?: boolean; passes?: Passes } | null;
  return !error && r?.ok ? r.passes ?? {} : {};
}

function useMounted() { return useSyncExternalStore(() => () => {}, () => true, () => false); }

function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  const mounted = useMounted();
  if (!mounted) return null;
  return createPortal(
    <div className="fixed inset-0 z-[150] flex items-end justify-center sm:items-center sm:p-3" style={{ background: "rgba(0,0,0,.55)" }} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label={title} className={`flex max-h-[92dvh] w-full ${wide ? "max-w-2xl" : "max-w-md"} flex-col rounded-t-2xl border p-5 shadow-2xl sm:rounded-2xl`} style={{ borderColor: "var(--t-card-border)", background: "var(--t-bg-base)", color: "var(--t-text)" }}>
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="text-lg font-black">{title}</h3>
          <button type="button" onClick={onClose} className="rounded-lg border px-2.5 py-1 text-xs font-semibold" style={{ borderColor: "var(--t-card-border)" }}>Cerrar</button>
        </div>
        <div className="flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

const field = "w-full rounded-xl border px-3 py-2.5 text-sm";
const fieldStyle = { borderColor: "var(--t-card-border)", background: "var(--t-card-bg)", color: "var(--t-text)" } as const;
const plus30 = () => { const d = new Date(Date.now() + 30 * 86400000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const plus8 = () => { const d = new Date(Date.now() + 8 * 86400000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const waUrl = (phone: string, text: string) => { const d = phone.replace(/\D/g, ""); return `https://wa.me/${d.length === 10 ? `57${d}` : d}?text=${encodeURIComponent(text)}`; };

type Combo = { id: string; name: string; sku: string | null; price: number; items: Array<{ product_id: string; name: string; qty: number }>; active: boolean; regular: number };

export function PosToolbar({
  storeId, storeName, pointId, cart, total, customerName, customerPhone, customerDoc, priceOf,
  onAddCombo, onSetPrices, onClear,
}: {
  storeId: string; storeName: string; pointId: string; cart: CartLite[]; total: number; customerName: string; customerPhone: string;
  /** Cédula o NIT del cliente: los puntos son del documento (20261230), no del nombre. */
  customerDoc: string;
  /** Precio normal (lista actual del punto) de un producto; null si no está entre los productos del POS. */
  priceOf: (productId: string) => number | null;
  onAddCombo: (lines: Array<{ productId: string; name: string; qty: number; price: number }>, passes: Passes, comboName: string) => void;
  onSetPrices: (prices: Record<string, number>, passes: Passes, note: string) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState<null | "combo" | "layaway" | "quote" | "points" | "qr">(null);
  const [loyalty, setLoyalty] = useState<{ enabled: boolean; points: number; value: number; point_value: number; min_redeem: number } | null>(null);
  const realName = customerName.trim() && !/^consumidor final$/i.test(customerName.trim()) ? customerName.trim() : "";
  const doc = customerDoc.replace(/[^0-9A-Za-z]/g, "");
  // Nombre del programa en este punto (20261233): «Puntos La Vitrina», «estrellas»…
  const brand = useLoyaltyBrand(storeId, pointId);

  // Puntos del cliente por su documento (si el programa está encendido).
  useEffect(() => {
    if (doc.length < 5) { const t = window.setTimeout(() => setLoyalty(null), 0); return () => window.clearTimeout(t); }
    let alive = true;
    const t = window.setTimeout(() => {
      void supabaseBrowser().rpc("erp_loyalty_balance", { p_store: storeId, p_customer: doc }).then(({ data }) => {
        const v = data as { ok?: boolean; enabled?: boolean; points?: number; value?: number; point_value?: number; min_redeem?: number } | null;
        if (alive) setLoyalty(v?.ok && v.enabled ? { enabled: true, points: v.points ?? 0, value: v.value ?? 0, point_value: v.point_value ?? 10, min_redeem: v.min_redeem ?? 100 } : null);
      });
    }, 400);
    return () => { alive = false; window.clearTimeout(t); };
  }, [storeId, doc]);

  const btn = "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-bold transition hover:-translate-y-0.5";
  const bs = { borderColor: "var(--t-card-border)" };
  return (
    <>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <button type="button" className={btn} style={bs} onClick={() => setOpen("combo")} title="Agregar un combo">🎁 Combos</button>
        {cart.length ? <button type="button" className={btn} style={bs} onClick={() => setOpen("layaway")} title="El cliente abona y las unidades quedan reservadas">📌 Apartar</button> : null}
        {cart.length ? <button type="button" className={btn} style={bs} onClick={() => setOpen("quote")} title="Guardar como cotización y compartirla">📝 Cotizar</button> : null}
        {loyalty && loyalty.points > 0 && cart.length ? <button type="button" className={btn} style={{ borderColor: "color-mix(in oklab, #f59e0b 55%, var(--t-card-border))", background: "rgba(245,158,11,.1)" }} onClick={() => setOpen("points")} title={brand.name}>⭐ {loyalty.points} {brand.unit} ({money(loyalty.value)})</button> : null}
        {cart.length ? <button type="button" className={btn} style={bs} onClick={() => setOpen("qr")} title="Mostrar el QR de pago con el valor">📱 Cobrar con QR</button> : null}
      </div>
      {open === "combo" ? <ComboPicker storeId={storeId} pointId={pointId} priceOf={priceOf} inCart={new Set(cart.map((c) => c.productId))} onClose={() => setOpen(null)} onAdd={(l, p, n) => { onAddCombo(l, p, n); setOpen(null); }} /> : null}
      {open === "layaway" ? <LayawayDialog storeId={storeId} storeName={storeName} pointId={pointId} cart={cart} total={total} customerName={realName} customerPhone={customerPhone} onClose={() => setOpen(null)} onDone={() => { setOpen(null); onClear(); }} /> : null}
      {open === "quote" ? <QuoteDialog storeId={storeId} storeName={storeName} pointId={pointId} cart={cart} total={total} customerName={realName} customerPhone={customerPhone} onClose={() => setOpen(null)} /> : null}
      {open === "points" && loyalty ? <PointsDialog storeId={storeId} pointId={pointId} cart={cart} total={total} customer={doc} name={realName} loyalty={loyalty} brand={brand} onClose={() => setOpen(null)} onApply={(prices, passes, note) => { onSetPrices(prices, passes, note); setOpen(null); }} /> : null}
      {open === "qr" ? <QrDialog storeId={storeId} pointId={pointId} total={total} onClose={() => setOpen(null)} /> : null}
    </>
  );
}

function ComboPicker({ storeId, pointId, priceOf, inCart, onClose, onAdd }: {
  storeId: string; pointId: string; priceOf: (id: string) => number | null; inCart: Set<string>; onClose: () => void;
  onAdd: (lines: Array<{ productId: string; name: string; qty: number; price: number }>, passes: Passes, name: string) => void;
}) {
  const [combos, setCombos] = useState<Combo[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    void supabaseBrowser().rpc("erp_combos_list", { p_store: storeId }).then(({ data, error: e }) => {
      if (e) setError(isMissing(e) ? "Falta ejecutar en Supabase la migración 20261228_ventas_extra.sql." : e.message);
      setCombos(((Array.isArray(data) ? data : []) as Combo[]).filter((c) => c.active));
    });
  }, [storeId]);
  async function add(c: Combo) {
    if (c.items.some((i) => inCart.has(i.product_id))) return void Swal.fire({ icon: "warning", title: "Ya está en el carrito", text: "Uno de los productos del combo ya está en el carrito. Quítalo y agrega el combo.", ...swal });
    // El precio del combo se reparte según el precio normal de cada producto (el último ajusta el redondeo).
    const base = c.items.map((i) => (priceOf(i.product_id) ?? 0) * i.qty);
    const sum = base.reduce((a, b) => a + b, 0) || c.items.length;
    let left = Number(c.price);
    const lines = c.items.map((i, k) => {
      const share = k === c.items.length - 1 ? left : Math.round((Number(c.price) * (base[k] || 1)) / sum);
      left -= share;
      return { productId: i.product_id, name: i.name, qty: i.qty, price: Math.max(0, Math.round(share / i.qty)) };
    });
    const passes = await requestPasses(storeId, pointId, "combo", c.id, lines.map((l) => ({ product_id: l.productId, price: l.price, qty: l.qty })));
    onAdd(lines, passes, c.name);
  }
  return (
    <Modal title="🎁 Combos" onClose={onClose}>
      {error ? <p className="text-sm text-amber-500">⚠️ {error}</p> : null}
      {combos && !combos.length && !error ? <p className="text-sm" style={{ color: "var(--t-muted)" }}>Aún no hay combos. Créalos en Facturación → Promociones y combos.</p> : null}
      <div className="space-y-2">
        {(combos ?? []).map((c) => (
          <button key={c.id} type="button" onClick={() => void add(c)} className="w-full rounded-xl border p-3 text-left transition hover:-translate-y-0.5" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)" }}>
            <span className="flex items-center justify-between gap-2"><b>{c.name}</b><b className="text-lg">{money(c.price)}</b></span>
            <span className="block text-xs" style={{ color: "var(--t-muted)" }}>{c.items.map((i) => `${i.qty}× ${i.name}`).join(" + ")}</span>
            {Number(c.regular) > Number(c.price) ? <span className="text-xs font-bold text-emerald-500">Ahorra {money(Number(c.regular) - Number(c.price))}</span> : null}
          </button>
        ))}
      </div>
    </Modal>
  );
}

function LayawayDialog({ storeId, storeName, pointId, cart, total, customerName, customerPhone, onClose, onDone }: {
  storeId: string; storeName: string; pointId: string; cart: CartLite[]; total: number; customerName: string; customerPhone: string; onClose: () => void; onDone: () => void;
}) {
  const [name, setName] = useState(customerName);
  const [phone, setPhone] = useState(customerPhone);
  const [due, setDue] = useState(plus30);
  const [first, setFirst] = useState("");
  const [method, setMethod] = useState("efectivo");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const amount = Number(first.replace(/\D/g, "")) || 0;
  async function save() {
    if (!pointId) return void Swal.fire({ icon: "warning", title: "Elige el punto", ...swal });
    if (!name.trim()) return void Swal.fire({ icon: "warning", title: "Escribe el nombre del cliente", ...swal });
    if (amount > total) return void Swal.fire({ icon: "warning", title: "El abono es mayor que el total", ...swal });
    setBusy(true);
    const { data, error } = await supabaseBrowser().rpc("erp_layaway_create", {
      p_store: storeId,
      p: { point_id: pointId, customer_name: name, customer_phone: phone, due_date: due, note, items: cart.map((c) => ({ product_id: c.productId, qty: c.qty, price: c.price })), first: { amount, method } },
    });
    setBusy(false);
    const r = data as { ok: boolean; error?: string; number?: number; cash?: boolean } | null;
    if (error || !r?.ok) {
      const msg = error ? (isMissing(error) ? "Falta ejecutar en Supabase la migración 20261228_ventas_extra.sql." : friendlyStockError(error.message) ?? error.message) : r?.error;
      return void Swal.fire({ icon: "error", title: "No se pudo apartar", text: msg, ...swal });
    }
    const text = `Hola ${name.split(" ")[0]}! 📌 Tu apartado #${r.number} en ${storeName}:\n${cart.map((c) => `• ${c.qty}× ${c.name}`).join("\n")}\nTotal ${money(total)} · abonaste ${money(amount)} · saldo ${money(total - amount)}.\nTe lo guardamos hasta el ${new Date(`${due}T12:00:00`).toLocaleDateString("es-CO")}.`;
    const go = await Swal.fire({
      icon: "success", title: `Apartado #${r.number} creado`,
      html: `Las unidades quedaron reservadas.${amount && method === "efectivo" ? (r.cash ? "<br>El abono entró a la caja." : "<br><small>No hay caja abierta en este punto: el abono quedó registrado pero no entró a una caja.</small>") : ""}`,
      showCancelButton: Boolean(phone.replace(/\D/g, "").length >= 7), confirmButtonText: phone.replace(/\D/g, "").length >= 7 ? "💬 Enviar comprobante" : "Listo", cancelButtonText: "Listo", ...swal,
    });
    if (go.isConfirmed && phone.replace(/\D/g, "").length >= 7) window.open(waUrl(phone, text), "_blank", "noopener");
    onDone();
  }
  return (
    <Modal title="📌 Apartar" onClose={onClose}>
      <p className="mb-3 text-sm">Total <b>{money(total)}</b> · {cart.length} producto(s). Las unidades quedan reservadas hasta que se entregue o se anule.</p>
      <div className="space-y-2">
        <input className={field} style={fieldStyle} placeholder="Nombre del cliente *" value={name} onChange={(e) => setName(e.target.value.toUpperCase())} />
        <input className={field} style={fieldStyle} placeholder="Celular (para avisarle)" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        <label className="block text-xs font-semibold" style={{ color: "var(--t-muted)" }}>Se guarda hasta<DateField value={due} onChange={(v) => setDue(v || plus30())} ariaLabel="Se guarda hasta" /></label>
        <div className="grid grid-cols-2 gap-2">
          <input className={field} style={fieldStyle} placeholder="Abono inicial $" inputMode="numeric" value={first} onChange={(e) => setFirst(e.target.value.replace(/\D/g, "") ? Number(e.target.value.replace(/\D/g, "")).toLocaleString("es-CO") : "")} />
          <select className={field} style={fieldStyle} value={method} onChange={(e) => setMethod(e.target.value)} aria-label="Forma de pago del abono">
            <option value="efectivo">Efectivo</option><option value="transferencia">Transferencia</option><option value="nequi">Nequi</option><option value="tarjeta">Tarjeta</option>
          </select>
        </div>
        <input className={field} style={fieldStyle} placeholder="Nota (opcional)" value={note} onChange={(e) => setNote(e.target.value)} />
        <p className="text-xs" style={{ color: "var(--t-muted)" }}>Saldo: <b>{money(Math.max(0, total - amount))}</b>. Los abonos siguientes y la entrega se hacen en Facturación → Apartados.</p>
        <button type="button" disabled={busy} onClick={() => void save()} className="w-full rounded-xl px-3 py-3 text-sm font-bold text-white disabled:opacity-60" style={{ background: "var(--t-cta)" }}>{busy ? "Apartando…" : "📌 Apartar"}</button>
      </div>
    </Modal>
  );
}

function QuoteDialog({ storeId, storeName, pointId, cart, total, customerName, customerPhone, onClose }: {
  storeId: string; storeName: string; pointId: string; cart: CartLite[]; total: number; customerName: string; customerPhone: string; onClose: () => void;
}) {
  const [name, setName] = useState(customerName);
  const [phone, setPhone] = useState(customerPhone);
  const [until, setUntil] = useState(plus8);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ number: number; url: string } | null>(null);
  async function save() {
    setBusy(true);
    const { data, error } = await supabaseBrowser().rpc("erp_quote_save", {
      p_store: storeId,
      p: { point_id: pointId || null, customer_name: name, customer_phone: phone, valid_until: until, note, items: cart.map((c) => ({ product_id: c.productId, qty: c.qty, price: c.price })) },
    });
    setBusy(false);
    const r = data as { ok: boolean; error?: string; number?: number; token?: string } | null;
    if (error || !r?.ok) return void Swal.fire({ icon: "error", title: "No se guardó", text: error ? (isMissing(error) ? "Falta ejecutar en Supabase la migración 20261228_ventas_extra.sql." : error.message) : r?.error, ...swal });
    setDone({ number: r.number!, url: `${window.location.origin}/documento/cotizacion/${r.token}` });
  }
  const text = done ? `Hola${name ? ` ${name.split(" ")[0]}` : ""}! 📝 Te comparto la cotización #${done.number} de ${storeName} por ${money(total)}, válida hasta el ${new Date(`${until}T12:00:00`).toLocaleDateString("es-CO")}:\n${done.url}` : "";
  return (
    <Modal title="📝 Cotizar" onClose={onClose}>
      {!done ? (
        <div className="space-y-2">
          <p className="text-sm">Total <b>{money(total)}</b> · {cart.length} producto(s). No descuenta inventario.</p>
          <input className={field} style={fieldStyle} placeholder="Cliente (opcional)" value={name} onChange={(e) => setName(e.target.value.toUpperCase())} />
          <input className={field} style={fieldStyle} placeholder="Celular (opcional)" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
          <label className="block text-xs font-semibold" style={{ color: "var(--t-muted)" }}>Válida hasta<DateField value={until} onChange={(v) => setUntil(v || plus8())} ariaLabel="Válida hasta" /></label>
          <input className={field} style={fieldStyle} placeholder="Nota (opcional)" value={note} onChange={(e) => setNote(e.target.value)} />
          <button type="button" disabled={busy} onClick={() => void save()} className="w-full rounded-xl px-3 py-3 text-sm font-bold text-white disabled:opacity-60" style={{ background: "var(--t-cta)" }}>{busy ? "Guardando…" : "💾 Guardar cotización"}</button>
        </div>
      ) : (
        <div className="space-y-2 text-sm">
          <p>✅ Cotización <b>#{done.number}</b> guardada. El carrito sigue igual por si quieres venderla ahora.</p>
          <a href={done.url} target="_blank" rel="noreferrer" className="block rounded-xl border px-3 py-2.5 text-center font-semibold" style={{ borderColor: "var(--t-card-border)" }}>📄 Ver / imprimir</a>
          {phone.replace(/\D/g, "").length >= 7
            ? <a href={waUrl(phone, text)} target="_blank" rel="noreferrer" className="block rounded-xl px-3 py-2.5 text-center font-bold text-white" style={{ background: "#16a34a" }}>💬 Enviar por WhatsApp</a>
            : <a href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer" className="block rounded-xl px-3 py-2.5 text-center font-bold text-white" style={{ background: "#16a34a" }}>💬 Compartir por WhatsApp</a>}
          <button type="button" onClick={() => void navigator.clipboard?.writeText(done.url)} className="w-full rounded-xl border px-3 py-2.5 font-semibold" style={{ borderColor: "var(--t-card-border)" }}>🔗 Copiar enlace</button>
        </div>
      )}
    </Modal>
  );
}

function PointsDialog({ storeId, pointId, cart, total, customer, name, loyalty, brand, onClose, onApply }: {
  storeId: string; pointId: string; cart: CartLite[]; total: number; customer: string; name: string;
  loyalty: { points: number; point_value: number; min_redeem: number }; brand: LoyaltyBrand; onClose: () => void; onApply: (prices: Record<string, number>, passes: Passes, note: string) => void;
}) {
  const maxPoints = Math.min(loyalty.points, Math.floor((total - cart.length) / loyalty.point_value));
  const [pts, setPts] = useState(String(Math.max(0, maxPoints)));
  const [busy, setBusy] = useState(false);
  const n = Math.max(0, Math.min(maxPoints, Number(pts.replace(/\D/g, "")) || 0));
  const value = Math.round(n * loyalty.point_value);
  async function apply() {
    if (n < loyalty.min_redeem) return void Swal.fire({ icon: "warning", title: `Mínimo ${loyalty.min_redeem} ${brand.unit}`, ...swal });
    // El descuento se reparte entre los productos según su valor (el último ajusta el redondeo).
    let left = value;
    const lines = cart.map((c, k) => {
      const lineTotal = c.price * c.qty;
      const cut = k === cart.length - 1 ? left : Math.round((value * lineTotal) / total);
      left -= cut;
      const unitCut = Math.round(cut / c.qty);
      return { product_id: c.productId, qty: c.qty, old: c.price, price: Math.max(1, c.price - unitCut) };
    });
    // Ajuste fino para que el descuento sea exacto (por redondeos por unidad).
    const got = lines.reduce((s, l) => s + (l.old - l.price) * l.qty, 0);
    if (got !== value && lines.length) { const l = lines[lines.length - 1]; l.price = Math.max(1, l.price - Math.round((value - got) / l.qty)); }
    setBusy(true);
    const { data, error } = await supabaseBrowser().rpc("erp_loyalty_redeem", { p_store: storeId, p_point: pointId || null, p_customer: customer, p_points: n, p_items: lines });
    setBusy(false);
    const r = data as { ok: boolean; error?: string; passes?: Passes } | null;
    if (error || !r?.ok) return void Swal.fire({ icon: "error", title: "No se pudo canjear", text: error?.message ?? r?.error, ...swal });
    onApply(Object.fromEntries(lines.map((l) => [l.product_id, l.price])), r.passes ?? {}, `⭐ Canje de ${n} ${brand.unit} (${brand.name})`);
  }
  return (
    <Modal title={`⭐ Canjear ${brand.name}`} onClose={onClose}>
      <p className="text-sm"><b>{name || "El cliente"}</b> (documento {customer}) tiene <b>{loyalty.points}</b> {brand.unit} (cada uno vale {money(loyalty.point_value)}).</p>
      <input className={`${field} mt-3 text-center text-2xl font-black`} style={fieldStyle} inputMode="numeric" value={pts} onChange={(e) => setPts(e.target.value.replace(/\D/g, ""))} aria-label={`${brand.unit} a canjear`} />
      <p className="mt-2 text-center text-sm">Descuento: <b className="text-lg">{money(value)}</b> · total queda en <b>{money(total - value)}</b></p>
      <p className="mt-1 text-center text-[11px]" style={{ color: "var(--t-muted)" }}>Mínimo {loyalty.min_redeem} {brand.unit}. Se descuentan ya; si no cobras la venta, avísale al administrador.</p>
      <button type="button" disabled={busy || n < loyalty.min_redeem} onClick={() => void apply()} className="mt-3 w-full rounded-xl px-3 py-3 text-sm font-bold text-white disabled:opacity-50" style={{ background: "var(--t-cta)" }}>{busy ? "Canjeando…" : `Canjear ${n} ${brand.unit}`}</button>
    </Modal>
  );
}

function QrDialog({ storeId, pointId, total, onClose }: { storeId: string; pointId: string; total: number; onClose: () => void }) {
  const [list, setList] = useState<Array<{ id: string; label: string; key_text: string | null; image_url: string | null }> | null>(null);
  const [pick, setPick] = useState(0);
  useEffect(() => {
    void supabaseBrowser().rpc("erp_payment_qr_list", { p_store: storeId, p_point: pointId || null }).then(({ data }) => setList(Array.isArray(data) ? data as NonNullable<typeof list> : []));
  }, [storeId, pointId]);
  const q = useMemo(() => (list ?? [])[pick], [list, pick]);
  return (
    <Modal title="📱 Cobrar con QR" onClose={onClose}>
      {list && !list.length ? <p className="text-sm" style={{ color: "var(--t-muted)" }}>Aún no hay QR de pago. Súbelos en Mi tienda → Cobros con QR (Nequi, Daviplata, Bre-B o tu banco).</p> : null}
      {list && list.length > 1 ? (
        <div className="mb-3 flex flex-wrap gap-1.5">{list.map((x, i) => <button key={x.id} type="button" onClick={() => setPick(i)} className="rounded-full border px-3 py-1 text-xs font-bold" style={pick === i ? { background: "var(--t-accent)", color: "#fff", borderColor: "transparent" } : { borderColor: "var(--t-card-border)" }}>{x.label}</button>)}</div>
      ) : null}
      {q ? (
        <div className="text-center">
          <p className="text-sm font-semibold" style={{ color: "var(--t-muted)" }}>{q.label}</p>
          <p className="text-4xl font-black tabular-nums">{money(total)}</p>
          {q.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={q.image_url} alt={`QR ${q.label}`} className="mx-auto mt-3 aspect-square w-full max-w-xs rounded-2xl border bg-white object-contain p-2" style={{ borderColor: "var(--t-card-border)" }} />
          ) : null}
          {q.key_text ? <p className="mt-3 text-lg font-bold">{q.key_text}</p> : null}
          <p className="mt-2 text-[11px]" style={{ color: "var(--t-muted)" }}>Cuando el cliente pague, revisa que llegó y cobra con forma de pago «Transferencia».</p>
        </div>
      ) : null}
    </Modal>
  );
}
