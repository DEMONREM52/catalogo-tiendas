"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { matchesSearch } from "@/lib/search";

type StoreRow = {
  id: string;
  name: string;
  slug: string;
  active: boolean;
  catalog_retail: boolean;
  catalog_wholesale: boolean;
  theme: string;
  created_at: string;
};
type OrderStatus = "draft" | "sent" | "confirmed" | "completed" | string;
type OrderRow = {
  id: string;
  store_id: string;
  catalog_type: "retail" | "wholesale" | string;
  status: OrderStatus;
  payment_status: string | null;
  total: number | null;
  token: string;
  receipt_no: number | null;
  created_at: string;
  customer_name: string | null;
  customer_whatsapp: string | null;
  payment_method: string | null;
  payment_method_name: string | null;
  paid_at: string | null;
};
type BillingDocument = {
  id: string;
  store_id: string;
  doc_type: string;
  status: string;
  full_number: string | null;
  customer_name: string | null;
  total: number | null;
  balance: number | null;
  issued_at: string;
  paid_at: string | null;
};
type PosInvoice = {
  id: string;
  store_id: string;
  number: number;
  status: string | null;
  subtotal: number | null;
  tax: number | null;
  total: number | null;
  created_at: string | null;
  paid_at: string | null;
};
type PaymentRow = {
  id: string;
  store_id: string | null;
  amount: number | null;
  method: string | null;
  paid_at?: string | null;
  created_at?: string | null;
};
type CreditInvoice = {
  id: string;
  store_id: string;
  amount: number;
  balance: number;
  due_date: string | null;
  status: string;
  created_at: string;
};
type InventoryMovement = {
  id: string;
  store_id: string;
  product_id: string;
  kind: "in" | "out";
  qty: number;
  note: string | null;
  created_at: string;
};
type CashSession = {
  id: string;
  store_id: string;
  status: string;
  opened_at: string;
  closed_at: string | null;
  expected_total: number | null;
  variance_total: number | null;
};
type StoreStaff = {
  id: string;
  store_id: string;
  username: string;
  full_name: string | null;
  role: string;
  active: boolean;
  created_at: string;
};
type CustomerRow = { id: string; store_id: string; name: string; created_at: string };
type StoreTeamMember = {
  store_id: string;
  user_id: string;
  username: string | null;
  display_name: string | null;
  role: string;
  active: boolean;
  permissions: string[];
  created_at: string;
};
type PosReceivable = {
  id: string;
  store_id: string | null;
  total: number | null;
  balance: number | null;
  due_date: string | null;
  status: string | null;
  created_at: string | null;
};
type OnlinePayment = {
  id: string;
  store_id: string;
  amount: number | null;
  status: string;
  provider: string | null;
  method_name: string | null;
  currency: string | null;
  created_at: string;
};
type PaymentTransaction = {
  id: string;
  store_id: string;
  amount_in_cents: number;
  status: string;
  payment_method_type: string | null;
  created_at: string;
};
type Period = "7" | "30" | "90" | "custom" | "all";

const PAGE_SIZE = 1000;
const ADMIN_LINKS = [
  { href: "/admin/tiendas", label: "Tiendas", detail: "Gestiona tiendas y accesos", icon: "🏪" },
  { href: "/admin/pedidos", label: "Pedidos", detail: "Consulta y actualiza pedidos", icon: "🧾" },
  { href: "/admin/productos", label: "Productos", detail: "Administra el catálogo", icon: "📦" },
  { href: "/admin/categorias", label: "Categorías", detail: "Organiza los productos", icon: "🗂️" },
  { href: "/admin/usuarios", label: "Usuarios y roles", detail: "Controla usuarios y permisos", icon: "👥" },
  { href: "/admin/themes", label: "Diseño de tiendas", detail: "Configura temas visuales", icon: "🎨" },
];
const STATUS_LABELS: Record<string, string> = {
  draft: "Borrador",
  sent: "Enviado",
  confirmed: "Confirmado",
  completed: "Completado",
};

function localDateValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateDaysAgo(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return localDateValue(date);
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatDate(value: string) {
  return new Date(value).toLocaleString("es-CO", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function isSale(order: OrderRow) {
  return order.status === "confirmed" || order.status === "completed";
}

function isPaid(order: OrderRow) {
  return order.payment_status?.toLowerCase() === "paid";
}

async function fetchAllPages<T>(fetchPage: (from: number, to: number) => PromiseLike<{
  data: T[] | null;
  error: { message: string } | null;
}>) {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await fetchPage(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const page = data ?? [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

async function fetchTableCounts(
  client: ReturnType<typeof supabaseBrowser>,
  tables: string[],
) {
  return Promise.all(tables.map(async (table) => {
    const { count, error } = await client.from(table).select("*", { count: "exact", head: true });
    if (error) throw new Error(`No se pudo consultar el total de ${table}: ${error.message}`);
    return [table, count ?? 0] as const;
  }));
}

function MetricCard({
  label,
  value,
  detail,
  icon,
  accent = false,
}: {
  label: string;
  value: string;
  detail: string;
  icon: string;
  accent?: boolean;
}) {
  return (
    <article className="glass-soft rounded-3xl p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm" style={{ color: "var(--t-muted)" }}>{label}</p>
          <p className="mt-3 text-2xl font-bold tracking-tight">{value}</p>
        </div>
        <span
          className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border text-xl"
          style={{
            borderColor: accent ? "color-mix(in oklab, var(--t-cta) 35%, var(--t-card-border))" : "var(--t-card-border)",
            background: accent ? "color-mix(in oklab, var(--t-cta) 15%, transparent)" : "var(--t-card-bg)",
          }}
        >
          {icon}
        </span>
      </div>
      <p className="mt-3 text-xs" style={{ color: "var(--t-muted)" }}>{detail}</p>
    </article>
  );
}

function RevenueChart({
  orders,
  documents,
  invoices,
  billingPayments,
  posPayments,
  endDate,
  period,
}: {
  orders: OrderRow[];
  documents: BillingDocument[];
  invoices: PosInvoice[];
  billingPayments: PaymentRow[];
  posPayments: PaymentRow[];
  endDate: string;
  period: Period;
}) {
  const chart = useMemo(() => {
    const end = period === "all" || !endDate ? new Date() : new Date(`${endDate}T00:00:00`);
    const start = new Date(end);
    start.setDate(start.getDate() - 13);
    start.setHours(0, 0, 0, 0);
    const days = Array.from({ length: 14 }, (_, index) => {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      return { key: localDateValue(date), label: date.toLocaleDateString("es-CO", { day: "numeric", month: "short" }), web: 0, pos: 0, billing: 0, receipts: 0 };
    });
    const byDay = new Map(days.map((day) => [day.key, day]));
    for (const order of orders) {
      const day = byDay.get(localDateValue(new Date(order.created_at)));
      if (!day) continue;
      if (isSale(order)) day.web += Number(order.total ?? 0);
    }
    for (const invoice of invoices) {
      const day = invoice.created_at ? byDay.get(localDateValue(new Date(invoice.created_at))) : null;
      if (day) day.pos += Number(invoice.total ?? 0);
    }
    for (const document of documents) {
      const day = byDay.get(localDateValue(new Date(document.issued_at)));
      if (day) day.billing += Number(document.total ?? 0);
    }
    for (const payment of [...billingPayments, ...posPayments]) {
      const paymentDate = payment.paid_at || payment.created_at;
      const day = paymentDate ? byDay.get(localDateValue(new Date(paymentDate))) : null;
      if (day) day.receipts += Number(payment.amount ?? 0);
    }
    const max = Math.max(1, ...days.flatMap((day) => [day.web, day.pos, day.billing, day.receipts]));
    return { days, max, today: localDateValue(end) };
  }, [orders, documents, invoices, billingPayments, posPayments, endDate, period]);

  return (
    <div className="mt-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold">Ventas e ingresos por canal</h3>
          <p className="mt-1 text-xs" style={{ color: "var(--t-muted)" }}>14 días hasta el final del periodo seleccionado · COP</p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-4 text-xs" style={{ color: "var(--t-muted)" }}>
        <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-sm bg-violet-500" /> Pedidos web confirmados</span>
        <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-sm bg-indigo-500" /> Facturas POS</span>
        <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-sm bg-sky-500" /> Documentos de facturación</span>
        <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-sm bg-fuchsia-500" /> Pagos POS / facturación</span>
      </div>
      <div className="mt-5 grid h-52 grid-cols-7 items-end gap-2 sm:grid-cols-14">
        {chart.days.map((day) => (
          <div key={day.key} className="flex h-full min-w-0 flex-col items-center justify-end gap-2" title={`${day.label}: web ${formatMoney(day.web)} · POS ${formatMoney(day.pos)} · facturación ${formatMoney(day.billing)} · pagos ${formatMoney(day.receipts)}`}>
            <div className="flex h-full w-full items-end justify-center gap-px">
              {[
                { value: day.web, color: "#8b5cf6" },
                { value: day.pos, color: "#6366f1" },
                { value: day.billing, color: "#0ea5e9" },
                { value: day.receipts, color: day.key === chart.today ? "#e879f9" : "#c026d3" },
              ].map((series) => (
                <div
                  key={series.color}
                  className="w-1/4 rounded-t-sm transition-all"
                  style={{
                    height: `${Math.max(series.value > 0 ? 5 : 1, (series.value / chart.max) * 100)}%`,
                    background: series.color,
                    opacity: series.value ? 1 : 0.2,
                  }}
                />
              ))}
            </div>
            <span className="truncate text-[10px]" style={{ color: "var(--t-muted)" }}>{day.label}</span>
          </div>
        ))}
      </div>
      <div className="mt-3 flex justify-between text-[11px]" style={{ color: "var(--t-muted)" }}>
        <span>{formatMoney(0)}</span>
        <span>{formatMoney(chart.max)}</span>
      </div>
    </div>
  );
}

function OrdersChart({ orders, endDate, period }: { orders: OrderRow[]; endDate: string; period: Period }) {
  const days = useMemo(() => {
    const end = period === "all" || !endDate ? new Date() : new Date(`${endDate}T00:00:00`);
    const start = new Date(end);
    start.setDate(start.getDate() - 13);
    start.setHours(0, 0, 0, 0);
    const result = Array.from({ length: 14 }, (_, index) => {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      return { key: localDateValue(date), label: date.toLocaleDateString("es-CO", { day: "numeric", month: "short" }), count: 0 };
    });
    const byDay = new Map(result.map((day) => [day.key, day]));
    for (const order of orders) {
      const day = byDay.get(localDateValue(new Date(order.created_at)));
      if (day) day.count++;
    }
    return result;
  }, [orders, endDate, period]);
  const max = Math.max(1, ...days.map((day) => day.count));

  return (
    <div className="mt-6 border-t pt-5" style={{ borderColor: "var(--t-card-border)" }}>
      <div>
        <h3 className="font-semibold">Compras / pedidos por día</h3>
        <p className="mt-1 text-xs" style={{ color: "var(--t-muted)" }}>Volumen diario · 14 días del periodo seleccionado</p>
      </div>
      <div className="mt-4 grid h-36 grid-cols-7 items-end gap-2 sm:grid-cols-14">
        {days.map((day) => (
          <div key={day.key} className="flex h-full min-w-0 flex-col items-center justify-end gap-2" title={`${day.label}: ${day.count} pedidos`}>
            <div className="flex h-full w-full items-end">
              <div className="w-full rounded-t-md bg-indigo-400" style={{ height: `${Math.max(day.count ? 5 : 1, (day.count / max) * 100)}%`, opacity: day.count ? 1 : 0.2 }} />
            </div>
            <span className="truncate text-[10px]" style={{ color: "var(--t-muted)" }}>{day.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function AdminOverview() {
  const [stores, setStores] = useState<StoreRow[]>([]);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [documents, setDocuments] = useState<BillingDocument[]>([]);
  const [posInvoices, setPosInvoices] = useState<PosInvoice[]>([]);
  const [billingPayments, setBillingPayments] = useState<PaymentRow[]>([]);
  const [posPayments, setPosPayments] = useState<PaymentRow[]>([]);
  const [onlinePayments, setOnlinePayments] = useState<OnlinePayment[]>([]);
  const [paymentTransactions, setPaymentTransactions] = useState<PaymentTransaction[]>([]);
  const [creditInvoices, setCreditInvoices] = useState<CreditInvoice[]>([]);
  const [inventoryMovements, setInventoryMovements] = useState<InventoryMovement[]>([]);
  const [cashSessions, setCashSessions] = useState<CashSession[]>([]);
  const [storeStaff, setStoreStaff] = useState<StoreStaff[]>([]);
  const [storeTeam, setStoreTeam] = useState<StoreTeamMember[]>([]);
  const [billingCustomers, setBillingCustomers] = useState<CustomerRow[]>([]);
  const [posReceivables, setPosReceivables] = useState<PosReceivable[]>([]);
  const [categoryCount, setCategoryCount] = useState(0);
  const [legacyCategoryCount, setLegacyCategoryCount] = useState(0);
  const [storeTeamCount, setStoreTeamCount] = useState(0);
  const [linkCount, setLinkCount] = useState(0);
  const [contactCount, setContactCount] = useState(0);
  const [themeCount, setThemeCount] = useState(0);
  const [notificationCount, setNotificationCount] = useState(0);
  const [cashReceiptCount, setCashReceiptCount] = useState(0);
  const [paymentTransactionCount, setPaymentTransactionCount] = useState(0);
  const [dataExchangeCount, setDataExchangeCount] = useState(0);
  const [auxiliaryCounts, setAuxiliaryCounts] = useState<Record<string, number>>({});
  const [productCount, setProductCount] = useState(0);
  const [userCount, setUserCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [period, setPeriod] = useState<Period>("30");
  const [startDate, setStartDate] = useState(() => dateDaysAgo(29));
  const [endDate, setEndDate] = useState(() => localDateValue(new Date()));
  const [storeFilter, setStoreFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [paymentFilter, setPaymentFilter] = useState("all");
  const [catalogFilter, setCatalogFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [storePage, setStorePage] = useState(1);

  useEffect(() => {
    let mounted = true;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const sb = supabaseBrowser();
        const [
          allStores,
          allOrders,
          allDocuments,
          allPosInvoices,
          allBillingPayments,
          allPosPayments,
          allOnlinePayments,
          allTransactions,
          allCreditInvoices,
          allInventoryMovements,
          allCashSessions,
          allStoreStaff,
          allStoreTeam,
          allCustomers,
          allPosReceivables,
          productsResult,
          usersResult,
          productCategoriesResult,
          categoriesResult,
          linksResult,
          contactsResult,
          themesResult,
          notificationsResult,
          cashReceiptsResult,
          exchangesResult,
          extraTableCounts,
        ] = await Promise.all([
          fetchAllPages<StoreRow>((from, to) =>
            sb.from("stores").select("id,name,slug,active,catalog_retail,catalog_wholesale,theme,created_at").order("created_at", { ascending: false }).range(from, to)
          ),
          fetchAllPages<OrderRow>((from, to) =>
            sb.from("orders")
              .select("id,store_id,catalog_type,status,payment_status,total,token,receipt_no,created_at,customer_name,customer_whatsapp,payment_method,payment_method_name,paid_at")
              .order("created_at", { ascending: false })
              .range(from, to)
          ),
          fetchAllPages<BillingDocument>((from, to) =>
            sb.from("billing_documents").select("id,store_id,doc_type,status,full_number,customer_name,total,balance,issued_at,paid_at").order("issued_at", { ascending: false }).range(from, to)
          ),
          fetchAllPages<PosInvoice>((from, to) =>
            sb.from("pos_invoices").select("id,store_id,number,status,subtotal,tax,total,created_at,paid_at").order("created_at", { ascending: false }).range(from, to)
          ),
          fetchAllPages<PaymentRow>((from, to) =>
            sb.from("billing_payments").select("id,store_id,amount,method,paid_at").order("paid_at", { ascending: false }).range(from, to)
          ),
          fetchAllPages<PaymentRow>((from, to) =>
            sb.from("pos_payments").select("id,store_id,amount,method,created_at").order("created_at", { ascending: false }).range(from, to)
          ),
          fetchAllPages<OnlinePayment>((from, to) =>
            sb.from("order_payments").select("id,store_id,amount,status,provider,method_name,currency,created_at").order("created_at", { ascending: false }).range(from, to)
          ),
          fetchAllPages<PaymentTransaction>((from, to) =>
            sb.from("payment_transactions").select("id,store_id,amount_in_cents,status,payment_method_type,created_at").order("created_at", { ascending: false }).range(from, to)
          ),
          fetchAllPages<CreditInvoice>((from, to) =>
            sb.from("credit_invoices").select("id,store_id,amount,balance,due_date,status,created_at").order("created_at", { ascending: false }).range(from, to)
          ),
          fetchAllPages<InventoryMovement>((from, to) =>
            sb.from("inventory_movements").select("id,store_id,product_id,kind,qty,note,created_at").order("created_at", { ascending: false }).range(from, to)
          ),
          fetchAllPages<CashSession>((from, to) =>
            sb.from("cash_sessions").select("id,store_id,status,opened_at,closed_at,expected_total,variance_total").order("opened_at", { ascending: false }).range(from, to)
          ),
          fetchAllPages<StoreStaff>((from, to) =>
            sb.from("store_staff").select("id,store_id,username,full_name,role,active,created_at").order("created_at", { ascending: false }).range(from, to)
          ),
          fetchAllPages<StoreTeamMember>((from, to) =>
            sb.from("store_users").select("store_id,user_id,username,display_name,role,active,permissions,created_at").order("created_at", { ascending: false }).range(from, to)
          ),
          fetchAllPages<CustomerRow>((from, to) =>
            sb.from("billing_customers").select("id,store_id,name,created_at").order("created_at", { ascending: false }).range(from, to)
          ),
          fetchAllPages<PosReceivable>((from, to) =>
            sb.from("pos_ar_accounts").select("id,store_id,total,balance,due_date,status,created_at").order("created_at", { ascending: false }).range(from, to)
          ),
          sb.from("products").select("id", { count: "exact", head: true }),
          sb.from("user_profiles").select("user_id", { count: "exact", head: true }),
          sb.from("product_categories").select("id", { count: "exact", head: true }),
          sb.from("categories").select("id", { count: "exact", head: true }),
          sb.from("store_links").select("id", { count: "exact", head: true }),
          sb.from("store_contacts").select("id", { count: "exact", head: true }),
          sb.from("themes").select("id", { count: "exact", head: true }),
          sb.from("admin_notifications").select("id", { count: "exact", head: true }),
          sb.from("cash_receipts").select("id", { count: "exact", head: true }),
          sb.from("data_exchange_jobs").select("id", { count: "exact", head: true }),
          fetchTableCounts(sb, [
            "billing_document_lines",
            "billing_audit_logs",
            "billing_numbering_series",
            "billing_series",
            "billing_doc_counters",
            "billing_counters",
            "pos_customers",
            "pos_invoice_items",
            "pos_stock_moves",
            "pos_cash_sessions",
            "pos_ar_payments",
            "store_profiles",
            "billing_settings",
            "store_billing_settings",
            "store_payment_methods",
            "siigo_invoices",
            "documents",
          ]),
        ]);
        const countResults = [
          ["productos", productsResult],
          ["perfiles globales", usersResult],
          ["categorías de productos", productCategoriesResult],
          ["categorías heredadas", categoriesResult],
          ["enlaces de tiendas", linksResult],
          ["contactos de tiendas", contactsResult],
          ["temas", themesResult],
          ["notificaciones", notificationsResult],
          ["recibos de caja", cashReceiptsResult],
          ["importaciones y exportaciones", exchangesResult],
        ] as const;
        const countError = countResults.find(([, result]) => result.error);
        if (countError) throw new Error(`No se pudieron cargar los totales de ${countError[0]}: ${countError[1].error?.message ?? "Error de consulta"}`);
        if (!mounted) return;
        setStores(allStores);
        setOrders(allOrders);
        setDocuments(allDocuments);
        setPosInvoices(allPosInvoices);
        setBillingPayments(allBillingPayments);
        setPosPayments(allPosPayments);
        setOnlinePayments(allOnlinePayments);
        setPaymentTransactions(allTransactions);
        setCreditInvoices(allCreditInvoices);
        setInventoryMovements(allInventoryMovements);
        setCashSessions(allCashSessions);
        setStoreStaff(allStoreStaff);
        setStoreTeam(allStoreTeam);
        setBillingCustomers(allCustomers);
        setPosReceivables(allPosReceivables);
        setProductCount(productsResult.count ?? 0);
        setUserCount(usersResult.count ?? 0);
        setCategoryCount(productCategoriesResult.count ?? 0);
        setLegacyCategoryCount(categoriesResult.count ?? 0);
        setStoreTeamCount(allStoreTeam.length);
        setLinkCount(linksResult.count ?? 0);
        setContactCount(contactsResult.count ?? 0);
        setThemeCount(themesResult.count ?? 0);
        setNotificationCount(notificationsResult.count ?? 0);
        setCashReceiptCount(cashReceiptsResult.count ?? 0);
        setPaymentTransactionCount(allTransactions.length);
        setDataExchangeCount(exchangesResult.count ?? 0);
        setAuxiliaryCounts(Object.fromEntries(extraTableCounts));
      } catch (loadError) {
        if (mounted) setError(loadError instanceof Error ? loadError.message : "No se pudieron cargar los datos del panel.");
      } finally {
        if (mounted) setLoading(false);
      }
    }
    void load();
    return () => { mounted = false; };
  }, []);

  function changePeriod(value: Period) {
    setPeriod(value);
    if (value !== "custom" && value !== "all") {
      setEndDate(localDateValue(new Date()));
      setStartDate(dateDaysAgo(Number(value) - 1));
    }
  }

  const filteredOrders = useMemo(() => {
    const query = search.trim();
    const start = period === "all" || !startDate ? null : new Date(`${startDate}T00:00:00`);
    const end = period === "all" || !endDate ? null : new Date(`${endDate}T23:59:59.999`);
    const storeNames = new Map(stores.map((store) => [store.id, store.name]));
    return orders.filter((order) => {
      const created = new Date(order.created_at);
      if (start && created < start) return false;
      if (end && created > end) return false;
      if (storeFilter !== "all" && order.store_id !== storeFilter) return false;
      if (statusFilter !== "all" && order.status !== statusFilter) return false;
      if (paymentFilter !== "all" && (isPaid(order) ? "paid" : "unpaid") !== paymentFilter) return false;
      if (catalogFilter !== "all" && order.catalog_type !== catalogFilter) return false;
      if (!query) return true;
      return matchesSearch([
        order.receipt_no,
        order.token,
        order.customer_name,
        order.customer_whatsapp,
        order.status,
        order.payment_status,
        order.catalog_type,
        storeNames.get(order.store_id),
      ].map((value) => String(value ?? "")).join(" "), query);
    });
  }, [orders, stores, period, startDate, endDate, storeFilter, statusFilter, paymentFilter, catalogFilter, search]);

  const metrics = useMemo(() => {
    const sales = filteredOrders.filter(isSale);
    const paid = filteredOrders.filter(isPaid);
    return {
      orders: filteredOrders.length,
      salesCount: sales.length,
      salesValue: sales.reduce((sum, order) => sum + Number(order.total ?? 0), 0),
      paidValue: paid.reduce((sum, order) => sum + Number(order.total ?? 0), 0),
      paidCount: paid.length,
    };
  }, [filteredOrders]);

  const operationalMetrics = useMemo(() => {
    const start = period === "all" || !startDate ? null : new Date(`${startDate}T00:00:00`);
    const end = period === "all" || !endDate ? null : new Date(`${endDate}T23:59:59.999`);
    const inScope = (storeId: string | null, dateValue: string | null | undefined) => {
      if (storeFilter !== "all" && storeId !== storeFilter) return false;
      if (!dateValue) return period === "all";
      const date = new Date(dateValue);
      return (!start || date >= start) && (!end || date <= end);
    };
    const visibleDocuments = documents.filter((document) => inScope(document.store_id, document.issued_at));
    const visibleInvoices = posInvoices.filter((invoice) => inScope(invoice.store_id, invoice.created_at));
    const visibleBillingPayments = billingPayments.filter((payment) => inScope(payment.store_id, payment.paid_at));
    const visiblePosPayments = posPayments.filter((payment) => inScope(payment.store_id, payment.created_at));
    const visibleOnlinePayments = onlinePayments.filter((payment) => inScope(payment.store_id, payment.created_at));
    const visibleTransactions = paymentTransactions.filter((transaction) => inScope(transaction.store_id, transaction.created_at));
    const visibleMovements = inventoryMovements.filter((movement) => inScope(movement.store_id, movement.created_at));
    const visibleCredits = creditInvoices.filter((invoice) => inScope(invoice.store_id, invoice.created_at));
    const visiblePosReceivables = posReceivables.filter((account) => inScope(account.store_id, account.created_at));
    const visibleCashSessions = cashSessions.filter((session) => inScope(session.store_id, session.opened_at));
    const sum = (values: Array<{ total?: number | null; amount?: number | null }>, field: "total" | "amount") =>
      values.reduce((total, row) => total + Number(row[field] ?? 0), 0);
    return {
      documents: visibleDocuments,
      invoices: visibleInvoices,
      billingPayments: visibleBillingPayments,
      posPayments: visiblePosPayments,
      onlinePayments: visibleOnlinePayments,
      transactions: visibleTransactions,
      movements: visibleMovements,
      credits: visibleCredits,
      posReceivables: visiblePosReceivables,
      cashSessions: visibleCashSessions,
      documentTotal: sum(visibleDocuments, "total"),
      posTotal: sum(visibleInvoices, "total"),
      billingPaymentsTotal: sum(visibleBillingPayments, "amount"),
      posPaymentsTotal: sum(visiblePosPayments, "amount"),
      onlinePaymentsTotal: sum(visibleOnlinePayments, "amount"),
      outstandingBalance: visibleCredits.reduce((total, invoice) => total + Math.max(0, Number(invoice.balance ?? 0)), 0),
      posOutstandingBalance: visiblePosReceivables.reduce((total, account) => total + Math.max(0, Number(account.balance ?? 0)), 0),
      stockIn: visibleMovements.filter((movement) => movement.kind === "in").reduce((total, movement) => total + Number(movement.qty ?? 0), 0),
      stockOut: visibleMovements.filter((movement) => movement.kind === "out").reduce((total, movement) => total + Number(movement.qty ?? 0), 0),
      openCashSessions: visibleCashSessions.filter((session) => session.status.toLowerCase() === "open").length,
    };
  }, [period, startDate, endDate, storeFilter, documents, posInvoices, billingPayments, posPayments, onlinePayments, paymentTransactions, inventoryMovements, creditInvoices, posReceivables, cashSessions]);

  const statusCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const order of filteredOrders) counts.set(order.status, (counts.get(order.status) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [filteredOrders]);

  const topStores = useMemo(() => {
    const counts = new Map<string, number>();
    for (const order of filteredOrders) counts.set(order.store_id, (counts.get(order.store_id) ?? 0) + 1);
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([storeId, count]) => ({ name: stores.find((store) => store.id === storeId)?.name ?? "Tienda", count }));
  }, [filteredOrders, stores]);

  const recentFinancialDocs = useMemo(() => [
    ...operationalMetrics.documents.map((document) => ({
      id: document.id,
      storeId: document.store_id,
      date: document.issued_at,
      type: document.doc_type,
      reference: document.full_number || document.id.slice(0, 8),
      customer: document.customer_name || "Cliente",
      total: Number(document.total ?? 0),
      status: document.status,
      balance: Number(document.balance ?? 0),
    })),
    ...operationalMetrics.invoices.map((invoice) => ({
      id: invoice.id,
      storeId: invoice.store_id,
      date: invoice.created_at || "",
      type: "Factura POS",
      reference: String(invoice.number),
      customer: "Venta POS",
      total: Number(invoice.total ?? 0),
      status: invoice.status || "—",
      balance: 0,
    })),
  ].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10), [operationalMetrics]);

  const recentPayments = useMemo(() => [
    ...operationalMetrics.billingPayments.map((payment) => ({
      id: `billing-${payment.id}`,
      storeId: payment.store_id,
      date: payment.paid_at || "",
      source: "Facturación",
      method: payment.method || "—",
      amount: Number(payment.amount ?? 0),
    })),
    ...operationalMetrics.posPayments.map((payment) => ({
      id: `pos-${payment.id}`,
      storeId: payment.store_id,
      date: payment.created_at || "",
      source: "POS",
      method: payment.method || "—",
      amount: Number(payment.amount ?? 0),
    })),
    ...operationalMetrics.onlinePayments.map((payment) => ({
      id: `online-${payment.id}`,
      storeId: payment.store_id,
      date: payment.created_at,
      source: `Pago de pedido · ${payment.provider || "web"}`,
      method: `${payment.method_name || "—"} · ${payment.status}`,
      amount: Number(payment.amount ?? 0),
    })),
    ...operationalMetrics.transactions.map((payment) => ({
      id: `transaction-${payment.id}`,
      storeId: payment.store_id,
      date: payment.created_at,
      source: "Transacción pasarela",
      method: `${payment.payment_method_type || "—"} · ${payment.status}`,
      amount: Number(payment.amount_in_cents ?? 0) / 100,
    })),
  ].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10), [operationalMetrics]);

  const pageCount = Math.max(1, Math.ceil(filteredOrders.length / 10));
  const visiblePage = Math.min(currentPage, pageCount);
  const recentOrders = filteredOrders.slice((visiblePage - 1) * 10, visiblePage * 10);
  const storesPerPage = 10;
  const storePageCount = Math.max(1, Math.ceil(stores.length / storesPerPage));
  const visibleStorePage = Math.min(storePage, storePageCount);
  const visibleStores = stores.slice((visibleStorePage - 1) * storesPerPage, visibleStorePage * storesPerPage);
  const inputClass = "w-full rounded-xl border px-3 py-2.5 text-sm outline-none";
  const inputStyle = { borderColor: "var(--t-card-border)", background: "var(--t-card-bg)", color: "var(--t-text)" };

  useEffect(() => {
    setCurrentPage(1);
  }, [filteredOrders]);

  return (
    <div className="space-y-6">
      <section className="glass rounded-[28px] p-5 md:p-7">
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em]" style={{ color: "var(--t-muted)" }}>Vista global</p>
            <h2 className="mt-2 text-2xl font-semibold md:text-3xl">Resumen del negocio</h2>
            <p className="mt-2 max-w-2xl text-sm" style={{ color: "var(--t-muted)" }}>
              Ventas, pagos y actividad de todas las tiendas, en un solo lugar.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/admin/pedidos" className="rounded-xl border px-4 py-2.5 text-sm font-semibold transition hover:brightness-110" style={inputStyle}>
              Ver pedidos →
            </Link>
            <Link href="/admin/tiendas" className="rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-110" style={{ background: "var(--t-cta)" }}>
              Administrar tiendas
            </Link>
          </div>
        </div>
      </section>

      {error ? (
        <div role="alert" className="rounded-2xl border border-red-400/40 bg-red-500/10 p-4 text-sm text-red-200">
          <p className="font-semibold">No se pudo cargar el resumen completo</p>
          <p className="mt-1">{error}</p>
        </div>
      ) : null}

      <section className="glass rounded-[28px] p-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="font-semibold">Filtros del panel</h3>
            <p className="mt-1 text-xs" style={{ color: "var(--t-muted)" }}>Fecha y tienda filtran los módulos operativos; estado, pago, catálogo y búsqueda se aplican a pedidos.</p>
          </div>
          <button
            type="button"
            onClick={() => {
              changePeriod("30");
              setStoreFilter("all");
              setStatusFilter("all");
              setPaymentFilter("all");
              setCatalogFilter("all");
              setSearch("");
            }}
            className="self-start rounded-xl border px-3 py-2 text-xs font-semibold sm:self-auto"
            style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)" }}
          >
            Limpiar filtros
          </button>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
          <label className="text-xs font-medium" style={{ color: "var(--t-muted)" }}>
            Periodo
            <select className={`${inputClass} mt-1`} style={inputStyle} value={period} onChange={(event) => changePeriod(event.target.value as Period)}>
              <option value="7">Últimos 7 días</option>
              <option value="30">Últimos 30 días</option>
              <option value="90">Últimos 90 días</option>
              <option value="custom">Personalizado</option>
              <option value="all">Todo el historial</option>
            </select>
          </label>
          <label className="text-xs font-medium" style={{ color: "var(--t-muted)" }}>
            Desde
            <input aria-label="Fecha inicial" type="date" className={`${inputClass} mt-1`} style={inputStyle} disabled={period === "all"} value={startDate} onChange={(event) => { setPeriod("custom"); setStartDate(event.target.value); }} />
          </label>
          <label className="text-xs font-medium" style={{ color: "var(--t-muted)" }}>
            Hasta
            <input aria-label="Fecha final" type="date" className={`${inputClass} mt-1`} style={inputStyle} disabled={period === "all"} value={endDate} onChange={(event) => { setPeriod("custom"); setEndDate(event.target.value); }} />
          </label>
          <label className="text-xs font-medium" style={{ color: "var(--t-muted)" }}>
            Tienda
            <select className={`${inputClass} mt-1`} style={inputStyle} value={storeFilter} onChange={(event) => setStoreFilter(event.target.value)}>
              <option value="all">Todas las tiendas</option>
              {stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
            </select>
          </label>
          <label className="text-xs font-medium" style={{ color: "var(--t-muted)" }}>
            Estado del pedido
            <select className={`${inputClass} mt-1`} style={inputStyle} value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="all">Todos los estados</option>
              {Object.entries(STATUS_LABELS).map(([status, label]) => <option key={status} value={status}>{label}</option>)}
            </select>
          </label>
          <label className="text-xs font-medium" style={{ color: "var(--t-muted)" }}>
            Pago / catálogo
            <div className="mt-1 grid grid-cols-2 gap-2">
              <select aria-label="Estado del pago" className={inputClass} style={inputStyle} value={paymentFilter} onChange={(event) => setPaymentFilter(event.target.value)}>
                <option value="all">Todos los pagos</option>
                <option value="paid">Pagado</option>
                <option value="unpaid">Pendiente</option>
              </select>
              <select aria-label="Tipo de catálogo" className={inputClass} style={inputStyle} value={catalogFilter} onChange={(event) => setCatalogFilter(event.target.value)}>
                <option value="all">Todos</option>
                <option value="retail">Detal</option>
                <option value="wholesale">Mayor</option>
              </select>
            </div>
          </label>
          <label className="text-xs font-medium sm:col-span-2 xl:col-span-6" style={{ color: "var(--t-muted)" }}>
            Buscar pedido, tienda, cliente, teléfono o referencia
            <input className={`${inputClass} mt-1`} style={inputStyle} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Escribe para buscar..." />
          </label>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Pedidos en el periodo" value={loading ? "…" : metrics.orders.toLocaleString("es-CO")} detail="Pedidos que coinciden con los filtros" icon="🧾" />
        <MetricCard label="Ventas confirmadas" value={loading ? "…" : formatMoney(metrics.salesValue)} detail={`${metrics.salesCount} pedidos confirmados o completados`} icon="🛍️" accent />
        <MetricCard label="Ingresos pagados" value={loading ? "…" : formatMoney(metrics.paidValue)} detail={`${metrics.paidCount} pedidos con pago registrado`} icon="💰" accent />
        <MetricCard label="Tiendas / productos / usuarios" value={loading ? "…" : `${stores.length} / ${productCount.toLocaleString("es-CO")} / ${userCount.toLocaleString("es-CO")}`} detail={`Totales de la plataforma · ${stores.filter((store) => store.active).length} tiendas activas`} icon="🏬" />
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <article className="glass overflow-hidden rounded-[28px]">
          <div className="p-5">
            <h3 className="font-semibold">Facturas y documentos recientes</h3>
            <p className="mt-1 text-xs" style={{ color: "var(--t-muted)" }}>
              POS y facturación · {operationalMetrics.documents.length + operationalMetrics.invoices.length} en el filtro
            </p>
          </div>
          {recentFinancialDocs.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px] text-left text-xs">
                <thead style={{ background: "var(--t-card-bg)", color: "var(--t-muted)" }}>
                  <tr>
                    <th className="px-4 py-3 font-medium">Documento</th>
                    <th className="px-4 py-3 font-medium">Tienda / cliente</th>
                    <th className="px-4 py-3 font-medium">Fecha / estado</th>
                    <th className="px-4 py-3 text-right font-medium">Total / saldo</th>
                  </tr>
                </thead>
                <tbody>
                  {recentFinancialDocs.map((document) => (
                    <tr key={document.id} className="border-t" style={{ borderColor: "var(--t-card-border)" }}>
                      <td className="px-4 py-3">
                        <p className="font-semibold">{document.type} · {document.reference}</p>
                      </td>
                      <td className="px-4 py-3">
                        <p>{stores.find((store) => store.id === document.storeId)?.name ?? "Tienda"}</p>
                        <p className="mt-1" style={{ color: "var(--t-muted)" }}>{document.customer}</p>
                      </td>
                      <td className="px-4 py-3">
                        <p>{document.date ? formatDate(document.date) : "—"}</p>
                        <p className="mt-1" style={{ color: "var(--t-muted)" }}>{document.status}</p>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <p className="font-semibold">{formatMoney(document.total)}</p>
                        {document.balance > 0 ? <p className="mt-1 text-amber-500">Saldo {formatMoney(document.balance)}</p> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="px-5 pb-5 text-sm" style={{ color: "var(--t-muted)" }}>No hay documentos para el periodo y tienda seleccionados.</p>}
        </article>

        <article className="glass overflow-hidden rounded-[28px]">
          <div className="p-5">
            <h3 className="font-semibold">Pagos recibidos · POS y facturación</h3>
            <p className="mt-1 text-xs" style={{ color: "var(--t-muted)" }}>
              Registros de pago: {operationalMetrics.billingPayments.length + operationalMetrics.posPayments.length}
            </p>
          </div>
          {recentPayments.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[480px] text-left text-xs">
                <thead style={{ background: "var(--t-card-bg)", color: "var(--t-muted)" }}>
                  <tr>
                    <th className="px-4 py-3 font-medium">Tienda / origen</th>
                    <th className="px-4 py-3 font-medium">Fecha / método</th>
                    <th className="px-4 py-3 text-right font-medium">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {recentPayments.map((payment) => (
                    <tr key={payment.id} className="border-t" style={{ borderColor: "var(--t-card-border)" }}>
                      <td className="px-4 py-3">
                        <p className="font-semibold">{stores.find((store) => store.id === payment.storeId)?.name ?? "Tienda"}</p>
                        <p className="mt-1" style={{ color: "var(--t-muted)" }}>{payment.source}</p>
                      </td>
                      <td className="px-4 py-3">
                        <p>{payment.date ? formatDate(payment.date) : "—"}</p>
                        <p className="mt-1" style={{ color: "var(--t-muted)" }}>{payment.method}</p>
                      </td>
                      <td className="px-4 py-3 text-right font-semibold">{formatMoney(payment.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="px-5 pb-5 text-sm" style={{ color: "var(--t-muted)" }}>No hay pagos para el periodo y tienda seleccionados.</p>}
        </article>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <article className="glass overflow-hidden rounded-[28px]">
          <div className="p-5">
            <h3 className="font-semibold">Movimientos de inventario</h3>
            <p className="mt-1 text-xs" style={{ color: "var(--t-muted)" }}>Entradas, salidas y ajustes registrados · {operationalMetrics.movements.length} movimientos en el filtro</p>
          </div>
          {operationalMetrics.movements.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-left text-xs">
                <thead style={{ background: "var(--t-card-bg)", color: "var(--t-muted)" }}>
                  <tr><th className="px-4 py-3 font-medium">Tienda / producto</th><th className="px-4 py-3 font-medium">Tipo / fecha</th><th className="px-4 py-3 text-right font-medium">Cantidad</th></tr>
                </thead>
                <tbody>
                  {operationalMetrics.movements.slice(0, 10).map((movement) => (
                    <tr key={movement.id} className="border-t" style={{ borderColor: "var(--t-card-border)" }}>
                      <td className="px-4 py-3">
                        <p className="font-semibold">{stores.find((store) => store.id === movement.store_id)?.name ?? "Tienda"}</p>
                        <p className="mt-1" style={{ color: "var(--t-muted)" }}>Producto {movement.product_id.slice(0, 8)}{movement.note ? ` · ${movement.note}` : ""}</p>
                      </td>
                      <td className="px-4 py-3">
                        <p className={movement.kind === "in" ? "text-emerald-500" : "text-amber-500"}>{movement.kind === "in" ? "Entrada" : "Salida"}</p>
                        <p className="mt-1" style={{ color: "var(--t-muted)" }}>{formatDate(movement.created_at)}</p>
                      </td>
                      <td className="px-4 py-3 text-right font-semibold">{movement.qty}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="px-5 pb-5 text-sm" style={{ color: "var(--t-muted)" }}>Sin movimientos en los filtros seleccionados.</p>}
        </article>

        <article className="glass overflow-hidden rounded-[28px]">
          <div className="p-5">
            <h3 className="font-semibold">Cartera por cobrar</h3>
            <p className="mt-1 text-xs" style={{ color: "var(--t-muted)" }}>Cuentas de crédito y cartera POS · sin incluir secretos de pago</p>
          </div>
          {operationalMetrics.credits.length + operationalMetrics.posReceivables.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-left text-xs">
                <thead style={{ background: "var(--t-card-bg)", color: "var(--t-muted)" }}>
                  <tr><th className="px-4 py-3 font-medium">Tienda / origen</th><th className="px-4 py-3 font-medium">Vencimiento / estado</th><th className="px-4 py-3 text-right font-medium">Saldo</th></tr>
                </thead>
                <tbody>
                  {[
                    ...operationalMetrics.credits.map((account) => ({ id: `credit-${account.id}`, storeId: account.store_id, source: "Crédito", due: account.due_date, status: account.status, balance: Number(account.balance ?? 0) })),
                    ...operationalMetrics.posReceivables.map((account) => ({ id: `pos-ar-${account.id}`, storeId: account.store_id, source: "Cartera POS", due: account.due_date, status: account.status || "—", balance: Number(account.balance ?? 0) })),
                  ].filter((account) => account.balance > 0).slice(0, 10).map((account) => (
                    <tr key={account.id} className="border-t" style={{ borderColor: "var(--t-card-border)" }}>
                      <td className="px-4 py-3">
                        <p className="font-semibold">{stores.find((store) => store.id === account.storeId)?.name ?? "Tienda"}</p>
                        <p className="mt-1" style={{ color: "var(--t-muted)" }}>{account.source}</p>
                      </td>
                      <td className="px-4 py-3">
                        <p>{account.due ? new Date(`${account.due}T00:00:00`).toLocaleDateString("es-CO") : "Sin fecha"}</p>
                        <p className="mt-1" style={{ color: "var(--t-muted)" }}>{account.status}</p>
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-amber-500">{formatMoney(account.balance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="px-5 pb-5 text-sm" style={{ color: "var(--t-muted)" }}>No hay saldos pendientes en este filtro.</p>}
        </article>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <article className="glass overflow-hidden rounded-[28px]">
          <div className="p-5">
            <h3 className="font-semibold">Usuarios internos por tienda</h3>
            <p className="mt-1 text-xs" style={{ color: "var(--t-muted)" }}>{storeFilter === "all" ? "Todas las tiendas" : stores.find((store) => store.id === storeFilter)?.name} · {storeFilter === "all" ? storeTeam.length : storeTeam.filter((member) => member.store_id === storeFilter).length} accesos</p>
          </div>
          {(storeFilter === "all" ? storeTeam : storeTeam.filter((member) => member.store_id === storeFilter)).length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[540px] text-left text-xs">
                <thead style={{ background: "var(--t-card-bg)", color: "var(--t-muted)" }}>
                  <tr><th className="px-4 py-3 font-medium">Tienda / usuario</th><th className="px-4 py-3 font-medium">Rol / estado</th><th className="px-4 py-3 font-medium">Permisos</th></tr>
                </thead>
                <tbody>
                  {(storeFilter === "all" ? storeTeam : storeTeam.filter((member) => member.store_id === storeFilter)).slice(0, 12).map((member) => (
                    <tr key={`${member.store_id}-${member.user_id}`} className="border-t" style={{ borderColor: "var(--t-card-border)" }}>
                      <td className="px-4 py-3">
                        <p className="font-semibold">{stores.find((store) => store.id === member.store_id)?.name ?? "Tienda"}</p>
                        <p className="mt-1" style={{ color: "var(--t-muted)" }}>{member.display_name || member.username || member.user_id}</p>
                      </td>
                      <td className="px-4 py-3">
                        <p>{member.role}</p>
                        <p className={`mt-1 ${member.active ? "text-emerald-500" : "text-amber-500"}`}>{member.active ? "Activo" : "Inactivo"}</p>
                      </td>
                      <td className="px-4 py-3" style={{ color: "var(--t-muted)" }}>{member.permissions?.length ? member.permissions.join(", ") : "Sin permisos"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="px-5 pb-5 text-sm" style={{ color: "var(--t-muted)" }}>No hay accesos internos configurados.</p>}
        </article>

        <article className="glass overflow-hidden rounded-[28px]">
          <div className="p-5">
            <h3 className="font-semibold">Cajas y personal</h3>
            <p className="mt-1 text-xs" style={{ color: "var(--t-muted)" }}>{operationalMetrics.cashSessions.length} sesiones de caja · {storeStaff.filter((staff) => storeFilter === "all" || staff.store_id === storeFilter).length} usuarios POS</p>
          </div>
          <div className="grid gap-4 p-4 sm:grid-cols-2">
            <div>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--t-muted)" }}>Sesiones de caja recientes</h4>
              <div className="space-y-2">
                {operationalMetrics.cashSessions.slice(0, 5).map((session) => (
                  <div key={session.id} className="rounded-xl border p-3 text-xs" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)" }}>
                    <p className="font-semibold">{stores.find((store) => store.id === session.store_id)?.name ?? "Tienda"} · {session.status}</p>
                    <p className="mt-1" style={{ color: "var(--t-muted)" }}>Abierta {formatDate(session.opened_at)}{session.closed_at ? ` · Cerrada ${formatDate(session.closed_at)}` : ""}</p>
                    {session.variance_total !== null ? <p className="mt-1">Diferencia: {formatMoney(Number(session.variance_total))}</p> : null}
                  </div>
                ))}
                {!operationalMetrics.cashSessions.length ? <p className="text-xs" style={{ color: "var(--t-muted)" }}>Sin sesiones de caja.</p> : null}
              </div>
            </div>
            <div>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--t-muted)" }}>Personal POS</h4>
              <div className="space-y-2">
                {storeStaff.filter((staff) => storeFilter === "all" || staff.store_id === storeFilter).slice(0, 5).map((staff) => (
                  <div key={staff.id} className="rounded-xl border p-3 text-xs" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)" }}>
                    <p className="font-semibold">{staff.full_name || staff.username} · {staff.role}</p>
                    <p className="mt-1" style={{ color: "var(--t-muted)" }}>{stores.find((store) => store.id === staff.store_id)?.name ?? "Tienda"} · {staff.active ? "Activo" : "Inactivo"}</p>
                  </div>
                ))}
                {!storeStaff.some((staff) => storeFilter === "all" || staff.store_id === storeFilter) ? <p className="text-xs" style={{ color: "var(--t-muted)" }}>Sin usuarios POS registrados.</p> : null}
              </div>
            </div>
          </div>
        </article>
      </section>

      <section className="glass overflow-hidden rounded-[28px]">
        <div className="flex flex-col gap-2 p-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h3 className="font-semibold">Todas las tiendas</h3>
            <p className="mt-1 text-xs" style={{ color: "var(--t-muted)" }}>Estado, catálogos y accesos a la gestión de cada tienda · {stores.length} en total</p>
          </div>
          <Link href="/admin/tiendas" className="text-sm font-semibold" style={{ color: "var(--t-accent)" }}>Administrar tiendas →</Link>
        </div>
        {visibleStores.length ? (
          <div className="grid gap-3 p-4 pt-0 sm:grid-cols-2 xl:grid-cols-3">
            {visibleStores.map((store) => (
              <article key={store.id} className="rounded-2xl border p-4" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)" }}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{store.name}</p>
                    <p className="truncate text-xs" style={{ color: "var(--t-muted)" }}>/{store.slug}</p>
                  </div>
                  <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] ${store.active ? "text-emerald-500" : "text-amber-500"}`} style={{ borderColor: "var(--t-card-border)" }}>
                    {store.active ? "Activa" : "Inactiva"}
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
                  <span className="rounded-full border px-2.5 py-1" style={{ borderColor: "var(--t-card-border)", color: store.catalog_retail ? "var(--t-text)" : "var(--t-muted)" }}>Detal {store.catalog_retail ? "activo" : "apagado"}</span>
                  <span className="rounded-full border px-2.5 py-1" style={{ borderColor: "var(--t-card-border)", color: store.catalog_wholesale ? "var(--t-text)" : "var(--t-muted)" }}>Mayor {store.catalog_wholesale ? "activo" : "apagado"}</span>
                  <span className="rounded-full border px-2.5 py-1" style={{ borderColor: "var(--t-card-border)", color: "var(--t-muted)" }}>Tema: {store.theme || "—"}</span>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {[
                    { href: "/admin/pedidos", label: "Pedidos" },
                    { href: "/admin/productos", label: "Productos" },
                    { href: "/admin/categorias", label: "Categorías" },
                    { href: "/admin/usuarios", label: "Equipo" },
                  ].map((item) => (
                    <Link key={item.href} href={`${item.href}?store=${encodeURIComponent(store.id)}`} className="rounded-lg border px-2.5 py-1.5 text-[11px] font-medium hover:brightness-110" style={{ borderColor: "var(--t-card-border)" }}>
                      {item.label}
                    </Link>
                  ))}
                </div>
              </article>
            ))}
          </div>
        ) : <p className="px-5 pb-5 text-sm" style={{ color: "var(--t-muted)" }}>No hay tiendas para mostrar.</p>}
        {stores.length > storesPerPage ? (
          <div className="flex items-center justify-between border-t px-5 py-3" style={{ borderColor: "var(--t-card-border)" }}>
            <button type="button" disabled={visibleStorePage === 1} onClick={() => setStorePage((page) => Math.max(1, page - 1))} className="rounded-xl border px-3 py-2 text-xs font-semibold disabled:opacity-40" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)" }}>← Anterior</button>
            <span className="text-xs" style={{ color: "var(--t-muted)" }}>Página {visibleStorePage} de {storePageCount}</span>
            <button type="button" disabled={visibleStorePage === storePageCount} onClick={() => setStorePage((page) => Math.min(storePageCount, page + 1))} className="rounded-xl border px-3 py-2 text-xs font-semibold disabled:opacity-40" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)" }}>Siguiente →</button>
          </div>
        ) : null}
      </section>

      <section>
        <div className="mb-3">
          <h3 className="font-semibold">Facturación, caja e inventario</h3>
          <p className="mt-1 text-xs" style={{ color: "var(--t-muted)" }}>Valores y movimientos leídos de billing, POS y cartera. Se mantienen separados por origen para evitar doble conteo.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard label="Documentos de facturación" value={loading ? "…" : `${operationalMetrics.documents.length.toLocaleString("es-CO")} · ${formatMoney(operationalMetrics.documentTotal)}`} detail={`${documents.length.toLocaleString("es-CO")} documentos en toda la base`} icon="📄" accent />
          <MetricCard label="Facturas POS" value={loading ? "…" : `${operationalMetrics.invoices.length.toLocaleString("es-CO")} · ${formatMoney(operationalMetrics.posTotal)}`} detail={`${posInvoices.length.toLocaleString("es-CO")} facturas POS en toda la base`} icon="🧾" />
          <MetricCard label="Pagos POS / facturación" value={loading ? "…" : formatMoney(operationalMetrics.billingPaymentsTotal + operationalMetrics.posPaymentsTotal)} detail={`Facturación ${formatMoney(operationalMetrics.billingPaymentsTotal)} · POS ${formatMoney(operationalMetrics.posPaymentsTotal)}`} icon="💳" accent />
          <MetricCard label="Pagos web / pasarela" value={loading ? "…" : formatMoney(operationalMetrics.onlinePaymentsTotal)} detail={`${operationalMetrics.onlinePayments.length} pagos de pedidos · ${operationalMetrics.transactions.length} transacciones`} icon="🌐" />
          <MetricCard label="Cartera pendiente" value={loading ? "…" : formatMoney(operationalMetrics.outstandingBalance + operationalMetrics.posOutstandingBalance)} detail={`Crédito ${formatMoney(operationalMetrics.outstandingBalance)} · POS ${formatMoney(operationalMetrics.posOutstandingBalance)}`} icon="📌" />
          <MetricCard label="Sesiones de caja abiertas" value={loading ? "…" : operationalMetrics.openCashSessions.toLocaleString("es-CO")} detail={`${operationalMetrics.cashSessions.length.toLocaleString("es-CO")} sesiones de caja en el periodo`} icon="💵" />
          <MetricCard label="Movimientos de inventario" value={loading ? "…" : operationalMetrics.movements.length.toLocaleString("es-CO")} detail={`Entradas ${operationalMetrics.stockIn.toLocaleString("es-CO")} · Salidas ${operationalMetrics.stockOut.toLocaleString("es-CO")} unidades`} icon="📦" />
          <MetricCard label="Clientes / personal de tienda" value={loading ? "…" : `${billingCustomers.length.toLocaleString("es-CO")} / ${storeStaff.length.toLocaleString("es-CO")}`} detail={`${storeStaff.filter((staff) => staff.active).length} cuentas de personal activas`} icon="👥" />
          <MetricCard label="Categorías / equipo / temas" value={loading ? "…" : `${categoryCount} / ${storeTeamCount} / ${themeCount}`} detail={`${legacyCategoryCount} categorías heredadas · perfiles globales ${userCount}`} icon="🗂️" />
        </div>
      </section>

      <section className="glass rounded-[28px] p-5">
        <div>
          <h3 className="font-semibold">Actividad de plataforma y pagos</h3>
          <p className="mt-1 text-xs" style={{ color: "var(--t-muted)" }}>Totales registrados en tablas auxiliares de tiendas y pagos (todo el historial).</p>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
          {[
            ["Recibos de caja", cashReceiptCount],
            ["Transacciones web", paymentTransactionCount],
            ["Enlaces de tiendas", linkCount],
            ["Contactos de tiendas", contactCount],
            ["Notificaciones", notificationCount],
            ["Importaciones / exportaciones", dataExchangeCount],
            ["Clientes POS", auxiliaryCounts.pos_customers ?? 0],
            ["Líneas de factura POS", auxiliaryCounts.pos_invoice_items ?? 0],
            ["Líneas de facturación", auxiliaryCounts.billing_document_lines ?? 0],
            ["Movimientos POS", auxiliaryCounts.pos_stock_moves ?? 0],
            ["Cajas POS heredadas", auxiliaryCounts.pos_cash_sessions ?? 0],
            ["Pagos de cartera POS", auxiliaryCounts.pos_ar_payments ?? 0],
            ["Configuraciones de tienda", auxiliaryCounts.store_profiles ?? 0],
            ["Métodos de pago", auxiliaryCounts.store_payment_methods ?? 0],
            ["Registros de Siigo", auxiliaryCounts.siigo_invoices ?? 0],
            ["Auditoría de facturación", auxiliaryCounts.billing_audit_logs ?? 0],
            ["Configuración de facturación", (auxiliaryCounts.billing_settings ?? 0) + (auxiliaryCounts.store_billing_settings ?? 0)],
            ["Documentos de venta", auxiliaryCounts.documents ?? 0],
            ["Series / consecutivos", (auxiliaryCounts.billing_numbering_series ?? 0) + (auxiliaryCounts.billing_series ?? 0) + (auxiliaryCounts.billing_doc_counters ?? 0) + (auxiliaryCounts.billing_counters ?? 0)],
          ].map(([label, value]) => (
            <div key={label} className="rounded-2xl border p-3" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)" }}>
              <p className="text-xs" style={{ color: "var(--t-muted)" }}>{label}</p>
              <p className="mt-2 text-xl font-bold">{loading ? "…" : Number(value).toLocaleString("es-CO")}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.6fr_1fr]">
        <article className="glass rounded-[28px] p-5">
          <RevenueChart
            orders={filteredOrders}
            documents={operationalMetrics.documents}
            invoices={operationalMetrics.invoices}
            billingPayments={operationalMetrics.billingPayments}
            posPayments={operationalMetrics.posPayments}
            endDate={endDate}
            period={period}
          />
          <OrdersChart orders={filteredOrders} endDate={endDate} period={period} />
        </article>
        <article className="glass rounded-[28px] p-5">
          <h3 className="font-semibold">Actividad por tienda</h3>
          <p className="mt-1 text-xs" style={{ color: "var(--t-muted)" }}>Pedidos dentro del periodo seleccionado</p>
          {topStores.length ? (
            <div className="mt-5 space-y-4">
              {topStores.map((store, index) => {
                const max = topStores[0]?.count || 1;
                return (
                  <div key={`${store.name}-${index}`}>
                    <div className="mb-1.5 flex justify-between gap-3 text-sm">
                      <span className="truncate">{store.name}</span>
                      <span style={{ color: "var(--t-muted)" }}>{store.count}</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full" style={{ background: "var(--t-card-bg)" }}>
                      <div className="h-full rounded-full bg-fuchsia-500" style={{ width: `${(store.count / max) * 100}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : <p className="mt-6 text-sm" style={{ color: "var(--t-muted)" }}>No hay pedidos para mostrar en este filtro.</p>}
          <div className="mt-6 border-t pt-4" style={{ borderColor: "var(--t-card-border)" }}>
            <h4 className="text-sm font-semibold">Pedidos por estado</h4>
            <div className="mt-3 flex flex-wrap gap-2">
              {statusCounts.length ? statusCounts.map(([status, count]) => (
                <span key={status} className="rounded-full border px-3 py-1.5 text-xs" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)" }}>
                  {STATUS_LABELS[status] ?? status}: <b>{count}</b>
                </span>
              )) : <span className="text-xs" style={{ color: "var(--t-muted)" }}>Sin pedidos.</span>}
            </div>
          </div>
        </article>
      </section>

      <section className="glass overflow-hidden rounded-[28px]">
        <div className="flex flex-col gap-2 p-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h3 className="font-semibold">Pedidos recientes</h3>
            <p className="mt-1 text-xs" style={{ color: "var(--t-muted)" }}>
              {loading ? "Cargando pedidos…" : `${filteredOrders.length.toLocaleString("es-CO")} resultados · página ${visiblePage} de ${pageCount}`}
            </p>
          </div>
          <Link href="/admin/pedidos" className="text-sm font-semibold" style={{ color: "var(--t-accent)" }}>Abrir gestión de pedidos →</Link>
        </div>
        {recentOrders.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead style={{ background: "var(--t-card-bg)", color: "var(--t-muted)" }}>
                <tr>
                  <th className="px-5 py-3 font-medium">Pedido</th>
                  <th className="px-5 py-3 font-medium">Tienda / cliente</th>
                  <th className="px-5 py-3 font-medium">Fecha</th>
                  <th className="px-5 py-3 font-medium">Estado</th>
                  <th className="px-5 py-3 font-medium">Pago</th>
                  <th className="px-5 py-3 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {recentOrders.map((order) => (
                  <tr key={order.id} className="border-t" style={{ borderColor: "var(--t-card-border)" }}>
                    <td className="px-5 py-3">
                      <a href={`/pedido/${encodeURIComponent(order.token)}`} target="_blank" rel="noreferrer" className="font-semibold hover:underline">
                        #{order.receipt_no ?? "—"}
                      </a>
                      <span className="ml-2 text-xs" style={{ color: "var(--t-muted)" }}>{order.catalog_type === "wholesale" ? "Mayor" : "Detal"}</span>
                    </td>
                    <td className="px-5 py-3">
                      <p className="font-medium">{stores.find((store) => store.id === order.store_id)?.name ?? "Tienda"}</p>
                      <p className="text-xs" style={{ color: "var(--t-muted)" }}>{order.customer_name || order.customer_whatsapp || "Cliente sin nombre"}</p>
                    </td>
                    <td className="px-5 py-3 text-xs" style={{ color: "var(--t-muted)" }}>{formatDate(order.created_at)}</td>
                    <td className="px-5 py-3">{STATUS_LABELS[order.status] ?? order.status}</td>
                    <td className="px-5 py-3">
                      <span className={isPaid(order) ? "text-emerald-500" : ""}>{isPaid(order) ? "Pagado" : "Pendiente"}</span>
                    </td>
                    <td className="px-5 py-3 text-right font-semibold">{formatMoney(Number(order.total ?? 0))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="px-5 pb-5 text-sm" style={{ color: "var(--t-muted)" }}>
            {loading ? "Cargando…" : "No hay pedidos que coincidan con los filtros seleccionados."}
          </p>
        )}
        {filteredOrders.length > 10 ? (
          <div className="flex items-center justify-between border-t px-5 py-3" style={{ borderColor: "var(--t-card-border)" }}>
            <button
              type="button"
              disabled={visiblePage === 1}
              onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
              className="rounded-xl border px-3 py-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-40"
              style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)" }}
            >
              ← Anterior
            </button>
            <span className="text-xs" style={{ color: "var(--t-muted)" }}>{visiblePage} / {pageCount}</span>
            <button
              type="button"
              disabled={visiblePage === pageCount}
              onClick={() => setCurrentPage((page) => Math.min(pageCount, page + 1))}
              className="rounded-xl border px-3 py-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-40"
              style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)" }}
            >
              Siguiente →
            </button>
          </div>
        ) : null}
      </section>

      <section>
        <div className="mb-3">
          <h3 className="font-semibold">Accesos administrativos</h3>
          <p className="mt-1 text-sm" style={{ color: "var(--t-muted)" }}>Enlaces directos a las herramientas de administración.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {ADMIN_LINKS.map((item) => (
            <Link key={item.href} href={item.href} className="glass-soft rounded-2xl p-4 transition hover:-translate-y-0.5 hover:brightness-110">
              <span className="text-xl">{item.icon}</span>
              <p className="mt-2 font-semibold">{item.label} <span aria-hidden="true">→</span></p>
              <p className="mt-1 text-xs" style={{ color: "var(--t-muted)" }}>{item.detail}</p>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
