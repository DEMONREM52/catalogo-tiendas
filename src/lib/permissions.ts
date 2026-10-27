import type { StoreMenuPermission } from "@/lib/store-user-auth";

export type PermissionInfo = { value: StoreMenuPermission; label: string; description: string; sensitive?: boolean };

/** Permisos agrupados por área, con su explicación (se validan en la base de datos). */
export const PERMISSION_GROUPS: Array<{ key: string; title: string; icon: string; items: PermissionInfo[] }> = [
  {
    key: "sales",
    title: "Ventas",
    icon: "💳",
    items: [
      { value: "pos", label: "POS / Facturar", description: "Vender, crear remisiones y facturas, editar documentos" },
      { value: "sales_void", label: "Anular documentos sin confirmar", description: "Anular facturas y remisiones que aún no se confirman (no mueven inventario)" },
      { value: "sales_return", label: "Devolución de venta", description: "Anular facturas y remisiones ya confirmadas: devuelve el inventario al punto y anula la cartera", sensitive: true },
      { value: "price_approve", label: "Autorizar precios 🔓", description: "Vender a cualquier precio y aprobar (con aviso y sonido) las solicitudes de vender por debajo del límite. Los límites de cada punto y usuario se configuran en Rentabilidad → Límites de precio", sensitive: true },
      { value: "orders", label: "Pedidos", description: "Ver pedidos de catálogos y cambiar su estado" },
      { value: "cash", label: "Caja de su punto 💵", description: "Abrir la caja con la base, registrar entradas y salidas y cerrarla contando el efectivo" },
      { value: "cash_manage", label: "Revisar cajas", description: "Ver las cajas de todos los puntos, aprobar faltantes o sobrantes y fijar la tolerancia (solo tienda madre)", sensitive: true },
    ],
  },
  {
    key: "parties",
    title: "Terceros, créditos y cartera",
    icon: "👥",
    items: [
      { value: "clients", label: "Terceros", description: "Ver, crear y editar clientes, proveedores, trabajadores…" },
      { value: "clients_delete", label: "Eliminar terceros", description: "Borrar terceros sin movimientos (si no, solo desactivar)", sensitive: true },
      { value: "receivables", label: "Cartera", description: "Ver cartera, estados de cuenta y registrar abonos" },
      { value: "credit", label: "Créditos", description: "Activar créditos, cupos y bloqueos; vender sobre el cupo; anular abonos", sensitive: true },
    ],
  },
  {
    key: "catalog",
    title: "Productos y catálogos",
    icon: "📦",
    items: [
      { value: "products_view", label: "Ver lista general de productos", description: "Solo lectura: ver y filtrar todos los productos con las existencias de cada punto (no puede crear, editar ni desactivar)" },
      { value: "products", label: "Crear y editar productos y catálogos", description: "Crear y editar productos (nombre, fotos, categoría, códigos), activarlos o desactivarlos; catálogos y campañas. Los precios van aparte", sensitive: true },
      { value: "products_prices", label: "Cambiar precios y % de ganancia 💲", description: "Cambiar los precios 1 a 5 y el % de ganancia de los productos. Sin esto, puede crear productos pero no tocar precios", sensitive: true },
      { value: "costs_view", label: "Ver costos y márgenes 💰", description: "Ver el costo de los productos, el valor del inventario, la ganancia y el % de ganancia en productos, existencias, kardex e informes. Sin esto salen ocultos 🔒 (la base no los entrega)", sensitive: true },
      { value: "categories", label: "Categorías", description: "Organizar las categorías de la tienda" },
    ],
  },
  {
    key: "inventory",
    title: "Inventario y compras",
    icon: "🏭",
    items: [
      { value: "inventory", label: "Inventario y kardex", description: "Ver existencias, bodegas y movimientos" },
      { value: "inventory_adjust", label: "Ajustes de inventario", description: "Corregir existencias con motivo", sensitive: true },
      { value: "inventory_alerts", label: "Alertas de inventario 🔔", description: "Recibe avisos urgentes con sonido cuando hay productos creados sin ingreso de factura (sin costo, sin precio, sin unidades)" },
      { value: "transfers", label: "Traslados", description: "Mover productos entre bodegas y puntos (y atender pedidos internos de su punto)" },
      { value: "stock_requests", label: "Pedidos internos", description: "Pedir mercancía agotada a otro punto o bodega, chatear y confirmar el recibido" },
      { value: "stock_requests_manage", label: "Gestión de pedidos internos", description: "Ver todos los pedidos internos y atenderlos (preparar, despachar, rechazar)" },
      { value: "notifications_config", label: "Sonidos y avisos de pedidos internos", description: "Elegir los tonos y notificaciones que suenan en cada punto cuando llega un pedido, un mensaje o cambia un estado" },
      { value: "purchases", label: "Compras", description: "Ingresar y editar facturas de proveedor (un usuario de punto, solo las de su punto)" },
      { value: "purchases_void", label: "Anular compras", description: "Anular una factura de proveedor completa (devuelve el inventario y anula la cuenta por pagar)", sensitive: true },
      { value: "suppliers", label: "Proveedores", description: "Administrar proveedores" },
      { value: "payables", label: "Cuentas por pagar", description: "Registrar pagos a proveedores", sensitive: true },
      { value: "internal_credit", label: "Cuenta con la bodega 🤝", description: "Ver lo que su punto le debe a la bodega por los traslados recibidos, sus vencimientos y abonos, y reportar novedades (daños, pérdidas)" },
      { value: "internal_credit_manage", label: "Administrar cuenta con puntos", description: "Activar el crédito de cada punto, % de la bodega, plazos y cupos; registrar abonos, deudas iniciales y aprobar novedades (solo tienda madre)", sensitive: true },
    ],
  },
  {
    key: "admin",
    title: "Administración",
    icon: "⚙️",
    items: [
      { value: "reports", label: "Informes de ventas 📊", description: "Ventas, productos más vendidos, vendedores, clientes y existencias por punto. Los costos y ganancias solo con «Ver costos». Un usuario de punto ve solo su punto" },
      { value: "audit", label: "Auditoría", description: "Historial de operaciones: quién hizo qué, cuándo y qué cambió. Un usuario de punto ve solo lo de su punto" },
      { value: "exports", label: "Exportar a Excel/CSV 📤", description: "Descargar listados: existencias, cartera, gastos, nómina, liquidaciones, rentabilidad e informes. Cada descarga queda en la auditoría", sensitive: true },
      { value: "store", label: "Mi tienda", description: "Datos, apariencia y medición de la tienda" },
      { value: "billing", label: "Datos de facturación", description: "Configuración de comprobantes y pagos" },
      { value: "users", label: "Usuarios", description: "Crear usuarios, cambiar permisos y eliminar accesos", sensitive: true },
      { value: "points", label: "Puntos", description: "Crear puntos, editarlos, asignar responsable y activarlos o suspenderlos", sensitive: true },
    ],
  },
  {
    key: "profit",
    title: "Rentabilidad",
    icon: "📈",
    items: [
      { value: "profit_view", label: "Ver rentabilidad y costos", description: "Costos, ganancias, márgenes y el informe de rentabilidad (solo de sus puntos si tiene punto asignado)", sensitive: true },
      { value: "profit_rules", label: "Reglas de precio por punto", description: "Proponer el % o precio propio de su punto (la madre lo aprueba si así está configurado)" },
      { value: "profit_approve", label: "Aprobar reglas de precio", description: "Aprobar o rechazar reglas, vender bajo costo con precio fijo y configurar límites de la madre", sensitive: true },
      { value: "profit_beneficiaries", label: "Beneficiarios y repartos", description: "Crear beneficiarios y definir el % de cada uno (la madre en su pozo; un punto solo en el suyo)", sensitive: true },
      { value: "profit_settle", label: "Preparar liquidaciones", description: "Calcular cuánto le corresponde a cada beneficiario y enviarlo a revisión" },
      { value: "profit_settle_approve", label: "Aprobar liquidaciones", description: "Aprobar, rechazar o revertir liquidaciones y anular pagos (nunca las que uno mismo preparó)", sensitive: true },
      { value: "profit_pay", label: "Registrar pagos de liquidaciones", description: "Registrar pagos totales o parciales a los beneficiarios", sensitive: true },
    ],
  },
  {
    key: "expenses",
    title: "Gastos y nómina",
    icon: "💸",
    items: [
      { value: "expenses", label: "Gastos", description: "Ver y registrar gastos con sus soportes (solo de sus puntos si tiene punto asignado)" },
      { value: "expenses_pay", label: "Pagar gastos", description: "Registrar y anular pagos de gastos, y anular gastos", sensitive: true },
      { value: "budgets", label: "Presupuestos, gastos fijos y reservas", description: "Presupuestos semanales, quincenales y mensuales, categorías (madre), gastos fijos y reservas" },
      { value: "payroll", label: "Nómina", description: "Empleados y preparar nóminas (ve salarios)", sensitive: true },
      { value: "payroll_approve", label: "Aprobar nómina", description: "Aprobar, reabrir o anular nóminas, anular pagos y configurar conceptos (nunca la que uno mismo preparó)", sensitive: true },
      { value: "payroll_pay", label: "Pagar nómina", description: "Registrar pagos totales o parciales a los empleados", sensitive: true },
      { value: "payroll_electronic", label: "Nómina electrónica (DIAN)", description: "Preparar, transmitir, ajustar y anular la nómina electrónica ante la DIAN (aparte de la nómina interna)", sensitive: true },
    ],
  },
  {
    key: "fiscal",
    title: "Facturación electrónica",
    icon: "🏛️",
    items: [
      { value: "fiscal", label: "Ver centro fiscal", description: "Documentos electrónicos, estados, salud fiscal y numeración (solo lectura)" },
      { value: "fiscal_send", label: "Emitir y reenviar", description: "Transmitir y reintentar documentos electrónicos, facturar remisiones pendientes" },
      { value: "fiscal_notes", label: "Notas y anulaciones", description: "Notas crédito/débito y anular documentos que nunca se transmitieron", sensitive: true },
      { value: "fiscal_download", label: "Descargar XML/PDF y exportar", description: "Descargas y expediente fiscal (queda auditado)" },
      { value: "fiscal_config", label: "Configuración fiscal", description: "Contribuyentes (NIT), establecimientos y reglas fiscales del punto", sensitive: true },
      { value: "fiscal_numbering", label: "Resoluciones y numeración", description: "Crear y cambiar resoluciones, prefijos y rangos", sensitive: true },
      { value: "fiscal_provider", label: "Proveedor tecnológico", description: "Conectar, probar, reconectar y guardar credenciales del proveedor", sensitive: true },
      { value: "fiscal_audit", label: "Auditoría fiscal", description: "Ver la auditoría fiscal y de seguridad" },
    ],
  },
];

