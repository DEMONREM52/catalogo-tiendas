# RemHub Logistics — seguimiento

Documento vivo del pedido «REMHUB LOGISTICS PRO» (supabase/migrations/ayuda.txt, 49 secciones). Aquí quedan la revisión de lo que existe, las decisiones, lo hecho, lo pendiente y lo bloqueado, para continuar por fases sin perder el hilo.

Última actualización: 27/11/2026 (fases 1-12).

## 1. Revisión: lo que ya existe (leído en el código)

| Pieza | Dónde | Qué hace hoy |
|---|---|---|
| Pedido interno | `erp_stock_requests` + `erp_stock_request_items` | Un punto le pide a otro. Estados: `pending` → `preparing` → `dispatched` → `received` (+ `rejected`, `cancelled`). Cantidades: pedida, a enviar (`qty_approved`), recibida. |
| Chuleo por etapa | `erp_sr_item_checks` (20261277) | Dos listas separadas: `pack` (quien despacha) y `receive` (quien recibe). Quién y a qué hora. En vivo. |
| Firmas | 20261276/1278 | Preparó, Revisó, En camino y Recibió, desde el panel o por enlace. |
| Pedido ↔ traslado | 20261280/1281/1282 | Al **enviar**, el pedido crea su traslado (`transfer_id`). Recibir el traslado (por enlace o en Inventario) cierra el pedido; anular el traslado anula el pedido. |
| Inventario | traslado | Sale del origen al **enviar** (aunque quede en 0 o negativo) y entra al destino al **recibir**, con kardex. Llegó de más / llegó algo más: 20261281/1343. |
| Lotes | 20261346 | Juntar pedidos del mismo origen, sacarlos juntos y repartir. Cantidades a enviar que se guardan solas. |
| Enlaces | `/traslado/<token>`, enlace de firma del pedido | El traslado tiene su propio enlace de seguimiento; el pedido comparte su enlace de firmas. |
| Impresión | `/documento/pedido-interno/[id]` | Carta y tirilla con `MovementDocument`. |
| Buscadores | `ProductPicker`, `ProductSearchModal`, `ProductFinder`, POS | Foto + texto. Desde 27/11/2026 el lector solo escribe y Enter solo busca (`usePickKeys`). |
| F2 | POS, ingresos, traslados, ajustes, productos | Por pantalla; no hay un administrador central. |
| En vivo | `StockRequestWatcher` | Una sola conexión del panel; avisa con `STOCK_REQUESTS_CHANGED_EVENT`. |

**Lo que no existe y pide el documento:** cajas; un traslado hecho en Inventario no crea pedido interno; estados separados por etapa (aprobación, empaque, despacho, recepción); recepción parcial en varias entregas; novedades con resolución; icono de escáner aparte de la foto; F2 universal; centro de control logístico; configuración del flujo por empresa.

## 2. Decisiones tomadas

