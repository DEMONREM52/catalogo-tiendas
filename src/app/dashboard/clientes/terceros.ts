import { supabaseBrowser } from "@/lib/supabase/client";

export type ThirdKind = "customer" | "supplier" | "employee" | "seller" | "partner" | "carrier" | "other";

export const KINDS: Array<{ value: ThirdKind; label: string; plural: string; icon: string; color: string }> = [
  { value: "customer", label: "Cliente", plural: "Clientes", icon: "🛍️", color: "#8b5cf6" },
  { value: "supplier", label: "Proveedor", plural: "Proveedores", icon: "🚚", color: "#0ea5e9" },
  { value: "employee", label: "Trabajador", plural: "Trabajadores", icon: "🧑‍🔧", color: "#f59e0b" },
  { value: "seller", label: "Vendedor / asesor", plural: "Vendedores", icon: "🤝", color: "#22c55e" },
  { value: "partner", label: "Asociado / socio", plural: "Asociados", icon: "🏛️", color: "#ec4899" },
  { value: "carrier", label: "Transportador", plural: "Transportadores", icon: "🛵", color: "#14b8a6" },
  { value: "other", label: "Otro", plural: "Otros", icon: "📇", color: "#94a3b8" },
];
export const kindInfo = (k: string) => KINDS.find((x) => x.value === k) ?? KINDS[KINDS.length - 1];

export const DOC_TYPES: Array<[string, string]> = [
  ["CC", "Cédula de ciudadanía"],
  ["NIT", "NIT"],
  ["CE", "Cédula de extranjería"],
  ["TI", "Tarjeta de identidad"],
  ["PP", "Pasaporte"],
  ["PPT", "Permiso por protección temporal"],
  ["PEP", "Permiso especial de permanencia"],
  ["NIT_EXT", "NIT de otro país"],
  ["RC", "Registro civil"],
  ["OTRO", "Otro"],
];

export const TAX_REGIMES: Array<[string, string]> = [
  ["", "Sin definir"],
  ["no_responsable_iva", "No responsable de IVA"],
  ["responsable_iva", "Responsable de IVA"],
  ["regimen_simple", "Régimen simple de tributación"],
  ["gran_contribuyente", "Gran contribuyente"],
  ["autorretenedor", "Autorretenedor"],
  ["no_contribuyente", "No contribuyente"],
];

export const PAY_METHODS: Array<[string, string]> = [
  ["cash", "Efectivo"],
  ["transfer", "Transferencia"],
  ["card", "Tarjeta"],
  ["nequi", "Nequi / Daviplata"],
  ["check", "Cheque"],
  ["other", "Otro"],
];
export const methodLabel = (m: string) => PAY_METHODS.find(([v]) => v === m)?.[1] ?? m;

export type ThirdParty = {
  id: string;
  store_id: string;
  name: string;
  trade_name: string | null;
  kinds: ThirdKind[];
  person_type: "natural" | "juridica";
  document_type: string;
  document_number: string | null;
  email: string | null;
  mobile: string | null;
  phone: string | null;
  contact_name: string | null;
  address: string | null;
  city: string | null;
  department: string | null;
  country: string | null;
  birthday: string | null;
  tax_regime: string | null;
  price_list: number;
  seller_user_id: string | null;
  user_id: string | null;
  job_title: string | null;
  commission_pct: number;
  bank_name: string | null;
  bank_account_type: string | null;
  bank_account_number: string | null;
  supplier_payment_days: number;
  tags: string[];
  notes: string | null;
  active: boolean;
  credit_enabled: boolean;
  credit_limit: number;
  credit_days: number;
  credit_blocked: boolean;
  credit_blocked_reason: string | null;
  credit_updated_at: string | null;
  credit_updated_by_name: string | null;
  created_at: string;
};

export type Balance = { open_balance: number; overdue_balance: number; overdue_count: number; open_count: number; next_due: string | null };

export const FULL_COLUMNS =
  "id,store_id,name,trade_name,kinds,person_type,document_type,document_number,email,mobile,phone,contact_name,address,city,department,country,birthday,tax_regime,price_list,seller_user_id,user_id,job_title,commission_pct,bank_name,bank_account_type,bank_account_number,supplier_payment_days,tags,notes,active,credit_enabled,credit_limit,credit_days,credit_blocked,credit_blocked_reason,credit_updated_at,credit_updated_by_name,created_at";
const BASIC_COLUMNS = "id,store_id,name,document_number,email,mobile,address,city,department,price_list,created_at";

