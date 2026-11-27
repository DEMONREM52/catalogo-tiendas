# REM: catálogo de capacidades

> Generado desde `src/lib/rem` con `npm run rem:catalog`. No lo edites a mano: `tests/rem/catalog-sync.test.ts` falla si quedó viejo.

Versión del catálogo: `7422d2ef` · 119 capacidades · 33 módulos.

Que REM conozca algo no quiere decir que cualquiera lo pueda usar: abre solo lo que la persona puede abrir a mano, y la base vuelve a revisar el permiso en cada consulta o cambio.

## Módulos

| Módulo | Ruta | Para qué sirve | Cómo se hace (pasos verificados) |
|---|---|---|---|
| Inicio e informes | `/dashboard` | Es la primera pantalla: tus pendientes, las ventas de hoy de tus puntos comparadas con ayer, lo más vendido de la semana, las metas del mes y el cierre del día. | — |
| POS / Vender | `/dashboard/pos` | Es donde se vende en el mostrador: buscas los productos, también con la cámara, armas la venta, eliges el cliente y la forma de pago y cobras. La venta descuenta las existencias del punto. Debajo del carrito sugiere lo que más se vende junto con lo que llevas («también llevan»). Antes de cobrar dice en una frase qué se va a crear (remisión o factura electrónica, número, punto y si va a la DIAN); al terminar muestra el número, el vuelto, si la DIAN la aceptó y botones para imprimir, mandarla por WhatsApp o empezar otra venta. En el celular se cobra en una sola hoja. | hacer una venta (por voz) |
| Caja | `/dashboard/caja` | Sirve para abrir y cerrar la caja de cada punto, contar el efectivo y ver si hay diferencias. | abrir la caja (3 pasos); cerrar la caja (3 pasos) |
| Apartados y cotizaciones | `/dashboard/apartados` | Para separar productos a un cliente que va abonando, y para hacer cotizaciones. | hacer un apartado (3 pasos); hacer una cotización (3 pasos) |
| Promociones y combos | `/dashboard/promociones` | Para crear descuentos, ofertas y combos de productos. | crear una promoción (5 pasos) |
| Garantías y devoluciones | `/dashboard/garantias` | Para registrar garantías, cambios y devoluciones de lo vendido. | registrar una garantía o devolución (4 pasos) |
| Factura electrónica | `/dashboard/fiscal` | Para la facturación electrónica ante la DIAN: los documentos enviados, los que están pendientes o rechazados y la numeración con sus resoluciones. | — |
| Datos de facturación | `/dashboard/store/billing` | Son los datos de facturación de la tienda. Solo los ve el dueño o el administrador. | — |
| Productos | `/dashboard/products` | Es la lista de productos de la tienda: los buscas, los filtras, los editas, cambias fotos y precios, los activas o inactivas y los marcas para publicar en redes con Publícame. Si tocas el nombre de un producto en la lista se abre la edición rápida (foto, nombre, código de barras, categorías y descripción). Con F2 buscas otro producto para editar, también desde la pantalla de editar; si tienes cambios sin guardar te pregunta si guardas antes de cambiar. En cada producto, en Precios, «Precio en los puntos» muestra lo que cobra el POS de cada punto (el precio de la tienda con la regla del punto). También ahí eliges qué etiquetas se ven en el catálogo y desde/hasta cuándo: Llegó nuevo, Bajó de precio (con el precio de antes que escribas), En promoción y Destacado. | crear un producto (5 pasos); subir productos desde Excel (sin pasos) |
| Radar de productos | `/dashboard/products/radar` | Revisa los productos y te dice qué les falta: sin foto, sin precio, quietos o sin ventas, o con un código metido en el nombre. También arma el plan del día para publicar en redes con recordatorio, muestra lo que llegó o volvió en los últimos 7 días (y lo que llegó sin foto o sin categoría), y desde ahí puedes inactivar los que ya no hay. | — |
| Lista general de productos | `/dashboard/lista-productos` | Es para consultar productos y precios sin poder cambiarlos. | — |
| Etiquetas | `/dashboard/etiquetas` | Imprime etiquetas con QR o código de barras, nombre, referencia y precio en el papel de tu impresora (por ejemplo 3 etiquetas de 31×25 mm por fila). Eliges los productos y cuántas de cada uno (o llegas desde un producto, un ingreso, un traslado o la Lista general), la plantilla y la impresora, ves cada fila antes y se abre la ventana de impresión. Al registrar un ingreso de factura (o desde su historial, botón «🏷️ Etiquetas») se imprimen todas sus etiquetas de una vez, una por unidad, con tu plantilla. En «Plantillas» diseñas las tuyas moviendo textos, QR, códigos, imágenes y figuras en milímetros; en «Impresoras» configuras el papel y calibras con hojas de prueba; en «Historial» repites lo que ya imprimiste. | — |
| Categorías | `/dashboard/categories` | Agrupa los productos para ordenar el catálogo y los informes. Muestra cada categoría en tarjeta con su imagen, cuántos productos tiene, su orden y si se ve en el catálogo; arriba cuenta cuántas hay visibles, ocultas y sin imagen, y al tocar cada número filtra. También hay vista en lista. | crear una categoría (3 pasos); cambiar una categoría (3 pasos) |
| Inventario | `/dashboard/inventario` | Aquí se maneja la mercancía: existencias por punto y bodega, traslados entre puntos, ajustes y auditorías de conteo (qué cuadra, qué sobra, qué falta y qué quedó sin contar, en unidades y en plata al costo), el «Inventario inicial» (la lista es todo lo que hay en esa bodega y lo demás queda en 0, con «↩️ Revertir» si te arrepientes), conteos, kardex, facturas de compra, proveedores, cuentas por pagar, la cuenta con los puntos y los vencimientos. El costo y las existencias entran con la factura de compra. En un punto con crédito, cada ajuste mueve su deuda con la bodega: lo que falta la baja y lo que sobra la sube, a precio de bodega (antes de aplicar te muestra cuánto). En el ingreso y en los ajustes, quien tiene permiso de Productos toca el nombre de un producto para editarlo rápido (foto, nombre, código de barras, categorías y descripción). Cada traslado que se guarda aquí aparece también como pedido interno (en camino), con su chat, sus cajas y el recibido: el inventario lo mueve una sola vez el traslado. En los buscadores de productos, el icono de escáner lee códigos con la cámara y F2 lleva al buscador. | ingresar una factura de compra (7 pasos); hacer una orden de compra (4 pasos); hacer un traslado (por voz); hacer un conteo (por voz); hacer una auditoría del inventario (5 pasos); contar el inventario entre varias personas (4 pasos); hacer un inventario inicial (5 pasos) |
| Pedidos | `/dashboard/pedidos` | Tiene dos partes: los pedidos de clientes que llegan por el catálogo o WhatsApp, y los pedidos internos, cuando un punto le pide mercancía a la bodega. Al recibir un pedido interno, si llegó un producto que no venía en el envío, se toca «📦 Llegó algo más»: se suma al traslado y queda en el chat para revisarlo. Quien despacha puede juntar varios pedidos que salen del mismo lugar en un lote (una sola lista para sacarlos y luego repartir lo de cada punto) y deshacerlo cuando quiera; lo que escribe en «Enviar» se guarda solo. En «📦 Cajas» guarda los productos en cajas (Caja 1, Caja 2…), puede repartir un mismo producto entre varias, cerrarlas con sello, empacar escaneando (lector o cámara) a la caja activa e imprimir la lista por cajas o las etiquetas con QR; las cajas no mueven inventario. Quien recibe marca «Llegó esta caja» y lo que queda completo se chulea solo; el recibido se confirma una sola vez. Los traslados hechos en Inventario también salen aquí como pedidos en camino. El filtro «⏰ Atrasados» muestra los que pasaron su fecha. | hacer un pedido interno (por voz); guardar productos de un pedido interno en cajas (4 pasos); buscar los pedidos que llevan un producto (3 pasos) |
| Centro de operaciones | `/dashboard/operaciones` | Reúne los documentos y movimientos de la tienda en un solo lugar: ventas, pedidos, traslados y lo de inventario. | — |
| Terceros y cartera | `/dashboard/clientes` | Aquí están los clientes y los proveedores, la cartera con lo que te deben (abonos, notas crédito y débito, y el estado de cuenta para mandarle al cliente por WhatsApp o en PDF), los avisos de cobro por WhatsApp, los clientes frecuentes y los puntos de fidelidad. Consumidor final no puede tener crédito. | crear un cliente (4 pasos); mandarle el estado de cuenta a un cliente (3 pasos); hacer una nota crédito o débito (5 pasos) |
| Catálogos y campañas | `/dashboard/social` | Para los catálogos en línea que compartes con los clientes, el catálogo en PDF y las campañas para redes. | — |
| Landing pages | `/dashboard/landing` | Páginas de un producto para pauta y anuncios, con inventario aparte por punto y sus ventas y ganancia aparte. | — |
| Mensajes | `/dashboard/mensajes` | Chat y llamadas con el equipo de la tienda. | — |
| Rentabilidad | `/dashboard/rentabilidad` | Muestra la ganancia, que es la venta menos el costo, por punto y por producto. También están los precios por punto, los límites de precio, los repartos y liquidaciones de la ganancia y un simulador de precios. | — |
| Gastos y nómina | `/dashboard/gastos` | Para los gastos de la tienda y de cada punto, los gastos fijos, los presupuestos, la nómina de los empleados, los vales y préstamos y las reservas. El dueño o el administrador ven además el flujo de caja de los próximos 30 días: lo que entra (ventas promedio y cartera) frente a lo que sale (proveedores, gastos y nómina). | registrar un gasto (4 pasos) |
| Comisiones y metas | `/dashboard/equipo` | Las metas del mes por punto o por vendedor, cómo van, y las comisiones. | — |
| Nómina electrónica | `/dashboard/nomina-electronica` | Para enviar la nómina electrónica a la DIAN. | — |
| Para el contador | `/dashboard/contador` | Arma los asientos contables con el PUC para exportarlos al programa del contador. | — |
| Mi tienda | `/dashboard/store` | Los datos de la tienda: logo, nombre, redes, enlaces y WhatsApp. | — |
| Mi plan | `/dashboard/plan` | Tu plan de RemHub y sus pagos. Solo lo ven el dueño y el administrador. | — |
| Usuarios y permisos | `/dashboard/store/users` | Para crear los usuarios del equipo y decidir qué puede hacer cada uno. | crear un usuario (4 pasos) |
| Puntos | `/dashboard/puntos` | Para configurar los puntos de venta y las bodegas de la tienda. | — |
| Funciones opcionales | `/dashboard/vender-mas` | Funciones que se encienden o se apagan, como carritos abandonados, «Avísame cuando llegue», cupones, envío gratis y recompra. Vienen apagadas. | — |
| Importar y exportar | `/dashboard/datos` | Para descargar en Excel los datos de la tienda y para subir datos desde Excel. | — |
| Copias y seguridad | `/dashboard/seguridad` | Para las copias de seguridad de la tienda. | — |
| Auditoría | `/dashboard/auditoria` | Muestra quién hizo qué, cuándo y qué cambió en la tienda. | — |

