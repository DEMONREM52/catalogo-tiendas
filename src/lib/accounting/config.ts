// Configuración de la exportación «Para el contador»: cuentas del PUC, códigos de comprobante y qué se incluye.
// Todo trae un valor por defecto razonable para un comercio en Colombia; el contador lo ajusta una vez y queda guardado.

export type DocKind = "sale" | "purchase" | "receipt" | "payment" | "expense" | "payroll";
export type PayKey = "efectivo" | "transferencia" | "nequi" | "tarjeta" | "otro";

export type Accounts = {
  customers: string;
  sales: string;
  vatGenerated: string;
  vatDeductible: string;
  inventory: string;
  costOfSales: string;
  suppliers: string;
  expensesPayable: string;
  expenseDefault: string;
  payrollExpense: string;
  payrollEmployer: string;
  payrollPayable: string;
  payrollWithholdings: string;
};

export type AccountingConfig = {
  accounts: Accounts;
  /** Cuenta de caja o banco según el medio de pago. */
  methods: Record<PayKey, string>;
  /** Cuenta de gasto por categoría (id de la categoría → cuenta). Lo que no esté usa expenseDefault. */
  expenseAccounts: Record<string, string>;
  /** Centro de costo por punto o bodega (id → código). */
  costCenters: Record<string, string>;
  /** Código del comprobante en el programa del contador para cada tipo de documento. */
  docCodes: Record<DocKind, string>;
  include: Record<DocKind, boolean>;
  /** «products»: el IVA sale de la tarifa de cada producto (precios con IVA incluido). «none»: no responsable de IVA. */
  vatMode: "products" | "none";
  /** Asiento de costo de ventas con el costo promedio actual de cada producto. */
  includeCost: boolean;
  /** Documento para ventas sin cliente (consumidor final). */
  finalConsumerId: string;
  /** NIT de la tienda (tercero de la nómina y documentos internos). */
  storeNit: string;
  /** «remhub»: el número de RemHub (REM-12). «sequence»: consecutivo numérico por comprobante desde startAt. */
  numbering: "remhub" | "sequence";
  startAt: Record<DocKind, number>;
  /** Formato elegido (id de uno de los programas o de un formato propio). */
  format: string;
  customFormats: CustomFormat[];
};

export type Field =
  | "doc_code" | "prefix" | "doc_number" | "date" | "year" | "month" | "day" | "account" | "third_id" | "third_dv" | "third_name"
  | "description" | "debit" | "credit" | "amount" | "nature" | "base" | "cost_center" | "due_date" | "seq" | "doc_ref" | "blank" | "fixed";

export type Column = { header: string; field: Field; fixed?: string };

export type FormatSpec = {
  id: string;
  name: string;
  program: string;
  note: string;
  file: "xlsx" | "csv" | "txt";
  separator: ";" | "," | "\t" | "|";
  date: "dd/mm/yyyy" | "yyyy-mm-dd" | "yyyymmdd" | "dd-mm-yyyy" | "mm/dd/yyyy";
  decimal: "." | ",";
  /** Encabezados en la primera fila (algunos planos no los llevan). */
  headers: boolean;
  columns: Column[];
};

export type CustomFormat = FormatSpec & { custom: true };

export const DEFAULT_ACCOUNTS: Accounts = {
  customers: "130505",
  sales: "413595",
  vatGenerated: "240801",
  vatDeductible: "240802",
  inventory: "143505",
  costOfSales: "613595",
  suppliers: "220505",
  expensesPayable: "233595",
  expenseDefault: "519595",
  payrollExpense: "510506",
  payrollEmployer: "510568",
  payrollPayable: "250505",
  payrollWithholdings: "237005",
};

export const DEFAULT_CONFIG: AccountingConfig = {
  accounts: DEFAULT_ACCOUNTS,
  methods: { efectivo: "110505", transferencia: "111005", nequi: "111005", tarjeta: "111005", otro: "110505" },
  expenseAccounts: {},
  costCenters: {},
  docCodes: { sale: "FV", purchase: "FC", receipt: "RC", payment: "CE", expense: "GA", payroll: "NO" },
  include: { sale: true, purchase: true, receipt: true, payment: true, expense: true, payroll: true },
  vatMode: "products",
  includeCost: false,
  finalConsumerId: "222222222222",
  storeNit: "",
  numbering: "remhub",
  startAt: { sale: 1, purchase: 1, receipt: 1, payment: 1, expense: 1, payroll: 1 },
  format: "generico",
  customFormats: [],
};

export const ACCOUNT_LABELS: Record<keyof Accounts, string> = {
  customers: "Clientes (ventas a crédito y abonos)",
  sales: "Ingresos por ventas",
  vatGenerated: "IVA generado en ventas",
  vatDeductible: "IVA descontable en compras",
  inventory: "Inventario de mercancías",
  costOfSales: "Costo de ventas",
  suppliers: "Proveedores",
  expensesPayable: "Gastos por pagar",
  expenseDefault: "Gastos (si la categoría no tiene cuenta)",
  payrollExpense: "Nómina: sueldos y prestaciones",
  payrollEmployer: "Nómina: aportes del empleador",
  payrollPayable: "Nómina: salarios por pagar",
  payrollWithholdings: "Nómina: aportes y descuentos por pagar",
};

export const METHOD_LABELS: Record<PayKey, string> = {
  efectivo: "Efectivo (caja)",
  transferencia: "Transferencia (banco)",
  nequi: "Nequi / Daviplata",
  tarjeta: "Tarjeta (datáfono)",
  otro: "Otros / pedidos de catálogo",
};

export const DOC_LABELS: Record<DocKind, string> = {
  sale: "Ventas",
  purchase: "Compras",
  receipt: "Recibos de caja (abonos de clientes)",
  payment: "Pagos a proveedores",
  expense: "Gastos",
  payroll: "Nómina",
};

/** Mezcla lo guardado con los valores por defecto (así una versión nueva con más campos no rompe lo viejo). */
export function mergeConfig(saved: Partial<AccountingConfig> | null | undefined): AccountingConfig {
  const s = saved ?? {};
  return {
    ...DEFAULT_CONFIG,
    ...s,
    accounts: { ...DEFAULT_ACCOUNTS, ...(s.accounts ?? {}) },
    methods: { ...DEFAULT_CONFIG.methods, ...(s.methods ?? {}) },
    expenseAccounts: { ...(s.expenseAccounts ?? {}) },
    costCenters: { ...(s.costCenters ?? {}) },
    docCodes: { ...DEFAULT_CONFIG.docCodes, ...(s.docCodes ?? {}) },
    include: { ...DEFAULT_CONFIG.include, ...(s.include ?? {}) },
    startAt: { ...DEFAULT_CONFIG.startAt, ...(s.startAt ?? {}) },
    customFormats: Array.isArray(s.customFormats) ? s.customFormats : [],
  };
}

/** Medio de pago de RemHub → llave de la configuración. */
export function payKey(method: string | null | undefined): PayKey {
  const m = String(method ?? "").toLowerCase();
  if (m === "efectivo" || m === "cash") return "efectivo";
  if (m === "transferencia" || m === "transfer" || m === "bank") return "transferencia";
  if (m === "nequi" || m === "daviplata") return "nequi";
  if (m === "tarjeta" || m === "card") return "tarjeta";
  return "otro";
}
