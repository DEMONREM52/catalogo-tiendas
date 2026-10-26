// Paquetes de implementación (opcionales: el cliente siempre puede arrancar solo con las guías).
// Son pagos únicos, aparte de la mensualidad. Para cambiar un precio basta con editarlo aquí.

export type ImplementationPackage = {
  id: string;
  name: string;
  price: number;
  /** «desde»: el precio final depende del tamaño (puntos, cantidad de productos). */
  from?: boolean;
  unit?: string;
  tagline: string;
  includes: string[];
  highlight?: boolean;
};

export const IMPLEMENTATION_PACKAGES: ImplementationPackage[] = [
  {
    id: "autoservicio",
    name: "Autoservicio",
    price: 0,
    tagline: "Lo haces tú, a tu ritmo.",
    includes: ["Guías y videos paso a paso", "Plantillas de Excel para subir todo", "Ayuda por WhatsApp en horario de oficina"],
  },
  {
    id: "puesta-en-marcha",
    name: "Puesta en marcha",
    price: 450_000,
    from: true,
    tagline: "Me mandas tus Excel y te la entrego lista.",
    includes: [
      "Cargo productos, terceros, cartera y deudas con proveedores",
      "Configuro puntos, bodegas, usuarios y permisos",
      "Dejo la impresora y el lector funcionando",
      "2 horas de capacitación por videollamada",
    ],
    highlight: true,
  },
  {
    id: "completa",
    name: "Implementación completa",
    price: 1_200_000,
    from: true,
    tagline: "Todo listo, incluida la factura electrónica.",
    includes: [
      "Todo lo de la puesta en marcha",
      "Habilitación de factura electrónica con la DIAN",
      "Numeración de contingencia por si se cae la DIAN o el internet",
      "6 horas de capacitación para tu equipo",
      "Acompañamiento de 30 días",
    ],
  },
];

export const IMPLEMENTATION_EXTRAS: Array<{ name: string; price: number; unit: string; from?: boolean }> = [
  { name: "Habilitación de factura electrónica sola", price: 200_000, unit: "una vez", from: true },
  { name: "Hora adicional de capacitación o soporte", price: 100_000, unit: "la hora" },
];

export const IMPLEMENTATION_TERMS = "Sin anticipo que se pierda ni permanencia: la implementación se paga 50 % al empezar y 50 % al entregar. La mensualidad es mes a mes.";

/** Comparación con los sistemas tradicionales (sin nombrar a nadie): lo que el cliente suele encontrar allá. */
export const TRADITIONAL_VS_REMHUB: Array<{ topic: string; traditional: string; remhub: string }> = [
  { topic: "Implementación", traditional: "Millones de pesos y obligatoria", remhub: "Opcional, desde $0" },
  { topic: "Forma de pago", traditional: "Anticipo y saldo en 45 días, aunque no hayas arrancado", remhub: "50 % al empezar y 50 % al entregar" },
  { topic: "Permanencia", traditional: "Contratos y la base se inactiva si te atrasas", remhub: "Mes a mes; tus datos siempre son tuyos" },
  { topic: "Cajas o puntos extra", traditional: "Cerca de $95.000 al mes cada uno", remhub: "Desde $24.900 al mes" },
  { topic: "Usuarios adicionales", traditional: "Se cobran aparte cada mes", remhub: "Incluidos según el plan" },
  { topic: "App en el celular", traditional: "Módulo aparte", remhub: "Incluida (se instala desde el navegador)" },
  { topic: "Sin internet", traditional: "Depende del servidor del local", remhub: "Sigue vendiendo y sube todo al volver" },
  { topic: "Catálogo y pedidos por WhatsApp", traditional: "No viene o se paga aparte", remhub: "Incluido, con 5 listas de precios" },
  { topic: "Sacar tus datos", traditional: "Hay que pedirlo", remhub: "Todo a Excel con un clic" },
];
