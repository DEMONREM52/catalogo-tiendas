/**
 * Todo lo que se puede abrir o crear desde el buscador Ctrl+K: páginas, cada pestaña de cada módulo y acciones
 * («Nuevo vale», «Nueva nómina»…). Cada uno con sinónimos y los permisos que lo dejan ver (basta uno).
 * Los enlaces con ?tab= abren esa pestaña y los ?nuevo= abren el formulario (src/lib/url-intent.ts).
 */
export type SearchEntry = {
  href: string; emoji: string; label: string; hint?: string; keywords?: string;
  /** Permisos: basta tener uno. Vacío = cualquiera con acceso a la tienda. */
  perms: string[];
  action?: boolean;
  adminOnly?: boolean;
};

const FIN = ["expenses", "expenses_pay", "budgets", "payroll", "payroll_approve", "payroll_pay"];
const PAYROLL = ["payroll", "payroll_approve", "payroll_pay"];
const SETTLE = ["profit_beneficiaries", "profit_settle", "profit_settle_approve", "profit_pay", "profit_view"];
const FISCAL = ["fiscal", "fiscal_send", "fiscal_notes", "fiscal_download", "fiscal_config", "fiscal_numbering", "fiscal_provider", "fiscal_audit"];
const CREDIT = ["internal_credit", "internal_credit_manage"];
const REQ = ["stock_requests", "stock_requests_manage", "transfers"];

