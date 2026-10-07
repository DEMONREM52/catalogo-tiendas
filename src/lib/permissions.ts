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
      { value: "orders", label: "Pedidos", description: "Ver pedidos de catálogos y cambiar su estado" },
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
      { value: "products", label: "Productos y catálogos", description: "Productos, catálogos, campañas y precios por catálogo" },
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
      { value: "transfers", label: "Traslados", description: "Mover productos entre bodegas y puntos (y atender pedidos internos de su punto)" },
      { value: "stock_requests", label: "Pedidos internos", description: "Pedir mercancía agotada a otro punto o bodega, chatear y confirmar el recibido" },
      { value: "stock_requests_manage", label: "Gestión de pedidos internos", description: "Ver todos los pedidos internos y atenderlos (preparar, despachar, rechazar)" },
      { value: "purchases", label: "Compras", description: "Ingresar, editar y anular facturas de proveedor" },
      { value: "suppliers", label: "Proveedores", description: "Administrar proveedores" },
      { value: "payables", label: "Cuentas por pagar", description: "Registrar pagos a proveedores", sensitive: true },
    ],
  },
  {
    key: "admin",
    title: "Administración",
    icon: "⚙️",
    items: [
      { value: "audit", label: "Informes y auditoría", description: "Ventas, ganancias, inventario e historial de operaciones" },
      { value: "store", label: "Mi tienda", description: "Datos, apariencia y medición de la tienda" },
      { value: "billing", label: "Datos de facturación", description: "Configuración de comprobantes y pagos" },
      { value: "users", label: "Usuarios", description: "Crear usuarios, cambiar permisos y eliminar accesos", sensitive: true },
    ],
  },
];

export const PERMISSION_LIST: PermissionInfo[] = PERMISSION_GROUPS.flatMap((g) => g.items);
export const permissionLabel = (value: string) => PERMISSION_LIST.find((p) => p.value === value)?.label ?? value;

/** Plantillas para asignar permisos con un clic (luego se pueden ajustar). */
export const PERMISSION_PRESETS: Array<{ key: string; label: string; icon: string; permissions: StoreMenuPermission[] }> = [
  { key: "seller", label: "Vendedor", icon: "🛒", permissions: ["pos", "clients", "orders", "stock_requests"] },
  { key: "cashier", label: "Cajero", icon: "💵", permissions: ["pos", "clients", "orders", "receivables", "stock_requests"] },
  { key: "collector", label: "Cartera", icon: "📒", permissions: ["clients", "receivables", "credit", "audit"] },
  { key: "warehouse", label: "Bodega", icon: "📦", permissions: ["inventory", "inventory_adjust", "transfers", "purchases", "suppliers", "stock_requests_manage"] },
  { key: "accounting", label: "Contabilidad", icon: "🧮", permissions: ["clients", "receivables", "payables", "purchases", "suppliers", "audit", "billing"] },
  { key: "manager", label: "Supervisor", icon: "🧭", permissions: ["pos", "orders", "clients", "receivables", "credit", "products", "categories", "inventory", "transfers", "purchases", "suppliers", "audit", "stock_requests", "stock_requests_manage"] },
];
