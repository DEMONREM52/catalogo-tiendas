/**
 * Novedades de RemHub: qué cambió y en qué páginas. De aquí sale el aviso de «Nueva versión».
 *
 *   · Solo se avisa si alguna novedad toca la página donde está la persona (`paths`) o si es `important`.
 *   · Si no la toca, la versión nueva se aplica sola al cambiar de sección (sin molestar).
 *   · `demo` son los pasos del simulador que se muestra antes y después de actualizar.
 *
 * Al publicar algo que la gente deba notar: agregar una entrada al final con el siguiente `id`.
 * `paths` son inicios de ruta («/dashboard/pedidos» cubre todo lo de pedidos). Sin `paths` = no se avisa.
 */
import type { Release } from "./release";

export type { Release, ReleaseStep } from "./release";
export { isPanelPath, releaseTouches } from "./release";

export const RELEASES: Release[] = [
  {
    id: 1, date: "2026-10-30", title: "Agregar y quitar productos de un pedido interno",
    summary: "Quien despacha puede mandar más productos o quitar los que no hay. Cada cambio queda en el chat.",
    paths: ["/dashboard/pedidos"],
    demo: [
      { icon: "📦", text: "Abre un pedido interno" },
      { icon: "➕", text: "Toca «Agregar producto al envío»" },
      { icon: "🔎", text: "Busca el producto y escribe cuántas" },
      { icon: "💬", text: "Queda en el chat: «Sara agregó 2 × Trípode»" },
    ],
  },
  {
    id: 2, date: "2026-10-30", title: "Firmas por enlace desde «Preparó»",
    summary: "Manda un enlace (WhatsApp, QR o copiar) para que los bodegueros firmen desde su celular, sin cuenta.",
    paths: ["/dashboard/pedidos"],
    demo: [
      { icon: "✍️", text: "En «Firmas de responsables» toca 🔗 Enlace" },
      { icon: "📲", text: "Mándalo por WhatsApp o muestra el QR" },
      { icon: "🧑‍🔧", text: "El bodeguero firma con el dedo" },
      { icon: "✅", text: "La firma aparece en el pedido «por enlace»" },
    ],
  },
  {
    id: 3, date: "2026-10-31", title: "Lista de chequeo del pedido",
    summary: "Chulea cada producto al empacarlo o al recibirlo: se pone verde y sube en orden.",
    paths: ["/dashboard/pedidos"],
    demo: [
      { icon: "⚪", text: "Toca el círculo de un producto" },
      { icon: "🟢", text: "Se pone verde y sube arriba" },
      { icon: "📊", text: "La barra muestra «12 de 56»" },
      { icon: "🎉", text: "Al terminar, queda en el chat" },
    ],
  },
  {
    id: 4, date: "2026-11-01", title: "Buscar dentro del pedido",
    summary: "Encuentra un producto que ya está en el pedido. Con un solo resultado, Enter lo chulea.",
    paths: ["/dashboard/pedidos"],
    demo: [
      { icon: "🔎", text: "Escribe en «Buscar en este pedido»" },
      { icon: "🎯", text: "Queda solo el producto que buscas" },
      { icon: "⏎", text: "Enter lo chulea y limpia la búsqueda" },
    ],
  },
  {
    id: 5, date: "2026-11-03", title: "Un solo enlace para el pedido y su traslado",
    summary: "El enlace del pedido muestra la conversación y, cuando sale, pasa solo al seguimiento del traslado.",
    paths: ["/dashboard/pedidos", "/firma-pedido", "/traslado"],
    demo: [
      { icon: "🔗", text: "Comparte el enlace del pedido" },
      { icon: "💬", text: "Quien lo abre ve los productos y la conversación" },
      { icon: "🚚", text: "Al enviarlo, el mismo enlace es el seguimiento" },
    ],
  },
  {
    id: 6, date: "2026-11-03", title: "Guardar producto desde abajo en el celular",
    summary: "Al editar o crear un producto en el celular, el botón de guardar queda abajo, a la mano del pulgar.",
    paths: ["/dashboard/products"],
    demo: [
      { icon: "✏️", text: "Cambia algo del producto" },
      { icon: "👇", text: "Abajo aparece «💾 Guardar cambios»" },
      { icon: "✅", text: "Guarda sin subir hasta arriba" },
    ],
  },
  {
    // Botones más fáciles de tocar, esqueletos de carga y «reducir movimiento»: en toda la app, sin avisar.
    id: 7, date: "2026-11-03", title: "Botones más cómodos de tocar",
    summary: "Áreas táctiles de 44 px, botones de cerrar más grandes y cargas que muestran la forma del contenido.",
    paths: [],
  },
  {
    id: 8, date: "2026-11-03", title: "Avisos de actualización más inteligentes",
    summary: "Solo te pedimos actualizar si cambió algo de la página donde estás, y te mostramos qué cambió.",
    paths: [],
  },
  {
    // Cargas, POS táctil y botones con nombre: en toda la app, sin avisar.
    id: 9, date: "2026-11-03", title: "Cargas más claras y POS más cómodo en tablet",
    summary: "Esqueletos de carga en todo el panel, botones de cantidad más grandes en pantallas táctiles y cobro protegido contra doble envío.",
    paths: [],
  },
  {
    id: 10, date: "2026-11-03", title: "Un solo enlace que sabe de dónde viene cada visita",
    summary: "Ya no necesitas un enlace por red: RemHub reconoce Facebook, Instagram, TikTok, Google y YouTube solo, y lo manda al píxel de Facebook.",
    paths: ["/dashboard/landing", "/dashboard/social"],
    demo: [
      { icon: "🔗", text: "Copia el «Un solo enlace» del Kit de pauta" },
      { icon: "📱", text: "Lo abren desde Instagram, TikTok o Google" },
      { icon: "🧭", text: "RemHub reconoce de dónde llegó la visita" },
      { icon: "🔵", text: "El píxel lo recibe como traffic_source" },
    ],
  },
  {
    id: 11, date: "2026-11-03", title: "Emojis en el chat",
    summary: "Botón 😊 junto al clip: caras, gestos, tienda, símbolos y comida, con tus recientes primero.",
    paths: ["/dashboard/pedidos", "/dashboard/mensajes"],
    demo: [
      { icon: "😊", text: "Toca el botón de emojis junto al clip" },
      { icon: "📦", text: "Escoge una categoría (hay una de tienda)" },
      { icon: "👍", text: "El emoji entra donde estabas escribiendo" },
      { icon: "🕘", text: "Los que más usas quedan en «Recientes»" },
    ],
  },
  {
    id: 12, date: "2026-11-03", title: "Informes de traslados a la medida",
    summary: "Mira qué se trasladó a cada punto: agrupa por punto, ruta, producto, categoría, fecha o persona, y exporta a Excel o PDF.",
    paths: ["/dashboard/inventario"],
    demo: [
      { icon: "📊", text: "En Traslados toca «Informes»" },
      { icon: "🏬", text: "Escoge «Agrupar por»: punto, producto, mes…" },
      { icon: "📅", text: "Filtra fechas, puntos, estado o categoría" },
      { icon: "⬇️", text: "Descárgalo en Excel o imprímelo en PDF" },
    ],
  },
  {
    id: 13, date: "2026-11-03", title: "Las 4 firmas desde el pedido",
    summary: "«En camino» y «Recibió» también se firman en el panel del pedido, sin enlace.",
    paths: ["/dashboard/pedidos"],
    demo: [
      { icon: "📦", text: "Firman «Preparó» y «Revisó»" },
      { icon: "🚚", text: "En «En camino» toca «Enviar y firmar aquí»" },
      { icon: "✅", text: "Al llegar, «Recibió» se firma en el mismo panel" },
      { icon: "🔒", text: "Cada paso bloqueado dice qué falta" },
    ],
  },
  {
    id: 14, date: "2026-11-03", title: "Pedidos internos en colores",
    summary: "Cada estado tiene su color en la tarjeta, con barra de pasos, de dónde sale y a dónde llega.",
    paths: ["/dashboard/pedidos"],
    demo: [
      { icon: "🟣", text: "Morado: enviado, esperando respuesta" },
      { icon: "🟠", text: "Naranja: preparando · Azul: en camino" },
      { icon: "🟢", text: "Verde: recibido · Rojo: urgente" },
      { icon: "💬", text: "Rosado: mensajes sin leer" },
    ],
  },
  {
    id: 15, date: "2026-11-03", title: "Nuevo aspecto: vidrio",
    summary: "Tarjetas, ventanas y menús transparentes como vidrio, con fondo de colores. Se apaga en Apariencia → Vidrio.",
    paths: ["/dashboard"],
    demo: [
      { icon: "✨", text: "Las tarjetas dejan ver el fondo, como vidrio esmerilado" },
      { icon: "🪟", text: "Las ventanas y avisos también son de vidrio" },
      { icon: "🧾", text: "En el POS e informes queda casi sólido para leer rápido" },
      { icon: "🌗", text: "Abajo a la izquierda: Apariencia → Vidrio para apagarlo" },
    ],
  },
  {
    id: 16, date: "2026-11-03", title: "Fondo animado en el panel",
    summary: "El fondo de la página principal (red con pulsos, lluvia de código y luz que sigue al mouse) ahora también en el panel.",
    paths: ["/dashboard"],
    demo: [
      { icon: "🌌", text: "Detrás de las tarjetas de vidrio se mueve la red con pulsos" },
      { icon: "🖱️", text: "En computador, una luz sigue al mouse" },
      { icon: "🧾", text: "En POS e informes no va, para trabajar sin distracción" },
      { icon: "🌗", text: "Apariencia → Fondo animado para apagarlo" },
    ],
  },
  {
    id: 17, date: "2026-11-03", title: "Productos cómodos en el celular",
    summary: "En celular: el nombre se lee completo, los botones bajan a su fila, los filtros se pliegan y lo demás va en el menú ⋯.",
    paths: ["/dashboard/products"],
    demo: [
      { icon: "📱", text: "El nombre del producto a todo lo ancho" },
      { icon: "⚙️", text: "Toca «Filtros» para ver estado, stock y categoría" },
      { icon: "⋯", text: "Recargar, importar y exportar en el menú ⋯" },
      { icon: "💲", text: "Se ven P2 (mayor) y P3 (detal); el resto en computador" },
    ],
  },
  {
    id: 18, date: "2026-11-03", title: "Toca la foto para verla en grande",
    summary: "En Productos, la foto se amplía con una animación suave; doble toque o rueda para acercar.",
    paths: ["/dashboard/products"],
    demo: [
      { icon: "🖼️", text: "Toca la foto del producto" },
      { icon: "🔍", text: "Doble toque (o rueda del mouse) para acercar" },
      { icon: "✋", text: "Con zoom, arrastra para moverla" },
      { icon: "👇", text: "Desliza hacia abajo o toca el fondo para cerrar" },
    ],
  },
  {
    id: 19, date: "2026-11-03", title: "Pedido interno más ordenado en el celular",
    summary: "La ruta a todo lo ancho, la lista de empaque compacta y cada producto con chips cortos de existencias.",
    paths: ["/dashboard/pedidos"],
    demo: [
      { icon: "📤", text: "Arriba: de dónde sale → 📥 a dónde llega" },
      { icon: "📦", text: "Barra de empaque pequeña: 6/6 y «Faltan»" },
      { icon: "🔍", text: "Toca la lupa para buscar dentro del pedido" },
      { icon: "🖼️", text: "Toca la foto para verla en grande" },
    ],
  },
  {
    id: 20, date: "2026-11-03", title: "Más cómodo en el celular",
    summary: "Inventario, Pedidos y Clientes ordenados para el celular: lo que más usas a la vista y lo demás plegado.",
    paths: ["/dashboard/inventario", "/dashboard/pedidos", "/dashboard/clientes"],
    demo: [
      { icon: "📦", text: "Existencias en tarjetas con el total grande" },
      { icon: "⚙️", text: "Filtros plegados: toca «Filtros» o «Más filtros»" },
      { icon: "⋯", text: "Lo que se usa poco va en el menú ⋯" },
      { icon: "🖼️", text: "Toca la foto de un producto para verla en grande" },
    ],
  },
  {
    id: 21, date: "2026-11-03", title: "¿Hay en otros puntos? desde el POS",
    summary: "En cada producto del carrito puedes ver cuánto hay en los otros puntos y pedirlo con un toque.",
    paths: ["/dashboard/pos"],
    demo: [
      { icon: "🛒", text: "Agrega el producto al carrito" },
      { icon: "🏬", text: "Toca «¿Hay en otros puntos?»" },
      { icon: "📍", text: "Mira cuánto hay en cada punto y bodega" },
      { icon: "📨", text: "«Pedir a otro punto» abre el pedido interno listo" },
    ],
  },
  {
    id: 22, date: "2026-11-03", title: "Permisos más claros",
    summary: "Al dar un permiso que necesita otro, se marca solo (ej. «Anular compras» marca «Compras»).",
    paths: ["/dashboard/store/users"],
    demo: [
      { icon: "🔗", text: "Cada permiso muestra lo que incluye" },
      { icon: "✅", text: "Marcar uno agrega el que necesita" },
      { icon: "❌", text: "Quitar el base quita los que dependen de él" },
      { icon: "🧩", text: "Las plantillas ya vienen completas" },
    ],
  },
  {
    id: 23, date: "2026-11-05", title: "Todo el panel más cómodo en el celular",
    summary: "Las tablas se ven como tarjetas, las explicaciones largas se ocultan y los menús desplegables se leen bien.",
    paths: ["/dashboard", "/admin"],
    demo: [
      { icon: "📱", text: "Cada fila de una tabla es una tarjeta" },
      { icon: "🏷️", text: "Cada dato lleva el nombre de su columna encima" },
      { icon: "✂️", text: "Sin párrafos largos debajo del título" },
      { icon: "▾", text: "Menús desplegables con fondo del tema" },
    ],
  },
  {
    id: 24, date: "2026-11-05", title: "Buscar dentro de un traslado",
    summary: "Al abrir los productos de un traslado (o al contar lo que llegó) hay un buscador por nombre o código.",
    paths: ["/dashboard/inventario"],
    demo: [
      { icon: "🔍", text: "Escribe parte del nombre o el código" },
      { icon: "🔤", text: "No importan tildes ni mayúsculas" },
      { icon: "🔢", text: "Muestra cuántos coinciden" },
      { icon: "🖼️", text: "La foto se amplía al tocarla" },
    ],
  },
  {
    id: 25, date: "2026-11-05", title: "Pedidos internos más limpios",
    summary: "Menos recuadros y textos: cada pedido muestra lo justo y lo que necesita acción salta a la vista.",
    paths: ["/dashboard/pedidos"],
    demo: [
      { icon: "🔢", text: "Los números van en las pestañas" },
      { icon: "🚚", text: "Arriba solo lo que pide acción" },
      { icon: "🃏", text: "Tarjetas más bajas: número, estado, ruta y hora" },
      { icon: "🎨", text: "La guía de colores, plegada al final" },
    ],
  },
  {
    id: 26, date: "2026-11-05", title: "Recibir un traslado, igual que un pedido",
    summary: "En el enlace del traslado y en Inventario se recibe tocando cada producto, con buscador, y el pedido interno se cierra solo.",
    paths: ["/dashboard/inventario", "/dashboard/pedidos", "/traslado"],
    demo: [
      { icon: "✅", text: "Toca cada producto al contarlo: se pone verde" },
      { icon: "➖", text: "Si falta algo, bájalo con − / +" },
      { icon: "📥", text: "«Recibir ahora» sin esperar las firmas de antes" },
      { icon: "🔗", text: "El pedido se cierra solo y queda en su chat" },
    ],
  },
  {
    id: 27, date: "2026-11-05", title: "Recibir cuando llega de más",
    summary: "Al recibir un traslado ya se puede anotar más de lo enviado: esas unidades se descuentan del origen.",
    paths: ["/dashboard/inventario", "/traslado"],
    demo: [
      { icon: "➕", text: "Sube la cantidad con + si llegó de más" },
      { icon: "🏬", text: "Las unidades de más salen del origen" },
      { icon: "📝", text: "Se pide una nota explicando la diferencia" },
      { icon: "💬", text: "El chat del pedido lo dice" },
    ],
  },
  {
    id: 28, date: "2026-11-06", title: "Más espacio para el chat del pedido",
    summary: "En el celular, el encabezado del pedido ocupa una sola línea y el chat se ve mucho más grande.",
    paths: ["/dashboard/pedidos"],
    demo: [
      { icon: "📏", text: "Número, ruta, llamar y cerrar en una fila" },
      { icon: "⋯", text: "Videollamada, buscar, silenciar y avisos en ⋯" },
      { icon: "👆", text: "Toca la ruta para ver todo el detalle" },
      { icon: "⌨️", text: "Las respuestas rápidas se esconden al escribir" },
    ],
  },
  {
    id: 29, date: "2026-11-06", title: "Pegar o arrastrar la foto",
    summary: "En la imagen del producto (y logos, categorías, catálogos) ya puedes arrastrar la foto o pegarla con Ctrl+V.",
    paths: ["/dashboard/products", "/dashboard/categories", "/dashboard/store", "/dashboard/social", "/admin"],
    demo: [
      { icon: "🖱️", text: "Arrastra la foto desde la carpeta al recuadro" },
      { icon: "📋", text: "O copia la imagen y toca «📋 Pegar»" },
      { icon: "⌨️", text: "O pon el mouse encima y presiona Ctrl+V" },
      { icon: "🗜️", text: "Se comprime sola antes de subir" },
    ],
  },
  {
    id: 30, date: "2026-11-06", title: "Buscar pedidos por producto",
    summary: "En Pedidos de clientes escribe el nombre, código o código de barras de un producto y salen los pedidos que lo llevan.",
    paths: ["/dashboard/pedidos"],
    demo: [
      { icon: "🔎", text: "Escribe «camion» o el código RC 48786" },
      { icon: "🧾", text: "Salen los pedidos que llevan ese producto" },
      { icon: "📦", text: "Cada pedido muestra qué producto coincidió" },
    ],
  },
  {
    id: 31, date: "2026-11-06", title: "Anular pedido y traslado juntos",
    summary: "Si se anula el traslado de un pedido interno, el pedido queda cancelado y deja de salir «En camino». Quien tiene permiso de traslados lo puede anular desde el mismo pedido.",
    paths: ["/dashboard/pedidos", "/dashboard/inventario"],
    demo: [
      { icon: "🚚", text: "Abre el pedido que está «En camino»" },
      { icon: "🚫", text: "Toca «Anular pedido y traslado» y escribe el motivo" },
      { icon: "↩️", text: "La mercancía vuelve a quien la envió" },
      { icon: "💬", text: "El chat del pedido lo deja anotado" },
    ],
  },
  {
    id: 32, date: "2026-11-06", title: "Arrastrar la foto en la búsqueda por foto",
    summary: "En todos los buscadores por foto (POS, productos, lista y catálogo) puedes soltar la imagen en cualquier parte de la ventana, aunque ya haya resultados.",
    paths: ["/dashboard", "/admin"],
    demo: [
      { icon: "📷", text: "Abre la búsqueda por foto" },
      { icon: "🖱️", text: "Arrastra la foto desde una carpeta u otra página" },
      { icon: "📥", text: "Suéltala en cualquier parte de la ventana" },
      { icon: "📋", text: "O pégala con Ctrl+V, incluso en «Nombre o código»" },
    ],
  },
  {
    id: 33, date: "2026-11-06", title: "Comentarios por producto y botón flotante",
    summary: "Cada producto del pedido interno tiene sus comentarios (necesito más, otro color, dañado…) con «✓ Atendido». Agregar productos y bajar a las firmas siempre está a la mano. Firmar «Preparó» ya toma el pedido.",
    paths: ["/dashboard/pedidos"],
    important: true,
    demo: [
      { icon: "💬", text: "Toca 💬 en un producto y escribe o elige «➕ Necesito más»" },
      { icon: "✅", text: "Quien despacha lo marca «Atendido» o lo agrega al pedido con un toque" },
      { icon: "➕", text: "El botón «Agregar» flota abajo: no hay que bajar cada vez" },
      { icon: "⬇️", text: "La flecha baja directo a las firmas; ⬆️ sube al inicio" },
      { icon: "✍️", text: "Firmar «Preparó» deja el pedido tomado y en preparación" },
    ],
  },
  {
    id: 34, date: "2026-11-06", title: "Notificaciones más cómodas",
    summary: "La campana abre un panel completo (en el celular sube desde abajo y ya no se corta), con filtros de urgentes y nuevas.",
    paths: ["/dashboard"],
    demo: [
      { icon: "🔔", text: "Toca la campana" },
      { icon: "📱", text: "En el celular el panel sube desde abajo, completo" },
      { icon: "🔴", text: "Filtra: Todas · Nuevas · Urgentes · Atención" },
      { icon: "👆", text: "Toca un aviso para ir directo; queda como visto" },
    ],
  },
  {
    id: 35, date: "2026-11-06", title: "Amethyst Glass: temas nuevos y tus propios temas",
    summary: "Nuevos temas oficiales Pearl Amethyst (claro) y Obsidian Amethyst (oscuro). Crea todos los temas que quieras con vista previa en vivo; se guardan en tu cuenta y te siguen en todos tus dispositivos.",
    paths: ["/dashboard", "/admin"],
    important: true,
    demo: [
      { icon: "🎨", text: "Toca el botón de apariencia (abajo a la izquierda)" },
      { icon: "💎", text: "Elige Pearl Amethyst, Obsidian Amethyst o Automático" },
      { icon: "➕", text: "«Crear tema»: colores, fondos, vidrio, bordes, letra…" },
      { icon: "👁️", text: "Míralo en vivo; «Cancelar» deja todo como estaba" },
      { icon: "📱", text: "Tu tema aparece al entrar desde otro celular o computador" },
    ],
  },  {
    id: 36, date: "2026-11-06", title: "Obsidian y Pearl más elegantes",
    summary: "Menos morado: superficies grafito (oscuro) o blanco perla (claro), vidrio más limpio y el violeta solo en lo que importa.",
    paths: ["/dashboard", "/admin"],
    demo: [
      { icon: "🖤", text: "Obsidian: negro y grafito con cristal ahumado" },
      { icon: "🤍", text: "Pearl: blanco perla con cristal claro" },
      { icon: "💜", text: "El violeta queda en botones principales y lo seleccionado" },
    ],
  },  {
    id: 37, date: "2026-11-06", title: "Obsidian Aurora: oscuro con más vida",
    summary: "El modo oscuro pasa a grafito ciruela con cristal ahumado: ya no es casi negro y cada capa se distingue mejor.",
    paths: ["/dashboard", "/admin"],
    demo: [
      { icon: "🌌", text: "Fondo ciruela oscuro en vez de negro" },
      { icon: "🪟", text: "Contenedores, filtros y filas con tonos distintos" },
      { icon: "✨", text: "Vidrio con bordes iluminados y reflejo suave" },
    ],
  },
  {
    id: 38, date: "2026-11-07", title: "Redes con sus iconos y colores",
    summary: "Las redes del catálogo se eligen tocando su icono, el nombre se escribe solo (sin errores) y al pegar el enlace se reconoce la red.",
    paths: ["/dashboard/social", "/dashboard/store"],
    demo: [
      { icon: "📲", text: "Toca + TikTok o + Instagram para agregarla" },
      { icon: "🔗", text: "Pega el enlace: la red se reconoce sola" },
      { icon: "🪄", text: "El nombre queda bien escrito automáticamente" },
    ],
  },
  {
    id: 39, date: "2026-11-07", title: "Tarjeta para compartir, a tu gusto",
    summary: "La tarjeta para estados e historias ahora trae 8 estilos listos o tus colores, 3 formatos, productos elegidos por ti, etiqueta y vista previa en vivo.",
    paths: ["/dashboard/social"],
    demo: [
      { icon: "🎨", text: "Elige un estilo o tus propios colores" },
      { icon: "📐", text: "Historia, publicación vertical o cuadrada" },
      { icon: "🛍️", text: "Toca los productos que quieres mostrar" },
      { icon: "📤", text: "Compártela directo a WhatsApp" },
    ],
  },
  {
    id: 40, date: "2026-11-07", title: "Usuarios y permisos, nuevos",
    summary: "Crear y editar usuarios ahora es un asistente por pasos con 67 permisos en 15 áreas, nivel de riesgo, plantillas, resumen de lo que verá y un mapa de permisos de todo el equipo.",
    paths: ["/dashboard/store/users"],
    demo: [
      { icon: "🧑‍💼", text: "Persona: nombre, usuario y contraseña" },
      { icon: "📍", text: "Acceso: punto donde trabaja o administrador" },
      { icon: "🛡️", text: "Permisos por área, con riesgo y plantillas" },
      { icon: "📋", text: "Resumen: qué verá y qué no podrá hacer" },
    ],
  },
  {
    id: 41, date: "2026-11-07", title: "Anticipos en las liquidaciones",
    summary: "Si un punto entrega dinero antes de liquidar, regístralo como anticipo: otra persona lo aprueba y se descuenta solo en la próxima liquidación, de un beneficiario o de todo el pozo.",
    paths: ["/dashboard/rentabilidad"],
    demo: [
      { icon: "💸", text: "Registra el anticipo con fecha, forma y soporte" },
      { icon: "✅", text: "Otra persona lo aprueba" },
      { icon: "🧮", text: "Se descuenta solo en la próxima liquidación" },
      { icon: "📄", text: "Queda en el informe PDF y en Excel" },
    ],
  },
  {
    id: 42, date: "2026-11-08", title: "Ganancia con el último costo",
    summary: "Cada punto puede calcular la ganancia de sus ventas con el último costo (el mismo del precio), sin pérdidas falsas por mercancía vieja más cara, y corregir ventas ya hechas que no estén en liquidaciones aprobadas.",
    paths: ["/dashboard/rentabilidad"],
    demo: [
      { icon: "⚖️", text: "Escoge «Último costo» en el punto" },
      { icon: "🔎", text: "Revisa qué ventas cambian" },
      { icon: "🪄", text: "Corrige y vuelve a preparar la liquidación" },
    ],
  },
  {
    id: 43, date: "2026-11-08", title: "Gastos compartidos y resumen de la liquidación",
    summary: "Registra gastos del punto (transporte, consumo…) junto a los anticipos y escoge cómo se reparte cada uno: mitad y mitad, según el reparto, otros % o uno solo. «Por liquidar hoy» muestra ventas, costo, ganancia, gastos, anticipos y lo que se paga.",
    paths: ["/dashboard/rentabilidad"],
    demo: [
      { icon: "🧾", text: "Toca «Gasto» y escribe en qué se gastó" },
      { icon: "⚖️", text: "Escoge mitad y mitad u otros %" },
      { icon: "📋", text: "Mira el resumen: ventas − costo − gastos − anticipos" },
    ],
  },
  {
    id: 44, date: "2026-11-08", title: "Anticipos: abono al costo de la mercancía",
    summary: "Los anticipos ahora se abonan al costo de la mercancía (bajan lo que la sede debe entregar) y no tocan la ganancia de los beneficiarios. Los gastos siguen restándose de la ganancia como escojas repartirlos.",
    paths: ["/dashboard/rentabilidad"],
    demo: [
      { icon: "💸", text: "Registra el anticipo que entregó la sede" },
      { icon: "📦", text: "Se abona al costo de la mercancía" },
      { icon: "🤝", text: "La ganancia se reparte completa (menos gastos)" },
    ],
  },
  {
    id: 45, date: "2026-11-08", title: "Liquidaciones firmadas y aviso de revisión",
    summary: "Cada liquidación se firma virtualmente: quien preparó, quien aprobó y cada beneficiario, con copia de los valores firmados. Al enviarla a revisión se ve quién la aprueba y le llega aviso al celular.",
    paths: ["/dashboard/rentabilidad"],
    demo: [
      { icon: "📨", text: "Envía a revisión: avisa a quien aprueba" },
      { icon: "✍️", text: "Firma con el dedo desde el enlace" },
      { icon: "📄", text: "Las firmas salen en el informe PDF" },
    ],
  },
  {
    id: 46, date: "2026-11-08", title: "Informes por fecha y hora, y liquidación del punto mejorada",
    summary: "Nuevo informe de ventas, costo y ganancia en cualquier rango con hora (por punto, día a día, productos y vendedores, con Excel y PDF). La liquidación del punto compara las 5 listas y explica cada producto con pérdida.",
    paths: ["/dashboard/rentabilidad", "/dashboard/inventario"],
    demo: [
      { icon: "📅", text: "Toca «Por fechas y horas» en Puntos" },
      { icon: "⏰", text: "Escoge desde y hasta, con la hora" },
      { icon: "⚠️", text: "En la liquidación mira «Pérdidas» y «Comparar listas»" },
    ],
  },
  {
    id: 47, date: "2026-11-08", title: "Mercancía del punto con el último costo de factura",
    summary: "La liquidación del punto puede valorizar con el último costo de factura (y el precio de bodega sobre ese costo), muestra el promedio y el último costo de cada producto y avisa los costos sospechosos.",
    paths: ["/dashboard/rentabilidad", "/dashboard/inventario"],
    demo: [
      { icon: "🧾", text: "Escoge «Costo: Último de factura»" },
      { icon: "🔒", text: "Lo trasladado conserva su precio de bodega" },
      { icon: "⚠️", text: "Revisa los costos sospechosos" },
    ],
  },
  {
    id: 48, date: "2026-11-08", title: "La deuda de los puntos sigue al último costo",
    summary: "Cuando la madre cambia el costo en una factura, la deuda de los puntos por las unidades que tienen se ajusta sola: nota crédito si baja, cargo si sube. Con historial y botón «Revaluar ahora».",
    paths: ["/dashboard/rentabilidad", "/dashboard/inventario"],
    demo: [
      { icon: "🧾", text: "La madre ingresa una factura más barata" },
      { icon: "♻️", text: "A cada punto le baja la deuda sola" },
      { icon: "📋", text: "Mira el historial en la liquidación del punto" },
    ],
  },
  {
    id: 49, date: "2026-11-08", title: "Cobrar el inventario inicial como deuda",
    summary: "Si un punto recibió su inventario inicial como factura propia, ahora se puede cobrar como deuda inicial con la bodega: solo lo que todavía tiene, a último costo + % de la bodega, con vista previa por producto.",
    paths: ["/dashboard/rentabilidad", "/dashboard/inventario"],
    demo: [
      { icon: "📥", text: "Abre la liquidación del punto" },
      { icon: "🧾", text: "Escoge el ingreso inicial y revisa la vista previa" },
      { icon: "✅", text: "Cóbralo: queda en la cuenta con la bodega" },
    ],
  },
  {
    id: 50, date: "2026-11-08", title: "Mercancía del punto igual en todas partes",
    summary: "«Mercancía en el punto» de la cuenta con puntos ahora suma todo lo que tiene el punto (también su inventario inicial), igual que la liquidación a precio de bodega.",
    paths: ["/dashboard/rentabilidad", "/dashboard/inventario"],
    demo: [
      { icon: "📦", text: "Mira «Mercancía en el punto» en la tarjeta" },
      { icon: "📊", text: "Abre la liquidación: el precio de bodega es el mismo" },
    ],
  },
  {
    id: 51, date: "2026-11-08", title: "Mercancía de los puntos a costo real",
    summary: "En la cuenta con puntos ahora ves la mercancía de cada punto a precio de bodega (lo que debe) y también a costo real (lo que costó).",
    paths: ["/dashboard/rentabilidad", "/dashboard/inventario"],
    demo: [
      { icon: "📦", text: "Precio de bodega: costo + % de la bodega" },
      { icon: "🏷️", text: "Costo real: lo que costó la mercancía" },
    ],
  },
  {
    id: 52, date: "2026-11-08", title: "Recalcular la deuda inicial",
    summary: "«Cobrar ingreso inicial» ahora suma los traslados que llegaron antes de activar el crédito (nunca se cobraron) y deja recalcular un ingreso ya cobrado: anula el cobro anterior y registra el nuevo.",
    paths: ["/dashboard/rentabilidad", "/dashboard/inventario"],
    demo: [
      { icon: "📥", text: "Abre «Cobrar ingreso inicial» y escoge el ingreso" },
      { icon: "🚚", text: "Mira la columna «Traslados sin cobro»" },
      { icon: "♻️", text: "Toca «Recalcular»: la deuda cambia solo la diferencia" },
    ],
  },
  {
    id: 53, date: "2026-11-08", title: "La liquidación abona la deuda con la bodega",
    summary: "Al aprobar la liquidación de un punto, el costo de lo vendido se abona solo a su cuenta con la bodega. Cambiar el % de la bodega recalcula la deuda sola, y «Cuadrar» deja la deuda en lo que de verdad debe.",
    paths: ["/dashboard/rentabilidad", "/dashboard/inventario"],
    demo: [
      { icon: "✅", text: "Aprueba la liquidación: el abono a la bodega queda solo" },
      { icon: "⚙️", text: "Cambia el % de la bodega: la deuda se recalcula" },
      { icon: "⚖️", text: "Usa «Cuadrar» en la liquidación del punto" },
    ],
  },
  {
    id: 54, date: "2026-11-08", title: "Informe del punto en PDF completo",
    summary: "La liquidación del punto se descarga como PDF completo: mercancía, cuenta con la bodega, por pagar, movimientos, comparación de listas, pérdidas, costos para revisar y todos los productos. En el celular se comparte directo.",
    paths: ["/dashboard/rentabilidad", "/dashboard/inventario"],
    demo: [
      { icon: "📊", text: "Abre la liquidación del punto" },
      { icon: "📄", text: "Toca «PDF completo»" },
      { icon: "📲", text: "En el celular, compártelo por WhatsApp" },
    ],
  },
  {
    id: 55, date: "2026-11-08", title: "Pestañas nuevas y buscador maestro",
    summary: "Las pestañas de cada sección tienen su ícono y su color para ubicarlas de un vistazo. Y el buscador (Ctrl+K) entiende lo que escribes: «vales», «nueva factura», «liquidasion» con error… te lleva directo a la pestaña o abre el formulario para crear.",
    paths: ["/dashboard"],
    demo: [
      { icon: "🔍", text: "Toca Buscar o Ctrl + K" },
      { icon: "✍️", text: "Escribe «vales» o «nuevo vale»" },
      { icon: "⚡", text: "Enter: te lleva directo, o abre el formulario" },
    ],
  },
  {
    id: 56, date: "2026-11-08", title: "Crear y editar producto, más fácil",
    summary: "La ficha del producto ahora va por secciones (Lo básico, Precios, Inventario, Fotos y videos, Descripción, Características, Códigos y Catálogos), con lo listo marcado ✓, lo opcional señalado, vista previa de cómo se ve en el catálogo y Guardar siempre a la mano.",
    paths: ["/dashboard/products"],
    demo: [
      { icon: "📦", text: "Abre un producto o «Nuevo producto»" },
      { icon: "👉", text: "Ve sección por sección con «Siguiente»" },
      { icon: "👀", text: "Mira a la derecha cómo queda en el catálogo" },
    ],
  },
  {
    id: 57, date: "2026-11-08", title: "Buscadores más livianos",
    summary: "Los buscadores ya no consultan en cada letra: esperan a que pares de escribir (una sola letra espera más) y una línea debajo muestra cuándo va a buscar. Enter busca de una vez, y lo que buscaste hace poco no se vuelve a consultar.",
    paths: ["/dashboard"],
    demo: [
      { icon: "⌨️", text: "Escribe en un buscador" },
      { icon: "⏳", text: "La línea se llena mientras espera" },
      { icon: "⚡", text: "Enter para buscar de una vez" },
    ],
  },
  {
    id: 58, date: "2026-11-08", title: "Lista de productos más cómoda en el celular",
    summary: "Arriba solo queda el buscador y una fila de filtros que se desliza; el punto, la categoría y el orden se abren con «Filtros». Cada producto ocupa menos y hay un botón para volver arriba.",
    paths: ["/dashboard/lista-productos"],
    demo: [
      { icon: "🔎", text: "Busca arriba; la lista se ve casi completa" },
      { icon: "⚙️", text: "Toca «Filtros» para punto, categoría y orden" },
      { icon: "⬆️", text: "Botón flotante para volver arriba" },
    ],
  },
  {
    id: 59, date: "2026-11-08", title: "Mi tienda, por secciones",
    summary: "La configuración de la tienda ahora va por secciones con su ícono y color: Identidad, Apariencia, WhatsApp, Encuéntranos, Enlaces y dominio, Marketing y Google, Clientes, Copias y Acceso rápido. Arriba, el logo, el estado y Guardar.",
    paths: ["/dashboard/store"],
    demo: [
      { icon: "🏪", text: "Abre Mi tienda" },
      { icon: "👉", text: "Elige una sección a la izquierda (o arriba en el celular)" },
      { icon: "💾", text: "Guarda desde arriba" },
    ],
  },
  {
    id: 60, date: "2026-11-08", title: "Inicio e informes renovados",
    summary: "El inicio ahora tiene números que se animan, fichas de colores con su tendencia, «Lo que dicen tus números» (tu mejor día, el producto estrella, la proyección del mes y alertas), gráfica de ventas, ganancia o pedidos, dona de canales, tus días más fuertes y el podio de productos.",
    paths: ["/dashboard"],
    demo: [
      { icon: "💡", text: "Lee «Lo que dicen tus números»" },
      { icon: "📈", text: "Cambia la gráfica entre ventas, ganancia y pedidos" },
      { icon: "🏆", text: "Mira el podio de productos y tus días más fuertes" },
    ],
  },
  {
    id: 61, date: "2026-11-08", title: "Código de tienda para el equipo",
    summary: "Ahora tu equipo entra desde el mismo inicio de sesión: toca «Equipo», escribe el código de la tienda y luego su usuario y contraseña. El código lo pones en Mi tienda → Identidad.",
    paths: ["/dashboard/store"],
    demo: [
      { icon: "🔑", text: "Mi tienda → Identidad → Código de la tienda" },
      { icon: "🎲", text: "Toca «Generar» y guarda" },
      { icon: "👥", text: "Compártelo con tu equipo" },
    ],
  },
  {
    id: 62, date: "2026-11-08", title: "Catálogos y campañas más ordenados",
    summary: "Arriba las pestañas (Catálogos, Campañas, Imagen para redes y Landing pages). Cada catálogo con sus datos en una línea y tres botones: Editar, Ver y Compartir (enlace, WhatsApp, QR y PDF). Buscador y filtro de activos y pausados. Las campañas con su portada, estado y acciones claras.",
    paths: ["/dashboard/social"],
    demo: [
      { icon: "🛍️", text: "Busca o filtra tus catálogos" },
      { icon: "📤", text: "Toca «Compartir» para enlace, WhatsApp, QR o PDF" },
      { icon: "🎯", text: "En Campañas, muestra u oculta con un toque" },
    ],
  },
  {
    id: 63, date: "2026-11-09", title: "POS más cómodo en el celular",
    summary: "Al tocar un producto se pregunta la cantidad y te lleva a él en el carrito para revisar el precio. La lista ya no tiene doble barra para bajar. Abajo, el carrito pequeño con la cantidad de unidades y un botón para crear la remisión de una vez. En celulares sencillos el panel quita efectos para ir más rápido. En el comprobante del pedido se ve mejor el total y hay botón para completar el pedido.",
    paths: ["/dashboard/pos", "/pedido"],
    demo: [
      { icon: "🔢", text: "Toca un producto y escoge la cantidad" },
      { icon: "🛒", text: "El carrito de abajo muestra cuántas unidades llevas" },
      { icon: "⚡", text: "«Crear remisión» directo desde la barra" },
      { icon: "✅", text: "Al confirmar un pedido, complétalo ahí mismo" },
    ],
  },
  {
    id: 64, date: "2026-11-09", title: "Pedidos pendientes en la campana",
    summary: "La campana avisa cuántos pedidos tienes sin confirmar y cuántos confirmados sin completar, con el total; al tocar el aviso se abre Pedidos con esa lista. Y en el POS, cuando ya creaste la remisión, esa venta no vuelve a aparecer al entrar otra vez: solo se recupera la que no alcanzaste a crear.",
    paths: ["/dashboard", "/dashboard/pos", "/dashboard/pedidos"],
    demo: [
      { icon: "🔔", text: "Mira la campana: pedidos sin confirmar y sin completar" },
      { icon: "📦", text: "Toca el aviso y se abre la lista para atenderlos" },
      { icon: "🧾", text: "La venta ya creada no se vuelve a cargar en el POS" },
    ],
  },
  {
    id: 65, date: "2026-11-09", title: "El pedido de mercancía no se pierde",
    summary: "Mientras armas un pedido interno se guarda solo en este equipo. Si te sales por error, cierras la ventana o se recarga la página, al abrir «Pedir mercancía» otra vez sigue con todos los productos, cantidades y el mensaje. En la lista de pedidos internos aparece «Tienes un pedido sin enviar» para seguirlo. Se borra al enviarlo o con «Empezar de cero».",
    paths: ["/dashboard/pedidos", "/dashboard/lista-productos"],
    demo: [
      { icon: "💾", text: "Arma el pedido: se guarda solo" },
      { icon: "📝", text: "Si sales, toca «Seguir armándolo»" },
      { icon: "🗑️", text: "«Empezar de cero» si ya no lo necesitas" },
    ],
  },
  {
    id: 66, date: "2026-11-09", title: "Centro de operaciones en vivo",
    summary: "Ahora sí muestra todo lo que se mueve en el negocio y se actualiza solo: ventas de hoy con su gráfica por hora y comparación con ayer a la misma hora, ventas por punto, lo que está por confirmar y por completar, pedidos internos, traslados en camino, cajas, compras y gastos del mes. Abajo, todos los movimientos por día (ventas, pedidos, traslados, ingresos, ajustes, gastos y cajas) con filtros, buscador y enlace a cada uno. Accesos rápidos para vender, pedir mercancía, trasladar, ingresar factura o registrar un gasto.",
    paths: ["/dashboard/operaciones"],
    demo: [
      { icon: "🟢", text: "Se actualiza solo cada 45 segundos" },
      { icon: "📈", text: "Ventas de hoy contra ayer a la misma hora" },
      { icon: "⏳", text: "Filtra «Por atender» para ver lo pendiente" },
      { icon: "⌨️", text: "Teclas: V vender, P pedir, / buscar" },
    ],
  },
  {
    id: 67, date: "2026-11-09", title: "«¡Publícame!» y Radar de productos",
    summary: "En cada producto hay un botón con megáfono para marcar que lo publicaste hoy (y dónde). Escoge cada cuánto te lo recuerda: diario, cada 3 días, semanal, mensual o los días que quieras; cuando le toca, el megáfono se mueve y la campana te avisa. Nuevo modo Radar en Productos: la salud de cada ficha de 0 a 100, qué le falta (foto, precio, categoría, descripción, costo…), cuáles toca publicar, cuáles están quietos sin vender y agotados. Cada falencia abre el producto en otra ventana justo donde se arregla, y puedes marcar muchos como publicados a la vez.",
    paths: ["/dashboard/products"],
    demo: [
      { icon: "📣", text: "En el producto toca «Publícame»" },
      { icon: "⏰", text: "Escoge cada cuánto te lo recuerdo" },
      { icon: "📡", text: "Cambia a «Radar» para ver lo que falta" },
      { icon: "🩺", text: "Toca una falencia para arreglarla" },
    ],
  },
  {
    id: 68, date: "2026-11-09", title: "Radar de productos más completo",
    summary: "Plan de hoy con los productos que conviene publicar (lo atrasado primero) y aviso al celular a la hora que escojas. «¡Publícame!» trae un kit con el texto listo, las fotos y WhatsApp; al compartir queda marcado solo, y muestra cuánto se vendió la semana antes y después de cada publicación. El Radar muestra la plata quieta, sugiere trasladar a donde sí se vende, filtra por punto, detecta fotos rotas, pequeñas o repetidas, margen bajo y nombres largos, y «Nombre repetido» te muestra cuáles se llaman igual. Editor rápido sin salir, arreglos en grupo (categoría, activar, ocultar), tareas para el equipo, calendario de publicaciones con quién publicó más, gráfica de salud con meta y exportar a Excel.",
    paths: ["/dashboard/products"],
    demo: [
      { icon: "🗓️", text: "Mira tu «Plan de hoy» en el Radar" },
      { icon: "✨", text: "En «Publícame» usa el kit y WhatsApp" },
      { icon: "⚡", text: "Toca «Rápido» para arreglar sin salir" },
      { icon: "📋", text: "Selecciona productos y «Asignar» a alguien" },
    ],
  },
  {
    id: 69, date: "2026-11-09", title: "Plantillas de mensajes para publicar",
    summary: "Arma tus propios mensajes para publicar productos y úsalos con cualquiera: escribe el texto con botones para meter el nombre, precio, descripción, características, enlace, categoría, código, tienda y WhatsApp, negrilla y emojis, y míralo como se ve en WhatsApp. {NOMBRE} en mayúsculas pone el nombre en MAYÚSCULAS. Marca una con ⭐ para usarla siempre. Ya viene «Tu estilo»: 🔥 *NOMBRE* 🔥 💰🔥 *PRECIO* 🔥💰.",
    paths: ["/dashboard/products"],
    demo: [
      { icon: "📣", text: "Abre «Publícame» en un producto" },
      { icon: "📝", text: "Toca «Plantillas» en el kit" },
      { icon: "➕", text: "Arma tu mensaje con los botones" },
      { icon: "⭐", text: "Márcala para usarla siempre" },
    ],
  },
  {
    id: 70, date: "2026-11-09", title: "Comprar desde el enlace y «Lo más vendido»",
    summary: "La página del producto ahora vende: «Comprar ahora» (lo deja en el carrito y lo abre para pedir) y «Agregar y seguir comprando» (lo deja en el carrito del catálogo para sumar más), con cantidad, barra fija en el celular, aviso real de pocas unidades, «Lo más vendido» y «También te puede gustar». Cada plantilla del kit puede llevar a un catálogo (con su precio). En todos los catálogos sale «🔥 Lo más vendido» con insignias Top; se configura en Catálogos y campañas → Campañas: automático, a mano o apagado.",
    paths: ["/dashboard/social", "/dashboard/products"],
    demo: [
      { icon: "📝", text: "En la plantilla escoge a qué catálogo lleva el enlace" },
      { icon: "⚡", text: "El cliente toca «Comprar ahora» y pide" },
      { icon: "🛒", text: "O «Agregar y seguir comprando» para sumar más" },
      { icon: "🔥", text: "Configura «Lo más vendido» en Campañas" },
    ],
  },
  {
    id: 71, date: "2026-11-09", title: "Ofertas «antes y ahora» y destacados",
    summary: "En Precios de cada producto: «Precio de oferta» con fecha de fin opcional y etiqueta (Oferta, Nuevo precio, Liquidación…). Mientras dure se cobra en catálogos y POS, y se ve «Antes $20.000 · Ahora $15.000 · -25 %» con cuenta regresiva; al vencer vuelve solo al precio normal (los precios 1-5 no cambian). Marca productos ⭐ destacados: salen primero y en su franja. Los catálogos muestran «🏷️ Ofertas especiales» y «Destacados». El kit para publicar trae {precio_antes} y {descuento}, más emojis por categorías con buscador, cursiva y tachado, y los canales «Grupo de WhatsApp» y «Difusión de WhatsApp».",
    paths: ["/dashboard/products", "/dashboard/social"],
    demo: [
      { icon: "💲", text: "Producto → Precios → «Oferta y destacado»" },
      { icon: "📅", text: "Pon el precio de oferta y hasta cuándo" },
      { icon: "🏷️", text: "Se ve tachado el de antes en el catálogo" },
      { icon: "⭐", text: "Marca destacados para que salgan primero" },
    ],
  },
  {
    id: 72, date: "2026-11-09", title: "Botón de comprar siempre a la vista",
    summary: "En la página del producto la barra de compra queda fija abajo (celular y computador): cambias la cantidad ahí mismo, el carrito naranja se mueve suave para invitar a agregar y «Comprar» en verde lleva directo a pedir.",
    paths: ["/dashboard/products"],
    demo: [
      { icon: "📱", text: "Abre un producto desde el catálogo" },
      { icon: "➕", text: "Cambia la cantidad en la barra de abajo" },
      { icon: "🛒", text: "Toca el carrito para seguir comprando" },
      { icon: "⚡", text: "O «Comprar» para pedir de una" },
    ],
  },
  {
    id: 73, date: "2026-11-09", title: "Productos destacados que resaltan",
    summary: "Los productos ⭐ destacados salen primero en el catálogo con borde dorado que gira, cinta «Destacado» con brillo y botón de agregar dorado, y aparecen en la franja «Destacados». Puedes destacar varios a la vez desde el Radar (selecciona y toca «⭐ Destacar»), uno por uno en Producto → Precios, o por catálogo en Catálogos → Productos.",
    paths: ["/dashboard/products", "/dashboard/social"],
    demo: [
      { icon: "📡", text: "En el Radar selecciona productos" },
      { icon: "⭐", text: "Toca «⭐ Destacar»" },
      { icon: "✨", text: "Salen primero y dorados en el catálogo" },
    ],
  },
  {
    id: 74, date: "2026-11-10", title: "«Lo más vendido» por catálogo",
    summary: "En Campañas → Lo más vendido hay una pestaña General y una por cada catálogo. La general escoge en qué catálogos sale; cada catálogo puede tener la suya propia (automático, a mano o apagado, sus productos, título, subtítulo, emoji, cuántos mostrar). En automático, un catálogo con punto (como Zamora) muestra lo más vendido de ese punto. Los precios son siempre los de cada catálogo. Además, el carrito de la página del producto lleva al catálogo de donde vino el producto (Zamora, mayoristas…).",
    paths: ["/dashboard/social"],
    demo: [
      { icon: "🔥", text: "Campañas → Lo más vendido" },
      { icon: "🛍️", text: "Escoge en qué catálogos sale" },
      { icon: "✨", text: "En un catálogo toca «Personalizar»" },
      { icon: "😀", text: "Cambia su título, emoji y productos" },
    ],
  },
  {
    id: 75, date: "2026-11-10", title: "Funciones opcionales para vender más",
    summary: "Nueva sección Configuración → Funciones opcionales: un interruptor por función, todas apagadas hasta que las enciendas. Carritos abandonados (quién dejó su WhatsApp y no envió el pedido, para escribirle con un toque), «Avísame cuando llegue» en productos agotados, cupones de descuento (por % o por valor, con fechas, límite de usos y catálogos; no se suman a las ofertas) y la barra «te faltan $X para el envío gratis» con tus propios mensajes. La campana te avisa cuando hay carritos por recuperar o cuando llegó lo que alguien esperaba.",
    paths: ["/dashboard/vender-mas"],
    demo: [
      { icon: "🧩", text: "Configuración → Funciones opcionales" },
      { icon: "🔘", text: "Enciende la que quieras" },
      { icon: "🎟️", text: "Crea un cupón como BIENVENIDO" },
      { icon: "🛒", text: "Escríbele a quien dejó su carrito" },
    ],
  },
  {
    id: 76, date: "2026-11-10", title: "Más funciones opcionales: clientes, traslados y conteos",
    summary: "En Funciones opcionales ahora también puedes encender: imagen de oferta para estados (precio de antes tachado, el de ahora y el %), recompra y cumpleaños de clientes (a quién escribirle porque ya debería volver, quién cumple esta semana y el historial de cada cliente), traslados sugeridos («Zamora tiene 20 y no vende; Manhattan está en 0», arma el traslado con un toque) y conteo por zonas con aprobación (cuentas con la cámara sin cerrar la tienda y se ajusta solo la diferencia cuando alguien lo aprueba). El cierre del día también se puede apagar y ahora dice cuántos pedidos siguen sin confirmar.",
    paths: ["/dashboard/vender-mas", "/dashboard/clientes", "/dashboard/inventario"],
    demo: [
      { icon: "🧩", text: "Enciende la función en Funciones opcionales" },
      { icon: "🎂", text: "Clientes → Recompra: felicita y escribe" },
      { icon: "🔀", text: "Traslados → Ver desbalances" },
      { icon: "📷", text: "Stock → Conteos: cuenta una zona" },
    ],
  },
  {
    id: 77, date: "2026-11-10", title: "Primeros pasos guiados y tienda demo",
    summary: "Los primeros pasos de una tienda nueva ahora marcan el siguiente paso, incluyen «confirma tu primera venta» y celebran cuando terminas (se pueden apagar en Funciones opcionales). Para el administrador de RemHub: tienda de demostración en Admin → Tienda demo. Escoges una tienda de prueba y el usuario con el que entran los visitantes, tomas una foto y cada cierto tiempo (tú lo escoges) vuelve sola a como estaba. Los visitantes entran desde remhub.co/demo.",
    paths: ["/admin/demo", "/dashboard/vender-mas"],
    demo: [
      { icon: "🧪", text: "Admin → Tienda demo" },
      { icon: "🏪", text: "Escribe la tienda y el usuario demo" },
      { icon: "📸", text: "Toma la foto de la base" },
      { icon: "🚀", text: "Comparte remhub.co/demo" },
    ],
  },
];

/** La novedad más reciente que trae este código (la versión que corre en la pestaña). */
export const BUILD_RELEASE = RELEASES.reduce((m, r) => Math.max(m, r.id), 0);
