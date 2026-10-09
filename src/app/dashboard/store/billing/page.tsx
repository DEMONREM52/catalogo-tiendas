"use client";

import Link from "next/link";
import { WithDv } from "@/app/dashboard/nit";
import { useCallback, useEffect, useState } from "react";
import Swal from "sweetalert2";
import PointBillingPanel from "./PointBillingPanel";
import { supabaseBrowser } from "@/lib/supabase/client";
import { getDashboardStore, type DashboardStore } from "@/lib/store-utils";

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

type BillingSettings = {
  id?: string;
  store_id?: string;
  business_name: string;
  nit: string;
  address: string;
  phone: string;
  city: string;
  email: string;
  currency: string;
  default_print_format: string;
  invoice_prefix: string;
  remision_prefix: string;
  electronic_provider: string;
  siigo_api_url: string;
  siigo_api_token: string;
  siigo_username: string;
  siigo_access_key: string;
  siigo_partner_id: string;
  siigo_document_id: string;
  siigo_seller_id: string;
  siigo_payment_type_id: string;
  electronic_test_mode: boolean;
  payment_methods?: Array<{
    id?: string;
    provider: string;
    name: string;
    enabled: boolean;
    show_on_invoice?: boolean;
  }>;
};

type WompiSettings = {
  wompi_public_key: string;
  wompi_integrity_secret: string;
  wompi_events_secret: string;
  wompi_sandbox: boolean;
};

type AddiEnvironment = "staging" | "production";

function normalizePaymentMethods(value: unknown): NonNullable<BillingSettings["payment_methods"]> {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item): NonNullable<BillingSettings["payment_methods"]> => {
    if (!item || typeof item !== "object") return [];
    const method = item as Record<string, unknown>;
    const id = String(method.id ?? "");
    return [{
      id: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
        ? id
        : crypto.randomUUID(),
      provider: String(method.provider ?? "wompi"),
      name: String(method.name ?? ""),
      enabled: Boolean(method.enabled),
      show_on_invoice: method.show_on_invoice !== false,
    }];
  });
}

const EMPTY_WOMPI_SETTINGS: WompiSettings = {
  wompi_public_key: "",
  wompi_integrity_secret: "",
  wompi_events_secret: "",
  wompi_sandbox: true,
};

const DEFAULT_SETTINGS: BillingSettings = {
  business_name: "",
  nit: "",
  address: "",
  phone: "",
  city: "",
  email: "",
  currency: "COP",
  default_print_format: "pos",
  invoice_prefix: "FAC",
  remision_prefix: "REM",
  electronic_provider: "siigo",
  siigo_api_url: "",
  siigo_api_token: "",
  siigo_username: "",
  siigo_access_key: "",
  siigo_partner_id: "",
  siigo_document_id: "",
  siigo_seller_id: "",
  siigo_payment_type_id: "",
  electronic_test_mode: false,
  payment_methods: [],
};

