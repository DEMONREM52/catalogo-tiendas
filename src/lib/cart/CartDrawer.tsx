"use client";

import { useMemo } from "react";
import { useCart } from "./CartProvider";
import Swal from "sweetalert2";
import { supabaseBrowser } from "@/lib/supabase/client";

function money(n: number) {
  return `$${Number(n || 0).toLocaleString("es-CO")}`;
}

export function CartDrawer() {
  const { cart, isOpen, open, close, setQty, removeItem, empty, total, count } =
    useCart();

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

    const lines: string[] = [];
    lines.push(`🧾 Pedido (${cart.mode === "detal" ? "DETAL" : "MAYOR"})`);
    lines.push(`🏪 Tienda: ${cart.storeName}`);
    lines.push(``);

    cart.items.forEach((i, idx) => {
      lines.push(`${idx + 1}. ${i.name}`);
      lines.push(
        `   Cant: ${i.qty} | Precio: ${money(i.price)} | Subtotal: ${money(
          i.price * i.qty
        )}`
      );
      if (cart.mode === "mayor" && i.minWholesale) {
        lines.push(`   (mínimo mayor: ${minAllowed(i)})`);
      }
    });

    lines.push(``);
    lines.push(`TOTAL: ${money(total)}`);
    lines.push(``);
    lines.push(`✅ Quiero confirmar este pedido.`);

    return lines.join("\n");
  }, [cart, total]);

  async function generateAndSend() {
    if (!cart) return;

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

    try {
      const payload = cart.items.map((i) => ({
        product_id: i.productId,
        qty: i.qty,
        price: i.price,
      }));

      const sb = supabaseBrowser(); // ✅ IMPORTANTE

      const { data, error } = await sb.rpc("create_order_from_cart", {
        p_store_id: cart.storeId,
        p_catalog_type: cart.mode === "detal" ? "retail" : "wholesale",
        p_items: payload,
      });

      if (error) throw error;

      const token = (data as any)?.token as string;
      if (!token) throw new Error("No se generó token.");

      const invoiceUrl = `${window.location.origin}/pedido/${token}`;

      const waText = [
        whatsText,
        ``,
        `📌 Comprobante (puedes editar):`,
        invoiceUrl,
      ].join("\n");

      window.open(
        `https://wa.me/${cart.whatsapp}?text=${encodeURIComponent(waText)}`,
        "_blank"
      );

      window.open(invoiceUrl, "_blank");

      await Swal.fire({
        icon: "success",
        title: "Comprobante generado",
        text: "Se creó el pedido y se abrió WhatsApp.",
        timer: 1200,
        showConfirmButton: false,
        background: "#0b0b0b",
        color: "#fff",
      });
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

  return (
    <>
      <button
        onClick={() => (isOpen ? close() : open())}
        className="fixed bottom-4 right-4 z-40 rounded-2xl border border-white/10 bg-black/70 px-4 py-3 text-sm font-semibold"
        style={{ backdropFilter: "blur(10px)" }}
        aria-label="Abrir carrito"
      >
        🛒 Carrito ({count})
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/60" onClick={close} />

          <div
            className="absolute right-0 top-0 h-full w-full max-w-md border-l border-white/10 bg-black/80 p-4"
            style={{ backdropFilter: "blur(12px)" }}
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold">Tu carrito</h3>
                <p className="text-sm opacity-80 mt-1">
                  {cart.mode === "detal" ? "Detal" : "Mayoristas"} ·{" "}
                  {cart.storeName}
                </p>
              </div>

              <button
                className="rounded-xl border border-white/10 px-3 py-1 text-sm"
                onClick={close}
              >
                Cerrar
              </button>
            </div>

            <div className="mt-4 space-y-3">
              {cart.items.length === 0 ? (
                <div className="rounded-2xl border border-white/10 p-4">
                  <p className="text-lg font-semibold">Tu carrito está vacío</p>
                  <p className="mt-2 text-sm opacity-80">
                    Agrega productos desde el catálogo para crear tu comprobante
                    y enviarlo por WhatsApp.
                  </p>

                  <div className="mt-4 flex gap-2">
                    <button
                      className="flex-1 rounded-xl border border-white/10 px-4 py-2"
                      onClick={close}
                    >
                      Seguir mirando
                    </button>

                    <a
                      className="flex-1 rounded-xl px-4 py-2 text-center font-semibold"
                      style={{ background: "var(--brand)", color: "#0b0b0b" }}
                      href={`/${cart.storeSlug}/${cart.mode}`}
                    >
                      Ir al catálogo
                    </a>
                  </div>
                </div>
              ) : (
                cart.items.map((i) => {
                  const min = minAllowed(i);

                  return (
                    <div
                      key={i.productId}
                      className="rounded-2xl border border-white/10 p-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-semibold truncate">{i.name}</p>
                          <p className="text-sm opacity-80">
                            {money(i.price)}{" "}
                            <span className="opacity-60">c/u</span>
                          </p>

                          {cart.mode === "mayor" && i.minWholesale ? (
                            <p className="text-xs opacity-70">
                              Mínimo mayor: {min}
                            </p>
                          ) : null}
                        </div>

                        <button
                          className="rounded-xl border border-white/10 px-3 py-1 text-sm"
                          onClick={() => removeItem(i.productId)}
                        >
                          Quitar
                        </button>
                      </div>

                      <div className="mt-3 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <button
                            className="rounded-xl border border-white/10 px-3 py-1"
                            onClick={() =>
                              safeSetQty(i.productId, i.qty - 1, i)
                            }
                            disabled={i.qty <= min}
                            title={
                              i.qty <= min ? `Mínimo: ${min}` : "Disminuir"
                            }
                          >
                            -
                          </button>

                          <input
                            type="number"
                            min={min}
                            className="w-20 rounded-xl border border-white/10 bg-transparent px-3 py-1 text-center"
                            value={i.qty}
                            onChange={(e) =>
                              safeSetQty(
                                i.productId,
                                Number(e.target.value),
                                i
                              )
                            }
                          />

                          <button
                            className="rounded-xl border border-white/10 px-3 py-1"
                            onClick={() =>
                              safeSetQty(i.productId, i.qty + 1, i)
                            }
                            title="Aumentar"
                          >
                            +
                          </button>
                        </div>

                        <p className="font-semibold">{money(i.price * i.qty)}</p>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div className="mt-4 rounded-2xl border border-white/10 p-4">
              <div className="flex items-center justify-between">
                <p className="text-sm opacity-80">Total</p>
                <p className="text-lg font-bold">{money(total)}</p>
              </div>

              <div className="mt-3 flex gap-2">
                <button
                  className="flex-1 rounded-xl border border-white/10 px-4 py-2"
                  onClick={empty}
                  disabled={cart.items.length === 0}
                >
                  Vaciar
                </button>

                <button
                  className="flex-1 rounded-xl px-4 py-2 text-center font-semibold"
                  style={{ background: "var(--brand)", color: "#0b0b0b" }}
                  onClick={generateAndSend}
                  disabled={cart.items.length === 0}
                >
                  Generar comprobante + WhatsApp
                </button>
              </div>

              <p className="mt-2 text-xs opacity-70">
                Tip: el comprobante queda guardado en un link y puedes editar
                cantidades después.
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
