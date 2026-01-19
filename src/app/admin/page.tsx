import AdminShell from "./AdminShell";

export default function AdminHome() {
  return (
    <AdminShell>
      <div className="space-y-3">
        <h2 className="text-xl font-semibold">Resumen</h2>
        <p className="text-sm opacity-80">
          Desde aquí podrás administrar TODO: crear/editar/eliminar/activar/inactivar tiendas,
          ver pedidos, cambiar estados, revisar comprobantes, etc.
        </p>

        <div className="rounded-2xl border border-white/10 p-4">
          <p className="font-semibold">Siguiente paso recomendado</p>
          <p className="text-sm opacity-80 mt-1">
            Empecemos por <b>Tiendas</b> (CRUD total) y <b>Pedidos</b> (listar, cambiar estado, ver comprobante).
          </p>
        </div>
      </div>
    </AdminShell>
  );
}