1. **Las cajas no mueven inventario.** Son logística: dicen en qué caja va cada unidad de lo que se envía. El inventario sigue moviéndose al enviar y al recibir, como hoy (§20 del pedido: «el empaquetado no es un movimiento de existencias»).
2. **Las cajas cuelgan del pedido interno**, que hoy es la operación con chuleo, firmas, chat y enlace. El traslado se crea al enviar y queda unido al pedido.
3. **Ninguna unidad en dos cajas:** la suma de las cajas de un producto nunca pasa de lo que se envía. Cada cambio bloquea el pedido mientras se guarda (`for update`), así dos personas empacando a la vez no se pisan, y lleva llave (`p_key`) para no repetirse con un doble toque o un reintento.
4. **Nunca se pierde un producto:** solo se borra una caja vacía; vaciarla devuelve sus unidades a «sin caja». Las demás cajas conservan su número.
5. **QR de caja sin datos:** lleva `…/dashboard/pedidos?tab=internos&caja=<código>`. Se resuelve con sesión y permisos (`erp_sr_box_resolve`); a quien no ve el pedido no le dice ni si existe. Escanearlo abre el pedido, no da nada por recibido.
6. **Después de enviar, las cajas son solo de ver**, salvo en los pedidos que nacen de un traslado de Inventario (ver 7).
7. **Traslado de Inventario = pedido interno (decisión del usuario, 27/11/2026).** Al guardarse, el traslado crea su pedido `origin = transfer`, unido por `transfer_id`. Nace **«En camino»** (no «en preparación» como se propuso al principio): en Inventario el traslado ya descuenta del origen al guardarse, y un pedido «en preparación» al enviarse crearía otro traslado y la mercancía saldría dos veces. Como allí se empaca después de guardar, sus cajas se pueden armar mientras va en camino y nadie ha empezado a recibir. Se crea con un disparador diferido (al final de la transacción) que no hace nada si el traslado ya tiene pedido (el que crea un pedido al enviarse) y nunca frena el traslado (si falla, queda `stock_request.from_transfer_failed` en la auditoría). El número del pedido sale como en «Nuevo pedido» (se lee de `erp_stock_request_create` al correr la migración).
8. **No se reserva inventario** (decisión del usuario): sale al enviar, como hoy.
9. **Se recibe todo de una vez** (decisión del usuario), con el chuleo de siempre. «Llegó esta caja» solo chulea los productos que quedan completos; el recibido (y el inventario) se confirma una sola vez.
10. **El escáner nunca elige en un buscador:** lo leído se escribe y la persona elige (decisión del 27/11/2026). El único modo que actúa solo es «Escanear a una caja», que se abre a propósito, exige coincidencia exacta con un producto del pedido y no pasa de lo que falta.

## 3. Fases

| Fase | Estado | Qué |
|---|---|---|
| 1. Revisión y arquitectura | ✅ | Secciones 1 y 2. |
| 2. Traslado → pedido | ✅ 20261349 | Pedido «en camino» por cada traslado de Inventario; corregir el traslado corrige su pedido; el inventario lo mueve solo el traslado. La bandeja lo muestra entrante/saliente según tu punto; Inventario → Traslados muestra «📝 Pedido #N». |
| 3. Selección y cantidades parciales | ✅ | Elegir productos, todos los visibles o filtrados, y cuántas unidades de cada uno. |
| 4. Cajas | ✅ 20261348 | Ver §4. |
| 5. Celular y barra flotante | ✅ | Barra flotante con selección, fija abajo con área segura; la de «Te toca» se esconde mientras eliges. Hojas inferiores en el celular. |
| 6. Impresión | ✅ | Carta, tirilla 80 y 58 mm: cajas y lo que falta, cajas elegidas, sin caja, consolidado y etiquetas de caja con QR. |
| 7. Enlace del traslado | ✅ | `/traslado/<enlace>` ya mostraba el pedido; ahora también sus cajas (`erp_transfer_track_boxes`, mismo vencimiento que el enlace, sin costos). |
| 8. Recepción por caja | ✅ | «Llegó esta caja» (`erp_sr_box_receive`); escanear el QR de la caja abre su pedido en la vista de cajas. Novedades: los comentarios por producto ahora tienen «📉 Faltó», «📈 Llegó de más» y «❌ Producto equivocado» (además de «Dañado» y «Cambiar por otro»), con cantidad y «resuelto»; no mueven inventario. |
| 9. Escáner y F2 | ✅ | Icono de escáner (cámara) aparte de la foto en ingresos, traslados, ajustes, pedidos, XML, POS, productos, lista general y etiquetas; F2 central (`src/lib/shortcuts/f2.ts`); «Escanear a una caja» con lector o cámara continua. |
| 10. Conteos y ajustes | ✅ 20261351 | «👥 Conteo en grupo» en Ajustes: varias personas a la vez desde su celular, cada una lo suyo y se suma (mismo producto en dos sitios); guardado en la base (se sigue otro día o desde otro equipo); en vivo cada 4 s; «a ciegas» opcional; contado en 0 ≠ no contado; buscar, escanear con lector o cámara (+1 o pregunta cuántas, solo código exacto). Al terminar, quien tiene «Ajustes de inventario» lo pasa al ajuste de siempre (informe en plata, inventario inicial, kardex, deuda del punto) y queda «aplicado»; se puede reabrir o anular. «Contar escaneando» usa el lector nuevo (QR en iPhone, linterna) y solo acepta código exacto. Conteo por zonas con aprobación (20261313) e inventario inicial con revertir (20261344) siguen igual. |
| 11. Avisos y control | ✅ (lo que aplica) | El pedido de cada traslado avisa con el push de siempre. Al enviar avisa si quedan unidades sin caja o cajas abiertas (no bloquea). Filtro «⏰ Atrasados» en la bandeja. |
| 12. Pruebas | ✅ automáticas | SQL: cajas 39, traslado→pedido 28, comentarios 15, pedido↔traslado 38, lotes 40. Unitarias 385. **Falta probar en navegador, celular, lector e impresora reales.** |

