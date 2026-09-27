"use client";

import { useEffect, useMemo, useState } from "react";
import Swal from "sweetalert2";
import { supabaseBrowser } from "@/lib/supabase/client";
import { getDashboardStore, type DashboardStore } from "@/lib/store-utils";
import { getStoreDataSchemaErrorMessage } from "@/lib/store-schema-errors";

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
    className: "w-full rounded-2xl border px-4 py-3 text-sm outline-none",
    style: {
      borderColor: "var(--t-card-border)",
      background: "color-mix(in oklab, var(--t-card-bg) 92%, transparent)",
      color: "var(--t-text)",
    } as React.CSSProperties,
  };
}

function cardProps() {
  return {
    className: "rounded-[28px] border p-6",
    style: {
      borderColor: "var(--t-card-border)",
      background: "var(--t-card-bg)",
      color: "var(--t-text)",
    } as React.CSSProperties,
  };
}

const DEFAULT_CLIENT_NAME = "CONSUMIDOR FINAL";
const DEFAULT_PRICE_LIST = 3;

export default function PosPage() {
  const [store, setStore] = useState<DashboardStore | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
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
  const [cart, setCart] = useState<CartItem[]>([]);

  const filteredProducts = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return products;
    return products.filter((product) =>
      [product.name].join(" ").toLowerCase().includes(term),
    );
  }, [products, search]);

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
    return clients.filter((client) =>
      [client.name, client.document_number ?? "", client.mobile ?? "", client.email ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(term),
    );
  }, [clients, clientSearch]);

  const currentPriceList = (selectedClient?.price_list ?? customerPriceList) as PriceLevel;
  const siigoConfigured = billingSettings?.electronic_provider?.toLowerCase() === "siigo";

  const total = useMemo(
   () => cart.reduce((sum, item) => sum + item.price * item.qty, 0),
   [cart],
  );

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
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

  async function load() {
    setLoading(true);
    try {
      const access = await getDashboardStore();
      if (!access.store) {
        throw new Error("No tienes acceso a ninguna tienda.");
      }
      setStore(access.store);
      const sb = supabaseBrowser();

      const [
        { data: productData, error: productError },
        { data: clientData, error: clientError },
        { data: settingsData },
      ] = await Promise.all([
        sb
          .from("products")
          .select(
            "id,name,price_1,price_2,price_3,price_4,price_5,min_wholesale,stock,image_url,active",
          )
          .eq("store_id", access.store.id)
          .order("name", { ascending: true }),
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

      setProducts((productData as Product[]) ?? []);
      setClients((clientData as Client[]) ?? []);
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

    setSaving(true);

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
 
      const invoiceUrl = `${window.location.origin}/pedido/${token}`;
      window.open(invoiceUrl, "_blank");
 
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

      await Swal.fire({
        icon: "success",
        title: "Factura creada",
        html: `Factura generada con éxito.${siigoTrackingWarning ? `<br/><small>${siigoTrackingWarning}</small>` : ""}<br/><b>Cliente:</b> ${customerName}<br/><b>Total:</b> ${money(total)}`,
        background: "#0b0b0b",
        color: "#fff",
        confirmButtonText: "Ver comprobante",
        confirmButtonColor: "#22c55e",
      });

      setCart([]);
      setCustomerNote("");
      setSelectedClientId("");
    } catch (err: unknown) {
      await Swal.fire({
        icon: "error",
        title: "No se pudo crear la factura",
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
    <main className="space-y-6">
      <div {...cardProps()}>
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-2xl font-semibold">💳 POS / Facturación</h1>
            <p className="mt-2 text-sm" style={{ color: "var(--t-muted)" }}>
              {store?.name ? `Punto de venta de ${store.name}. ` : ""}
              Registra ventas en vitrina o prepara la factura de un pedido de WhatsApp.
            </p>
          </div>
          <div className="grid gap-2 sm:grid-flow-col sm:auto-cols-max">
            <div
              className="rounded-2xl border px-4 py-2 text-sm"
              style={{
                borderColor: "var(--t-card-border)",
                background:
                  "color-mix(in oklab, var(--t-card-bg) 90%, transparent)",
                color: "var(--t-text)",
              }}
            >
              {products.length} producto{products.length === 1 ? "" : "s"}
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
              {clients.length} cliente{clients.length === 1 ? "" : "s"}
            </div>
          </div>
        </div>
      </div>

      <div {...cardProps()}>
        <div className="flex flex-wrap gap-2">
          {([
            { value: "vitrina", label: "Venta en vitrina" },
            { value: "whatsapp", label: "Pedido por WhatsApp" },
          ] as const).map((option) => (
            <button
              key={option.value}
              type="button"
              className="rounded-2xl border px-4 py-2 text-sm font-semibold"
              style={{
                borderColor: "var(--t-card-border)",
                background:
                  orderSource === option.value
                    ? "var(--t-cta)"
                    : "color-mix(in oklab, var(--t-card-bg) 92%, transparent)",
                color: orderSource === option.value ? "#0b0b0b" : "var(--t-text)",
              }}
              onClick={() => setOrderSource(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <p className="mt-3 text-sm" style={{ color: "var(--t-muted)" }}>
          Flujo recomendado: el cliente hace el pedido por WhatsApp, el vendedor lo confirma, revisa el carrito, crea la remisión o factura y puede imprimir o emitir factura electrónica si aplica.
        </p>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-6">
          <div {...cardProps()}>
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="text-lg font-semibold">
                  1. Selecciona productos
                </h2>
                <p className="mt-1 text-sm" style={{ color: "var(--t-muted)" }}>
                  Busca por nombre y agrega los productos que quieras vender en
                  vitrina.
                </p>
              </div>
              <input
                {...inputProps()}
                className="w-full rounded-2xl border px-4 py-3 text-sm outline-none md:w-72"
                placeholder="Buscar productos..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            {loading ? (
              <p className="mt-6 text-sm" style={{ color: "var(--t-muted)" }}>
                Cargando productos...
              </p>
            ) : filteredProducts.length === 0 ? (
              <p className="mt-6 text-sm" style={{ color: "var(--t-muted)" }}>
                No se encontraron productos.
              </p>
            ) : (
              <div className="mt-6 grid gap-4 sm:grid-cols-2">
                {filteredProducts.map((product) => (
                  <div
                    key={product.id}
                    className="rounded-[24px] border p-4"
                    style={{
                      borderColor: "var(--t-card-border)",
                      background:
                        "color-mix(in oklab, var(--t-card-bg) 94%, transparent)",
                    }}
                  >
                    <div className="flex items-start gap-4">
                      <div
                        className="grid h-14 w-14 place-items-center rounded-3xl border"
                        style={{
                          borderColor: "var(--t-card-border)",
                          background:
                            "color-mix(in oklab, var(--t-card-bg) 88%, transparent)",
                        }}
                      >
                        {product.image_url ? (
                          <img
                            src={product.image_url}
                            alt={product.name}
                            className="h-12 w-12 rounded-2xl object-cover"
                          />
                        ) : (
                          <span className="text-lg">🛍️</span>
                        )}
                      </div>

                      <div className="flex-1">
                        <p className="font-semibold">{product.name}</p>
                        <p
                          className="mt-1 text-sm"
                          style={{ color: "var(--t-muted)" }}
                        >
                          {money(getProductPrice(product, currentPriceList))}
                          {product.stock === 0
                            ? " · Agotado"
                            : product.stock !== null
                              ? ` · ${product.stock} disponibles`
                              : " · Stock ilimitado"}
                        </p>
                      </div>
                    </div>

                    <button
                      className="mt-4 rounded-2xl border px-4 py-2 text-sm font-semibold w-full"
                      onClick={() => addProduct(product)}
                      disabled={!product.active || product.stock === 0}
                      style={{
                        borderColor:
                          "color-mix(in oklab, var(--t-accent) 45%, var(--t-card-border))",
                        background:
                          product.active && product.stock !== 0
                            ? "var(--t-cta)"
                            : "color-mix(in oklab, var(--t-card-bg) 88%, transparent)",
                        color:
                          product.active && product.stock !== 0
                            ? "#0b0b0b"
                            : "var(--t-muted)",
                      }}
                    >
                      {product.stock === 0 ? "Sin stock" : "Agregar"}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div {...cardProps()}>
            <h2 className="text-lg font-semibold">2. Datos del cliente</h2>
            <p className="mt-1 text-sm" style={{ color: "var(--t-muted)" }}>
              Elige un cliente guardado o escribe un nombre y WhatsApp para la
              venta.
            </p>

            <div className="mt-4 space-y-4">
              <div>
                <label className="text-sm font-semibold">Buscar cliente</label>
                <input
                  {...inputProps()}
                  value={clientSearch}
                  onChange={(e) => setClientSearch(e.target.value)}
                  placeholder="Buscar por nombre, documento o teléfono"
                />
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
                  Cliente activo: {effectiveClient.name} · Doc: {effectiveClient.document_number ?? "CF"} · Lista {effectiveClient.price_list}
                </p>
                <p className="mt-2 text-sm" style={{ color: "var(--t-muted)" }}>
                  {billingSettings
                    ? `Prefijos: ${billingSettings.invoice_prefix ?? "FAC"} / ${billingSettings.remision_prefix ?? "REM"}`
                    : "Configura facturación para usar remisiones, facturas y Siigo."}
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
                  <input
                    {...inputProps()}
                    value={customerDocument}
                    onChange={(e) => setCustomerDocument(e.target.value)}
                    placeholder="NIT o cédula"
                  />
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
          </div>
        </div>

        <div className="space-y-6">
          <div {...cardProps()}>
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold">3. Carrito</h2>
                <p className="mt-1 text-sm" style={{ color: "var(--t-muted)" }}>
                  Revisa el contenido, ajusta cantidades y genera la factura.
                </p>
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

            {cart.length === 0 ? (
              <p className="mt-6 text-sm" style={{ color: "var(--t-muted)" }}>
                El carrito está vacío. Agrega productos para comenzar.
              </p>
            ) : (
              <div className="mt-6 space-y-4">
                {cart.map((item) => (
                  <div
                    key={item.productId}
                    className="rounded-[24px] border p-4"
                    style={{
                      borderColor: "var(--t-card-border)",
                      background:
                        "color-mix(in oklab, var(--t-card-bg) 94%, transparent)",
                    }}
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
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
              className="mt-6 w-full rounded-2xl border px-4 py-3 text-sm font-semibold transition hover:brightness-110 disabled:opacity-60"
              style={{
                borderColor:
                  "color-mix(in oklab, var(--t-accent) 45%, var(--t-card-border))",
                background: "var(--t-cta)",
                color: "#0b0b0b",
              }}
            >
              {saving
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

          <div {...cardProps()}>
            <h2 className="text-lg font-semibold">Ayuda rápida</h2>
            <ul
              className="mt-4 space-y-2 text-sm"
              style={{ color: "var(--t-muted)" }}
            >
              <li>• Selecciona el cliente o escribe el nombre directamente.</li>
              <li>• Ajusta cantidades del carrito antes de facturar.</li>
              <li>
                • El comprobante se guarda como pedido y se puede abrir desde el
                panel de pedidos.
              </li>
            </ul>
          </div>
        </div>
      </div>
    </main>
  );
}