export const PERMISSION_LIST: PermissionInfo[] = PERMISSION_GROUPS.flatMap((g) => g.items);
export const permissionLabel = (value: string) => PERMISSION_LIST.find((p) => p.value === value)?.label ?? value;

/** Plantillas para asignar permisos con un clic (luego se pueden ajustar). */
export const PERMISSION_PRESETS: Array<{ key: string; label: string; icon: string; permissions: StoreMenuPermission[] }> = [
  { key: "seller", label: "Vendedor", icon: "🛒", permissions: ["pos", "cash", "clients", "orders", "stock_requests", "products_view"] },
  { key: "cashier", label: "Cajero", icon: "💵", permissions: ["pos", "cash", "sales_void", "clients", "orders", "receivables", "stock_requests", "fiscal_send", "products_view"] },
  { key: "collector", label: "Cartera", icon: "📒", permissions: ["clients", "receivables", "credit", "reports", "exports"] },
  { key: "warehouse", label: "Bodega", icon: "📦", permissions: ["inventory", "inventory_adjust", "inventory_alerts", "transfers", "purchases", "suppliers", "stock_requests_manage", "products_view", "costs_view"] },
  { key: "product_creator", label: "Creador de productos", icon: "🆕", permissions: ["products", "categories", "products_view"] },
  { key: "accounting", label: "Contabilidad", icon: "🧮", permissions: ["clients", "receivables", "payables", "purchases", "purchases_void", "suppliers", "costs_view", "reports", "audit", "exports", "billing", "fiscal", "fiscal_send", "fiscal_notes", "fiscal_download", "fiscal_config", "fiscal_numbering", "fiscal_audit"] },
  { key: "auditor", label: "Auditor", icon: "🔎", permissions: ["audit", "reports", "costs_view", "exports", "fiscal", "fiscal_audit", "fiscal_download"] },
  { key: "point_admin", label: "Administrador de punto", icon: "📍", permissions: ["pos", "cash", "sales_void", "sales_return", "orders", "clients", "receivables", "products_view", "inventory", "transfers", "stock_requests", "stock_requests_manage", "notifications_config", "internal_credit", "reports", "audit", "fiscal", "fiscal_send", "fiscal_download"] },
  { key: "manager", label: "Supervisor", icon: "🧭", permissions: ["pos", "cash", "cash_manage", "sales_void", "sales_return", "price_approve", "orders", "clients", "receivables", "credit", "products_view", "products", "products_prices", "costs_view", "categories", "inventory", "transfers", "purchases", "purchases_void", "suppliers", "reports", "audit", "stock_requests", "stock_requests_manage", "notifications_config"] },
];
