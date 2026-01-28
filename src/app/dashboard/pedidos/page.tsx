"use client";

import { useEffect, useMemo, useState } from "react";
import Swal from "sweetalert2";
import { supabaseBrowser } from "@/lib/supabase/client";

function money(n: number) {
  return `$${Number(n || 0).toLocaleString("es-CO")}`;
}

function statusLabel(s: string) {
  if (s === "draft") return "Borrador";
  if (s === "sent") return "Enviado (editable)";
  if (s === "confirmed") return "Confirmado";
  if (s === "completed") return "Completado";
  return s;
}

type OrderRow = {
  id: string;
  token: string;
  store_id: string;
  receipt_no: number | null;
  status: "draft" | "sent" | "confirmed" | "completed";
  total: number;
  created_at: string;
  customer_name: string | null;
  customer_whatsapp: string | null;

  // ✅ NUEVO
  customer_note: string | null;

  catalog_type: "retail" | "wholesale";
};

type ItemRow = {
  id: string;
  order_id: string;
  product_id: string;
  quantity: number;
  price: number;
  product?: { name: string; image_url: string | null } | null;
};

export default function OrdersDashboardPage() {
  const [loading, setLoading] = useState(true);
  const [storeId, setStoreId] = useState<string | null>(null);

  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<string>("all");

  async function load() {
    setLoading(true);

    try {
      const sb = supabaseBrowser();

      // 1) Usuario
      const { data: userData, error: userErr } = await sb.auth.getUser();
      if (userErr) throw userErr;

      if (!userData.user) {
        await Swal.fire({
          icon: "error",
          title: "Debes iniciar sesión",
          background: "#0b0b0b",
          color: "#fff",
        });
        return;
      }

      // 2) Buscar store del owner
      const { data: storeData, error: storeErr } = await sb
        .from("stores")
        .select("id")
        .eq("owner_id", userData.user.id)
        .maybeSingle();

      if (storeErr) throw storeErr;

      if (!storeData) {
        await Swal.fire({
          icon: "error",
          title: "No se encontró tu tienda",
          background: "#0b0b0b",
          color: "#fff",
        });
        return;
      }

      setStoreId(storeData.id);

      // 3) Pedidos (✅ incluye customer_note)
      const { data: ordData, error: ordErr } = await sb
        .from("orders")
        .select(
          "id,token,store_id,receipt_no,status,total,created_at,customer_name,customer_whatsapp,customer_note,catalog_type"
        )
        .eq("store_id", storeData.id)
        .order("created_at", { ascending: false });

      if (ordErr) throw ordErr;

      setOrders((ordData as OrderRow[]) ?? []);
    } catch (e: any) {
      await Swal.fire({
        icon: "error",
        title: "Error cargando pedidos",
        text: e?.message ?? "Error",
        background: "#0b0b0b",
        color: "#fff",
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();

    return orders.filter((o) => {
      const matchQ =
        !s ||
        String(o.receipt_no ?? "").includes(s) ||
        (o.customer_name ?? "").toLowerCase().includes(s) ||
        (o.customer_whatsapp ?? "").toLowerCase().includes(s) ||
        (o.customer_note ?? "").toLowerCase().includes(s) ||
        (o.status ?? "").toLowerCase().includes(s);

      const matchStatus = status === "all" ? true : o.status === status;

      return matchQ && matchStatus;
    });
  }, [orders, q, status]);

  async function openOrder(o: OrderRow) {
    try {
      const sb = supabaseBrowser();

      const { data, error } = await sb
        .from("order_items")
        .select("id,order_id,product_id,quantity,price, products(name,image_url)")
        .eq("order_id", o.id)
        .order("id", { ascending: true });

      if (error) throw error;

      const items: ItemRow[] = (data as any[]).map((x) => ({
        ...x,
        product: x.products ?? null,
      }));

      const customerName = (o.customer_name ?? "").trim() || "—";
      const customerWa = (o.customer_whatsapp ?? "").trim() || "—";
      const note = (o.customer_note ?? "").trim() || "—";

      const html = `
        <div style="text-align:left">
          <div style="opacity:.9; margin-bottom:8px">
            <div style="font-size:14px; margin-bottom:8px">
              👋 Hola, <b style="font-size:15px">${customerName}</b>
            </div>

            <div style="opacity:.85">
              <b>Comprobante:</b> #${o.receipt_no ?? "—"}<br/>
              <b>Estado:</b> ${statusLabel(o.status)}<br/>
              <b>Tipo:</b> ${o.catalog_type === "retail" ? "Detal" : "Mayor"}<br/>
              <b>Total:</b> ${money(o.total)}<br/>
              <b>Fecha:</b> ${new Date(o.created_at).toLocaleString("es-CO")}<br/>
              <b>WhatsApp:</b> ${customerWa}<br/>
              <b>Observaciones:</b> ${note}<br/>
            </div>
          </div>

          <hr style="border-color: rgba(255,255,255,0.12); margin: 12px 0" />

          ${items
            .map((i) => {
              const name = i.product?.name ?? i.product_id;
              const sub = Number(i.price) * Number(i.quantity);
              return `<div style="margin:8px 0">
                <div><b>${name}</b></div>
                <div style="opacity:.8">Cant: ${i.quantity} · Precio: ${money(
                  i.price
                )} · Subtotal: ${money(sub)}</div>
              </div>`;
            })
            .join("")}

          <hr style="border-color: rgba(255,255,255,0.12); margin: 12px 0" />

          <div style="opacity:.85">
            <b>Link comprobante:</b><br/>
            <code style="font-size:12px">${window.location.origin}/pedido/${o.token}</code>
          </div>
        </div>
      `;

      await Swal.fire({
        title: "Detalle del pedido",
        html,
        background: "#0b0b0b",
        color: "#fff",
        width: 720,
        showConfirmButton: true,
        confirmButtonText: "Cerrar",
      });
    } catch (e: any) {
      await Swal.fire({
        icon: "error",
        title: "Error cargando items",
        text: e?.message ?? "Error",
        background: "#0b0b0b",
        color: "#fff",
      });
    }
  }

  async function setOrderStatus(o: OrderRow, nextStatus: OrderRow["status"]) {
    const confirm = await Swal.fire({
      icon: "question",
      title: "Cambiar estado",
      text: `¿Cambiar el pedido #${o.receipt_no ?? "—"} a "${statusLabel(
        nextStatus
      )}"?`,
      showCancelButton: true,
      confirmButtonText: "Sí",
      cancelButtonText: "Cancelar",
      background: "#0b0b0b",
      color: "#fff",
      confirmButtonColor: "#22c55e",
    });

    if (!confirm.isConfirmed) return;

    try {
      const sb = supabaseBrowser();

      const { error } = await sb.rpc("owner_set_order_status", {
        p_order_id: o.id,
        p_status: nextStatus,
      });

      if (error) throw error;

      setOrders((prev) =>
        prev.map((x) => (x.id === o.id ? { ...x, status: nextStatus } : x))
      );

      await Swal.fire({
        icon: "success",
        title: "Actualizado",
        text: "Estado actualizado correctamente.",
        timer: 1200,
        showConfirmButton: false,
        background: "#0b0b0b",
        color: "#fff",
      });
    } catch (e: any) {
      await Swal.fire({
        icon: "error",
        title: "No se pudo actualizar",
        text: e?.message ?? "Error",
        background: "#0b0b0b",
        color: "#fff",
        confirmButtonColor: "#ef4444",
      });
    }
  }

  async function orderActions(o: OrderRow) {
    const link = `${window.location.origin}/pedido/${o.token}`;

    const customerName = (o.customer_name ?? "").trim() || "—";
    const customerWa = (o.customer_whatsapp ?? "").trim() || "—";
    const note = (o.customer_note ?? "").trim() || "—";

    const res = await Swal.fire({
      title: `Pedido #${o.receipt_no ?? "—"}`,
      html: `
        <div style="text-align:left; opacity:.92">
          <div style="font-size:14px; margin-bottom:10px">
            👋 Hola, <b style="font-size:15px">${customerName}</b>
          </div>

          <div style="margin-bottom:10px">
            <b>Estado:</b> ${statusLabel(o.status)}<br/>
            <b>Tipo:</b> ${o.catalog_type === "retail" ? "Detal" : "Mayor"}<br/>
            <b>Total:</b> ${money(o.total)}<br/>
            <b>Fecha:</b> ${new Date(o.created_at).toLocaleString("es-CO")}<br/>
            <b>WhatsApp:</b> ${customerWa}<br/>
            <b>Observaciones:</b> ${note}<br/>
          </div>

          <div style="margin-top:12px">
            <div style="font-size:12px; opacity:.7; margin-bottom:6px">Link del comprobante</div>
            <code style="font-size:12px; word-break:break-all;">${link}</code>
          </div>
        </div>
      `,
      background: "#0b0b0b",
      color: "#fff",
      showCancelButton: true,

      confirmButtonText: "Abrir",
      cancelButtonText: "Copiar link",

      confirmButtonColor: "#22c55e",
      cancelButtonColor: "#374151",
    });

    if (res.isConfirmed) {
      window.open(link, "_blank");
      return;
    }

    if (res.dismiss === Swal.DismissReason.cancel) {
      await navigator.clipboard.writeText(link);

      await Swal.fire({
        icon: "success",
        title: "Link copiado",
        text: "Se copió el link del comprobante.",
        timer: 1100,
        showConfirmButton: false,
        background: "#0b0b0b",
        color: "#fff",
      });
    }
  }

  if (loading) {
    return (
      <main className="p-6">
        <p>Cargando pedidos...</p>
      </main>
    );
  }

  return (
    <main className="p-6 space-y-5 panel-enter">
      {/* Header */}
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Pedidos</h1>
          <p className="text-sm opacity-80">
            Aquí verás todos los pedidos que llegan por el carrito.
          </p>
        </div>

        <div className="flex gap-2">
          <button className="btn-soft px-4 py-2" onClick={load}>
            Recargar
          </button>
        </div>
      </div>

      {/* Filtros */}
      <div className="glass p-4">
        <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
          <input
            className="p-3"
            placeholder="Buscar: comprobante, nombre, whatsapp, obs, estado..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />

          <select className="p-3" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="all">Todos</option>
            <option value="draft">Borrador</option>
            <option value="sent">Enviado (editable)</option>
            <option value="confirmed">Confirmado</option>
            <option value="completed">Completado</option>
          </select>

          <div className="glass-soft p-3 text-sm">
            Tienda: <b>{storeId ? "OK" : "—"}</b> · Pedidos: <b>{orders.length}</b>
          </div>
        </div>
      </div>

      {/* Tabla */}
      <div className="glass overflow-hidden">
        <div
          className="grid grid-cols-12 gap-2 border-b p-3 text-sm opacity-80"
          style={{ borderColor: "var(--t-card-border)" }}
        >
          <div className="col-span-2">Factura</div>
          <div className="col-span-2">Fecha</div>
          <div className="col-span-2">Estado</div>
          <div className="col-span-2">Tipo</div>
          <div className="col-span-2">Total</div>
          <div className="col-span-2 text-right">Acciones</div>
        </div>

        {filtered.length === 0 ? (
          <div className="p-6 text-sm opacity-80">Aún no hay pedidos.</div>
        ) : (
          filtered.map((o) => (
            <div
              key={o.id}
              className="grid grid-cols-12 gap-2 p-3 border-b"
              style={{
                borderColor: "color-mix(in oklab, var(--t-card-border) 85%, transparent)",
              }}
            >
              <div className="col-span-2 font-semibold">#{o.receipt_no ?? "—"}</div>

              <div className="col-span-2 text-sm opacity-80">
                {new Date(o.created_at).toLocaleDateString("es-CO")}
              </div>

              <div className="col-span-2 text-sm">
                <span className="opacity-90">{statusLabel(o.status)}</span>
              </div>

              <div className="col-span-2 text-sm opacity-80">
                {o.catalog_type === "retail" ? "Detal" : "Mayor"}
              </div>

              <div className="col-span-2 font-semibold">{money(o.total)}</div>

              <div className="col-span-2 flex justify-end flex-wrap gap-2">
                <button className="btn-soft px-3 py-1 text-sm" onClick={() => orderActions(o)}>
                  Ver
                </button>

                <button className="btn-soft px-3 py-1 text-sm" onClick={() => openOrder(o)}>
                  Detalle
                </button>

                {o.status !== "confirmed" && (
                  <button
                    className="btn-soft px-3 py-1 text-sm font-semibold"
                    style={{
                      borderColor: "color-mix(in oklab, lime 35%, var(--t-card-border))",
                      background: "color-mix(in oklab, lime 10%, transparent)",
                      color: "color-mix(in oklab, white 85%, lime 15%)",
                    }}
                    onClick={() => setOrderStatus(o, "confirmed")}
                  >
                    Confirmar
                  </button>
                )}

                {o.status === "confirmed" && (
                  <button
                    className="btn-soft px-3 py-1 text-sm font-semibold"
                    style={{
                      borderColor: "color-mix(in oklab, dodgerblue 35%, var(--t-card-border))",
                      background: "color-mix(in oklab, dodgerblue 10%, transparent)",
                      color: "color-mix(in oklab, white 85%, dodgerblue 15%)",
                    }}
                    onClick={() => setOrderStatus(o, "completed")}
                  >
                    Completar
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      <p className="text-xs opacity-70">
        Tip: el cliente puede editar mientras esté en <b>Enviado</b>. Si tú lo confirmas, ya no debería editarse.
      </p>
    </main>
  );
}