## Pantallas con voz

| Pantalla | Se abre diciendo | Permisos (basta uno) | Riesgo | Confirmación | Qué guarda o cambia |
|---|---|---|---|---|---|
| Traslados | «Quiero hacer un traslado», «Traslado de bodega a Zamora» | Traslados (`transfers`) | alto | «Di sí o no» | Envía el traslado (mueve existencias) después de «¿Lo envío?» |
| Conteos | «Quiero hacer un conteo» | Conteos físicos 📋 (`inventory_counts`), Ajustes de inventario (`inventory_adjust`) | alto | «Di sí o no» | Anota lo contado en el conteo abierto |
| Pedidos internos | «Quiero hacer un pedido interno» | Pedidos internos (`stock_requests`) | alto | «Di sí o no» | Envía el pedido a la bodega después de confirmar |
| Compras | «Registrar una compra» | Compras (`purchases`) | alto | «Di sí o no» | Llena la factura de compra; se guarda al confirmar |
| POS | «Vender», «Quiero hacer una venta» | POS / Facturar (`pos`) | alto | «Di sí o no» | Arma el carrito; se cobra al confirmar |
| Productos | «Búscame en los productos la cámara SC30», «Inactiva el dos» | Editar productos (`products`) | alto | «Di sí o no» | Busca y filtra; activa o inactiva un producto después de «Di sí o no» |

