"use client";

import { WithDv, docWithDv } from "@/app/dashboard/nit";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Swal from "sweetalert2";
import { supabaseBrowser } from "@/lib/supabase/client";
import { getDashboardStore, type DashboardStore } from "@/lib/store-utils";
import { getStoreDataSchemaErrorMessage } from "@/lib/store-schema-errors";
import { PosDocuments, type PosDocument } from "./PosDocuments";

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
};

type Client = {
  id: string;
  name: string;
  email: string | null;
  mobile: string | null;
  document_number: string | null;
  price_list: number;
};

type CartItem = {
  productId: string;
  name: string;
  qty: number;
  price: number;
  priceLevel: PriceLevel;
  note: string;
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

type PointOption = { id: string; name: string; invoice_prefix: string; remision_prefix: string; next_invoice_number: number; next_remision_number: number };
type SellerOption = { user_id: string; name: string; role: string };

export default function PosPage() {
  const [store, setStore] = useState<DashboardStore | null>(null);
  const [allProducts, setProducts] = useState<Product[]>([]);
  const [visibleCount, setVisibleCount] = useState(48);
  const [savingClient, setSavingClient] = useState(false);
  const [listOverride, setListOverride] = useState<number | null>(null);
  const [pointStock, setPointStock] = useState<Map<string, number> | null>(null);
  // Solo se ofrecen los productos con existencias en el punto elegido.
  const products = useMemo(() => {
    if (!pointStock) return allProducts;
    return allProducts
      .filter((p) => (pointStock.get(p.id) ?? 0) > 0)
      .map((p) => ({ ...p, stock: pointStock.get(p.id) ?? 0 }));
  }, [allProducts, pointStock]);
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
  const [pointId, setPointId] = useState("");
  const [lockedPoint, setLockedPoint] = useState(false);
  const [sellerId, setSellerId] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [editingDoc, setEditingDoc] = useState<PosDocument | null>(null);
  const [docsRefresh, setDocsRefresh] = useState(0);

  const filteredProducts = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return products;
    // Al buscar también se muestran los productos sin existencias en este punto (deshabilitados).
    const base = pointStock
      ? allProducts.map((p) => ({ ...p, stock: pointStock.get(p.id) ?? 0 }))
      : products;
    return base.filter((product) => product.name.toLowerCase().includes(term));
  }, [products, allProducts, pointStock, search]);

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
      if (
        [client.name, client.document_number ?? "", client.mobile ?? "", client.email ?? ""]
          .join(" ")
          .toLowerCase()
          .includes(term)
      )
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

  const total = useMemo(
   () => cart.reduce((sum, item) => sum + item.price * item.qty, 0),
   [cart],
  );

  useEffect(() => {
    load();
  }, []);

  const storeId = store?.id;
  useEffect(() => {
    if (!storeId || !pointId) return;
    let alive = true;
    (async () => {
      const sb = supabaseBrowser();
      const map = new Map<string, number>();
      for (let from = 0; ; from += 1000) {
        const { data, error } = await sb
          .from("erp_stock_levels")
          .select("product_id,qty")
          .eq("store_id", storeId)
          .eq("warehouse_id", pointId)
          .gt("qty", 0)
          .order("product_id")
          .range(from, from + 999);
        if (error || !data) return; // sin ERP aplicado se muestra el catálogo completo
        for (const row of data as { product_id: string; qty: number }[]) map.set(row.product_id, row.qty);
        if (data.length < 1000) break;
      }
      if (alive) setPointStock(map);
    })();
    return () => {
      alive = false;
    };
  }, [storeId, pointId]);

  useEffect(() => {
    setListOverride(null);
    if (selectedClient) {
      setCustomerName(selectedClient.name);
      setCustomerEmail(selectedClient.email ?? "");
      setCustomerWhatsApp(selectedClient.mobile ?? "");
      setCustomerDocument(selectedClient.document_number ?? "");
      setCustomerPriceList(selectedClient.price_list ?? DEFAULT_PRICE_LIST);
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
        if (!product) return item;
        const price = getProductPrice(product, currentPriceList);
        return { ...item, price, priceLevel: currentPriceList as PriceLevel };
      }),
    );
  }, [currentPriceList, productMap]);

  async function loadErp(storeId: string) {
    const sb = supabaseBrowser();
    const [pointsRes, sellersRes, userRes] = await Promise.all([
      sb
        .from("erp_warehouses")
        .select("id,name,invoice_prefix,remision_prefix,next_invoice_number,next_remision_number")
        .eq("store_id", storeId)
        .eq("kind", "point")
        .eq("active", true)
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
    setPointId((current) => current || visiblePoints[0]?.id || "");
    const me = userRes.data.user?.id;
    setSellerId((current) => current || sellerRows.find((r) => r.user_id === me)?.user_id || sellerRows[0]?.user_id || "");
  }

  async function load() {
    setLoading(true);
    try {
      const access = await getDashboardStore();
      if (!access.store) {
        throw new Error("No tienes acceso a ninguna tienda.");
      }
      setStore(access.store);
      const sb = supabaseBrowser();

      const productPages: Product[] = [];
      let productError: unknown = null;
      for (let from = 0; ; from += 1000) {
        const { data, error } = await sb
          .from("products")
          .select("id,name,price_1,price_2,price_3,price_4,price_5,min_wholesale,stock,image_url,active")
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
        sb
          .from("billing_customers")
          .select("id,name,email,mobile,document_number,price_list")
          .eq("store_id", access.store.id)
          .order("name", { ascending: true }),
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
    if (/^[\d.\-\s]+$/.test(term)) setCustomerDocument(term);
    else setCustomerName(term.toUpperCase());
    setSelectedClientId("");
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
        item.productId === productId ? { ...item, price: getProductPrice(product, level), priceLevel: level } : item,
      ),
    );
  }

  function adjustQty(productId: string, delta: number) {
    setCart((prev) => {
      const next = [...prev];
      const idx = next.findIndex((item) => item.productId === productId);
      if (idx === -1) return prev;
      const item = next[idx];
      const qty = Math.max(1, item.qty + delta);
      next[idx] = { ...item, qty };
      return next;
    });
  }

  function removeItem(productId: string) {
    setCart((prev) => prev.filter((item) => item.productId !== productId));
  }

  function addProduct(product: Product) {
    setCart((prev) => {
      const existing = prev.find((item) => item.productId === product.id);
      const price = getProductPrice(product, currentPriceList);
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
      })),
    );
    setEditingDoc(doc);
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

  function cancelEdit() {
    setEditingDoc(null);
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
        text: String((err as Error)?.message ?? err),
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

    if (editingDoc) return saveEdit(editingDoc);

    setSaving(true);
    let receiptWindow: Window | null = null;

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
 
      let docNumber = "";
      if (pointId || sellerId) {
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

      // El comprobante sugiere al imprimir el tamaño elegido en el POS.
      const invoiceUrl = `${window.location.origin}/pedido/${token}?formato=${printSize === "carta" ? "carta" : "t80"}`;
      if (receiptWindow && !receiptWindow.closed) receiptWindow.location.href = invoiceUrl;
      else window.open(invoiceUrl, "_blank");
      setDocsRefresh((n) => n + 1);
 
      if (requestElectronicInvoice && documentKind === "factura" && siigoConfigured) {
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
        html: `${kindLabel} generada con éxito.${docNumber ? `<br/><b>N.º:</b> ${docNumber}` : ""}${sellerId ? `<br/><b>Vendedor:</b> ${sellers.find((r) => r.user_id === sellerId)?.name ?? ""}` : ""}${siigoTrackingWarning ? `<br/><small>${siigoTrackingWarning}</small>` : ""}<br/><b>Cliente:</b> ${customerName}<br/><b>Total:</b> ${money(total)}`,
        background: "#0b0b0b",
        color: "#fff",
        confirmButtonText: "Ver comprobante",
        confirmButtonColor: "#22c55e",
      });

      setCart([]);
      setCustomerNote("");
      setSelectedClientId("");
    } catch (err: unknown) {
      if (receiptWindow && !receiptWindow.closed) receiptWindow.close();
      await Swal.fire({
        icon: "error",
        title: documentKind === "factura" ? "No se pudo crear la factura" : "No se pudo crear la remisión",
        text: String((err as Error)?.message ?? err),
        background: "#0b0b0b",
        color: "#fff",
        confirmButtonColor: "#ef4444",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="space-y-3">
      <div {...cardProps()}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold">💳 POS / Facturación</h1>
            <p className="text-xs" style={{ color: "var(--t-muted)" }}>
              {store?.name ? `${store.name} · ` : ""}{products.length} producto{products.length === 1 ? "" : "s"} · {clients.length} cliente{clients.length === 1 ? "" : "s"}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
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

      <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1.5fr)_minmax(320px,1fr)]">
        <div className="space-y-3">
          <div {...cardProps()}>
            <input
              {...inputProps()}
              placeholder="🔍 Buscar producto por nombre…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setVisibleCount(48);
              }}
            />

            {loading ? (
              <p className="mt-6 text-sm" style={{ color: "var(--t-muted)" }}>
                Cargando productos...
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
                        onClick={() => addProduct(product)}
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
                            {money(getProductPrice(product, currentPriceList))}
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

          <div {...cardProps()}>
            <details>
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2">
              <span>
                <span className="text-base font-semibold">2. Cliente y documento</span>
                <span className="block text-xs" style={{ color: "var(--t-muted)" }}>
                  {effectiveClient.name} · {documentKind === "factura" ? "Factura" : "Remisión"} · {paymentType === "credito" ? "Crédito" : "Contado"}
                </span>
              </span>
              <span className="rounded-full border px-3 py-1 text-xs font-semibold" style={{ borderColor: "var(--t-card-border)" }}>Editar ▾</span>
            </summary>

            <div className="mt-3 space-y-3">
              <div>
                <label className="text-sm font-semibold">Buscar cliente</label>
                <input
                  {...inputProps()}
                  value={clientSearch}
                  onChange={(e) => setClientSearch(e.target.value)}
                  placeholder="Buscar por nombre, documento o teléfono"
                />
                {clientSearch.trim() && filteredClients.length === 0 ? (
                  <div
                    className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-dashed p-3 text-sm"
                    style={{ borderColor: "var(--t-accent)" }}
                  >
                    <span>No encontramos al tercero buscado. ¿Deseas crearlo?</span>
                    <button
                      type="button"
                      onClick={prefillNewClient}
                      className="rounded-full px-3 py-1.5 text-xs font-semibold"
                      style={{ background: "var(--t-cta)", color: "var(--t-cta-text, #0b0b0b)" }}
                    >
                      ➕ Crear tercero
                    </button>
                  </div>
                ) : null}
              </div>

              <div>
                <label className="text-sm font-semibold">
                  Cliente guardado
                </label>
                <select
                  {...inputProps()}
                  value={selectedClientId}
                  onChange={(e) => setSelectedClientId(e.target.value)}
                >
                  <option value="">Selecciona un cliente</option>
                  {filteredClients.map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.name}
                    </option>
                  ))}
                </select>
                <p
                  className="mt-2 text-sm"
                  style={{ color: "var(--t-muted)" }}
                >
                  Cliente activo: {effectiveClient.name} · Doc: {effectiveClient.document_number ? docWithDv(effectiveClient.document_number) : "CF"} · Lista {effectiveClient.price_list}
                </p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="text-sm font-semibold">Punto de venta</label>
                    <select {...inputProps()} value={pointId} onChange={(e) => setPointId(e.target.value)} disabled={lockedPoint}>
                      {lockedPoint ? null : <option value="">Sin punto asignado</option>}
                      {points.map((pt) => (
                        <option key={pt.id} value={pt.id}>{pt.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-sm font-semibold">Vendedor</label>
                    <select {...inputProps()} value={sellerId} onChange={(e) => setSellerId(e.target.value)}>
                      <option value="">Sin vendedor</option>
                      {sellers.map((r) => (
                        <option key={r.user_id} value={r.user_id}>{r.name}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <p className="mt-2 text-sm" style={{ color: "var(--t-muted)" }}>
                  {(() => {
                    const pt = points.find((x) => x.id === pointId);
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
                <div>
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
 
              {documentKind === "factura" ? (
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
        </div>

        <div className="space-y-3 lg:sticky lg:top-2">
          <div {...cardProps()}>
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold">🛒 Carrito ({cart.length})</h2>
              </div>
              <div
                className="rounded-2xl border px-4 py-2 text-sm"
                style={{
                  borderColor: "var(--t-card-border)",
                  background:
                    "color-mix(in oklab, var(--t-card-bg) 90%, transparent)",
                  color: "var(--t-text)",
                }}
              >
                Total: <span className="font-semibold">{money(total)}</span>
              </div>
            </div>

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

            <div className="mt-2 flex flex-wrap items-center gap-1">
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

            {cart.length === 0 ? (
              <p className="mt-3 text-sm" style={{ color: "var(--t-muted)" }}>
                El carrito está vacío. Agrega productos para comenzar.
              </p>
            ) : (
              <div className="mt-3 max-h-[40vh] space-y-2 overflow-y-auto pr-1">
                {cart.map((item) => (
                  <div
                    key={item.productId}
                    className="rounded-xl border p-2.5"
                    style={{
                      borderColor: "var(--t-card-border)",
                      background:
                        "color-mix(in oklab, var(--t-card-bg) 94%, transparent)",
                    }}
                  >
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="font-semibold">{item.name}</p>
                        <p
                          className="mt-1 text-sm"
                          style={{ color: "var(--t-muted)" }}
                        >
                          {money(item.price)} x {item.qty} ={" "}
                          {money(item.price * item.qty)}
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <select
                          aria-label="Precio de esta línea"
                          value={item.priceLevel}
                          onChange={(e) => setItemLevel(item.productId, Number(e.target.value) as PriceLevel)}
                          className="rounded-xl border px-1.5 py-1.5 text-xs"
                          style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)", color: "var(--t-text)" }}
                        >
                          {([1, 2, 3, 4, 5] as const).map((lvl) => (
                            <option key={lvl} value={lvl}>P{lvl}</option>
                          ))}
                        </select>
                        <button
                          className="rounded-2xl border px-3 py-2 text-sm font-semibold"
                          style={{
                            borderColor: "var(--t-card-border)",
                            background:
                              "color-mix(in oklab, var(--t-card-bg) 92%, transparent)",
                            color: "var(--t-text)",
                          }}
                          onClick={() => adjustQty(item.productId, -1)}
                        >
                          -
                        </button>
                        <div className="min-w-[2rem] text-center text-sm font-semibold">
                          {item.qty}
                        </div>
                        <button
                          className="rounded-2xl border px-3 py-2 text-sm font-semibold"
                          style={{
                            borderColor: "var(--t-card-border)",
                            background:
                              "color-mix(in oklab, var(--t-card-bg) 92%, transparent)",
                            color: "var(--t-text)",
                          }}
                          onClick={() => adjustQty(item.productId, 1)}
                        >
                          +
                        </button>
                        <button
                          className="rounded-2xl border px-3 py-2 text-sm font-semibold"
                          style={{
                            borderColor:
                              "color-mix(in oklab, #ef4444 35%, var(--t-card-border))",
                            background:
                              "color-mix(in oklab, #ef4444 12%, transparent)",
                            color: "var(--t-text)",
                          }}
                          onClick={() => removeItem(item.productId)}
                        >
                          Eliminar
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <button
              onClick={createInvoice}
              disabled={saving}
              className="mt-3 w-full rounded-xl border px-4 py-3 text-sm font-semibold transition hover:brightness-110 disabled:opacity-60"
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
                : saving
                ? documentKind === "factura"
                  ? "Creando factura..."
                  : "Creando remisión..."
                : documentKind === "factura"
                  ? requestElectronicInvoice
                    ? "Crear factura electrónica"
                    : "Crear factura"
                  : "Crear remisión"}
            </button>
          </div>

        </div>
      </div>
    </main>
  );
}
