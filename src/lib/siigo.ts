export type SiigoConfig = {
  apiUrl: string;
  apiToken?: string;
  apiKey?: string;
  companyId?: string;
  invoicePath: string;
};

export function getSiigoConfig(overrideConfig?: Partial<SiigoConfig>): SiigoConfig {
  const apiUrl = overrideConfig?.apiUrl ?? process.env.SIIGO_API_URL;
  const apiToken = overrideConfig?.apiToken ?? process.env.SIIGO_API_TOKEN;
  const apiKey = overrideConfig?.apiKey ?? process.env.SIIGO_API_KEY;
  const companyId = overrideConfig?.companyId ?? process.env.SIIGO_COMPANY_ID;
  const invoicePath = overrideConfig?.invoicePath ?? process.env.SIIGO_INVOICE_PATH ?? "/v1/invoices";

  if (!apiUrl) {
    throw new Error("Falta SIIGO_API_URL en las variables de entorno.");
  }

  if (!apiToken && !apiKey) {
    throw new Error("Falta SIIGO_API_TOKEN o SIIGO_API_KEY en las variables de entorno.");
  }

  return {
    apiUrl: apiUrl.replace(/\/+$/, ""),
    apiToken,
    apiKey,
    companyId: companyId ?? undefined,
    invoicePath,
  };
}

export async function siigoFetch(path: string, body: unknown, overrideConfig?: Partial<SiigoConfig>) {
  const config = getSiigoConfig(overrideConfig);
  const url = `${config.apiUrl}${path}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (config.apiToken) {
    headers.Authorization = `Bearer ${config.apiToken}`;
  }
  if (config.apiKey) {
    headers["x-api-key"] = config.apiKey;
  }
  if (config.companyId) {
    headers["x-company-id"] = config.companyId;
  }
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(
      `Siigo request failed: ${response.status} ${response.statusText} ${JSON.stringify(data)}`
    );
  }

  return data;
}

export async function createSiigoInvoice(payload: unknown, overrideConfig?: Partial<SiigoConfig>) {
  const invoicePath = overrideConfig?.invoicePath ?? getSiigoConfig(overrideConfig).invoicePath;
  return await siigoFetch(invoicePath, payload, overrideConfig);
}

