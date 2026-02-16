"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Swal from "sweetalert2";
import { supabaseBrowser } from "@/lib/supabase/client";

/* =========================================================
   Helpers
========================================================= */
function money(n: number) {
  return `$${Number(n || 0).toLocaleString("es-CO")}`;
}

function statusLabel(st: string) {
  if (st === "draft") return "Borrador (editable)";
  if (st === "sent") return "Enviado (editable)";
  if (st === "confirmed") return "Confirmado (bloqueado)";
  if (st === "completed") return "Completado (bloqueado)";
  return st;
}

/* =========================================================
   Types
========================================================= */
type Item = {
  product_id: string;
  name: string;
  image_url: string | null;
  price: number;
  qty: number;
};

type StoreExtra = {
  id: string;
  name: string;
  whatsapp: string;
  logo_url: string | null;
};

type StoreProfileLite = {
  address: string | null;
  city: string | null;
  department: string | null;
  description: string | null;
};

/* =========================================================
   Small UI pieces
========================================================= */
function Pill({
  children,
  tone = "soft",
}: {
  children: React.ReactNode;
  tone?: "soft" | "cta" | "green";
}) {
  const base =
    "inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold border backdrop-blur-xl";

  // ✅ ahora usa tokens (automático claro/oscuro)
  const style =
    tone === "cta"
      ? {
          borderColor: "var(--t-card-border)",
          background: "var(--t-card-bg)",
          color: "color-mix(in oklab, var(--t-text) 92%, transparent)",
        }
      : tone === "green"
        ? {
            borderColor: "color-mix(in oklab, var(--t-success, #22c55e) 35%, var(--t-card-border))",
            background: "color-mix(in oklab, var(--t-success, #22c55e) 14%, transparent)",
            color: "color-mix(in oklab, var(--t-text) 88%, var(--t-success, #22c55e) 12%)",
          }
        : {
            borderColor: "var(--t-card-border)",
            background: "var(--t-card-bg)",
            color: "color-mix(in oklab, var(--t-text) 85%, transparent)",
          };

  return (
    <span className={base} style={style as any}>
      {children}
    </span>
  );
}

function SoftBtn({
  children,
  onClick,
  disabled,
  title,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="btn-soft px-4 py-2 text-sm font-semibold disabled:opacity-60"
      type="button"
      // ✅ si tu .btn-soft ya usa tokens, esto no estorba; si no, lo hace automático
      style={
        {
          borderColor: "var(--t-card-border)",
          background: "var(--t-card-bg)",
          color: "color-mix(in oklab, var(--t-text) 90%, transparent)",
        } as any
      }
    >
      {children}
    </button>
  );
}

