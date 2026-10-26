"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Swal from "sweetalert2";
import { supabaseBrowser } from "@/lib/supabase/client";
import { AddiCustomerForm, type AddiCustomerInfo } from "@/lib/payments/AddiCustomerForm";
import { PRINT_FORMAT_KEY, PrintReceipt, PrintStyles, parsePrintFormat, type PrintFormat } from "./PrintReceipt";
import { PrintFormatPicker } from "./PrintFormatPicker";
import { OrderScreen, type HistoryRow } from "./OrderScreen";
import { downloadReceiptPdf, normalizePayment, qrDataUrl, receiptUrl, type ReceiptPayment } from "./receipt-extras";

/* =========================================================
   Helpers
========================================================= */
function money(n: number) {
  return `$${Number(n || 0).toLocaleString("es-CO")}`;
}

function statusLabel(st: string) {
  if (st === "draft") return "Borrador (editable)";
  if (st === "sent") return "Enviado (editable)";
  if (st === "confirmed") return "Confirmado (bloqueado)";
  if (st === "completed") return "Completado (bloqueado)";
  if (st === "cancelled") return "ANULADO";
  return st;
}

/* =========================================================
   Types
========================================================= */
type Item = {
  product_id: string;
  name: string;
  image_url: string | null;
  price: number;
  qty: number;
};

type StoreExtra = {
  id: string;
  name: string;
  whatsapp: string;
  logo_url: string | null;
  slug?: string | null;
};

type StoreProfileLite = {
  address: string | null;
  city: string | null;
  department: string | null;
  description: string | null;
};

type BillingInvoiceDetails = {
  business_name: string | null;
  nit: string | null;
  address: string | null;
  city: string | null;
  phone: string | null;
  email: string | null;
  invoice_prefix: string | null;
  currency: string | null;
};

type StorePaymentMethod = {
  id: string;
  name: string;
  provider: string;
  enabled: boolean;
  show_on_invoice: boolean;
};

function normalizePaymentMethods(value: unknown): StorePaymentMethod[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item): StorePaymentMethod[] => {
    if (!item || typeof item !== "object") return [];
    const method = item as Record<string, unknown>;
    return [{
      id: String(method.id ?? method.name ?? "wompi"),
      name: String(method.name ?? "Wompi"),
      provider: String(method.provider ?? ""),
      enabled: Boolean(method.enabled),
      show_on_invoice: method.show_on_invoice !== false,
    }];
  });
}