export default function BillingSettingsPage() {
  const [store, setStore] = useState<DashboardStore | null>(null);
  const [isStoreOwner, setIsStoreOwner] = useState(false);
  const [canManage, setCanManage] = useState<boolean | null>(null);
  const [settings, setSettings] = useState<BillingSettings>(DEFAULT_SETTINGS);
  const [wompi, setWompi] = useState<WompiSettings>(EMPTY_WOMPI_SETTINGS);
  const [addiClientId, setAddiClientId] = useState("");
  const [addiClientSecret, setAddiClientSecret] = useState("");
  const [addiEnvironment, setAddiEnvironment] = useState<AddiEnvironment>("staging");
  const [addiConfigured, setAddiConfigured] = useState(false);
  const [addiConfigurationError, setAddiConfigurationError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingPaymentMethods, setSavingPaymentMethods] = useState(false);
  const [savingAddi, setSavingAddi] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const access = await getDashboardStore();
      if (!access.store) {
        throw new Error("No tienes acceso a ninguna tienda.");
      }

      setStore(access.store);
      setIsStoreOwner(access.isOwner);
      setCanManage(access.isOwner || access.profileRole === "admin" || access.membership?.role === "store_admin");
      const sb = supabaseBrowser();

      if (access.isOwner) {
        try {
          const { data: sessionData, error: sessionError } = await sb.auth.getSession();
          if (sessionError) throw sessionError;
          const accessToken = sessionData.session?.access_token;
          if (!accessToken) throw new Error("Inicia sesión nuevamente para revisar la configuración de ADDI.");

          const response = await fetch(
            `/api/payments/addi/settings?store_id=${encodeURIComponent(access.store.id)}`,
            { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" },
          );
          const result = await response.json();
          if (!response.ok) throw new Error(result.error ?? "No se pudo consultar la configuración de ADDI.");

          setAddiConfigured(Boolean(result.configured));
          setAddiEnvironment(result.environment === "production" ? "production" : "staging");
          setAddiConfigurationError("");
        } catch (error: unknown) {
          const message = String((error as Error)?.message ?? error);
          console.error("No se pudo consultar la configuración de ADDI:", message);
          setAddiConfigurationError(message);
        }
      }

      let data: Record<string, unknown> | null = null;
      let errorMessage: string | null = null;

      for (const tableName of ["billing_settings", "store_billing_settings"]) {
        const res = await sb
          .from(tableName)
          .select(
            "id,store_id,business_name,nit,address,phone,city,email,currency,default_print_format,invoice_prefix,remision_prefix,electronic_provider,siigo_api_url,siigo_api_token,siigo_api_key,siigo_company_id,siigo_invoice_path,siigo_username,siigo_access_key,siigo_partner_id,siigo_document_id,siigo_seller_id,siigo_payment_type_id,electronic_test_mode,payment_methods"
          )
          .eq("store_id", access.store.id)
          .maybeSingle();

        if (!res.error && res.data) {
          data = res.data as Record<string, unknown>;
          errorMessage = null;
          break;
        }

        errorMessage = res.error?.message ?? null;
      }

      if (errorMessage) throw new Error(errorMessage);
      if (data) setSettings({ ...DEFAULT_SETTINGS, ...data } as BillingSettings);

      const { data: methodsData, error: methodsError } = await sb
        .from("store_payment_methods")
        .select("id,provider,name,enabled,show_on_invoice,sort_order")
        .eq("store_id", access.store.id)
        .order("sort_order", { ascending: true });
      if (methodsError) throw methodsError;
      const methods = normalizePaymentMethods(methodsData);
      setSettings((prev) => ({ ...prev, payment_methods: methods }));

      if (access.isOwner) {
        const { data: paymentData, error: paymentError } = await sb
          .from("store_payment_secrets")
          .select("wompi_public_key,wompi_integrity_secret,wompi_events_secret,wompi_sandbox")
          .eq("store_id", access.store.id)
          .maybeSingle();

        if (paymentError) throw paymentError;
        if (paymentData) {
          setWompi({
            wompi_public_key: paymentData.wompi_public_key,
            wompi_integrity_secret: paymentData.wompi_integrity_secret,
            wompi_events_secret: paymentData.wompi_events_secret,
            wompi_sandbox: paymentData.wompi_sandbox,
          });
        }
      }
    } catch (err: unknown) {
      await Swal.fire({
        icon: "error",
        title: "No se pudieron cargar las opciones de facturación",
        text: getPaymentConfigurationErrorMessage(err),
        background: "#0b0b0b",
        color: "#fff",
        confirmButtonColor: "#ef4444",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function savePaymentMethods() {
    if (!store) return;
    setSavingPaymentMethods(true);

    try {
      const methods = settings.payment_methods || [];
      if (methods.some((method) => !method.name.trim())) {
        throw new Error("Escribe un nombre para cada forma de pago antes de guardar.");
      }

      if (isStoreOwner && methods.some((method) => method.provider === "addi" && method.enabled) && !addiConfigured) {
        throw new Error("Guarda y valida primero las credenciales de ADDI para esta tienda.");
      }

      const wompiEnabled = methods.some(
        (method) => method.provider === "wompi" && method.enabled && method.show_on_invoice !== false,
      );
      const hasWompiCredentials = Boolean(
        wompi.wompi_public_key.trim() ||
        wompi.wompi_integrity_secret.trim() ||
        wompi.wompi_events_secret.trim(),
      );

      if (isStoreOwner && wompiEnabled && (
        !wompi.wompi_public_key.trim() ||
        !wompi.wompi_integrity_secret.trim() ||
        !wompi.wompi_events_secret.trim()
      )) {
        throw new Error("Para activar Wompi, completa primero la llave pública y ambos secretos.");
      }
      if (isStoreOwner && hasWompiCredentials && !/^pub_(test|prod)_[A-Za-z0-9]+$/.test(wompi.wompi_public_key.trim())) {
        throw new Error("La llave pública de Wompi debe comenzar con pub_test_ o pub_prod_.");
      }
      if (
        isStoreOwner &&
        hasWompiCredentials &&
        ((wompi.wompi_sandbox && !wompi.wompi_public_key.trim().startsWith("pub_test_")) ||
          (!wompi.wompi_sandbox && !wompi.wompi_public_key.trim().startsWith("pub_prod_")))
      ) {
        throw new Error("La llave pública no corresponde al ambiente seleccionado.");
      }

      const sb = supabaseBrowser();
      const { data: existing, error: readError } = await sb
        .from("store_payment_methods")
        .select("id")
        .eq("store_id", store.id);
      if (readError) throw readError;

      const rows = methods.map((method, sortOrder) => ({
        id: method.id && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(method.id)
          ? method.id
          : crypto.randomUUID(),
        store_id: store.id,
        provider: method.provider,
        name: method.name.trim(),
        enabled: method.enabled,
        show_on_invoice: method.show_on_invoice !== false,
        sort_order: sortOrder,
        updated_at: new Date().toISOString(),
      }));

      if (isStoreOwner && hasWompiCredentials) {
        const { error } = await sb.from("store_payment_secrets").upsert(
          {
            store_id: store.id,
            wompi_public_key: wompi.wompi_public_key.trim(),
            wompi_integrity_secret: wompi.wompi_integrity_secret.trim(),
            wompi_events_secret: wompi.wompi_events_secret.trim(),
            wompi_sandbox: wompi.wompi_sandbox,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "store_id" },
        );
        if (error) throw error;
      }

      if (rows.length > 0) {
        const { error } = await sb
          .from("store_payment_methods")
          .upsert(rows, { onConflict: "id" });
        if (error) throw error;
      }

      const removed = (existing || []).filter(
        (row: { id: string }) => !methods.some((method) => method.id === row.id),
      );
      if (removed.length > 0) {
        const { error } = await sb
          .from("store_payment_methods")
          .delete()
          .eq("store_id", store.id)
          .in("id", removed.map((row: { id: string }) => row.id));
        if (error) throw error;
      }

      const { data: savedMethods, error: savedError } = await sb
        .from("store_payment_methods")
        .select("id,provider,name,enabled,show_on_invoice,sort_order")
        .eq("store_id", store.id)
        .order("sort_order", { ascending: true });
      if (savedError) throw savedError;

      setSettings((prev) => ({
        ...prev,
        payment_methods: normalizePaymentMethods(savedMethods),
      }));
      await Swal.fire({
        icon: "success",
        title: "Formas de pago guardadas",
        text: "Los cambios quedaron guardados para esta tienda.",
        timer: 1500,
        showConfirmButton: false,
        background: "#0b0b0b",
        color: "#fff",
      });
    } catch (err: unknown) {
      await Swal.fire({
        icon: "error",
        title: "No se pudieron guardar las formas de pago",
        text: getPaymentConfigurationErrorMessage(err),
        background: "#0b0b0b",
        color: "#fff",
        confirmButtonColor: "#ef4444",
      });
    } finally {
      setSavingPaymentMethods(false);
    }
  }

  async function saveAddiCredentials() {
    if (!store || !isStoreOwner) return;
    if (!addiClientId.trim() || !addiClientSecret.trim()) {
      await Swal.fire({
        icon: "warning",
        title: "Faltan las credenciales de ADDI",
        text: "Ingresa el client ID y el client secret entregados por ADDI para esta tienda.",
        background: "#0b0b0b",
        color: "#fff",
      });
      return;
    }

    setSavingAddi(true);
    setAddiConfigurationError("");
    try {
      const sb = supabaseBrowser();
      const { data: sessionData, error: sessionError } = await sb.auth.getSession();
      if (sessionError) throw sessionError;
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) throw new Error("Inicia sesión nuevamente para guardar las credenciales.");

      const response = await fetch("/api/payments/addi/settings", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          store_id: store.id,
          client_id: addiClientId.trim(),
          client_secret: addiClientSecret.trim(),
          environment: addiEnvironment,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "No se pudieron validar las credenciales de ADDI.");

      setAddiConfigured(true);
      setAddiClientId("");
      setAddiClientSecret("");
      await Swal.fire({
        icon: "success",
        title: "ADDI conectado",
        text: `Las credenciales se validaron y guardaron de forma privada para ${store.name}.`,
        timer: 1800,
        showConfirmButton: false,
        background: "#0b0b0b",
        color: "#fff",
      });
    } catch (error: unknown) {
      const message = String((error as Error)?.message ?? error);
      setAddiConfigurationError(message);
      await Swal.fire({
        icon: "error",
        title: "No se pudieron guardar las credenciales de ADDI",
        text: message,
        background: "#0b0b0b",
        color: "#fff",
      });
    } finally {
      setSavingAddi(false);
    }
  }

  function getPaymentConfigurationErrorMessage(error: unknown) {
    const message = String((error as Error)?.message ?? error);
    const normalized = message.toLowerCase();

    if ((normalized.includes("store_payment_methods") || normalized.includes("store_payment_secrets")) && (
      normalized.includes("schema cache") ||
      normalized.includes("does not exist") ||
      normalized.includes("could not find the table")
    )) {
      return "Faltan las tablas de métodos de pago en Supabase. Ejecuta supabase/configuracion-pedidos-pagos.sql en el SQL Editor y vuelve a intentar.";
    }
    if (normalized.includes("row-level security") || normalized.includes("permission denied")) {
      return "Supabase bloqueó el guardado por permisos. Ejecuta el SQL de configuración de pedidos y pagos para instalar las políticas RLS.";
    }
    return message;
  }

  async function saveSettings() {
    if (!store) return;
    setSaving(true);
    try {
      const wompiEnabled = (settings.payment_methods || []).some(
        (method) => method.provider === "wompi" && method.enabled && method.show_on_invoice !== false,
      );
      const hasWompiCredentials = Boolean(
        wompi.wompi_public_key.trim() ||
        wompi.wompi_integrity_secret.trim() ||
        wompi.wompi_events_secret.trim(),
      );

      if (isStoreOwner && (wompiEnabled || hasWompiCredentials) && (
        !wompi.wompi_public_key.trim() ||
        !wompi.wompi_integrity_secret.trim() ||
        !wompi.wompi_events_secret.trim()
      )) {
        throw new Error("Para configurar Wompi debes guardar la llave publica, el secreto de integridad y el secreto de eventos.");
      }

      if (isStoreOwner && hasWompiCredentials && !/^pub_(test|prod)_[A-Za-z0-9]+$/.test(wompi.wompi_public_key.trim())) {
        throw new Error("La llave publica de Wompi debe comenzar con pub_test_ o pub_prod_.");
      }
      if (
        isStoreOwner &&
        hasWompiCredentials &&
        ((wompi.wompi_sandbox && !wompi.wompi_public_key.trim().startsWith("pub_test_")) ||
          (!wompi.wompi_sandbox && !wompi.wompi_public_key.trim().startsWith("pub_prod_")))
      ) {
        throw new Error("La llave pública no corresponde al ambiente seleccionado (sandbox o producción).");
      }

      const payload = {
        store_id: store.id,
        business_name: settings.business_name.trim() || null,
        nit: settings.nit.trim() || null,
        address: settings.address.trim() || null,
        phone: settings.phone.trim() || null,
        city: settings.city.trim() || null,
        email: settings.email.trim() || null,
        currency: settings.currency,
        default_print_format: settings.default_print_format,
        invoice_prefix: settings.invoice_prefix.trim() || "FAC",
        remision_prefix: settings.remision_prefix.trim() || "REM",
        electronic_provider: settings.electronic_provider || "siigo",
        siigo_api_url: settings.siigo_api_url.trim() || null,
        siigo_api_token: settings.siigo_api_token.trim() || null,
        siigo_username: settings.siigo_username.trim() || null,
        siigo_access_key: settings.siigo_access_key.trim() || null,
        siigo_partner_id: settings.siigo_partner_id.trim() || null,
        siigo_document_id: settings.siigo_document_id.trim() || null,
        siigo_seller_id: settings.siigo_seller_id.trim() || null,
              siigo_payment_type_id: settings.siigo_payment_type_id.trim() || null,
        electronic_test_mode: settings.electronic_test_mode,
      };

      const sb = supabaseBrowser();
      let data: Array<{ id: string; store_id: string }> | null = null;
      let errorMessage: string | null = null;

      for (const tableName of ["billing_settings", "store_billing_settings"]) {
        const res = await sb
          .from(tableName)
          .upsert({ ...payload }, { onConflict: "store_id" })
          .select("id,store_id");

        if (!res.error) {
          data = res.data as Array<{ id: string; store_id: string }>;
          errorMessage = null;
          break;
        }

        errorMessage = res.error.message;
      }

      if (errorMessage) throw new Error(errorMessage);

      if (isStoreOwner && hasWompiCredentials) {
        const { error: paymentError } = await sb.from("store_payment_secrets").upsert(
          {
            store_id: store.id,
            wompi_public_key: wompi.wompi_public_key.trim(),
            wompi_integrity_secret: wompi.wompi_integrity_secret.trim(),
            wompi_events_secret: wompi.wompi_events_secret.trim(),
            wompi_sandbox: wompi.wompi_sandbox,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "store_id" },
        );
        if (paymentError) throw paymentError;
      }

      await Swal.fire({
        icon: "success",
        title: "Configuración guardada",
        timer: 1200,
        showConfirmButton: false,
        background: "#0b0b0b",
        color: "#fff",
      });
      if (data?.length) {
        setSettings((prev) => ({ ...prev, id: data[0].id }));
      }
    } catch (err: unknown) {
      await Swal.fire({
        icon: "error",
        title: "No se pudo guardar",
        text: String((err as Error)?.message ?? err),
        background: "#0b0b0b",
        color: "#fff",
        confirmButtonColor: "#ef4444",
      });
    } finally {
      setSaving(false);
    }
  }

  if (canManage === false) {
    return (
      <main className="p-2">
        <div {...cardProps()}>
          <h1 className="text-lg font-semibold">🔒 Datos de facturación</h1>
          <p className="mt-2 text-sm" style={{ color: "var(--t-muted)" }}>
            Solo el administrador de la tienda puede ver y modificar estos datos.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="space-y-6">
      <Link href="/dashboard/fiscal" className="flex items-start gap-3 rounded-2xl border p-4 text-sm transition hover:-translate-y-0.5" style={{ borderColor: "color-mix(in oklab, var(--t-accent) 40%, var(--t-card-border))", background: "color-mix(in oklab, var(--t-accent) 10%, transparent)" }}>
        <span className="text-xl">🏛️</span>
        <span>
          <b>Facturación electrónica por punto:</b> contribuyentes (NIT), resoluciones, proveedor tecnológico con credenciales cifradas y documentos electrónicos ahora están en el <b>Centro fiscal</b>. Esta página conserva los datos del comprobante y la integración anterior.
        </span>
      </Link>
      <div {...cardProps()}>
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-2xl font-semibold">🧾 Configuración de facturación</h1>
            <p className="mt-2 text-sm" style={{ color: "var(--t-muted)" }}>
              Configure la información fiscal, prefijos y la integración con Siigo para emitir facturas electrónicas desde tu tienda.
            </p>
          </div>
        </div>
      </div>

      {store ? <PointBillingPanel storeId={store.id} /> : null}

      <div className="grid gap-6 xl:grid-cols-[1fr_400px]">
        <div {...cardProps()}>
          <h2 className="text-lg font-semibold">Datos fiscales</h2>
          <div className="mt-4 space-y-4">
            <div>
              <label className="text-sm font-semibold">Razón social / nombre</label>
              <input
                {...inputProps()}
                value={settings.business_name}
                onChange={(e) => setSettings((prev) => ({ ...prev, business_name: e.target.value }))}
                placeholder="Nombre de la empresa"
              />
            </div>

            <div>
              <label className="text-sm font-semibold">NIT / cédula</label>
              <WithDv value={settings.nit}>
                <input
                  {...inputProps()}
                  value={settings.nit}
                  onChange={(e) => setSettings((prev) => ({ ...prev, nit: e.target.value }))}
                  placeholder="900123456"
                />
              </WithDv>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="text-sm font-semibold">Dirección</label>
                <input
                  {...inputProps()}
                  value={settings.address}
                  onChange={(e) => setSettings((prev) => ({ ...prev, address: e.target.value }))}
                  placeholder="Dirección de la tienda"
                />
              </div>
              <div>
                <label className="text-sm font-semibold">Ciudad</label>
                <input
                  {...inputProps()}
                  value={settings.city}
                  onChange={(e) => setSettings((prev) => ({ ...prev, city: e.target.value }))}
                  placeholder="Ciudad"
                />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="text-sm font-semibold">Email de facturación</label>
                <input
                  {...inputProps()}
                  type="email"
                  value={settings.email}
                  onChange={(e) => setSettings((prev) => ({ ...prev, email: e.target.value }))}
                  placeholder="facturacion@tienda.com"
                />
              </div>
              <div>
                <label className="text-sm font-semibold">Teléfono</label>
                <input
                  {...inputProps()}
                  value={settings.phone}
                  onChange={(e) => setSettings((prev) => ({ ...prev, phone: e.target.value }))}
                  placeholder="57XXXXXXXXX"
                />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="text-sm font-semibold">Moneda</label>
                <input
                  {...inputProps()}
                  value={settings.currency}
                  onChange={(e) => setSettings((prev) => ({ ...prev, currency: e.target.value }))}
                  placeholder="COP"
                />
              </div>
              <div>
                <label className="text-sm font-semibold">Formato de impresión</label>
                <select
                  {...inputProps()}
                  value={settings.default_print_format}
                  onChange={(e) => setSettings((prev) => ({ ...prev, default_print_format: e.target.value }))}
                >
                  <option value="pos">POS / Tirilla</option>
                  <option value="letter">Carta</option>
                </select>
              </div>
            </div>
          </div>

          <div className="mt-8 space-y-4">
            <h2 className="text-lg font-semibold">Prefijos de documentos</h2>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="text-sm font-semibold">Prefijo remisión</label>
                <input
                  {...inputProps()}
                  value={settings.remision_prefix}
                  onChange={(e) => setSettings((prev) => ({ ...prev, remision_prefix: e.target.value }))}
                  placeholder="REM"
                />
              </div>
              <div>
                <label className="text-sm font-semibold">Prefijo factura</label>
                <input
                  {...inputProps()}
                  value={settings.invoice_prefix}
                  onChange={(e) => setSettings((prev) => ({ ...prev, invoice_prefix: e.target.value }))}
                  placeholder="FAC"
                />
              </div>
            </div>
          </div>

          <div className="mt-8 space-y-4">
            <h2 className="text-lg font-semibold">Integración con Siigo</h2>
            <p className="text-sm" style={{ color: "var(--t-muted)" }}>
              Configura los datos para emitir facturas electrónicas con Siigo desde el POS. Estos valores se guardan para esta tienda en particular.
            </p>
            <div className="rounded-3xl border border-yellow-500/20 bg-yellow-500/10 p-4 text-sm">
              <strong>Importante:</strong> esta sección es por tienda. No uses las variables de entorno globales de Supabase para guardar credenciales de Siigo de cada tienda. 
              Usa solo esta página para configurar la integración de facturación electrónica de esta tienda.
            </div>

            <div>
              <label className="text-sm font-semibold">Proveedor electrónico</label>
              <select
                {...inputProps()}
                value={settings.electronic_provider}
                onChange={(e) => setSettings((prev) => ({ ...prev, electronic_provider: e.target.value }))}
              >
                <option value="siigo">Siigo</option>
              </select>
            </div>
 
            <div>
              <label className="text-sm font-semibold">Siigo API URL</label>
              <input
                {...inputProps()}
                value={settings.siigo_api_url}
                onChange={(e) => setSettings((prev) => ({ ...prev, siigo_api_url: e.target.value }))}
                placeholder="https://api.siigo.com"
              />
            </div>
 
            <div>
              <label className="text-sm font-semibold">Siigo API Token</label>
              <input
                {...inputProps()}
                type="password"
                value={settings.siigo_api_token}
                onChange={(e) => setSettings((prev) => ({ ...prev, siigo_api_token: e.target.value }))}
                placeholder="Token de API Siigo"
              />
            </div>
 
            <div>
              <label className="text-sm font-semibold">Usuario Siigo</label>
              <input
                {...inputProps()}
                value={settings.siigo_username}
                onChange={(e) => setSettings((prev) => ({ ...prev, siigo_username: e.target.value }))}
                placeholder="Usuario Siigo"
              />
            </div>
 
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="text-sm font-semibold">Clave de acceso Siigo</label>
                <input
                  {...inputProps()}
                  type="password"
                  value={settings.siigo_access_key}
                  onChange={(e) => setSettings((prev) => ({ ...prev, siigo_access_key: e.target.value }))}
                  placeholder="Clave Siigo"
                />
              </div>
              <div>
                <label className="text-sm font-semibold">Modo de prueba</label>
                <div className="mt-2 flex items-center gap-3">
                  <label className="inline-flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={settings.electronic_test_mode}
                      onChange={(e) =>
                        setSettings((prev) => ({ ...prev, electronic_test_mode: e.target.checked }))
                      }
                      className="h-4 w-4 rounded border"
                    />
                    Activar modo de prueba
                  </label>
                </div>
              </div>
            </div>
          </div>

          <button
            onClick={saveSettings}
            disabled={saving}
            className="mt-6 rounded-2xl border px-4 py-3 text-sm font-semibold transition hover:brightness-110 disabled:opacity-60"
            style={{
              borderColor: "color-mix(in oklab, var(--t-accent) 45%, var(--t-card-border))",
              background: "var(--t-cta)",
              color: "#0b0b0b",
            }}
          >
            {saving ? "Guardando..." : "Guardar configuración"}
          </button>
        </div>

        <div {...cardProps()}>
          <h2 className="text-lg font-semibold">Cómo usar estas opciones</h2>
          <div className="mt-4 space-y-3 text-sm" style={{ color: "var(--t-muted)" }}>
            <p>
              Con esta configuración podrás generar facturas y remisiones desde el módulo POS, usando los
              prefijos que definas para cada tipo de documento.
            </p>
            <p>
              Si configuras Siigo correctamente, el POS podrá solicitar factura electrónica directamente
              desde la venta en vitrina.
            </p>
            <p>Recuerda guardar la configuración antes de generar facturas electrónicas.</p>
          </div>
        </div>

        <div {...cardProps()}>
          <h2 className="text-lg font-semibold">Formas de pago (por tienda)</h2>
          <p className="mt-2 text-sm" style={{ color: "var(--t-muted)" }}>
            Configura por separado los medios que cada tienda acepta. Wompi ofrece su checkout habitual y Addi abre una solicitud de crédito segura después de confirmar el pedido.
          </p>

          <section
            className="mt-5 rounded-3xl border p-5"
            style={{
              borderColor: "color-mix(in oklab, #f59e0b 35%, var(--t-card-border))",
              background: "color-mix(in oklab, #f59e0b 7%, var(--t-card-bg))",
            }}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-amber-400/15 px-3 py-1 text-xs font-bold text-amber-300">ADDI</span>
                  <h3 className="font-semibold">Conexión independiente de esta tienda</h3>
                </div>
                <p className="mt-2 max-w-2xl text-sm" style={{ color: "var(--t-muted)" }}>
                  Usa el client ID y el client secret que ADDI entrega a este comercio. Se validan al guardar y permanecen en el servidor; nunca se envían al navegador del cliente.
                </p>
              </div>
              <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${addiConfigured ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : "border-amber-500/30 bg-amber-500/10 text-amber-200"}`}>
                {addiConfigured ? "Credenciales verificadas" : "Pendiente de configuración"}
              </span>
            </div>

            {isStoreOwner ? (
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <label className="text-xs font-semibold">
                  Ambiente ADDI
                  <select
                    {...inputProps()}
                    className="mt-1 w-full rounded-2xl border px-4 py-3 text-sm outline-none"
                    value={addiEnvironment}
                    onChange={(event) => setAddiEnvironment(event.target.value as AddiEnvironment)}
                  >
                    <option value="staging">Pruebas (staging)</option>
                    <option value="production">Producción</option>
                  </select>
                </label>
                <div className="hidden md:block" />
                <label className="text-xs font-semibold">
                  Client ID
                  <input
                    {...inputProps()}
                    className="mt-1 w-full rounded-2xl border px-4 py-3 text-sm outline-none"
                    value={addiClientId}
                    onChange={(event) => setAddiClientId(event.target.value)}
                    placeholder={addiConfigured ? "Credencial guardada; escribe solo para reemplazar" : "Client ID entregado por ADDI"}
                    autoComplete="off"
                  />
                </label>
                <label className="text-xs font-semibold">
                  Client secret
                  <input
                    {...inputProps()}
                    className="mt-1 w-full rounded-2xl border px-4 py-3 text-sm outline-none"
                    type="password"
                    value={addiClientSecret}
                    onChange={(event) => setAddiClientSecret(event.target.value)}
                    placeholder={addiConfigured ? "Secreto guardado; escribe solo para reemplazar" : "Client secret entregado por ADDI"}
                    autoComplete="new-password"
                  />
                </label>
                <div className="md:col-span-2">
                  <button
                    type="button"
                    onClick={() => void saveAddiCredentials()}
                    disabled={savingAddi || !store}
                    className="rounded-2xl px-4 py-3 text-sm font-bold text-slate-950 transition hover:brightness-105 disabled:opacity-60"
                    style={{ background: "linear-gradient(135deg, #facc15, #f59e0b)" }}
                  >
                    {savingAddi ? "Validando y guardando..." : addiConfigured ? "Actualizar conexión ADDI" : "Validar y guardar conexión"}
                  </button>
                </div>
              </div>
            ) : (
              <p className="mt-4 rounded-2xl border border-sky-500/25 bg-sky-500/10 p-4 text-sm">
                Solo el propietario de la tienda puede guardar credenciales privadas o activar Addi. Solicítale que conecte esta tienda desde su cuenta.
              </p>
            )}
            {addiConfigurationError ? (
              <p role="alert" className="mt-3 rounded-2xl border border-red-500/25 bg-red-500/10 p-3 text-sm text-red-200">
                {addiConfigurationError}
              </p>
            ) : null}
            <p className="mt-3 text-xs" style={{ color: "var(--t-muted)" }}>
              ADDI debe aprobar la integración y entregar credenciales de sandbox o producción por sus canales seguros. No pegues secretos en chats ni los compartas con otras tiendas.
            </p>
          </section>

          {isStoreOwner ? (
            <div className="mt-4 rounded-2xl border border-sky-500/25 bg-sky-500/10 p-4 text-sm">
              <p className="font-semibold">Credenciales de Wompi</p>
              <p className="mt-1 opacity-80">
                Obtén estas credenciales en el panel de comercios de Wompi. El secreto de eventos es distinto al secreto de integridad y nunca se envía al navegador del cliente.
              </p>
              <div className="mt-4 grid gap-3">
                <label className="text-xs font-semibold">
                  Llave pública
                  <input
                    {...inputProps()}
                    className="mt-1 w-full rounded-2xl border px-4 py-3 text-sm outline-none"
                    value={wompi.wompi_public_key}
                    onChange={(e) => setWompi((prev) => ({ ...prev, wompi_public_key: e.target.value }))}
                    placeholder="pub_test_... o pub_prod_..."
                    autoComplete="off"
                  />
                </label>
                <label className="text-xs font-semibold">
                  Secreto de integridad
                  <input
                    {...inputProps()}
                    className="mt-1 w-full rounded-2xl border px-4 py-3 text-sm outline-none"
                    type="password"
                    value={wompi.wompi_integrity_secret}
                    onChange={(e) => setWompi((prev) => ({ ...prev, wompi_integrity_secret: e.target.value }))}
                    placeholder="Secreto para firma del checkout"
                    autoComplete="new-password"
                  />
                </label>
                <label className="text-xs font-semibold">
                  Secreto de eventos
                  <input
                    {...inputProps()}
                    className="mt-1 w-full rounded-2xl border px-4 py-3 text-sm outline-none"
                    type="password"
                    value={wompi.wompi_events_secret}
                    onChange={(e) => setWompi((prev) => ({ ...prev, wompi_events_secret: e.target.value }))}
                    placeholder="Secreto para validar webhooks"
                    autoComplete="new-password"
                  />
                </label>
                <label className="inline-flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={wompi.wompi_sandbox}
                    onChange={(e) => setWompi((prev) => ({ ...prev, wompi_sandbox: e.target.checked }))}
                  />
                  Usar ambiente de pruebas (sandbox)
                </label>
              </div>
            </div>
          ) : (
            <p className="mt-4 rounded-2xl border border-sky-500/25 bg-sky-500/10 p-4 text-sm">
              Solo el propietario de la tienda puede consultar o modificar las credenciales privadas de Wompi. Puedes administrar las formas de pago sin acceder a esos secretos.
            </p>
          )}

          <div className="mt-4 space-y-3">
            {loading ? (
              <p className="text-sm" style={{ color: "var(--t-muted)" }}>
                Cargando métodos de pago...
              </p>
            ) : null}
            {(settings.payment_methods || []).map((pm, idx) => (
              <div key={pm?.id ?? idx} className="rounded-2xl border p-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold">{pm?.name || `(Sin nombre)`}</div>
                    <div className="text-xs" style={{ color: "var(--t-muted)" }}>{pm?.provider}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="inline-flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={pm?.enabled ?? false}
                        disabled={
                          (pm?.provider === "addi" && (!isStoreOwner || !addiConfigured)) ||
                          (pm?.provider === "wompi" && !isStoreOwner)
                        }
                        onChange={(e) => {
                          const next = [...(settings.payment_methods || [])];
                          next[idx] = { ...(next[idx] || {}), enabled: e.target.checked };
                          setSettings((prev) => ({ ...prev, payment_methods: next }));
                        }}
                      />
                      {pm?.provider === "addi" && !addiConfigured ? "Configura las credenciales" : "Activo"}
                    </label>

                    <label className="inline-flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={pm?.show_on_invoice ?? true}
                        onChange={(e) => {
                          const next = [...(settings.payment_methods || [])];
                          next[idx] = { ...(next[idx] || {}), show_on_invoice: e.target.checked };
                          setSettings((prev) => ({ ...prev, payment_methods: next }));
                        }}
                      />
                      Aparece en factura
                    </label>
                    <button
                      className="rounded-2xl border px-3 py-1 text-xs"
                      onClick={() => {
                        const next = [...(settings.payment_methods || [])];
                        next.splice(idx, 1);
                        setSettings((prev) => ({ ...prev, payment_methods: next }));
                      }}
                    >
                      Eliminar
                    </button>
                  </div>
                </div>

                <div className="mt-3 grid gap-2 md:grid-cols-2">
                  <input
                    {...inputProps()}
                    placeholder="Nombre visible (ej. Addi, Wompi, Tarjeta débito)"
                    value={pm?.name ?? ""}
                    onChange={(e) => {
                      const next = [...(settings.payment_methods || [])];
                      next[idx] = { ...(next[idx] || {}), name: e.target.value };
                      setSettings((prev) => ({ ...prev, payment_methods: next }));
                    }}
                  />

                  <select
                    {...inputProps()}
                    value={pm?.provider ?? "manual"}
                    onChange={(e) => {
                      const next = [...(settings.payment_methods || [])];
                      next[idx] = { ...(next[idx] || {}), provider: e.target.value };
                      setSettings((prev) => ({ ...prev, payment_methods: next }));
                    }}
                  >
                    <option value="wompi">Wompi (tarjetas, PSE, Nequi y métodos disponibles)</option>
                    <option value="addi">Addi (crédito en cuotas)</option>
                  </select>
                </div>
                {pm?.provider === "addi" ? (
                  <p className="mt-2 text-xs" style={{ color: "var(--t-muted)" }}>
                    {addiConfigured
                      ? "El cliente podrá continuar a Addi únicamente cuando el pedido esté confirmado. El pago se registra al recibir el callback verificado."
                      : "Primero valida las credenciales de esta tienda arriba; después podrás activarla y mostrarla en el comprobante."}
                  </p>
                ) : null}
              </div>
            ))}

            <div className="mt-2">
              <button
                className="rounded-2xl border px-4 py-2 text-sm font-semibold"
                onClick={() => {
                  const next = [...(settings.payment_methods || [])];
                  next.push({ id: crypto.randomUUID(), provider: "wompi", name: "Wompi", enabled: true, show_on_invoice: true });
                  setSettings((prev) => ({ ...prev, payment_methods: next }));
                }}
              >
                + Añadir opción Wompi
              </button>
              <button
                className="ml-2 rounded-2xl border px-4 py-2 text-sm font-semibold disabled:opacity-50"
                onClick={() => {
                  const next = [...(settings.payment_methods || [])];
                  next.push({
                    id: crypto.randomUUID(),
                    provider: "addi",
                    name: "Addi",
                    enabled: false,
                    show_on_invoice: true,
                  });
                  setSettings((prev) => ({ ...prev, payment_methods: next }));
                }}
              >
                + Añadir opción Addi
              </button>
              <button
                className="ml-2 rounded-2xl border px-4 py-2 text-sm font-semibold disabled:opacity-50"
                onClick={savePaymentMethods}
                disabled={loading || saving || savingPaymentMethods || !store}
              >
                {savingPaymentMethods ? "Guardando métodos..." : "Guardar formas de pago"}
              </button>
            </div>
          </div>

          <div className="mt-4 text-sm" style={{ color: "var(--t-muted)" }}>
            <p>
              Los métodos exactos dependen de la habilitación de tu comercio Wompi. Configura en Wompi el webhook de eventos con esta URL: <code>{typeof window !== "undefined" ? `${window.location.origin}/api/payments/wompi/webhook` : "/api/payments/wompi/webhook"}</code>. Addi opera por su API oficial, con credenciales independientes por tienda; el estado pagado solo se confirma con su callback y después de validar el valor y la moneda.
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