/* =========================================================
   Page
========================================================= */
export default function PedidoPage() {
  const params = useParams();
  const token = String((params as any).token);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [store, setStore] = useState<any>(null); // RPC
  const [order, setOrder] = useState<any>(null);
  const [items, setItems] = useState<Item[]>([]);

  const [storeExtra, setStoreExtra] = useState<StoreExtra | null>(null);
  const [profile, setProfile] = useState<StoreProfileLite | null>(null);

  // ✅ control de impresión (sin abrir otra pestaña)
  const [printMode, setPrintMode] = useState(false);

  /* -------------------------
     Memo
  ------------------------- */
  const total = useMemo(
    () => items.reduce((acc, i) => acc + Number(i.price) * Number(i.qty), 0),
    [items],
  );

  const isLocked = useMemo(() => {
    const st = String(order?.status ?? "draft");
    return st === "confirmed" || st === "completed";
  }, [order]);

  const receiptNumber = useMemo(() => {
    return order?.receipt_no ?? order?.order_no ?? order?.number ?? order?.seq ?? null;
  }, [order]);

  const storeName = storeExtra?.name ?? store?.name ?? "Tienda";
  const storeWhatsapp = storeExtra?.whatsapp ?? store?.whatsapp ?? "";
  const storeLogo = storeExtra?.logo_url ?? store?.logo_url ?? null;

  // ✅ Cliente / Observaciones (si no existen, muestra —)
  const customerName = useMemo(() => {
    return String(order?.customer_name ?? "").trim();
  }, [order]);

  // ⚠️ si aún no agregas customer_note en tu tabla, esto quedará siempre ""
  const customerNote = useMemo(() => {
    return String((order as any)?.customer_note ?? "").trim();
  }, [order]);

  const customerNameShow = customerName || "—";
  const customerNoteShow = customerNote || "—";

  /* -------------------------
     Load
  ------------------------- */
  async function load() {
    setLoading(true);

    try {
      const sb = supabaseBrowser();

      // 1) RPC principal
      const { data, error } = await sb.rpc("get_order_by_token", {
        p_token: token,
      });
      if (error) throw error;

      const storeRpc = data?.store ?? null;
      const orderRpc = data?.order ?? null;

      setStore(storeRpc);
      setOrder(orderRpc);

      setItems(
        (data?.items ?? []).map((i: any) => ({
          product_id: i.product_id,
          name: i.name,
          image_url: i.image_url ?? null,
          price: Number(i.price),
          qty: Number(i.qty),
        })),
      );

      // 2) storeId seguro
      const storeId = orderRpc?.store_id ?? storeRpc?.id ?? null;
      if (!storeId) throw new Error("No se encontró store_id del pedido.");

      // 3) tienda extra
      const { data: stData, error: stErr } = await sb
        .from("stores")
        .select("id,name,whatsapp,logo_url")
        .eq("id", storeId)
        .maybeSingle();

      if (stErr) throw stErr;
      if (!stData) throw new Error("No se encontró la tienda.");
      setStoreExtra(stData as StoreExtra);

      // 4) perfil tienda
      const { data: profData, error: profErr } = await sb
        .from("store_profiles")
        .select("address,city,department,description")
        .eq("store_id", storeId)
        .maybeSingle();

      if (profErr) throw profErr;
      setProfile((profData as StoreProfileLite) ?? null);
    } catch (err: any) {
      await Swal.fire({
        icon: "error",
        title: "Pedido no encontrado",
        text: err?.message ?? "Error",
        background: "color-mix(in oklab, var(--t-card-bg) 92%, black)",
        color: "var(--t-text)",
        confirmButtonColor: "var(--t-danger, #ef4444)",
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  /* -------------------------
     Print on demand (MISMA pestaña)
  ------------------------- */
  useEffect(() => {
    if (!printMode) return;

    const prevTitle = document.title;
    document.title = `Factura-${receiptNumber ?? token}`;

    const t = window.setTimeout(() => {
      try {
        window.print();
      } finally {
        // afterprint
      }
    }, 200);

    const onAfterPrint = () => {
      window.clearTimeout(t);
      setPrintMode(false);
      document.title = prevTitle;
    };

    window.addEventListener("afterprint", onAfterPrint);

    const fallback = window.setTimeout(() => {
      setPrintMode(false);
      document.title = prevTitle;
    }, 2500);

    return () => {
      window.removeEventListener("afterprint", onAfterPrint);
      window.clearTimeout(t);
      window.clearTimeout(fallback);
      document.title = prevTitle;
    };
  }, [printMode, receiptNumber, token]);

  function printNow() {
    setPrintMode(true);
  }

  /* -------------------------
     Actions
  ------------------------- */
  function setQty(productId: string, qty: number) {
    if (isLocked) return;
    const q = Math.max(1, Math.floor(Number(qty || 1)));
    setItems((prev) => prev.map((x) => (x.product_id === productId ? { ...x, qty: q } : x)));
  }

  async function saveChanges() {
    if (isLocked) {
      await Swal.fire({
        icon: "info",
        title: "Pedido bloqueado",
        text: "Este pedido ya fue confirmado y no se puede editar.",
        background: "color-mix(in oklab, var(--t-card-bg) 92%, black)",
        color: "var(--t-text)",
      });
      return;
    }

    setSaving(true);

    try {
      const sb = supabaseBrowser();

      const payload = items.map((i) => ({
        product_id: i.product_id,
        qty: i.qty,
      }));

      const { error } = await sb.rpc("update_order_items_by_token", {
        p_token: token,
        p_items: payload,
      });

      if (error) throw error;

      await Swal.fire({
        icon: "success",
        title: "Actualizado",
        text: "Tu pedido se guardó correctamente.",
        timer: 1200,
        showConfirmButton: false,
        background: "color-mix(in oklab, var(--t-card-bg) 92%, black)",
        color: "var(--t-text)",
      });

      await load();
    } catch (err: any) {
      const msg = String(err?.message ?? "");

      if (msg.includes("row-level security")) {
        await Swal.fire({
          icon: "info",
          title: "Pedido confirmado",
          html: `
            <p style="margin-bottom:8px">
              Este pedido ya fue <b>confirmado por el vendedor</b> y no se puede editar.
            </p>
            <p style="font-size:13px; opacity:.85">
              La página se actualizará para mostrar el estado correcto.
            </p>
          `,
          background: "color-mix(in oklab, var(--t-card-bg) 92%, black)",
          color: "var(--t-text)",
          confirmButtonColor: "var(--t-success, #22c55e)",
        });

        // 🔄 recargar para reflejar estado real
        window.location.reload();
        return;
      }

      // error genérico
      await Swal.fire({
        icon: "error",
        title: "No se pudo guardar",
        text: "Ocurrió un error inesperado.",
        background: "color-mix(in oklab, var(--t-card-bg) 92%, black)",
        color: "var(--t-text)",
        confirmButtonColor: "var(--t-danger, #ef4444)",
      });
    } finally {
      setSaving(false);
    }
  }

  async function confirmOrder() {
    if (isLocked) return;

    const res = await Swal.fire({
      icon: "warning",
      title: "Confirmar pedido",
      text: "Una vez confirmado, ya no podrás editarlo.",
      showCancelButton: true,
      confirmButtonText: "Sí, confirmar",
      cancelButtonText: "Cancelar",
      background: "color-mix(in oklab, var(--t-card-bg) 92%, black)",
      color: "var(--t-text)",
      confirmButtonColor: "var(--t-success, #22c55e)",
    });

    if (!res.isConfirmed) return;

    setSaving(true);

    try {
      const sb = supabaseBrowser();

      const { error } = await sb.rpc("confirm_order", { p_token: token });
      if (error) throw error;

      await Swal.fire({
        icon: "success",
        title: "Pedido confirmado",
        text: "Ya quedó registrado y no se puede editar.",
        timer: 1400,
        showConfirmButton: false,
        background: "color-mix(in oklab, var(--t-card-bg) 92%, black)",
        color: "var(--t-text)",
      });

      await load();
    } catch (err: any) {
      await Swal.fire({
        icon: "error",
        title: "No se pudo confirmar",
        text: err?.message ?? "Error",
        background: "color-mix(in oklab, var(--t-card-bg) 92%, black)",
        color: "var(--t-text)",
        confirmButtonColor: "var(--t-danger, #ef4444)",
      });
    } finally {
      setSaving(false);
    }
  }

  function sendWhatsApp() {
    if (!storeWhatsapp || !order) return;

    const lines: string[] = [];
    lines.push(`Hola, soy *${customerNameShow}* 👋`);
    lines.push(`Quiero confirmar este pedido:`);
    lines.push("");
    lines.push(`🏪 Tienda: *${storeName}*`);
    if (receiptNumber) lines.push(`🧾 Comprobante: *#${receiptNumber}*`);
    lines.push(`Estado: ${statusLabel(order.status)}`);
    lines.push(`📝 Observaciones: ${customerNoteShow}`);
    lines.push("");

    items.forEach((i, idx) => {
      lines.push(
        `${idx + 1}. ${i.name} — Cant: ${i.qty} — ${money(i.price)} c/u — Subtotal: ${money(i.price * i.qty)}`,
      );
    });

    lines.push("");
    lines.push(`💰 TOTAL: *${money(total)}*`);
    lines.push("");
    lines.push(`Link del comprobante: ${window.location.href}`);

    window.open(`https://wa.me/${storeWhatsapp}?text=${encodeURIComponent(lines.join("\n"))}`, "_blank");
  }

  /* -------------------------
     Render states
  ------------------------- */
  if (loading) {
    return (
      <main className="min-h-screen p-6">
        <div
          className="glass mx-auto max-w-3xl p-6"
          style={{
            borderColor: "var(--t-card-border)",
            background: "var(--t-card-bg)",
            color: "var(--t-text)",
          }}
        >
          <p className="text-sm" style={{ color: "var(--t-muted)" }}>
            Cargando comprobante...
          </p>
        </div>
      </main>
    );
  }

  if (!order) {
    return (
      <main className="min-h-screen p-6">
        <div
          className="glass mx-auto max-w-3xl p-6"
          style={{
            borderColor: "var(--t-card-border)",
            background: "var(--t-card-bg)",
            color: "var(--t-text)",
          }}
        >
          <p className="text-sm" style={{ color: "var(--t-muted)" }}>
            No se pudo cargar el pedido.
          </p>
        </div>
      </main>
    );
  }

  /* =========================================================
     UI
  ========================================================= */
  return (
    <main className="relative min-h-screen px-4 py-10 text-[color:var(--t-text)] print:bg-white print:text-black">
      {/* Fondo premium (auto claro/oscuro con tokens) */}
      <div className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute inset-0" style={{ background: "var(--t-bg-base)" }} />
        <div className="absolute inset-0" style={{ backgroundImage: "var(--t-bg)" }} />
        <div className="absolute inset-0 starfield opacity-[0.55]" />
        <div
          className="absolute inset-x-0 top-0 h-44"
          style={{
            background:
              "linear-gradient(to bottom, color-mix(in oklab, var(--t-bg-base) 0%, black 25%), transparent)",
          }}
        />
      </div>

      {/* Estilos impresión */}
      <style jsx global>{`
        @media print {
          .no-print {
            display: none !important;
          }
          .only-print {
            display: block !important;
          }
          .print-card {
            border: none !important;
            box-shadow: none !important;
            background: #fff !important;
            color: #000 !important;
          }
          @page {
            margin: 14mm;
          }
        }
        @media screen {
          .only-print {
            display: none !important;
          }
        }
      `}</style>

      {/* =========================================================
         ✅ FACTURA (solo impresión)
      ========================================================= */}
      <div className="only-print mx-auto max-w-3xl print-card rounded-2xl border border-white/10 p-6">
        <div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
          <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
            {storeLogo ? (
              <img
                src={storeLogo}
                alt="Logo"
                style={{
                  width: 70,
                  height: 70,
                  objectFit: "contain",
                  borderRadius: 10,
                  border: "1px solid rgba(0,0,0,0.12)",
                }}
              />
            ) : (
              <div
                style={{
                  width: 70,
                  height: 70,
                  borderRadius: 10,
                  border: "1px solid rgba(0,0,0,0.12)",
                }}
              />
            )}

            <div>
              <div style={{ fontSize: 18, fontWeight: 900 }}>{storeName}</div>

              {storeWhatsapp ? (
                <div style={{ fontSize: 12, marginTop: 4 }}>
                  WhatsApp: <b>{storeWhatsapp}</b>
                </div>
              ) : null}

              {/* ✅ CLIENTE + OBSERVACIONES (IMPRESIÓN) */}
              <div style={{ fontSize: 12, marginTop: 8 }}>
                Cliente: <b>{customerNameShow}</b>
              </div>
              <div style={{ fontSize: 12, marginTop: 2 }}>
                Observaciones: <b>{customerNoteShow}</b>
              </div>
            </div>
          </div>

          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 11, letterSpacing: 1, textTransform: "uppercase" }}>Factura de venta</div>
            <div style={{ fontSize: 22, fontWeight: 900, marginTop: 4 }}>#{receiptNumber ?? "—"}</div>
            <div style={{ fontSize: 11, marginTop: 4 }}>{new Date(order.created_at).toLocaleString("es-CO")}</div>
          </div>
        </div>

        <div style={{ height: 1, background: "rgba(0,0,0,0.12)", margin: "14px 0" }} />

        <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid rgba(0,0,0,0.12)" }}>
              <th style={{ textAlign: "left", padding: "8px 0", width: 60 }}>Cant</th>
              <th style={{ textAlign: "left", padding: "8px 0" }}>Descripción</th>
              <th style={{ textAlign: "right", padding: "8px 0", width: 120 }}>Precio Unit</th>
              <th style={{ textAlign: "right", padding: "8px 0", width: 120 }}>Subtotal</th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => {
              const sub = Number(i.price) * Number(i.qty);
              return (
                <tr key={i.product_id} style={{ borderBottom: "1px solid rgba(0,0,0,0.08)" }}>
                  <td style={{ padding: "8px 0" }}>{i.qty}</td>
                  <td style={{ padding: "8px 0" }}>{i.name}</td>
                  <td style={{ padding: "8px 0", textAlign: "right" }}>{money(i.price)}</td>
                  <td style={{ padding: "8px 0", textAlign: "right", fontWeight: 700 }}>{money(sub)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
          <div style={{ width: 260, border: "1px solid rgba(0,0,0,0.12)", borderRadius: 10, padding: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <div style={{ fontSize: 12 }}>TOTAL</div>
              <div style={{ fontSize: 16, fontWeight: 900 }}>{money(total)}</div>
            </div>
          </div>
        </div>

        <div style={{ fontSize: 11, marginTop: 14, opacity: 0.9 }}>
          {profile?.description ? (
            <div>{profile.description}</div>
          ) : (
            <div>Gracias por tu compra. Para cualquier información adicional, contáctanos por WhatsApp.</div>
          )}
        </div>
      </div>

      {/* =========================================================
         ✅ COMPROBANTE (pantalla)
      ========================================================= */}
      <div className={printMode ? "hidden" : "no-print mx-auto w-full max-w-3xl"}>
        <div
          className="glass p-6 md:p-7"
          style={{
            borderColor: "var(--t-card-border)",
            background: "var(--t-card-bg)",
            color: "var(--t-text)",
            boxShadow: "0 24px 70px color-mix(in oklab, black 45%, transparent)",
          }}
        >
          {/* Header */}
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-bold">Comprobante</h1>
                {receiptNumber ? <Pill>#{receiptNumber}</Pill> : null}
                <Pill tone="soft">
                  Estado: <span className="font-bold">{statusLabel(order.status)}</span>
                </Pill>
              </div>

              <p className="mt-2 text-sm" style={{ color: "var(--t-muted)" }}>
                {storeName} · {order.catalog_type === "retail" ? "Detal" : "Mayoristas"}
              </p>

              {/* ✅ CLIENTE + OBSERVACIONES (PANTALLA) */}
              <div className="mt-3 space-y-1">
                <p className="text-sm">
                  👋 Hola, <b className="opacity-100">{customerNameShow}</b>
                </p>
                <p className="text-sm" style={{ color: "var(--t-muted)" }}>
                  📝 Observaciones: <b style={{ color: "var(--t-text)" }}>{customerNoteShow}</b>
                </p>
              </div>

              <p className="mt-2 text-xs" style={{ color: "color-mix(in oklab, var(--t-muted) 92%, transparent)" }}>
                Guarda este link: siempre podrás volver.
              </p>

              {isLocked ? (
                <p
                  className="mt-2 text-xs"
                  style={{
                    color: "color-mix(in oklab, var(--t-warn, #f59e0b) 65%, var(--t-text))",
                  }}
                >
                  🔒 Este pedido está confirmado/completado y no se puede editar.
                </p>
              ) : null}
            </div>

            {/* Actions */}
            <div className="flex flex-wrap gap-2">
              <button
                onClick={sendWhatsApp}
                className="rounded-2xl px-4 py-2 text-sm font-semibold disabled:opacity-60"
                style={{
                  background:
                    "linear-gradient(90deg, color-mix(in oklab, var(--t-success, #22c55e) 95%, white 5%), color-mix(in oklab, var(--t-success, #22c55e) 75%, var(--t-accent2, #10b981) 25%))",
                  color: "color-mix(in oklab, var(--t-bg-base) 82%, black)",
                  boxShadow: "0 18px 45px color-mix(in oklab, var(--t-success, #22c55e) 22%, transparent)",
                }}
                disabled={saving}
                type="button"
              >
                Enviar WhatsApp
              </button>

              <SoftBtn
                onClick={confirmOrder}
                disabled={saving || isLocked}
                title={isLocked ? "Este pedido ya está bloqueado" : undefined}
              >
                Confirmar pedido
              </SoftBtn>

              <SoftBtn onClick={printNow} disabled={!order}>
                Imprimir
              </SoftBtn>
            </div>
          </div>

          {/* Items */}
          <div className="mt-6 space-y-3">
            {items.map((i) => {
              const subtotal = i.price * i.qty;

              return (
                <div
                  key={i.product_id}
                  className="glass-soft p-4"
                  style={{
                    borderColor: "var(--t-card-border)",
                    background: "color-mix(in oklab, var(--t-card-bg) 88%, transparent)",
                  }}
                >
                  <div className="flex gap-4">
                    <div
                      className="h-16 w-16 overflow-hidden rounded-2xl border"
                      style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)" }}
                    >
                      {i.image_url ? (
                        <img src={i.image_url} className="h-full w-full object-cover" alt={i.name} />
                      ) : null}
                    </div>

                    <div className="flex-1">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold">{i.name}</p>
                          <p className="text-sm" style={{ color: "var(--t-muted)" }}>
                            {money(i.price)}
                          </p>
                        </div>

                        <Pill tone="soft">{money(subtotal)}</Pill>
                      </div>

                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <button
                          className="btn-soft px-3 py-2 text-sm font-semibold disabled:opacity-50"
                          style={{
                            borderColor: "var(--t-card-border)",
                            background: "var(--t-card-bg)",
                            color: "var(--t-text)",
                          }}
                          onClick={() => setQty(i.product_id, i.qty - 1)}
                          disabled={saving || isLocked}
                          type="button"
                        >
                          −
                        </button>

                        <input
                          className="ring-focus w-24 px-3 py-2 text-center text-sm disabled:opacity-50"
                          style={{
                            background: "color-mix(in oklab, var(--t-card-bg) 92%, transparent)",
                            border: "1px solid var(--t-card-border)",
                            borderRadius: "16px",
                            color: "var(--t-text)",
                          }}
                          value={i.qty}
                          onChange={(e) => setQty(i.product_id, Number(e.target.value))}
                          disabled={saving || isLocked}
                        />

                        <button
                          className="btn-soft px-3 py-2 text-sm font-semibold disabled:opacity-50"
                          style={{
                            borderColor: "var(--t-card-border)",
                            background: "var(--t-card-bg)",
                            color: "var(--t-text)",
                          }}
                          onClick={() => setQty(i.product_id, i.qty + 1)}
                          disabled={saving || isLocked}
                          type="button"
                        >
                          +
                        </button>

                        <span className="ml-auto text-xs" style={{ color: "var(--t-muted)" }}>
                          Subtotal: <b style={{ color: "var(--t-text)" }}>{money(subtotal)}</b>
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Total + Save */}
          <div
            className="mt-6 glass-soft p-5"
            style={{
              borderColor: "var(--t-card-border)",
              background: "color-mix(in oklab, var(--t-card-bg) 88%, transparent)",
            }}
          >
            <div className="flex items-center justify-between">
              <p className="text-sm" style={{ color: "var(--t-muted)" }}>
                Total
              </p>
              <p className="text-2xl font-extrabold">{money(total)}</p>
            </div>

            <button
              onClick={saveChanges}
              className="btn-cta mt-4 w-full px-4 py-3 text-sm font-semibold disabled:opacity-60"
              disabled={saving || isLocked}
              type="button"
              style={
                {
                  // ✅ si tu .btn-cta ya usa tokens, esto no molesta; si no, lo hace automático
                  borderColor: "color-mix(in oklab, var(--t-accent2) 35%, var(--t-card-border))",
                  background: "color-mix(in oklab, var(--t-cta) 18%, transparent)",
                  color: "color-mix(in oklab, var(--t-text) 92%, transparent)",
                  boxShadow: "0 18px 45px color-mix(in oklab, var(--t-cta) 18%, transparent)",
                } as any
              }
            >
              {saving ? "Guardando..." : "Guardar cambios"}
            </button>

            {!isLocked ? (
              <p className="mt-3 text-xs" style={{ color: "var(--t-muted)" }}>
                Tip: edita cantidades y luego envía por WhatsApp. El pedido queda guardado en este link.
              </p>
            ) : (
              <p className="mt-3 text-xs" style={{ color: "var(--t-muted)" }}>
                Este pedido ya fue confirmado. Si necesitas cambios, crea un nuevo pedido desde el catálogo.
              </p>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
