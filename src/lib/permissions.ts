import { PERMISSIONS_V2_MARK, STORE_MENU_PERMISSIONS, type StoreMenuPermission } from "@/lib/store-user-auth";

/** Qué tanto daño puede hacer un permiso en manos equivocadas. */
export type PermissionRisk = "low" | "medium" | "high" | "critical";

export type PermissionInfo = {
  value: StoreMenuPermission;
  label: string;
  description: string;
  /** Alto o crítico: dalo solo a personas de confianza. */
  sensitive?: boolean;
  risk: PermissionRisk;
  /** Qué abre o deja hacer, en pocas palabras (para el resumen y el buscador). */
  opens?: string;
};

export type PermissionGroup = { key: string; title: string; icon: string; hint: string; items: PermissionInfo[] };

const P = (value: StoreMenuPermission, label: string, risk: PermissionRisk, description: string, opens?: string): PermissionInfo =>
  ({ value, label, description, risk, sensitive: risk === "high" || risk === "critical", opens });

/** Permisos agrupados por área, con su explicación (se validan en la base de datos). */
export const PERMISSION_GROUPS: PermissionGroup[] = [
  {
    key: "sales", title: "Ventas y caja", icon: "💳", hint: "Vender, anular, devoluciones, precios y caja",
    items: [
      P("pos", "POS / Facturar", "medium", "Vender, crear remisiones y facturas, apartados y cotizaciones, editar documentos sin confirmar", "POS · Apartados · Garantías"),
      P("sales_void", "Anular documentos sin confirmar", "medium", "Anular facturas y remisiones que aún no se confirman (no mueven inventario)"),
      P("sales_return", "Devolución de venta", "high", "Anular facturas y remisiones ya confirmadas: devuelve el inventario al punto y anula la cartera", "Garantías y devoluciones"),
      P("price_approve", "Autorizar precios 🔓", "high", "Vender a cualquier precio y aprobar (con aviso y sonido) las solicitudes de vender por debajo del límite. Los límites se configuran en Rentabilidad → Límites de precio", "Promociones"),
      P("cash", "Caja de su punto 💵", "medium", "Abrir la caja con la base, registrar entradas y salidas y cerrarla contando el efectivo", "Caja"),
      P("cash_manage", "Revisar cajas", "high", "Ver las cajas de todos los puntos, aprobar faltantes o sobrantes y fijar la tolerancia (solo tienda madre)", "Caja (todos los puntos)"),
    ],
  },
  {
    key: "orders", title: "Pedidos", icon: "🧾", hint: "Pedidos de catálogo y pedidos internos entre puntos",
    items: [
      P("orders", "Pedidos de catálogo", "low", "Ver los pedidos que llegan de los catálogos y cambiar su estado", "Pedidos"),
      P("stock_requests", "Pedidos internos", "low", "Pedir mercancía agotada a otro punto o bodega, chatear y confirmar el recibido", "Pedidos → Internos"),
      P("stock_requests_manage", "Atender pedidos internos", "medium", "Ver todos los pedidos internos y atenderlos (preparar, despachar, rechazar)"),
      P("notifications_config", "Sonidos y avisos de pedidos", "low", "Elegir los tonos y notificaciones que suenan en cada punto cuando llega un pedido, un mensaje o cambia un estado"),
    ],
  },
  {
    key: "parties", title: "Terceros y cartera", icon: "👥", hint: "Clientes, proveedores, créditos y abonos",
    items: [
      P("clients", "Terceros", "low", "Ver, crear y editar clientes, proveedores, trabajadores…", "Terceros y cartera"),
      P("clients_delete", "Eliminar terceros", "high", "Borrar terceros sin movimientos (si tiene movimientos, solo desactivar)"),
      P("receivables", "Cartera", "medium", "Ver cartera y estados de cuenta, y registrar abonos"),
      P("credit", "Créditos y cupos", "high", "Activar créditos, cupos y bloqueos; vender sobre el cupo; anular abonos"),
    ],
  },
  {
    key: "catalog", title: "Productos", icon: "📦", hint: "Crear, editar, importar, eliminar, precios y costos",
    items: [
      P("products_view", "Ver lista general de productos", "low", "Solo lectura: ver y filtrar todos los productos con las existencias de cada punto", "Lista general"),
      P("products", "Editar productos", "medium", "Editar nombre, fotos, categoría y códigos, y activar o desactivar productos. Es la base de los permisos de abajo", "Productos"),
      P("products_create", "Crear productos ✨", "medium", "Crear productos nuevos uno por uno"),
      P("products_import", "Importar productos (Excel) 📥", "high", "Subir o actualizar muchos productos de una vez desde Excel"),
      P("products_delete", "Eliminar productos 🗑️", "critical", "Borrar productos sin ventas ni traslados (con unidades, solo haciéndose responsable). La base lo exige"),
      P("products_prices", "Cambiar precios y % de ganancia 💲", "high", "Cambiar los precios 1 a 5 y el % de ganancia. Sin esto puede editar productos pero no tocar precios"),
      P("costs_view", "Ver costos y márgenes 💰", "high", "Ver costo, valor del inventario, ganancia y % de ganancia en productos, existencias, kardex e informes. Sin esto salen ocultos 🔒 (la base no los entrega)"),
      P("categories", "Categorías", "low", "Crear, ordenar y editar las categorías de la tienda", "Categorías"),
    ],
  },
  {
    key: "marketing", title: "Catálogos y marketing", icon: "🛍️", hint: "Catálogos, campañas y landing pages",
    items: [
      P("catalogs", "Catálogos y campañas", "medium", "Crear y editar catálogos, campañas, tarjetas para compartir y catálogo en PDF (sin poder editar productos)", "Catálogos y campañas"),
      P("landing", "Landing pages 🚀", "medium", "Crear landing pages, su inventario, pauta y medición (sin poder editar productos)", "Landing pages"),
    ],
  },
  {
    key: "inventory", title: "Inventario", icon: "🏭", hint: "Existencias, kardex, ajustes y traslados",
    items: [
      P("inventory", "Inventario y kardex", "low", "Ver existencias, bodegas y movimientos", "Stock y compras"),
      P("inventory_adjust", "Ajustes de inventario", "high", "Corregir existencias con motivo"),
      P("inventory_alerts", "Alertas de inventario 🔔", "low", "Avisos con sonido cuando hay productos creados sin ingreso de factura (sin costo, sin precio, sin unidades)"),
      P("transfers", "Traslados", "medium", "Mover productos entre bodegas y puntos (y atender pedidos internos de su punto)"),
    ],
  },
  {
    key: "purchases", title: "Compras y proveedores", icon: "🛒", hint: "Facturas de proveedor, anulaciones y pagos",
    items: [
      P("purchases", "Compras", "medium", "Ingresar y editar facturas de proveedor (un usuario de punto, solo las de su punto)"),
      P("purchases_void", "Anular compras", "high", "Anular una factura de proveedor completa (devuelve el inventario y anula la cuenta por pagar)"),
      P("suppliers", "Proveedores", "low", "Administrar proveedores"),
      P("payables", "Cuentas por pagar", "high", "Registrar pagos a proveedores"),
    ],
  },
  {
    key: "points", title: "Puntos y bodega", icon: "📍", hint: "Puntos de venta y la cuenta de cada punto con la bodega",
    items: [
      P("points", "Puntos", "high", "Crear puntos, editarlos, asignar responsable y activarlos o suspenderlos", "Puntos"),
      P("internal_credit", "Cuenta con la bodega 🤝", "low", "Ver lo que su punto le debe a la bodega por los traslados, vencimientos y abonos, y reportar novedades"),
      P("internal_credit_manage", "Administrar cuenta con puntos", "high", "Activar el crédito de cada punto, % de la bodega, plazos y cupos; registrar abonos y aprobar novedades (solo tienda madre)"),
    ],
  },
  {
    key: "profit", title: "Rentabilidad", icon: "📈", hint: "Márgenes, reglas de precio y liquidaciones",
    items: [
      P("profit_view", "Ver rentabilidad", "high", "Costos, ganancias, márgenes y el informe de rentabilidad (solo de sus puntos si tiene punto asignado)", "Rentabilidad"),
      P("profit_rules", "Reglas de precio por punto", "medium", "Proponer el % o precio propio de su punto (la madre lo aprueba si así está configurado)"),
      P("profit_approve", "Aprobar reglas de precio", "high", "Aprobar o rechazar reglas, vender bajo costo con precio fijo y configurar límites de la madre"),
      P("profit_beneficiaries", "Beneficiarios y repartos", "high", "Crear beneficiarios y definir el % de cada uno"),
      P("profit_settle", "Preparar liquidaciones", "medium", "Calcular cuánto le corresponde a cada beneficiario y enviarlo a revisión"),
      P("profit_settle_approve", "Aprobar liquidaciones", "critical", "Aprobar, rechazar o revertir liquidaciones y anular pagos (nunca las que uno mismo preparó)"),
      P("profit_pay", "Pagar liquidaciones", "critical", "Registrar pagos totales o parciales a los beneficiarios"),
    ],
  },
  {
    key: "expenses", title: "Gastos y nómina", icon: "💸", hint: "Gastos, presupuestos, nómina y nómina electrónica",
    items: [
      P("expenses", "Gastos", "medium", "Ver y registrar gastos con sus soportes (solo de sus puntos si tiene punto asignado)", "Gastos"),
      P("expenses_pay", "Pagar gastos", "high", "Registrar y anular pagos de gastos, y anular gastos"),
      P("budgets", "Presupuestos, gastos fijos y reservas", "medium", "Presupuestos, categorías (madre), gastos fijos y reservas"),
      P("payroll", "Nómina", "high", "Empleados y preparar nóminas (ve salarios)", "Nómina"),
      P("payroll_approve", "Aprobar nómina", "critical", "Aprobar, reabrir o anular nóminas, anular pagos y configurar conceptos (nunca la que uno mismo preparó)"),
      P("payroll_pay", "Pagar nómina", "critical", "Registrar pagos totales o parciales a los empleados"),
      P("payroll_electronic", "Nómina electrónica (DIAN)", "high", "Preparar, transmitir, ajustar y anular la nómina electrónica ante la DIAN", "Nómina electrónica"),
    ],
  },
  {
    key: "fiscal", title: "Facturación electrónica", icon: "🏛️", hint: "DIAN: emitir, notas, numeración y proveedor",
    items: [
      P("fiscal", "Ver centro fiscal", "low", "Documentos electrónicos, estados, salud fiscal y numeración (solo lectura)", "Factura electrónica"),
      P("fiscal_send", "Emitir y reenviar", "medium", "Transmitir y reintentar documentos electrónicos, facturar remisiones pendientes"),
      P("fiscal_notes", "Notas y anulaciones", "high", "Notas crédito/débito y anular documentos que nunca se transmitieron"),
      P("fiscal_download", "Descargar XML/PDF", "medium", "Descargas y expediente fiscal (queda auditado)"),
      P("fiscal_config", "Configuración fiscal", "high", "Contribuyentes (NIT), establecimientos y reglas fiscales del punto"),
      P("fiscal_numbering", "Resoluciones y numeración", "high", "Crear y cambiar resoluciones, prefijos y rangos"),
      P("fiscal_provider", "Proveedor tecnológico", "critical", "Conectar, probar y guardar credenciales del proveedor"),
      P("fiscal_audit", "Auditoría fiscal", "medium", "Ver la auditoría fiscal y de seguridad"),
      P("billing", "Datos de facturación", "high", "Comprobantes, consecutivos y medios de pago de la tienda", "Datos de facturación"),
    ],
  },
  {
    key: "reports", title: "Informes y auditoría", icon: "📊", hint: "Informes, historial de cambios y descargas",
    items: [
      P("reports", "Informes de ventas", "medium", "Ventas, más vendidos, vendedores, clientes y existencias por punto. Costos y ganancias solo con «Ver costos»", "Informes · Comisiones y metas"),
      P("audit", "Auditoría", "high", "Historial de operaciones: quién hizo qué, cuándo y qué cambió. Un usuario de punto ve solo su punto", "Auditoría"),
      P("exports", "Exportar a Excel/CSV 📤", "high", "Descargar listados (existencias, cartera, gastos, nómina, informes) y lo del contador. Cada descarga queda en la auditoría", "Para el contador · Importar y exportar"),
    ],
  },
  {
    key: "team", title: "Equipo y comunicación", icon: "🧑‍🤝‍🧑", hint: "Usuarios, contraseñas y mensajes",
    items: [
      P("messages", "Mensajes y llamadas 💬", "low", "Chatear y llamar con el equipo desde Mensajes", "Mensajes"),
      P("users", "Usuarios y permisos", "critical", "Crear usuarios, cambiar permisos, horarios y permisos temporales. Solo puede dar los permisos que él mismo tiene", "Usuarios"),
      P("users_passwords", "Cambiar contraseñas del equipo 🔑", "critical", "Poner una contraseña nueva a otro usuario (necesita «Usuarios»). El servidor lo exige"),
      P("users_delete", "Eliminar usuarios", "critical", "Quitar el acceso de forma permanente (necesita «Usuarios»). El servidor lo exige"),
    ],
  },
  {
    key: "admin", title: "Tienda y seguridad", icon: "⚙️", hint: "Datos de la tienda, copias y seguridad",
    items: [
      P("store", "Mi tienda", "high", "Datos, logo, redes, apariencia y medición de la tienda", "Mi tienda"),
      P("security", "Copias y seguridad 🛡️", "critical", "Copias de seguridad, sesiones y ajustes de seguridad (necesita «Usuarios»)", "Copias y seguridad"),
    ],
  },
];

