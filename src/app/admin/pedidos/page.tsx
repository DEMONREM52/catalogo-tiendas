"use client";

import { useEffect, useMemo, useState } from "react";
import Swal from "sweetalert2";
import { supabaseBrowser } from "@/lib/supabase/client";

function money(n: number) {
  return `$${Number(n || 0).toLocaleString("es-CO")}`;
}

type StoreMini = { id: string; name: string; slug: string };

type OrderRow = {
  id: string;
  store_id: string;
  catalog_type: "retail" | "wholesale";
  status: "draft" | "sent" | "confirmed" | "completed";
  total: number;
  token: string;
  receipt_no: number | null;
  created_at: string;
  customer_name: string | null;
  customer_whatsapp: string | null;
  stores?: { name: string; slug: string } | null;
};

function statusLabel(st: string) {
  if (st === "draft") return "Borrador";
  if (st === "sent") return "Enviado";
  if (st === "confirmed") return "Confirmado";
  if (st === "completed") return "Completado";
  return st;
}

export default function AdminPedidosPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [stores, setStores] = useState<StoreMini[]>([]);
  const [orders, setOrders] = useState<OrderRow[]>([]);

  const [q, setQ] = useState("");
  const [storeFilter, setStoreFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  async function load() {
    setLoading(true);

    const { data: st, error: stErr } = await supabaseBrowser
      .from("stores")
      .select("id,name,slug")
      .order("created_at", { ascending: false });

    if (stErr) {
      await Swal.fire({
        icon: "error",
        title: "Error cargando tiendas",
        text: stErr.message,
        background: "#0b0b0b",
        color: "#fff",
      });
      setLoading(false);
      return;
    }
    setStores((st as StoreMini[]) ?? []);

    const { data, error } = await supabaseBrowser
      .from("orders")
      .select(
        "id,store_id,catalog_type,status,total,token,receipt_no,created_at,customer_name,customer_whatsapp,stores(name,slug)",
      )
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) {
      await Swal.fire({
        icon: "error",
        title: "Error cargando pedidos",
        text: error.message,
        background: "#0b0b0b",
        color: "#fff",
      });
      setLoading(false);
      return;
    }

    setOrders((data as any) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();

    return orders.filter((o) => {
      if (storeFilter !== "all" && o.store_id !== storeFilter) return false;
      if (statusFilter !== "all" && o.status !== statusFilter) return false;

      if (!s) return true;
      const txt =
        `${o.receipt_no ?? ""} ${o.token} ${o.stores?.name ?? ""} ${o.stores?.slug ?? ""} ${o.customer_name ?? ""} ${o.customer_whatsapp ?? ""}`.toLowerCase();
      return txt.includes(s);
    });
  }, [orders, q, storeFilter, statusFilter]);

  async function setStatus(o: OrderRow, next: OrderRow["status"]) {
    const res = await Swal.fire({
      icon: "question",
      title: "Cambiar estado",
      text: `Pedido #${o.receipt_no ?? "—"} → ${statusLabel(next)}`,
      showCancelButton: true,
      confirmButtonText: "Sí, cambiar",
      cancelButtonText: "Cancelar",
      background: "#0b0b0b",
      color: "#fff",
      confirmButtonColor: "#22c55e",
    });

    if (!res.isConfirmed) return;

    setSaving(true);
    const { error } = await supabaseBrowser
      .from("orders")
      .update({ status: next })
      .eq("id", o.id);

    setSaving(false);

    if (error) {
      await Swal.fire({
        icon: "error",
        title: "No se pudo cambiar",
        text: error.message,
        background: "#0b0b0b",
        color: "#fff",
        confirmButtonColor: "#ef4444",
      });
      return;
    }

    setOrders((prev) =>
      prev.map((x) => (x.id === o.id ? { ...x, status: next } : x)),
    );

    await Swal.fire({
      icon: "success",
      title: "Listo",
      text: "Estado actualizado.",
      timer: 1000,
      showConfirmButton: false,
      background: "#0b0b0b",
      color: "#fff",
    });
  }

  function openReceipt(o: OrderRow) {
    window.open(`/pedido/${o.token}`, "_blank");
  }

  async function copyLink(o: OrderRow) {
    const url = `${window.location.origin}/pedido/${o.token}`;
    await navigator.clipboard.writeText(url);

    await Swal.fire({
      icon: "success",
      title: "Link copiado",
      text: "El link del comprobante fue copiado al portapapeles.",
      timer: 1200,
      showConfirmButton: false,
      background: "#0b0b0b",
      color: "#fff",
    });
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Pedidos</h2>
          <p className="text-sm opacity-80">
            Ver todos, filtrar y cambiar estado.
          </p>
        </div>
        <button
          className="rounded-xl border border-white/10 px-4 py-2"
          onClick={load}
          disabled={saving}
        >
          Recargar
        </button>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-2 md:grid-cols-3">
        <input
          className="rounded-xl border border-white/10 bg-black/30 p-3 outline-none"
          placeholder="Buscar (#, token, tienda, cliente, whatsapp...)"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />

        <select
          className="rounded-xl border border-white/10 bg-black/30 p-3 outline-none"
          value={storeFilter}
          onChange={(e) => setStoreFilter(e.target.value)}
        >
          <option value="all">Todas las tiendas</option>
          {stores.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} ({s.slug})
            </option>
          ))}
        </select>

        <select
          className="rounded-xl border border-white/10 bg-black/30 p-3 outline-none"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="all">Todos los estados</option>
          <option value="draft">Borrador</option>
          <option value="sent">Enviado</option>
          <option value="confirmed">Confirmado</option>
          <option value="completed">Completado</option>
        </select>
      </div>

      {loading ? (
        <p className="mt-4">Cargando...</p>
      ) : filtered.length === 0 ? (
        <div className="mt-4 rounded-2xl border border-white/10 p-4">
          <p className="font-semibold">No hay pedidos</p>
          <p className="text-sm opacity-80 mt-1">
            Prueba cambiando filtros o creando un pedido.
          </p>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {filtered.map((o) => (
            <div key={o.id} className="rounded-2xl border border-white/10 p-4">
              <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="font-semibold">
                    #{o.receipt_no ?? "—"} · {o.stores?.name ?? "Tienda"}{" "}
                    <span className="opacity-70">
                      ({o.catalog_type === "retail" ? "Detal" : "Mayor"})
                    </span>
                  </p>
                  <p className="text-sm opacity-80">
                    {new Date(o.created_at).toLocaleString("es-CO")} · Total:{" "}
                    <b>{money(o.total)}</b>
                  </p>
                  <p className="text-xs opacity-60 mt-1">
                    Estado: <b>{statusLabel(o.status)}</b> · Token: {o.token}
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    className="rounded-xl border border-white/10 px-4 py-2"
                    onClick={() => openReceipt(o)}
                  >
                    Ver comprobante
                  </button>

                  <button
                    className="rounded-xl border border-white/10 px-4 py-2"
                    onClick={() => copyLink(o)}
                  >
                    Copiar link
                  </button>

                  <button
                    className="rounded-xl border border-white/10 px-4 py-2"
                    onClick={() => setStatus(o, "draft")}
                  >
                    Borrador
                  </button>

                  <button
                    className="rounded-xl border border-white/10 px-4 py-2"
                    onClick={() => setStatus(o, "sent")}
                  >
                    Enviado
                  </button>

                  <button
                    className="rounded-xl border border-white/10 px-4 py-2"
                    onClick={() => setStatus(o, "confirmed")}
                  >
                    Confirmado
                  </button>

                  <button
                    className="rounded-xl border border-white/10 px-4 py-2"
                    onClick={() => setStatus(o, "completed")}
                  >
                    Completado
                  </button>
                </div>
              </div>
            </div>
          ))}
          <p className="text-xs opacity-60">
            Mostrando últimos 200 pedidos (puedes subir el limit si quieres).
          </p>
        </div>
      )}
    </div>
  );
}
