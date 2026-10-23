/**
 * Ayuda de cada pantalla del panel: consejos (botón «?») y recorrido guiado paso a paso («▶️ Mostrarme cómo»).
 * Cada paso ilumina un elemento: selector CSS o «text:…» (un botón, enlace o título que contenga ese texto).
 * Si el elemento no está a la vista, el paso se muestra en el centro. El orden importa: la primera coincidencia gana.
 */

export type TourStep = { target?: string | string[]; title: string; text: string };
export type Help = { key: string; match: string; exact?: boolean; title: string; tips: string[]; steps: TourStep[] };

const SEARCH = '[title="Buscar (Ctrl + K)"]';
const HELP_BTN = '[aria-label="Ayuda"]';

export const HELP: Help[] = [
  // ---------------------------------------------------------------- facturación
  { key: "pos", match: "/dashboard/pos", title: "POS / Vender", tips: [
    "Busca por nombre, referencia o escanea el código de barras; F2 abre la búsqueda con fotos.",
    "Las existencias se actualizan solas: si otra persona vende, aquí baja el número («Existencias en vivo»).",
    "Antes de cobrar se revisa que haya unidades; si alguien vendió primero, te ofrecemos ajustar el carrito.",
    "Con la cédula del cliente aparecen sus puntos (⭐) y se canjean como descuento.",
    "📌 Apartar reserva las unidades; 📝 Cotizar guarda y comparte la cotización; 🎁 Combos agrega combos.",
    "¿Quitaste un producto por error? Toca «Deshacer» en el aviso de abajo.",
  ], steps: [
    { target: ["#pos-product-search", 'main input[placeholder*="Busca"]'], title: "1. Busca el producto", text: "Esta es la barra para buscar productos: escribe el nombre o la referencia, o pasa el lector de código de barras. F2 te trae aquí." },
    { target: ["text:Cliente de esta venta", "text:Carrito"], title: "2. El cliente", text: "Si la venta es a un cliente registrado, toca «Elegir cliente» y búscalo por nombre o cédula. Si no, queda como consumidor final." },
    { target: ["text:Detalles de la venta", "text:Carrito"], title: "3. Detalles de la venta", text: "Punto, vendedor, remisión o factura, contado o crédito, y los datos del cliente. Las existencias son las del punto escogido." },
    { target: "text:Carrito", title: "4. El carrito", text: "Aquí cambias cantidades y precios. Si un precio queda bajo tu límite, puedes pedir autorización." },
    { target: "text:Lista de precios", title: "5. Lista de precios", text: "Cambia entre P1 y P5 (por ejemplo, P2 para mayoristas). Las promociones vigentes se aplican solas." },
    { target: "text:Combos", title: "6. Combos, apartados y cotizaciones", text: "🎁 agrega un combo, 📌 aparta (el cliente abona y las unidades quedan reservadas), 📝 guarda una cotización para enviarla por WhatsApp." },
    { target: ["text:Contado", "text:Crédito"], title: "7. Contado o crédito", text: "A crédito necesita un cliente registrado y respeta su cupo. Con 📱 Cobrar con QR muestras el QR de Nequi o del banco." },
    { target: ["text:Crear remisión", "text:Crear factura", "text:Crear factura electrónica"], title: "8. Cobrar (F4)", text: "Antes de guardar se revisa que haya unidades y que los precios estén bien. Se abre el comprobante para imprimir." },
    { target: "text:En espera", title: "9. Venta en espera (F8)", text: "Si el cliente fue por la billetera, deja la venta en espera y atiende a otro. Luego la retomas con un toque." },
  ] },
  { key: "caja", match: "/dashboard/caja", title: "Caja", tips: [
    "Abre la caja al empezar con la base en efectivo.",
    "Al cerrar, cuenta billetes y monedas: el sistema te dice si cuadra, sobra o falta.",
    "Después de cerrar puedes enviar el resumen por WhatsApp (botón 💬 también en el historial).",
  ], steps: [
    { target: ["text:Abrir caja", "main h2"], title: "1. Abre la caja", text: "Al empezar el turno, abre la caja de tu punto con la base en efectivo." },
    { target: ["text:Entrada", "text:Salida", "text:Movimiento"], title: "2. Entradas y salidas", text: "Registra lo que sale (un pago, plata a la bodega) o entra que no sea una venta. Así el cierre cuadra." },
    { target: "text:Cerrar caja", title: "3. Cierra con conteo", text: "Cuenta billetes y monedas. El sistema compara con lo que debía haber y te dice si sobra o falta." },
    { target: ["text:Historial", "text:Cierres"], title: "4. Historial y WhatsApp", text: "Cada cierre queda aquí. Con 💬 mandas el resumen por WhatsApp al dueño o al administrador." },
  ] },
  { key: "apartados", match: "/dashboard/apartados", title: "Apartados y cotizaciones", tips: [
    "Se crean desde el POS con «📌 Apartar» o «📝 Cotizar».",
    "Las unidades apartadas no se pueden vender a otro cliente.",
    "Al entregar, se hace la venta en el POS y la caja se ajusta sola con los abonos.",
  ], steps: [
    { target: "text:Apartados", title: "1. Apartados", text: "El cliente abona y las unidades quedan reservadas en su punto. Aquí ves cuánto lleva abonado y hasta cuándo se le guarda." },
    { target: ["text:Abonar", "text:Abiertos"], title: "2. Abonar", text: "Cada abono queda registrado; si es en efectivo entra a la caja abierta del punto. Puedes avisarle al cliente por WhatsApp." },
    { target: ["text:Entregar", "text:Entregados"], title: "3. Entregar", text: "Cuando está pago, «Entregar» abre el POS con la venta lista. Cobra con «Contado»: la caja se compensa sola." },
    { target: "text:Cotizaciones", title: "4. Cotizaciones", text: "Comparte el enlace por WhatsApp (la hoja se puede imprimir) y conviértela en venta con «💳 Vender»." },
  ] },
  { key: "promociones", match: "/dashboard/promociones", title: "Promociones y combos", tips: [
    "Las promociones se activan y se apagan solas según sus fechas.",
    "Puedes limitarlas a algunos puntos.",
    "Los combos descuentan el inventario de cada producto.",
  ], steps: [
    { target: "text:Nueva promoción", title: "1. Crea una promoción", text: "% de descuento o precio fijo, para productos, una categoría o toda la tienda, con fecha de inicio y fin." },
    { target: ["text:Activa", "text:Programada", "text:Pausar"], title: "2. Se aplica sola", text: "Mientras esté vigente, el POS pone el precio de promoción automáticamente. Puedes pausarla cuando quieras." },
    { target: "text:Combos", title: "3. Combos", text: "Arma combos como «cargador + cable a $25.000». En el POS se agregan con «🎁 Combos»." },
  ] },
  { key: "garantias", match: "/dashboard/garantias", title: "Garantías y devoluciones", tips: [
    "Registra lo que trae el cliente y síguelo hasta entregarlo.",
    "En cada cambio de estado puedes avisarle por WhatsApp.",
    "Si el producto dañado sale del inventario, regístralo en Ajustes → Producto dañado.",
  ], steps: [
    { target: "text:Recibir garantía", title: "1. Recibe el producto", text: "Producto, cliente, la venta y qué falla. Queda con número para seguirlo." },
    { target: ["text:Con el proveedor", "text:Abiertas"], title: "2. Muévelo de estado", text: "Proveedor, reparación, cambio, devolución de dinero o no aplica. Todo queda en el historial con quién y cuándo." },
    { target: ["text:Entregado", "text:Todas"], title: "3. Entrega y cierra", text: "Al entregarlo al cliente, la garantía se cierra. En «Todas» ves las anteriores." },
  ] },
  // ---------------------------------------------------------------- inventario
  { key: "traslados", match: "/dashboard/inventario?tab=transfers", title: "Traslados", tips: [
    "Elige origen y destinos; «💡 Sugerir según ventas» propone cantidades con lo que vendió cada punto.",
    "Enter pasa al siguiente destino; ↑ ↓ cambian de producto; F2 agrega otro.",
    "«Disponible» baja en vivo si otra persona vende o traslada mientras armas el traslado.",
    "Mientras nadie firme «Revisado», el traslado se puede corregir.",
    "🏷️ Etiquetas imprime códigos de barras con el precio del punto que recibe.",
  ], steps: [
    { target: ["text:Nuevo traslado", "text:Origen"], title: "1. Origen y destinos", text: "Elige de dónde sale la mercancía y a qué puntos va (puedes enviar a varios a la vez)." },
    { target: "text:Sugerir según ventas", title: "2. Sugerencia según ventas", text: "Mira lo que vendió cada destino y propone cuánto enviar para que le alcance 7, 15 o 30 días." },
    { target: "text:Agregar producto (F2)", title: "3. Agrega productos", text: "Busca y escribe la cantidad. Enter pasa al siguiente destino. Si el producto ya está, te lleva a su cantidad." },
    { target: "text:Disponible", title: "4. Disponible en vivo", text: "Si alguien vende mientras armas el traslado, el número baja solo. Al enviar se revisa otra vez contra la base." },
    { target: "text:Enviar mercancía", title: "5. Envía", text: "Queda «en tránsito» con su enlace para firmar: preparado, revisado, en camino y recibido." },
    { target: ["text:Corregir productos", "text:Filtrar", "text:Exportar"], title: "6. Lista de traslados", text: "Filtra por fechas, estado o producto. Mientras nadie firme «Revisado» puedes corregirlo; también imprimes la hoja y las etiquetas." },
  ] },
  { key: "factura", match: "/dashboard/inventario?tab=purchases", title: "Ingreso de factura", tips: [
    "F2 busca productos con fotos; Ctrl + Enter guarda el ingreso.",
    "«✨ Crear producto» crea uno nuevo sin salir de la factura.",
    "Escribe el % o el precio de venta y se recalculan los 5 precios al guardar.",
    "«💡 Qué comprar» te propone qué pedir según las ventas.",
  ], steps: [
    { target: "text:Qué comprar", title: "1. Qué comprar (opcional)", text: "Con lo vendido en 30 días y lo que hay, propone cuánto comprar y te lo agrega a la factura." },
    { target: ['main select[aria-label="Proveedor"]', "text:Proveedor"], title: "2. Proveedor y datos", text: "Elige el proveedor, la fecha, el número de su factura y si es de contado o a crédito (crea la cuenta por pagar)." },
    { target: ["text:Agregar otro producto", "text:Agregar producto"], title: "3. Productos", text: "Cantidad, costo y bodega de cada producto. F2 abre la búsqueda con fotos." },
    { target: ["text:% venta", "text:% de ganancia"], title: "4. Precio de venta", text: "Escribe el % de ganancia o el precio de venta: el otro se calcula. Al guardar se actualizan los 5 precios." },
    { target: "text:Crear producto", title: "5. Producto nuevo", text: "Si no existe, créalo aquí mismo sin salir de la factura." },
    { target: ["text:Registrar ingreso", "text:Guardar cambios"], title: "6. Registra (Ctrl + Enter)", text: "Suma las unidades, actualiza el costo y abre el comprobante. Si algo vence, te ofrecemos anotar la fecha." },
  ] },
  { key: "ajustes", match: "/dashboard/inventario?tab=adjustments", title: "Ajustes y conteos", tips: [
    "«Contar por partes» trae una categoría completa para contarla.",
    "📷 Contar escaneando: con la cámara del celular o un lector.",
    "Si alguien vende mientras cuentas, al aplicar te ofrecemos descontar esas ventas de tu conteo.",
  ], steps: [
    { target: ['main select', "text:Bodega"], title: "1. Elige la bodega", text: "El punto o bodega que vas a contar o ajustar, y el motivo (conteo, dañado, pérdida…)." },
    { target: "text:Traer productos para contar", title: "2. Contar por partes", text: "Elige una categoría y trae todos sus productos con lo que dice el sistema. Solo se ajusta lo que cambies." },
    { target: "text:Contar escaneando", title: "3. Contar escaneando", text: "Cada código que escaneas suma 1. Sirve la cámara del celular o un lector de códigos." },
    { target: "text:Aplicar ajuste", title: "4. Aplica", text: "Si hubo ventas mientras contabas, te ofrecemos descontarlas. Todo queda en el kardex con tu usuario." },
  ] },
  { key: "existencias", match: "/dashboard/inventario?tab=stock", title: "Existencias", tips: ["Filtra por punto, categoría, sin costo o con pocas unidades.", "Exporta la lista cuando la necesites."], steps: [
    { target: ["main input[placeholder]", "text:Buscar"], title: "1. Busca", text: "Por nombre, referencia o código de barras." },
    { target: ["text:Sin costo", "text:Pocas unidades", "text:Categoría"], title: "2. Filtra", text: "Por punto, categoría, los que no tienen costo o los que tienen pocas unidades." },
    { target: "main table", title: "3. Lo que hay en cada punto", text: "Unidades por bodega y punto. El costo y el valor solo se ven con el permiso «Ver costos»." },
  ] },
  { key: "kardex", match: "/dashboard/inventario?tab=kardex", title: "Kardex", tips: ["Cada entrada y salida de un producto, con quién y cuándo."], steps: [
    { target: ["main input[placeholder]", "text:Producto"], title: "1. Elige el producto", text: "Busca el producto (y si quieres, el punto y las fechas)." },
    { target: "main table", title: "2. Cada movimiento", text: "Compras, ventas, traslados y ajustes con el antes y el después, quién lo hizo y cuándo." },
  ] },
  { key: "proveedores", match: "/dashboard/inventario?tab=suppliers", title: "Proveedores", tips: ["Cada proveedor también aparece en Terceros y cartera."], steps: [
    { target: ["text:Guardar", "text:Nombre"], title: "1. Crea tus proveedores", text: "Nombre, NIT, contacto y días de crédito. Los usas al registrar sus facturas." },
    { target: ["main table", "text:Proveedores"], title: "2. Tu lista", text: "Edítalos o desactívalos cuando quieras." },
  ] },
  { key: "cxp", match: "/dashboard/inventario?tab=payables", title: "Cuentas por pagar", tips: ["Se crean solas con las compras a crédito.", "Te avisamos al celular lo que vence."], steps: [
    { target: ["text:Vencidas", "main h2"], title: "1. Lo que debes", text: "Vencidas, por vencer y al día. Se crean al registrar facturas a crédito." },
    { target: ["text:Pagar", "text:Abonar"], title: "2. Paga o abona", text: "Registra el pago con su forma y referencia. Queda en el historial del proveedor." },
  ] },
  { key: "quietos", match: "/dashboard/inventario?tab=stale", title: "Productos sin movimiento", tips: ["Muestra lo que tiene unidades y no se vende hace 60, 90 o 180 días."], steps: [
    { target: "text:Más de 90 días", title: "1. Elige el tiempo", text: "60, 90 o 180 días sin vender." },
    { target: ["text:Plata parada", "text:Valor a precio detal"], title: "2. Plata parada", text: "Cuánto dinero tienes quieto en esos productos (al costo, si puedes ver costos)." },
    { target: ["text:Exportar", "main select"], title: "3. Decide", text: "Trasládalos a donde sí se venden o ponlos en promoción. Puedes filtrar por punto y exportar la lista." },
  ] },
  { key: "vencimientos", match: "/dashboard/inventario?tab=expiry", title: "Vencimientos", tips: ["Anota la fecha al ingresar mercancía que vence (opcional)."], steps: [
    { target: "text:Próximos 60 días", title: "1. Lo que vence pronto", text: "En rojo lo vencido, en naranja lo que vence en 30 días." },
    { target: "text:Anotar vencimiento", title: "2. Anota un vencimiento", text: "También se ofrece al registrar una factura de compra." },
    { target: ["text:Vendido", "text:Retirado"], title: "3. Márcalo", text: "Cuando se venda o se retire, márcalo para que deje de avisar." },
  ] },
  { key: "inventario", match: "/dashboard/inventario", title: "Inventario", tips: [
    "Existencias: filtra por punto, categoría, sin costo o con pocas unidades.",
    "Kardex: cada entrada y salida de un producto, con quién y cuándo.",
  ], steps: [
    { target: 'nav[aria-label="Secciones del módulo"]', title: "1. Las secciones", text: "Existencias, puntos y bodegas, traslados, ajustes, kardex, ingreso de factura, proveedores, cuentas por pagar y más." },
    { target: "text:Traslados", title: "2. Traslados", text: "Mueve mercancía entre bodegas y puntos con firmas y enlace de seguimiento." },
    { target: "text:Ingreso de factura", title: "3. Ingreso de factura", text: "Lo que compras: suma unidades, actualiza costos y precios, y crea la cuenta por pagar si es a crédito." },
    { target: "text:Ajustes", title: "4. Ajustes", text: "Cuando cuentas y algo no cuadra. Puedes contar por partes o escaneando." },
  ] },
  // ---------------------------------------------------------------- productos
  { key: "importar", match: "/dashboard/products/importar", title: "Importar desde Excel", tips: ["Descarga la plantilla, llénala y súbela.", "Las unidades entran como un ingreso de factura."], steps: [
    { target: "text:Plantilla", title: "1. Descarga la plantilla", text: "O usa tu propio Excel con columnas como nombre, referencia, precio, unidades y costo." },
    { target: "text:Elegir archivo", title: "2. Sube el archivo", text: ".xlsx o .csv. Antes de importar ves una vista previa con los errores marcados." },
    { target: ["text:Importar", "text:Si la referencia ya existe"], title: "3. Importa", text: "Puedes saltar o actualizar los que ya existen. Las categorías que no existan se crean solas." },
  ] },
  { key: "producto-nuevo", match: "/dashboard/products/crear", title: "Crear producto", tips: ["Nombre, foto y precio: en un minuto.", "Los productos nuevos quedan activos aunque no tengan unidades."], steps: [
    { target: ["text:Nombre", "main input"], title: "1. Datos", text: "Nombre, referencia y categoría. La referencia vacía se pone sola." },
    { target: ["text:Galería", "text:foto", "text:Imagen"], title: "2. Fotos", text: "Con foto se vende mucho más. Puedes arrastrarla o pegarla." },
    { target: ["text:Precio", "text:%"], title: "3. Precios", text: "Los 5 precios, o un % de ganancia que se aplica cuando entre el costo por una factura." },
    { target: ["text:Crear", "text:Guardar"], title: "4. Guarda", text: "El costo y las unidades entran después con el ingreso de factura." },
  ] },
  { key: "productos", match: "/dashboard/products", title: "Productos", tips: ["Los productos nuevos quedan activos aunque no tengan unidades.", "🏷️ Etiqueta imprime el código de barras con el precio.", "📥 Importar Excel sube muchos de una vez."], steps: [
    { target: "text:Búsqueda y filtros", title: "1. Busca y filtra", text: "Por nombre, referencia, categoría o estado." },
    { target: "text:Importar Excel", title: "2. Importar desde Excel", text: "Sube todos tus productos de una vez con una plantilla." },
    { target: "text:+ Crear", title: "3. Crear uno", text: "Nombre, foto y precios en un minuto." },
    { target: ["main table", "main ul"], title: "4. Edita", text: "Abre un producto para cambiar datos, fotos, precios, ver su historial o imprimir su etiqueta." },
  ] },
  { key: "lista", match: "/dashboard/lista-productos", title: "Lista general de productos", tips: ["Solo lectura: precios y existencias para consultar."], steps: [
    { target: ["main input[placeholder]", "main h1"], title: "1. Consulta rápida", text: "Busca un producto y mira sus precios y dónde hay unidades, sin poder cambiar nada." },
  ] },
  { key: "categorias", match: "/dashboard/categories", title: "Categorías", tips: ["Ordenan el catálogo y los informes."], steps: [
    { target: "main h1", title: "1. Tus categorías", text: "Crea, renombra y ordena las categorías. Ayudan en el catálogo, los filtros, las promociones y las comisiones." },
  ] },
  // ---------------------------------------------------------------- pedidos y operaciones
  { key: "pedidos-internos", match: "/dashboard/pedidos?tab=internos", title: "Pedidos internos", tips: ["Un punto le pide mercancía a la bodega u otro punto.", "Antes de enviar te avisamos si ya está pedido y cuánto le queda libre a quien surte."], steps: [
    { target: ["text:Nuevo pedido", "text:Pedir"], title: "1. Pide mercancía", text: "Elige a quién le pides y los productos. Te sugerimos lo que se te agotó y allá sí hay." },
    { target: ["text:Te toca revisarlo", "text:Pedidos internos"], title: "2. Atiende o confirma", text: "Quien surte lo prepara y lo despacha (crea el traslado). Quien pide confirma cuando llega." },
    { target: ["text:Sonidos y avisos", "text:Avisos"], title: "3. Avisos", text: "Llegan al celular y con sonido. Configúralos aquí." },
  ] },
  { key: "pedidos", match: "/dashboard/pedidos", title: "Pedidos", tips: ["Los pedidos que llegan por tus catálogos.", "Pedidos internos: entre puntos y bodegas."], steps: [
    { target: "main h1", title: "1. Pedidos del catálogo", text: "Lo que piden tus clientes desde el catálogo. Ábrelos para confirmar, facturar o escribirles." },
    { target: "text:Internos", title: "2. Pedidos internos", text: "Lo que un punto le pide a la bodega o a otro punto." },
  ] },
  { key: "operaciones", match: "/dashboard/operaciones", title: "Centro de operaciones", tips: ["Todos los documentos y movimientos en un solo lugar."], steps: [
    { target: "text:Centro de operaciones", title: "1. Todo en un lugar", text: "Ventas, remisiones, traslados, pedidos y ajustes con sus números y estados." },
    { target: "text:Vista fiscal", title: "2. Vista fiscal", text: "Lo pendiente por facturar electrónicamente." },
  ] },
  // ---------------------------------------------------------------- clientes
  { key: "puntos-clientes", match: "/dashboard/clientes?tab=puntos", title: "Puntos de clientes", tips: ["Los puntos son de la cédula del cliente.", "La tasa general y por punto se configura en Mi tienda → Cliente fiel."], steps: [
    { target: ['main input[placeholder*="cédula"]'], title: "1. Busca al cliente", text: "Por cédula o nombre. Los puntos son de su documento: no se mezclan nombres." },
    { target: "text:Regalar puntos", title: "2. Regala o ajusta", text: "Suma o quita puntos con motivo (cumpleaños, error en una venta). Queda en su historial." },
    { target: ["text:Historial", "main h3"], title: "3. Historial", text: "Compras (con el punto), canjes y ajustes de cada cliente." },
  ] },
  { key: "frecuentes", match: "/dashboard/clientes?tab=frecuentes", title: "Clientes frecuentes", tips: ["Quién compra más y a quién conviene escribirle."], steps: [
    { target: "text:Los que más compran", title: "1. Los que más compran", text: "Total, compras, promedio y lo que más compra cada uno." },
    { target: "text:Para recuperar", title: "2. Para recuperar", text: "Los que no han vuelto en el doble de lo que suelen tardar. Escríbeles con el mensaje listo." },
  ] },
  { key: "cartera", match: "/dashboard/clientes?tab=cartera", title: "Cartera", tips: ["Lo que te deben, abonos y estados de cuenta.", "📨 Recordar a todos los vencidos manda un mensaje por cliente."], steps: [
    { target: ["text:Vencida", "main h2"], title: "1. Lo que te deben", text: "Vencida, por vencer y al día." },
    { target: "text:Recordar a todos los vencidos", title: "2. Recordatorios", text: "Un mensaje de WhatsApp por cliente con todos sus documentos vencidos." },
    { target: ["text:Abonar", "text:Estado de cuenta"], title: "3. Abonos", text: "Registra lo que te pagan; el saldo se actualiza solo." },
  ] },
  { key: "clientes", match: "/dashboard/clientes", title: "Clientes y terceros", tips: ["Clientes, proveedores y empleados en un solo lugar.", "«Frecuentes» y «Puntos» te ayudan a que vuelvan."], steps: [
    { target: ['main input[placeholder*="Buscar"]'], title: "1. Busca", text: "Por nombre, documento, celular, ciudad o etiqueta." },
    { target: ["text:Nuevo", "text:Crear"], title: "2. Crea terceros", text: "Clientes (con cupo de crédito si quieres), proveedores o empleados." },
    { target: "text:Cartera", title: "3. Cartera", text: "Lo que te deben y los abonos." },
    { target: "text:Frecuentes", title: "4. Frecuentes y puntos", text: "Quién compra más, a quién escribirle y los puntos de cliente fiel." },
  ] },
  { key: "catalogos", match: "/dashboard/social", title: "Catálogos y campañas", tips: ["Un catálogo para cada público, con sus precios.", "📣 Tarjeta para compartir: imagen lista para estados e historias."], steps: [
    { target: "text:Tarjeta para compartir", title: "1. Tarjeta para compartir", text: "Crea una imagen con tu logo, productos y QR para estados de WhatsApp e Instagram." },
    { target: ["text:Catálogos", "text:Nuevo catálogo"], title: "2. Tus catálogos", text: "Detal, mayoristas o uno especial: elige productos, precios y diseño de cada uno." },
    { target: "text:Campañas", title: "3. Campañas", text: "Carrusel y promociones por catálogo." },
  ] },
  // ---------------------------------------------------------------- finanzas
  { key: "rentabilidad", match: "/dashboard/rentabilidad", title: "Rentabilidad", tips: ["Por producto: qué deja cada uno, no solo qué se vende.", "Reglas de precio por punto y liquidaciones."], steps: [
    { target: "text:Resumen", title: "1. Resumen", text: "Ventas, costo y ganancia de la tienda y de cada punto." },
    { target: "text:Por producto", title: "2. Por producto", text: "Lo que deja cada producto. «Se vende mucho y deja poco» y precios por debajo del costo." },
    { target: "text:Precios por punto", title: "3. Precios por punto", text: "Cada punto puede vender con su % o precio fijo, aprobado por la madre." },
    { target: "text:Repartos y liquidaciones", title: "4. Liquidaciones", text: "Cuánto le corresponde a cada punto o beneficiario." },
  ] },
  { key: "gastos", match: "/dashboard/gastos", title: "Gastos y nómina", tips: ["Gastos fijos para no olvidarlos.", "Nómina con días, horas extra y comisiones."], steps: [
    { target: "text:Nuevo gasto", title: "1. Gastos", text: "Registra lo que pagas: arriendo, servicios, transporte… con su categoría y punto." },
    { target: "text:Gasto fijo", title: "2. Gastos fijos", text: "Los que se repiten cada mes, para que no se te olviden." },
    { target: "text:Nueva nómina", title: "3. Nómina", text: "Empleados, días trabajados, horas extra y comisiones. Se aprueba y se paga." },
  ] },
  { key: "equipo", match: "/dashboard/equipo", title: "Comisiones y metas", tips: ["Cada vendedor ve solo lo suyo.", "La meta muestra el ritmo y cuánto falta por día."], steps: [
    { target: "text:Metas", title: "1. Metas del mes", text: "Por punto o por vendedor: cuánto llevan, el ritmo y si van a cumplir." },
    { target: "text:Comisiones", title: "2. Comisiones", text: "Un % general o por categoría. La tabla muestra lo que gana cada vendedor este mes." },
  ] },
  { key: "fiscal", match: "/dashboard/fiscal", title: "Factura electrónica", tips: ["Configura la numeración y el proveedor una sola vez por punto.", "Proveedor: Alanube (Alegra). Primero en pruebas, luego en producción."], steps: [
    { target: "text:Centro fiscal", title: "1. Centro fiscal", text: "Facturas electrónicas, notas y lo pendiente por facturar." },
    { target: ["text:Configuración", "text:Numeración"], title: "2. Configuración", text: "Resolución y numeración de cada punto, y el proveedor de facturación." },
    { target: ["text:Habilitación con Alanube", "text:Proveedor"], title: "3. Alanube", text: "Conecta Alanube con tu token, crea la empresa, conecta avisos y envía el set de pruebas. La guía paso a paso explica el portal de la DIAN." },
  ] },
  // ---------------------------------------------------------------- ajustes
  { key: "usuarios", match: "/dashboard/store/users", title: "Usuarios", tips: ["Usa una plantilla (Vendedor, Cajero, Bodega…) para dar permisos en un clic.", "Cada usuario puede quedar limitado a su punto."], steps: [
    { target: ["text:Crear acceso", "text:Usuarios y vendedores"], title: "1. Crea usuarios", text: "Con usuario y clave, sin correo. Cada uno con su punto." },
    { target: ["text:Vendedor", "text:Plantilla"], title: "2. Permisos con plantilla", text: "Vendedor, Cajero, Bodega, Supervisor… o los permisos uno por uno." },
    { target: "text:Dar permiso temporal", title: "3. Permisos temporales", text: "Da un permiso por unas horas o días y se quita solo." },
  ] },
  { key: "tienda", match: "/dashboard/store", title: "Mi tienda", tips: ["Logo, ciudad y frase ayudan a salir en Google.", "Cliente fiel, cobros con QR y copia de seguridad también están aquí."], steps: [
    { target: ["text:Logo de tienda", "main h1"], title: "1. Tu marca", text: "Logo, portada, frase, ciudad y dirección. Salen en tu catálogo y en Google." },
    { target: "text:Dominio y Google", title: "2. Dominio y Google", text: "Tu enlace, tu dominio propio y cómo te ve Google." },
    { target: "text:Aparecer en Google", title: "3. Aparecer en Google", text: "El código de Google Search Console, la página de cada punto y qué productos mejorar para que te encuentren." },
    { target: "text:Cliente fiel", title: "4. Cliente fiel", text: "El nombre de tu programa (ej. «Puntos La Vitrina») y cuántos puntos gana el cliente en general y en cada punto de venta." },
    { target: "text:Cobros con QR", title: "4. Cobros con QR", text: "Sube el QR de Nequi, Bre-B o tu banco para mostrarlo en el POS." },
    { target: "text:Copia de seguridad", title: "5. Copia de seguridad", text: "Descarga un Excel con todos tus datos cuando quieras." },
  ] },
  { key: "puntos", match: "/dashboard/puntos", title: "Puntos de venta", tips: ["Cada punto con su caja, numeración, usuarios y existencias."], steps: [
    { target: "text:Puntos", title: "1. Tus puntos y bodegas", text: "Cada sede con su dirección, numeración de facturas, usuarios y caja." },
    { target: ["text:Administrar", "text:Ver existencias"], title: "2. Administra cada uno", text: "Entra a cada punto para ver sus existencias, usuarios y configuración." },
  ] },
  { key: "plan", match: "/dashboard/plan", title: "Mi plan", tips: ["Tu plan, pagos e invitaciones."], steps: [
    { target: "text:Planes", title: "1. Planes", text: "Lo que incluye cada plan y el tuyo." },
    { target: "text:Invita y gana", title: "2. Invita y gana", text: "Comparte tu enlace: cuando otra tienda se registra, ganas días gratis." },
  ] },
  { key: "auditoria", match: "/dashboard/auditoria", title: "Auditoría", tips: ["Quién hizo qué, cuándo y qué cambió."], steps: [
    { target: ["main input[placeholder]", "main h1"], title: "1. Busca", text: "Por persona, módulo, documento o fecha." },
    { target: ["main ul", "main table"], title: "2. Cada cambio", text: "Con el antes y el después. No se puede borrar ni editar." },
  ] },
  // ---------------------------------------------------------------- inicio
  { key: "inicio", match: "/dashboard", exact: true, title: "Inicio", tips: [
    "«Tus pendientes» muestra lo que espera una acción tuya.",
    "Ctrl + K busca cualquier cosa: páginas, productos, #traslados, clientes y ventas.",
  ], steps: [
    { target: "text:Tus pendientes", title: "1. Tus pendientes", text: "Lo que espera una acción tuya: traslados por recibir, pedidos por atender, precios por aprobar…" },
    { target: ["text:Hoy en", "text:Metas del mes"], title: "2. Cómo va el día", text: "Ventas de hoy, tus ventas, lo más vendido y el avance de las metas." },
    { target: "text:Cierre de hoy", title: "3. Cierre del día", text: "Ventas por punto, cajas, traslados y agotados. Se manda por WhatsApp; también llega al celular a las 9 p. m." },
    { target: SEARCH, title: "4. Buscar (Ctrl + K)", text: "Encuentra páginas, productos, traslados (#14), clientes y ventas desde cualquier pantalla." },
    { target: HELP_BTN, title: "5. Ayuda", text: "En cada pantalla, el «?» tiene consejos, este recorrido y soporte por WhatsApp." },
  ] },
  { key: "panel", match: "/dashboard", title: "Panel", tips: ["Ctrl + K busca cualquier cosa.", "El «?» de arriba tiene ayuda de cada pantalla."], steps: [
    { target: "aside nav, nav", title: "1. El menú", text: "Día a día, negocio y dinero y ajustes. Solo ves lo que tus permisos te dejan." },
    { target: SEARCH, title: "2. Buscar (Ctrl + K)", text: "Encuentra cualquier cosa desde cualquier pantalla." },
    { target: HELP_BTN, title: "3. Ayuda", text: "Consejos, recorridos y soporte por WhatsApp." },
  ] },
];

/** La ayuda de una pantalla (o la pedida por su clave). */
export function helpFor(path: string, search: string, key?: string): Help | undefined {
  if (key) return HELP.find((h) => h.key === key);
  const params = new URLSearchParams(search);
  return HELP.find((h) => {
    const [p, q] = h.match.split("?");
    if (q) {
      const [k, v] = q.split("=");
      return (path === p || path.startsWith(`${p}/`)) && params.get(k) === v;
    }
    return h.exact ? path === p : path === p || path.startsWith(`${p}/`);
  });
}
