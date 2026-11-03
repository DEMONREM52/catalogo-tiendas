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
export type ReleaseStep = { icon: string; text: string };
export type Release = {
  id: number;
  date: string;
  title: string;
  summary: string;
  paths: string[];
  important?: boolean;
  demo?: ReleaseStep[];
};

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
];

/** La novedad más reciente que trae este código (la versión que corre en la pestaña). */
export const BUILD_RELEASE = RELEASES.reduce((m, r) => Math.max(m, r.id), 0);

/** ¿La novedad toca esta ruta? */
export function releaseTouches(r: Release, pathname: string) {
  if (r.important) return true;
  return r.paths.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
