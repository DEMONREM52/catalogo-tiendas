"use client";

import { useEffect, useMemo, useState } from "react";
import Swal from "sweetalert2";
import { supabaseBrowser } from "@/lib/supabase/client";

/** =========================
 * Helpers (UI)
 * ========================= */
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

type OrderStatus = "draft" | "sent" | "confirmed" | "completed";

/** =========================
 * ✅ Tokens (auto claro/oscuro por tu CSS)
 * ========================= */
function tokenCard() {
  return "glass";
}
function tokenCardSoft() {
  return "glass-soft";
}

function inputBase() {
  // ✅ mejor en móvil: más alto, más legible, sin desbordes
  // ✅ ahora usa tokens (fondo/borde/texto) desde CSS global
  return "w-full rounded-2xl border px-4 py-3 text-sm outline-none backdrop-blur-xl";
}
function selectBase() {
  return "w-full rounded-2xl border px-4 py-3 text-sm outline-none backdrop-blur-xl";
}

function btnSoft() {
  // ✅ usa tokens globales (te quedan iguales en toda la app)
  return "btn-soft px-4 py-2 text-sm font-semibold";
}

function btnCta() {
  // ✅ usa tokens globales (cta) y auto tema
  return "btn-cta px-4 py-2 text-sm font-semibold";
}

/** Badge por estado con tokens:
 * - Para colores “semantic” (sky/emerald/indigo) uso color-mix sin hardcode a white/black.
 * - En draft usa card tokens.
 */
function statusBadge(st: OrderStatus) {
  const base =
    "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold";

  if (st === "draft")
    return `${base}`;
  if (st === "sent")
    return `${base}`;
  if (st === "confirmed")
    return `${base}`;
  return `${base}`;
}

/** estilos inline (tokens) para los badges, para que sean 100% auto tema */
function statusBadgeStyle(st: OrderStatus): React.CSSProperties {
  const borderBase = "var(--t-card-border)";
  const bgBase = "color-mix(in oklab, var(--t-card-bg) 88%, transparent)";
  const textBase = "color-mix(in oklab, var(--t-text) 88%, transparent)";

  if (st === "draft") {
    return {
      borderColor: borderBase,
      background: bgBase,
      color: textBase,
    };
  }
  if (st === "sent") {
    return {
      borderColor: "color-mix(in oklab, deepskyblue 35%, var(--t-card-border))",
      background: "color-mix(in oklab, deepskyblue 12%, transparent)",
      color: "color-mix(in oklab, var(--t-text) 88%, deepskyblue 12%)",
    };
  }
  if (st === "confirmed") {
    return {
      borderColor: "color-mix(in oklab, lime 35%, var(--t-card-border))",
      background: "color-mix(in oklab, lime 12%, transparent)",
      color: "color-mix(in oklab, var(--t-text) 88%, lime 12%)",
    };
  }
  return {
    borderColor: "color-mix(in oklab, dodgerblue 35%, var(--t-card-border))",
    background: "color-mix(in oklab, dodgerblue 12%, transparent)",
    color: "color-mix(in oklab, var(--t-text) 88%, dodgerblue 12%)",
  };
}

function cleanText(v: string | null | undefined) {
  return (v ?? "").trim();
}

function safeCustomer(v: string | null | undefined) {
  return cleanText(v) || "—";
}

