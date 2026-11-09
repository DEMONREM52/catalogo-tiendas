/**
 * Plantillas de mensajes para publicar productos. El texto lleva variables entre llaves ({nombre}, {precio}…)
 * que se reemplazan con los datos del producto. Si una variable queda vacía, esa línea se quita.
 * Escrita en mayúsculas ({NOMBRE}) pone el dato en MAYÚSCULAS. *texto* sale en negrilla en WhatsApp.
 */

export type TemplateVars = {
  nombre: string;
  precio: string;
  precio_antes: string;
  descuento: string;
  descripcion: string;
  caracteristicas: string;
  enlace: string;
  categoria: string;
  codigo: string;
  tienda: string;
  whatsapp: string;
};

export const VARIABLES: Array<{ key: keyof TemplateVars; label: string; example: string }> = [
  { key: "nombre", label: "Nombre", example: "Excavadora a control remoto" },
  { key: "precio", label: "Precio", example: "$63.000" },
  { key: "precio_antes", label: "Precio de antes", example: "$80.000" },
  { key: "descuento", label: "Descuento", example: "-21%" },
  { key: "descripcion", label: "Descripción", example: "Movimientos realistas, ideal para los pequeños." },
  { key: "caracteristicas", label: "Características", example: "✅ Control 2.4 GHz\n✅ Rotación de 360°" },
  { key: "enlace", label: "Enlace", example: "https://remhub.co/mitienda/producto/123" },
  { key: "categoria", label: "Categoría", example: "Juguetería" },
  { key: "codigo", label: "Código", example: "9808" },
  { key: "tienda", label: "Tienda", example: "La Vitrina" },
  { key: "whatsapp", label: "WhatsApp", example: "300 123 4567" },
];

export type PublishTemplate = { id: string; name: string; body: string; is_default?: boolean; builtin?: boolean; /** Catálogo al que lleva {enlace} (null = el clásico). */ catalog_slug?: string | null };
export type CatalogOption = { slug: string; name: string; access_key: string | null };

export const BUILTIN_TEMPLATES: PublishTemplate[] = [
  {
    id: "builtin-estilo", name: "Tu estilo", builtin: true,
    body: "🔥 *{NOMBRE}* 🔥\n💰🔥 *PRECIO: {precio}* 🔥💰\n\n{descripcion}\n\n{caracteristicas}\n\n📲 Pídelo aquí: {enlace}",
  },
  {
    id: "builtin-clasico", name: "Clásico", builtin: true,
    body: "🔥 {nombre} 🔥\n\n{descripcion}\n\n{caracteristicas}\n\n💲 Precio: {precio}\n📲 Pídelo aquí: {enlace}",
  },
  {
    id: "builtin-oferta", name: "Oferta", builtin: true,
    body: "⚡ ¡OFERTA EN {tienda}! ⚡\n\n🛍️ *{NOMBRE}*\n❌ Antes: ~{precio_antes}~\n💥 *HOY: {precio}* ({descuento})\n\n{caracteristicas}\n\n⏳ Por tiempo limitado\n📲 Compra aquí: {enlace}",
  },
  {
    id: "builtin-estado", name: "Corto para estados", builtin: true,
    body: "✨ {nombre}\n💲 {precio}\n👉 {enlace}",
  },
];

/** Reemplaza las variables. Quita las líneas cuyas variables quedaron vacías y los saltos de línea de más. */
export function renderTemplate(body: string, vars: Partial<TemplateVars>): string {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  for (const line of lines) {
    let empty = false;
    const rendered = line.replace(/\{([a-zñáéíóú_]+)\}/gi, (m, raw: string) => {
      const key = raw.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "") as keyof TemplateVars;
      if (!VARIABLES.some((v) => v.key === key)) return m; // llaves que no son variables se dejan tal cual
      let v = String(vars[key] ?? "").trim();
      // {NOMBRE} en mayúsculas pone el valor en MAYÚSCULAS.
      if (raw.length > 1 && raw === raw.toUpperCase() && raw !== raw.toLowerCase()) v = v.toLocaleUpperCase("es-CO");
      if (!v) empty = true;
      return v;
    });
    if (!empty) out.push(rendered.trimEnd());
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Variables que la plantilla usa pero no existen (para avisar al escribirla). */
export function unknownVariables(body: string): string[] {
  const found = [...body.matchAll(/\{([^{}\s]{1,30})\}/g)].map((m) => m[1].toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, ""));
  return [...new Set(found.filter((k) => !VARIABLES.some((v) => v.key === k)))];
}

export const SAMPLE_VARS: TemplateVars = Object.fromEntries(VARIABLES.map((v) => [v.key, v.example])) as TemplateVars;
