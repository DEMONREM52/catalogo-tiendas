"use client";

import { WithDv, docWithDv } from "@/app/dashboard/nit";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Swal from "sweetalert2";
import { supabaseBrowser } from "@/lib/supabase/client";
import { getDashboardStore, hasStorePermission, type DashboardStore } from "@/lib/store-utils";
import { ThirdPartyForm } from "../clientes/ThirdPartyForm";
import { errorText as fiscalErrorText, fiscalApi, newIdempotencyKey } from "@/lib/fiscal/client";
import type { PointReadiness } from "@/lib/fiscal/types";
import { getStoreDataSchemaErrorMessage } from "@/lib/store-schema-errors";
import { PhotoSearchButton } from "../PhotoSearchControls";
import { useErpFinderSource } from "../useErpFinder";
import { PosDocuments, type PosDocument } from "./PosDocuments";
import { matchesSearch, smartFilter } from "@/lib/search";
import { CreditMeter } from "../clientes/CreditMeter";
import type { CreditState } from "../clientes/terceros";
import { OfflineDrafts } from "./OfflineDrafts";
import { removeDraft, saveDraft, type PosDraft } from "@/lib/pos/drafts";
import { isNetworkError, isOnline, reportNetworkError, useNetStatus } from "@/lib/net/status";
import { AnimatePresence, motion } from "framer-motion";
import { Pause, Play, Search, UserRound, X } from "lucide-react";
import { playTone, unlockAudioOnFirstTouch } from "@/lib/sounds/tones";
import { useHeldSales } from "@/lib/pos/held";
import { readCurrentSale, saveCurrentSale } from "@/lib/pos/current-sale";
import { PosCartLines, focusPosField, lineStatus, type CartLine } from "./PosCart";
import { EMPTY_PAYMENT, PosPayment, paymentSummary, type PaymentState } from "./PosPayment";
import { LIMIT_LABEL, keepApprovals, useApprovals, usePriceFloors, type ApprovalState } from "./usePriceFloors";
import { CashStatusChip } from "../caja/CashStatusChip";
import { checkStockNow, friendlyStockError, shortListHtml, useLiveStock } from "@/lib/stock/live-stock";
import { reinsert, undoToast } from "@/lib/ui/undo";
import { PosToolbar, requestPasses, usePromotions, type Passes } from "./PosExtras";

type PriceLevel = 1 | 2 | 3 | 4 | 5;

type Product = {
  id: string;
  name: string;
  price_1: number;
  price_2: number;
  price_3: number;
  price_4: number;
  price_5: number;
  min_wholesale: number | null;
  stock: number | null;
  image_url: string | null;
  active: boolean;
  sku?: string | null;
  barcode?: string | null;
};

type Client = {
  id: string;
  name: string;
  email: string | null;
  mobile: string | null;
  document_number: string | null;
  price_list: number;
  kinds?: string[];
  active?: boolean;
  credit_enabled?: boolean;
  credit_limit?: number;
  credit_days?: number;
  credit_blocked?: boolean;
};

const CLIENT_COLUMNS = "id,name,email,mobile,document_number,price_list";
const CLIENT_CREDIT_COLUMNS = `${CLIENT_COLUMNS},kinds,active,credit_enabled,credit_limit,credit_days,credit_blocked`;

/** Terceros para vender (todos los puntos). Si falta la migración de cartera usa los datos básicos. */
async function loadPosClients(storeId: string) {
  const sb = supabaseBrowser();
  const all: Client[] = [];
  let columns = CLIENT_CREDIT_COLUMNS;
  for (let from = 0; ; from += 1000) {
    let res = await sb.from("billing_customers").select(columns).eq("store_id", storeId).order("name", { ascending: true }).range(from, from + 999);
    if (res.error && columns === CLIENT_CREDIT_COLUMNS) {
      columns = CLIENT_COLUMNS;
      res = await sb.from("billing_customers").select(columns).eq("store_id", storeId).order("name", { ascending: true }).range(from, from + 999);
    }
    if (res.error) return { data: null, error: res.error };
    all.push(...((res.data ?? []) as unknown as Client[]));
    if (!res.data || res.data.length < 1000) break;
  }
  // Solo clientes: un tercero que es solo proveedor o empleado no aparece en el POS.
  return { data: all.filter((c) => c.active !== false && (!c.kinds?.length || c.kinds.includes("customer"))), error: null };
}

type CartItem = {
  productId: string;
  name: string;
  qty: number;
  price: number;
  priceLevel: PriceLevel;
  note: string;
  /** El vendedor cambió el precio a mano: el cambio de lista no lo pisa. */
  manual?: boolean;
};

function money(n: number) {
  return `$${Number(n || 0).toLocaleString("es-CO")}`;
}

function getProductPrice(product: Product, priceLevel: PriceLevel) {
  switch (priceLevel) {
    case 1:
      return product.price_1;
    case 2:
      return product.price_2;
    case 3:
      return product.price_3;
    case 4:
      return product.price_4;
    case 5:
      return product.price_5;
    default:
      return product.price_3;
  }
}

function inputProps() {
  return {
    className: "w-full rounded-xl border px-3 py-2 text-sm outline-none",
    style: {
      borderColor: "var(--t-card-border)",
      background: "color-mix(in oklab, var(--t-card-bg) 92%, transparent)",
      color: "var(--t-text)",
    } as React.CSSProperties,
  };
}

function cardProps() {
  return {
    className: "rounded-2xl border p-3 sm:p-4",
    style: {
      borderColor: "var(--t-card-border)",
      background: "var(--t-card-bg)",
      color: "var(--t-text)",
    } as React.CSSProperties,
  };
}

const DEFAULT_CLIENT_NAME = "CONSUMIDOR FINAL";
const DEFAULT_PRICE_LIST = 3;

type PointOption = { id: string; name: string; kind?: "point" | "warehouse"; is_default?: boolean; invoice_prefix: string; remision_prefix: string; next_invoice_number: number; next_remision_number: number };
type SellerOption = { user_id: string; name: string; role: string; point_id?: string | null };

/** Vendedores del punto: solo los usuarios creados para ese punto (si aún no existe el dato, todos). */
function sellersForPoint(rows: SellerOption[], pointId: string) {
  if (!rows.some((r) => r.point_id !== undefined)) return rows;
  return rows.filter((r) => r.point_id && r.point_id === pointId);
}

/** Error de la base al vender o editar, en palabras: qué producto falló y qué hacer. */
function posErrorText(err: unknown) {
  const message = String((err as Error)?.message ?? err);
  const details = (err as { details?: string })?.details;
  const hint = (err as { hint?: string })?.hint;
  if (/PRICE_BELOW_LIMIT/.test(message)) return `«${details ?? "Un producto"}» está por debajo de tu precio mínimo. ${hint ?? "Pide autorización."}`;
  if (/PRICE_MISMATCH/.test(message)) return `El precio de «${details ?? "un producto"}» cambió o no está autorizado. Recarga la página para traer los precios actuales.`;
  return friendlyStockError(message) ?? message;
}

