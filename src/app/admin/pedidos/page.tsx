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

function statusBadge(st: OrderRow["status"]) {
  const base =
    "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold";

  if (st === "draft")
    return `${base} border-white/10 bg-white/5 text-white/80`;
  if (st === "sent")
    return `${base} border-sky-400/30 bg-sky-400/10 text-sky-100`;
  if (st === "confirmed")
    return `${base} border-emerald-400/30 bg-emerald-400/10 text-emerald-100`;
  return `${base} border-indigo-400/30 bg-indigo-400/10 text-indigo-100`;
}

export default function AdminPedidosPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [stores, setStores] = useState<StoreMini[]>([]);
  const [orders, setOrders] = useState<OrderRow[]>([]);

  const [q, setQ] = useState("");
  const [storeFilter, setStoreFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  // -----------------------------
  // Cargar tiendas + pedidos
  // -----------------------------
  async function load() {
    setLoading(true);
    try {
      const sb = supabaseBrowser();

      // Tiendas
      const { data: st, error: stErr } = await sb
        .from("stores")
        .select("id,name,slug")
        .order("created_at", { ascending: false });

      if (stErr) throw stErr;
      setStores((st as StoreMini[]) ?? []);

      // Pedidos
      const { data, error } = await sb
        .from("orders")
        .select(
          "id,store_id,catalog_type,status,total,token,receipt_no,created_at,customer_name,customer_whatsapp,stores(name,slug)"
        )
        .order("created_at", { ascending: false })
        .limit(200);

      if (error) throw error;
      setOrders((data as any) ?? []);
    } catch (err: any) {
      await Swal.fire({
        icon: "error",
        title: "Error cargando datos",
        text: err?.message ?? "Error",
        background: "#0b0b0b",
        color: "#fff",
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -----------------------------
  // Filtrado
  // -----------------------------
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();

    return orders.filter((o) => {
      if (storeFilter !== "all" && o.store_id !== storeFilter) return false;
      if (statusFilter !== "all" && o.status !== statusFilter) return false;

      if (!s) return true;

      const txt =
        `${o.receipt_no ?? ""} ${o.token ?? ""} ${o.stores?.name ?? ""} ${
          o.stores?.slug ?? ""
        } ${o.customer_name ?? ""} ${o.customer_whatsapp ?? ""}`.toLowerCase();

      return txt.includes(s);
    });
  }, [orders, q, storeFilter, statusFilter]);

  // -----------------------------
  // Cambiar estado
  // -----------------------------
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
    try {
      const sb = supabaseBrowser();

      const { error } = await sb
        .from("orders")
        .update({ status: next })
        .eq("id", o.id);

      if (error) throw error;

      setOrders((prev) =>
        prev.map((x) => (x.id === o.id ? { ...x, status: next } : x))
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
    } catch (err: any) {
      await Swal.fire({
        icon: "error",
        title: "No se pudo cambiar",
        text: err?.message ?? "Error",
        background: "#0b0b0b",
        color: "#fff",
        confirmButtonColor: "#ef4444",
      });
    } finally {
      setSaving(false);
    }
  }

  // -----------------------------
  // Acciones
  // -----------------------------
  function openReceipt(o: OrderRow) {
    window.open(`/pedido/${o.token}`, "_blank");
  }

  async function copyLink(o: OrderRow) {
    try {
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
    } catch {
      await Swal.fire({
        icon: "error",
        title: "No se pudo copiar",
        text: "Tu navegador bloqueó el portapapeles. Copia el link manualmente.",
        background: "#0b0b0b",
        color: "#fff",
      });
    }
  }

  // ✅ SOLO imprime cuando tú das click en "Generar factura"
  async function printInvoice(o: OrderRow) {
    const link = `${window.location.origin}/pedido/${o.token}`;

    const w = window.open(link, "_blank");
    if (!w) {
      await Swal.fire({
        icon: "info",
        title: "Pop-up bloqueado",
        text: "Permite pop-ups y vuelve a intentar.",
        background: "#0b0b0b",
        color: "#fff",
      });
      return;
    }

    // Espera a que cargue para imprimir (mejor que setTimeout fijo)
    const startedAt = Date.now();
    const maxWait = 9000;

    const timer = setInterval(() => {
      try {
        const ready = w.document?.readyState === "complete";
        const tooLong = Date.now() - startedAt > maxWait;

        if (ready || tooLong) {
          clearInterval(timer);
          w.focus();
          w.print();
        }
      } catch {
        clearInterval(timer);
        setTimeout(() => {
          try {
            w.focus();
            w.print();
          } catch {}
        }, 1200);
      }
    }, 350);
  }

  // -----------------------------
  // UI
  // -----------------------------
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-2xl font-semibold">🧾 Pedidos</h2>
          <p className="text-sm text-white/70">
            Filtra pedidos, abre comprobantes y genera facturas en PDF.
          </p>
        </div>

        <button
          onClick={load}
          disabled={saving}
          className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white/90 backdrop-blur-xl transition hover:bg-white/10 disabled:opacity-60"
        >
          Recargar
        </button>
      </div>

      {/* Filters */}
      <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
        <input
          className="rounded-2xl border border-white/10 bg-white/5 p-3 text-sm outline-none placeholder:text-white/40 backdrop-blur-xl"
          placeholder="Buscar (#, token, tienda, cliente, whatsapp...)"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />

        <select
          className="rounded-2xl border border-white/10 bg-white/5 p-3 text-sm outline-none backdrop-blur-xl"
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
          className="rounded-2xl border border-white/10 bg-white/5 p-3 text-sm outline-none backdrop-blur-xl"
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

      {/* List */}
      {loading ? (
        <div className="rounded-[28px] border border-white/10 bg-white/5 p-6 text-sm text-white/70">
          Cargando...
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-[28px] border border-white/10 bg-white/5 p-6">
          <p className="font-semibold">No hay pedidos</p>
          <p className="mt-1 text-sm text-white/70">
            Prueba cambiando filtros o creando un pedido.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((o) => (
            <div
              key={o.id}
              className="rounded-[28px] border border-white/10 bg-white/5 p-4 backdrop-blur-xl"
            >
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                {/* Info */}
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold">
                      #{o.receipt_no ?? "—"} · {o.stores?.name ?? "Tienda"}
                    </p>

                    <span className="text-xs text-white/60">
                      ({o.catalog_type === "retail" ? "Detal" : "Mayor"})
                    </span>

                    <span className={statusBadge(o.status)}>
                      <span className="h-2 w-2 rounded-full bg-white/60" />
                      {statusLabel(o.status)}
                    </span>
                  </div>

                  <p className="mt-1 text-sm text-white/70">
                    {new Date(o.created_at).toLocaleString("es-CO")} · Total:{" "}
                    <b className="text-white">{money(o.total)}</b>
                  </p>

                  <p className="mt-1 text-xs text-white/50">
                    Cliente: {o.customer_name ?? "—"} · WhatsApp:{" "}
                    {o.customer_whatsapp ?? "—"} · Token: {o.token}
                  </p>
                </div>

                {/* Actions */}
                <div className="flex flex-wrap gap-2">
                  <button
                    className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white/90 transition hover:bg-white/10"
                    onClick={() => openReceipt(o)}
                  >
                    Ver comprobante
                  </button>

                  <button
                    className="rounded-2xl border border-fuchsia-400/30 bg-fuchsia-500/15 px-4 py-2 text-sm font-semibold text-fuchsia-100 shadow-[0_0_22px_rgba(217,70,239,0.15)] transition hover:bg-fuchsia-500/25"
                    onClick={() => printInvoice(o)}
                  >
                    Generar factura (PDF)
                  </button>

                  <button
                    className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white/90 transition hover:bg-white/10"
                    onClick={() => copyLink(o)}
                  >
                    Copiar link
                  </button>

                  <div className="w-full md:hidden" />

                  <button
                    className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm transition hover:bg-white/10 disabled:opacity-60"
                    onClick={() => setStatus(o, "draft")}
                    disabled={saving}
                  >
                    Borrador
                  </button>

                  <button
                    className="rounded-2xl border border-sky-400/30 bg-sky-400/10 px-4 py-2 text-sm text-sky-100 transition hover:bg-sky-400/15 disabled:opacity-60"
                    onClick={() => setStatus(o, "sent")}
                    disabled={saving}
                  >
                    Enviado
                  </button>

                  <button
                    className="rounded-2xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-2 text-sm text-emerald-100 transition hover:bg-emerald-400/15 disabled:opacity-60"
                    onClick={() => setStatus(o, "confirmed")}
                    disabled={saving}
                  >
                    Confirmado
                  </button>

                  <button
                    className="rounded-2xl border border-indigo-400/30 bg-indigo-400/10 px-4 py-2 text-sm text-indigo-100 transition hover:bg-indigo-400/15 disabled:opacity-60"
                    onClick={() => setStatus(o, "completed")}
                    disabled={saving}
                  >
                    Completado
                  </button>
                </div>
              </div>
            </div>
          ))}

          <p className="text-xs text-white/50">
            Mostrando últimos 200 pedidos (puedes subir el limit si quieres).
          </p>
        </div>
      )}
    </div>
  );
}
