/**
 * Lo que REM sabe de cada módulo de RemHub: para qué sirve y cómo se hacen las tareas principales.
 *
 * Reglas para editar este archivo (las revisa tests/rem/catalog-sync.test.ts):
 *   · `path` tiene que ser una página real (src/app/dashboard/.../page.tsx).
 *   · `about` describe lo que la pantalla hace HOY. Si cambia la pantalla, se cambia aquí.
 *   · `howto.steps` solo con pasos leídos en el código (`verified: true`). Si no se han revisado, no se ponen pasos:
 *     REM explica para qué sirve y ofrece abrirlo.
 *   · Los permisos NO van aquí: salen del buscador (src/lib/search-index.ts) y del menú (src/lib/module-tabs.ts).
 *     Que REM sepa explicar algo no quiere decir que la persona lo pueda abrir.
 */

export type HowTo = {
  id: string;
  /** Qué se quiere lograr («crear un producto»). */
  goal: string;
  /** Palabras que lo piden: el objeto («producto») y sus sinónimos. */
  keywords: string;
  steps: string[];
  /** A dónde llevar si dice «sí, ábrelo». Tiene que estar en el buscador (search-index). */
  href?: string;
  /** Si la pantalla lo hace por voz: qué decirle a REM. */
  voice?: string;
  /** true: los pasos se leyeron en el código de la pantalla. */
  verified: boolean;
};

export type ModuleInfo = {
  id: string;
  name: string;
  /** Página principal del módulo. */
  path: string;
  /** Cómo le dice la gente («ventas», «el pos», «la caja registradora»). */
  aliases: string;
  /** Palabras que, dichas solas, son este módulo y no otro («nómina» = Gastos y nómina, no Nómina electrónica). Separadas por «|». */
  keys?: string;
  about: string;
  howto?: HowTo[];
  /** Formularios de «crear» que no viven en la misma ruta (Productos → /dashboard/products/crear). */
  creates?: string[];
};

