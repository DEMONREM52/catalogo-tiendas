"use client";

import AdminShell, { useInsideAdminShell } from "./AdminShell";

function AdminHomeContent() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="glass rounded-[28px] p-6">
        <h2 className="text-2xl font-semibold">Bienvenido al panel administrativo</h2>
        <p className="mt-2 text-sm opacity-80">
          Desde aquí controlas todo tu negocio: tiendas, productos, pedidos, comprobantes y facturas.
          Todo en un solo lugar.
        </p>
      </div>

      {/* Qué puedes hacer */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="glass-soft rounded-[24px] p-5">
          <p className="font-semibold">🏪 Tiendas</p>
          <p className="mt-1 text-sm opacity-80">
            Crea, edita, activa o desactiva tiendas. Cada tienda tiene su propio catálogo y pedidos.
          </p>
        </div>

        <div className="glass-soft rounded-[24px] p-5">
          <p className="font-semibold">📦 Pedidos</p>
          <p className="mt-1 text-sm opacity-80">
            Revisa pedidos en tiempo real, cambia estados y accede a los comprobantes y facturas.
          </p>
        </div>

        <div className="glass-soft rounded-[24px] p-5">
          <p className="font-semibold">🧾 Facturas</p>
          <p className="mt-1 text-sm opacity-80">
            Genera comprobantes y facturas PDF listas para imprimir o enviar al cliente.
          </p>
        </div>
      </div>

      {/* Siguiente paso */}
      <div className="glass rounded-[28px] p-6">
        <p className="font-semibold">🚀 Siguiente paso recomendado</p>
        <p className="mt-2 text-sm opacity-80">
          Empieza creando tu primera <b>Tienda</b>, luego agrega productos y categorías. Cuando compartas el
          link, los pedidos llegarán automáticamente aquí.
        </p>

        <div className="mt-4 flex flex-wrap gap-3">
          <span className="glass-soft rounded-full px-4 py-2 text-xs font-semibold">Diseño premium</span>
          <span className="glass-soft rounded-full px-4 py-2 text-xs font-semibold">Control total</span>
          <span className="glass-soft rounded-full px-4 py-2 text-xs font-semibold">Listo para vender</span>
        </div>
      </div>
    </div>
  );
}

export default function AdminHome() {
  const inside = useInsideAdminShell();

  // ✅ Si YA estás dentro de AdminShell (ej: layout.tsx lo envolvió),
  // solo renderiza el contenido sin volver a montar el shell.
  if (inside) return <AdminHomeContent />;

  // ✅ Si NO estás dentro, envuélvelo una sola vez.
  return (
    <AdminShell>
      <AdminHomeContent />
    </AdminShell>
  );
}
