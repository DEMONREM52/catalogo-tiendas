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

/* =========================================================
   Theme tokens (auto light/dark)
========================================================= */
function swalTheme() {
  return {
    background: "var(--ap-bg-base)",
    color: "var(--ap-text)",
  } as const;
}

/** ✅ Pills adaptadas a tema */
function statusPill(st: OrderStatus) {
  const base =
    "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold";

  if (st === "draft") return `${base} ap-pill-neutral`;
  if (st === "sent") return `${base} ap-pill-info`;
  if (st === "confirmed") return `${base} ap-pill-success`;
  return `${base} ap-pill-indigo`;
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
  return "ap-input w-full rounded-2xl px-4 py-3 text-sm outline-none backdrop-blur-xl";
}

function btnSoft() {
  return "ap-btn-ghost rounded-2xl px-4 py-2 text-sm font-semibold backdrop-blur-xl transition hover:opacity-95 active:scale-[0.99] disabled:opacity-60 disabled:cursor-not-allowed";
}

function btnPrimary() {
  return "ap-btn-primary rounded-2xl px-4 py-2 text-sm font-semibold backdrop-blur-xl transition hover:opacity-95 active:scale-[0.99] disabled:opacity-60 disabled:cursor-not-allowed";
}

function btnDanger() {
  return "ap-btn-danger rounded-2xl px-4 py-2 text-sm font-semibold backdrop-blur-xl transition hover:opacity-95 active:scale-[0.99] disabled:opacity-60 disabled:cursor-not-allowed";
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
        ...swalTheme(),
        confirmButtonColor: "var(--ap-danger)",
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
        ...swalTheme(),
      });
    } catch {
      await Swal.fire({
        icon: "error",
        title: "No se pudo copiar",
        text: "Tu navegador bloqueó el portapapeles. Copia el link manualmente.",
        ...swalTheme(),
        confirmButtonColor: "var(--ap-danger)",
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
        ...swalTheme(),
        confirmButtonColor: "var(--ap-cta)",
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
        ...swalTheme(),
        confirmButtonColor: "var(--ap-cta)",
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
      ...swalTheme(),
      confirmButtonColor: "var(--ap-success)",
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
        ...swalTheme(),
      });
    } catch (err: any) {
      await Swal.fire({
        icon: "error",
        title: "No se pudo cambiar",
        text: err?.message ?? "Error",
        ...swalTheme(),
        confirmButtonColor: "var(--ap-danger)",
      });
    } finally {
      setSaving(false);
    }
  }

  /** =========================
   * UI
   * ========================= */
  return (
    <div className="space-y-4 text-[color:var(--ap-text)]">
      {/* Theme tokens + local UI helpers */}
      <style jsx global>{`
        :root {
          --ap-text: rgba(255, 255, 255, 0.92);
          --ap-muted: rgba(255, 255, 255, 0.7);
          --ap-border: rgba(255, 255, 255, 0.12);
          --ap-card: rgba(255, 255, 255, 0.06);

          --ap-bg-base: #0b0b0b;

          --ap-cta: #a855f7;
          --ap-warn: #f59e0b;
          --ap-danger: #ef4444;
          --ap-success: #22c55e;
          --ap-info: #38bdf8;
          --ap-indigo: #818cf8;
        }

        @media (prefers-color-scheme: light) {
          :root {
            --ap-text: rgba(17, 24, 39, 0.92);
            --ap-muted: rgba(17, 24, 39, 0.65);
            --ap-border: rgba(17, 24, 39, 0.14);
            --ap-card: rgba(255, 255, 255, 0.85);

            --ap-bg-base: #f7f7fb;

            --ap-cta: #7c3aed;
            --ap-warn: #d97706;
            --ap-danger: #dc2626;
            --ap-success: #16a34a;
            --ap-info: #0284c7;
            --ap-indigo: #4f46e5;
          }
        }

        .ap-card {
          border: 1px solid var(--ap-border);
          background: var(--ap-card);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
        }

        .ap-input {
          border: 1px solid var(--ap-border);
          background: color-mix(in oklab, var(--ap-card) 72%, transparent);
          color: var(--ap-text);
        }
        .ap-input::placeholder {
          color: color-mix(in oklab, var(--ap-text) 38%, transparent);
        }
        select.ap-input option {
          color: #111827;
        }

        .ap-btn-ghost {
          border: 1px solid var(--ap-border);
          background: color-mix(in oklab, var(--ap-card) 72%, transparent);
          color: var(--ap-text);
        }

        .ap-btn-primary {
          border: 1px solid color-mix(in oklab, var(--ap-cta) 35%, var(--ap-border));
          background: color-mix(in oklab, var(--ap-cta) 18%, transparent);
          color: var(--ap-text);
          box-shadow: 0 0 22px color-mix(in oklab, var(--ap-cta) 14%, transparent);
        }

        .ap-btn-danger {
          border: 1px solid color-mix(in oklab, var(--ap-danger) 35%, var(--ap-border));
          background: color-mix(in oklab, var(--ap-danger) 12%, transparent);
          color: var(--ap-text);
        }

        /* Pills */
        .ap-pill-neutral {
          border-color: var(--ap-border);
          background: color-mix(in oklab, var(--ap-card) 72%, transparent);
          color: var(--ap-text);
        }
        .ap-pill-info {
          border-color: color-mix(in oklab, var(--ap-info) 40%, var(--ap-border));
          background: color-mix(in oklab, var(--ap-info) 14%, transparent);
          color: var(--ap-text);
        }
        .ap-pill-success {
          border-color: color-mix(in oklab, var(--ap-success) 40%, var(--ap-border));
          background: color-mix(in oklab, var(--ap-success) 14%, transparent);
          color: var(--ap-text);
        }
        .ap-pill-indigo {
          border-color: color-mix(in oklab, var(--ap-indigo) 40%, var(--ap-border));
          background: color-mix(in oklab, var(--ap-indigo) 14%, transparent);
          color: var(--ap-text);
        }
      `}</style>

      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold">🧾 Pedidos</h2>
          <p className="text-sm" style={{ color: "var(--ap-muted)" }}>
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
      <div className="ap-card rounded-[28px] p-4 space-y-2">
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

        <div className="text-xs" style={{ color: "var(--ap-muted)" }}>
          Tienda:{" "}
          <b style={{ color: "var(--ap-text)" }}>
            {storeFilter === "all"
              ? "Todas"
              : stores.find((x) => x.id === storeFilter)?.name ?? "Filtrada"}
          </b>{" "}
          · Pedidos: <b style={{ color: "var(--ap-text)" }}>{filtered.length}</b>
        </div>
      </div>

      {/* Body */}
      {loading ? (
        <div className="ap-card rounded-[28px] p-6 text-sm" style={{ color: "var(--ap-muted)" }}>
          Cargando...
        </div>
      ) : filtered.length === 0 ? (
        <div className="ap-card rounded-[28px] p-6">
          <p className="font-semibold">No hay pedidos</p>
          <p className="mt-1 text-sm" style={{ color: "var(--ap-muted)" }}>
            Prueba cambiando filtros o recargando.
          </p>
        </div>
      ) : (
        <>
          {/* ✅ MOBILE: Cards */}
          <div className="md:hidden space-y-3">
            {filtered.map((o) => {
              const storeName = o.stores?.name ?? "Tienda";
              const typeLabel = o.catalog_type === "retail" ? "Detal" : "Mayor";
              const created = formatDate(o.created_at);

              const customerName = safeText(o.customer_name);
              const customerWa = safeText(o.customer_whatsapp);
              const note = safeText(o.customer_note);

              return (
                <div key={o.id} className="ap-card rounded-[28px] p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-semibold text-base truncate">
                        Pedido #{o.receipt_no ?? "—"}
                      </div>
                      <div className="text-xs truncate" style={{ color: "var(--ap-muted)" }}>
                        {storeName} · {typeLabel}
                      </div>
                      <div className="text-xs" style={{ color: "color-mix(in oklab, var(--ap-text) 55%, transparent)" }}>
                        {created}
                      </div>
                    </div>

                    <div className="shrink-0 flex flex-col items-end gap-2">
                      <span className={statusPill(o.status)}>{statusLabel(o.status)}</span>
                      <div className="text-lg font-bold">{money(o.total)}</div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-1 text-sm" style={{ color: "var(--ap-muted)" }}>
                    <div>
                      👤 Cliente: <b style={{ color: "var(--ap-text)" }}>{customerName}</b>
                    </div>
                    <div>
                      📲 WhatsApp: <b style={{ color: "var(--ap-text)" }}>{customerWa}</b>
                    </div>
                    {note !== "—" ? (
                      <div>
                        📝 Obs: <span style={{ color: "var(--ap-text)" }}>{note}</span>
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

                  {/* cambiar estado en móvil */}
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

                    <details className="rounded-2xl border p-3"
                      style={{
                        borderColor: "var(--ap-border)",
                        background: "color-mix(in oklab, var(--ap-card) 72%, transparent)",
                      }}
                    >
                      <summary
                        className="cursor-pointer select-none text-sm font-semibold"
                        style={{ color: "var(--ap-text)" }}
                      >
                        Ver token / más info
                      </summary>
                      <div className="mt-2 text-xs break-all" style={{ color: "var(--ap-muted)" }}>
                        Token: {o.token}
                      </div>
                    </details>
                  </div>
                </div>
              );
            })}
          </div>

          {/* ✅ DESKTOP */}
          <div className="hidden md:block space-y-3">
            {filtered.map((o) => {
              const storeName = o.stores?.name ?? "Tienda";
              const typeLabel = o.catalog_type === "retail" ? "Detal" : "Mayor";
              const created = formatDate(o.created_at);

              const customerName = safeText(o.customer_name);
              const customerWa = safeText(o.customer_whatsapp);
              const note = safeText(o.customer_note);

              return (
                <div key={o.id} className="ap-card rounded-[28px] p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="font-semibold">
                          #{o.receipt_no ?? "—"} · {storeName}
                        </div>
                        <span className="text-xs" style={{ color: "var(--ap-muted)" }}>
                          ({typeLabel})
                        </span>
                        <span className={statusPill(o.status)}>{statusLabel(o.status)}</span>
                      </div>

                      <div className="mt-1 text-sm" style={{ color: "var(--ap-muted)" }}>
                        {created} · Total: <b style={{ color: "var(--ap-text)" }}>{money(o.total)}</b>
                      </div>

                      <div className="mt-2 text-sm" style={{ color: "var(--ap-muted)" }}>
                        👤 <b style={{ color: "var(--ap-text)" }}>{customerName}</b> · 📲{" "}
                        <b style={{ color: "var(--ap-text)" }}>{customerWa}</b>
                      </div>

                      {note !== "—" ? (
                        <div className="mt-1 text-sm" style={{ color: "var(--ap-muted)" }}>
                          📝 <span style={{ color: "var(--ap-text)" }}>{note}</span>
                        </div>
                      ) : null}

                      <div className="mt-1 text-xs" style={{ color: "color-mix(in oklab, var(--ap-text) 45%, transparent)" }}>
                        Token: {o.token}
                      </div>
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

            <p className="text-xs" style={{ color: "var(--ap-muted)" }}>
              Mostrando últimos 200 pedidos.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