export function normalizeThird(row: Record<string, unknown>): ThirdParty {
  const n = (v: unknown, d = 0) => (v === null || v === undefined || v === "" ? d : Number(v));
  const s = (v: unknown) => (v === null || v === undefined ? null : String(v));
  return {
    id: String(row.id),
    store_id: String(row.store_id),
    name: String(row.name ?? ""),
    trade_name: s(row.trade_name),
    kinds: (Array.isArray(row.kinds) && row.kinds.length ? row.kinds : ["customer"]) as ThirdKind[],
    person_type: row.person_type === "juridica" ? "juridica" : "natural",
    document_type: String(row.document_type ?? "CC"),
    document_number: s(row.document_number),
    email: s(row.email),
    mobile: s(row.mobile),
    phone: s(row.phone),
    contact_name: s(row.contact_name),
    address: s(row.address),
    city: s(row.city),
    department: s(row.department),
    country: s(row.country) ?? "Colombia",
    birthday: s(row.birthday),
    tax_regime: s(row.tax_regime),
    price_list: n(row.price_list, 3),
    seller_user_id: s(row.seller_user_id),
    user_id: s(row.user_id),
    job_title: s(row.job_title),
    commission_pct: n(row.commission_pct),
    bank_name: s(row.bank_name),
    bank_account_type: s(row.bank_account_type),
    bank_account_number: s(row.bank_account_number),
    supplier_payment_days: n(row.supplier_payment_days),
    tags: Array.isArray(row.tags) ? (row.tags as string[]) : [],
    notes: s(row.notes),
    active: row.active !== false,
    credit_enabled: row.credit_enabled === true,
    credit_limit: n(row.credit_limit),
    credit_days: n(row.credit_days, 30),
    credit_blocked: row.credit_blocked === true,
    credit_blocked_reason: s(row.credit_blocked_reason),
    credit_updated_at: s(row.credit_updated_at),
    credit_updated_by_name: s(row.credit_updated_by_name),
    created_at: String(row.created_at ?? ""),
  };
}

/** Carga todos los terceros (por páginas). Si falta la migración, usa las columnas antiguas. */
export async function loadThirdParties(storeId: string): Promise<{ rows: ThirdParty[]; legacy: boolean }> {
  const sb = supabaseBrowser();
  const fetchAll = async (columns: string) => {
    const rows: Record<string, unknown>[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await sb.from("billing_customers").select(columns).eq("store_id", storeId).order("name").range(from, from + 999);
      if (error) return { rows, error };
      rows.push(...((data ?? []) as unknown as Record<string, unknown>[]));
      if (!data || data.length < 1000) return { rows, error: null };
    }
  };
  const full = await fetchAll(FULL_COLUMNS);
  if (!full.error) return { rows: full.rows.map(normalizeThird), legacy: false };
  const basic = await fetchAll(BASIC_COLUMNS);
  if (basic.error) throw basic.error;
  return { rows: basic.rows.map(normalizeThird), legacy: true };
}

export async function loadBalances(storeId: string): Promise<Map<string, Balance>> {
  const { data, error } = await supabaseBrowser().rpc("erp_third_party_balances", { p_store: storeId });
  const map = new Map<string, Balance>();
  if (error) return map;
  ((data ?? []) as Array<Balance & { customer_id: string }>).forEach((r) =>
    map.set(r.customer_id, {
      open_balance: Number(r.open_balance),
      overdue_balance: Number(r.overdue_balance),
      overdue_count: Number(r.overdue_count),
      open_count: Number(r.open_count),
      next_due: r.next_due,
    }),
  );
  return map;
}

export type CreditState = {
  found: boolean;
  enabled: boolean;
  blocked: boolean;
  blocked_reason: string | null;
  limit: number;
  days: number;
  used: number;
  available: number;
  overdue: number;
  overdue_count: number;
  can_sell: boolean;
  can_override: boolean;
  reason: string | null;
};

export const money = (value: number | null | undefined) =>
  new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(Number(value ?? 0));

export const shortDate = (value: string | null | undefined) =>
  value ? new Date(value.length <= 10 ? `${value}T12:00:00` : value).toLocaleDateString("es-CO", { day: "2-digit", month: "short", year: "numeric" }) : "—";

export function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("") || "?";
}

export function waLink(phone: string | null | undefined, text: string) {
  const digits = String(phone ?? "").replace(/\D/g, "");
  if (digits.length < 7) return null;
  const full = digits.length === 10 && digits.startsWith("3") ? `57${digits}` : digits;
  return `https://wa.me/${full}?text=${encodeURIComponent(text)}`;
}

export function errorText(error: unknown) {
  if (error && typeof error === "object" && "message" in error && typeof (error as { message: unknown }).message === "string") {
    const message = (error as { message: string }).message;
    if (/Could not find the function|schema cache|does not exist|PGRST20/i.test(message)) {
      return "Falta ejecutar en Supabase la migración 20261018_terceros_cartera.sql.";
    }
    return message;
  }
  return String(error);
}