export const SEARCH_INDEX: SearchEntry[] = [
  // ------------------------------------------------------------ acciones (crear)
  { href: "/dashboard/pos", emoji: "💳", label: "Nueva venta (POS)", keywords: "vender facturar remision caja cobrar cliente", perms: ["pos"], action: true },
  { href: "/dashboard/inventario?tab=purchases", emoji: "🧾", label: "Ingresar factura de compra", keywords: "nueva factura compra proveedor ingreso mercancia xml", perms: ["purchases"], action: true },
  { href: "/dashboard/products/crear", emoji: "✨", label: "Nuevo producto", keywords: "crear articulo referencia item", perms: ["products_create", "products"], action: true },
  { href: "/dashboard/products/importar", emoji: "📥", label: "Importar productos desde Excel", keywords: "excel csv subir masivo plantilla cargar", perms: ["products_import"], action: true },
  { href: "/dashboard/inventario?tab=transfers", emoji: "🚚", label: "Nuevo traslado", keywords: "enviar mercancia bodega punto mover", perms: ["transfers", "inventory"], action: true },
  { href: "/dashboard/pedidos?tab=internos&nuevo=1", emoji: "📨", label: "Nuevo pedido interno", keywords: "pedir mercancia punto bodega solicitar", perms: REQ, action: true },
  { href: "/dashboard/gastos?tab=loans&nuevo=vale", emoji: "🤝", label: "Nuevo vale a empleado", hint: "Vales y préstamos", keywords: "prestamo adelanto anticipo empleado descontar nomina", perms: PAYROLL, action: true },
  { href: "/dashboard/gastos?tab=expenses&nuevo=gasto", emoji: "💸", label: "Nuevo gasto", hint: "Gastos", keywords: "registrar egreso pago salida", perms: ["expenses", "expenses_pay"], action: true },
  { href: "/dashboard/gastos?tab=recurring&nuevo=gasto-fijo", emoji: "🔁", label: "Nuevo gasto fijo", hint: "Gastos fijos", keywords: "arriendo servicios mensual recurrente", perms: ["expenses", "budgets"], action: true },
  { href: "/dashboard/gastos?tab=payroll&nuevo=nomina", emoji: "📋", label: "Nueva nómina", hint: "Nómina", keywords: "liquidar nomina quincena pagar sueldos salarios", perms: ["payroll"], action: true },
  { href: "/dashboard/gastos?tab=payroll&nuevo=empleado", emoji: "🧑‍💼", label: "Nuevo empleado", hint: "Nómina", keywords: "contratar trabajador personal agregar empleado", perms: ["payroll"], action: true },
  { href: "/dashboard/gastos?tab=reserves&nuevo=reserva", emoji: "🐷", label: "Nueva reserva", hint: "Reservas", keywords: "ahorro fondo guardar", perms: ["budgets"], action: true },
  { href: "/dashboard/rentabilidad?tab=settle", emoji: "🧮", label: "Preparar liquidación", hint: "Repartos y liquidaciones", keywords: "liquidar pozo reparto ganancia socios beneficiarios anticipo", perms: ["profit_settle", "profit_settle_approve"], action: true },
  { href: "/dashboard/rentabilidad?tab=rules", emoji: "🏷️", label: "Nueva regla de precio por punto", hint: "Precios por punto", keywords: "precio porcentaje punto sede margen lista", perms: ["profit_rules", "profit_approve"], action: true },
  { href: "/dashboard/promociones", emoji: "🎁", label: "Nueva promoción o combo", keywords: "descuento oferta combo promo", perms: ["products_prices", "profit_rules", "price_approve"], action: true },
  { href: "/dashboard/apartados", emoji: "📌", label: "Nuevo apartado", keywords: "separado abono cliente reservar", perms: ["pos", "orders"], action: true },
  { href: "/dashboard/apartados?tab=cotizaciones", emoji: "📝", label: "Nueva cotización", keywords: "presupuesto cliente cotizar", perms: ["pos", "orders"], action: true },
  { href: "/dashboard/garantias", emoji: "🛠️", label: "Registrar garantía o devolución", keywords: "cambio devolucion garantia reclamo", perms: ["pos", "inventory", "sales_return"], action: true },
  { href: "/dashboard/inventario?tab=adjustments", emoji: "🔧", label: "Nuevo ajuste de inventario", keywords: "corregir existencias conteo faltante sobrante", perms: ["inventory_adjust", "inventory"], action: true },
  { href: "/dashboard/clientes", emoji: "👥", label: "Nuevo cliente o tercero", keywords: "crear cliente proveedor tercero", perms: ["clients"], action: true },
  { href: "/dashboard/mensajes?nuevo=1", emoji: "💬", label: "Nuevo chat", keywords: "mensaje escribir llamar equipo grupo", perms: ["messages"], action: true },
  { href: "/dashboard/store/users", emoji: "👤", label: "Nuevo usuario", keywords: "crear usuario permisos acceso equipo", perms: ["users"], action: true },
  { href: "/dashboard/caja", emoji: "💵", label: "Abrir o cerrar caja", keywords: "arqueo cierre efectivo turno", perms: ["cash", "cash_manage"], action: true },

  // ------------------------------------------------------------ Gastos y nómina
  { href: "/dashboard/gastos?tab=overview", emoji: "💼", label: "Resumen de gastos", hint: "Gastos y nómina", keywords: "cuanto gaste mes", perms: FIN },
  { href: "/dashboard/gastos?tab=expenses", emoji: "💸", label: "Gastos", hint: "Gastos y nómina", keywords: "egresos pagos por pagar", perms: ["expenses", "expenses_pay"] },
  { href: "/dashboard/gastos?tab=recurring", emoji: "🔁", label: "Gastos fijos", hint: "Gastos y nómina", keywords: "arriendo servicios mensuales", perms: ["expenses", "budgets"] },
  { href: "/dashboard/gastos?tab=budgets", emoji: "🎯", label: "Presupuestos", hint: "Gastos y nómina", keywords: "topes limites categorias", perms: ["budgets", "expenses"] },
  { href: "/dashboard/gastos?tab=payroll", emoji: "👥", label: "Nómina", hint: "Gastos y nómina", keywords: "empleados sueldos quincena pagos", perms: PAYROLL },
  { href: "/dashboard/gastos?tab=loans", emoji: "🤝", label: "Vales y préstamos", hint: "Gastos y nómina", keywords: "vale prestamo adelanto empleados cuotas", perms: PAYROLL },
  { href: "/dashboard/gastos?tab=reserves", emoji: "🐷", label: "Reservas", hint: "Gastos y nómina", keywords: "ahorro fondos", perms: ["budgets"] },
  { href: "/dashboard/nomina-electronica", emoji: "🧾", label: "Nómina electrónica", hint: "DIAN", keywords: "dian nomina electronica", perms: ["payroll_electronic"] },

  // ------------------------------------------------------------ Rentabilidad
  { href: "/dashboard/rentabilidad?tab=summary", emoji: "📈", label: "Resumen de rentabilidad", hint: "Rentabilidad", keywords: "ganancia utilidad ventas costo", perms: ["profit_view"] },
  { href: "/dashboard/rentabilidad?tab=points", emoji: "🏪", label: "Rentabilidad por punto", hint: "Rentabilidad", keywords: "puntos sedes mes a mes informe rango fechas horas", perms: ["profit_view"] },
  { href: "/dashboard/rentabilidad?tab=products", emoji: "📦", label: "Ganancia por producto", hint: "Rentabilidad", keywords: "margen producto mas rentable", perms: ["profit_view"] },
  { href: "/dashboard/rentabilidad?tab=rules", emoji: "🏷️", label: "Precios por punto", hint: "Rentabilidad", keywords: "reglas precio porcentaje punto", perms: ["profit_view", "profit_rules", "profit_approve"] },
  { href: "/dashboard/rentabilidad?tab=limits", emoji: "🛡️", label: "Límites de precio", hint: "Rentabilidad", keywords: "precio minimo aprobar descuento", perms: ["profit_view", "profit_rules", "price_approve"] },
  { href: "/dashboard/rentabilidad?tab=settle", emoji: "🤲", label: "Repartos y liquidaciones", hint: "Rentabilidad", keywords: "liquidacion liquidar pozo reparto anticipos gastos compartidos firmas", perms: SETTLE },
  { href: "/dashboard/rentabilidad?tab=sim", emoji: "🧪", label: "Simulador de precios", hint: "Rentabilidad", keywords: "simular que pasa si precio", perms: ["costs_view"] },
  { href: "/dashboard", emoji: "📊", label: "Informe de ventas", hint: "Inicio e informes", keywords: "reporte ventas del dia mas vendidos vendedores estadisticas", perms: ["reports", "pos", "orders"] },
  { href: "/dashboard/rentabilidad?tab=points", emoji: "🕐", label: "Informe por fechas y horas", hint: "Rentabilidad · Puntos", keywords: "reporte rango fecha hora ventas costo ganancia desde hasta", perms: ["profit_view"] },
  { href: "/dashboard/equipo", emoji: "🏆", label: "Comisiones y metas", keywords: "vendedores comision metas ranking", perms: ["pos", "payroll", "profit_view", "reports"] },
  { href: "/dashboard/contador", emoji: "🧮", label: "Para el contador", keywords: "contabilidad puc asientos exportar siigo world office", perms: ["exports"] },

  // ------------------------------------------------------------ Inventario
  { href: "/dashboard/inventario?tab=overview", emoji: "📊", label: "Resumen de inventario", hint: "Inventario", keywords: "valor inventario", perms: ["inventory", "purchases", "payables"] },
  { href: "/dashboard/inventario?tab=stock", emoji: "📦", label: "Existencias", hint: "Inventario", keywords: "stock cuanto hay unidades", perms: ["inventory"] },
  { href: "/dashboard/inventario?tab=warehouses", emoji: "🏬", label: "Puntos y bodegas", hint: "Inventario", keywords: "bodegas sedes almacenes", perms: ["inventory"] },
  { href: "/dashboard/inventario?tab=transfers", emoji: "🚚", label: "Traslados", hint: "Inventario", keywords: "envios mercancia entre puntos recibir", perms: ["transfers", "inventory"] },
  { href: "/dashboard/inventario?tab=adjustments", emoji: "🔧", label: "Ajustes de inventario", hint: "Inventario", keywords: "corregir conteo", perms: ["inventory_adjust", "inventory"] },
  { href: "/dashboard/inventario?tab=kardex", emoji: "📒", label: "Kardex", hint: "Inventario", keywords: "movimientos entradas salidas historial producto", perms: ["inventory"] },
  { href: "/dashboard/inventario?tab=stale", emoji: "⏳", label: "Productos sin movimiento", hint: "Inventario", keywords: "quietos no se venden", perms: ["inventory", "reports"] },
  { href: "/dashboard/inventario?tab=expiry", emoji: "📅", label: "Vencimientos", hint: "Inventario", keywords: "vence caducidad lotes", perms: ["inventory", "purchases", "products"] },
  { href: "/dashboard/inventario?tab=purchases", emoji: "🛒", label: "Facturas de compra", hint: "Inventario", keywords: "compras ingresos proveedor historial", perms: ["purchases"] },
  { href: "/dashboard/inventario?tab=suppliers", emoji: "🏭", label: "Proveedores", hint: "Inventario", keywords: "proveedor terceros", perms: ["suppliers", "purchases"] },
  { href: "/dashboard/inventario?tab=payables", emoji: "💳", label: "Cuentas por pagar", hint: "Inventario", keywords: "deudas proveedores pagar abonos vencidas", perms: ["payables"] },
  { href: "/dashboard/inventario?tab=internal", emoji: "🤝", label: "Cuenta con puntos", hint: "Inventario", keywords: "deuda puntos bodega liquidacion del punto mercancia en punto abono cuadrar", perms: CREDIT },
  { href: "/dashboard/inventario?tab=manifests", emoji: "📄", label: "Manifiestos", hint: "Inventario", keywords: "manifiesto carga", perms: ["inventory", "purchases"] },
  { href: "/dashboard/inventario?tab=audit", emoji: "🛡️", label: "Auditoría de inventario", hint: "Inventario", keywords: "quien cambio historial", perms: ["audit"] },
  { href: "/dashboard/products/radar", emoji: "📡", label: "Radar de productos", keywords: "falencias publicar publicame recordatorio redes sin foto sin precio quietos sin ventas salud administracion", perms: ["products"] },
  { href: "/dashboard/products/radar?ver=publicar", emoji: "📣", label: "Productos por publicar", keywords: "publicame publicar redes instagram recordatorio", perms: ["products"] },
  { href: "/dashboard/lista-productos", emoji: "📋", label: "Lista general de productos", keywords: "precios lista consultar", perms: ["products_view", "products", "inventory", "pos"] },
  { href: "/dashboard/products", emoji: "📦", label: "Productos", keywords: "editar precios fotos catalogo articulos", perms: ["products"] },
  { href: "/dashboard/categories", emoji: "🗂️", label: "Categorías", keywords: "grupos familias", perms: ["categories"] },

  // ------------------------------------------------------------ Ventas, clientes y pedidos
  { href: "/dashboard/pedidos?tab=clientes", emoji: "🧾", label: "Pedidos de clientes", hint: "Pedidos", keywords: "pedidos catalogo whatsapp ventas en linea", perms: ["orders"] },
  { href: "/dashboard/pedidos?tab=internos", emoji: "📨", label: "Pedidos internos", hint: "Pedidos", keywords: "pedidos entre puntos solicitudes", perms: REQ },
  { href: "/dashboard/clientes?tab=terceros", emoji: "👥", label: "Clientes y terceros", keywords: "clientes proveedores directorio", perms: ["clients", "receivables", "credit"] },
  { href: "/dashboard/clientes?tab=cartera", emoji: "💰", label: "Cartera", hint: "Clientes", keywords: "deudas clientes cobrar credito fiado", perms: ["receivables", "credit"] },
  { href: "/dashboard/clientes?tab=avisos", emoji: "🔔", label: "Avisos de cobro", hint: "Clientes", keywords: "recordatorios whatsapp cobrar", perms: ["receivables", "credit"] },
  { href: "/dashboard/clientes?tab=frecuentes", emoji: "⭐", label: "Clientes frecuentes", hint: "Clientes", keywords: "mejores clientes", perms: ["clients"] },
  { href: "/dashboard/clientes?tab=puntos", emoji: "🎟️", label: "Puntos de fidelidad", hint: "Clientes", keywords: "fidelizacion premios", perms: ["clients"] },
  { href: "/dashboard/apartados", emoji: "📌", label: "Apartados", keywords: "separados abonos", perms: ["pos", "orders"] },
  { href: "/dashboard/apartados?tab=cotizaciones", emoji: "📝", label: "Cotizaciones", keywords: "presupuestos clientes", perms: ["pos", "orders"] },
  { href: "/dashboard/caja", emoji: "💵", label: "Caja", keywords: "arqueo cierre efectivo", perms: ["cash", "cash_manage"] },
  { href: "/dashboard/garantias", emoji: "🛠️", label: "Garantías y devoluciones", keywords: "cambios devoluciones", perms: ["pos", "inventory", "sales_return"] },
  { href: "/dashboard/promociones", emoji: "🏷️", label: "Promociones y combos", keywords: "descuentos ofertas", perms: ["products_prices", "profit_rules", "price_approve"] },
  { href: "/dashboard/operaciones", emoji: "🗂️", label: "Centro de operaciones", keywords: "documentos movimientos ventas del dia", perms: ["orders", "pos"] },

  // ------------------------------------------------------------ Factura electrónica
  { href: "/dashboard/fiscal?tab=resumen", emoji: "🏛️", label: "Factura electrónica", hint: "DIAN", keywords: "dian alanube electronica", perms: FISCAL },
  { href: "/dashboard/fiscal?tab=documentos", emoji: "📄", label: "Documentos electrónicos", hint: "Factura electrónica", keywords: "facturas enviadas dian notas", perms: FISCAL },
  { href: "/dashboard/fiscal?tab=pendientes", emoji: "⏳", label: "Facturas pendientes de enviar", hint: "Factura electrónica", keywords: "rechazadas pendientes dian", perms: FISCAL },
  { href: "/dashboard/fiscal?tab=numeracion", emoji: "🔢", label: "Numeración y resoluciones", hint: "Factura electrónica", keywords: "resolucion prefijo consecutivo", perms: ["fiscal_numbering", "fiscal_config"] },

  // ------------------------------------------------------------ Catálogos y ajustes
  { href: "/dashboard/social?tab=catalogs", emoji: "🛍️", label: "Catálogos", keywords: "tienda en linea pagina catalogo pdf", perms: ["catalogs"] },
  { href: "/dashboard/social?tab=campaigns", emoji: "📣", label: "Campañas", keywords: "carrusel promociones redes", perms: ["catalogs"] },
  { href: "/dashboard/landing", emoji: "🚀", label: "Landing pages", keywords: "anuncios pauta pagina producto", perms: ["landing"] },
  { href: "/dashboard/store", emoji: "🏪", label: "Mi tienda", keywords: "logo nombre datos redes enlaces whatsapp", perms: ["store"] },
  { href: "/dashboard/store/users", emoji: "👤", label: "Usuarios y permisos", keywords: "roles administrador accesos equipo", perms: ["users"] },
  { href: "/dashboard/puntos", emoji: "📍", label: "Puntos", keywords: "sedes sucursales configurar punto", perms: ["points", "inventory", "users", "audit"] },
  { href: "/dashboard/datos", emoji: "🔄", label: "Importar y exportar", keywords: "excel descargar subir datos respaldo", perms: ["exports", "products", "clients"] },
  { href: "/dashboard/seguridad", emoji: "🛡️", label: "Copias y seguridad", keywords: "backup respaldo copia", perms: ["security"] },
  { href: "/dashboard/plan", emoji: "💎", label: "Mi plan", keywords: "suscripcion pagar remhub mensualidad", perms: ["store"], adminOnly: true },
  { href: "/dashboard/auditoria", emoji: "🕵️", label: "Auditoría de la tienda", keywords: "quien hizo cambios historial espia", perms: ["audit"] },
  { href: "/dashboard/mensajes", emoji: "💬", label: "Mensajes", keywords: "chat llamadas equipo", perms: ["messages"] },
];
