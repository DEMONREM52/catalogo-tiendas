# RemHub Logistics — seguimiento

Documento vivo del pedido «REMHUB LOGISTICS PRO» (supabase/migrations/ayuda.txt, 49 secciones). Aquí quedan la revisión de lo que existe, las decisiones, lo hecho, lo pendiente y lo bloqueado, para continuar por fases sin perder el hilo.

Última actualización: 27/11/2026.

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
5. **QR de caja sin datos:** lleva `…/dashboard/pedidos/internos?caja=<código>`. Se resuelve con sesión y permisos (`erp_sr_box_resolve`); a quien no ve el pedido no le dice ni si existe. Escanearlo abre el pedido, no da nada por recibido.
6. **Después de enviar, las cajas son solo de ver.** Corregir después del despacho necesita el flujo de novedades (fase 8).

## 3. Fases

| Fase | Estado | Qué |
|---|---|---|
| 1. Revisión y arquitectura | ✅ | Sección 1 y 2 de este documento. |
| 2. Unificar traslado → pedido | ⏸️ **Necesita tu decisión** | Que un traslado creado en Inventario aparezca como pedido interno (saliente/entrante). Ver §5. |
| 3. Selección y cantidades parciales | ✅ (para cajas) | Elegir productos, todos los visibles o filtrados, y cuántas unidades de cada uno. |
| 4. Cajas | ✅ 20261348 | Ver §4. |
| 5. Celular y barra flotante | ✅ (cajas) | Barra flotante con selección, fija abajo con área segura; la de «Te toca» se esconde mientras eliges. Hojas inferiores en el celular. |
| 6. Impresión de cajas | ✅ | Carta, tirilla 80 y 58 mm: cajas y lo que falta, solo cajas (todas o elegidas), sin caja, consolidado y etiquetas de caja con QR. Una página por caja, firmas, fotos. |
| 7. Enlace del traslado como pedido | ⏳ | Depende de la fase 2. |
| 8. Recepción por caja y novedades | ⏳ | Escanear la caja ya abre su pedido (hecho). Falta: recibir por caja, recepciones parciales en varias entregas, novedades con fotos y resolución. |
| 9. Buscador universal, escáner y F2 | 🟡 | Hecho: Enter del lector no elige solo (todos los buscadores). Falta: icono de escáner con cámara aparte de la foto, F2 central, modos de escaneo continuo. |
| 10. Conteos | ⏳ | Mejoras sobre 20261320/1340/1344. |
| 11. Colaboración, avisos, responsables | ⏳ | |
| 12. Seguridad, rendimiento, pruebas finales | ⏳ | |

## 4. Fase 4 — Cajas (hecha)

- **Base:** `supabase/migrations/20261348_cajas_pedidos.sql` (copia en `tests/sql/migraciones`). Tablas `erp_sr_box`, `erp_sr_box_items`, `erp_sr_box_ops` (llaves). Solo lectura por RLS (`erp__sr_visible`); se escribe únicamente por funciones `security definer` con `search_path = public` que revisan tienda, permiso y punto (`erp__sr_access → attend`).
- **Funciones:** `erp_sr_boxes`, `erp_sr_box_put` (crear o agregar), `erp_sr_box_take` (sacar o vaciar), `erp_sr_box_move` (a otra caja o a una nueva), `erp_sr_box_update` (nombre, color, notas, frágil, peso, medidas, sello), `erp_sr_box_close` (cerrar o volver a abrir; queda en el chat), `erp_sr_box_delete` (solo vacía), `erp_sr_box_resolve` (QR).
- **Pantalla:** en el pedido, pestaña «📦 Cajas» (`BoxesBoard.tsx`): resumen con avance, cajas como acordeones de color con número (nunca solo color), «Sin caja» con buscador y selección, barra flotante «Guardar en caja», hojas para guardar, editar, mover e imprimir. En la lista de empaque cada producto muestra «📦 C1·30 · C2·40 · 10 sin caja».
- **Impresión:** `/documento/pedido-interno/[id]/cajas?que=…&formato=carta|pos80|pos58`.
- **Pruebas:** `tests/sql/cajas_pedidos.test.mjs` (39) y `tests/pedidos/boxes.test.ts`.
- **Pendiente de probar en el navegador, en celular y con impresora real.**

## 5. Decisiones que necesito del usuario

1. **Traslado hecho en Inventario → pedido interno.** Propuesta: al guardar un traslado en Inventario, crear su pedido interno ya «en preparación» (saliente para el origen, entrante para el destino), unido por `transfer_id`, sin mover inventario dos veces (el inventario lo sigue moviendo solo el traslado). Cambia cómo se ven los traslados en Pedidos internos y genera avisos a los puntos. Es un cambio de regla del flujo.
2. **¿Reservar inventario al aprobar?** Hoy no se reserva: sale al enviar. Reservar cambia las existencias disponibles del POS.
3. **Recepción parcial en varias entregas** (llegaron 4 de 5 cajas y la quinta después). Hoy la recepción es una sola vez; habría que separar el traslado en entregas.

## 6. Limitaciones conocidas

- Bajar «Enviar» por debajo de lo que ya está en cajas no se bloquea: la vista de cajas avisa «hay más en cajas que lo que se envía» para que se corrija.
- Las cajas no se muestran todavía en el enlace público del traslado ni en el de firmas.
- La impresión usa la ventana del sistema; el ancho real de cada tirilla depende de la impresora (80 mm → 72 mm útiles; 58 mm → 48 mm).