export const PERMISSION_LIST: PermissionInfo[] = PERMISSION_GROUPS.flatMap((g) => g.items);

export const RISK_INFO: Record<PermissionRisk, { label: string; color: string; weight: number }> = {
  low: { label: "Bajo", color: "#10b981", weight: 1 },
  medium: { label: "Medio", color: "#0ea5e9", weight: 2 },
  high: { label: "Alto", color: "#f59e0b", weight: 4 },
  critical: { label: "Crítico", color: "#ef4444", weight: 7 },
};

/**
 * Permisos que no sirven solos: al marcarlos se marca también el que necesitan, y al quitar el base se quitan.
 * Solo los casos claros (la pantalla o el dato que usan exige el otro). Se puede tener el base sin el «hijo».
 */
export const PERMISSION_REQUIRES: Partial<Record<StoreMenuPermission, StoreMenuPermission[]>> = {
  clients_delete: ["clients"],
  inventory_adjust: ["inventory"],
  purchases_void: ["purchases"],
  internal_credit_manage: ["internal_credit"],
  profit_approve: ["profit_view"],
  profit_settle: ["profit_view"],
  profit_settle_approve: ["profit_view"],
  profit_pay: ["profit_view"],
  profit_beneficiaries: ["profit_view"],
  fiscal_notes: ["fiscal"],
  fiscal_download: ["fiscal"],
  fiscal_config: ["fiscal"],
  fiscal_numbering: ["fiscal"],
  fiscal_provider: ["fiscal"],
  fiscal_audit: ["fiscal"],
  products_create: ["products"],
  products_import: ["products"],
  products_delete: ["products"],
  // Desde 20261316 la base acepta «Catálogos» y «Landing» sin «Editar productos»: solo necesitan ver productos.
  catalogs: ["products_view"],
  landing: ["products_view"],
  users_passwords: ["users"],
  users_delete: ["users"],
  security: ["users"],
};