## Acciones que REM ejecuta solo

| Acción | Riesgo | Confirmación | Permisos (basta uno) |
|---|---|---|---|
| `sales.summary` Consultar las ventas | bajo | — | POS / Facturar (`pos`), Informes de ventas (`reports`), Pedidos de catálogo (`orders`), Informes de ventas (`reports`), Revisar cajas (`cash_manage`), Ver rentabilidad (`profit_view`) |
| `stock.product` Consultar las existencias de un producto | bajo | — | Editar productos (`products`), Ver lista general de productos (`products_view`), Inventario y kardex (`inventory`), POS / Facturar (`pos`), Compras (`purchases`) |
| `expenses.summary` Consultar los gastos | bajo | — | Gastos (`expenses`), Pagar gastos (`expenses_pay`), Presupuestos, gastos fijos y reservas (`budgets`) |
| `debts.summary` Consultar la cartera | bajo | — | Cartera (`receivables`), Créditos y cupos (`credit`) |
| `profit.summary` Consultar la ganancia | bajo | — | Ver rentabilidad (`profit_view`) |
| `tasks.mine` Consultar mis pendientes | bajo | — | cualquiera de la tienda |
| `payables.summary` Consultar las cuentas por pagar | bajo | — | Cuentas por pagar (`payables`) |
| `cash.status` Consultar la caja | bajo | — | Caja de su punto 💵 (`cash`), Revisar cajas (`cash_manage`) |
| `goals.progress` Consultar metas y comisiones | bajo | — | cualquiera de la tienda |

