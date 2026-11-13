/**
 * Cada módulo del menú y sus secciones (las pestañas de arriba de la página), con los permisos que las dejan ver.
 * Lo usan el encabezado del panel (DashboardShell) y el catálogo de REM (src/lib/rem/catalog.ts): una sola fuente.
 */
import { ERP_PERMISSIONS } from "@/lib/store-user-auth";

export type ModuleKey = "inventory" | "billing" | "finance" | "settings";

// Quién puede abrir la lista general de productos (solo lectura); igual que erp_product_catalog_browse.
export const FINANCE_PERMISSIONS = ["expenses", "expenses_pay", "budgets", "payroll", "payroll_approve", "payroll_pay"];
export const PROFIT_PERMISSIONS = ["profit_view", "profit_rules", "profit_approve", "profit_beneficiaries", "profit_settle", "profit_settle_approve", "profit_pay", "price_approve"];
export const PRODUCT_LIST_PERMISSIONS = ["products_view", "products", "inventory", "stock_requests", "stock_requests_manage", "transfers", "pos"];
export const FISCAL_PERMISSIONS = ["fiscal", "fiscal_send", "fiscal_notes", "fiscal_download", "fiscal_config", "fiscal_numbering", "fiscal_provider", "fiscal_audit"];
export const POINTS_PERMISSIONS = ["points", "inventory", "users", "audit", ...FISCAL_PERMISSIONS];

export type ModuleTab = { href: string; icon: string; label: string; short?: string; permissions: string[]; adminOnly?: boolean };
/** Cada módulo del menú y sus secciones (las pestañas de arriba de la página). */
export const MODULE_TABS: Record<ModuleKey, ModuleTab[]> = {
  inventory: [
    { href: "/dashboard/products", icon: "📦", label: "Productos", permissions: ["products"] },
    { href: "/dashboard/products/radar", icon: "📡", label: "Radar de productos", short: "Radar", permissions: ["products"] },
    { href: "/dashboard/lista-productos", icon: "📋", label: "Lista general", short: "Lista", permissions: PRODUCT_LIST_PERMISSIONS },
    { href: "/dashboard/categories", icon: "🗂️", label: "Categorías", permissions: ["categories"] },
    { href: "/dashboard/inventario", icon: "🏭", label: "Stock y compras", short: "Stock", permissions: ERP_PERMISSIONS },
  ],
  billing: [
    { href: "/dashboard/pos", icon: "💳", label: "POS / Vender", short: "POS", permissions: ["pos"] },
    { href: "/dashboard/caja", icon: "💵", label: "Caja", permissions: ["cash", "cash_manage"] },
    { href: "/dashboard/apartados", icon: "📌", label: "Apartados y cotizaciones", short: "Apartados", permissions: ["pos_layaways", "pos_quotes", "orders"] },
    { href: "/dashboard/promociones", icon: "🏷️", label: "Promociones y combos", short: "Promos", permissions: ["products_prices", "profit_rules", "price_approve"] },
    { href: "/dashboard/garantias", icon: "🛠️", label: "Garantías y devoluciones", short: "Garantías", permissions: ["pos", "inventory", "sales_return"] },
    { href: "/dashboard/fiscal", icon: "🏛️", label: "Factura electrónica", short: "Electrónica", permissions: FISCAL_PERMISSIONS },
    { href: "/dashboard/store/billing", icon: "🧾", label: "Datos de facturación", short: "Datos", permissions: ["billing"], adminOnly: true },
  ],
  finance: [
    { href: "/dashboard/rentabilidad", icon: "📈", label: "Rentabilidad", permissions: PROFIT_PERMISSIONS },
    { href: "/dashboard/gastos", icon: "💸", label: "Gastos y nómina", short: "Gastos", permissions: FINANCE_PERMISSIONS },
    { href: "/dashboard/equipo", icon: "🏆", label: "Comisiones y metas", short: "Metas", permissions: ["pos", "payroll", "profit_view", "reports"] },
    { href: "/dashboard/nomina-electronica", icon: "🧾", label: "Nómina electrónica", short: "N. electrónica", permissions: ["payroll_electronic"] },
    { href: "/dashboard/contador", icon: "🧮", label: "Para el contador", short: "Contador", permissions: ["exports"] },
  ],
  settings: [
    { href: "/dashboard/store", icon: "🏪", label: "Mi tienda", permissions: ["store"] },
    { href: "/dashboard/plan", icon: "💎", label: "Mi plan", permissions: ["store"], adminOnly: true },
    { href: "/dashboard/store/users", icon: "👤", label: "Usuarios", permissions: ["users"] },
    { href: "/dashboard/puntos", icon: "📍", label: "Puntos", permissions: POINTS_PERMISSIONS },
    { href: "/dashboard/vender-mas", icon: "🧩", label: "Funciones opcionales", short: "Opcionales", permissions: ["store", "orders", "products_prices", "catalogs", "products"] },
    { href: "/dashboard/datos", icon: "🔄", label: "Importar y exportar", short: "Datos", permissions: ["exports", "products", "clients", "receivables", "payables", "suppliers", "categories", "inventory_adjust"] },
    { href: "/dashboard/seguridad", icon: "🛡️", label: "Copias y seguridad", short: "Seguridad", permissions: ["security"] },
  ],
};