/**
 * Cuando se desglosaron los permisos (20261285), cada permiso grande se partió. Quien tenía el grande sigue
 * teniendo lo de adentro: la migración se lo agrega, y mientras no se corra se hereda aquí.
 */
export const LEGACY_CHILDREN: Partial<Record<StoreMenuPermission, StoreMenuPermission[]>> = {
  products: ["products_create", "products_import", "products_delete", "catalogs", "landing"],
  users: ["users_passwords", "users_delete", "security"],
};
/** Los mensajes antes eran de todos. */
export const LEGACY_FOR_EVERYONE: StoreMenuPermission[] = ["messages"];

/** Permisos efectivos de una lista guardada (agrega lo heredado si se guardó antes del desglose). */
export function expandLegacyPermissions(perms: readonly string[] | null | undefined): string[] {
  const list = [...(perms ?? [])];
  if (list.includes(PERMISSIONS_V2_MARK)) return list;
  const set = new Set(list);
  for (const [parent, kids] of Object.entries(LEGACY_CHILDREN)) if (set.has(parent)) kids!.forEach((k) => set.add(k));
  LEGACY_FOR_EVERYONE.forEach((k) => set.add(k));
  return [...set];
}

/** Lo que se guarda: sin la marca (la pone el servidor) y sin repetidos. */
export function cleanPermissions(perms: readonly string[]) {
  return [...new Set(perms.filter((p) => p !== PERMISSIONS_V2_MARK))];
}

