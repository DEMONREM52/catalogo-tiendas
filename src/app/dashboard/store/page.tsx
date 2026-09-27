"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import Swal from "sweetalert2";
import { getDashboardStore, hasStorePermission, type DashboardStore } from "@/lib/store-utils";

function StoreLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      target="_blank"
      className="btn-soft inline-flex items-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold"
    >
      {label} ↗
    </Link>
  );
}

export default function StoreDashboardPage() {
  const [store, setStore] = useState<DashboardStore | null>(null);
  const [siteOrigin, setSiteOrigin] = useState("");
  const [canUsePos, setCanUsePos] = useState(false);
  const [canSeeOrders, setCanSeeOrders] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getDashboardStore()
      .then((access) => {
        if (!access.store) throw new Error("No se encontró la tienda de esta cuenta.");
        setStore(access.store);
        setSiteOrigin(window.location.origin);
        setCanUsePos(hasStorePermission(access, "pos"));
        setCanSeeOrders(hasStorePermission(access, "orders"));
      })
      .catch(async (error: unknown) => {
        await Swal.fire({
          icon: "error",
          title: "No se pudo cargar la tienda",
          text: String((error as Error)?.message ?? error),
          background: "#0b0b0b",
          color: "#fff",
        });
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <p className="p-4 text-sm" style={{ color: "var(--t-muted)" }}>Cargando tienda...</p>;
  }
  if (!store) return null;

  const retailUrl = `/${store.slug}/detal`;
  const wholesaleUrl = store.wholesale_key
    ? `/${store.slug}/mayor?key=${encodeURIComponent(store.wholesale_key)}`
    : `/${store.slug}/mayor`;
  const staffLoginUrl = siteOrigin
    ? `${siteOrigin}/acceso/${encodeURIComponent(store.slug)}?sid=${encodeURIComponent(store.id)}`
    : `/acceso/${encodeURIComponent(store.slug)}?sid=${encodeURIComponent(store.id)}`;

  async function copyStaffLoginUrl() {
    try {
      await navigator.clipboard.writeText(staffLoginUrl);
      await Swal.fire({
        icon: "success",
        title: "Enlace copiado",
        text: "Compártelo con los usuarios de esta tienda junto con su usuario y contraseña.",
        timer: 1800,
        showConfirmButton: false,
        background: "#0b0b0b",
        color: "#fff",
      });
    } catch (error: unknown) {
      await Swal.fire({
        icon: "error",
        title: "No se pudo copiar el enlace",
        text: String((error as Error)?.message ?? error),
        background: "#0b0b0b",
        color: "#fff",
      });
    }
  }

  return (
    <main className="space-y-6">
      <section className="glass rounded-[28px] p-6 md:p-8">
        <p className="text-xs font-semibold uppercase tracking-[0.2em]" style={{ color: "var(--t-muted)" }}>
          Tienda asignada
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{store.name}</h1>
          <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${store.active ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : "border-red-500/30 bg-red-500/10 text-red-300"}`}>
            {store.active ? "Activa" : "Inactiva"}
          </span>
        </div>
        <p className="mt-2 text-sm" style={{ color: "var(--t-muted)" }}>
          Este espacio pertenece a <b>{store.name}</b>. Los datos del catálogo, clientes y ventas se consultan usando el acceso asignado a esta tienda.
        </p>
      </section>

      <section className="glass-soft rounded-[24px] border p-5" style={{ borderColor: "var(--t-card-border)" }}>
        <h2 className="text-lg font-semibold">Acceso de usuarios de esta tienda</h2>
        <p className="mt-1 text-sm" style={{ color: "var(--t-muted)" }}>
          Comparte este enlace con los trabajadores que crees en <b>Usuarios</b>. Iniciarán sesión con su usuario interno y contraseña; el enlace identifica exclusivamente a <b>{store.name}</b>.
        </p>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row">
          <input
            aria-label="Enlace de acceso de usuarios de esta tienda"
            readOnly
            value={staffLoginUrl}
            className="min-w-0 flex-1 rounded-2xl border px-4 py-3 text-sm"
            style={{
              borderColor: "var(--t-card-border)",
              background: "color-mix(in oklab, var(--t-card-bg) 92%, transparent)",
              color: "var(--t-text)",
            }}
            onFocus={(event) => event.currentTarget.select()}
          />
          <button
            type="button"
            className="btn-soft rounded-2xl px-4 py-3 text-sm font-semibold"
            onClick={() => void copyStaffLoginUrl()}
          >
            Copiar enlace
          </button>
          <Link
            href={staffLoginUrl}
            target="_blank"
            className="btn-soft rounded-2xl px-4 py-3 text-center text-sm font-semibold"
          >
            Abrir enlace
          </Link>
        </div>
        <p className="mt-2 text-xs" style={{ color: "var(--t-muted)" }}>
          Este enlace abre el inicio de sesión de {store.name}; no crea usuarios por sí solo. Primero créalos y asígnales permisos en la sección Usuarios.
        </p>
      </section>

      <section className="glass-soft rounded-[24px] border p-5" style={{ borderColor: "var(--t-card-border)" }}>
        <h2 className="text-lg font-semibold">Catálogos</h2>
        <p className="mt-1 text-sm" style={{ color: "var(--t-muted)" }}>
          Abre los enlaces públicos habilitados para compartirlos con tus clientes.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          {store.catalog_retail ? <StoreLink href={retailUrl} label="Catálogo detal" /> : null}
          {store.catalog_wholesale ? <StoreLink href={wholesaleUrl} label="Catálogo mayorista" /> : null}
          {!store.catalog_retail && !store.catalog_wholesale ? (
            <p className="text-sm" style={{ color: "var(--t-muted)" }}>No hay catálogos habilitados para esta tienda.</p>
          ) : null}
        </div>
      </section>

      {canUsePos || canSeeOrders ? (
        <section className="grid gap-4 sm:grid-cols-2">
          {canUsePos ? (
            <Link href="/dashboard/pos" className="glass-soft rounded-[24px] border p-5" style={{ borderColor: "var(--t-card-border)" }}>
              <span className="text-2xl">💳</span>
              <h2 className="mt-3 font-semibold">POS / Facturación</h2>
              <p className="mt-1 text-sm" style={{ color: "var(--t-muted)" }}>Registra una venta de vitrina y prepara su comprobante.</p>
            </Link>
          ) : null}
          {canSeeOrders ? (
            <Link href="/dashboard/pedidos" className="glass-soft rounded-[24px] border p-5" style={{ borderColor: "var(--t-card-border)" }}>
              <span className="text-2xl">🧾</span>
              <h2 className="mt-3 font-semibold">Pedidos</h2>
              <p className="mt-1 text-sm" style={{ color: "var(--t-muted)" }}>Consulta los pedidos de esta tienda.</p>
            </Link>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}