export default function PosPage() {
  const [store, setStore] = useState<DashboardStore | null>(null);
  const [allProducts, setProducts] = useState<Product[]>([]);
  const [visibleCount, setVisibleCount] = useState(48);
  const [savingClient, setSavingClient] = useState(false);
  // Ventana completa para crear un tercero desde el POS.
  const [newClient, setNewClient] = useState<{ key: number; prefill: { name?: string; document_number?: string } } | null>(null);
  const [canCredit, setCanCredit] = useState(false);
  const [listOverride, setListOverride] = useState<number | null>(null);
  const [pointId, setPointId] = useState("");
  // Existencias del punto en vivo: si otra persona vende, el número baja aquí sin recargar (20261220).
  const { stock: pointStock, setStock: setPointStock, live: stockLive } = useLiveStock(store?.id, pointId);
  // Los productos inactivos no se muestran nunca; los agotados (activos) sí, al buscarlos.
  const activeProducts = useMemo(() => allProducts.filter((p) => p.active !== false), [allProducts]);
  // Solo se ofrecen los productos con existencias en el punto elegido.
  const products = useMemo(() => {
    if (!pointStock) return activeProducts;
    return activeProducts
      .filter((p) => (pointStock.get(p.id) ?? 0) > 0)
      .map((p) => ({ ...p, stock: pointStock.get(p.id) ?? 0 }));
  }, [activeProducts, pointStock]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [clientSearch, setClientSearch] = useState("");
  const [selectedClientId, setSelectedClientId] = useState<string>("");
  const [customerName, setCustomerName] = useState(DEFAULT_CLIENT_NAME);
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerWhatsApp, setCustomerWhatsApp] = useState("");
  const [customerDocument, setCustomerDocument] = useState("");
  const [customerPriceList, setCustomerPriceList] = useState<number>(DEFAULT_PRICE_LIST);
  const [paymentType, setPaymentType] = useState<"contado" | "credito">("contado");
  const [dueDays, setDueDays] = useState(30);
  // Estado del crédito del cliente elegido (cupo, disponible, mora) para la venta a crédito.
  const [creditState, setCreditState] = useState<(CreditState & { for: string; amount: number }) | null>(null);
  const [creditUnavailable, setCreditUnavailable] = useState(false);
  const [printSize, setPrintSize] = useState<"tirilla" | "carta">("tirilla");
  const [orderSource, setOrderSource] = useState<"vitrina" | "whatsapp">("vitrina");
  const [documentKind, setDocumentKind] = useState<"remision" | "factura">("remision");
  const [requestElectronicInvoice, setRequestElectronicInvoice] = useState(false);
  const [billingSettings, setBillingSettings] = useState<{
    electronic_provider?: string | null;
    invoice_prefix?: string | null;
    remision_prefix?: string | null;
  } | null>(null);
  const [customerNote, setCustomerNote] = useState("");
  const [points, setPoints] = useState<PointOption[]>([]);
  const [sellers, setSellers] = useState<SellerOption[]>([]);
  const [lockedPoint, setLockedPoint] = useState(false);
  const [sellerId, setSellerId] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [editingDoc, setEditingDoc] = useState<PosDocument | null>(null);
  const [docsRefresh, setDocsRefresh] = useState(0);
  // Venta guardada sin internet que está cargada en el carrito (se borra al registrarla).
  const [draftId, setDraftId] = useState<string | null>(null);
  // Quién usa el POS (la venta en curso se guarda sola por usuario en este equipo).
  const [meId, setMeId] = useState("");
  const restoredSale = useRef(false);
  // Producto recién agregado: se resalta un momento con un aviso («Ya tenías 2 · ahora 3»).
  const [flash, setFlash] = useState<{ id: string; text: string } | null>(null);
  const flashTimer = useRef<number | undefined>(undefined);
  const net = useNetStatus();

  const filteredProducts = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return products;
    // Al buscar también se muestran los productos sin existencias en este punto (deshabilitados).
    const base = pointStock
      ? activeProducts.map((p) => ({ ...p, stock: pointStock.get(p.id) ?? 0 }))
      : products;
    // Código o código de barras exacto primero (sirve con lector de códigos).
    const exact = base.filter((p) => isExactCode(p, term));
    const rest = smartFilter(base.filter((p) => !exact.includes(p)), term, (product) => `${product.name} ${product.sku ?? ""} ${product.barcode ?? ""}`);
    return [...exact, ...rest];
  }, [products, activeProducts, pointStock, search]);

  const selectedClient = useMemo(
    () => clients.find((client) => client.id === selectedClientId) ?? null,
    [clients, selectedClientId],
  );

  const effectiveClient = useMemo(() => {
    if (selectedClient) return selectedClient;
    return {
      id: "consumer-final",
      name: DEFAULT_CLIENT_NAME,
      email: null,
      mobile: null,
      document_number: "CF",
      price_list: DEFAULT_PRICE_LIST,
    } as Client;
  }, [selectedClient]);

  const productMap = useMemo(
    () => new Map(products.map((product) => [product.id, product])),
    [products],
  );

  const filteredClients = useMemo(() => {
    const term = clientSearch.trim().toLowerCase();
    if (!term) return clients;
    const digits = term.replace(/\D/g, "");
    return clients.filter((client) => {
      if (matchesSearch([client.name, client.document_number ?? "", client.mobile ?? "", client.email ?? ""].join(" "), term))
        return true;
      return (
        digits.length > 0 &&
        ((client.document_number ?? "").replace(/\D/g, "").includes(digits) ||
          (client.mobile ?? "").replace(/\D/g, "").includes(digits))
      );
    });
  }, [clients, clientSearch]);

  const currentPriceList = (listOverride ?? selectedClient?.price_list ?? customerPriceList) as PriceLevel;
  const siigoConfigured = billingSettings?.electronic_provider?.toLowerCase() === "siigo";
  // Facturación electrónica del punto (motor fiscal). Si el punto la tiene activa, «Factura» siempre es electrónica.
  const [fiscal, setFiscal] = useState<PointReadiness | null>(null);
  const fiscalOn = Boolean(fiscal && fiscal.enabled && fiscal.org_enabled);
  const idemKey = useRef<string | null>(null);
  useEffect(() => {
    if (!pointId) return;
    let alive = true;
    void supabaseBrowser().rpc("fiscal_point_readiness", { p_point: pointId }).then(({ data, error }) => {
      if (!alive) return;
      const r = data as (PointReadiness & { ok?: boolean }) | null;
      setFiscal(!error && r && r.ok !== false ? r : null);
    });
    return () => {
      alive = false;
    };
  }, [pointId, docsRefresh]);

  const total = useMemo(
   () => cart.reduce((sum, item) => sum + item.price * item.qty, 0),
   [cart],
  );

  useEffect(() => {
    load();
    unlockAudioOnFirstTouch();
  }, []);

  const storeId = store?.id;
  // Hasta cuánto puede bajar el precio quien vende (la base lo revisa en cada venta).
  const floors = usePriceFloors(storeId, pointId, cart.map((i) => i.productId));
  const { approvals, request: requestApproval, forget: forgetApproval, restore: restoreApprovals } = useApprovals(storeId, pointId);
  // Autorizaciones de los productos del carrito (se guardan con la venta en curso, en espera y en borradores).
  const cartApprovals = useMemo(() => keepApprovals(approvals, cart.map((i) => i.productId)), [approvals, cart]);
  const [payment, setPayment] = useState<PaymentState>(EMPTY_PAYMENT);
  const { held, hold, take } = useHeldSales(storeId, pointId);

  // Venta en curso: al entrar se recupera la que quedó sin terminar (recarga, cierre, sin internet, actualización)…
  useEffect(() => {
    if (!storeId || !meId || restoredSale.current) return;
    restoredSale.current = true;
    const saved = readCurrentSale(storeId, meId);
    if (!saved || cart.length || editingDoc) return;
    setCart(saved.cart.map((i) => ({ ...i, priceLevel: Math.min(5, Math.max(1, i.priceLevel)) as PriceLevel })));
    void restoreApprovals(saved.approvals);
    setSelectedClientId(saved.selectedClientId);
    setDocumentKind(saved.documentKind === "factura" ? "factura" : "remision");
    if (!lockedPoint && saved.pointId) setPointId(saved.pointId);
    if (saved.sellerId) setSellerId(saved.sellerId);
    window.setTimeout(() => {
      setCustomerName(saved.customerName || DEFAULT_CLIENT_NAME);
      setCustomerDocument(saved.customerDocument);
      setCustomerWhatsApp(saved.customerWhatsApp);
      setCustomerNote(saved.customerNote);
    }, 0);
    void Swal.fire({
      toast: true, position: "top", icon: "info", timer: 4500, timerProgressBar: true, showConfirmButton: false,
      title: "Recuperamos la venta que estabas haciendo",
      text: `${saved.cart.length} producto${saved.cart.length === 1 ? "" : "s"} · revisa precios y existencias antes de cobrar.`,
      background: "var(--t-bg-base)", color: "var(--t-text)",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeId, meId]);

  // …y cada cambio del carrito o del cliente se guarda al instante (se borra solo al vender, poner en espera o vaciar).
  useEffect(() => {
    if (!storeId || !meId || !restoredSale.current || editingDoc) return;
    saveCurrentSale(storeId, meId, cart.length ? {
      cart, total, customerName: customerName.trim(), selectedClientId, customerDocument: customerDocument.trim(),
      customerWhatsApp: customerWhatsApp.trim(), customerNote: customerNote.trim(), documentKind, pointId, sellerId,
      approvals: cartApprovals,
    } : null);
  }, [storeId, meId, editingDoc, cart, total, customerName, selectedClientId, customerDocument, customerWhatsApp, customerNote, documentKind, pointId, sellerId, cartApprovals]);
  const searchRef = useRef<HTMLInputElement>(null);
  const cartRef = useRef<HTMLDivElement>(null);
  const productById = useMemo(() => new Map(allProducts.map((p) => [p.id, p])), [allProducts]);
  // Precios propios del punto (reglas de la madre). Sin reglas o sin la migración: precios 1-5 de la madre.
  const [pointPrices, setPointPrices] = useState<Map<string, number[]>>(() => new Map());
  // Si los precios del punto no cargan se avisa (antes se usaban los de la madre sin decir nada).
  const [pointPricesError, setPointPricesError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    if (!storeId || !pointId) return;
    // Supabase entrega máximo 1.000 filas por consulta: se piden por tandas hasta tenerlos todos
    // (antes, con más de 1.000 productos, los demás quedaban con el precio de la madre).
    void (async () => {
      const sb = supabaseBrowser();
      const PAGE = 1000;
      const map = new Map<string, number[]>();
      let failed: string | null = null;
      for (let from = 0; from < 100_000; from += PAGE) {
        const { data, error } = await sb
          .rpc("erp_point_prices", { p_store: storeId, p_point: pointId })
          .order("product_id")
          .range(from, from + PAGE - 1);
        if (!alive) return;
        if (error) { failed = error.message || "Error desconocido"; break; }
        const rows = (data ?? []) as Array<{ product_id: string; price_1: number; price_2: number; price_3: number; price_4: number; price_5: number }>;
        for (const r of rows) map.set(r.product_id, [r.price_1, r.price_2, r.price_3, r.price_4, r.price_5].map(Number));
        if (rows.length < PAGE) break;
      }
      setPointPricesError(failed);
      setPointPrices(map);
    })();
    return () => {
      alive = false;
    };
  }, [storeId, pointId]);
  // Promociones vigentes del punto (20261228): el precio de la lista baja solo mientras dure la promoción.
  const { promoFor } = usePromotions(storeId, pointId);
  const basePriceOf = useCallback(
    (product: Product, level: PriceLevel) => pointPrices.get(product.id)?.[level - 1] ?? getProductPrice(product, level),
    [pointPrices],
  );
  const priceOf = useCallback(
    (product: Product, level: PriceLevel) => { const base = basePriceOf(product, level); return promoFor(product.id, base)?.price ?? base; },
    [basePriceOf, promoFor],
  );

  useEffect(() => {
    if (!selectedClient || (paymentType !== "credito" && !selectedClient.credit_enabled)) return;
    let alive = true;
    const timer = window.setTimeout(async () => {
      const { data, error } = await supabaseBrowser().rpc("erp_credit_check", { p_customer: selectedClient.id, p_amount: total });
      if (!alive) return;
      if (error) {
        setCreditUnavailable(/erp_credit_check|Could not find the function|schema cache/i.test(error.message));
        setCreditState(null);
        return;
      }
      setCreditUnavailable(false);
      setCreditState({ ...(data as CreditState), for: selectedClient.id, amount: total });
    }, 250);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [selectedClient, total, paymentType]);

  useEffect(() => {
    setListOverride(null);
    if (selectedClient) {
      setCustomerName(selectedClient.name);
      setCustomerEmail(selectedClient.email ?? "");
      setCustomerWhatsApp(selectedClient.mobile ?? "");
      setCustomerDocument(selectedClient.document_number ?? "");
      setCustomerPriceList(selectedClient.price_list ?? DEFAULT_PRICE_LIST);
      if (selectedClient.credit_enabled && selectedClient.credit_days) setDueDays(selectedClient.credit_days);
    } else {
      setCustomerName(DEFAULT_CLIENT_NAME);
      setCustomerEmail("");
      setCustomerWhatsApp("");
      setCustomerDocument("");
      setCustomerPriceList(DEFAULT_PRICE_LIST);
    }
  }, [selectedClient]);

  useEffect(() => {
    if (documentKind !== "factura" && requestElectronicInvoice) {
      setRequestElectronicInvoice(false);
    }
  }, [documentKind, requestElectronicInvoice]);

  useEffect(() => {
    setCart((prev) =>
      prev.map((item) => {
        const product = productMap.get(item.productId);
        if (!product || item.manual) return item;
        const price = priceOf(product, currentPriceList);
        return { ...item, price, priceLevel: currentPriceList as PriceLevel };
      }),
    );
  }, [currentPriceList, productMap, priceOf]);

  async function loadErp(storeId: string) {
    const sb = supabaseBrowser();
    const [pointsRes, sellersRes, userRes] = await Promise.all([
      sb
        .from("erp_warehouses")
        // Se puede vender desde puntos y bodegas: cada uno con sus propias existencias.
        .select("id,name,kind,is_default,invoice_prefix,remision_prefix,next_invoice_number,next_remision_number")
        .eq("store_id", storeId)
        .eq("active", true)
        .order("kind", { ascending: false })
        .order("name"),
      sb.rpc("erp_sellers", { p_store: storeId }),
      sb.auth.getUser(),
    ]);
    // Si erp_ops.sql aún no está aplicado el POS sigue funcionando sin punto ni vendedor.
    const pointRows = (pointsRes.data ?? []) as PointOption[];
    const sellerRows = (sellersRes.data ?? []) as SellerOption[];
    const myPoint = (await sb.rpc("erp_my_point", { p_store: storeId })).data as string | null;
    const visiblePoints = myPoint ? pointRows.filter((pt) => pt.id === myPoint) : pointRows;
    setPoints(visiblePoints);
    setLockedPoint(Boolean(myPoint));
    setSellers(sellerRows);
    const initialPoint =
      visiblePoints.find((pt) => pt.kind === "point")?.id ||
      visiblePoints.find((pt) => pt.is_default)?.id ||
      visiblePoints[0]?.id ||
      "";
    setPointId((current) => current || initialPoint);
    const me = userRes.data.user?.id;
    const ofPoint = sellersForPoint(sellerRows, initialPoint);
    setSellerId((current) => current || ofPoint.find((r) => r.user_id === me)?.user_id || ofPoint[0]?.user_id || "");
    setMeId(me ?? "-");
  }

  async function load() {
    setLoading(true);
    try {
      const access = await getDashboardStore();
      if (!access.store) {
        throw new Error("No tienes acceso a ninguna tienda.");
      }
      setStore(access.store);
      setCanCredit(hasStorePermission(access, "credit"));
      const sb = supabaseBrowser();

      const productPages: Product[] = [];
      let productError: unknown = null;
      for (let from = 0; ; from += 1000) {
        const { data, error } = await sb
          .from("products")
          .select("id,name,price_1,price_2,price_3,price_4,price_5,min_wholesale,stock,image_url,active,sku,barcode")
          .eq("store_id", access.store.id)
          .order("name", { ascending: true })
          .order("id")
          .range(from, from + 999);
        if (error) {
          productError = error;
          break;
        }
        productPages.push(...((data as Product[]) ?? []));
        if (!data || data.length < 1000) break;
      }
      const [
        { data: clientData, error: clientError },
        { data: settingsData },
      ] = await Promise.all([
        loadPosClients(access.store.id),
        sb
          .from("billing_settings")
          .select("electronic_provider,invoice_prefix,remision_prefix")
          .eq("store_id", access.store.id)
          .maybeSingle(),
      ]);

      if (productError) throw productError;
      if (clientError) throw clientError;

      setProducts(productPages);
      setClients((clientData as Client[]) ?? []);
      void loadErp(access.store.id);
      setBillingSettings((settingsData as {
        electronic_provider?: string | null;
        invoice_prefix?: string | null;
        remision_prefix?: string | null;
      } | null) ?? null);
    } catch (err: unknown) {
      await Swal.fire({
        icon: "error",
        title: "No se pudo cargar el POS",
        text: getStoreDataSchemaErrorMessage(err),
        background: "#0b0b0b",
        color: "#fff",
        confirmButtonColor: "#ef4444",
      });
    } finally {
      setLoading(false);
    }
  }

  function prefillNewClient() {
    const term = clientSearch.trim();
    const isDoc = /^[\d.\-\s]+$/.test(term);
    setNewClient({ key: Date.now(), prefill: isDoc ? { document_number: term.replace(/\D/g, "") } : { name: term.toUpperCase() } });
  }

  async function saveNewClient() {
    if (!store) return;
    setSavingClient(true);
    try {
      const { data, error } = await supabaseBrowser()
        .from("billing_customers")
        .insert({
          store_id: store.id,
          name: customerName.trim(),
          document_number: customerDocument.trim() || null,
          email: customerEmail.trim() || null,
          mobile: customerWhatsApp.trim() || null,
          price_list: customerPriceList,
        })
        .select("id,name,email,mobile,document_number,price_list")
        .single();
      if (error) throw error;
      setClients((prev) => [data as Client, ...prev]);
      setClientSearch("");
      setSelectedClientId((data as Client).id);
    } catch (err: unknown) {
      await Swal.fire({
        icon: "error",
        title: "No se pudo crear el cliente",
        text: getStoreDataSchemaErrorMessage(err),
        background: "#0b0b0b",
        color: "#fff",
        confirmButtonColor: "#ef4444",
      });
    } finally {
      setSavingClient(false);
    }
  }

  async function updateClient() {
    if (!selectedClient) return;
    setSavingClient(true);
    try {
      const { data, error } = await supabaseBrowser()
        .from("billing_customers")
        .update({
          name: customerName.trim() || selectedClient.name,
          document_number: customerDocument.trim() || null,
          email: customerEmail.trim() || null,
          mobile: customerWhatsApp.trim() || null,
        })
        .eq("id", selectedClient.id)
        .select("id,name,email,mobile,document_number,price_list")
        .single();
      if (error) throw error;
      setClients((prev) => prev.map((c) => (c.id === selectedClient.id ? (data as Client) : c)));
      await Swal.fire({ icon: "success", title: "Tercero modificado", timer: 1200, showConfirmButton: false, background: "#0b0b0b", color: "#fff" });
    } catch (err: unknown) {
      await Swal.fire({
        icon: "error",
        title: "No se pudo modificar el tercero",
        text: getStoreDataSchemaErrorMessage(err),
        background: "#0b0b0b",
        color: "#fff",
        confirmButtonColor: "#ef4444",
      });
    } finally {
      setSavingClient(false);
    }
  }

  function setItemLevel(productId: string, level: PriceLevel) {
    const product = productMap.get(productId);
    if (!product) return;
    setCart((prev) =>
      prev.map((item) =>
        item.productId === productId ? { ...item, price: priceOf(product, level), priceLevel: level, manual: false } : item,
      ),
    );
  }

  function setQty(productId: string, qty: number) {
    setCart((prev) => prev.map((item) => (item.productId === productId ? { ...item, qty: Math.max(1, Math.floor(qty)) } : item)));
  }

  function setItemPrice(productId: string, price: number) {
    const product = allProducts.find((p) => p.id === productId);
    setCart((prev) => prev.map((item) => {
      if (item.productId !== productId) return item;
      const level = product ? priceOf(product, item.priceLevel) : item.price;
      return { ...item, price: Math.max(0, Math.round(price)), manual: Math.round(price) !== level };
    }));
  }

  function removeItem(productId: string) {
    const index = cart.findIndex((item) => item.productId === productId);
    const gone = cart[index];
    setCart((prev) => prev.filter((item) => item.productId !== productId));
    forgetApproval(productId);
    if (gone) undoToast(`Quitaste «${gone.name}» (${gone.qty})`, () => setCart((prev) => (prev.some((i) => i.productId === productId) ? prev : reinsert(prev, gone, index))));
  }

  const finderSource = useErpFinderSource(storeId, { activeOnly: true });

  const approvalsRef = useRef(approvals);
  useEffect(() => { approvalsRef.current = approvals; }, [approvals]);
  const mergePasses = useCallback((passes: Passes) => {
    if (Object.keys(passes).length) void restoreApprovals({ ...approvalsRef.current, ...passes });
  }, [restoreApprovals]);
  // Un precio de promoción por debajo del límite del vendedor recibe su pase automático (la base revisa que sea la promoción).
  const promoAsked = useRef(new Set<string>());
  useEffect(() => {
    if (!storeId || editingDoc) return;
    const need = cart.filter((i) => {
      const p = productById.get(i.productId);
      if (!p) return false;
      const promo = promoFor(p.id, basePriceOf(p, i.priceLevel));
      const key = `${i.productId}:${i.price}`;
      return promo && i.price === promo.price && approvalsRef.current[i.productId]?.status !== "approved" && !promoAsked.current.has(key);
    });
    if (!need.length) return;
    for (const i of need) promoAsked.current.add(`${i.productId}:${i.price}`);
    void requestPasses(storeId, pointId, "promo", null, need.map((i) => ({ product_id: i.productId, price: i.price, qty: i.qty }))).then(mergePasses);
  }, [cart, storeId, pointId, editingDoc, productById, promoFor, basePriceOf, mergePasses]);

  // Apartado que se entrega o cotización que se convierte en venta (?apartado=… / ?cotizacion=…).
  const layawayRef = useRef<{ id: string; number: number } | null>(null);
  const quoteRef = useRef<{ id: string; number: number } | null>(null);
  const [fromDoc, setFromDoc] = useState<string | null>(null);
  const sourceDone = useRef(false);
  useEffect(() => {
    if (sourceDone.current || !storeId || loading || !allProducts.length) return;
    const params = new URLSearchParams(window.location.search);
    const layId = params.get("apartado");
    const quoteId = params.get("cotizacion");
    if (!layId && !quoteId) return;
    sourceDone.current = true;
    window.history.replaceState(null, "", window.location.pathname);
    void (async () => {
      const sb = supabaseBrowser();
      type Src = { id: string; number: number; point_id: string | null; customer_name: string | null; customer_phone: string | null; items: Array<{ product_id: string; name: string; qty: number; price: number }>; balance?: number };
      let src: Src | undefined;
      if (layId) {
        const { data } = await sb.rpc("erp_layaways_list", { p_store: storeId, p_status: "open" });
        src = ((data as { items?: Src[] } | null)?.items ?? []).find((x) => x.id === layId);
      } else {
        const { data } = await sb.rpc("erp_quotes_list", { p_store: storeId, p_status: "open" });
        src = ((Array.isArray(data) ? data : []) as Src[]).find((x) => x.id === quoteId);
      }
      if (!src) return void Swal.fire({ icon: "warning", title: "No se encontró", text: "Ya se entregó, se anuló o no es de esta tienda.", background: "var(--t-bg-base)", color: "var(--t-text)" });
      if (layId && Number(src.balance ?? 0) > 0) return void Swal.fire({ icon: "warning", title: "Falta pagar", text: `El apartado #${src.number} tiene saldo de ${money(Number(src.balance))}. Recibe el abono en Apartados y vuelve a entregar.`, background: "var(--t-bg-base)", color: "var(--t-text)" });
      const next: CartItem[] = src.items.filter((it) => productById.has(it.product_id)).map((it) => ({
        productId: it.product_id, name: it.name, qty: Number(it.qty), price: Number(it.price), priceLevel: currentPriceList, note: layId ? `Apartado #${src!.number}` : "", manual: true,
      }));
      setEditingDoc(null);
      setCart(next);
      if (src.customer_name) setCustomerName(src.customer_name);
      if (src.customer_phone) setCustomerWhatsApp(src.customer_phone);
      if (layId) {
        layawayRef.current = { id: src.id, number: src.number };
        if (src.point_id && src.point_id !== pointId && !lockedPoint) setPointId(src.point_id);
        mergePasses(await requestPasses(storeId, src.point_id ?? pointId, "layaway", src.id, next.map((i) => ({ product_id: i.productId, price: i.price, qty: i.qty }))));
        setFromDoc(`📌 Entregando apartado #${src.number} (ya está pagado). Cobra con «Contado»: la caja se ajusta sola con los abonos.`);
      } else {
        quoteRef.current = { id: src.id, number: src.number };
        setFromDoc(`📝 Venta de la cotización #${src.number}. Revisa precios y existencias y cobra.`);
      }
    })();
  }, [storeId, loading, allProducts, productById, pointId, lockedPoint, currentPriceList, mergePasses]);

  function addComboLines(add: Array<{ productId: string; name: string; qty: number; price: number }>, passes: Passes, comboName: string) {
    setCart((prev) => [...prev, ...add.filter((a) => !prev.some((p) => p.productId === a.productId)).map((a) => ({
      productId: a.productId, name: a.name, qty: a.qty, price: a.price, priceLevel: currentPriceList, note: `Combo ${comboName}`, manual: true,
    }))]);
    mergePasses(passes);
    playTone("pop", 0.3);
  }
  function applyPrices(prices: Record<string, number>, passes: Passes, note: string) {
    setCart((prev) => prev.map((i) => (prices[i.productId] !== undefined ? { ...i, price: prices[i.productId], manual: true, note: i.note || note } : i)));
    mergePasses(passes);
  }
  function clearAfterLayaway() {
    setCart([]);
    setCustomerNote("");
    setSelectedClientId("");
    setPayment(EMPTY_PAYMENT);
    forgetApproval();
  }
  const holdLayaway = () => { if (layawayRef.current) void supabaseBrowser().rpc("erp_layaway_hold", { p_id: layawayRef.current.id }); };

  const lines: CartLine[] = useMemo(() => cart.map((item) => {
    const p = productById.get(item.productId);
    return {
      ...item,
      image: p?.image_url ?? null,
      stock: pointStock ? pointStock.get(item.productId) ?? 0 : p?.stock ?? null,
      levels: p ? ([1, 2, 3, 4, 5] as const).map((l) => priceOf(p, l)) : [item.price, item.price, item.price, item.price, item.price],
    };
  }), [cart, productById, pointStock, priceOf]);
  const listTotal = lines.reduce((sum, l) => sum + (l.levels[l.priceLevel - 1] ?? l.price) * l.qty, 0);
  const units = cart.reduce((sum, i) => sum + i.qty, 0);

  async function askApproval(productId: string, note: string) {
    const item = cart.find((i) => i.productId === productId);
    if (!item) return;
    const res = await requestApproval(productId, item.price, item.qty, note);
    if (!res.ok) await Swal.fire({ icon: "error", title: "No se pudo pedir la autorización", text: res.message, background: "var(--t-bg-base)", color: "var(--t-text)" });
    else if (res.notNeeded) void Swal.fire({ icon: "success", title: "No hace falta", text: "Ese precio está dentro de tu límite.", timer: 1400, showConfirmButton: false, background: "var(--t-bg-base)", color: "var(--t-text)" });
    else playTone("pop", 0.4);
  }

  /** Deja la venta en espera (el cliente fue por la billetera) y limpia el carrito para atender a otro. */
  function holdSale() {
    if (!cart.length || editingDoc) return;
    hold({ cart, total, customerName: customerName.trim(), selectedClientId, customerDocument: customerDocument.trim(), customerWhatsApp: customerWhatsApp.trim(), customerNote: customerNote.trim(), approvals: cartApprovals });
    setCart([]);
    setCustomerNote("");
    setSelectedClientId("");
    setPayment(EMPTY_PAYMENT);
    forgetApproval();
    playTone("pop", 0.4);
  }

  function resumeSale(id: string) {
    if (editingDoc) return;
    if (cart.length) holdSale();
    const h = take(id);
    if (!h) return;
    setCart(h.cart.map((i) => ({ ...i, priceLevel: Math.min(5, Math.max(1, i.priceLevel)) as PriceLevel })));
    void restoreApprovals(h.approvals);
    setSelectedClientId(h.selectedClientId);
    window.setTimeout(() => {
      setCustomerName(h.customerName || DEFAULT_CLIENT_NAME);
      setCustomerDocument(h.customerDocument);
      setCustomerWhatsApp(h.customerWhatsApp);
      setCustomerNote(h.customerNote);
    }, 0);
  }

  /** Vuelve al buscador para el siguiente producto (el texto queda seleccionado: se escribe encima). */
  function goSearch() {
    const el = searchRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }

  /**
   * Agrega un producto (o suma uno si ya está). Con el lector de códigos se queda en el buscador;
   * al tocarlo, el cursor salta a su cantidad → Enter al precio → Enter de vuelta a buscar.
   */
  function addProduct(product: Product, scanned = false) {
    playTone(scanned ? "escaner" : "pop", scanned ? 0.6 : 0.25);
    const had = cart.find((item) => item.productId === product.id)?.qty ?? 0;
    window.clearTimeout(flashTimer.current);
    setFlash({ id: product.id, text: had ? `Ya tenías ${had} · ahora ${had + 1}. Cambia la cantidad si quieres y Enter.` : "Agregado · cantidad y Enter para seguir" });
    flashTimer.current = window.setTimeout(() => setFlash(null), 3200);
    if (!scanned) focusPosField(product.id, "qty");
    setCart((prev) => {
      const existing = prev.find((item) => item.productId === product.id);
      const price = priceOf(product, currentPriceList);
      if (existing) {
        return prev.map((item) =>
          item.productId === product.id ? { ...item, qty: item.qty + 1 } : item,
        );
      }
      return [
        ...prev,
        {
          productId: product.id,
          name: product.name,
          qty: 1,
          price,
          priceLevel: currentPriceList,
          note: "",
        },
      ];
    });
  }

  /** Carga un documento abierto del punto en el carrito para agregarle o quitarle productos. */
  function startEdit(doc: PosDocument) {
    setCart(
      doc.items.map((it) => ({
        productId: it.product_id,
        name: it.name,
        qty: Number(it.qty),
        price: Number(it.price),
        priceLevel: currentPriceList,
        note: "",
        manual: true,
      })),
    );
    setEditingDoc(doc);
    forgetApproval();
    // Las autorizaciones que ya usó esta venta siguen valiendo al editarla (la base también las reconoce).
    void supabaseBrowser().rpc("erp_price_approvals_for_order", { p_order: doc.order_id }).then(({ data, error }) => {
      if (error || !Array.isArray(data) || data.length === 0) return;
      const used: Record<string, ApprovalState> = {};
      for (const a of data as Array<{ id: string; product_id: string; requested_price: number; decided_by_name: string | null; decision_note: string | null }>) {
        used[a.product_id] = { id: a.id, status: "approved", price: Number(a.requested_price), by: a.decided_by_name, note: a.decision_note, fromOrder: true };
      }
      void restoreApprovals(used);
    });
    setDocumentKind(doc.doc_kind === "factura" ? "factura" : "remision");
    setCustomerName(doc.customer_name || DEFAULT_CLIENT_NAME);
    setCustomerNote(doc.customer_note ?? "");
    setCustomerDocument(doc.customer_doc ?? "");
    void Swal.fire({
      icon: "info",
      title: `Editando ${doc.doc_number ?? `#${doc.receipt_no}`}`,
      text: "Agrega o quita productos y pulsa “Guardar cambios”.",
      timer: 1800,
      showConfirmButton: false,
      background: "var(--t-bg-base)",
      color: "var(--t-text)",
    });
  }

  function storeDraft() {
    if (!store) return;
    saveDraft({
      storeId: store.id, cart, total, customerName: customerName.trim(), customerNote: customerNote.trim(),
      customerWhatsApp: customerWhatsApp.trim(), customerDocument: customerDocument.trim(), selectedClientId,
      documentKind, pointId, sellerId, approvals: cartApprovals,
    });
    if (draftId) removeDraft(store.id, draftId);
    setDraftId(null);
    setCart([]);
    setCustomerNote("");
    setSelectedClientId("");
    void Swal.fire({
      icon: "info",
      title: "Guardada sin internet",
      html: "La venta quedó como <b>borrador</b> en este equipo.<br/><small>Cuando vuelva la conexión, regístrala desde «Ventas guardadas sin internet». Hasta entonces no descuenta inventario ni tiene número.</small>",
      background: "var(--t-bg-base)",
      color: "var(--t-text)",
      confirmButtonColor: "#f59e0b",
    });
  }

  function loadDraft(d: PosDraft) {
    if (cart.length && !window.confirm("Tienes productos en el carrito. ¿Reemplazarlos por el borrador?")) return;
    setEditingDoc(null);
    setCart(d.cart.map((i) => ({ ...i, priceLevel: (Math.min(5, Math.max(1, i.priceLevel)) as PriceLevel) })));
    void restoreApprovals(d.approvals);
    setCustomerName(d.customerName || DEFAULT_CLIENT_NAME);
    setCustomerNote(d.customerNote);
    setCustomerWhatsApp(d.customerWhatsApp);
    setCustomerDocument(d.customerDocument);
    setSelectedClientId(d.selectedClientId);
    setDocumentKind(d.documentKind);
    if (!lockedPoint && d.pointId) setPointId(d.pointId);
    if (d.sellerId) setSellerId(d.sellerId);
    setDraftId(d.id);
    void Swal.fire({ icon: "info", title: "Borrador cargado", text: "Revisa precios y existencias y pulsa el botón para registrarla.", timer: 2200, showConfirmButton: false, background: "var(--t-bg-base)", color: "var(--t-text)" });
  }

  function cancelEdit() {
    setEditingDoc(null);
    forgetApproval();
    setCart([]);
    setCustomerNote("");
    setCustomerDocument("");
    setCustomerName(selectedClient?.name ?? DEFAULT_CLIENT_NAME);
  }

  async function saveEdit(doc: PosDocument) {
    if (cart.length === 0) {
      await Swal.fire({ icon: "warning", title: "El documento no puede quedar vacío", background: "var(--t-bg-base)", color: "var(--t-text)" });
      return;
    }
    setSaving(true);
    try {
      const sb = supabaseBrowser();
      const { error } = await sb.rpc("erp_pos_order_set_items", {
        p_order: doc.order_id,
        p_items: cart.map((item) => ({ product_id: item.productId, qty: item.qty, price: item.price })),
        p_customer_name: customerName.trim() || null,
        p_customer_note: customerNote.trim(),
      });
      if (error) throw error;
      if (customerDocument.trim() !== (doc.customer_doc ?? "")) {
        await sb.rpc("erp_pos_set_customer_doc", { p_token: doc.token, p_doc: customerDocument.trim() });
      }
      const label = doc.doc_number ?? `#${doc.receipt_no}`;
      setEditingDoc(null);
      forgetApproval();
      setCart([]);
      setCustomerNote("");
      setDocsRefresh((n) => n + 1);
      const res = await Swal.fire({
        icon: "success",
        title: `${label} actualizado`,
        html: `<b>Total:</b> ${money(total)}`,
        showCancelButton: true,
        confirmButtonText: "Ver e imprimir",
        cancelButtonText: "Seguir vendiendo",
        background: "var(--t-bg-base)",
        color: "var(--t-text)",
        confirmButtonColor: "#22c55e",
      });
      if (res.isConfirmed) {
        window.open(`${window.location.origin}/pedido/${doc.token}?formato=${printSize === "carta" ? "carta" : "t80"}`, "_blank");
      }
    } catch (err: unknown) {
      await Swal.fire({
        icon: "error",
        title: "No se pudo guardar el documento",
        text: posErrorText(err),
        background: "var(--t-bg-base)",
        color: "var(--t-text)",
      });
    } finally {
      setSaving(false);
    }
  }

  async function createInvoice() {
    if (!store) return;
    if (cart.length === 0) {
      await Swal.fire({
        icon: "warning",
        title: "Carrito vacío",
        text: "Agrega al menos un producto para crear la factura.",
        background: "#0b0b0b",
        color: "#fff",
        confirmButtonColor: "#f59e0b",
      });
      return;
    }

    if (!customerName.trim()) {
      await Swal.fire({
        icon: "warning",
        title: "Nombre del cliente requerido",
        text: "Escribe el nombre del cliente antes de generar la factura.",
        background: "#0b0b0b",
        color: "#fff",
        confirmButtonColor: "#f59e0b",
      });
      return;
    }

    const blocked = lines.filter((l) => ["blocked", "pending"].includes(lineStatus(l, floors, approvals[l.productId])));
    if (blocked.length) {
      await Swal.fire({
        icon: "warning",
        title: "Hay precios por autorizar",
        html: `${blocked.map((l) => `• ${l.name.replace(/[<>&]/g, "")}`).join("<br/>")}<br/><br/><small>Sube el precio hasta tu límite o toca «🔓 Pedir autorización» en el producto.</small>`,
        background: "#0b0b0b",
        color: "#fff",
        confirmButtonColor: "#f59e0b",
      });
      return;
    }
    const pay = paymentSummary(payment, total);
    if (paymentType === "contado" && payment.method === "mixto" && pay.missing > 0) {
      await Swal.fire({ icon: "warning", title: "Falta completar el pago", text: `Faltan ${money(pay.missing)} para cubrir el total.`, background: "#0b0b0b", color: "#fff", confirmButtonColor: "#f59e0b" });
      return;
    }

    if (editingDoc) return saveEdit(editingDoc);

    // Sin internet: la venta se guarda como borrador (el crédito necesita validar el cupo en línea).
    if (!isOnline()) {
      if (paymentType === "credito") {
        await Swal.fire({ icon: "warning", title: "El crédito necesita internet", text: "Para vender a crédito hay que revisar el cupo del cliente. Cambia a contado o espera la conexión.", background: "#0b0b0b", color: "#fff", confirmButtonColor: "#f59e0b" });
        return;
      }
      return storeDraft();
    }

    if (documentKind === "factura" && fiscalOn && fiscal && !fiscal.ready) {
      await Swal.fire({
        icon: "error",
        title: "Este punto no está listo para facturar",
        html: `<div style="text-align:left">${fiscal.missing.map((m) => `• ${m}`).join("<br/>")}</div><br/><small>Puedes hacer una remisión mientras se completa la configuración.</small>`,
        background: "#0b0b0b",
        color: "#fff",
        confirmButtonColor: "#ef4444",
      });
      return;
    }

    // Venta a crédito: debe ser un tercero registrado y respetar su cupo.
    let creditOverride = false;
    let registerCredit = false;
    if (paymentType === "credito") {
      if (!selectedClient) {
        await Swal.fire({ icon: "warning", title: "Elige el cliente", text: "Para vender a crédito busca y selecciona un cliente registrado (o créalo con «Guardar como cliente nuevo»).", background: "#0b0b0b", color: "#fff", confirmButtonColor: "#f59e0b" });
        return;
      }
      let state = creditState && creditState.for === selectedClient.id && creditState.amount === total ? creditState : null;
      if (!state && !creditUnavailable) {
        const { data, error } = await supabaseBrowser().rpc("erp_credit_check", { p_customer: selectedClient.id, p_amount: total });
        if (error && !/erp_credit_check|Could not find the function|schema cache/i.test(error.message)) {
          await Swal.fire({ icon: "error", title: "No se pudo validar el crédito", text: error.message, background: "#0b0b0b", color: "#fff" });
          return;
        }
        state = error ? null : { ...(data as CreditState), for: selectedClient.id, amount: total };
      }
      if (!state) {
        const go = await Swal.fire({ icon: "warning", title: "Cartera no disponible", text: "La venta quedará marcada como crédito, pero no se registrará en cartera hasta ejecutar la migración 20261018_terceros_cartera.sql. ¿Continuar?", showCancelButton: true, confirmButtonText: "Continuar", cancelButtonText: "Cancelar", background: "#0b0b0b", color: "#fff", confirmButtonColor: "#f59e0b" });
        if (!go.isConfirmed) return;
      } else if (!state.can_sell) {
        if (!state.can_override) {
          await Swal.fire({ icon: "error", title: "Crédito no aprobado", html: `${state.reason ?? "No se puede vender a crédito."}<br/><small>Disponible: <b>${money(state.available)}</b> · Venta: <b>${money(total)}</b></small><br/><small>Pide autorización a un usuario con permiso de Créditos.</small>`, background: "#0b0b0b", color: "#fff", confirmButtonColor: "#ef4444" });
          return;
        }
        const go = await Swal.fire({ icon: "warning", title: "¿Autorizar venta a crédito?", html: `${state.reason}<br/><small>Disponible: <b>${money(state.available)}</b> · Venta: <b>${money(total)}</b>${state.overdue > 0 ? ` · Vencido: <b>${money(state.overdue)}</b>` : ""}</small><br/><small>Quedará registrado en auditoría con tu usuario.</small>`, showCancelButton: true, confirmButtonText: "Autorizar", cancelButtonText: "Cancelar", background: "#0b0b0b", color: "#fff", confirmButtonColor: "#f59e0b" });
        if (!go.isConfirmed) return;
        creditOverride = true;
        registerCredit = true;
      } else {
        registerCredit = true;
      }
    }

    // Apartado que se entrega: sus unidades estaban reservadas; se sueltan para que la venta las descuente.
    if (layawayRef.current && !editingDoc) {
      const { data: rel, error: relErr } = await supabaseBrowser().rpc("erp_layaway_release", { p_id: layawayRef.current.id, p_point: pointId || null });
      const ok = rel as { ok?: boolean; error?: string } | null;
      if (relErr || !ok?.ok) {
        await Swal.fire({ icon: "error", title: "No se pudo entregar el apartado", text: relErr?.message ?? ok?.error, background: "#0b0b0b", color: "#fff" });
        return;
      }
    }

    // Antes de guardar se revisa contra la base: otra persona pudo vender esas unidades hace un momento.
    if (pointId && !editingDoc) {
      const short = await checkStockNow(store.id, pointId, cart.map((i) => ({ product_id: i.productId, qty: i.qty, name: i.name })));
      if (short.length) {
        const fix = await Swal.fire({
          icon: "warning",
          title: "Las existencias cambiaron",
          html: `${shortListHtml(short)}<br><small>Otra persona acaba de vender o trasladar. ¿Ajusto el carrito a lo que queda?</small>`,
          showCancelButton: true, confirmButtonText: "Ajustar y revisar", cancelButtonText: "Volver al carrito",
          background: "#0b0b0b", color: "#fff", confirmButtonColor: "#f59e0b",
        });
        if (fix.isConfirmed) {
          const left = new Map(short.map((x) => [x.product_id, x.available]));
          setCart((prev) => prev.flatMap((item) => {
            const max = left.get(item.productId);
            if (max === undefined) return [item];
            return max > 0 ? [{ ...item, qty: Math.min(item.qty, max) }] : [];
          }));
          setPointStock((cur) => {
            const next = new Map(cur ?? []);
            for (const x of short) { if (x.available > 0) next.set(x.product_id, x.available); else next.delete(x.product_id); }
            return next;
          });
        }
        holdLayaway();
        return;
      }
    }

    // Precio por debajo del costo (20261225): se avisa antes de cobrar y la venta queda registrada para el dueño.
    if (!editingDoc) {
      const { data: low } = await supabaseBrowser().rpc("erp_below_cost_check", { p_store: store.id, p_items: cart.map((i) => ({ product_id: i.productId, price: i.price })) });
      const list = Array.isArray(low) ? (low as Array<{ name: string }>) : [];
      if (list.length) {
        const go = await Swal.fire({
          icon: "warning",
          title: "Precio por debajo del costo",
          html: `<div style="text-align:left;font-size:13px;line-height:1.6">${list.map((l) => `• <b>${l.name.replace(/[<>&]/g, "")}</b>`).join("<br>")}</div><br><small>Con este precio se pierde plata. Si sigues, la venta queda registrada y se le avisa al administrador.</small>`,
          showCancelButton: true, confirmButtonText: "Vender así", cancelButtonText: "Revisar precio",
          background: "#0b0b0b", color: "#fff", confirmButtonColor: "#ef4444", reverseButtons: true,
        });
        if (!go.isConfirmed) { holdLayaway(); return; }
      }
    }

    setSaving(true);
    let receiptWindow: Window | null = null;
    let createdToken: string | null = null;

    try {
      let siigoTrackingWarning: string | null = null;
      const payload = cart.map((item) => ({
        product_id: item.productId,
        description: item.name,
        qty: item.qty,
        price: item.price,
        sku: item.productId,
      }));
 
      const sb = supabaseBrowser();
      // Se abre la pestaña ya (los navegadores bloquean ventanas abiertas después de esperar)
      // y se carga el comprobante cuando el documento tiene su número del punto.
      receiptWindow = window.open("", "_blank");
      const { data, error } = await sb.rpc("create_order_from_cart", {
        p_store_id: store.id,
        p_catalog_type: "retail",
        p_items: payload,
        p_customer_name: customerName.trim(),
        p_customer_note: customerNote.trim(),
        p_customer_whatsapp: customerWhatsApp.trim() || null,
      });
 
      if (error) throw error;
      const token = (data as { token?: string } | null)?.token;
      if (!token) throw new Error("No se generó token de factura.");
      createdToken = token;
 
      let docNumber = "";
      let fiscalNote = "";
      const electronic = documentKind === "factura" && fiscalOn;
      if (electronic) {
        idemKey.current ??= newIdempotencyKey("pos");
        let issued: { document: { full_number: string; status: string; environment: string }; send: { ok: boolean; status: string | null; message: string } | null } | null = null;
        while (!issued) {
          try {
            issued = await fiscalApi("/api/fiscal/pos/invoice", {
              store_id: store.id, token, point_id: pointId || null, seller_id: sellerId || null,
              customer_id: selectedClient?.id ?? null, customer_doc: customerDocument.trim() || null,
              idempotency_key: idemKey.current, payment_form: paymentType === "credito" ? "credit" : "cash",
            });
          } catch (fiscalError) {
            const choice = await Swal.fire({
              icon: "error",
              title: "No se pudo emitir la factura electrónica",
              text: fiscalErrorText(fiscalError),
              background: "#0b0b0b",
              color: "#fff",
              showDenyButton: true,
              showCancelButton: true,
              confirmButtonText: "Reintentar",
              denyButtonText: "Guardar como remisión",
              cancelButtonText: "Dejar pendiente",
              confirmButtonColor: "#8b5cf6",
              denyButtonColor: "#f59e0b",
            });
            if (choice.isConfirmed) continue;
            if (choice.isDenied) {
              const { data: tag, error: tagError } = await sb.rpc("erp_tag_order", { p_store: store.id, p_token: token, p_point: pointId || null, p_seller: sellerId || null, p_kind: "remision" });
              if (tagError) throw tagError;
              docNumber = (tag as { doc_number?: string } | null)?.doc_number ?? "";
              fiscalNote = "<br/><small>Se guardó como remisión: aparece en Centro fiscal → «Por facturar».</small>";
            } else {
              fiscalNote = "<br/><small style=\"color:#f59e0b\">La venta quedó creada sin documento fiscal. Factúrala desde el Centro fiscal.</small>";
            }
            break;
          }
        }
        if (issued) {
          docNumber = issued.document.full_number;
          const env = issued.document.environment === "production" ? "" : " · 🧪 pruebas";
          fiscalNote = issued.send?.ok
            ? `<br/><b>Factura electrónica:</b> ${issued.send.status === "ACCEPTED" ? "✅ aceptada" : "enviada"}${env}`
            : `<br/><small style="color:#f59e0b">⚠️ ${issued.send?.message ?? "Quedó en cola: se enviará automáticamente."}</small>`;
        }
        idemKey.current = null;
        if (customerDocument.trim()) await sb.rpc("erp_pos_set_customer_doc", { p_token: token, p_doc: customerDocument.trim() });
      } else if (pointId || sellerId) {
        const { data: tag } = await sb.rpc("erp_tag_order", {
          p_store: store.id,
          p_token: token,
          p_point: pointId || null,
          p_seller: sellerId || null,
          p_kind: documentKind,
        });
        docNumber = (tag as { doc_number?: string } | null)?.doc_number ?? "";
        if (customerDocument.trim()) {
          // Permite buscar el documento por cédula/NIT; si el SQL no está aplicado se ignora.
          await sb.rpc("erp_pos_set_customer_doc", { p_token: token, p_doc: customerDocument.trim() });
        }
      }

      if (paymentType === "contado" && docNumber) {
        // Forma de pago y vuelto (si falta la migración 20261115 se ignora).
        await sb.rpc("erp_pos_set_payment", { p_token: token, p_payment: pay }).then(() => null, () => null);
      }

      let creditNote = "";
      if (registerCredit && selectedClient) {
        const { data: reg, error: regError } = await sb.rpc("erp_credit_register", {
          p_store: store.id,
          p_token: token,
          p_customer: selectedClient.id,
          p_days: dueDays,
          p_override: creditOverride,
        });
        if (regError) {
          creditNote = `<br/><small style="color:#f59e0b">⚠️ El documento se creó, pero no se registró en cartera: ${regError.message}</small>`;
        } else {
          const due = (reg as { due_date?: string } | null)?.due_date;
          creditNote = due ? `<br/><b>Crédito:</b> vence el ${new Date(`${due}T12:00:00`).toLocaleDateString("es-CO")}` : "";
          setCreditState(null);
        }
      }

      // El comprobante sugiere al imprimir el tamaño elegido en el POS.
      const invoiceUrl = `${window.location.origin}/pedido/${token}?formato=${printSize === "carta" ? "carta" : "t80"}`;
      if (receiptWindow && !receiptWindow.closed) receiptWindow.location.href = invoiceUrl;
      else window.open(invoiceUrl, "_blank");
      setDocsRefresh((n) => n + 1);
 
      if (!electronic && requestElectronicInvoice && documentKind === "factura" && siigoConfigured) {
        try {
          const { data: sessionData, error: sessionError } = await supabaseBrowser().auth.getSession();
          if (sessionError) throw sessionError;
          const siigoResponse = await fetch("/api/siigo/invoice", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${sessionData.session?.access_token ?? ""}`,
            },
            body: JSON.stringify({
              store_id: store.id,
              order_id: token,
              document_id: token,
              payload: {
                document_type: documentKind,
                customer: {
                  name: customerName.trim(),
                  document: customerDocument.trim() || "CF",
                  email: customerEmail.trim() || undefined,
                  mobile: customerWhatsApp.trim() || undefined,
                },
                items: payload,
                notes: customerNote.trim(),
                payment_type: paymentType,
                due_days: paymentType === "credito" ? dueDays : 0,
                currency_code: "COP",
              },
            }),
          });
 
          const siigoData = await siigoResponse.json();
          if (!siigoData.ok) {
            await Swal.fire({
              icon: "warning",
              title: "Factura electrónica no creada",
              text: String(siigoData.error || "No se pudo generar la factura electrónica."),
              background: "#0b0b0b",
              color: "#fff",
              confirmButtonColor: "#f59e0b",
            });
          } else if (siigoData.warning) {
            siigoTrackingWarning = String(siigoData.warning);
          }
        } catch (siigoError) {
          await Swal.fire({
            icon: "warning",
            title: "Factura electrónica no creada",
            text: String((siigoError as Error)?.message ?? siigoError),
            background: "#0b0b0b",
            color: "#fff",
            confirmButtonColor: "#f59e0b",
          });
        }
      }

      const kindLabel = documentKind === "factura" ? "Factura" : "Remisión";
      await Swal.fire({
        icon: "success",
        title: `${kindLabel} creada`,
        html: `${kindLabel} generada con éxito.${docNumber ? `<br/><b>N.º:</b> ${docNumber}` : ""}${fiscalNote}${sellerId ? `<br/><b>Vendedor:</b> ${sellers.find((r) => r.user_id === sellerId)?.name ?? ""}` : ""}${siigoTrackingWarning ? `<br/><small>${siigoTrackingWarning}</small>` : ""}<br/><b>Cliente:</b> ${customerName.replace(/[<>&]/g, "")}<br/><b>Total:</b> ${money(total)}${paymentType === "contado" && pay.change > 0 ? `<br/><b style="color:#22c55e">💵 Vuelto: ${money(pay.change)}</b>` : ""}${creditNote}`,
        background: "#0b0b0b",
        color: "#fff",
        confirmButtonText: "Ver comprobante",
        confirmButtonColor: "#22c55e",
      });

      // Apartado entregado / cotización vendida: queda ligado a la venta (y la caja se compensa con los abonos).
      if (createdToken && layawayRef.current) {
        await supabaseBrowser().rpc("erp_layaway_complete", { p_id: layawayRef.current.id, p_order_token: createdToken }).then(() => null, () => null);
        layawayRef.current = null;
      }
      if (createdToken && quoteRef.current) {
        await supabaseBrowser().rpc("erp_quote_set_status", { p_id: quoteRef.current.id, p_status: "accepted", p_order_token: createdToken }).then(() => null, () => null);
        quoteRef.current = null;
      }
      setFromDoc(null);
      setCart([]);
      setCustomerNote("");
      setSelectedClientId("");
      setPayment(EMPTY_PAYMENT);
      forgetApproval();
      playTone("caja-registradora", 0.5);
      if (draftId) removeDraft(store.id, draftId);
      setDraftId(null);
    } catch (err: unknown) {
      if (receiptWindow && !receiptWindow.closed) receiptWindow.close();
      if (!createdToken) holdLayaway();
      // Se cayó la red antes de crear la venta: se ofrece guardarla como borrador (nunca si ya se creó).
      if (!createdToken && isNetworkError(err) && paymentType !== "credito") {
        reportNetworkError();
        setSaving(false);
        const go = await Swal.fire({ icon: "warning", title: "Se perdió la conexión", text: "La venta no alcanzó a registrarse. ¿La guardas como borrador para enviarla cuando vuelva internet?", showCancelButton: true, confirmButtonText: "Guardar borrador", cancelButtonText: "Seguir intentando", background: "#0b0b0b", color: "#fff", confirmButtonColor: "#f59e0b" });
        if (go.isConfirmed) storeDraft();
        return;
      }
      await Swal.fire({
        icon: "error",
        title: documentKind === "factura" ? "No se pudo crear la factura" : "No se pudo crear la remisión",
        text: posErrorText(err),
        background: "#0b0b0b",
        color: "#fff",
        confirmButtonColor: "#ef4444",
      });
    } finally {
      setSaving(false);
    }
  }

  // «Volver a pedir» desde un comprobante: /dashboard/pos?reorder=<token> arma el carrito con esos productos
  // a los precios de hoy del punto (se pueden cambiar antes de cobrar).
  const reorderDone = useRef(false);
  useEffect(() => {
    if (reorderDone.current || !storeId || loading || !allProducts.length || (pointId && !pointStock)) return;
    const reorderToken = new URLSearchParams(window.location.search).get("reorder");
    if (!reorderToken) return;
    reorderDone.current = true;
    window.history.replaceState(null, "", window.location.pathname);
    void (async () => {
      const { data, error } = await supabaseBrowser().rpc("get_order_by_token_v2", { p_token: reorderToken });
      const order = (data as { order?: { store_id?: string; receipt_no?: number } } | null)?.order;
      if (error || !order || order.store_id !== storeId) {
        await Swal.fire({ icon: "warning", title: "No se pudo cargar el pedido", text: "Ese pedido no existe o es de otra tienda.", background: "var(--t-bg-base)", color: "var(--t-text)" });
        return;
      }
      const lines = ((data as { items?: Array<{ product_id: string; name: string; qty: number }> }).items ?? []);
      const missing: string[] = [];
      const next: CartItem[] = [];
      for (const it of lines) {
        const p = allProducts.find((x) => x.id === it.product_id);
        if (!p || p.active === false) { missing.push(it.name); continue; }
        next.push({ productId: p.id, name: p.name, qty: Math.max(1, Number(it.qty) || 1), price: priceOf(p, currentPriceList), priceLevel: currentPriceList, note: "" });
      }
      if (cart.length && !window.confirm("Tienes productos en el carrito. ¿Reemplazarlos por el pedido a repetir?")) return;
      setEditingDoc(null);
      setCart(next);
      const short = next.filter((i) => (pointStock ? pointStock.get(i.productId) ?? 0 : Infinity) < i.qty).map((i) => i.name);
      const esc = (t: string) => t.replace(/[<>&]/g, "");
      await Swal.fire({
        icon: next.length ? "success" : "warning",
        title: next.length ? "🔁 Pedido listo para repetir" : "No hay productos para repetir",
        html: `${next.length} producto${next.length === 1 ? "" : "s"} con los precios de hoy. Revisa, cambia lo que necesites y cobra.${
          missing.length ? `<br/><br/><b>Ya no están disponibles:</b><br/>${missing.map((m) => `• ${esc(m)}`).join("<br/>")}` : ""}${
          short.length ? `<br/><br/><b>Sin unidades suficientes en este punto:</b><br/>${short.map((m) => `• ${esc(m)}`).join("<br/>")}` : ""}`,
        background: "var(--t-bg-base)",
        color: "var(--t-text)",
        confirmButtonColor: "#8b5cf6",
      });
    })();
  }, [storeId, loading, allProducts, pointId, pointStock, priceOf, currentPriceList, cart.length]);

  const shortcuts = useRef({ submit: createInvoice, hold: holdSale });
  useEffect(() => { shortcuts.current = { submit: createInvoice, hold: holdSale }; });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F2") { e.preventDefault(); searchRef.current?.focus(); searchRef.current?.select(); }
      else if (e.key === "F4") { e.preventDefault(); void shortcuts.current.submit(); }
      else if (e.key === "F8") { e.preventDefault(); shortcuts.current.hold(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <main className="space-y-3 pb-20 lg:pb-0">
      <OfflineDrafts storeId={store?.id} activeId={draftId} onLoad={loadDraft} />
      <div {...cardProps()}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold">💳 POS / Facturación</h1>
            <p className="text-xs" style={{ color: "var(--t-muted)" }}>
              {store?.name ? `${store.name} · ` : ""}{products.length} producto{products.length === 1 ? "" : "s"} · {clients.length} cliente{clients.length === 1 ? "" : "s"}
            </p>
            {pointPricesError ? (
              <p className="mt-1 text-xs font-semibold" style={{ color: "#f59e0b" }}>
                ⚠️ No cargaron los precios de este punto (sus reglas): se están mostrando los de la madre. Detalle: {pointPricesError}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <CashStatusChip storeId={store?.id} pointId={pointId} />
            <PosDocuments
              storeId={store?.id}
              pointId={pointId}
              pointName={points.find((pt) => pt.id === pointId)?.name ?? "este punto"}
              refreshKey={docsRefresh}
              editingId={editingDoc?.order_id ?? null}
              printFormat={printSize}
              onEdit={startEdit}
            />
            {([
              { value: "vitrina", label: "Vitrina" },
              { value: "whatsapp", label: "WhatsApp" },
            ] as const).map((option) => (
              <button
                key={option.value}
                type="button"
                className="rounded-full border px-3.5 py-1.5 text-xs font-semibold transition"
                style={{
                  borderColor: orderSource === option.value ? "transparent" : "var(--t-card-border)",
                  background: orderSource === option.value ? "var(--t-cta)" : "transparent",
                  color: orderSource === option.value ? "var(--t-cta-text, #0b0b0b)" : "var(--t-text)",
                }}
                onClick={() => setOrderSource(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div {...cardProps()}>
        <div className="flex flex-wrap items-center gap-2">
          <motion.button
            type="button"
            layout
            onClick={() => setSelectedClientId("")}
            className="inline-flex max-w-full items-center gap-2 rounded-2xl border px-3 py-2 text-left"
            style={{ borderColor: selectedClient ? "var(--t-accent)" : "var(--t-card-border)", background: selectedClient ? "color-mix(in oklab, var(--t-accent) 12%, transparent)" : "transparent" }}
            title={selectedClient ? "Volver a Consumidor final" : "Cliente predeterminado"}
          >
            <UserRound size={16} className="shrink-0" />
            <span className="min-w-0">
              <span className="block truncate text-sm font-black">{effectiveClient.name}</span>
              <span className="block text-[11px]" style={{ color: "var(--t-muted)" }}>
                {selectedClient ? `Doc ${selectedClient.document_number ? docWithDv(selectedClient.document_number) : "—"} · Lista P${selectedClient.price_list}${selectedClient.credit_enabled ? (selectedClient.credit_blocked ? " · 🔒 crédito" : " · 💳 crédito") : ""}` : "Predeterminado · Lista P3"}
              </span>
            </span>
            {selectedClient ? <X size={14} className="shrink-0 opacity-70" /> : null}
          </motion.button>
          <div className="relative min-w-[220px] flex-1">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 opacity-60" />
            <input
              {...inputProps()}
              style={{ ...inputProps().style, paddingLeft: 34 }}
              value={clientSearch}
              onChange={(e) => setClientSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && clientSearch.trim() && filteredClients[0]) { e.preventDefault(); setSelectedClientId(filteredClients[0].id); setClientSearch(""); }
                if (e.key === "Escape") setClientSearch("");
              }}
              placeholder="Buscar cliente por nombre, cédula/NIT o teléfono…"
              aria-label="Buscar cliente"
            />
            <AnimatePresence>
              {clientSearch.trim() ? (
                <motion.div
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  className="absolute left-0 right-0 top-full z-30 mt-1 max-h-72 overflow-y-auto rounded-2xl border p-1 shadow-2xl"
                  style={{ borderColor: "var(--t-card-border)", background: "var(--t-bg-base)" }}
                >
                  {filteredClients.slice(0, 8).map((client) => (
                    <button key={client.id} type="button" onClick={() => { setSelectedClientId(client.id); setClientSearch(""); }}
                      className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left transition hover:bg-white/5">
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-black" style={{ background: "color-mix(in oklab, var(--t-accent) 22%, transparent)" }}>
                        {client.name.slice(0, 1)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-bold">{client.name}</span>
                        <span className="block truncate text-[11px]" style={{ color: "var(--t-muted)" }}>
                          {client.document_number ? docWithDv(client.document_number) : "Sin documento"}{client.mobile ? ` · 📱 ${client.mobile}` : ""} · P{client.price_list}{client.credit_enabled ? (client.credit_blocked ? " · 🔒" : " · 💳") : ""}
                        </span>
                      </span>
                    </button>
                  ))}
                  {filteredClients.length === 0 ? (
                    <div className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                      <span>No encontramos ese cliente.</span>
                      <button type="button" onClick={prefillNewClient} className="rounded-full px-3 py-1.5 text-xs font-semibold" style={{ background: "var(--t-cta)", color: "var(--t-cta-text, #0b0b0b)" }}>
                        ➕ Crear cliente
                      </button>
                    </div>
                  ) : null}
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>
        </div>
        <details className="mt-2">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2">
          <span className="min-w-0">
            <span className="text-base font-black">👤 Cliente y documento</span>
            <span className="block truncate text-xs" style={{ color: "var(--t-muted)" }}>
              {documentKind === "factura" ? "🧾 Factura" : "📄 Remisión"} · {paymentType === "credito" ? "💳 Crédito" : "💵 Contado"} · {points.find((pt) => pt.id === pointId)?.name ?? "Sin punto"}
              {sellerId ? ` · 🧑‍💼 ${sellers.find((r) => r.user_id === sellerId)?.name ?? ""}` : ""}
            </span>
          </span>
          <span className="shrink-0 rounded-full border px-3 py-1 text-xs font-semibold" style={{ borderColor: "var(--t-card-border)" }}>Más opciones ▾</span>
        </summary>

        <div className="mt-3 space-y-3">
          <div>
            <p
              className="mt-2 text-sm"
              style={{ color: "var(--t-muted)" }}
            >
              Cliente activo: {effectiveClient.name} · Doc: {effectiveClient.document_number ? docWithDv(effectiveClient.document_number) : "CF"} · Lista {effectiveClient.price_list}
            </p>
            {selectedClient?.credit_enabled && creditState?.for === selectedClient.id ? (
              <div className="mt-2 rounded-xl border p-2.5" style={{ borderColor: "var(--t-card-border)" }}>
                <CreditMeter size="sm" enabled={creditState.enabled} blocked={creditState.blocked} limit={creditState.limit} used={creditState.used} overdue={creditState.overdue} overdueCount={creditState.overdue_count} />
              </div>
            ) : null}
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <label className="flex items-center justify-between gap-2 text-sm font-semibold">Punto de venta / bodega{pointId && stockLive ? <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-emerald-500" title="Las existencias se actualizan solas cuando otra persona vende o traslada"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" /> Existencias en vivo</span> : null}</label>
                <select
                  {...inputProps()}
                  value={pointId}
                  onChange={(e) => {
                    if (editingDoc) cancelEdit();
                    setPointStock(null);
                    setPointId(e.target.value);
                    // Al cambiar de punto se muestran solo sus vendedores.
                    const ofPoint = sellersForPoint(sellers, e.target.value);
                    setSellerId((current) => (ofPoint.some((r) => r.user_id === current) ? current : ofPoint[0]?.user_id ?? ""));
                  }}
                  disabled={lockedPoint}
                >
                  {points.map((pt) => (
                    <option key={pt.id} value={pt.id}>{pt.kind === "warehouse" ? "🏬" : "📍"} {pt.name}</option>
                  ))}
                </select>
                <p className="mt-1 text-[11px]" style={{ color: "var(--t-muted)" }}>Solo se venden las existencias de este lugar.</p>
              </div>
              <div>
                <label className="text-sm font-semibold">Vendedor</label>
                <select {...inputProps()} value={sellerId} onChange={(e) => setSellerId(e.target.value)}>
                  <option value="">Sin vendedor</option>
                  {sellersForPoint(sellers, pointId).map((r) => (
                    <option key={r.user_id} value={r.user_id}>{r.name}</option>
                  ))}
                </select>
                {sellersForPoint(sellers, pointId).length === 0 ? (
                  <p className="mt-1 text-[11px]" style={{ color: "var(--t-muted)" }}>Este punto aún no tiene vendedores. Créalos en Ajustes → Usuarios y asígnales este punto.</p>
                ) : null}
              </div>
            </div>
            <p className="mt-2 text-sm" style={{ color: "var(--t-muted)" }}>
              {(() => {
                const pt = points.find((x) => x.id === pointId);
                if (pt && documentKind === "factura" && fiscalOn) {
                  return fiscal?.range ? `Próxima factura electrónica: ${fiscal.range.prefix}${fiscal.range.next_number} · quedan ${fiscal.range.remaining}` : "Sin numeración electrónica vigente";
                }
                if (pt) {
                  const prefix = documentKind === "factura" ? pt.invoice_prefix : pt.remision_prefix;
                  const next = documentKind === "factura" ? pt.next_invoice_number : pt.next_remision_number;
                  return `Próximo documento: ${prefix}-${String(next).padStart(5, "0")}`;
                }
                return billingSettings
                  ? `Prefijos: ${billingSettings.invoice_prefix ?? "FAC"} / ${billingSettings.remision_prefix ?? "REM"}`
                  : "Configura facturación para usar remisiones, facturas y Siigo.";
              })()}{" "}
              <Link href="/dashboard/inventario" className="font-semibold underline" style={{ color: "var(--t-accent)" }}>Editar prefijos y puntos</Link>
            </p>
          </div>
 
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="text-sm font-semibold">Nombre</label>
              <input
                {...inputProps()}
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="Nombre del cliente"
              />
            </div>
            <div>
              <label className="text-sm font-semibold">Documento</label>
              <WithDv value={customerDocument}>
                <input
                  {...inputProps()}
                  value={customerDocument}
                  onChange={(e) => setCustomerDocument(e.target.value)}
                  placeholder="NIT o cédula"
                />
              </WithDv>
            </div>
          </div>
 
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="text-sm font-semibold">Email</label>
              <input
                {...inputProps()}
                type="email"
                value={customerEmail}
                onChange={(e) => setCustomerEmail(e.target.value)}
                placeholder="correo@cliente.com"
              />
            </div>
            <div>
              <label className="text-sm font-semibold">WhatsApp</label>
              <input
                {...inputProps()}
                value={customerWhatsApp}
                onChange={(e) => setCustomerWhatsApp(e.target.value)}
                placeholder="57XXXXXXXXX"
              />
            </div>
          </div>

          {!selectedClient && customerName.trim() && customerName.trim() !== DEFAULT_CLIENT_NAME ? (
            <button
              type="button"
              onClick={saveNewClient}
              disabled={savingClient}
              className="w-full rounded-xl border px-3 py-2 text-sm font-semibold disabled:opacity-60"
              style={{ borderColor: "var(--t-accent)", color: "var(--t-text)" }}
            >
              {savingClient ? "Guardando…" : "💾 Guardar como cliente nuevo"}
            </button>
          ) : null}
 
          {selectedClient ? (
            <button
              type="button"
              onClick={updateClient}
              disabled={savingClient}
              className="w-full rounded-xl border px-3 py-2 text-sm font-semibold disabled:opacity-60"
              style={{ borderColor: "var(--t-accent)", color: "var(--t-text)" }}
            >
              {savingClient ? "Guardando…" : "✏️ Modificar tercero (guardar cambios)"}
            </button>
          ) : null}

          <div>
            <label className="text-sm font-semibold">Tipo de pago</label>
            <div className="mt-2 flex flex-wrap gap-2">
              {[
                { value: "contado", label: "Contado" },
                { value: "credito", label: "Crédito" },
              ].map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className="rounded-2xl border px-4 py-2 text-sm font-semibold"
                  style={{
                    borderColor: "var(--t-card-border)",
                    background:
                      paymentType === option.value
                        ? "var(--t-cta)"
                        : "color-mix(in oklab, var(--t-card-bg) 92%, transparent)",
                    color:
                      paymentType === option.value ? "#0b0b0b" : "var(--t-text)",
                  }}
                  onClick={() => setPaymentType(option.value as "contado" | "credito")}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
 
          {paymentType === "credito" ? (
            <div className="space-y-2">
              {!selectedClient ? (
                <p className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
                  💳 Para vender a crédito elige un <b>cliente registrado</b>. La deuda quedará en su cartera.
                </p>
              ) : creditUnavailable ? (
                <p className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs">Ejecuta la migración de cartera (20261018_terceros_cartera.sql) para controlar cupos.</p>
              ) : creditState?.for === selectedClient.id ? (
                <div
                  className="rounded-xl border p-3"
                  style={{ borderColor: creditState.can_sell ? "color-mix(in oklab, #22c55e 40%, transparent)" : "color-mix(in oklab, #ef4444 45%, transparent)", background: creditState.can_sell ? "color-mix(in oklab, #22c55e 7%, transparent)" : "color-mix(in oklab, #ef4444 7%, transparent)" }}
                >
                  <CreditMeter enabled={creditState.enabled} blocked={creditState.blocked} limit={creditState.limit} used={creditState.used} overdue={creditState.overdue} overdueCount={creditState.overdue_count} />
                  <p className="mt-2 text-xs font-semibold" style={{ color: creditState.can_sell ? "#22c55e" : "#ef4444" }}>
                    {creditState.can_sell
                      ? `✅ Aprobado: esta venta de ${money(total)} cabe en el cupo.`
                      : `⛔ ${creditState.reason}${creditState.can_override ? " Puedes autorizarla con tu permiso de Créditos." : " Necesita autorización de un usuario con permiso de Créditos."}`}
                  </p>
                </div>
              ) : (
                <p className="text-xs" style={{ color: "var(--t-muted)" }}>Consultando cupo…</p>
              )}
              <label className="text-sm font-semibold">Días de crédito</label>
              <input
                {...inputProps()}
                type="number"
                min={1}
                value={dueDays}
                onChange={(e) => setDueDays(Number(e.target.value))}
                placeholder="30"
              />
            </div>
          ) : null}
 
          <div>
            <label className="text-sm font-semibold">Tipo de comprobante</label>
            <div className="mt-2 flex flex-wrap gap-2">
              {[
                { value: "remision", label: "Remisión" },
                { value: "factura", label: "Factura" },
              ].map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className="rounded-2xl border px-4 py-2 text-sm font-semibold"
                  style={{
                    borderColor: "var(--t-card-border)",
                    background:
                      documentKind === option.value
                        ? "var(--t-cta)"
                        : "color-mix(in oklab, var(--t-card-bg) 92%, transparent)",
                    color:
                      documentKind === option.value ? "#0b0b0b" : "var(--t-text)",
                  }}
                  onClick={() => setDocumentKind(option.value as "remision" | "factura")}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
 
          {documentKind === "factura" && fiscalOn && fiscal ? (
            <div className="space-y-2 rounded-2xl border p-4" style={{ borderColor: fiscal.ready ? "rgba(34,197,94,.4)" : "rgba(239,68,68,.45)", background: fiscal.ready ? "rgba(34,197,94,.08)" : "rgba(239,68,68,.08)" }}>
              <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                {fiscal.ready ? "🟢 Factura electrónica" : "🔴 Este punto no está listo para facturar"}
                <span className="rounded-full border px-2 py-0.5 text-[11px]" style={{ borderColor: "var(--t-card-border)" }}>{fiscal.environment === "production" ? "🟢 Producción" : "🧪 Pruebas"}</span>
              </p>
              {fiscal.ready ? (
                <p className="text-xs" style={{ color: "var(--t-muted)" }}>
                  {fiscal.entity?.legal_name} · NIT {fiscal.entity?.document_number}{fiscal.entity?.verification_digit ? `-${fiscal.entity.verification_digit}` : ""} · {fiscal.provider?.name}. El número, la resolución y el envío los resuelve el servidor.
                </p>
              ) : (
                <ul className="list-disc pl-5 text-xs" style={{ color: "var(--t-muted)" }}>{fiscal.missing.map((m) => <li key={m}>{m}</li>)}</ul>
              )}
              {fiscal.warnings.map((w) => <p key={w} className="text-xs text-amber-500">⚠️ {w}</p>)}
            </div>
          ) : documentKind === "factura" ? (
            <div className="space-y-2 rounded-2xl border border-dashed border-slate-500/30 p-4">
              <label className="flex items-center gap-2 text-sm font-semibold">
                <input
                  type="checkbox"
                  checked={requestElectronicInvoice}
                  disabled={!siigoConfigured}
                  onChange={(e) => setRequestElectronicInvoice(e.target.checked)}
                />
                Solicitar factura electrónica (Siigo)
              </label>
              <p className="text-xs" style={{ color: "var(--t-muted)" }}>
                {siigoConfigured
                  ? "Se usará la configuración de Siigo de tu tienda para generar la factura electrónica cuando esté disponible."
                  : "Activa y configura Siigo en Facturación para poder emitir factura electrónica desde el POS."}
              </p>
            </div>
          ) : null}
 
          <div>
            <label className="text-sm font-semibold">Formato de impresión</label>
            <select
              {...inputProps()}
              value={printSize}
              onChange={(e) => setPrintSize(e.target.value as "tirilla" | "carta")}
            >
              <option value="tirilla">Tirilla</option>
              <option value="carta">Carta</option>
            </select>
          </div>
 
          <div>
            <label className="text-sm font-semibold">
              Observaciones / Nota
            </label>
            <textarea
              {...inputProps()}
              className="w-full rounded-2xl border px-4 py-3 text-sm outline-none min-h-[120px]"
              value={customerNote}
              onChange={(e) => setCustomerNote(e.target.value)}
              placeholder="Por ejemplo: venta en vitrina, factura a crédito, entrega inmediata"
            />
          </div>
        </div>
        </details>
      </div>

      <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1.5fr)_minmax(320px,1fr)]">
        <div className="space-y-3">
          <div {...cardProps()}>
            <div className="flex gap-2">
              <input
                {...inputProps()}
                ref={searchRef}
                placeholder="🔍 Nombre, código o código de barras…  (F2)"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setVisibleCount(48);
                }}
                onKeyDown={(e) => {
                  // ↓: baja a los resultados para escoger con las flechas y Enter.
                  if (e.key === "ArrowDown") {
                    const first = document.querySelector<HTMLButtonElement>("[data-pos-result]:not([disabled])");
                    if (first) { e.preventDefault(); first.focus(); }
                    return;
                  }
                  // Enter con un código exacto agrega el producto (lector de códigos de barras).
                  if (e.key !== "Enter") return;
                  const hit = filteredProducts.find((p) => isExactCode(p, search.trim().toLowerCase()));
                  if (!hit) {
                    // Sin código exacto: si queda un solo producto disponible se agrega; si hay varios, se baja a escogerlo.
                    const available = search.trim() ? filteredProducts.filter((p) => p.active && p.stock !== 0) : [];
                    if (available.length === 1) { e.preventDefault(); addProduct(available[0]); }
                    else if (available.length > 1) {
                      e.preventDefault();
                      document.querySelector<HTMLButtonElement>("[data-pos-result]:not([disabled])")?.focus();
                    }
                    return;
                  }
                  e.preventDefault();
                  if (!hit.active || hit.stock === 0) return void Swal.fire({ icon: "warning", title: "Sin existencias", text: `${hit.name} no tiene unidades en este punto.`, background: "var(--t-bg-base)", color: "var(--t-text)" });
                  addProduct(hit, true);
                  setSearch("");
                }}
              />
              <PhotoSearchButton
                source={finderSource}
                pickLabel="Agregar"
                title="Agregar producto"
                subtitle="Toma una foto del producto o escribe su nombre o código."
                storageKey={`pos:${storeId ?? ""}`}
                renderExtra={(hit) => {
                  const stock = pointStock ? pointStock.get(hit.id) ?? 0 : allProducts.find((p) => p.id === hit.id)?.stock ?? null;
                  return stock === null ? null : (
                    <span className="mt-0.5 block text-[11px] font-semibold" style={{ color: stock > 0 ? "#16a34a" : "#dc2626" }}>
                      {stock > 0 ? `${stock} disponibles aquí` : "Sin existencias aquí"}
                    </span>
                  );
                }}
                onPick={(hit) => {
                  const product = allProducts.find((p) => p.id === hit.id);
                  const stock = product ? (pointStock ? pointStock.get(product.id) ?? 0 : product.stock) : 0;
                  if (!product || !product.active || stock === 0) {
                    void Swal.fire({ icon: "warning", title: "Sin existencias", text: `${hit.name} no tiene unidades en este punto.`, background: "var(--t-bg-base)", color: "var(--t-text)" });
                    return;
                  }
                  addProduct({ ...product, stock });
                }}
              />
            </div>

            {loading || (pointId && !pointStock) ? (
              <p className="mt-6 text-sm" style={{ color: "var(--t-muted)" }}>
                {loading ? "Cargando productos..." : "Cargando existencias del punto..."}
              </p>
            ) : filteredProducts.length === 0 ? (
              <p className="mt-6 text-sm" style={{ color: "var(--t-muted)" }}>
                {search.trim()
                  ? "No hay productos con ese nombre en esta tienda."
                  : pointStock
                    ? "Este punto no tiene existencias. Recibe mercancía con un ingreso de factura o un traslado."
                    : "No se encontraron productos."}
              </p>
            ) : (
              <div className="mt-3 max-h-[62vh] overflow-y-auto pr-1">
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {filteredProducts.slice(0, visibleCount).map((product) => {
                    const disabled = !product.active || product.stock === 0;
                    return (
                      <button
                        key={product.id}
                        type="button"
                        disabled={disabled}
                        data-pos-result
                        onClick={() => addProduct(product)}
                        onKeyDown={(e) => {
                          // Flechas para moverse entre resultados; Esc vuelve a buscar (Enter agrega: es un botón).
                          const all = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-pos-result]:not([disabled])"));
                          const i = all.indexOf(e.currentTarget);
                          const cols = window.innerWidth >= 1280 ? 3 : window.innerWidth >= 640 ? 2 : 1;
                          const move = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols }[e.key as "ArrowRight"];
                          if (e.key === "Escape") { e.preventDefault(); goSearch(); }
                          else if (move !== undefined) {
                            e.preventDefault();
                            const next = i + move;
                            if (next < 0) goSearch();
                            else all[Math.min(next, all.length - 1)]?.focus();
                          }
                        }}
                        className="group flex items-center gap-2.5 rounded-xl border p-2 text-left transition hover:-translate-y-0.5 disabled:opacity-50"
                        style={{
                          borderColor: "var(--t-card-border)",
                          background: "color-mix(in oklab, var(--t-card-bg) 94%, transparent)",
                        }}
                      >
                        <span className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-lg border" style={{ borderColor: "var(--t-card-border)" }}>
                          {product.image_url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={product.image_url} alt="" loading="lazy" className="h-full w-full object-cover" />
                          ) : (
                            <span>🛍️</span>
                          )}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="line-clamp-2 text-xs font-semibold leading-tight">{product.name}</span>
                          <span className="mt-0.5 block text-[11px]" style={{ color: "var(--t-muted)" }}>
                            {money(priceOf(product, currentPriceList))}
                            {product.stock === 0 ? " · Agotado" : product.stock !== null ? ` · ${product.stock} disp.` : ""}
                          </span>
                        </span>
                        <span
                          className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-lg font-bold"
                          style={{ background: "var(--t-cta)", color: "var(--t-cta-text, #0b0b0b)" }}
                        >
                          +
                        </span>
                      </button>
                    );
                  })}
                </div>
                {filteredProducts.length > visibleCount ? (
                  <button
                    type="button"
                    onClick={() => setVisibleCount((n) => n + 48)}
                    className="mt-3 w-full rounded-xl border py-2 text-xs font-semibold"
                    style={{ borderColor: "var(--t-card-border)", color: "var(--t-text)" }}
                  >
                    Mostrar más ({filteredProducts.length - visibleCount} restantes)
                  </button>
                ) : null}
              </div>
            )}
          </div>

        </div>

        <div className="space-y-3 lg:sticky lg:top-2" ref={cartRef}>
          <div {...cardProps()}>
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-base font-black">🛒 Carrito <span className="text-xs font-semibold" style={{ color: "var(--t-muted)" }}>{cart.length ? `${cart.length} producto${cart.length === 1 ? "" : "s"} · ${units} und.` : ""}</span></h2>
              {cart.length && !editingDoc ? (
                <span className="text-[11px]"><button type="button" onClick={holdSale} title="Dejar en espera (F8)" className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-bold transition hover:-translate-y-0.5" style={{ borderColor: "var(--t-card-border)" }}>
                  <Pause size={12} /> En espera
                </button></span>
              ) : null}
            </div>
            {held.length ? (
              <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1 text-[11px] [scrollbar-width:none]">
                {held.map((h) => (
                  <motion.button key={h.id} layout initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} type="button" onClick={() => resumeSale(h.id)}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold" style={{ borderColor: "color-mix(in oklab, #f59e0b 50%, var(--t-card-border))", background: "rgba(245,158,11,.1)" }}>
                    <Play size={11} /> {h.customerName || DEFAULT_CLIENT_NAME} · {money(h.total)} · {new Date(h.at).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" })}
                  </motion.button>
                ))}
              </div>
            ) : null}
            {editingDoc ? (
              <div
                className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2 text-xs"
                style={{ borderColor: "var(--t-accent)", background: "color-mix(in oklab, var(--t-accent) 12%, transparent)" }}
              >
                <span>
                  ✏️ Editando <b>{editingDoc.doc_number ?? `#${editingDoc.receipt_no}`}</b> · {editingDoc.customer_name ?? DEFAULT_CLIENT_NAME}
                </span>
                <button type="button" onClick={cancelEdit} className="rounded-full border px-2.5 py-1 font-semibold" style={{ borderColor: "var(--t-card-border)" }}>
                  Cancelar edición
                </button>
              </div>
            ) : null}

            <div className="mt-2 flex flex-wrap items-center gap-1 text-[11px]">
              <span className="text-[11px]" style={{ color: "var(--t-muted)" }}>💲 Lista de precios:</span>
              {([1, 2, 3, 4, 5] as const).map((lvl) => (
                <button
                  key={lvl}
                  type="button"
                  onClick={() => setListOverride(lvl)}
                  className="rounded-full border px-2.5 py-0.5 text-[11px] font-semibold"
                  style={{
                    borderColor: currentPriceList === lvl ? "transparent" : "var(--t-card-border)",
                    background: currentPriceList === lvl ? "var(--t-cta)" : "transparent",
                    color: currentPriceList === lvl ? "var(--t-cta-text, #0b0b0b)" : "var(--t-text)",
                  }}
                >
                  P{lvl}
                </button>
              ))}
            </div>

            <PosCartLines
              lines={lines}
              floors={floors}
              approvals={approvals}
              onQty={setQty}
              onPrice={setItemPrice}
              onLevel={(id, lv) => setItemLevel(id, lv as PriceLevel)}
              onRemove={removeItem}
              onRequest={askApproval}
              flash={flash}
              onNext={goSearch}
            />

            {fromDoc ? (
              <div className="mt-2 flex items-start justify-between gap-2 rounded-xl border px-3 py-2 text-xs" style={{ borderColor: "var(--t-accent)", background: "color-mix(in oklab, var(--t-accent) 12%, transparent)" }}>
                <span>{fromDoc}</span>
                <button type="button" className="shrink-0 underline" onClick={() => { if (layawayRef.current) holdLayaway(); layawayRef.current = null; quoteRef.current = null; setFromDoc(null); setCart([]); }}>Cancelar</button>
              </div>
            ) : null}
            {store && !editingDoc ? (
              <PosToolbar
                storeId={store.id}
                storeName={store.name}
                pointId={pointId}
                cart={cart.map((c) => ({ productId: c.productId, name: c.name, qty: c.qty, price: c.price }))}
                total={total}
                customerName={customerName}
                customerPhone={customerWhatsApp}
                customerDoc={customerDocument}
                priceOf={(id) => { const p = productById.get(id); return p ? priceOf(p, currentPriceList) : null; }}
                onAddCombo={addComboLines}
                onSetPrices={applyPrices}
                onClear={clearAfterLayaway}
              />
            ) : null}

            {cart.length ? (
              <div className="mt-3 space-y-1 rounded-2xl border p-3 text-sm" style={{ borderColor: "var(--t-card-border)" }}>
                {listTotal > total ? (
                  <>
                    <p className="flex justify-between" style={{ color: "var(--t-muted)" }}><span>Precio de lista</span><span className="tabular-nums line-through">{money(listTotal)}</span></p>
                    <p className="flex justify-between text-amber-400"><span>🏷️ Descuento</span><span className="tabular-nums">−{money(listTotal - total)}</span></p>
                  </>
                ) : null}
                <p className="flex items-end justify-between">
                  <span className="font-bold">Total</span>
                  <motion.span key={total} initial={{ scale: 1.12 }} animate={{ scale: 1 }} className="text-2xl font-black tabular-nums">{money(total)}</motion.span>
                </p>
                {floors ? <p className="text-[11px]" style={{ color: "var(--t-muted)" }}>🔐 {LIMIT_LABEL[floors.mode] ?? ""}{floors.mode === "margin" ? ` (+${floors.margin_pct} % sobre el costo)` : ""}{floors.source === "default" ? " · tu punto aún no tiene límite configurado (Rentabilidad → Límites de precio)" : floors.source === "user" ? " · límite personal" : ""}.</p> : null}
              </div>
            ) : null}

            {cart.length && paymentType === "contado" && !editingDoc ? <PosPayment total={total} value={payment} onChange={setPayment} /> : null}

            <button
              onClick={createInvoice}
              disabled={saving}
              title="Cobrar (F4)"
              className="mt-3 w-full rounded-2xl border px-4 py-3.5 text-base font-black transition hover:brightness-110 active:scale-[0.99] disabled:opacity-60"
              style={{
                borderColor:
                  "color-mix(in oklab, var(--t-accent) 45%, var(--t-card-border))",
                background: "var(--t-cta)",
                color: "#0b0b0b",
              }}
            >
              {editingDoc
                ? saving
                  ? "Guardando cambios..."
                  : `💾 Guardar cambios en ${editingDoc.doc_number ?? `#${editingDoc.receipt_no}`}`
                : !net.online
                ? "💾 Guardar sin internet (borrador)"
                : saving
                ? documentKind === "factura"
                  ? "Creando factura..."
                  : "Creando remisión..."
                : documentKind === "factura"
                  ? requestElectronicInvoice || fiscalOn
                    ? "Crear factura electrónica"
                    : "Crear factura"
                  : "Crear remisión"}
              {cart.length && !saving ? ` · ${money(total)}` : ""}
            </button>
            <p className="mt-2 hidden text-center text-[10px] sm:block" style={{ color: "var(--t-muted)" }}>⌨️ F2 buscar · Enter agrega con el lector · F4 cobrar · F8 en espera</p>
          </div>

        </div>
      </div>
      {/* Celular: el carrito queda abajo de los productos; esta barra lo trae con un toque. */}
      <AnimatePresence>
        {cart.length ? (
          <motion.div initial={{ y: 80 }} animate={{ y: 0 }} exit={{ y: 80 }} transition={{ type: "spring", stiffness: 380, damping: 32 }}
            className="fixed inset-x-3 bottom-3 z-40 lg:hidden" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
            <button type="button" onClick={() => cartRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
              className="flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left text-white shadow-[0_14px_40px_rgba(0,0,0,.45)]" style={{ background: "linear-gradient(135deg,#ec4899,#8b5cf6 55%,#6366f1)" }}>
              <span className="text-xl">🛒</span>
              <span className="min-w-0 flex-1 text-sm font-bold">{units} und. · {cart.length} producto{cart.length === 1 ? "" : "s"}</span>
              <motion.span key={total} initial={{ scale: 1.15 }} animate={{ scale: 1 }} className="text-lg font-black tabular-nums">{money(total)}</motion.span>
              <span className="rounded-full bg-white/20 px-2.5 py-1 text-xs font-black">Ver carrito ↓</span>
            </button>
          </motion.div>
        ) : null}
      </AnimatePresence>
      {newClient && store ? (
        <ThirdPartyForm
          key={newClient.key}
          open
          onClose={() => setNewClient(null)}
          storeId={store.id}
          initial={null}
          defaultKinds={["customer"]}
          canCredit={canCredit}
          existing={[]}
          prefill={newClient.prefill}
          onSaved={(row) => {
            const created: Client = {
              id: row.id, name: row.name, email: row.email, mobile: row.mobile, document_number: row.document_number, price_list: row.price_list,
              kinds: row.kinds, active: row.active, credit_enabled: row.credit_enabled, credit_limit: row.credit_limit, credit_days: row.credit_days, credit_blocked: row.credit_blocked,
            };
            setClients((prev) => [created, ...prev.filter((c) => c.id !== created.id)]);
            setClientSearch("");
            setSelectedClientId(row.id);
          }}
        />
      ) : null}
    </main>
  );
}

/** El texto es exactamente el código o el código de barras del producto. */
function isExactCode(product: { sku?: string | null; barcode?: string | null }, term: string) {
  const t = term.replace(/^#/, "").trim().toLowerCase();
  return Boolean(t) && ((product.sku ?? "").trim().toLowerCase() === t || (product.barcode ?? "").trim().toLowerCase() === t);
}