export const MODULES: ModuleInfo[] = [
  {
    id: "home", name: "Inicio e informes", path: "/dashboard",
    aliases: "inicio informes reportes estadisticas resumen tablero principal informe de ventas cierre del dia",
    about: "Es la primera pantalla: tus pendientes, las ventas de hoy de tus puntos comparadas con ayer, lo más vendido de la semana, las metas del mes y el cierre del día.",
  },
  {
    id: "pos", name: "POS / Vender", path: "/dashboard/pos",
    aliases: "pos punto de venta vender venta facturar remision cobrar caja registradora", keys: "pos|punto de venta|vender",
    about: "Es donde se vende en el mostrador: buscas los productos, también con la cámara, armas la venta, eliges el cliente y la forma de pago y cobras. La venta descuenta las existencias del punto.",
    howto: [{
      id: "pos.sell", goal: "hacer una venta", keywords: "venta vender facturar cobrar remision",
      // Pasos manuales del POS sin revisar todavía: REM ofrece hacerla por voz o abrir el POS.
      steps: [], href: "/dashboard/pos", voice: "Dime «vender» y armamos la venta hablando; antes de guardarla te pregunto.", verified: true,
    }],
  },
  {
    id: "cash", name: "Caja", path: "/dashboard/caja",
    aliases: "caja arqueo cierre de caja efectivo turno abrir caja cerrar caja", keys: "caja|arqueo",
    about: "Sirve para abrir y cerrar la caja de cada punto, contar el efectivo y ver si hay diferencias.",
  },
  {
    id: "layaways", name: "Apartados y cotizaciones", path: "/dashboard/apartados",
    aliases: "apartados separados abonos cotizaciones presupuestos",
    about: "Para separar productos a un cliente que va abonando, y para hacer cotizaciones.",
  },
  {
    id: "promos", name: "Promociones y combos", path: "/dashboard/promociones",
    aliases: "promociones promos combos descuentos ofertas",
    about: "Para crear descuentos, ofertas y combos de productos.",
  },
  {
    id: "warranty", name: "Garantías y devoluciones", path: "/dashboard/garantias",
    aliases: "garantias devoluciones cambios reclamos",
    about: "Para registrar garantías, cambios y devoluciones de lo vendido.",
  },
  {
    id: "fiscal", name: "Factura electrónica", path: "/dashboard/fiscal",
    aliases: "factura electronica facturacion electronica dian documentos electronicos resoluciones numeracion", keys: "factura electronica|facturacion electronica|dian",
    about: "Para la facturación electrónica ante la DIAN: los documentos enviados, los que están pendientes o rechazados y la numeración con sus resoluciones.",
  },
  {
    id: "billing", name: "Datos de facturación", path: "/dashboard/store/billing",
    aliases: "datos de facturacion datos fiscales",
    about: "Son los datos de facturación de la tienda. Solo los ve el dueño o el administrador.",
  },
  {
    id: "products", name: "Productos", path: "/dashboard/products",
    aliases: "productos articulos referencias items mercancia catalogo de productos", keys: "producto|productos|articulos|referencias",
    about: "Es la lista de productos de la tienda: los buscas, los filtras, los editas, cambias fotos y precios, los activas o inactivas y los marcas para publicar en redes con Publícame.",
    creates: ["/dashboard/products/crear", "/dashboard/products/importar"],
    howto: [{
      id: "products.create", goal: "crear un producto", keywords: "producto articulo referencia item",
      steps: [
        "Abre Productos y toca «Nuevo producto».",
        "En «Lo básico», solo el nombre es obligatorio. Puedes poner foto, descripción corta, código y categoría.",
        "En «Precios» va el porcentaje de ganancia de cada lista. El precio sale solo cuando ingresas la factura de compra con el costo.",
        "Fotos y videos, descripción completa y características son opcionales.",
        "Toca «Crear producto».",
      ],
      href: "/dashboard/products/crear", verified: true,
    }, {
      id: "products.import", goal: "subir productos desde Excel", keywords: "excel importar masivo plantilla cargar subir",
      steps: [], href: "/dashboard/products/importar", verified: false,
    }],
  },
  {
    id: "radar", name: "Radar de productos", path: "/dashboard/products/radar",
    aliases: "radar falencias publicame publicar productos sin foto sin precio quietos",
    about: "Revisa los productos y te dice qué les falta: sin foto, sin precio, quietos o sin ventas. También arma el plan del día para publicar en redes con recordatorio, y desde ahí puedes inactivar los que ya no hay.",
  },
  {
    id: "product-list", name: "Lista general de productos", path: "/dashboard/lista-productos",
    aliases: "lista general lista de precios consultar precios",
    about: "Es para consultar productos y precios sin poder cambiarlos.",
  },
  {
    id: "categories", name: "Categorías", path: "/dashboard/categories",
    aliases: "categorias grupos familias",
    about: "Agrupa los productos para ordenar el catálogo y los informes.",
  },
  {
    id: "inventory", name: "Inventario", path: "/dashboard/inventario",
    aliases: "inventario stock existencias bodega bodegas traslados ajustes kardex conteos compras facturas de compra proveedores cuentas por pagar", keys: "inventario|stock|existencias|traslados|kardex|compras|cuentas por pagar",
    about: "Aquí se maneja la mercancía: existencias por punto y bodega, traslados entre puntos, ajustes, conteos, kardex, facturas de compra, proveedores, cuentas por pagar, la cuenta con los puntos y los vencimientos. El costo y las existencias entran con la factura de compra.",
    howto: [{
      id: "inventory.purchase", goal: "ingresar una factura de compra", keywords: "compra factura proveedor ingreso mercancia ingresar",
      steps: [
        "Abre Inventario y luego Facturas de compra.",
        "Registra la factura del proveedor con los productos, las cantidades y los costos. También se puede cargar el XML.",
        "Con eso suben las existencias y los precios se calculan con el porcentaje de ganancia de la tienda.",
      ],
      href: "/dashboard/inventario?tab=purchases", voice: "También puedes decirme «registrar una compra».", verified: true,
    }, {
      id: "inventory.transfer", goal: "hacer un traslado", keywords: "traslado trasladar enviar mercancia mover bodega punto",
      steps: [], href: "/dashboard/inventario?tab=transfers",
      voice: "Dime «quiero hacer un traslado» y lo hacemos hablando: me dices los productos y las cantidades, y antes de enviarlo te pregunto «¿Lo envío?».", verified: true,
    }, {
      id: "inventory.count", goal: "hacer un conteo", keywords: "conteo contar inventario fisico",
      steps: [], href: "/dashboard/inventario?tab=conteos", voice: "Abre o empieza un conteo y dime «quiero hacer un conteo»: te sigo por voz.", verified: true,
    }],
  },
  {
    id: "orders", name: "Pedidos", path: "/dashboard/pedidos",
    aliases: "pedidos pedidos de clientes pedidos internos solicitudes whatsapp ventas en linea", keys: "pedido|pedidos|pedidos internos|pedidos de clientes",
    about: "Tiene dos partes: los pedidos de clientes que llegan por el catálogo o WhatsApp, y los pedidos internos, cuando un punto le pide mercancía a la bodega.",
    howto: [{
      id: "orders.internal", goal: "hacer un pedido interno", keywords: "pedido interno pedir mercancia solicitar bodega",
      steps: [], href: "/dashboard/pedidos?tab=internos&nuevo=1", voice: "Toca «Nuevo pedido» y dime «quiero hacer un pedido interno»: te sigo por voz.", verified: true,
    }],
  },
  {
    id: "operations", name: "Centro de operaciones", path: "/dashboard/operaciones",
    aliases: "centro de operaciones documentos movimientos",
    about: "Reúne los documentos y movimientos de la tienda en un solo lugar: ventas, pedidos, traslados y lo de inventario.",
  },
  {
    id: "clients", name: "Terceros y cartera", path: "/dashboard/clientes",
    aliases: "clientes terceros proveedores cartera creditos fiado deudas cobrar avisos de cobro fidelidad", keys: "cliente|clientes|tercero|terceros|cartera|fiado|creditos",
    about: "Aquí están los clientes y los proveedores, la cartera con lo que te deben, los avisos de cobro por WhatsApp, los clientes frecuentes y los puntos de fidelidad.",
  },
  {
    id: "social", name: "Catálogos y campañas", path: "/dashboard/social",
    aliases: "catalogos catalogo en linea tienda en linea campanas redes carrusel catalogo pdf", keys: "catalogo|catalogos|campanas",
    about: "Para los catálogos en línea que compartes con los clientes, el catálogo en PDF y las campañas para redes.",
  },
  {
    id: "landing", name: "Landing pages", path: "/dashboard/landing",
    aliases: "landing landing pages pauta anuncios pagina de producto",
    about: "Páginas de un producto para pauta y anuncios, con inventario aparte por punto y sus ventas y ganancia aparte.",
  },
  {
    id: "messages", name: "Mensajes", path: "/dashboard/mensajes",
    aliases: "mensajes chat llamadas equipo",
    about: "Chat y llamadas con el equipo de la tienda.",
  },
  {
    id: "profit", name: "Rentabilidad", path: "/dashboard/rentabilidad",
    aliases: "rentabilidad ganancia utilidad margen precios por punto limites de precio liquidaciones repartos simulador", keys: "rentabilidad|ganancia|ganancias|utilidad|liquidacion|liquidaciones",
    about: "Muestra la ganancia, que es la venta menos el costo, por punto y por producto. También están los precios por punto, los límites de precio, los repartos y liquidaciones de la ganancia y un simulador de precios.",
  },
  {
    id: "expenses", name: "Gastos y nómina", path: "/dashboard/gastos",
    aliases: "gastos egresos nomina sueldos empleados vales prestamos presupuestos gastos fijos reservas", keys: "gasto|gastos|nomina|nominas|sueldos|vales|prestamos|empleados|presupuestos",
    about: "Para los gastos de la tienda y de cada punto, los gastos fijos, los presupuestos, la nómina de los empleados, los vales y préstamos y las reservas.",
    howto: [{
      id: "expenses.create", goal: "registrar un gasto", keywords: "gasto egreso pago salida",
      steps: [
        "Abre Gastos y nómina, luego Gastos, y toca «Nuevo gasto».",
        "Pon cuánto fue, el valor total con impuestos, la categoría y en qué se gastó.",
        "Pon la fecha del gasto y, si se debe, la fecha límite de pago.",
        "Elige de quién es el gasto, la tienda o un punto, y guarda.",
      ],
      href: "/dashboard/gastos?tab=expenses&nuevo=gasto", verified: true,
    }],
  },
  {
    id: "team", name: "Comisiones y metas", path: "/dashboard/equipo",
    aliases: "comisiones metas ranking vendedores",
    about: "Las metas del mes por punto o por vendedor, cómo van, y las comisiones.",
  },
  {
    id: "payroll-e", name: "Nómina electrónica", path: "/dashboard/nomina-electronica",
    aliases: "nomina electronica dian", keys: "nomina electronica",
    about: "Para enviar la nómina electrónica a la DIAN.",
  },
  {
    id: "accountant", name: "Para el contador", path: "/dashboard/contador",
    aliases: "contador contabilidad asientos puc exportar siigo world office",
    about: "Arma los asientos contables con el PUC para exportarlos al programa del contador.",
  },
  {
    id: "store", name: "Mi tienda", path: "/dashboard/store",
    aliases: "mi tienda datos de la tienda logo nombre redes enlaces whatsapp",
    about: "Los datos de la tienda: logo, nombre, redes, enlaces y WhatsApp.",
  },
  {
    id: "plan", name: "Mi plan", path: "/dashboard/plan",
    aliases: "mi plan suscripcion mensualidad pagar remhub",
    about: "Tu plan de RemHub y sus pagos. Solo lo ven el dueño y el administrador.",
  },
  {
    id: "users", name: "Usuarios y permisos", path: "/dashboard/store/users",
    aliases: "usuarios permisos roles accesos equipo", keys: "usuarios|permisos|roles",
    about: "Para crear los usuarios del equipo y decidir qué puede hacer cada uno.",
  },
  {
    id: "points", name: "Puntos", path: "/dashboard/puntos",
    aliases: "puntos sedes sucursales puntos de venta",
    about: "Para configurar los puntos de venta y las bodegas de la tienda.",
  },
  {
    id: "optional", name: "Funciones opcionales", path: "/dashboard/vender-mas",
    aliases: "funciones opcionales vender mas carritos abandonados avisame cupones envio gratis recompra",
    about: "Funciones que se encienden o se apagan, como carritos abandonados, «Avísame cuando llegue», cupones, envío gratis y recompra. Vienen apagadas.",
  },
  {
    id: "data", name: "Importar y exportar", path: "/dashboard/datos",
    aliases: "importar exportar excel descargar subir datos", keys: "datos|importar|exportar|importar y exportar",
    about: "Para descargar en Excel los datos de la tienda y para subir datos desde Excel.",
  },
  {
    id: "security", name: "Copias y seguridad", path: "/dashboard/seguridad",
    aliases: "copias de seguridad respaldo backup seguridad",
    about: "Para las copias de seguridad de la tienda.",
  },
  {
    id: "audit", name: "Auditoría", path: "/dashboard/auditoria",
    aliases: "auditoria quien hizo historial de cambios espia",
    about: "Muestra quién hizo qué, cuándo y qué cambió en la tienda.",
  },
];

/** El módulo de una ruta: el de ruta más larga que coincide (/dashboard/products/radar es Radar, no Productos). */
export function moduleOfPath(path: string): ModuleInfo | null {
  const p = path.split("?")[0].replace(/\/+$/, "") || "/";
  const hits = MODULES.filter((m) => p === m.path || p.startsWith(m.path + "/"));
  return hits.sort((a, b) => b.path.length - a.path.length)[0] ?? null;
}
