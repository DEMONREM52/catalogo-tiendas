# REMHUB · Análisis de permisos

Fecha: 2026-10-15. Alcance: los 49 permisos de `src/lib/permissions.ts` (más el nuevo «Exportar»),
cómo los usa la pantalla (UI) y cómo los hace cumplir la base de datos (RLS y funciones).

## 1. Cómo funciona un permiso

| Capa | Dónde | Qué hace |
|---|---|---|
| Menú y pestañas | `DashboardShell.tsx` (`canOpen`, `MODULE_TABS`), cada `page.tsx` | Muestra u oculta opciones. **No es seguridad**, es comodidad. |
| Botones dentro de la pantalla | `useCan()` / `can.x` en cada módulo | Oculta acciones (aprobar, pagar, exportar…). |
| Base de datos | `erp_can(store,'perm')`, `erp_can_any`, políticas RLS y funciones `SECURITY DEFINER` | **La regla real.** Aunque alguien fuerce la pantalla, la base rechaza. |
| Alcance de punto | `store_users.point_id`, `erp_my_points`, `erp_point_allowed` | Un usuario de punto ve y mueve solo lo de su punto. |

Dueño de la tienda y administrador de plataforma tienen todo. Un usuario «madre» (sin punto) tiene sus
permisos sobre toda la tienda; un usuario de punto, los mismos permisos limitados a su punto.

## 2. Caso SARA (usuario de punto Zamora con compras e inventario)

**Por qué no veía las opciones:** la pantalla de Inventario tenía una lista fija `POINT_HIDDEN`
que **ocultaba a todo usuario de punto** las pestañas Resumen, Compras, Proveedores, Cuentas por pagar
y Auditoría, *sin importar los permisos que tuviera*. Además, la base no dejaba a un usuario de punto
registrar compras ni ver cuentas por pagar.

**Corregido:**

| Pestaña | Antes (usuario de punto) | Ahora |
|---|---|---|
| Compras / ingreso de factura | Oculta siempre | Visible con `purchases`; solo puede ingresar a **sus** bodegas (20261118, la base lo valida línea por línea) |
| Editar un ingreso | «Los usuarios de punto no pueden editar ingresos de factura» | Con `purchases` edita los ingresos de **su** punto; no los de otro punto ni de la madre, ni puede mover productos fuera de su punto (20261121) |
| Proveedores | Oculta siempre | Visible con `suppliers` (los proveedores son de toda la tienda) |
| Cuentas por pagar | Oculta y la base no devolvía filas | Visible con `payables`; solo las facturas que entraron a su punto (20261120) |
| Auditoría de inventario | Oculta siempre | Visible con `audit`; la base ya filtra por su punto |
| Resumen | Oculta | Sigue solo para la madre: muestra totales de toda la tienda |
| Existencias, Kardex, Traslados, Ajustes | Según permiso | Igual (Ajustes se ve con `inventory` en modo consulta; crear exige `inventory_adjust`) |

Para que SARA lo vea: correr **20261118**, **20261120** y **20261121** en Supabase y desplegar la app.
Con la alerta de cambio de permisos, le aparece el aviso para recargar.

## 3. Matriz de permisos

«UI» = cantidad de archivos de pantalla que lo revisan · «BD» = veces que la base lo exige
(migraciones + esquema). Un 0 en UI no es error cuando la base decide (ver notas).

### Ventas
| Permiso | UI | BD | Dónde se ve | Estado |
|---|---|---|---|---|
| `pos` Punto de venta | 10 | 26 | POS, pedidos, facturación | ✅ |
| `sales_void` Anular sin confirmar | 0 | 5 | POS → Documentos (la pantalla pregunta a `erp_sale_void_rights`) | ✅ lo decide la base |
| `sales_return` Devolución | 0 | 6 | POS → Documentos (mismo mecanismo) | ✅ lo decide la base |
| `price_approve` Autorizar precios bajos | 2 | 9 | Aviso en POS, Rentabilidad → Límites | ✅ |
| `orders` Pedidos | 9 | 24 | Pedidos, informes | ✅ |
| `clients` / `clients_delete` | 4 / 1 | 5 / 5 | Clientes | ✅ |
| `credit` Ventas a crédito | 7 | 15 | POS, clientes | ✅ |
| `receivables` Cartera | 3 | 6 | Clientes → Cartera | ✅ |

### Productos e inventario
| Permiso | UI | BD | Dónde se ve | Estado |
|---|---|---|---|---|
| `products_view` Lista general | 1 | 5 | Lista de productos | ✅ |
| `products` Editar productos | 24 | 26 | Productos, precios | ⚠️ ve costos (ver H-02) |
| `categories` | 8 | 7 | Categorías | ✅ |
| `inventory` Ver inventario | 10 | 41 | Inventario | ⚠️ ve costo y valor (H-02) |
| `inventory_adjust` Ajustes | 2 | 13 | Inventario → Ajustes | ✅ |
| `inventory_alerts` Alertas | 1 | 4 | Aviso flotante | ✅ |
| `transfers` Traslados | 6 | 18 | Inventario, pedidos internos | ✅ |
| `stock_requests` / `_manage` | 4 / 3 | 7 / 6 | Pedidos internos | ✅ |
| `notifications_config` Sonidos | 0 | 4 | Configuración de tonos (lo valida la base) | ✅ |
| `purchases` Compras | 6 | 21 | Inventario → Compras | ✅ corregido (punto) |
| `suppliers` Proveedores | 2 | 9 | Inventario → Proveedores | ✅ corregido (punto) |
| `payables` Cuentas por pagar | 3 | 12 | Inventario → Cuentas por pagar | ✅ corregido (punto) |

