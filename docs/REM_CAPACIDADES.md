# REM: catálogo de capacidades

> Generado desde `src/lib/rem` con `npm run rem:catalog`. No lo edites a mano: `tests/rem/catalog-sync.test.ts` falla si quedó viejo.

Versión del catálogo: `39357628` · 109 capacidades · 32 módulos.

Que REM conozca algo no quiere decir que cualquiera lo pueda usar: abre solo lo que la persona puede abrir a mano, y la base vuelve a revisar el permiso en cada consulta o cambio.

## Módulos

| Módulo | Ruta | Para qué sirve | Cómo se hace (pasos verificados) |
|---|---|---|---|
| Inicio e informes | `/dashboard` | Es la primera pantalla: tus pendientes, las ventas de hoy de tus puntos comparadas con ayer, lo más vendido de la semana, las metas del mes y el cierre del día. | — |
| POS / Vender | `/dashboard/pos` | Es donde se vende en el mostrador: buscas los productos, también con la cámara, armas la venta, eliges el cliente y la forma de pago y cobras. La venta descuenta las existencias del punto. | hacer una venta (por voz) |
| Caja | `/dashboard/caja` | Sirve para abrir y cerrar la caja de cada punto, contar el efectivo y ver si hay diferencias. | abrir la caja (3 pasos); cerrar la caja (3 pasos) |
| Apartados y cotizaciones | `/dashboard/apartados` | Para separar productos a un cliente que va abonando, y para hacer cotizaciones. | — |
| Promociones y combos | `/dashboard/promociones` | Para crear descuentos, ofertas y combos de productos. | — |
| Garantías y devoluciones | `/dashboard/garantias` | Para registrar garantías, cambios y devoluciones de lo vendido. | — |
| Factura electrónica | `/dashboard/fiscal` | Para la facturación electrónica ante la DIAN: los documentos enviados, los que están pendientes o rechazados y la numeración con sus resoluciones. | — |
| Datos de facturación | `/dashboard/store/billing` | Son los datos de facturación de la tienda. Solo los ve el dueño o el administrador. | — |
| Productos | `/dashboard/products` | Es la lista de productos de la tienda: los buscas, los filtras, los editas, cambias fotos y precios, los activas o inactivas y los marcas para publicar en redes con Publícame. | crear un producto (5 pasos); subir productos desde Excel (sin pasos) |
| Radar de productos | `/dashboard/products/radar` | Revisa los productos y te dice qué les falta: sin foto, sin precio, quietos o sin ventas. También arma el plan del día para publicar en redes con recordatorio, y desde ahí puedes inactivar los que ya no hay. | — |
| Lista general de productos | `/dashboard/lista-productos` | Es para consultar productos y precios sin poder cambiarlos. | — |
| Categorías | `/dashboard/categories` | Agrupa los productos para ordenar el catálogo y los informes. | crear una categoría (3 pasos) |
| Inventario | `/dashboard/inventario` | Aquí se maneja la mercancía: existencias por punto y bodega, traslados entre puntos, ajustes, conteos, kardex, facturas de compra, proveedores, cuentas por pagar, la cuenta con los puntos y los vencimientos. El costo y las existencias entran con la factura de compra. | ingresar una factura de compra (3 pasos); hacer un traslado (por voz); hacer un conteo (por voz) |
| Pedidos | `/dashboard/pedidos` | Tiene dos partes: los pedidos de clientes que llegan por el catálogo o WhatsApp, y los pedidos internos, cuando un punto le pide mercancía a la bodega. | hacer un pedido interno (por voz) |
| Centro de operaciones | `/dashboard/operaciones` | Reúne los documentos y movimientos de la tienda en un solo lugar: ventas, pedidos, traslados y lo de inventario. | — |
| Terceros y cartera | `/dashboard/clientes` | Aquí están los clientes y los proveedores, la cartera con lo que te deben, los avisos de cobro por WhatsApp, los clientes frecuentes y los puntos de fidelidad. | crear un cliente (4 pasos) |
| Catálogos y campañas | `/dashboard/social` | Para los catálogos en línea que compartes con los clientes, el catálogo en PDF y las campañas para redes. | — |
| Landing pages | `/dashboard/landing` | Páginas de un producto para pauta y anuncios, con inventario aparte por punto y sus ventas y ganancia aparte. | — |
| Mensajes | `/dashboard/mensajes` | Chat y llamadas con el equipo de la tienda. | — |
| Rentabilidad | `/dashboard/rentabilidad` | Muestra la ganancia, que es la venta menos el costo, por punto y por producto. También están los precios por punto, los límites de precio, los repartos y liquidaciones de la ganancia y un simulador de precios. | — |
| Gastos y nómina | `/dashboard/gastos` | Para los gastos de la tienda y de cada punto, los gastos fijos, los presupuestos, la nómina de los empleados, los vales y préstamos y las reservas. | registrar un gasto (4 pasos) |
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
| Proveedores | página | `/dashboard/inventario?tab=suppliers` | Proveedores (`suppliers`), Compras (`purchases`) |  |
| Cuentas por pagar | página | `/dashboard/inventario?tab=payables` | Cuentas por pagar (`payables`) |  |
| Cuenta con puntos | página | `/dashboard/inventario?tab=internal` | Cuenta con la bodega 🤝 (`internal_credit`), Administrar cuenta con puntos (`internal_credit_manage`) |  |
| Manifiestos | página | `/dashboard/inventario?tab=manifests` | Inventario y kardex (`inventory`), Compras (`purchases`) |  |
| Auditoría de inventario | página | `/dashboard/inventario?tab=audit` | Auditoría (`audit`) |  |
| Radar de productos | página | `/dashboard/products/radar` | Editar productos (`products`) |  |
| Productos por publicar | página | `/dashboard/products/radar?ver=publicar` | Editar productos (`products`) |  |
| Lista general de productos | página | `/dashboard/lista-productos` | Ver lista general de productos (`products_view`), Editar productos (`products`), Inventario y kardex (`inventory`), POS / Facturar (`pos`) |  |
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

## Rutas que REM no abre directo

- `/dashboard/pos/document/[id]`: detalle de un documento de venta; se abre desde la venta o el Centro de operaciones.
- `/dashboard/products/[id]`: ficha de un producto; REM la abre desde Productos («abre el primero»).
- `/dashboard/puntos/[id]`: configuración de un punto; se abre desde Puntos.

