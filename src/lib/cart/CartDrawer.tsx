"use client";

import { useMemo, useRef, useState } from "react";
import Swal from "sweetalert2";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useCart } from "./CartProvider";

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
  } = useCart();

  const nameRef = useRef<HTMLInputElement | null>(null);

  // ✅ UI feedback validación nombre
  const [nameError, setNameError] = useState(false);
  const [namePulse, setNamePulse] = useState(false);

  function minAllowed(i: { minWholesale?: number | null }) {
    if (!cart) return 1;
    if (cart.mode !== "mayor") return 1;
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
    lines.push(`Hola, soy *${customer || "—"}* 👋`);
    lines.push(`Quiero hacer este pedido:`);
    lines.push("");
    lines.push(`🧾 Pedido: *${cart.mode === "detal" ? "DETAL" : "MAYOR"}*`);
    lines.push(`🏪 Tienda: *${cart.storeName}*`);
    lines.push(`📝 Observaciones: ${note || "—"}`);
    lines.push("");
    lines.push(`📦 Productos:`);

    cart.items.forEach((i, idx) => {
      lines.push(
        `${idx + 1}. ${i.name} — Cant: ${i.qty} — ${money(i.price)} c/u — Subtotal: ${money(
          i.price * i.qty
        )}`
      );
      if (cart.mode === "mayor" && i.minWholesale) {
        lines.push(`   (mínimo mayor: ${minAllowed(i)})`);
      }
    });

    lines.push("");
    lines.push(`💰 TOTAL: *${money(total)}*`);
    lines.push("");
    lines.push(`✅ Quedo atento para confirmar. Gracias.`);

    return lines.join("\n");
  }, [cart, total]);

  function bumpNameError() {
    setNameError(true);
    setNamePulse(true);
    window.setTimeout(() => setNamePulse(false), 520);
    window.setTimeout(() => setNameError(false), 3000);
    nameRef.current?.focus();
  }

  async function generateAndSend() {
    if (!cart) return;

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

    if (cart.mode === "mayor") {
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

    try {
      const payload = cart.items.map((i) => ({
        product_id: i.productId,
        qty: i.qty,
        price: i.price,
      }));

      const sb = supabaseBrowser();

      const { data, error } = await sb.rpc("create_order_from_cart", {
        p_store_id: cart.storeId,
        p_catalog_type: cart.mode === "detal" ? "retail" : "wholesale",
        p_items: payload,
        p_customer_name: customer,
        p_customer_note: (cart.customerNote ?? "").trim(),
      });

      if (error) throw error;

      const token = (data as any)?.token as string;
      if (!token) throw new Error("No se generó token.");

      const invoiceUrl = `${window.location.origin}/pedido/${token}`;

      const waText = [whatsText, "", `📌 Comprobante (puedes editar):`, invoiceUrl].join("\n");

      window.open(
        `https://wa.me/${cart.whatsapp}?text=${encodeURIComponent(waText)}`,
        "_blank"
      );

      const res = await Swal.fire({
        icon: "success",
        title: "Comprobante generado",
        html: `
          <div style="text-align:left; opacity:.9">
            <div style="margin-bottom:10px;">
              Se creó el pedido y se abrió WhatsApp.
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
          text: ok ? "Link copiado al portapapeles." : "Tu navegador bloqueó el copiado.",
          timer: 1000,
          showConfirmButton: false,
          background: "#0b0b0b",
          color: "#fff",
        });
      }
    } catch (err: any) {
      await Swal.fire({
        icon: "error",
        title: "No se pudo generar el comprobante",
        text: err?.message ?? "Error",
        background: "#0b0b0b",
        color: "#fff",
        confirmButtonColor: "#ef4444",
      });
    }
  }

  if (!cart) return null;

  const customerName = cart.customerName ?? "";
  const customerNote = cart.customerNote ?? "";

  return (
    <>
      <style jsx global>{`
        @keyframes cartPulseRed {
          0% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0); }
          20% { box-shadow: 0 0 0 6px rgba(239, 68, 68, 0.25); }
          40% { box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.18); }
          60% { box-shadow: 0 0 0 6px rgba(239, 68, 68, 0.25); }
          100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0); }
        }
        .cart-name-error {
          border-color: rgba(239, 68, 68, 0.65) !important;
          box-shadow: 0 0 0 4px rgba(239, 68, 68, 0.18) !important;
        }
        .cart-name-pulse {
          animation: cartPulseRed 0.52s ease-in-out;
        }
      `}</style>

      <button
        onClick={() => (isOpen ? close() : open())}
        className="fixed bottom-4 right-4 z-40 rounded-2xl border border-white/10 bg-black/70 px-4 py-3 text-sm font-semibold text-white"
        style={{ backdropFilter: "blur(10px)" }}
        aria-label="Abrir carrito"
      >
        🛒 Carrito ({count})
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/60" onClick={close} />

          <div
            className="absolute right-0 top-0 h-dvh w-full max-w-md border-l border-white/10 bg-black/70 p-4 flex flex-col"
            style={{ backdropFilter: "blur(14px)" }}
          >
            <div className="shrink-0 glass flex items-start justify-between gap-3 p-4">
              <div className="min-w-0">
                <h3 className="text-lg font-semibold">Tu carrito</h3>
                <p className="mt-1 text-sm opacity-80">
                  {cart.mode === "detal" ? "Detal" : "Mayoristas"} ·{" "}
                  <span className="font-semibold">{cart.storeName}</span>
                </p>
              </div>

              <button className="btn-soft px-3 py-2 text-xs font-semibold" onClick={close}>
                Cerrar
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto mt-4 pr-1">
              <div className="space-y-3 pb-4">
                {cart.items.map((i) => {
                  const min = minAllowed(i);
                  return (
                    <div key={i.productId} className="glass-soft p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate font-semibold">{i.name}</p>
                          <p className="text-sm opacity-80">
                            {money(i.price)} <span className="opacity-60">c/u</span>
                          </p>
                          {cart.mode === "mayor" && i.minWholesale ? (
                            <p className="mt-1 text-xs opacity-70">Mínimo mayor: {min}</p>
                          ) : null}
                        </div>

                        <button className="btn-soft px-3 py-2 text-xs font-semibold" onClick={() => removeItem(i.productId)}>
                          Quitar
                        </button>
                      </div>

                      <div className="mt-3 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <button
                            className="btn-soft px-3 py-2 text-sm font-semibold disabled:opacity-50"
                            onClick={() => safeSetQty(i.productId, i.qty - 1, i)}
                            disabled={i.qty <= min}
                            title={i.qty <= min ? `Mínimo: ${min}` : "Disminuir"}
                          >
                            −
                          </button>

                          <input
                            type="number"
                            min={min}
                            className="ring-focus w-20 px-3 py-2 text-center text-sm"
                            value={i.qty}
                            onChange={(e) => safeSetQty(i.productId, Number(e.target.value), i)}
                          />

                          <button className="btn-soft px-3 py-2 text-sm font-semibold" onClick={() => safeSetQty(i.productId, i.qty + 1, i)}>
                            +
                          </button>
                        </div>

                        <p className="text-sm font-semibold">{money(i.price * i.qty)}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="shrink-0 mt-4 glass p-4">
              <div className="space-y-2">
                <div>
                  <label className="text-xs font-semibold opacity-80">
                    Nombre <span className="text-red-400">*</span>
                  </label>
                  <input
                    ref={nameRef}
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    placeholder="Ej: Juan Pérez"
                    className={[
                      "ring-focus mt-2 w-full rounded-xl border px-3 py-2 text-sm",
                      nameError ? "cart-name-error" : "",
                      namePulse ? "cart-name-pulse" : "",
                    ].join(" ")}
                    style={{
                      borderColor: "var(--t-card-border)",
                      background: "color-mix(in oklab, var(--t-card-bg) 86%, transparent)",
                      color: "var(--t-text)",
                    }}
                  />
                  {nameError ? <p className="mt-1 text-xs text-red-300">Este campo es obligatorio.</p> : null}
                </div>

                <div>
                  <label className="text-xs font-semibold opacity-80">
                    Dirección / Observaciones <span className="opacity-60">(opcional)</span>
                  </label>
                  <textarea
                    value={customerNote}
                    onChange={(e) => setCustomerNote(e.target.value)}
                    placeholder="Ej: Entregar en portería, apto 302. Pago contra entrega."
                    className="ring-focus mt-2 w-full rounded-xl border px-3 py-2 text-sm"
                    rows={3}
                    style={{
                      borderColor: "var(--t-card-border)",
                      background: "color-mix(in oklab, var(--t-card-bg) 86%, transparent)",
                      color: "var(--t-text)",
                      resize: "none",
                    }}
                  />
                </div>
              </div>

              <div className="mt-4 flex items-center justify-between">
                <p className="text-sm opacity-80">Total</p>
                <p className="text-lg font-extrabold">{money(total)}</p>
              </div>

              <div className="mt-3 flex gap-2">
                <button className="btn-soft flex-1 px-4 py-2 text-sm font-semibold" onClick={empty} disabled={cart.items.length === 0}>
                  Vaciar
                </button>

                <button className="btn-cta flex-1 px-4 py-2 text-sm font-semibold" onClick={generateAndSend} disabled={cart.items.length === 0}>
                  Generar + WhatsApp
                </button>
              </div>

              <p className="mt-2 text-xs opacity-70">
                Tip: el comprobante queda guardado en un link y puedes editar cantidades después.
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
