"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Swal from "sweetalert2";
import { supabaseBrowser } from "@/lib/supabase/client";

function money(n: number) {
  return `$${Number(n || 0).toLocaleString("es-CO")}`;
}

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
  description: string | null; // 👈 aquí va tu “descripción de la empresa”
};

export default function PedidoPage() {
  const params = useParams();
  const token = String((params as any).token);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [store, setStore] = useState<any>(null); // viene del RPC
  const [storeExtra, setStoreExtra] = useState<StoreExtra | null>(null); // logo, whatsapp, name (seguro)
  const [profile, setProfile] = useState<StoreProfileLite | null>(null);

  const [order, setOrder] = useState<any>(null);
  const [items, setItems] = useState<Item[]>([]);

  const total = useMemo(() => {
    return items.reduce((acc, i) => acc + Number(i.price) * Number(i.qty), 0);
  }, [items]);

  const isLocked = useMemo(() => {
    const st = String(order?.status ?? "draft");
    return st === "confirmed" || st === "completed";
  }, [order]);

  // ✅ Número de comprobante / factura (con fallback)
  const receiptNumber = useMemo(() => {
    return (
      order?.receipt_no ??
      order?.order_no ??
      order?.number ??
      order?.seq ??
      null
    );
  }, [order]);

  function statusLabel(st: string) {
    if (st === "draft") return "Borrador (editable)";
    if (st === "sent") return "Enviado (editable)";
    if (st === "confirmed") return "Confirmado (bloqueado)";
    if (st === "completed") return "Completado (bloqueado)";
    return st;
  }

  const addressLine = useMemo(() => {
    if (!profile) return "";
    const parts = [profile.address, profile.city, profile.department]
      .map((x) => (x ?? "").trim())
      .filter(Boolean);
    return parts.join(" · ");
  }, [profile]);

  async function load() {
    setLoading(true);

    try {
      const sb = supabaseBrowser();

      // 1) Tu RPC
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

      // 2) Cargar info extra de tienda (logo + whatsapp + name)
      const storeId = orderRpc?.store_id ?? storeRpc?.id ?? null;
      if (!storeId) throw new Error("No se encontró store_id del pedido.");

      const { data: stData, error: stErr } = await sb
        .from("stores")
        .select("id,name,whatsapp,logo_url")
        .eq("id", storeId)
        .maybeSingle();

      if (stErr) throw stErr;
      if (!stData) throw new Error("No se encontró la tienda.");

      setStoreExtra(stData as StoreExtra);

      // 3) Cargar perfil (dirección + descripción empresa)
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
        background: "#0b0b0b",
        color: "#fff",
        confirmButtonColor: "#ef4444",
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  function setQty(productId: string, qty: number) {
    if (isLocked) return;
    const q = Math.max(1, Math.floor(Number(qty || 1)));

    setItems((prev) =>
      prev.map((x) => (x.product_id === productId ? { ...x, qty: q } : x)),
    );
  }

  async function saveChanges() {
    if (isLocked) {
      await Swal.fire({
        icon: "info",
        title: "Pedido bloqueado",
        text: "Este pedido ya fue confirmado y no se puede editar.",
        background: "#0b0b0b",
        color: "#fff",
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
        background: "#0b0b0b",
        color: "#fff",
      });

      await load();
    } catch (err: any) {
      await Swal.fire({
        icon: "error",
        title: "No se pudo guardar",
        text: err?.message ?? "Error",
        background: "#0b0b0b",
        color: "#fff",
        confirmButtonColor: "#ef4444",
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
      background: "#0b0b0b",
      color: "#fff",
      confirmButtonColor: "#22c55e",
    });

    if (!res.isConfirmed) return;

    setSaving(true);

    try {
      const sb = supabaseBrowser();

      const { error } = await sb.rpc("confirm_order", {
        p_token: token,
      });

      if (error) throw error;

      await Swal.fire({
        icon: "success",
        title: "Pedido confirmado",
        text: "Ya quedó registrado y no se puede editar.",
        timer: 1400,
        showConfirmButton: false,
        background: "#0b0b0b",
        color: "#fff",
      });

      await load();
    } catch (err: any) {
      await Swal.fire({
        icon: "error",
        title: "No se pudo confirmar",
        text: err?.message ?? "Error",
        background: "#0b0b0b",
        color: "#fff",
        confirmButtonColor: "#ef4444",
      });
    } finally {
      setSaving(false);
    }
  }

  function sendWhatsApp() {
    const wa = storeExtra?.whatsapp ?? store?.whatsapp;
    const storeName = storeExtra?.name ?? store?.name;

    if (!wa || !order) return;

    const lines: string[] = [];
    lines.push(
      `🧾 Pedido (${order.catalog_type === "retail" ? "DETAL" : "MAYOR"})`,
    );
    lines.push(`🏪 Tienda: ${storeName}`);
    if (receiptNumber) lines.push(`🧾 Comprobante: #${receiptNumber}`);
    lines.push(`Estado: ${statusLabel(order.status)}`);
    lines.push("");

    items.forEach((i, idx) => {
      lines.push(`${idx + 1}. ${i.name}`);
      lines.push(
        `   Cant: ${i.qty} | Precio: ${money(i.price)} | Subtotal: ${money(
          i.price * i.qty,
        )}`,
      );
    });

    lines.push("");
    lines.push(`TOTAL: ${money(total)}`);
    lines.push("");
    lines.push(`Link del comprobante: ${window.location.href}`);
    lines.push(`✅ Quiero confirmar este pedido.`);

    window.open(
      `https://wa.me/${wa}?text=${encodeURIComponent(lines.join("\n"))}`,
      "_blank",
    );
  }

  function printPDF() {
    window.print();
  }

  if (loading) {
    return (
      <main className="p-6">
        <p>Cargando comprobante...</p>
      </main>
    );
  }

  if (!order) {
    return (
      <main className="p-6">
        <p>No se pudo cargar el pedido.</p>
      </main>
    );
  }

  const storeName = storeExtra?.name ?? store?.name ?? "Tienda";
  const storeWhatsapp = storeExtra?.whatsapp ?? store?.whatsapp ?? "";
  const storeLogo = storeExtra?.logo_url ?? store?.logo_url ?? null;

  return (
    <main className="min-h-screen p-6 bg-black text-white print:bg-white print:text-black">
      {/* ✅ Estilos de impresión: muestra factura y oculta el comprobante */}
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
        }
        @media screen {
          .only-print {
            display: none !important;
          }
        }
      `}</style>

      {/* ✅ BOTÓN PDF (solo pantalla) */}
      <div className="no-print mx-auto max-w-3xl mb-4 flex justify-end gap-2">
        <button
          onClick={printPDF}
          className="rounded-xl px-4 py-2 font-semibold"
          style={{ background: "#fff", color: "#0b0b0b" }}
        >
          Descargar PDF / Imprimir
        </button>
      </div>

      {/* ========================================================= */}
      {/* ✅ FACTURA PARA PDF (solo imprime) */}
      {/* ========================================================= */}
      <div className="only-print mx-auto max-w-3xl print-card rounded-2xl border border-white/10 p-6">
        {/* Header factura */}
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
              <div style={{ fontSize: 18, fontWeight: 800 }}>{storeName}</div>
              {addressLine ? (
                <div style={{ fontSize: 12, marginTop: 4 }}>{addressLine}</div>
              ) : null}
              {storeWhatsapp ? (
                <div style={{ fontSize: 12, marginTop: 4 }}>
                  WhatsApp: <b>{storeWhatsapp}</b>
                </div>
              ) : null}
            </div>
          </div>

          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 11, letterSpacing: 1, textTransform: "uppercase" }}>
              Factura de venta
            </div>
            <div style={{ fontSize: 22, fontWeight: 900, marginTop: 4 }}>
              #{receiptNumber ?? "—"}
            </div>
            <div style={{ fontSize: 11, marginTop: 4 }}>
              {new Date(order.created_at).toLocaleString("es-CO")}
            </div>
          </div>
        </div>

        <div style={{ height: 1, background: "rgba(0,0,0,0.12)", margin: "14px 0" }} />

        {/* Tabla */}
        <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid rgba(0,0,0,0.12)" }}>
              <th style={{ textAlign: "left", padding: "8px 0", width: 60 }}>Cant</th>
              <th style={{ textAlign: "left", padding: "8px 0" }}>Descripción</th>
              <th style={{ textAlign: "right", padding: "8px 0", width: 120 }}>
                Precio Unit
              </th>
              <th style={{ textAlign: "right", padding: "8px 0", width: 120 }}>
                Subtotal
              </th>
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
                  <td style={{ padding: "8px 0", textAlign: "right", fontWeight: 700 }}>
                    {money(sub)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* Total */}
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
          <div
            style={{
              width: 260,
              border: "1px solid rgba(0,0,0,0.12)",
              borderRadius: 10,
              padding: 12,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <div style={{ fontSize: 12 }}>TOTAL</div>
              <div style={{ fontSize: 16, fontWeight: 900 }}>{money(total)}</div>
            </div>
          </div>
        </div>

        {/* Descripción empresa */}
        <div style={{ fontSize: 11, marginTop: 14, opacity: 0.9 }}>
          {profile?.description ? (
            <div>{profile.description}</div>
          ) : (
            <div>
              Gracias por tu compra. Para cualquier información adicional, contáctanos por WhatsApp.
            </div>
          )}
        </div>
      </div>

      {/* ========================================================= */}
      {/* ✅ TU COMPROBANTE NORMAL (pantalla) */}
      {/* ========================================================= */}
      <div className="no-print mx-auto max-w-3xl rounded-2xl border border-white/10 p-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold">Comprobante</h1>
              {receiptNumber ? (
                <span className="rounded-xl border border-white/10 px-3 py-1 text-sm font-semibold">
                  #{receiptNumber}
                </span>
              ) : null}
            </div>

            <p className="text-sm opacity-80">
              {storeName} · {order.catalog_type === "retail" ? "Detal" : "Mayoristas"}
            </p>

            <div className="mt-2 inline-flex items-center gap-2 rounded-xl border border-white/10 px-3 py-1 text-xs opacity-90">
              <span className="opacity-70">Estado:</span>
              <b>{statusLabel(order.status)}</b>
            </div>

            <p className="text-xs opacity-60 mt-2">
              Guarda este link: siempre podrás volver.
            </p>

            {isLocked ? (
              <p className="mt-2 text-xs text-yellow-300/90">
                🔒 Este pedido está confirmado/completado y no se puede editar.
              </p>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={sendWhatsApp}
              className="rounded-xl px-4 py-2 font-semibold"
              style={{ background: "#22c55e", color: "#0b0b0b" }}
              disabled={saving}
            >
              Enviar WhatsApp
            </button>

            <button
              onClick={confirmOrder}
              className="rounded-xl px-4 py-2 font-semibold"
              style={{ background: "#fff", color: "#0b0b0b" }}
              disabled={saving || isLocked}
              title={isLocked ? "Este pedido ya está bloqueado" : ""}
            >
              Confirmar pedido
            </button>
          </div>
        </div>

        <div className="mt-6 space-y-3">
          {items.map((i) => (
            <div key={i.product_id} className="rounded-2xl border border-white/10 p-4">
              <div className="flex gap-3">
                <div className="h-16 w-16 overflow-hidden rounded-xl border border-white/10 bg-white/5">
                  {i.image_url ? (
                    <img
                      src={i.image_url}
                      className="h-full w-full object-cover"
                      alt={i.name}
                    />
                  ) : null}
                </div>

                <div className="flex-1">
                  <p className="font-semibold">{i.name}</p>
                  <p className="text-sm opacity-80">{money(i.price)}</p>

                  <div className="mt-2 flex items-center gap-2">
                    <button
                      className="rounded-xl border border-white/10 px-3 py-1 disabled:opacity-40"
                      onClick={() => setQty(i.product_id, i.qty - 1)}
                      disabled={saving || isLocked}
                    >
                      -
                    </button>

                    <input
                      className="w-20 rounded-xl border border-white/10 bg-transparent px-3 py-1 text-center disabled:opacity-50"
                      value={i.qty}
                      onChange={(e) => setQty(i.product_id, Number(e.target.value))}
                      disabled={saving || isLocked}
                    />

                    <button
                      className="rounded-xl border border-white/10 px-3 py-1 disabled:opacity-40"
                      onClick={() => setQty(i.product_id, i.qty + 1)}
                      disabled={saving || isLocked}
                    >
                      +
                    </button>

                    <div className="ml-auto font-semibold">
                      {money(i.price * i.qty)}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-6 rounded-2xl border border-white/10 p-4">
          <div className="flex items-center justify-between">
            <p className="opacity-80">Total</p>
            <p className="text-xl font-bold">{money(total)}</p>
          </div>

          <button
            onClick={saveChanges}
            className="mt-3 w-full rounded-xl px-4 py-2 font-semibold disabled:opacity-60"
            style={{ background: "#fff", color: "#0b0b0b" }}
            disabled={saving || isLocked}
          >
            {saving ? "Guardando..." : "Guardar cambios"}
          </button>

          {!isLocked ? (
            <p className="mt-2 text-xs opacity-70">
              Tip: puedes editar cantidades y luego enviar por WhatsApp. El pedido queda guardado en este link.
            </p>
          ) : (
            <p className="mt-2 text-xs opacity-70">
              Este pedido ya fue confirmado. Si necesitas cambios, crea un nuevo pedido desde el catálogo.
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