/** Marca o quita un permiso respetando lo que necesita (y lo que depende de él). */
export function togglePermission(value: string[], permission: string): string[] {
  const set = new Set(value);
  if (set.has(permission)) {
    set.delete(permission);
    // Quita en cadena lo que dependía de este.
    let changed = true;
    while (changed) {
      changed = false;
      for (const [child, parents] of Object.entries(PERMISSION_REQUIRES)) {
        if (set.has(child) && parents!.some((p) => !set.has(p))) { set.delete(child); changed = true; }
      }
    }
  } else {
    const add = (p: string) => { if (set.has(p)) return; set.add(p); (PERMISSION_REQUIRES[p as StoreMenuPermission] ?? []).forEach(add); };
    add(permission);
  }
  return [...set];
}
export const permissionLabel = (value: string) => PERMISSION_LIST.find((p) => p.value === value)?.label ?? value;
export const permissionInfo = (value: string) => PERMISSION_LIST.find((p) => p.value === value);

/** Puntaje de riesgo de un conjunto de permisos (0-100) para el medidor del editor. */
export function riskScore(perms: readonly string[]) {
  const max = PERMISSION_LIST.reduce((n, p) => n + RISK_INFO[p.risk].weight, 0);
  const got = PERMISSION_LIST.filter((p) => perms.includes(p.value)).reduce((n, p) => n + RISK_INFO[p.risk].weight, 0);
  return Math.round((got / max) * 100);
}