## 4. Cajas (hecha)

- **Base:** `supabase/migrations/20261348_cajas_pedidos.sql` (copia en `tests/sql/migraciones`). Tablas `erp_sr_box`, `erp_sr_box_items`, `erp_sr_box_ops` (llaves). Solo lectura por RLS (`erp__sr_visible`); se escribe únicamente por funciones `security definer` con `search_path = public` que revisan tienda, permiso y punto (`erp__sr_access → attend`).
- **Funciones:** `erp_sr_boxes`, `erp_sr_box_put` (crear o agregar), `erp_sr_box_take` (sacar o vaciar), `erp_sr_box_move` (a otra caja o a una nueva), `erp_sr_box_update` (nombre, color, notas, frágil, peso, medidas, sello), `erp_sr_box_close` (cerrar o volver a abrir; queda en el chat), `erp_sr_box_delete` (solo vacía), `erp_sr_box_resolve` (QR).
- **Pantalla:** en el pedido, pestaña «📦 Cajas» (`BoxesBoard.tsx`): resumen con avance, cajas como acordeones de color con número (nunca solo color), «Sin caja» con buscador y selección, barra flotante «Guardar en caja», hojas para guardar, editar, mover e imprimir. En la lista de empaque cada producto muestra «📦 C1·30 · C2·40 · 10 sin caja».
- **Impresión:** `/documento/pedido-interno/[id]/cajas?que=…&formato=carta|pos80|pos58`.
- **Pruebas:** `tests/sql/cajas_pedidos.test.mjs` (39) y `tests/pedidos/boxes.test.ts`.
- **Pendiente de probar en el navegador, en celular y con impresora real.**

## 5. Para verificar después de correr 20261349

- Guarda un traslado de prueba en Inventario y revisa que salga en Pedidos internos como «En camino» con el mismo número de productos.
- Si no sale, consulta (solo lectura): `select created_at, detail from erp_audit_logs where action = stock_request.from_transfer_failed order by created_at desc limit 5;` y mándame el resultado.
- Si al correrla dice «faltan datos obligatorios (...)», mándame ese mensaje: hay una columna obligatoria en los pedidos que no conozco.

## 6. Limitaciones conocidas

- Bajar «Enviar» por debajo de lo que ya está en cajas no se bloquea: la vista de cajas avisa «hay más en cajas que lo que se envía».
- Los traslados que ya estaban en camino antes de correr 20261349 no crean pedido (para no mandar un aviso por cada uno); solo los nuevos.
- La cámara lee códigos de barras donde el navegador trae BarcodeDetector (Chrome/Edge en Android y computador). En iPhone/Safari y Firefox solo lee QR (jsQR); para barras, lector USB/Bluetooth.
- No hay estados nuevos (aprobación, empaque parcial…): el pedido sigue con Enviado → Preparando → En camino → Recibido, y las etapas finas se ven con el chuleo, las cajas y las firmas.
- El conteo en grupo se actualiza revisando cada 4 s con la pestaña a la vista (no abre otra conexión en vivo).
- No hay configuración por empresa del flujo ni permisos nuevos: cajas = quien despacha; recibir cajas = quien recibe (los permisos de siempre, revisados en la base).
- La impresión usa la ventana del sistema; el ancho real de cada tirilla depende de la impresora (80 mm → 72 mm útiles; 58 mm → 48 mm).