/* =========================================================
   Page
========================================================= */
export default function PedidoPage() {
  const params = useParams();
  const token = String((params as any).token);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [store, setStore] = useState<any>(null); // RPC
  const [order, setOrder] = useState<any>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [savedQuantities, setSavedQuantities] = useState<Record<string, number>>({});

  const [storeExtra, setStoreExtra] = useState<StoreExtra | null>(null);
  const [profile, setProfile] = useState<StoreProfileLite | null>(null);
  const [billingDetails, setBillingDetails] = useState<BillingInvoiceDetails | null>(null);
  const [paymentMethods, setPaymentMethods] = useState<StorePaymentMethod[] | null>(null);
  const [paymentStatus, setPaymentStatus] = useState("unpaid");
  const [paymentMethodType, setPaymentMethodType] = useState<string | null>(null);
  const [showAddiForm, setShowAddiForm] = useState(false);
  const [startingAddi, setStartingAddi] = useState(false);

  // ✅ control de impresión (sin abrir otra pestaña)
  const [printMode, setPrintMode] = useState(false);
  const [printFormat, setPrintFormat] = useState<PrintFormat>("carta");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [suggestedFormat, setSuggestedFormat] = useState<PrintFormat>("carta");
  // Documento del POS (remisión/factura con prefijo del punto), si existe.
  const [erpDoc, setErpDoc] = useState<{
    doc_number: string | null; doc_prefix?: string | null; doc_kind: "factura" | "remision" | null; seller_name: string | null; customer_doc: string | null;
    point: {
      name: string; kind?: "point" | "warehouse"; logo_url?: string | null; legal_name?: string | null; nit?: string | null;
      address: string | null; city?: string | null; phone: string | null; email?: string | null; receipt_footer?: string | null;
      resolution?: string | null; resolution_date?: string | null; resolution_from?: number | null; resolution_to?: number | null;
      resolution_valid_to?: string | null;
    } | null;
  } | null>(null);

  // Documento electrónico de la venta (si existe): emisor, número, resolución y CUFE.
  // Forma de pago del POS, otros pedidos del cliente, QR del comprobante y si quien mira es del equipo.
  const [payInfo, setPayInfo] = useState<ReceiptPayment | null>(null);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [qr, setQr] = useState<string | null>(null);
  const [isStaff, setIsStaff] = useState(false);
  useEffect(() => {
    let alive = true;
    void qrDataUrl(receiptUrl(token)).then((d) => alive && setQr(d));
    void supabaseBrowser().auth.getSession().then(({ data }) => alive && setIsStaff(Boolean(data.session)));
    return () => { alive = false; };
  }, [token]);

  const [fiscalDoc, setFiscalDoc] = useState<{
    full_number: string; document_type: string; environment: string; status: string; cufe: string | null; qr_data: string | null;
    issuer: { legal_name: string; document_type: string; document_number: string; verification_digit: string | null; fiscal_address: string | null; city: string | null; email: string | null };
    resolution: { number: string | null; date: string | null; from: number; to: number; valid_until: string | null; prefix: string };
  } | null>(null);

  /* -------------------------
     Memo
  ------------------------- */
  const total = useMemo(
    () => items.reduce((acc, i) => acc + Number(i.price) * Number(i.qty), 0),
    [items],
  );

  const isLocked = useMemo(() => {
    const st = String(order?.status ?? "draft");
    return st === "confirmed" || st === "completed" || st === "cancelled";
  }, [order]);

  const hasUnsavedChanges = useMemo(
    () =>
      items.some((item) => savedQuantities[item.product_id] !== item.qty) ||
      items.length !== Object.keys(savedQuantities).length,
    [items, savedQuantities],
  );

  const availablePaymentMethods = useMemo(
    () =>
      (paymentMethods ?? []).filter(
        (method) =>
          (method.provider === "wompi" || method.provider === "addi") &&
          method.enabled &&
          method.show_on_invoice,
      ),
    [paymentMethods],
  );

  const receiptNumber = useMemo(() => {
    return order?.receipt_no ?? order?.order_no ?? order?.number ?? order?.seq ?? null;
  }, [order]);

  // Remisión/factura del POS con su numeración por punto; si no existe, comprobante del pedido.
  const docKindLabel = fiscalDoc
    ? fiscalDoc.document_type === "pos_equivalent" ? "Documento equivalente electrónico POS"
      : fiscalDoc.document_type === "contingency_invoice" ? "Factura de venta (contingencia)" : "Factura electrónica de venta"
    : erpDoc?.doc_kind === "remision" ? "Remisión" : erpDoc?.doc_kind === "factura" ? "Factura de venta" : "Comprobante de pedido";
  const docNumberLabel = fiscalDoc?.full_number || erpDoc?.doc_number || (receiptNumber ? `#${receiptNumber}` : "—");

  const storeName = storeExtra?.name ?? store?.name ?? "Tienda";
  const point = erpDoc?.point ?? null;
  // Resolución de facturación del punto: solo se imprime en facturas.
  const resolutionText = (() => {
    if (fiscalDoc) {
      const d = (v?: string | null) => (v ? new Date(`${v}T12:00:00`).toLocaleDateString("es-CO") : "");
      const r = fiscalDoc.resolution;
      return [
        r.number ? `Resolución DIAN N.º ${r.number}${r.date ? ` del ${d(r.date)}` : ""}. Numeración autorizada del ${r.prefix}${r.from} al ${r.prefix}${r.to}${r.valid_until ? `, vigente hasta ${d(r.valid_until)}` : ""}.` : "",
        fiscalDoc.document_type === "contingency_invoice" ? "Factura expedida en contingencia (sin conexión) y transmitida a la DIAN como factura electrónica." : "",
        fiscalDoc.cufe ? `CUFE: ${fiscalDoc.cufe}` : "Documento electrónico en validación.",
        fiscalDoc.environment === "sandbox" ? "DOCUMENTO DE PRUEBAS: SIN VALIDEZ FISCAL." : "",
      ].filter(Boolean).join(" ");
    }
    if (erpDoc?.doc_kind !== "factura" || !point?.resolution) return null;
    const d = (v?: string | null) => (v ? new Date(`${v}T12:00:00`).toLocaleDateString("es-CO") : "");
    const pre = erpDoc.doc_prefix ? `${erpDoc.doc_prefix}-` : "";
    return [
      `Resolución de facturación N.º ${point.resolution}${point.resolution_date ? ` del ${d(point.resolution_date)}` : ""}.`,
      point.resolution_from || point.resolution_to
        ? `Numeración autorizada del ${pre}${point.resolution_from ?? "—"} al ${pre}${point.resolution_to ?? "—"}.`
        : "",
      point.resolution_valid_to ? `Vigente hasta ${d(point.resolution_valid_to)}.` : "",
    ].filter(Boolean).join(" ");
  })();
  const invoiceBusinessName = billingDetails?.business_name || storeName;
  const storeWhatsapp = storeExtra?.whatsapp ?? store?.whatsapp ?? "";
  const storeLogo = storeExtra?.logo_url ?? store?.logo_url ?? null;

  // ✅ Cliente / Observaciones (si no existen, muestra —)
  const customerName = useMemo(() => {
    return String(order?.customer_name ?? "").trim();
  }, [order]);

  // ⚠️ si aún no agregas customer_note en tu tabla, esto quedará siempre ""
  const customerNote = useMemo(() => {
    return String((order as any)?.customer_note ?? "").trim();
  }, [order]);

  const customerNameShow = customerName || "—";
  const customerNoteShow = customerNote || "—";

  /* -------------------------
     Load
  ------------------------- */
  async function load(): Promise<string | null> {
    setLoading(true);

    try {
      const sb = supabaseBrowser();

      // Lee productos desde la relación order_items -> products, sin depender
      // de columnas de nombre duplicadas en la tabla de ítems.
      const { data, error } = await sb.rpc("get_order_by_token_v2", {
        p_token: token,
      });
      if (error) throw error;

      const storeRpc = data?.store ?? null;
      const orderRpc = data?.order ?? null;
      const loadedStatus = String(orderRpc?.status ?? "draft");

      setStore(storeRpc);
      setOrder(orderRpc);
      void sb.rpc("erp_order_doc_by_token", { p_token: token }).then(({ data: doc, error: docError }) => {
        if (!docError) setErpDoc((doc as typeof erpDoc) ?? null);
      });
      void sb.rpc("fiscal_public_receipt", { p_token: token }).then(({ data: fdoc, error: fError }) => {
        if (!fError) setFiscalDoc((fdoc as typeof fiscalDoc) ?? null);
      });
      // Si faltan las migraciones 20261115/20261116, simplemente no se muestran.
      void sb.rpc("erp_order_payment_by_token", { p_token: token }).then(({ data: pay, error: payError }) => {
        if (!payError) setPayInfo(normalizePayment(pay));
      });
      void sb.rpc("erp_customer_orders_by_token", { p_token: token }).then(({ data: hist, error: histError }) => {
        if (!histError) setHistory(((hist as { rows?: HistoryRow[] } | null)?.rows ?? []) as HistoryRow[]);
      });

      const loadedItems: Item[] = (data?.items ?? []).map((i: any) => ({
          product_id: i.product_id,
          name: i.name,
          image_url: i.image_url ?? null,
          price: Number(i.price),
          qty: Number(i.qty),
        }));
      setItems(loadedItems);
      setSavedQuantities(
        Object.fromEntries(loadedItems.map((item) => [item.product_id, item.qty])),
      );

      const { data: paymentData, error: paymentErr } = await sb.rpc(
        "get_wompi_payment_status",
        { p_token: token },
      );
      if (paymentErr) throw paymentErr;
      const wompiPaymentStatus = String(paymentData?.payment_status ?? "unpaid");
      setPaymentStatus(wompiPaymentStatus);
      setPaymentMethodType(paymentData?.payment_method_type ?? null);

      // 2) storeId seguro
      const storeId = orderRpc?.store_id ?? storeRpc?.id ?? null;
      if (!storeId) throw new Error("No se encontró store_id del pedido.");

      // 3) tienda extra
      const { data: stData, error: stErr } = await sb
        .from("stores")
        .select("id,name,whatsapp,logo_url,slug")
        .eq("id", storeId)
        .maybeSingle();

      if (stErr) throw stErr;
      if (!stData) throw new Error("No se encontró la tienda.");
      setStoreExtra(stData as StoreExtra);

      // 4) perfil tienda
      const { data: profData, error: profErr } = await sb
        .from("store_profiles")
        .select("address,city,department,description")
        .eq("store_id", storeId)
        .maybeSingle();
 
      if (profErr) throw profErr;
      setProfile((profData as StoreProfileLite) ?? null);

      let businessData: BillingInvoiceDetails | null = null;
      for (const tableName of ["billing_settings", "store_billing_settings"]) {
        const res = await sb
          .from(tableName)
          .select("business_name,nit,address,city,phone,email,invoice_prefix,currency")
          .eq("store_id", storeId)
          .maybeSingle();
        if (!res.error && res.data) {
          businessData = res.data as BillingInvoiceDetails;
          break;
        }
      }
      setBillingDetails(businessData);

      // Only public method metadata is readable here; provider credentials are stored separately.
      const { data: payData, error: payErr } = await sb
        .from("store_payment_methods")
        .select("id,provider,name,enabled,show_on_invoice")
        .eq("store_id", storeId)
        .eq("show_on_invoice", true)
        .order("sort_order", { ascending: true });
      if (payErr) {
        const errorText = `${payErr.message} ${payErr.details ?? ""}`.toLowerCase();
        const paymentMethodsTableMissing =
          payErr.code === "PGRST205" ||
          (errorText.includes("store_payment_methods") &&
            (errorText.includes("schema cache") || errorText.includes("does not exist")));

        if (!paymentMethodsTableMissing) throw payErr;

        console.warn(
          "No está instalada store_payment_methods; se muestra el pedido sin opciones de pago.",
        );
        setPaymentMethods([]);
      } else {
        const normalizedMethods = normalizePaymentMethods(payData);
        setPaymentMethods(normalizedMethods);
        if (normalizedMethods.some((method) => method.provider === "addi" && method.enabled)) {
          try {
            const response = await fetch(`/api/payments/addi/status?token=${encodeURIComponent(token)}`, {
              cache: "no-store",
            });
            const addiStatus = await response.json();
            if (!response.ok) throw new Error(addiStatus.error ?? "No se pudo consultar el pago Addi.");
            if (addiStatus.payment_status === "paid") {
              setPaymentStatus("paid");
              setPaymentMethodType("Addi");
            } else if (addiStatus.payment_status === "pending" && wompiPaymentStatus !== "paid") {
              setPaymentStatus("pending");
              setPaymentMethodType("Addi");
            } else if (addiStatus.payment_status === "failed" && wompiPaymentStatus === "unpaid") {
              setPaymentStatus("failed");
              setPaymentMethodType("Addi");
            }
          } catch (error: unknown) {
            console.error("No se pudo consultar el estado del pago Addi:", error);
          }
        }
      }
      return loadedStatus;
    } catch (err: any) {
      const errorMessage = String(err?.message ?? "Error");
      const displayMessage = errorMessage.includes("get_order_by_token_v2")
        ? "No está instalada la función get_order_by_token_v2 en Supabase. Instala la función de consulta de pedidos usada por esta aplicación."
        : errorMessage;
      await Swal.fire({
        icon: "error",
        title: "Pedido no encontrado",
        text: displayMessage,
        background: "color-mix(in oklab, var(--t-card-bg) 92%, black)",
        color: "var(--t-text)",
        confirmButtonColor: "var(--t-danger, #ef4444)",
      });
      return null;
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function handlePayment(pm: StorePaymentMethod) {
    if (!order) return;

    try {
      if (pm.provider === "addi") {
        if (order.status !== "confirmed" && order.status !== "completed") {
          throw new Error("Confirma el pedido antes de iniciar el pago.");
        }
        if (paymentStatus === "paid") throw new Error("Este pedido ya tiene un pago aprobado.");
        setShowAddiForm(true);
        return;
      }
      if (pm?.provider !== "wompi") {
        throw new Error("Esta forma de pago todavía no tiene una pasarela en línea configurada.");
      }
      if (order.status !== "confirmed" && order.status !== "completed") {
        throw new Error("Confirma el pedido antes de iniciar el pago.");
      }
      if (paymentStatus === "paid") {
        throw new Error("Este pedido ya tiene un pago aprobado.");
      }

      const sb = supabaseBrowser();
      const { data, error } = await sb.rpc("create_wompi_checkout", {
        p_token: token,
      });
      if (error) throw error;

      const checkout = Array.isArray(data) ? data[0] : data;
      if (
        !checkout?.public_key ||
        !checkout?.reference ||
        !checkout?.amount_in_cents ||
        !checkout?.signature
      ) {
        throw new Error("Wompi no devolvió los datos completos para iniciar el pago.");
      }

      const checkoutUrl = new URL("https://checkout.wompi.co/p/");
      checkoutUrl.searchParams.set("public-key", checkout.public_key);
      checkoutUrl.searchParams.set("currency", checkout.currency ?? "COP");
      checkoutUrl.searchParams.set("amount-in-cents", String(checkout.amount_in_cents));
      checkoutUrl.searchParams.set("reference", checkout.reference);
      checkoutUrl.searchParams.set("signature:integrity", checkout.signature);
      checkoutUrl.searchParams.set("redirect-url", window.location.href);
      if (customerName) {
        checkoutUrl.searchParams.set("customer-data:full-name", customerName);
      }

      setPaymentStatus("pending");
      window.location.assign(checkoutUrl.toString());
    } catch (err: any) {
      const code = String(err?.message ?? err);
      const friendlyMessage: Record<string, string> = {
        WOMPI_NOT_CONFIGURED: "La tienda todavía no ha configurado sus credenciales de Wompi.",
        WOMPI_DISABLED: "La tienda no tiene Wompi habilitado para este pedido.",
        WOMPI_KEY_ENVIRONMENT_MISMATCH: "La llave pública de Wompi no coincide con el ambiente configurado.",
        ORDER_NOT_CONFIRMED: "La tienda debe confirmar el pedido antes de iniciar el pago.",
        ORDER_ALREADY_PAID: "Este pedido ya fue pagado.",
        INVALID_ORDER_AMOUNT: "El total del pedido no permite iniciar un pago.",
      };
      await Swal.fire({
        icon: "error",
        title: "No se pudo iniciar el pago",
        text: friendlyMessage[code] ?? code,
        background: "color-mix(in oklab, var(--t-card-bg) 92%, black)",
        color: "var(--t-text)",
        confirmButtonColor: "var(--t-danger, #ef4444)",
      });
    }

  }

  async function handleAddiPayment(customer: AddiCustomerInfo) {
    if (!order || startingAddi) return;
    setStartingAddi(true);

    try {
      const response = await fetch("/api/payments/addi/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order_token: token, customer }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "No se pudo iniciar el pago con Addi.");
      if (typeof result.checkout_url !== "string") {
        throw new Error("Addi no devolvió el enlace seguro para continuar con el pago.");
      }

      setPaymentStatus("pending");
      setPaymentMethodType("Addi");
      window.location.assign(result.checkout_url);
    } catch (error: unknown) {
      await Swal.fire({
        icon: "error",
        title: "No se pudo iniciar el pago con Addi",
        text: String((error as Error)?.message ?? error),
        background: "color-mix(in oklab, var(--t-card-bg) 92%, black)",
        color: "var(--t-text)",
        confirmButtonColor: "var(--t-danger, #ef4444)",
      });
    } finally {
      setStartingAddi(false);
    }
  }

  useEffect(() => {
    if (paymentStatus !== "pending") return;

    const timer = window.setInterval(async () => {
      try {
        const { data, error } = await supabaseBrowser().rpc("get_wompi_payment_status", {
          p_token: token,
        });
        if (error) throw error;

        let nextStatus = String(data?.payment_status ?? "unpaid");
        let nextMethodType = data?.payment_method_type ?? null;
        if (paymentMethods?.some((method) => method.provider === "addi" && method.enabled)) {
          const response = await fetch(`/api/payments/addi/status?token=${encodeURIComponent(token)}`, {
            cache: "no-store",
          });
          const addiStatus = await response.json();
          if (!response.ok) throw new Error(addiStatus.error ?? "No se pudo actualizar el estado de Addi.");

          if (addiStatus.payment_status === "paid") {
            nextStatus = "paid";
            nextMethodType = "Addi";
          } else if (addiStatus.payment_status === "pending" && nextStatus !== "paid") {
            nextStatus = "pending";
            nextMethodType = "Addi";
          } else if (addiStatus.payment_status === "failed" && nextStatus === "unpaid") {
            nextStatus = "failed";
            nextMethodType = "Addi";
          }
        }

        setPaymentStatus(nextStatus);
        setPaymentMethodType(nextMethodType);
      } catch (error: unknown) {
        console.error("No se pudo actualizar el estado del pago:", error);
      }
    }, 5000);

    return () => window.clearInterval(timer);
  }, [paymentMethods, paymentStatus, token]);
  /* -------------------------
     Print on demand (MISMA pestaña)
  ------------------------- */
  useEffect(() => {
    if (!printMode) return;

    const prevTitle = document.title;
    document.title = `${docKindLabel}-${erpDoc?.doc_number ?? receiptNumber ?? token}`;

    const t = window.setTimeout(() => {
      try {
        window.print();
      } finally {
        // afterprint
      }
    }, 200);

    const onAfterPrint = () => {
      window.clearTimeout(t);
      setPrintMode(false);
      document.title = prevTitle;
    };

    window.addEventListener("afterprint", onAfterPrint);

    const fallback = window.setTimeout(() => {
      setPrintMode(false);
      document.title = prevTitle;
    }, 2500);

    return () => {
      window.removeEventListener("afterprint", onAfterPrint);
      window.clearTimeout(t);
      window.clearTimeout(fallback);
      document.title = prevTitle;
    };
  }, [printMode, receiptNumber, token, docKindLabel, erpDoc]);

  function printNow() {
    // Formato sugerido: el que pidió el POS (?formato=) o el último usado en este equipo.
    let saved: PrintFormat | null = null;
    try {
      saved = parsePrintFormat(localStorage.getItem(PRINT_FORMAT_KEY));
    } catch {
      saved = null;
    }
    setSuggestedFormat(parsePrintFormat(new URLSearchParams(window.location.search).get("formato")) ?? saved ?? "carta");
    setPickerOpen(true);
  }

  function confirmPrint(format: PrintFormat) {
    try {
      localStorage.setItem(PRINT_FORMAT_KEY, format);
    } catch {
      /* recordar el formato es solo una comodidad */
    }
    setPickerOpen(false);
    setPrintFormat(format);
    setPrintMode(true);
  }

  /* -------------------------
     Actions
  ------------------------- */
  function setQty(productId: string, qty: number) {
    if (isLocked) return;
    const q = Math.max(1, Math.floor(Number(qty || 1)));
    setItems((prev) => prev.map((x) => (x.product_id === productId ? { ...x, qty: q } : x)));
  }

  async function saveChanges() {
    if (isLocked) {
      await Swal.fire({
        icon: "info",
        title: "Pedido bloqueado",
        text: "Este pedido ya fue confirmado y no se puede editar.",
        background: "color-mix(in oklab, var(--t-card-bg) 92%, black)",
        color: "var(--t-text)",
      });
      return;
    }

    setSaving(true);

    try {
      const sb = supabaseBrowser();

      const payload = items.map((i) => ({
        product_id: i.product_id,
        qty: i.qty,
      }));

      const { error } = await sb.rpc("update_order_items_by_token_v2", {
        p_token: token,
        p_items: payload,
      });

      if (error) throw error;

      const loadedStatus = await load();
      if (!loadedStatus) {
        throw new Error("No pudimos verificar los cambios guardados. Recarga el pedido antes de continuar.");
      }

      await Swal.fire({
        icon: "success",
        title: "Actualizado",
        text: "Tu pedido se guardó correctamente.",
        timer: 1200,
        showConfirmButton: false,
        background: "color-mix(in oklab, var(--t-card-bg) 92%, black)",
        color: "var(--t-text)",
      });

    } catch (err: unknown) {
      const msg = String((err as Error)?.message ?? err);
      const normalized = msg.toLowerCase();

      if (normalized.includes("order_locked") || normalized.includes("pedido confirmado")) {
        await Swal.fire({
          icon: "info",
          title: "Pedido confirmado",
          text: "Este pedido ya fue confirmado y no se puede editar.",
          background: "color-mix(in oklab, var(--t-card-bg) 92%, black)",
          color: "var(--t-text)",
          confirmButtonColor: "var(--t-success, #22c55e)",
        });
        await load();
        return;
      }

      await load();
      await Swal.fire({
        icon: "error",
        title: "No se pudo guardar",
        text: msg || "No se pudo guardar el pedido. Inténtalo de nuevo.",
        background: "color-mix(in oklab, var(--t-card-bg) 92%, black)",
        color: "var(--t-text)",
        confirmButtonColor: "var(--t-danger, #ef4444)",
      });
    } finally {
      setSaving(false);
    }
  }

  async function confirmOrder() {
    if (isLocked) return;
    if (hasUnsavedChanges) {
      await Swal.fire({
        icon: "info",
        title: "Guarda los cambios primero",
        text: "Pulsa «Guardar cambios» y confirma el pedido después de que se hayan guardado las cantidades.",
        background: "color-mix(in oklab, var(--t-card-bg) 92%, black)",
        color: "var(--t-text)",
      });
      return;
    }

    const res = await Swal.fire({
      icon: "warning",
      title: "Confirmar pedido",
      text: "Una vez confirmado, ya no podrás editarlo.",
      showCancelButton: true,
      confirmButtonText: "Sí, confirmar",
      cancelButtonText: "Cancelar",
      background: "color-mix(in oklab, var(--t-card-bg) 92%, black)",
      color: "var(--t-text)",
      confirmButtonColor: "var(--t-success, #22c55e)",
    });

    if (!res.isConfirmed) return;

    setSaving(true);

    try {
      const sb = supabaseBrowser();

      const { error } = await sb.rpc("confirm_order_v2", { p_token: token });
      if (error) throw error;

      const loadedStatus = await load();
      if (loadedStatus !== "confirmed" && loadedStatus !== "completed") {
        throw new Error("Supabase respondió sin cambiar el pedido a confirmado. Verifica que se haya instalado supabase/configuracion-pedidos-pagos.sql e inténtalo de nuevo.");
      }

      await Swal.fire({
        icon: "success",
        title: "Pedido confirmado",
        text: "Ya quedó registrado y no se puede editar.",
        timer: 1400,
        showConfirmButton: false,
        background: "color-mix(in oklab, var(--t-card-bg) 92%, black)",
        color: "var(--t-text)",
      });
    } catch (err: unknown) {
      await Swal.fire({
        icon: "error",
        title: "No se pudo confirmar",
        text: String((err as Error)?.message ?? err),
        background: "color-mix(in oklab, var(--t-card-bg) 92%, black)",
        color: "var(--t-text)",
        confirmButtonColor: "var(--t-danger, #ef4444)",
      });
    } finally {
      setSaving(false);
    }
  }

  async function downloadPdf() {
    if (!order) return;
    try {
      await downloadReceiptPdf({
        fileName: `${docKindLabel.replace(/\s+/g, "-")}-${docNumberLabel.replace(/[^\w-]+/g, "")}.pdf`,
        businessName: fiscalDoc ? fiscalDoc.issuer.legal_name : point ? point.legal_name || point.name : invoiceBusinessName,
        businessLines: [
          point && point.legal_name && point.legal_name !== point.name ? point.name : "",
          fiscalDoc ? `NIT ${fiscalDoc.issuer.document_number}${fiscalDoc.issuer.verification_digit ? `-${fiscalDoc.issuer.verification_digit}` : ""}` : point?.nit ? `NIT ${point.nit}` : billingDetails?.nit ? `NIT ${billingDetails.nit}` : "",
          (point ? [point.address, point.city] : [billingDetails?.address, billingDetails?.city]).filter(Boolean).join(" · "),
          [point?.phone || storeWhatsapp, point?.email || billingDetails?.email].filter(Boolean).join(" · "),
        ],
        docTitle: docKindLabel,
        docNumber: docNumberLabel,
        date: new Date(order.created_at).toLocaleString("es-CO"),
        customer: customerNameShow,
        customerDoc: erpDoc?.customer_doc ?? null,
        seller: erpDoc?.seller_name ?? null,
        note: customerNote || null,
        items: items.map((i) => ({ name: i.name, qty: Number(i.qty), price: Number(i.price) })),
        total,
        payment: payInfo,
        resolution: resolutionText,
        footer: point?.receipt_footer || profile?.description || "Gracias por tu compra. Para cualquier información adicional, contáctanos por WhatsApp.",
        qr,
        cancelled: order.status === "cancelled",
        electronic: Boolean(fiscalDoc),
        money,
      });
    } catch (err: unknown) {
      await Swal.fire({ icon: "error", title: "No se pudo crear el PDF", text: String((err as Error)?.message ?? err), background: "color-mix(in oklab, var(--t-card-bg) 92%, black)", color: "var(--t-text)" });
    }
  }

  function sendWhatsApp() {
    if (!storeWhatsapp || !order) return;

    const lines: string[] = [];
    lines.push(`Hola, soy *${customerNameShow}* 👋`);
    lines.push(`${docKindLabel} ${docNumberLabel}:`);
    lines.push("");
    lines.push(`🏪 Tienda: *${storeName}*`);
    lines.push(`🧾 ${docKindLabel}: *${docNumberLabel}*`);
    lines.push(`Estado: ${statusLabel(order.status)}`);
    lines.push(`📝 Observaciones: ${customerNoteShow}`);
    lines.push("");

    items.forEach((i, idx) => {
      lines.push(
        `${idx + 1}. ${i.name} — Cant: ${i.qty} — ${money(i.price)} c/u — Subtotal: ${money(i.price * i.qty)}`,
      );
    });

    lines.push("");
    lines.push(`💰 TOTAL: *${money(total)}*`);
    lines.push("");
    lines.push(`Link del comprobante: ${window.location.href}`);

    window.open(`https://wa.me/${storeWhatsapp}?text=${encodeURIComponent(lines.join("\n"))}`, "_blank");
  }

  /* -------------------------
     Render states
  ------------------------- */
  if (loading) {
    return (
      <main className="min-h-screen p-6">
        <div
          className="glass mx-auto max-w-3xl p-6"
          style={{
            borderColor: "var(--t-card-border)",
            background: "var(--t-card-bg)",
            color: "var(--t-text)",
          }}
        >
          <p className="text-sm" style={{ color: "var(--t-muted)" }}>
            Cargando comprobante...
          </p>
        </div>
      </main>
    );
  }

  if (!order) {
    return (
      <main className="min-h-screen p-6">
        <div
          className="glass mx-auto max-w-3xl p-6"
          style={{
            borderColor: "var(--t-card-border)",
            background: "var(--t-card-bg)",
            color: "var(--t-text)",
          }}
        >
          <p className="text-sm" style={{ color: "var(--t-muted)" }}>
            No se pudo cargar el pedido.
          </p>
        </div>
      </main>
    );
  }

  /* =========================================================
     UI
  ========================================================= */
  return (
    <main className="receipt-host relative min-h-screen px-3 py-6 text-[color:var(--t-text)] sm:px-4 sm:py-10 print:bg-white print:text-black">
      {/* Fondo premium (auto claro/oscuro con tokens) */}
      <div className="no-print pointer-events-none fixed inset-0 -z-10">
        <div className="absolute inset-0" style={{ background: "var(--t-bg-base)" }} />
        <div className="absolute inset-0" style={{ backgroundImage: "var(--t-bg)" }} />
        <div className="absolute inset-0 starfield opacity-[0.55]" />
        <div
          className="absolute inset-x-0 top-0 h-44"
          style={{
            background:
              "linear-gradient(to bottom, color-mix(in oklab, var(--t-bg-base) 0%, black 25%), transparent)",
          }}
        />
      </div>

      {/* Impresión: hoja carta o tirilla POS (80 / 58 mm) */}
      <PrintStyles format={printFormat} />
      <PrintFormatPicker open={pickerOpen} initial={suggestedFormat} onCancel={() => setPickerOpen(false)} onConfirm={confirmPrint} />
      <PrintReceipt
        format={printFormat}
        logo={point?.logo_url || storeLogo}
        businessName={fiscalDoc ? fiscalDoc.issuer.legal_name : point ? point.legal_name || point.name : invoiceBusinessName}
        nit={fiscalDoc ? `${fiscalDoc.issuer.document_number}${fiscalDoc.issuer.verification_digit ? `-${fiscalDoc.issuer.verification_digit}` : ""}` : point?.nit || billingDetails?.nit}
        address={
          (point ? [point.address, point.city] : [billingDetails?.address, billingDetails?.city]).filter(Boolean).join(" · ") || null
        }
        email={point?.email || billingDetails?.email}
        whatsapp={point?.phone || storeWhatsapp}
        docTitle={order?.status === "cancelled" ? `${docKindLabel} · ANULADO` : docKindLabel}
        docNumber={fiscalDoc?.full_number || erpDoc?.doc_number || `${billingDetails?.invoice_prefix || "FAC"}-${receiptNumber ?? "—"}`}
        pointName={point && point.legal_name && point.legal_name !== point.name ? point.name : null}
        pointAddress={null}
        sellerName={erpDoc?.seller_name ?? null}
        customerDoc={erpDoc?.customer_doc ?? null}
        resolution={resolutionText}
        date={new Date(order.created_at).toLocaleString("es-CO")}
        customer={customerNameShow}
        note={customerNoteShow}
        items={items.map((i) => ({ product_id: i.product_id, name: i.name, qty: Number(i.qty), price: Number(i.price), image_url: i.image_url }))}
        total={total}
        money={money}
        footer={point?.receipt_footer || profile?.description || "Gracias por tu compra. Para cualquier información adicional, contáctanos por WhatsApp."}
        qr={qr}
        payment={payInfo}
      />

      {/* Comprobante en pantalla (la impresión usa PrintReceipt). */}
      <div className={printMode ? "hidden" : "no-print"}>
        <OrderScreen
          status={String(order.status ?? "draft")}
          docKindLabel={docKindLabel}
          docNumber={docNumberLabel}
          orderNumber={erpDoc?.doc_number || fiscalDoc ? receiptNumber : null}
          businessName={point ? point.legal_name || point.name : storeName}
          businessLine={[
            point && point.legal_name && point.legal_name !== point.name ? point.name : null,
            point?.nit ? `NIT ${point.nit}` : billingDetails?.nit ? `NIT ${billingDetails.nit}` : null,
            point ? [point.address, point.city].filter(Boolean).join(", ") || null : [profile?.address, profile?.city].filter(Boolean).join(", ") || null,
          ].filter(Boolean).join(" · ")}
          logo={point?.logo_url || storeLogo}
          customerName={customerName}
          customerDoc={erpDoc?.customer_doc ?? null}
          customerNote={customerNote}
          pointName={point?.name ?? null}
          sellerName={erpDoc?.seller_name ?? null}
          createdAt={new Date(order.created_at).toLocaleString("es-CO", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
          catalogLabel={order.catalog_type === "retail" ? "🛍️ Detal" : "📦 Mayoristas"}
          items={items}
          total={total}
          money={money}
          locked={isLocked}
          saving={saving}
          dirty={hasUnsavedChanges}
          canWhatsApp={Boolean(storeWhatsapp)}
          paymentStatus={paymentStatus}
          paymentMethodType={paymentMethodType}
          paymentMethods={availablePaymentMethods}
          startingAddi={startingAddi}
          onQty={setQty}
          onSave={() => void saveChanges()}
          onConfirm={() => void confirmOrder()}
          onWhatsApp={sendWhatsApp}
          onPrint={printNow}
          onPay={(m) => void handlePayment(m as StorePaymentMethod)}
          payment={payInfo}
          qr={qr}
          history={history}
          onPdf={downloadPdf}
          reorderCatalog={storeExtra?.slug && order.catalog_type === "retail" && order.status !== "cancelled" ? `/${storeExtra.slug}/detal?reorder=${encodeURIComponent(token)}` : null}
          reorderPos={isStaff ? `/dashboard/pos?reorder=${encodeURIComponent(token)}` : null}
        />
      </div>
      {showAddiForm ? (
        <AddiCustomerForm
          busy={startingAddi}
          initialPhone={String(order?.customer_whatsapp ?? "")}
          onClose={() => setShowAddiForm(false)}
          onSubmit={(customer) => void handleAddiPayment(customer)}
        />
      ) : null}
    </main>
  );
}