/** Plantillas para asignar permisos con un clic (luego se pueden ajustar). */
export const PERMISSION_PRESETS: Array<{ key: string; label: string; icon: string; hint: string; permissions: StoreMenuPermission[] }> = [
  { key: "admin", label: "Administrador", icon: "👑", hint: "Todos los permisos (luego puedes quitar alguno)", permissions: [...STORE_MENU_PERMISSIONS] },
  { key: "seller", label: "Vendedor", icon: "🛒", hint: "Vende, atiende pedidos y clientes", permissions: ["pos", "cash", "clients", "orders", "stock_requests", "products_view", "messages"] },
  { key: "cashier", label: "Cajero", icon: "💵", hint: "Vende, cobra, anula sin confirmar y emite", permissions: ["pos", "cash", "sales_void", "clients", "orders", "receivables", "stock_requests", "fiscal", "fiscal_send", "products_view", "messages"] },
  { key: "collector", label: "Cartera", icon: "📒", hint: "Cobra, maneja créditos e informes", permissions: ["clients", "receivables", "credit", "reports", "exports", "messages"] },
  { key: "warehouse", label: "Bodega", icon: "📦", hint: "Inventario, compras y traslados", permissions: ["inventory", "inventory_adjust", "inventory_alerts", "transfers", "purchases", "suppliers", "stock_requests_manage", "products_view", "costs_view", "messages"] },
  { key: "buyer", label: "Compras", icon: "🛍️", hint: "Facturas de proveedor y cuentas por pagar", permissions: ["purchases", "suppliers", "payables", "inventory", "products_view", "costs_view", "clients", "messages"] },
  { key: "product_creator", label: "Creador de productos", icon: "🆕", hint: "Crea y edita productos, sin precios", permissions: ["products", "products_create", "categories", "products_view", "messages"] },
  { key: "marketing", label: "Marketing", icon: "📣", hint: "Catálogos, campañas y landing pages", permissions: ["products", "catalogs", "landing", "categories", "products_view", "orders", "messages"] },
  { key: "accounting", label: "Contabilidad", icon: "🧮", hint: "Cartera, pagos, fiscal y exportes", permissions: ["clients", "receivables", "payables", "purchases", "purchases_void", "suppliers", "costs_view", "reports", "audit", "exports", "billing", "fiscal", "fiscal_send", "fiscal_notes", "fiscal_download", "fiscal_config", "fiscal_numbering", "fiscal_audit", "expenses", "messages"] },
  { key: "auditor", label: "Auditor", icon: "🔎", hint: "Solo mira: auditoría, informes y costos", permissions: ["audit", "reports", "costs_view", "exports", "fiscal", "fiscal_audit", "fiscal_download", "products_view", "inventory", "messages"] },
  { key: "viewer", label: "Solo consulta", icon: "👀", hint: "Ve productos, existencias e informes", permissions: ["products_view", "inventory", "reports", "messages"] },
  { key: "point_admin", label: "Administrador de punto", icon: "📍", hint: "Todo lo del día a día de su punto", permissions: ["pos", "cash", "sales_void", "sales_return", "orders", "clients", "receivables", "products_view", "inventory", "transfers", "stock_requests", "stock_requests_manage", "notifications_config", "internal_credit", "reports", "audit", "fiscal", "fiscal_send", "fiscal_download", "expenses", "messages"] },
  { key: "manager", label: "Supervisor", icon: "🧭", hint: "Ventas, inventario, compras y precios", permissions: ["pos", "cash", "cash_manage", "sales_void", "sales_return", "price_approve", "orders", "clients", "receivables", "credit", "products_view", "products", "products_create", "products_prices", "costs_view", "categories", "inventory", "transfers", "purchases", "purchases_void", "suppliers", "reports", "audit", "stock_requests", "stock_requests_manage", "notifications_config", "catalogs", "messages"] },
];

/**
 * Nombre del rol de una persona según sus permisos (para el encabezado del panel):
 * el rol guardado de la tienda o la plantilla con exactamente esos permisos; con todos los permisos,
 * «Administrador»; si no coincide con ninguno, «Rol personalizado».
 */
export function roleLabelFor(
  perms: readonly string[] | null | undefined,
  templates: ReadonlyArray<{ name: string; icon?: string | null; permissions: readonly string[] }> = [],
): { icon: string; label: string } {
  const norm = (p: readonly string[] | null | undefined) => new Set(cleanPermissions(expandLegacyPermissions(p ?? [])));
  const mine = norm(perms);
  const same = (other: readonly string[]) => { const o = norm(other); return o.size === mine.size && [...o].every((x) => mine.has(x)); };
  for (const t of templates) if (same(t.permissions)) return { icon: t.icon || "🧩", label: t.name };
  if (STORE_MENU_PERMISSIONS.every((p) => mine.has(p))) return { icon: "👑", label: "Administrador" };
  for (const p of PERMISSION_PRESETS) if (same(p.permissions)) return { icon: p.icon, label: p.label };
  return { icon: "🧩", label: "Rol personalizado" };
}