## Matriz de permisos: páginas y formularios

Sale del buscador Ctrl+K (`src/lib/search-index.ts`) y del menú (`src/lib/module-tabs.ts`). Formularios = riesgo medio: REM los abre vacíos, la persona los llena y guarda.

| Capacidad | Tipo | Ruta | Permisos (basta uno) | Solo dueño o admin |
|---|---|---|---|---|
| Nueva venta (POS) | formulario | `/dashboard/pos` | POS / Facturar (`pos`) |  |
| Ingresar factura de compra | formulario | `/dashboard/inventario?tab=purchases` | Compras (`purchases`) |  |
| Nuevo producto | formulario | `/dashboard/products/crear` | Crear productos ✨ (`products_create`), Editar productos (`products`) |  |
| Importar productos desde Excel | formulario | `/dashboard/products/importar` | Importar productos (Excel) 📥 (`products_import`) |  |
| Nuevo traslado | formulario | `/dashboard/inventario?tab=transfers` | Traslados (`transfers`), Inventario y kardex (`inventory`) |  |
| Nuevo pedido interno | formulario | `/dashboard/pedidos?tab=internos&nuevo=1` | Pedidos internos (`stock_requests`), Atender pedidos internos (`stock_requests_manage`), Traslados (`transfers`) |  |
| Nuevo vale a empleado | formulario | `/dashboard/gastos?tab=loans&nuevo=vale` | Nómina (`payroll`), Aprobar nómina (`payroll_approve`), Pagar nómina (`payroll_pay`) |  |
| Nuevo gasto | formulario | `/dashboard/gastos?tab=expenses&nuevo=gasto` | Gastos (`expenses`), Pagar gastos (`expenses_pay`) |  |
| Nuevo gasto fijo | formulario | `/dashboard/gastos?tab=recurring&nuevo=gasto-fijo` | Gastos (`expenses`), Presupuestos, gastos fijos y reservas (`budgets`) |  |
| Nueva nómina | formulario | `/dashboard/gastos?tab=payroll&nuevo=nomina` | Nómina (`payroll`) |  |
| Nuevo empleado | formulario | `/dashboard/gastos?tab=payroll&nuevo=empleado` | Nómina (`payroll`) |  |
| Nueva reserva | formulario | `/dashboard/gastos?tab=reserves&nuevo=reserva` | Presupuestos, gastos fijos y reservas (`budgets`) |  |
| Preparar liquidación | formulario | `/dashboard/rentabilidad?tab=settle` | Preparar liquidaciones (`profit_settle`), Aprobar liquidaciones (`profit_settle_approve`) |  |
| Nueva regla de precio por punto | formulario | `/dashboard/rentabilidad?tab=rules` | Reglas de precio por punto (`profit_rules`), Aprobar reglas de precio (`profit_approve`) |  |
| Nueva promoción o combo | formulario | `/dashboard/promociones` | Cambiar precios y % de ganancia 💲 (`products_prices`), Reglas de precio por punto (`profit_rules`), Autorizar precios 🔓 (`price_approve`) |  |
| Nuevo apartado | formulario | `/dashboard/apartados` | Apartados (`pos_layaways`) |  |
| Nueva cotización | formulario | `/dashboard/apartados?tab=cotizaciones` | Cotizaciones (`pos_quotes`), Pedidos de catálogo (`orders`) |  |
| Registrar garantía o devolución | formulario | `/dashboard/garantias` | POS / Facturar (`pos`), Inventario y kardex (`inventory`), Devolución de venta (`sales_return`) |  |
| Nuevo ajuste de inventario | formulario | `/dashboard/inventario?tab=adjustments` | Ajustes de inventario (`inventory_adjust`), Inventario y kardex (`inventory`) |  |
| Nuevo cliente o tercero | formulario | `/dashboard/clientes` | Terceros (`clients`) |  |
| Nuevo chat | formulario | `/dashboard/mensajes?nuevo=1` | Mensajes y llamadas 💬 (`messages`) |  |
| Nuevo usuario | formulario | `/dashboard/store/users` | Usuarios y permisos (`users`) |  |
| Abrir o cerrar caja | formulario | `/dashboard/caja` | Caja de su punto 💵 (`cash`), Revisar cajas (`cash_manage`) |  |
| Resumen de gastos | página | `/dashboard/gastos?tab=overview` | Gastos (`expenses`), Pagar gastos (`expenses_pay`), Presupuestos, gastos fijos y reservas (`budgets`), Nómina (`payroll`), Aprobar nómina (`payroll_approve`), Pagar nómina (`payroll_pay`) |  |
| Gastos | página | `/dashboard/gastos?tab=expenses` | Gastos (`expenses`), Pagar gastos (`expenses_pay`) |  |
| Gastos fijos | página | `/dashboard/gastos?tab=recurring` | Gastos (`expenses`), Presupuestos, gastos fijos y reservas (`budgets`) |  |
| Flujo de caja | página | `/dashboard/gastos?tab=flow` | Gastos (`expenses`), Pagar gastos (`expenses_pay`), Presupuestos, gastos fijos y reservas (`budgets`), Nómina (`payroll`), Aprobar nómina (`payroll_approve`), Pagar nómina (`payroll_pay`) | sí |
| Presupuestos | página | `/dashboard/gastos?tab=budgets` | Presupuestos, gastos fijos y reservas (`budgets`), Gastos (`expenses`) |  |
| Nómina | página | `/dashboard/gastos?tab=payroll` | Nómina (`payroll`), Aprobar nómina (`payroll_approve`), Pagar nómina (`payroll_pay`) |  |
| Vales y préstamos | página | `/dashboard/gastos?tab=loans` | Nómina (`payroll`), Aprobar nómina (`payroll_approve`), Pagar nómina (`payroll_pay`) |  |
| Reservas | página | `/dashboard/gastos?tab=reserves` | Presupuestos, gastos fijos y reservas (`budgets`) |  |
| Nómina electrónica | página | `/dashboard/nomina-electronica` | Nómina electrónica (DIAN) (`payroll_electronic`) |  |
| Resumen de rentabilidad | página | `/dashboard/rentabilidad?tab=summary` | Ver rentabilidad (`profit_view`) |  |
| Rentabilidad por punto | página | `/dashboard/rentabilidad?tab=points` | Ver rentabilidad (`profit_view`) |  |
| Ganancia por producto | página | `/dashboard/rentabilidad?tab=products` | Ver rentabilidad (`profit_view`) |  |
| Precios por punto | página | `/dashboard/rentabilidad?tab=rules` | Ver rentabilidad (`profit_view`), Reglas de precio por punto (`profit_rules`), Aprobar reglas de precio (`profit_approve`) |  |
| Límites de precio | página | `/dashboard/rentabilidad?tab=limits` | Ver rentabilidad (`profit_view`), Reglas de precio por punto (`profit_rules`), Autorizar precios 🔓 (`price_approve`) |  |
| Repartos y liquidaciones | página | `/dashboard/rentabilidad?tab=settle` | Beneficiarios y repartos (`profit_beneficiaries`), Preparar liquidaciones (`profit_settle`), Aprobar liquidaciones (`profit_settle_approve`), Pagar liquidaciones (`profit_pay`), Ver rentabilidad (`profit_view`) |  |
| Simulador de precios | página | `/dashboard/rentabilidad?tab=sim` | Ver costos y márgenes 💰 (`costs_view`) |  |
| Informe de ventas | página | `/dashboard` | Informes de ventas (`reports`), POS / Facturar (`pos`), Pedidos de catálogo (`orders`) |  |
| Informe por fechas y horas | página | `/dashboard/rentabilidad?tab=points` | Ver rentabilidad (`profit_view`) |  |
| Comisiones y metas | página | `/dashboard/equipo` | POS / Facturar (`pos`), Nómina (`payroll`), Ver rentabilidad (`profit_view`), Informes de ventas (`reports`) |  |
| Para el contador | página | `/dashboard/contador` | Exportar a Excel/CSV 📤 (`exports`) |  |
| Resumen de inventario | página | `/dashboard/inventario?tab=overview` | Inventario y kardex (`inventory`), Compras (`purchases`), Cuentas por pagar (`payables`) |  |
| Existencias | página | `/dashboard/inventario?tab=stock` | Inventario y kardex (`inventory`) |  |
| Puntos y bodegas | página | `/dashboard/inventario?tab=warehouses` | Inventario y kardex (`inventory`) |  |
| Traslados | página | `/dashboard/inventario?tab=transfers` | Traslados (`transfers`), Inventario y kardex (`inventory`) |  |
| Ajustes de inventario | página | `/dashboard/inventario?tab=adjustments` | Ajustes de inventario (`inventory_adjust`), Inventario y kardex (`inventory`) |  |
| Kardex | página | `/dashboard/inventario?tab=kardex` | Inventario y kardex (`inventory`) |  |
| Productos sin movimiento | página | `/dashboard/inventario?tab=stale` | Inventario y kardex (`inventory`), Informes de ventas (`reports`) |  |
| Vencimientos | página | `/dashboard/inventario?tab=expiry` | Inventario y kardex (`inventory`), Compras (`purchases`), Editar productos (`products`) |  |
| Facturas de compra | página | `/dashboard/inventario?tab=purchases` | Compras (`purchases`) |  |
| Órdenes de compra | página | `/dashboard/inventario?tab=orders` | Compras (`purchases`) |  |
| Proveedores | página | `/dashboard/inventario?tab=suppliers` | Proveedores (`suppliers`), Compras (`purchases`) |  |
| Cuentas por pagar | página | `/dashboard/inventario?tab=payables` | Cuentas por pagar (`payables`) |  |
| Cuenta con puntos | página | `/dashboard/inventario?tab=internal` | Cuenta con la bodega 🤝 (`internal_credit`), Administrar cuenta con puntos (`internal_credit_manage`) |  |
| Manifiestos | página | `/dashboard/inventario?tab=manifests` | Inventario y kardex (`inventory`), Compras (`purchases`) |  |
| Auditoría de inventario | página | `/dashboard/inventario?tab=audit` | Auditoría (`audit`) |  |
| Radar de productos | página | `/dashboard/products/radar` | Editar productos (`products`) |  |
| Productos por publicar | página | `/dashboard/products/radar?ver=publicar` | Editar productos (`products`) |  |
| Lista general de productos | página | `/dashboard/lista-productos` | Ver lista general de productos (`products_view`), Editar productos (`products`), Inventario y kardex (`inventory`), POS / Facturar (`pos`) |  |
| Etiquetas (QR y código de barras) | página | `/dashboard/etiquetas` | Ver lista general de productos (`products_view`), Editar productos (`products`), Inventario y kardex (`inventory`), Pedidos internos (`stock_requests`), Atender pedidos internos (`stock_requests_manage`), Traslados (`transfers`), POS / Facturar (`pos`) |  |
| Productos | página | `/dashboard/products` | Editar productos (`products`) |  |
| Categorías | página | `/dashboard/categories` | Categorías (`categories`) |  |
| Pedidos de clientes | página | `/dashboard/pedidos?tab=clientes` | Pedidos de catálogo (`orders`) |  |
| Pedidos internos | página | `/dashboard/pedidos?tab=internos` | Pedidos internos (`stock_requests`), Atender pedidos internos (`stock_requests_manage`), Traslados (`transfers`) |  |
| Clientes y terceros | página | `/dashboard/clientes?tab=terceros` | Terceros (`clients`), Cartera (`receivables`), Créditos y cupos (`credit`) |  |
| Cartera | página | `/dashboard/clientes?tab=cartera` | Cartera (`receivables`), Créditos y cupos (`credit`) |  |
| Avisos de cobro | página | `/dashboard/clientes?tab=avisos` | Cartera (`receivables`), Créditos y cupos (`credit`) |  |
| Clientes frecuentes | página | `/dashboard/clientes?tab=frecuentes` | Terceros (`clients`) |  |
| Puntos de fidelidad | página | `/dashboard/clientes?tab=puntos` | Terceros (`clients`) |  |
| Apartados | página | `/dashboard/apartados` | Apartados (`pos_layaways`), Cotizaciones (`pos_quotes`), Pedidos de catálogo (`orders`) |  |
| Cotizaciones | página | `/dashboard/apartados?tab=cotizaciones` | POS / Facturar (`pos`), Pedidos de catálogo (`orders`) |  |
| Caja | página | `/dashboard/caja` | Caja de su punto 💵 (`cash`), Revisar cajas (`cash_manage`) |  |
| Garantías y devoluciones | página | `/dashboard/garantias` | POS / Facturar (`pos`), Inventario y kardex (`inventory`), Devolución de venta (`sales_return`) |  |
| Funciones opcionales | página | `/dashboard/vender-mas` | Mi tienda (`store`), Pedidos de catálogo (`orders`), Cambiar precios y % de ganancia 💲 (`products_prices`), Catálogos y campañas (`catalogs`), Editar productos (`products`) |  |
| Carritos abandonados | página | `/dashboard/vender-mas?ver=carritos` | Pedidos de catálogo (`orders`) |  |
| Avísame cuando llegue | página | `/dashboard/vender-mas?ver=avisame` | Pedidos de catálogo (`orders`), Editar productos (`products`) |  |
| Cupones de descuento | página | `/dashboard/vender-mas?ver=cupones` | Cambiar precios y % de ganancia 💲 (`products_prices`), Catálogos y campañas (`catalogs`) |  |
| Promociones y combos | página | `/dashboard/promociones` | Cambiar precios y % de ganancia 💲 (`products_prices`), Reglas de precio por punto (`profit_rules`), Autorizar precios 🔓 (`price_approve`) |  |
| Centro de operaciones | página | `/dashboard/operaciones` | Pedidos de catálogo (`orders`), POS / Facturar (`pos`) |  |
| Factura electrónica | página | `/dashboard/fiscal?tab=resumen` | Ver centro fiscal (`fiscal`), Emitir y reenviar (`fiscal_send`), Notas y anulaciones (`fiscal_notes`), Descargar XML/PDF (`fiscal_download`), Configuración fiscal (`fiscal_config`), Resoluciones y numeración (`fiscal_numbering`), Proveedor tecnológico (`fiscal_provider`), Auditoría fiscal (`fiscal_audit`) |  |
| Documentos electrónicos | página | `/dashboard/fiscal?tab=documentos` | Ver centro fiscal (`fiscal`), Emitir y reenviar (`fiscal_send`), Notas y anulaciones (`fiscal_notes`), Descargar XML/PDF (`fiscal_download`), Configuración fiscal (`fiscal_config`), Resoluciones y numeración (`fiscal_numbering`), Proveedor tecnológico (`fiscal_provider`), Auditoría fiscal (`fiscal_audit`) |  |
| Facturas pendientes de enviar | página | `/dashboard/fiscal?tab=pendientes` | Ver centro fiscal (`fiscal`), Emitir y reenviar (`fiscal_send`), Notas y anulaciones (`fiscal_notes`), Descargar XML/PDF (`fiscal_download`), Configuración fiscal (`fiscal_config`), Resoluciones y numeración (`fiscal_numbering`), Proveedor tecnológico (`fiscal_provider`), Auditoría fiscal (`fiscal_audit`) |  |
| Numeración y resoluciones | página | `/dashboard/fiscal?tab=numeracion` | Resoluciones y numeración (`fiscal_numbering`), Configuración fiscal (`fiscal_config`) |  |
| Catálogos | página | `/dashboard/social?tab=catalogs` | Catálogos y campañas (`catalogs`) |  |
| Campañas | página | `/dashboard/social?tab=campaigns` | Catálogos y campañas (`catalogs`) |  |
| Landing pages | página | `/dashboard/landing` | Landing pages 🚀 (`landing`) |  |
| Mi tienda | página | `/dashboard/store` | Mi tienda (`store`) |  |
| Usuarios y permisos | página | `/dashboard/store/users` | Usuarios y permisos (`users`) |  |
| Puntos | página | `/dashboard/puntos` | Puntos (`points`), Inventario y kardex (`inventory`), Usuarios y permisos (`users`), Auditoría (`audit`) |  |
| Importar y exportar | página | `/dashboard/datos` | Exportar a Excel/CSV 📤 (`exports`), Editar productos (`products`), Terceros (`clients`) |  |
| Copias y seguridad | página | `/dashboard/seguridad` | Copias y seguridad 🛡️ (`security`) |  |
| Mi plan | página | `/dashboard/plan` | Mi tienda (`store`) | sí |
| Auditoría de la tienda | página | `/dashboard/auditoria` | Auditoría (`audit`) |  |
| Mensajes | página | `/dashboard/mensajes` | Mensajes y llamadas 💬 (`messages`) |  |
| Stock y compras | página | `/dashboard/inventario` | Inventario y kardex (`inventory`), Ajustes de inventario (`inventory_adjust`), Conteos físicos 📋 (`inventory_counts`), Traslados (`transfers`), Compras (`purchases`), Anular compras (`purchases_void`), Proveedores (`suppliers`), Cuentas por pagar (`payables`), Auditoría (`audit`), Informes de ventas (`reports`) |  |
| Factura electrónica | página | `/dashboard/fiscal` | Ver centro fiscal (`fiscal`), Emitir y reenviar (`fiscal_send`), Notas y anulaciones (`fiscal_notes`), Descargar XML/PDF (`fiscal_download`), Configuración fiscal (`fiscal_config`), Resoluciones y numeración (`fiscal_numbering`), Proveedor tecnológico (`fiscal_provider`), Auditoría fiscal (`fiscal_audit`) |  |
| Datos de facturación | página | `/dashboard/store/billing` | Datos de facturación (`billing`) | sí |
| Rentabilidad | página | `/dashboard/rentabilidad` | Ver rentabilidad (`profit_view`), Reglas de precio por punto (`profit_rules`), Aprobar reglas de precio (`profit_approve`), Beneficiarios y repartos (`profit_beneficiaries`), Preparar liquidaciones (`profit_settle`), Aprobar liquidaciones (`profit_settle_approve`), Pagar liquidaciones (`profit_pay`), Autorizar precios 🔓 (`price_approve`) |  |
| Gastos y nómina | página | `/dashboard/gastos` | Gastos (`expenses`), Pagar gastos (`expenses_pay`), Presupuestos, gastos fijos y reservas (`budgets`), Nómina (`payroll`), Aprobar nómina (`payroll_approve`), Pagar nómina (`payroll_pay`) |  |
| Gasto llenado por voz | formulario | `/dashboard/gastos?tab=expenses&nuevo=gasto` | Gastos (`expenses`), Pagar gastos (`expenses_pay`) |  |
| Cliente o proveedor llenado por voz | formulario | `/dashboard/clientes?nuevo=tercero` | Terceros (`clients`) |  |
| Producto llenado por voz | formulario | `/dashboard/products/crear` | Crear productos ✨ (`products_create`), Editar productos (`products`) |  |

## Rutas que REM no abre directo

- `/dashboard/pos/document/[id]`: detalle de un documento de venta; se abre desde la venta o el Centro de operaciones.
- `/dashboard/products/[id]`: ficha de un producto; REM la abre desde Productos («abre el primero»).
- `/dashboard/puntos/[id]`: configuración de un punto; se abre desde Puntos.

