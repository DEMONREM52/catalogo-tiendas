export default function DashboardHome() {
  return (
    <div className="space-y-6">
      <div className="glass rounded-[28px] p-6">
        <h2 className="text-2xl font-semibold">Bienvenido</h2>
        <p className="mt-2 text-sm opacity-80">
          Usa el menú de la izquierda para entrar a Mi tienda, Productos, Categorías y Pedidos.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="glass-soft rounded-[24px] p-5">
          <p className="font-semibold">🏪 Mi tienda</p>
          <p className="mt-1 text-sm opacity-80">
            Cambia logo, banner, WhatsApp, perfil y tema.
          </p>
        </div>

        <div className="glass-soft rounded-[24px] p-5">
          <p className="font-semibold">📦 Productos</p>
          <p className="mt-1 text-sm opacity-80">
            Crea/edita productos, precios y sube imágenes.
          </p>
        </div>

        <div className="glass-soft rounded-[24px] p-5">
          <p className="font-semibold">🧾 Pedidos</p>
          <p className="mt-1 text-sm opacity-80">
            Revisa pedidos, cambia estados y abre comprobantes.
          </p>
        </div>
      </div>
    </div>
  );
}
