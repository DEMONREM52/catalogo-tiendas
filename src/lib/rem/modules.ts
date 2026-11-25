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
    about: "Es donde se vende en el mostrador: buscas los productos, también con la cámara, armas la venta, eliges el cliente y la forma de pago y cobras. La venta descuenta las existencias del punto. Debajo del carrito sugiere lo que más se vende junto con lo que llevas («también llevan»). Antes de cobrar dice en una frase qué se va a crear (remisión o factura electrónica, número, punto y si va a la DIAN); al terminar muestra el número, el vuelto, si la DIAN la aceptó y botones para imprimir, mandarla por WhatsApp o empezar otra venta. En el celular se cobra en una sola hoja.",
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
    howto: [{
      id: "cash.open", goal: "abrir la caja", keywords: "abrir caja abro la caja base inicial empezar turno",
      steps: ["Abre Caja y, en tu punto, toca «Abrir caja».", "Cuenta el efectivo con el que empiezas y escríbelo como base inicial. La nota es opcional.", "Toca «Abrir caja»."],
      href: "/dashboard/caja", verified: true,
    }, {
      id: "cash.close", goal: "cerrar la caja", keywords: "cerrar caja cierro la caja cierre arqueo cuadrar",
      steps: ["Abre Caja y, en tu punto, toca «Cerrar caja». Te dice cuánto debe haber.", "Cuenta billetes y monedas, o escribe el total contado.", "El sistema calcula la diferencia. Toca «Cerrar caja»."],
      href: "/dashboard/caja", verified: true,
    }],
  },
  {
    id: "layaways", name: "Apartados y cotizaciones", path: "/dashboard/apartados",
    aliases: "apartados separados abonos cotizaciones presupuestos",
    about: "Para separar productos a un cliente que va abonando, y para hacer cotizaciones.",
    howto: [{
      id: "layaways.create", goal: "hacer un apartado", keywords: "apartado apartar aparto separar separo separado abono producto",
      steps: ["Abre el POS y arma el carrito con lo que el cliente quiere separar.", "Toca «📌 Apartar». Las unidades quedan reservadas.", "Cuando el cliente abone, en Apartados toca «💵 Abonar». Para entregarlo, desde Apartados se abre el POS con la venta lista."],
      href: "/dashboard/pos", verified: true,
    }, {
      id: "quotes.create", goal: "hacer una cotización", keywords: "cotizacion cotizar presupuesto",
      steps: ["Abre el POS y arma el carrito.", "Toca «📝 Cotizar». Se guarda y la puedes compartir por WhatsApp.", "Las cotizaciones quedan en Apartados y cotizaciones."],
      href: "/dashboard/pos", verified: true,
    }],
  },
  {
    id: "promos", name: "Promociones y combos", path: "/dashboard/promociones",
    aliases: "promociones promos combos descuentos ofertas",
    about: "Para crear descuentos, ofertas y combos de productos.",
    howto: [{
      id: "promos.create", goal: "crear una promoción", keywords: "promocion promo descuento oferta",
      steps: [
        "Abre Promociones y combos y toca «➕ Nueva promoción».",
        "Ponle un nombre y elige el tipo: porcentaje de descuento o precio fijo, con su valor.",
        "Elige a qué aplica: productos elegidos, una categoría o toda la tienda.",
        "Pon desde y hasta qué día, y en qué puntos; si no marcas ninguno, aplica en todos.",
        "Toca «💾 Guardar promoción».",
      ],
      href: "/dashboard/promociones", verified: true,
    }],
  },
  {
    id: "warranty", name: "Garantías y devoluciones", path: "/dashboard/garantias",
    aliases: "garantias devoluciones cambios reclamos",
    about: "Para registrar garantías, cambios y devoluciones de lo vendido.",
    howto: [{
      id: "warranty.create", goal: "registrar una garantía o devolución", keywords: "garantia devolucion reclamo cambio falla devuelve",
      steps: [
        "Abre Garantías y devoluciones y toca «➕ Recibir garantía o devolución».",
        "Elige si es garantía, porque falla, o devolución, porque no lo quiere, y el punto.",
        "Busca el producto, escribe el cliente y qué falla o por qué lo devuelve. Celular, factura y fecha de compra son opcionales.",
        "Toca «💾 Recibir». Si el producto dañado sale del inventario, hazlo con un ajuste «Producto dañado».",
      ],
      href: "/dashboard/garantias", verified: true,
    }],
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
    about: "Es la lista de productos de la tienda: los buscas, los filtras, los editas, cambias fotos y precios, los activas o inactivas y los marcas para publicar en redes con Publícame. Si tocas el nombre de un producto en la lista se abre la edición rápida (foto, nombre, código de barras, categorías y descripción). Con F2 buscas otro producto para editar, también desde la pantalla de editar; si tienes cambios sin guardar te pregunta si guardas antes de cambiar. En cada producto, en Precios, «Precio en los puntos» muestra lo que cobra el POS de cada punto (el precio de la tienda con la regla del punto). También ahí eliges qué etiquetas se ven en el catálogo y desde/hasta cuándo: Llegó nuevo, Bajó de precio (con el precio de antes que escribas), En promoción y Destacado.",
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
    aliases: "radar falencias publicame publicar productos sin foto sin precio quietos volvio llegaron codigo en el nombre",
    about: "Revisa los productos y te dice qué les falta: sin foto, sin precio, quietos o sin ventas, o con un código metido en el nombre. También arma el plan del día para publicar en redes con recordatorio, muestra lo que llegó o volvió en los últimos 7 días (y lo que llegó sin foto o sin categoría), y desde ahí puedes inactivar los que ya no hay.",
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
    howto: [{
      id: "categories.create", goal: "crear una categoría", keywords: "categoria grupo familia",
      steps: ["Abre Categorías y toca «+ Nueva». Aparece una que se llama «Nueva categoría».", "Cámbiale el nombre y, si quieres, súbele una imagen.", "Toca «Guardar»."],
      href: "/dashboard/categories", verified: true,
    }],
  },
  {
    id: "inventory", name: "Inventario", path: "/dashboard/inventario",
    aliases: "inventario stock existencias bodega bodegas traslados ajustes kardex conteos compras facturas de compra proveedores cuentas por pagar", keys: "inventario|stock|existencias|traslados|kardex|compras|cuentas por pagar",
    about: "Aquí se maneja la mercancía: existencias por punto y bodega, traslados entre puntos, ajustes y auditorías de conteo (qué cuadra, qué sobra, qué falta y qué quedó sin contar), conteos, kardex, facturas de compra, proveedores, cuentas por pagar, la cuenta con los puntos y los vencimientos. El costo y las existencias entran con la factura de compra. En un punto con crédito, cada ajuste mueve su deuda con la bodega: lo que falta la baja y lo que sobra la sube, a precio de bodega (antes de aplicar te muestra cuánto). En el ingreso y en los ajustes, quien tiene permiso de Productos toca el nombre de un producto para editarlo rápido (foto, nombre, código de barras, categorías y descripción).",
    howto: [{
      id: "inventory.purchase", goal: "ingresar una factura de compra", keywords: "compra factura de compra ingreso mercancia ingresar xml",
      steps: [
        "Abre Inventario y luego Facturas de compra.",
        "Registra la factura del proveedor con los productos, las cantidades y los costos. También se puede cargar el XML, o un Excel o CSV con «📊 Cargar Excel o CSV» (reconoce los productos y crea los que falten antes de pasarlos a la factura).",
        "Si un producto está inactivo, igual sale en el buscador marcado «Inactivo»: lo agregas y lo activas ahí mismo o al registrar.",
        "Con «⚡ Editar rápido», debajo del nombre de cada producto, le cambias la foto, el nombre, el código de barras, las categorías o la descripción sin salir de la factura.",
        "Con «+ cód. proveedor» anotas cómo llama el proveedor a ese producto: al registrar queda aprendido y el buscador lo encuentra con ese código.",
        "Debajo de cada costo sale cuánto cambió frente a la última compra. Si cambia más del % de aviso (20 % si no lo cambias), al registrar te pide confirmar.",
        "Con eso suben las existencias y los precios se calculan con el porcentaje de ganancia de la tienda.",
      ],
      href: "/dashboard/inventario?tab=purchases", voice: "También puedes decirme «registrar una compra».", verified: true,
    }, {
      id: "inventory.purchase_order", goal: "hacer una orden de compra", keywords: "orden de compra ordenes de compra pedido pedir mercancia",
      steps: [
        "Abre Inventario, luego Compras y pagos, y la pestaña Órdenes de compra. Toca «＋ Nueva orden».",
        "Elige el proveedor, la fecha en que debe llegar y agrega los productos con su cantidad y el costo esperado. Toca «Guardar orden». No mueve el inventario.",
        "Puedes mandársela al proveedor con «Enviar por WhatsApp» o «Copiar».",
        "Cuando llegue la mercancía, abre la orden y toca «Recibir con factura»: la factura se llena con lo pendiente. Al registrarla, la orden compara lo pedido con lo que llegó.",
      ],
      href: "/dashboard/inventario?tab=orders", verified: true,
    }, {
      id: "inventory.transfer", goal: "hacer un traslado", keywords: "traslado trasladar enviar mercancia mover bodega punto",
      steps: [], href: "/dashboard/inventario?tab=transfers",
      voice: "Dime «quiero hacer un traslado» y lo hacemos hablando: me dices los productos y las cantidades, y antes de enviarlo te pregunto «¿Lo envío?».", verified: true,
    }, {
      id: "inventory.count", goal: "hacer un conteo", keywords: "conteo contar inventario fisico",
      steps: [], href: "/dashboard/inventario?tab=conteos", voice: "Abre o empieza un conteo y dime «quiero hacer un conteo»: te sigo por voz.", verified: true,
    }, {
      id: "inventory.audit", goal: "hacer una auditoría del inventario", keywords: "auditoria auditar rectificar cuadrar inventario conteo fisico que falta contar pendientes por contar faltantes sobrantes",
      steps: [
        "Abre Inventario y luego Ajustes. Elige la bodega y deja el motivo «Conteo físico».",
        "Arriba sale cuántos llevas contados y cuántos faltan de lo que el sistema dice que hay. Con «🔎 Ver lo que falta contar» ves esa lista: en cada producto toca «Contar» y escribe lo que contaste, o «No está» para que entre en 0.",
        "Toca «✅ Aplicar conteo y ver la auditoría». Te muestra cuántos cuadran, cuántos sobran, cuántos faltan y cuántos quedan sin contar. Confirma con «Aplicar y guardar auditoría».",
        "Solo se ajusta lo que sobra o falta. Lo que no contaste no se toca y queda en «Pendientes por contar» hasta que lo cuentes. El informe queda en «🔎 Auditorías de conteo», con Excel e Imprimir.",
      ],
      href: "/dashboard/inventario?tab=adjustments", verified: true,
    }],
  },
  {
    id: "orders", name: "Pedidos", path: "/dashboard/pedidos",
    aliases: "pedidos pedidos de clientes pedidos internos solicitudes whatsapp ventas en linea", keys: "pedido|pedidos|pedidos internos|pedidos de clientes",
    about: "Tiene dos partes: los pedidos de clientes que llegan por el catálogo o WhatsApp, y los pedidos internos, cuando un punto le pide mercancía a la bodega. Al recibir un pedido interno, si llegó un producto que no venía en el envío, se toca «📦 Llegó algo más»: se suma al traslado y queda en el chat para revisarlo.",
    howto: [{
      id: "orders.internal", goal: "hacer un pedido interno", keywords: "pedido interno pedir mercancia solicitar bodega",
      steps: [], href: "/dashboard/pedidos?tab=internos&nuevo=1", voice: "Toca «Nuevo pedido» y dime «quiero hacer un pedido interno»: te sigo por voz.", verified: true,
    }, {
      id: "orders.by_product", goal: "buscar los pedidos que llevan un producto", keywords: "buscar pedido producto nombre codigo quien compro que pedidos llevan",
      steps: [
        "Abre Pedidos, pestaña «Pedidos de clientes».",
        "En «Buscar» escribe el nombre del producto o su código. No importan las tildes ni el orden de las palabras.",
        "Salen los pedidos que lo llevan, con el producto debajo. Si no aparece, toca «Ver en Todos» o «Buscar en todo el historial».",
      ],
      href: "/dashboard/pedidos?tab=clientes", verified: true,
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
    about: "Aquí están los clientes y los proveedores, la cartera con lo que te deben (abonos, notas crédito y débito, y el estado de cuenta para mandarle al cliente por WhatsApp o en PDF), los avisos de cobro por WhatsApp, los clientes frecuentes y los puntos de fidelidad. Consumidor final no puede tener crédito.",
    howto: [{
      id: "clients.create", goal: "crear un cliente", keywords: "cliente tercero proveedor persona empresa",
      steps: [
        "Abre Terceros y cartera y toca «Nuevo tercero».",
        "Si es una persona: nombre completo, tipo y número de documento. Si es una empresa: razón social y NIT; el dígito de verificación se calcula solo.",
        "Celular, correo, dirección y cupo de crédito son opcionales.",
        "Toca «Crear tercero». Si el documento ya existe, te avisa.",
      ],
      href: "/dashboard/clientes", verified: true,
    }, {
      id: "clients.statement", goal: "mandarle el estado de cuenta a un cliente", keywords: "estado de cuenta extracto enviar mandar cliente deuda saldo pdf",
      steps: [
        "Abre Terceros y cartera, pestaña «Cartera».",
        "En la fila del cliente toca «Estado de cuenta».",
        "Toca «Enviar por WhatsApp», o «Ver, imprimir o PDF», o «Copiar enlace». El enlace vence en 30 días.",
      ],
      href: "/dashboard/clientes?tab=cartera", verified: true,
    }, {
      id: "clients.credit_note", goal: "hacer una nota crédito o débito", keywords: "nota credito nota debito ajuste descuento bajar subir deuda cartera",
      steps: [
        "Abre Terceros y cartera, pestaña «Cartera», y toca «Estado de cuenta» del cliente.",
        "En el documento toca «Nota crédito» para bajar la deuda o «Nota débito» para subirla. Necesitas el permiso «Créditos» y el documento debe estar confirmado.",
        "Elige el motivo, escribe el valor (la nota crédito no puede pasar del saldo) y el detalle, y confirma.",
        "Queda con número (NC-00001 o ND-00001) en la pestaña «Notas», en el estado de cuenta y en auditoría. Se puede anular con motivo.",
        "Si devuelven productos, toca «Devolver productos» en el documento y escribe cuántas unidades de cada uno: vuelven a la bodega, se quitan del documento y la deuda baja. Pide también el permiso «Devolución de venta» y no se puede anular.",
      ],
      href: "/dashboard/clientes?tab=cartera", verified: true,
    }],
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
    aliases: "gastos egresos nomina sueldos empleados vales prestamos presupuestos gastos fijos reservas flujo de caja", keys: "gasto|gastos|nomina|nominas|sueldos|vales|prestamos|empleados|presupuestos",
    about: "Para los gastos de la tienda y de cada punto, los gastos fijos, los presupuestos, la nómina de los empleados, los vales y préstamos y las reservas. El dueño o el administrador ven además el flujo de caja de los próximos 30 días: lo que entra (ventas promedio y cartera) frente a lo que sale (proveedores, gastos y nómina).",
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
    howto: [{
      id: "users.create", goal: "crear un usuario", keywords: "usuario empleado acceso persona del equipo vendedor sistema entrar ingresar al sistema",
      steps: [
        "Abre Usuarios y toca «Nuevo usuario».",
        "Pon el nombre visible, el usuario con el que va a entrar y una contraseña inicial de al menos 4 caracteres. Compártela por un canal privado.",
        "Elige en qué punto trabaja y dale permisos: una plantilla o uno por uno. Necesita al menos uno.",
        "Toca «Crear usuario».",
      ],
      href: "/dashboard/store/users", verified: true,
    }],
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
