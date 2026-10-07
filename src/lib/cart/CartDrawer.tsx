"use client";

import { useMemo, useRef, useState } from "react";
import { ArrowRight, Minus, Plus, ShoppingBasket, Sparkles, Trash2, X } from "lucide-react";
import { StoreContactIcon } from "@/components/StoreContactIcon";
import Swal from "sweetalert2";
import { supabaseBrowser } from "@/lib/supabase/client";
import { cartUsesMinimums, useCart } from "./CartProvider";
import { track } from "@/lib/tracking";

/* =========================
   Helpers
========================= */
function money(n: number) {
  return `$${Number(n || 0).toLocaleString("es-CO")}`;
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const el = document.createElement("textarea");
      el.value = text;
      el.style.position = "fixed";
      el.style.left = "-9999px";
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Si en tu SQL haces:
 *   raise exception 'OUT_OF_STOCK' using detail = v_bad_name;
 * esto lo detecta bonito.
 */
function isOutOfStockError(err: any) {
  const msg = String(err?.message ?? "").toUpperCase();
  const details = String(err?.details ?? "").toUpperCase();
  return msg.includes("OUT_OF_STOCK") || details.includes("OUT_OF_STOCK");
}

function extractOutOfStockName(err: any) {
  const d = String(err?.details ?? "").trim();
  if (d && d.toUpperCase() !== "OUT_OF_STOCK") return d;
  const m = String(err?.message ?? "").trim();
  return m && m.toUpperCase() !== "OUT_OF_STOCK" ? m : "";
}

/* =========================
   Stock types (para evitar "never")
========================= */
type StockMap = Map<string, { stock: number | null; name?: string }>;

type StockCheckResult =
  | { ok: true; map: StockMap }
  | { ok: false; reason: "NO_CART" | "EMPTY" | "ERROR"; message?: string }
  | {
      ok: false;
      reason: "INSUFFICIENT";
      bad: Array<{
        id: string;
        name: string;
        need: number;
        stock: number | null; // null => ilimitado
      }>;
      map: StockMap;
    };

/* =========================
   Component
========================= */
export function CartDrawer() {
  const {
    cart,
    isOpen,
    open,
    close,
    setQty,
    removeItem,
    empty,
    total,
    count,
    setCustomerName,
    setCustomerNote,
    setContactTarget,
  } = useCart();

  const nameRef = useRef<HTMLInputElement | null>(null);
  const formattedCount = new Intl.NumberFormat("es-CO").format(count);
  const countBadge = formattedCount.length > 10
    ? new Intl.NumberFormat("es-CO", { notation: "compact", maximumFractionDigits: 1 }).format(count)
    : formattedCount;

  // UI feedback para validación
  const [nameError, setNameError] = useState(false);
  const [namePulse, setNamePulse] = useState(false);
  const [sending, setSending] = useState(false);

  function minAllowed(i: { minWholesale?: number | null }) {
    if (!cart) return 1;
    if (!cartUsesMinimums(cart)) return 1;
    return Math.max(1, Number(i.minWholesale ?? 1));
  }

  function safeSetQty(productId: string, next: number, item?: any) {
    const min = item ? minAllowed(item) : 1;
    const n = Number.isFinite(next) ? next : min;
    const fixed = Math.max(min, Math.floor(n));
    setQty(productId, fixed);
  }

  const whatsText = useMemo(() => {
    if (!cart) return "";

    const customer = (cart.customerName ?? "").trim();
    const note = (cart.customerNote ?? "").trim();

    const lines: string[] = [];
    lines.push(`🧾 Pedido (${cart.catalog ? cart.catalog.name.toUpperCase() : cart.mode === "detal" ? "DETAL" : "MAYOR"})`);
    lines.push(`🏪 Tienda: ${cart.storeName}`);
    lines.push("");

    // ✅ saludo con nombre
    if (customer) lines.push(`Hola, soy *${customer}* 👋`);
    else lines.push(`Hola 👋`);

    if (note) lines.push(`📝 Dirección / Observaciones: ${note}`);
    if (customer || note) lines.push("");

    cart.items.forEach((i, idx) => {
      lines.push(`${idx + 1}. ${i.name}`);
      lines.push(
        `   Cant: ${i.qty} | Precio: ${money(i.price)} | Subtotal: ${money(
          i.price * i.qty
        )}`
      );
      if (cartUsesMinimums(cart) && i.minWholesale) {
        lines.push(`   (mínimo mayor: ${minAllowed(i)})`);
      }
    });

    lines.push("");
    lines.push(`TOTAL: ${money(total)}`);
    lines.push("");
    lines.push(`✅ Quiero confirmar este pedido.`);

    return lines.join("\n");
  }, [cart, total]);

  function bumpNameError() {
    setNameError(true);
    setNamePulse(true);
    window.setTimeout(() => setNamePulse(false), 520);
    window.setTimeout(() => setNameError(false), 3000);
    nameRef.current?.focus();
  }

  /**
   * ✅ Validación PRO de stock ANTES del RPC
   * Reglas:
   * - stock = null  => ilimitado (no bloquea)
   * - stock >= qty  => ok
   * - stock < qty   => insuficiente
   */
  async function validateStockNow(): Promise<StockCheckResult> {
    if (!cart) return { ok: false, reason: "NO_CART" };

    const ids = cart.items.map((x) => x.productId);
    if (ids.length === 0) return { ok: false, reason: "EMPTY" };

    const sb = supabaseBrowser();

    // En un catálogo con punto asignado manda el inventario de ese punto.
    const { data, error } = cart.catalog
      ? await sb.rpc("catalog_public_stock", {
          p_store: cart.storeSlug,
          p_catalog: cart.catalog.slug,
          p_key: cart.catalog.key,
          p_ids: ids,
        })
      : await sb
          .from("products")
          .select("id,stock,name")
          .in("id", ids);

    if (error) {
      return { ok: false, reason: "ERROR", message: error.message };
    }

    const map: StockMap = new Map();

    (data ?? []).forEach((p: any) => {
      const raw = p?.stock;
      const stock =
        raw === null || raw === undefined
          ? null
          : Math.max(0, Math.floor(Number(raw)));
      map.set(String(p.id), { stock, name: p.name ?? undefined });
    });

    const bad = cart.items
      .map((it) => {
        const row = map.get(it.productId);
        const stock = row?.stock ?? null; // null => ilimitado
        return {
          id: it.productId,
          name: row?.name ?? it.name,
          need: Number(it.qty),
          stock, // null => ilimitado
        };
      })
      .filter((x) => x.stock !== null && x.need > (x.stock as number));

    if (bad.length) return { ok: false, reason: "INSUFFICIENT", bad, map };

    return { ok: true, map };
  }

  /**
   * Ajustar automáticamente el carrito a lo que hay disponible
   * - Si stock=0 => lo elimina (qty=0)
   * - Si stock>0 y qty>stock => lo baja (respetando mínimo mayorista)
   */
  function adjustCartToStock(map: StockMap) {
    if (!cart) return;

    cart.items.forEach((it) => {
      const row = map.get(it.productId);
      const stock = row?.stock ?? null;

      if (stock === null) return; // ilimitado

      if (stock <= 0) {
        setQty(it.productId, 0);
        return;
      }

      if (it.qty > stock) {
        const min = minAllowed(it as any);
        const fixed = Math.max(min, stock);
        setQty(it.productId, fixed);
      }
    });
  }

  async function generateAndSend() {
    if (!cart) return;
    if (sending) return;

    // nombre obligatorio
    const customer = (cart.customerName ?? "").trim();
    if (!customer) {
      bumpNameError();
      await Swal.fire({
        icon: "warning",
        title: "Falta tu nombre",
        text: "Por favor escribe tu nombre para poder enviar el pedido por WhatsApp.",
        background: "#0b0b0b",
        color: "#fff",
        confirmButtonColor: "#ef4444",
      });
      return;
    }

    if (cart.items.length === 0) {
      await Swal.fire({
        icon: "info",
        title: "Carrito vacío",
        text: "Agrega productos antes de generar el comprobante.",
        background: "#0b0b0b",
        color: "#fff",
      });
      return;
    }

    if (
      (cart.contactChannels?.length ?? 0) > 1
      && (!cart.contactSelectionConfirmed || !cart.selectedContactId)
    ) {
      await Swal.fire({
        icon: "info",
        title: "Elige tu punto de atención",
        text: "Selecciona primero al asesor de la sucursal o punto más cercano para enviar tu pedido.",
        background: "#0b0b0b",
        color: "#fff",
        confirmButtonColor: "#f59e0b",
      });
      return;
    }

    const selectedDestination = cart.contactChannels?.find((channel) => channel.id === cart.selectedContactId)
      ?? cart.contactChannels?.[0]
      ?? { id: "primary", label: "WhatsApp principal", phone: cart.whatsapp };
    if (selectedDestination.phone.replace(/\D/g, "").length < 8) {
      await Swal.fire({
        icon: "warning",
        title: "WhatsApp no configurado",
        text: "Esta tienda todavía no tiene un número válido para recibir pedidos. Contacta al administrador.",
        background: "#0b0b0b",
        color: "#fff",
      });
      return;
    }

    if (!cart.storeId) {
      await Swal.fire({
        icon: "error",
        title: "Falta storeId en el carrito",
        text: "Debes guardar el storeId en el CartProvider al inicializar el carrito.",
        background: "#0b0b0b",
        color: "#fff",
        confirmButtonColor: "#ef4444",
      });
      return;
    }

    // mínimos mayoristas
    if (cartUsesMinimums(cart)) {
      const bad = cart.items.find((i) => i.qty < minAllowed(i));
      if (bad) {
        await Swal.fire({
          icon: "warning",
          title: "Cantidad mínima mayorista",
          text: `El producto "${bad.name}" debe tener mínimo ${minAllowed(bad)}.`,
          background: "#0b0b0b",
          color: "#fff",
          confirmButtonColor: "#f59e0b",
        });
        return;
      }
    }

    setSending(true);
    const whatsappTab = window.open("about:blank", "_blank");
    if (whatsappTab) {
      whatsappTab.document.title = "Preparando pedido";
      whatsappTab.document.body.textContent = "Preparando el mensaje para WhatsApp...";
      whatsappTab.opener = null;
    }

    // ✅ Validación stock antes del RPC (mejor UX)
    let stockCheck: StockCheckResult;
    try {
      stockCheck = await validateStockNow();
    } catch (error) {
      setSending(false);
      whatsappTab?.close();
      await Swal.fire({
        icon: "error",
        title: "No se pudo validar inventario",
        text: String(error instanceof Error ? error.message : error),
        background: "#0b0b0b",
        color: "#fff",
        confirmButtonColor: "#ef4444",
      });
      return;
    }

    if (!stockCheck.ok) {
      setSending(false);
      whatsappTab?.close();

      if (stockCheck.reason === "INSUFFICIENT") {
        const html = `
          <div style="text-align:left; opacity:.92">
            <div style="margin-bottom:10px">
              Algunos productos ya no tienen inventario suficiente.
            </div>
            ${stockCheck.bad
              .map((x) => {
                const st = x.stock === null ? "Ilimitado" : String(x.stock);
                return `
                  <div style="padding:10px; border:1px solid rgba(255,255,255,.12); border-radius:12px; margin:8px 0;">
                    <b>${x.name}</b><br/>
                    Pediste: <b>${x.need}</b> · Disponible: <b>${st}</b>
                  </div>
                `;
              })
              .join("")}
            <div style="margin-top:10px; font-size:12px; opacity:.75">
              Puedes ajustar el carrito automáticamente o cambiar cantidades manualmente.
            </div>
          </div>
        `;

        const res = await Swal.fire({
          icon: "warning",
          title: "Stock insuficiente",
          html,
          background: "#0b0b0b",
          color: "#fff",
          showCancelButton: true,
          confirmButtonText: "Ajustar carrito",
          cancelButtonText: "Cerrar",
          confirmButtonColor: "#f59e0b",
        });

        if (res.isConfirmed) {
          adjustCartToStock(stockCheck.map);
          await Swal.fire({
            icon: "success",
            title: "Carrito actualizado",
            text: "Ajusté las cantidades al stock disponible.",
            timer: 1200,
            showConfirmButton: false,
            background: "#0b0b0b",
            color: "#fff",
          });
        }

        return;
      }

      await Swal.fire({
        icon: "error",
        title: "No se pudo validar inventario",
        text:
          stockCheck.message ??
          "Intenta nuevamente. Si persiste, revisa tu conexión.",
        background: "#0b0b0b",
        color: "#fff",
        confirmButtonColor: "#ef4444",
      });
      return;
    }

    // ✅ crear pedido
    const trackItems = cart.items.map((i) => ({ id: i.productId, name: i.name, price: Number(i.price) || 0, quantity: i.qty }));
    track.beginCheckout(trackItems, cart.storeSlug);
    try {
      const payload = cart.items.map((i) => ({
        product_id: i.productId,
        qty: i.qty,
        price: i.price,
      }));

      const sb = supabaseBrowser();

      // Los catálogos de RemHub Social calculan precios y existencias en el servidor.
      const { data, error } = cart.catalog
        ? await sb.rpc("catalog_create_order", {
            p_store: cart.storeSlug,
            p_catalog: cart.catalog.slug,
            p_key: cart.catalog.key,
            p_items: cart.items.map((i) => ({ product_id: i.productId, qty: i.qty })),
            p_customer_name: (cart.customerName ?? "").trim(),
            p_customer_note: (cart.customerNote ?? "").trim(),
            p_customer_whatsapp: null,
          })
        : await sb.rpc("create_order_from_cart", {
            p_store_id: cart.storeId,
            p_catalog_type: cart.mode === "detal" ? "retail" : "wholesale",
            p_items: payload,
            p_customer_name: (cart.customerName ?? "").trim(),
            p_customer_note: (cart.customerNote ?? "").trim(),
            p_customer_whatsapp: null,
          });

      if (error) {
        // ✅ si por carrera el backend detecta stock insuficiente
        if (isOutOfStockError(error)) {
          const badName = extractOutOfStockName(error);

          const res = await Swal.fire({
            icon: "warning",
            title: "Inventario actualizado",
            html: `
              <div style="text-align:left; opacity:.92">
                <div style="margin-bottom:10px">
                  Este pedido no se pudo crear porque el inventario cambió.
                </div>
                ${
                  badName
                    ? `<div>Producto sin stock suficiente: <b>${badName}</b></div>`
                    : ""
                }
                <div style="margin-top:10px; font-size:12px; opacity:.75">
                  Recarga la página y vuelve a intentarlo.
                </div>
              </div>
            `,
            background: "#0b0b0b",
            color: "#fff",
            showCancelButton: true,
            confirmButtonText: "Recargar página",
            cancelButtonText: "Cerrar",
            confirmButtonColor: "#f59e0b",
          });

          if (res.isConfirmed) window.location.reload();
          whatsappTab?.close();
          return;
        }

        throw error;
      }

      const token = (data as any)?.token as string;
      if (!token) throw new Error("No se generó token.");
      // El token es privado (abre el comprobante): a la medición solo va el número de pedido.
      const receiptNo = (data as { receipt_no?: number | string } | null)?.receipt_no;
      track.order(receiptNo ? `${cart.storeSlug}-${receiptNo}` : `${cart.storeSlug}-${Date.now()}`, trackItems, cart.storeSlug);

      const invoiceUrl = `${window.location.origin}/pedido/${token}`;

      const waText = [
        whatsText,
        ``,
        `📌 Comprobante (puedes editar):`,
        invoiceUrl,
      ].join("\n");

      const whatsappNumber = selectedDestination.phone.replace(/\D/g, "");
      if (whatsappTab && whatsappNumber) {
        whatsappTab.location.href = `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(waText)}`;
      } else {
        whatsappTab?.close();
      }

      const res = await Swal.fire({
        icon: "success",
        title: "Comprobante generado",
        html: `
          <div style="text-align:left; opacity:.9">
            <div style="margin-bottom:10px;">
              Se creó el pedido. Puedes enviar el enlace de la factura por WhatsApp o abrirlo ahora.
            </div>
            <div style="font-size:12px; opacity:.8; margin-bottom:6px;">
              Link del comprobante:
            </div>
            <div style="padding:10px; border:1px solid rgba(255,255,255,.12); border-radius:12px; word-break:break-all; font-size:12px;">
              ${invoiceUrl}
            </div>
          </div>
        `,
        background: "#0b0b0b",
        color: "#fff",
        showCancelButton: true,
        confirmButtonText: "Abrir comprobante",
        cancelButtonText: "Cerrar",
        confirmButtonColor: "#a855f7",
        showDenyButton: true,
        denyButtonText: "Copiar link",
        denyButtonColor: "#22c55e",
      });

      if (res.isConfirmed) {
        window.open(invoiceUrl, "_blank");
      } else if (res.isDenied) {
        const ok = await copyText(invoiceUrl);
        await Swal.fire({
          icon: ok ? "success" : "error",
          title: ok ? "Copiado" : "No se pudo copiar",
          text: ok
            ? "Link copiado al portapapeles."
            : "Tu navegador bloqueó el copiado.",
          timer: 1000,
          showConfirmButton: false,
          background: "#0b0b0b",
          color: "#fff",
        });
      }
    } catch (err: any) {
      whatsappTab?.close();
      await Swal.fire({
        icon: "error",
        title: "No se pudo generar el comprobante",
        text: err?.message ?? "Error",
        background: "#0b0b0b",
        color: "#fff",
        confirmButtonColor: "#ef4444",
      });
    } finally {
      setSending(false);
    }
  }

  if (!cart) return null;

  const customerName = cart.customerName ?? "";
  const customerNote = cart.customerNote ?? "";

  return (
    <>
      {/* animación de error */}
      <style jsx global>{`
        @keyframes cartPulseRed {
          0% {
            box-shadow: 0 0 0 0 rgba(239, 68, 68, 0);
          }
          20% {
            box-shadow: 0 0 0 6px rgba(239, 68, 68, 0.25);
          }
          40% {
            box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.18);
          }
          60% {
            box-shadow: 0 0 0 6px rgba(239, 68, 68, 0.25);
          }
          100% {
            box-shadow: 0 0 0 0 rgba(239, 68, 68, 0);
          }
        }
        .cart-name-error {
          border-color: rgba(239, 68, 68, 0.65) !important;
          box-shadow: 0 0 0 4px rgba(239, 68, 68, 0.18) !important;
        }
        .cart-name-pulse {
          animation: cartPulseRed 0.52s ease-in-out;
        }
        @keyframes cartBadgePop {
          0% { transform: scale(0.75); }
          65% { transform: scale(1.14); }
          100% { transform: scale(1); }
        }
        @media (prefers-reduced-motion: reduce) {
          .cart-fill,
          .cart-count-badge {
            transition: none !important;
            animation: none !important;
          }
        }
      `}</style>

      <button
        onClick={() => (isOpen ? close() : open())}
        className="fixed bottom-4 right-4 z-40 grid h-20 w-20 place-items-center overflow-hidden rounded-[1.65rem] border shadow-[0_12px_34px_rgba(0,0,0,0.28)] backdrop-blur-xl transition duration-300 hover:-translate-y-1 hover:shadow-[0_16px_40px_rgba(0,0,0,0.35)] active:scale-95"
        style={{
          borderColor: "var(--t-border)",
          background: "color-mix(in oklab, var(--t-card-bg) 92%, transparent)",
          color: "var(--t-text)",
        }}
        aria-label={`Abrir canasta, ${count} ${count === 1 ? "unidad" : "unidades"}`}
        aria-expanded={isOpen}
      >
        <span className="pointer-events-none relative mt-2 grid h-12 w-12 place-items-center">
          <span
            aria-hidden="true"
            className="cart-fill absolute bottom-[21%] left-[26%] z-0 w-[48%] rounded-b-md bg-gradient-to-t from-amber-500 to-orange-300 transition-[height] duration-700 ease-out"
            style={{
              height: count > 0 ? `${Math.min(8 + Math.log10(count) * 13, 48)}%` : "0%",
              clipPath: "polygon(4% 0, 96% 0, 78% 100%, 22% 100%)",
            }}
          />
          <ShoppingBasket className="relative z-10" size={40} strokeWidth={1.8} aria-hidden="true" />
        </span>
        {count > 0 ? (
          <span
            key={count}
            className="cart-count-badge absolute right-1.5 top-1.5 z-20 grid h-6 place-items-center rounded-full border-2 px-1.5 text-[10px] font-black leading-none tabular-nums text-white shadow-md"
            style={{
              minWidth: `${Math.min(Math.max(countBadge.length * 7 + 14, 30), 82)}px`,
              borderColor: "var(--t-card-bg)",
              background: "var(--t-cta)",
              animation: "cartBadgePop 320ms ease-out",
            }}
            title={`${new Intl.NumberFormat("es-CO").format(count)} ${count === 1 ? "unidad" : "unidades"}`}
          >
            {countBadge}
          </span>
        ) : null}
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/60" onClick={close} />

          <div
            role="dialog"
            aria-modal="true"
            aria-label="Tu canasta de compras"
            className="absolute right-0 top-0 flex h-dvh w-full max-w-2xl flex-col border-l p-3 sm:p-6"
            style={{
              borderColor: "var(--t-border)",
              background: "color-mix(in oklab, var(--t-bg-base) 94%, transparent)",
              color: "var(--t-text)",
              backdropFilter: "blur(22px)",
            }}
          >
            <div className="glass flex shrink-0 items-center justify-between gap-2 rounded-2xl p-2.5 sm:gap-3 sm:p-3">
              <div className="flex min-w-0 items-center gap-2">
                <span
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-xl"
                  style={{ background: "color-mix(in oklab, var(--t-accent) 16%, transparent)", color: "var(--t-accent)" }}
                >
                  <ShoppingBasket size={20} aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <h3 className="text-base font-extrabold">Tu canasta</h3>
                  <p className="truncate text-xs opacity-75">
                    {cart.catalog ? cart.catalog.name : cart.mode === "detal" ? "Compra al detal" : "Compra al por mayor"} · {cart.storeName}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {count > 0 ? (
                  <span
                    className="max-w-36 truncate rounded-full px-2.5 py-1 text-[11px] font-bold tabular-nums"
                    style={{ background: "color-mix(in oklab, var(--t-accent) 14%, transparent)", color: "var(--t-accent)" }}
                  >
                    {new Intl.NumberFormat("es-CO").format(count)} {count === 1 ? "unidad" : "unidades"}
                  </span>
                ) : null}
                <button
                  className="grid h-8 w-8 place-items-center rounded-full border transition hover:bg-black/5"
                  style={{ borderColor: "var(--t-card-border)" }}
                  onClick={close}
                  disabled={sending}
                  aria-label="Cerrar canasta"
                >
                  <X size={16} aria-hidden="true" />
                </button>
              </div>
            </div>

            <div className="mt-2.5 min-h-0 flex-1 overflow-y-auto pr-1 sm:mt-3">
              {cart.items.length === 0 ? (
                <div className="glass-soft flex min-h-full flex-col items-center justify-center rounded-[2rem] px-6 py-10 text-center">
                  <div
                    className="relative grid h-36 w-36 place-items-center rounded-full"
                    style={{ background: "color-mix(in oklab, var(--t-accent) 10%, transparent)" }}
                  >
                    <span
                      className="absolute inset-3 rounded-full border border-dashed"
                      style={{ borderColor: "color-mix(in oklab, var(--t-accent) 35%, transparent)" }}
                    />
                    <ShoppingBasket size={72} strokeWidth={1.35} style={{ color: "var(--t-accent)" }} aria-hidden="true" />
                    <span
                      className="absolute right-2 top-2 grid h-10 w-10 place-items-center rounded-full border shadow-md"
                      style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)", color: "var(--t-accent)" }}
                    >
                      <Sparkles size={18} aria-hidden="true" />
                    </span>
                  </div>
                  <h4 className="mt-6 text-xl font-black">Tu canasta está esperando</h4>
                  <p className="mt-2 max-w-xs text-sm leading-6 opacity-75">
                    Explora la tienda y agrega tus favoritos. Aquí podrás revisar cantidades y preparar tu pedido.
                  </p>
                  <button
                    className="btn-cta mt-6 inline-flex items-center justify-center gap-2 rounded-2xl px-5 py-3 text-sm font-bold"
                    onClick={close}
                  >
                    Seguir explorando
                    <ArrowRight size={17} aria-hidden="true" />
                  </button>
                </div>
              ) : (
                <div className="space-y-2 pb-2">
                  {cart.items.map((i) => {
                    const min = minAllowed(i);
                    return (
                      <div key={i.productId} className="glass-soft rounded-xl p-2.5 sm:p-3">
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="line-clamp-2 font-bold">{i.name}</p>
                            <p className="text-xs opacity-75">
                              {money(i.price)} <span className="opacity-60">por unidad</span>
                            </p>
                          </div>
                          <button
                            className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-rose-400/40 text-rose-500 transition hover:border-rose-500 hover:bg-rose-500/10 hover:text-rose-600 dark:text-rose-400"
                            style={{ borderColor: "color-mix(in oklab, #f43f5e 42%, transparent)" }}
                            onClick={() => removeItem(i.productId)}
                            disabled={sending}
                            aria-label={`Quitar ${i.name} de la canasta`}
                            title="Quitar producto"
                          >
                            <Trash2 size={15} aria-hidden="true" />
                          </button>
                        </div>
                        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t pt-2" style={{ borderColor: "var(--t-card-border)" }}>
                          <div className="flex items-center gap-0.5 rounded-lg border p-0.5" style={{ borderColor: "var(--t-card-border)" }}>
                            <button
                              className="grid h-7 w-7 place-items-center rounded-md transition hover:bg-black/5 disabled:opacity-40"
                              onClick={() => safeSetQty(i.productId, i.qty - 1, i)}
                              disabled={i.qty <= min || sending}
                              title={i.qty <= min ? `Mínimo: ${min}` : "Disminuir cantidad"}
                              aria-label={`Disminuir cantidad de ${i.name}`}
                            >
                              <Minus size={16} aria-hidden="true" />
                            </button>
                            <input
                              type="number"
                              min={min}
                              className="ring-focus rounded-md px-1 py-1 text-center text-sm font-bold tabular-nums transition-[width] duration-200"
                              value={i.qty}
                              disabled={sending}
                              inputMode="numeric"
                              aria-label={`Cantidad de ${i.name}`}
                              style={{ width: `${Math.min(Math.max(String(i.qty).length * 0.82 + 2, 4), 8)}rem` }}
                              onChange={(e) => safeSetQty(i.productId, Number(e.target.value), i)}
                            />
                            <button
                              className="grid h-7 w-7 place-items-center rounded-md transition hover:bg-black/5 disabled:opacity-40"
                              onClick={() => safeSetQty(i.productId, i.qty + 1, i)}
                              title="Aumentar cantidad"
                              aria-label={`Aumentar cantidad de ${i.name}`}
                              disabled={sending}
                            >
                              <Plus size={16} aria-hidden="true" />
                            </button>
                          </div>
                          <p className="text-sm font-extrabold">{money(i.price * i.qty)}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {cart.items.length > 0 ? (
            <div className="mt-3 max-h-[46dvh] shrink-0 overflow-y-auto glass rounded-3xl p-3 sm:mt-4 sm:max-h-[52dvh] sm:p-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="text-xs font-semibold opacity-80">
                    Nombre <span className="text-red-400">*</span>
                  </label>
                  <input
                    ref={nameRef}
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    onBlur={() => setNameError(false)}
                    placeholder="Ej: Juan Pérez"
                    className={[
                      "ring-focus mt-2 w-full max-w-64 rounded-xl border px-3 py-2 text-sm",
                      nameError ? "cart-name-error" : "",
                      namePulse ? "cart-name-pulse" : "",
                    ].join(" ")}
                    style={{
                      borderColor: "var(--t-card-border)",
                      background:
                        "color-mix(in oklab, var(--t-card-bg) 86%, transparent)",
                      color: "var(--t-text)",
                    }}
                    disabled={sending}
                  />
                  {nameError ? (
                    <p className="mt-1 text-xs text-red-300">
                      Este campo es obligatorio.
                    </p>
                  ) : null}
                </div>
                <div className="sm:col-span-2">
                  <label className="text-xs font-semibold opacity-80">
                    Dirección / Observaciones{" "}
                    <span className="opacity-60">(opcional)</span>
                  </label>
                  <textarea
                    value={customerNote}
                    onChange={(e) => setCustomerNote(e.target.value)}
                    placeholder="Ej: Entregar en portería, apto 302. Pago contra entrega."
                    className="ring-focus mt-1.5 h-11 min-h-0 w-full rounded-xl border px-3 py-1.5 text-sm leading-5"
                    rows={1}
                    disabled={sending}
                    style={{
                      borderColor: "var(--t-card-border)",
                      background:
                        "color-mix(in oklab, var(--t-card-bg) 86%, transparent)",
                      color: "var(--t-text)",
                      resize: "vertical",
                      minHeight: 0,
                    }}
                  />
                </div>
              </div>

              <div className="mt-3">
                <p className="text-xs font-bold">
                  {(cart.contactChannels?.length ?? 0) > 1
                    ? "Primero, elige el asesor de tu punto de atención más cercano"
                    : "Tu pedido se enviará a"}
                </p>
                <div className="mt-2 grid max-h-32 gap-2 overflow-y-auto sm:grid-cols-2">
                  {(cart.contactChannels?.length
                    ? cart.contactChannels
                    : [{ id: "primary", label: "WhatsApp principal", phone: cart.whatsapp, icon: "other" as const }]
                  ).map((channel) => {
                    const selected = cart.selectedContactId === channel.id;
                    return (
                      <button
                        key={channel.id}
                        type="button"
                        onClick={() => setContactTarget(channel.id)}
                        disabled={sending}
                        aria-pressed={selected}
                        className="flex min-w-0 items-center gap-1.5 rounded-xl border p-1.5 text-left transition hover:brightness-105 disabled:opacity-60"
                        style={{
                          borderColor: selected ? "var(--t-accent)" : "var(--t-card-border)",
                          background: selected ? "color-mix(in oklab, var(--t-accent) 12%, var(--t-card-bg))" : "color-mix(in oklab, var(--t-card-bg) 86%, transparent)",
                        }}
                      >
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full" style={{ background: "color-mix(in oklab, var(--t-accent) 14%, transparent)", color: "var(--t-accent)" }}>
                          <StoreContactIcon icon={channel.icon} size={32} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs font-bold">{channel.label}</span>
                          <span className="block truncate text-[11px] opacity-70">{channel.phone}</span>
                        </span>
                        <span className="h-4 w-4 shrink-0 rounded-full border-2" style={{ borderColor: selected ? "var(--t-accent)" : "var(--t-card-border)", background: selected ? "var(--t-accent)" : "transparent", boxShadow: selected ? "inset 0 0 0 3px var(--t-card-bg)" : undefined }} />
                      </button>
                    );
                  })}
                </div>
                {(cart.contactChannels?.length ?? 0) > 1 && !cart.contactSelectionConfirmed ? (
                  <p className="mt-1 text-[11px] font-semibold" style={{ color: "var(--t-accent)" }}>
                    Selecciona el contacto más cercano para continuar.
                  </p>
                ) : null}
                <p className="mt-1 text-[11px] opacity-65">
                  El comprobante y el detalle del pedido se abrirán por WhatsApp con este asesor.
                </p>
              </div>

              <div className="mt-3 flex items-center justify-between">
                <p className="text-sm opacity-80">Total</p>
                <p className="text-lg font-extrabold">{money(total)}</p>
              </div>

              <div className="mt-2 flex gap-2">
                <button
                  className="btn-soft flex-1 px-4 py-2 text-sm font-semibold disabled:opacity-60"
                  onClick={empty}
                  disabled={cart.items.length === 0 || sending}
                >
                  Vaciar
                </button>

                <button
                  className="btn-cta flex-1 px-3 py-2 text-center text-xs font-bold sm:text-sm disabled:opacity-60"
                  onClick={generateAndSend}
                  disabled={cart.items.length === 0 || sending || ((cart.contactChannels?.length ?? 0) > 1 && !cart.contactSelectionConfirmed)}
                >
                  {sending ? "Procesando..." : "Generar pedido y WhatsApp"}
                </button>
              </div>

            </div>
            ) : null}
          </div>
        </div>
      )}
    </>
  );
}
