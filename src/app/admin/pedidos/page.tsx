"use client";

import { useEffect, useMemo, useState } from "react";
import Swal from "sweetalert2";
import { supabaseBrowser } from "@/lib/supabase/client";

/** =========================
 * Helpers
 * ========================= */
function money(n: number) {
  return `$${Number(n || 0).toLocaleString("es-CO")}`;
}

type StoreMini = { id: string; name: string; slug: string };

type OrderStatus = "draft" | "sent" | "confirmed" | "completed";

type OrderRow = {
  id: string;
  store_id: string;
  catalog_type: "retail" | "wholesale";
  status: OrderStatus;
  total: number;
  token: string;
  receipt_no: number | null;
  created_at: string;

  customer_name: string | null;
  customer_whatsapp: string | null;
  customer_note?: string | null;

  stores?: { name: string; slug: string } | null;
};

function statusLabel(st: OrderStatus) {
  if (st === "draft") return "Borrador";
  if (st === "sent") return "Enviado";
  if (st === "confirmed") return "Confirmado";
  return "Completado";
}

function statusPill(st: OrderStatus) {
  const base =
    "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold";
  if (st === "draft") return `${base} border-white/10 bg-white/5 text-white/80`;
  if (st === "sent") return `${base} border-sky-400/30 bg-sky-400/10 text-sky-100`;
  if (st === "confirmed")
    return `${base} border-emerald-400/30 bg-emerald-400/10 text-emerald-100`;
  return `${base} border-indigo-400/30 bg-indigo-400/10 text-indigo-100`;
}

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleString("es-CO", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function safeText(v: string | null | undefined) {
  const t = (v ?? "").trim();
  return t ? t : "—";
}

function inputBase() {
  // ✅ mejor en móvil: más padding y ancho completo
  return "w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm outline-none placeholder:text-white/40 backdrop-blur-xl";
}

function btnSoft() {
  return "rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white/90 backdrop-blur-xl transition hover:bg-white/10 active:scale-[0.99] disabled:opacity-60 disabled:cursor-not-allowed";
}

function btnPrimary() {
  return "rounded-2xl border border-fuchsia-400/30 bg-fuchsia-500/15 px-4 py-2 text-sm font-semibold text-fuchsia-100 shadow-[0_0_22px_rgba(217,70,239,0.15)] transition hover:bg-fuchsia-500/25 active:scale-[0.99] disabled:opacity-60 disabled:cursor-not-allowed";
}

function btnDanger() {
  return "rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm font-semibold text-red-200 transition hover:bg-red-500/15 active:scale-[0.99] disabled:opacity-60 disabled:cursor-not-allowed";
}

function cleanWhatsApp(v: string | null | undefined) {
  const raw = (v ?? "").trim();
  if (!raw) return "";
  return raw.replace(/\D/g, "");
}

export default function AdminPedidosPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [stores, setStores] = useState<StoreMini[]>([]);
  const [orders, setOrders] = useState<OrderRow[]>([]);

  const [q, setQ] = useState("");
  const [storeFilter, setStoreFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<OrderStatus | "all">("all");

  /** =========================
   * Load
   * ========================= */
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

      // Pedidos (últimos 200)
      const { data, error } = await sb
        .from("orders")
        .select(
          "id,store_id,catalog_type,status,total,token,receipt_no,created_at,customer_name,customer_whatsapp,customer_note,stores(name,slug)"
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

  /** =========================
   * Filter
   * ========================= */
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();

    return orders.filter((o) => {
      if (storeFilter !== "all" && o.store_id !== storeFilter) return false;
      if (statusFilter !== "all" && o.status !== statusFilter) return false;

      if (!s) return true;

      const txt =
        `${o.receipt_no ?? ""} ${o.token ?? ""} ${o.stores?.name ?? ""} ${
          o.stores?.slug ?? ""
        } ${o.customer_name ?? ""} ${o.customer_whatsapp ?? ""} ${
          o.customer_note ?? ""
        }`.toLowerCase();

      return txt.includes(s);
    });
  }, [orders, q, storeFilter, statusFilter]);

  /** =========================
   * Actions
   * ========================= */
  function openReceipt(o: OrderRow) {
    window.open(`/pedido/${o.token}`, "_blank");
  }

  async function copyLink(o: OrderRow) {
    const url = `${window.location.origin}/pedido/${o.token}`;
    try {
      await navigator.clipboard.writeText(url);
      await Swal.fire({
        icon: "success",
        title: "Link copiado",
        timer: 900,
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

    // imprimir cuando cargue
    const startedAt = Date.now();
    const maxWait = 9000;

    const timer = setInterval(() => {
      try {
        const ready = (w as any).document?.readyState === "complete";
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

  async function openWhatsApp(o: OrderRow) {
    const wa = cleanWhatsApp(o.customer_whatsapp);
    if (!wa) {
      await Swal.fire({
        icon: "info",
        title: "Sin WhatsApp",
        text: "Este pedido no tiene WhatsApp del cliente.",
        background: "#0b0b0b",
        color: "#fff",
      });
      return;
    }

    const name = safeText(o.customer_name);
    const msg = `Hola ${name}, sobre tu pedido #${o.receipt_no ?? "—"} ✅`;
    window.open(`https://wa.me/${wa}?text=${encodeURIComponent(msg)}`, "_blank");
  }

  async function setStatus(o: OrderRow, next: OrderStatus) {
    if (o.status === next) return;

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
      const { error } = await sb.from("orders").update({ status: next }).eq("id", o.id);
      if (error) throw error;

      setOrders((prev) =>
        prev.map((x) => (x.id === o.id ? { ...x, status: next } : x))
      );

      await Swal.fire({
        icon: "success",
        title: "Listo",
        text: "Estado actualizado.",
        timer: 900,
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

  /** =========================
   * UI
   * ========================= */
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold">🧾 Pedidos</h2>
          <p className="text-sm text-white/70">
            Aquí verás todos los pedidos que llegan por el carrito.
          </p>
        </div>

        <div className="flex gap-2">
          <button onClick={load} disabled={saving} className={btnSoft()}>
            Recargar
          </button>
        </div>
      </div>

      {/* Filters (mobile friendly) */}
      <div className="rounded-[28px] border border-white/10 bg-white/5 p-4 backdrop-blur-xl space-y-2">
        <input
          className={inputBase()}
          placeholder="Buscar: comprobante, nombre, whatsapp, obs..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <select
            className={inputBase()}
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
          >
            <option value="all">Todos</option>
            <option value="draft">Borrador</option>
            <option value="sent">Enviado</option>
            <option value="confirmed">Confirmado</option>
            <option value="completed">Completado</option>
          </select>

          <select
            className={inputBase()}
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
        </div>

        <div className="text-xs text-white/60">
          Tienda:{" "}
          <b className="text-white/90">
            {storeFilter === "all"
              ? "Todas"
              : stores.find((x) => x.id === storeFilter)?.name ?? "Filtrada"}
          </b>{" "}
          · Pedidos: <b className="text-white/90">{filtered.length}</b>
        </div>
      </div>

      {/* Body */}
      {loading ? (
        <div className="rounded-[28px] border border-white/10 bg-white/5 p-6 text-sm text-white/70">
          Cargando...
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-[28px] border border-white/10 bg-white/5 p-6">
          <p className="font-semibold">No hay pedidos</p>
          <p className="mt-1 text-sm text-white/70">
            Prueba cambiando filtros o recargando.
          </p>
        </div>
      ) : (
        <>
          {/* ✅ MOBILE: Cards (ya no se ve “tabla apretada”) */}
          <div className="md:hidden space-y-3">
            {filtered.map((o) => {
              const storeName = o.stores?.name ?? "Tienda";
              const typeLabel = o.catalog_type === "retail" ? "Detal" : "Mayor";
              const created = formatDate(o.created_at);

              const customerName = safeText(o.customer_name);
              const customerWa = safeText(o.customer_whatsapp);
              const note = safeText(o.customer_note);

              return (
                <div
                  key={o.id}
                  className="rounded-[28px] border border-white/10 bg-white/5 p-4 backdrop-blur-xl space-y-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-semibold text-base truncate">
                        Pedido #{o.receipt_no ?? "—"}
                      </div>
                      <div className="text-xs text-white/70 truncate">
                        {storeName} · {typeLabel}
                      </div>
                      <div className="text-xs text-white/60">{created}</div>
                    </div>

                    <div className="shrink-0 flex flex-col items-end gap-2">
                      <span className={statusPill(o.status)}>{statusLabel(o.status)}</span>
                      <div className="text-lg font-bold">{money(o.total)}</div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-1 text-sm text-white/80">
                    <div>
                      👤 Cliente: <b className="text-white">{customerName}</b>
                    </div>
                    <div>
                      📲 WhatsApp: <b className="text-white">{customerWa}</b>
                    </div>
                    {note !== "—" ? (
                      <div>
                        📝 Obs: <span className="text-white">{note}</span>
                      </div>
                    ) : null}
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <button className={btnSoft()} onClick={() => openReceipt(o)}>
                      Ver
                    </button>
                    <button className={btnSoft()} onClick={() => copyLink(o)}>
                      Copiar link
                    </button>

                    <button className={btnPrimary()} onClick={() => printInvoice(o)}>
                      Factura (PDF)
                    </button>
                    <button className={btnSoft()} onClick={() => openWhatsApp(o)}>
                      WhatsApp
                    </button>
                  </div>

                  {/* cambiar estado en móvil (más fácil que 4 botones) */}
                  <div className="grid grid-cols-1 gap-2">
                    <select
                      className={inputBase()}
                      value={o.status}
                      onChange={(e) => setStatus(o, e.target.value as OrderStatus)}
                      disabled={saving}
                      title="Cambiar estado"
                    >
                      <option value="draft">Borrador</option>
                      <option value="sent">Enviado</option>
                      <option value="confirmed">Confirmado</option>
                      <option value="completed">Completado</option>
                    </select>

                    <details className="rounded-2xl border border-white/10 bg-white/5 p-3">
                      <summary className="cursor-pointer select-none text-sm font-semibold text-white/90">
                        Ver token / más info
                      </summary>
                      <div className="mt-2 text-xs text-white/60 break-all">
                        Token: {o.token}
                      </div>
                    </details>
                  </div>
                </div>
              );
            })}
          </div>

          {/* ✅ DESKTOP: “tabla” pero bien */}
          <div className="hidden md:block space-y-3">
            {filtered.map((o) => {
              const storeName = o.stores?.name ?? "Tienda";
              const typeLabel = o.catalog_type === "retail" ? "Detal" : "Mayor";
              const created = formatDate(o.created_at);

              const customerName = safeText(o.customer_name);
              const customerWa = safeText(o.customer_whatsapp);
              const note = safeText(o.customer_note);

              return (
                <div
                  key={o.id}
                  className="rounded-[28px] border border-white/10 bg-white/5 p-4 backdrop-blur-xl"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="font-semibold">
                          #{o.receipt_no ?? "—"} · {storeName}
                        </div>
                        <span className="text-xs text-white/60">({typeLabel})</span>
                        <span className={statusPill(o.status)}>{statusLabel(o.status)}</span>
                      </div>

                      <div className="mt-1 text-sm text-white/70">
                        {created} · Total: <b className="text-white">{money(o.total)}</b>
                      </div>

                      <div className="mt-2 text-sm text-white/70">
                        👤 <b className="text-white">{customerName}</b> · 📲{" "}
                        <b className="text-white">{customerWa}</b>
                      </div>

                      {note !== "—" ? (
                        <div className="mt-1 text-sm text-white/70">
                          📝 <span className="text-white">{note}</span>
                        </div>
                      ) : null}

                      <div className="mt-1 text-xs text-white/40">Token: {o.token}</div>
                    </div>

                    <div className="w-[220px] shrink-0 space-y-2">
                      <select
                        className={inputBase()}
                        value={o.status}
                        onChange={(e) => setStatus(o, e.target.value as OrderStatus)}
                        disabled={saving}
                      >
                        <option value="draft">Borrador</option>
                        <option value="sent">Enviado</option>
                        <option value="confirmed">Confirmado</option>
                        <option value="completed">Completado</option>
                      </select>

                      <div className="grid grid-cols-2 gap-2">
                        <button className={btnSoft()} onClick={() => openReceipt(o)}>
                          Ver
                        </button>
                        <button className={btnSoft()} onClick={() => copyLink(o)}>
                          Copiar
                        </button>
                        <button className={btnPrimary()} onClick={() => printInvoice(o)}>
                          PDF
                        </button>
                        <button className={btnSoft()} onClick={() => openWhatsApp(o)}>
                          WhatsApp
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}

            <p className="text-xs text-white/50">
              Mostrando últimos 200 pedidos.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