type OrderRow = {
  id: string;
  token: string;
  store_id: string;
  receipt_no: number | null;
  status: OrderStatus;
  total: number;
  created_at: string;
  customer_name: string | null;
  customer_whatsapp: string | null;

  customer_note: string | null; // ✅ observaciones
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
          background: "var(--t-bg-base)",
          color: "var(--t-text)",
          confirmButtonColor: "#ef4444",
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
          background: "var(--t-bg-base)",
          color: "var(--t-text)",
          confirmButtonColor: "#ef4444",
        });
        return;
      }

      setStoreId(storeData.id);

      // 3) Pedidos (incluye customer_note)
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
        background: "var(--t-bg-base)",
        color: "var(--t-text)",
        confirmButtonColor: "#ef4444",
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
      const haystack = (
        `${o.receipt_no ?? ""} ${o.status ?? ""} ${o.customer_name ?? ""} ${o.customer_whatsapp ?? ""} ${o.customer_note ?? ""}`
      ).toLowerCase();

      const matchQ = !s || haystack.includes(s);
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

      const customerName = safeCustomer(o.customer_name);
      const customerWa = safeCustomer(o.customer_whatsapp);
      const note = safeCustomer(o.customer_note);

      const html = `
        <div style="text-align:left">
          <div style="opacity:.92; margin-bottom:8px">
            <div style="font-size:14px; margin-bottom:8px">
              👋 Hola, <b style="font-size:15px">${customerName}</b>
            </div>

            <div style="opacity:.9; line-height:1.5">
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
                <div style="opacity:.85">Cant: ${i.quantity} · Precio: ${money(i.price)} · Subtotal: ${money(sub)}</div>
              </div>`;
            })
            .join("")}

          <hr style="border-color: rgba(255,255,255,0.12); margin: 12px 0" />

          <div style="opacity:.9">
            <b>Link comprobante:</b><br/>
            <code style="font-size:12px; word-break:break-all;">${window.location.origin}/pedido/${o.token}</code>
          </div>
        </div>
      `;

      await Swal.fire({
        title: "Detalle del pedido",
        html,
        background: "var(--t-bg-base)",
        color: "var(--t-text)",
        width: 780,
        showConfirmButton: true,
        confirmButtonText: "Cerrar",
      });
    } catch (e: any) {
      await Swal.fire({
        icon: "error",
        title: "Error cargando items",
        text: e?.message ?? "Error",
        background: "var(--t-bg-base)",
        color: "var(--t-text)",
        confirmButtonColor: "#ef4444",
      });
    }
  }

  async function setOrderStatus(o: OrderRow, nextStatus: OrderStatus) {
    const confirm = await Swal.fire({
      icon: "question",
      title: "Cambiar estado",
      text: `¿Cambiar el pedido #${o.receipt_no ?? "—"} a "${statusLabel(nextStatus)}"?`,
      showCancelButton: true,
      confirmButtonText: "Sí, cambiar",
      cancelButtonText: "Cancelar",
      background: "var(--t-bg-base)",
      color: "var(--t-text)",
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

      setOrders((prev) => prev.map((x) => (x.id === o.id ? { ...x, status: nextStatus } : x)));

      await Swal.fire({
        icon: "success",
        title: "Actualizado",
        text: "Estado actualizado correctamente.",
        timer: 1200,
        showConfirmButton: false,
        background: "var(--t-bg-base)",
        color: "var(--t-text)",
      });
    } catch (e: any) {
      await Swal.fire({
        icon: "error",
        title: "No se pudo actualizar",
        text: e?.message ?? "Error",
        background: "var(--t-bg-base)",
        color: "var(--t-text)",
        confirmButtonColor: "#ef4444",
      });
    }
  }

  async function orderActions(o: OrderRow) {
    const link = `${window.location.origin}/pedido/${o.token}`;

    const customerName = safeCustomer(o.customer_name);
    const customerWa = safeCustomer(o.customer_whatsapp);
    const note = safeCustomer(o.customer_note);

    const res = await Swal.fire({
      title: `Pedido #${o.receipt_no ?? "—"}`,
      html: `
        <div style="text-align:left; opacity:.92; line-height:1.5">
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
      background: "var(--t-bg-base)",
      color: "var(--t-text)",
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
      try {
        await navigator.clipboard.writeText(link);
        await Swal.fire({
          icon: "success",
          title: "Link copiado",
          text: "Se copió el link del comprobante.",
          timer: 1100,
          showConfirmButton: false,
          background: "var(--t-bg-base)",
          color: "var(--t-text)",
        });
      } catch {
        await Swal.fire({
          icon: "info",
          title: "No se pudo copiar",
          text: "Tu navegador bloqueó el portapapeles. Copia el link manualmente.",
          background: "var(--t-bg-base)",
          color: "var(--t-text)",
        });
      }
    }
  }

  if (loading) {
    return (
      <main className="p-6" style={{ color: "var(--t-text)" }}>
        <p style={{ color: "var(--t-muted)" }}>Cargando pedidos...</p>
      </main>
    );
  }

  return (
    <main className="p-4 sm:p-6 space-y-5 panel-enter" style={{ color: "var(--t-text)" }}>
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold">Pedidos</h1>
          <p className="text-sm" style={{ color: "var(--t-muted)" }}>
            Aquí verás todos los pedidos que llegan por el carrito.
          </p>
        </div>

        <div className="flex gap-2">
          <button className={btnSoft()} onClick={load}>
            Recargar
          </button>
        </div>
      </div>

      {/* Filtros (mejor móvil) */}
      <div className={`${tokenCard()} p-4 space-y-3`}>
        <input
          className={inputBase()}
          placeholder="Buscar: comprobante, nombre, whatsapp, obs, estado..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <select className={selectBase()} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="all">Todos</option>
            <option value="draft">Borrador</option>
            <option value="sent">Enviado (editable)</option>
            <option value="confirmed">Confirmado</option>
            <option value="completed">Completado</option>
          </select>

          <div className={`${tokenCardSoft()} px-4 py-3 text-sm rounded-2xl`}>
            Tienda: <b>{storeId ? "OK" : "—"}</b> · Pedidos: <b>{orders.length}</b>
          </div>
        </div>
      </div>

      {/* =========================
          MOBILE: Cards (✅ arregla el problema)
         ========================= */}
      <div className="md:hidden space-y-3">
        {filtered.length === 0 ? (
          <div className={`${tokenCard()} p-5`}>
            <p className="font-semibold">Aún no hay pedidos.</p>
            <p className="text-sm mt-1" style={{ color: "var(--t-muted)" }}>
              Prueba cambiando filtros.
            </p>
          </div>
        ) : (
          filtered.map((o) => {
            const customerName = safeCustomer(o.customer_name);
            const customerWa = safeCustomer(o.customer_whatsapp);
            const note = safeCustomer(o.customer_note);

            return (
              <div key={o.id} className={`${tokenCard()} p-4 space-y-3`}>
                {/* top */}
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-semibold text-base">
                      Pedido #{o.receipt_no ?? "—"}
                    </div>
                    <div className="text-xs" style={{ color: "var(--t-muted)" }}>
                      {new Date(o.created_at).toLocaleString("es-CO")}
                    </div>
                  </div>

                  <div className="shrink-0 flex flex-col items-end gap-2">
                    <span className={statusBadge(o.status)} style={statusBadgeStyle(o.status)}>
                      {statusLabel(o.status)}
                    </span>
                    <span className="text-xs" style={{ color: "var(--t-muted)" }}>
                      {o.catalog_type === "retail" ? "Detal" : "Mayor"}
                    </span>
                  </div>
                </div>

                {/* total */}
                <div className="flex items-center justify-between">
                  <div className="text-sm" style={{ color: "var(--t-muted)" }}>
                    Total
                  </div>
                  <div className="text-lg font-bold">{money(o.total)}</div>
                </div>

                {/* cliente */}
                <div className="text-sm space-y-1">
                  <div style={{ color: "var(--t-muted)" }}>
                    👤 <b style={{ color: "var(--t-text)" }}>{customerName}</b>
                  </div>
                  <div style={{ color: "var(--t-muted)" }}>
                    📱 <b style={{ color: "var(--t-text)" }}>{customerWa}</b>
                  </div>
                  {note !== "—" ? (
                    <div style={{ color: "var(--t-muted)" }}>
                      📝 <span style={{ color: "var(--t-text)" }}>{note}</span>
                    </div>
                  ) : null}
                </div>

                {/* acciones */}
                <div className="grid grid-cols-2 gap-2">
                  <button className={btnSoft()} onClick={() => orderActions(o)}>
                    Ver
                  </button>
                  <button className={btnSoft()} onClick={() => openOrder(o)}>
                    Detalle
                  </button>

                  {o.status !== "confirmed" ? (
                    <button
                      className={`${btnCta()} col-span-2`}
                      onClick={() => setOrderStatus(o, "confirmed")}
                    >
                      Confirmar
                    </button>
                  ) : (
                    <button
                      className={`${btnCta()} col-span-2`}
                      onClick={() => setOrderStatus(o, "completed")}
                    >
                      Completar
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* =========================
          DESKTOP: Tabla (se mantiene)
         ========================= */}
      <div className={`hidden md:block ${tokenCard()} overflow-hidden`}>
        <div
          className="grid grid-cols-12 gap-2 border-b p-3 text-sm"
          style={{ borderColor: "var(--t-card-border)", color: "var(--t-muted)" }}
        >
          <div className="col-span-2">Factura</div>
          <div className="col-span-2">Fecha</div>
          <div className="col-span-2">Estado</div>
          <div className="col-span-2">Tipo</div>
          <div className="col-span-2">Total</div>
          <div className="col-span-2 text-right">Acciones</div>
        </div>

        {filtered.length === 0 ? (
          <div className="p-6 text-sm" style={{ color: "var(--t-muted)" }}>
            Aún no hay pedidos.
          </div>
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

              <div className="col-span-2 text-sm" style={{ color: "var(--t-muted)" }}>
                {new Date(o.created_at).toLocaleDateString("es-CO")}
              </div>

              <div className="col-span-2 text-sm">
                <span style={{ color: "color-mix(in oklab, var(--t-text) 90%, transparent)" }}>
                  {statusLabel(o.status)}
                </span>
              </div>

              <div className="col-span-2 text-sm" style={{ color: "var(--t-muted)" }}>
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
                      color: "color-mix(in oklab, var(--t-text) 88%, lime 12%)",
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
                      color: "color-mix(in oklab, var(--t-text) 88%, dodgerblue 12%)",
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

      <p className="text-xs" style={{ color: "var(--t-muted)" }}>
        Tip: el cliente puede editar mientras esté en <b>Enviado</b>. Si tú lo confirmas, ya no debería editarse.
      </p>
    </main>
  );
}