### Administración
| Permiso | UI | BD | Dónde se ve | Estado |
|---|---|---|---|---|
| `audit` Auditoría | 5 | 21 | Auditoría **y también informes de ventas** | ⚠️ doble uso (H-01) |
| `exports` Exportar 📤 | 1 | 3 | Botones Excel/CSV en 7 pantallas | 🆕 |
| `store` Configuración | 17 | 9 | Ajustes de la tienda | ✅ |
| `billing` Plan y pagos | 4 | 7 | Suscripción | ✅ |
| `users` Usuarios | 10 | 31 | Equipo | ✅ |
| `points` Puntos | 7 | 30 | Puntos de venta | ✅ |

### Rentabilidad, gastos y nómina
| Permiso | UI | BD | Estado |
|---|---|---|---|
| `profit_view`, `profit_rules`, `profit_approve`, `profit_beneficiaries`, `profit_settle`, `profit_settle_approve`, `profit_pay` | 2 c/u | 3–13 | ✅ |
| `expenses`, `expenses_pay`, `budgets` | 1–2 | 3–4 | ✅ (`expenses_pay` llega como `can.pay` al módulo) |
| `payroll`, `payroll_approve`, `payroll_pay` | 1–2 | 3–4 | ✅ |

### Facturación electrónica
| Permiso | UI | BD | Estado |
|---|---|---|---|
| `fiscal`, `fiscal_send`, `fiscal_notes`, `fiscal_download`, `fiscal_config`, `fiscal_numbering`, `fiscal_provider`, `fiscal_audit` | 3–10 | 9–29 | ✅ |

## 4. Hallazgos

| Id | Severidad | Hallazgo | Estado |
|---|---|---|---|
| H-00 | Alta | Inventario ocultaba Compras/Proveedores/Cuentas por pagar/Auditoría a todo usuario de punto aunque tuviera permiso | ✅ Corregido (UI + 20261118 + 20261120) |
| H-01 | Media | `audit` abre la auditoría **y** el informe de ventas (`erp_report`): no se puede dar uno sin el otro | ✅ Permiso `reports` (20261123) |
| H-02 | Media | Quien tiene `inventory` o `products` recibe el **costo** en existencias (`erp_stock_page`/`erp_stock_browse`) y en la ficha de producto | ✅ Permiso `costs_view`: la base oculta costo, valor, ganancia, % y compras (20261123) |
| H-06 | Media | Kardex sin alcance de punto; resumen general visible a puntos; pagar a proveedor sin revisar el punto | ✅ Cerrado (20261123) |
| H-07 | Media | Con «Inventario» se podían crear o cambiar bodegas y puntos (incluso de otro punto) | ✅ Crear/borrar solo la madre; editar la madre o el propio punto (20261123) |
| H-08 | Baja | Traslados y ajustes de todos los puntos visibles para cada punto | ✅ Cada punto ve los suyos (20261123) |
| H-09 | Media | Quien creaba productos también cambiaba precios; quien ingresaba compras también las anulaba | ✅ Permisos `products_prices` y `purchases_void` (20261123) |
| H-03 | Media | Cualquiera con acceso a un listado podía descargarlo en Excel/CSV sin control ni registro | ✅ Permiso `exports` + cada descarga queda en la auditoría |
| H-04 | Baja | La pestaña Ajustes se ve con `inventory` aunque no pueda crear ajustes | ✅ Aceptado: modo consulta |
| H-05 | Baja | Resumen de inventario no se muestra a usuarios de punto | ✅ Intencional: son totales de toda la tienda |

## 5. Permisos nuevos

| Permiso | Para qué | Estado | Quién lo recibe al migrar |
|---|---|---|---|
| `exports` Exportar a Excel/CSV | Descargar listados; queda registrado `export.<listado>` | ✅ Hecho (20261120) | Usuarios activos que ya podían descargar algo (auditoría, cartera, cuentas por pagar, gastos, nómina, rentabilidad, inventario) |
| `reports` Informes de ventas 📊 | Separar informes de la auditoría | ✅ 20261123 | Quien hoy tiene `audit` |
| `costs_view` Ver costos y márgenes 💰 | Costo, valor de inventario, ganancia y % de ganancia | ✅ 20261123 | Quien hoy tiene `products`, `inventory`, `inventory_adjust`, `purchases`, `profit_view` o `profit_approve` |
| `products_prices` Cambiar precios 💲 | Crear productos sin tocar precios | ✅ 20261123 (al crear sin él se usa el % de la tienda) | Quien hoy tiene `products` |
| `purchases_void` Anular compras | Separar anular de ingresar | ✅ 20261123 | Quien hoy tiene `purchases` |

Regla para no romper nada: cada permiso nuevo se entrega primero a quien ya hacía esa acción, y
después el dueño lo quita a quien no deba tenerlo.

Los permisos nuevos se entregan una sola vez (tabla `erp_migration_marks`): volver a correr la migración
no le devuelve un permiso a quien el dueño se lo quitó.

## 6. Pruebas

- `tests/sql/compras_punto.test.mjs` · 12/12: SARA ingresa a su punto, no a otro punto ni a la bodega.
- `tests/sql/editar_ingreso_punto.test.mjs` · 16/16: SARA edita su ingreso (inventario y cuenta por pagar ajustan la diferencia); no edita los de otro punto o de la madre; nada se mueve si se rechaza.
- `tests/sql/permisos_costos.test.mjs` · 42/42: sobre las funciones reales de producción (con saltos de línea de Windows).
- `tests/sql/permisos.test.mjs` · 7/7: `exports` se conserva, no se duplica y un vendedor de POS no lo recibe; las cuentas por pagar se filtran por punto.
