# REMHUB · Arquitectura multipunto y de facturación electrónica

Este documento describe cómo funciona el módulo fiscal y la administración multipunto de RemHub: qué tablas usa, cómo se aplican los permisos, cómo se emite un documento electrónico y dónde se conectan los proveedores tecnológicos.

> **Regla principal.** Ninguna persona puede emitir un documento con la identidad fiscal de otra. María no factura como Javier, el Punto A no usa la resolución ni el NIT del Punto B y nadie consume consecutivos ajenos. Esto se valida en la base de datos (RLS, funciones y triggers), en el servidor y en la interfaz.

> **Reglas tributarias.** El sistema no toma decisiones fiscales. Todo lo marcado **REQUIERE VALIDACIÓN CONTABLE** (en el código, en la base y en la interfaz) es configurable y lo confirman la contadora o el proveedor tecnológico.

## 1. Diagnóstico del sistema anterior

| Tema | Cómo estaba | Qué se hizo |
|---|---|---|
| Organización | `stores` (dueño `owner_id`) | Se reutiliza como **tienda madre**. No se creó una tabla `organizations` duplicada. |
| Puntos | `erp_warehouses` con `kind = 'point' \| 'warehouse'`, prefijos y consecutivos internos | Se reutiliza como **punto**. Se agregaron estado (`draft/active/suspended/inactive`), responsable y descripción. |
| Super admin | `user_profiles.role = 'admin'`; `erp_can` ya lo trataba como acceso total | Se agregaron `erp_is_platform_admin()` y un panel en `/admin/fiscal`. |
| Usuarios | `store_users` con permisos planos y un solo `point_id` | Se agregó `point_ids` (puntos adicionales de consulta), roles personalizados y permisos fiscales. |
| Facturas POS | `erp_tag_order` numeraba «factura» con el consecutivo interno del punto, sin validar resolución | En puntos con facturación electrónica activa, la factura solo la emite el motor fiscal (un número por venta). |
| Siigo | `/api/siigo/invoice` recibía el contenido de la factura desde el navegador; credenciales en texto plano en `billing_settings` (0 filas) | Se conserva sin cambios. Lo nuevo usa adaptadores y credenciales cifradas. Pendiente: migrar Siigo al adaptador. |
| Auditoría | `erp_audit_logs` solo con acción y detalle | Se extendió con antes/después, motivo, IP, navegador, categoría y severidad, y ahora es inmutable. |
| **Exposición pública** | Con la llave pública se podían leer las **632 ventas y 2056 líneas** de todas las tiendas (nombres y WhatsApp de clientes) y el **costo** de los productos | Cerrado: política restrictiva que deniega a `anon`, membresía obligatoria para usuarios autenticados y columnas públicas limitadas en `products`. |
| Aislamiento por punto | Inventario, traslados y POS ya aislados; ventas (`orders`), kardex y auditoría visibles para todos los puntos | Se agregaron políticas `RESTRICTIVE` por punto, que no cambian lo que ven el dueño y los administradores. |
| `.env.example` | Tenía la llave `service_role` real | Se reemplazó por un marcador. **Rota la llave** si alguna vez se compartió ese archivo. |

Datos reales encontrados: 4 tiendas. LA VITRINA tiene SEDE ZAMORA y SEDE MANHATTAN; ambas usan el NIT genérico `222222222222-1`, que no se migra como identidad fiscal porque parece un marcador. Hay un usuario de punto (vendedorm, en Manhattan). Ninguna tienda tenía datos fiscales previos, así que la migración no crea contribuyentes inventados: el asistente y el centro fiscal toman los datos anteriores del punto como sugerencia.

## 2. Jerarquía y alcance

```
SUPER ADMIN (user_profiles.role='admin')          → alcance global
└── TIENDA MADRE (stores, dueño/store_admin)      → alcance organización
    ├── PUNTO A (erp_warehouses)                  → usuario con point_id = A
    ├── PUNTO B                                   → usuario con point_id = B y point_ids = [C]  (alcance «varios puntos»)
    └── PUNTO C
```

- `erp_my_points(store)` devuelve `NULL` cuando el usuario no tiene restricción (dueño, administrador de plataforma, `store_admin` o un usuario sin punto). Si tiene punto, devuelve su punto principal más los adicionales.
- `erp_point_allowed(store, point)` combina ese alcance con cada recurso.
- Un usuario de punto **opera** solo en su punto principal (POS, inventario y traslados ya usaban `erp_point_guard`). Los puntos adicionales son de **consulta**: documentos, informes y auditoría según sus permisos.
- `erp_my_scope(store)` le dice a la interfaz qué alcance tiene el usuario. La base valida siempre, sin confiar en lo que diga la interfaz.

Controles del servidor (`src/lib/fiscal/server.ts`): `requireUser`, `requireSuperAdmin`, `requireOrganizationAccess`, `requirePointAccess`, `requirePermission` y `requireFiscalPermission`. Cuando una de estas comprobaciones se niega, queda un evento de seguridad.

## 3. Permisos y roles

Se mantiene el estilo de permisos planos validados en la base con `erp_can` / `erp_can_any`. Las claves nuevas equivalen a las de la especificación:

| Clave RemHub | Equivale a |
|---|---|
| `fiscal` | fiscal.view, fiscal_documents.view, fiscal_numbering.view, provider.view |
| `fiscal_send` | fiscal_documents.send, fiscal_documents.retry |
| `fiscal_notes` | fiscal_documents.cancel (notas crédito/débito y anulación sin transmitir) |
| `fiscal_download` | fiscal_documents.download_xml/pdf, reports.export (fiscal) |
| `fiscal_config` | fiscal.configure (contribuyentes, NIT, establecimientos y reglas) |
| `fiscal_numbering` | fiscal_numbering.manage |
| `fiscal_provider` | provider.configure / test / reconnect |
| `fiscal_audit` | audit.view (fiscal y seguridad) |
| `points` | points.view / create / edit / disable |
| (existentes) `pos`, `orders`, `clients`, `inventory`, `transfers`, `purchases`, `credit`, `users`, `audit`… | sales.*, pos.*, customers.*, inventory.*, purchases.*, credits.*, users.*, reports.* |

Los roles predeterminados son plantillas en `src/lib/permissions.ts`: Vendedor, Cajero, Cartera, Bodega, Contabilidad, Auditor, Administrador de punto y Supervisor. El dueño (MASTER_ADMIN) y `store_admin` (STORE_ADMIN) tienen todo, y SUPER_ADMIN es el administrador de plataforma. Los **roles personalizados** de cada tienda se guardan en `erp_role_templates` y nadie puede crear un rol con permisos que no tiene. Un administrador de punto solo gestiona usuarios de su propio punto (`/api/store-team/users`).

La lista de permisos debe ser igual en `src/lib/store-user-auth.ts` (`STORE_MENU_PERMISSIONS`) y en SQL (`erp__known_permissions()`).

## 4. Modelo de datos fiscal

| Tabla | Para qué |
|---|---|
| `erp_org_settings` | Configuración de la tienda madre: interruptor fiscal general, clientes compartidos, regla de remisiones (`allow/warn/block` + días) y datos del consumidor final. |
| `fiscal_providers` | Catálogo de adaptadores: sandbox (disponible); Alegra, Siigo, The Factory HKA y Carvajal (pendientes). |
| `fiscal_entities` | Contribuyente: NIT/cédula + DV calculado y validado, razón social, régimen, responsabilidades del RUT, CIIU, dirección, correos y estado. Su NIT no cambia después de facturar. |
| `fiscal_establishments` | Establecimiento (sede registrada) de un contribuyente y su punto. |
| `fiscal_point_configs` | Configuración fiscal del punto: contribuyente, establecimiento, cuenta del proveedor, ambiente, activación y tipo de documento del POS. Producción exige confirmación explícita. |
| `fiscal_provider_accounts` | Cuenta del proveedor por contribuyente **y por ambiente**, con estado, última prueba, estado del webhook, token de la URL del webhook y pistas de credenciales (`••••1234`). |
| `fiscal_secrets` | Credenciales cifradas (AES-256-GCM). Tiene RLS sin políticas, así que **solo el servidor** las lee. |
| `fiscal_numbering_ranges` | Resolución o rango: contribuyente, tipo de documento, ambiente, prefijo, desde/hasta, siguiente número, vigencia, **puntos autorizados**, alertas y pista de la clave técnica. |
| `fiscal_number_allocations` | Cada número entregado, una sola vez (dos restricciones únicas). |
| `fiscal_documents` | Documento fiscal con foto del emisor y del cliente, totales, estados interno/proveedor/DIAN, CUFE, XML/PDF, intentos, idempotencia, origen (venta/remisión) y relación con notas. |
| `fiscal_document_lines` | Líneas del documento (inmutables). |
| `fiscal_document_events` | Línea de tiempo: quién, qué, estado anterior y nuevo, respuesta, IP y navegador. Solo se agregan eventos. |
| `fiscal_webhook_events` | Webhooks recibidos (idempotentes), con firma válida o no y estado (procesado, fallido, sin éxito, rechazado). |
| `fiscal_contingencies` | Contingencias abiertas y cerradas. |
| `fiscal_certificates` | Certificados (metadatos y vencimiento). |
| `erp_audit_logs` (extendida) | Auditoría única: categorías `ops/fiscal/security/auth/users/config/export`, severidad, antes/después, motivo, IP, navegador y id de solicitud. |

No se reutilizó `billing_documents` como documento fiscal porque mezcla documentos operativos e internos. `fiscal_documents` se relaciona con la venta mediante `source_id`, que es el id del pedido.

## 5. Seguridad (RLS)

- Todas las tablas fiscales tienen RLS. **Ningún usuario escribe directamente**: se revocaron `insert/update/delete` para `anon` y `authenticated`. Todo pasa por funciones `SECURITY DEFINER` que validan usuario, tienda, punto, permiso y recurso.
- Lectura: hace falta un permiso fiscal y el alcance del punto. El cajero del POS ve los documentos de su punto.
- Inmutabilidad: los triggers impiden borrar documentos fiscales, líneas, eventos y números entregados, incluso con acceso total a la base. La única excepción es `set remhub.audit_maintenance = on`, que solo puede usar el dueño de la base de datos. Un documento transmitido no se modifica: se corrige con notas.
- Políticas `RESTRICTIVE` por punto: `orders`, `order_items`, `erp_order_meta`, `inventory_movements`, `billing_customers` y `erp_receivables` (estas dos según «clientes compartidos») y `erp_audit_logs`.
- Endurecimiento público: `anon` no lee `orders` ni `order_items`. En `products` solo lee las columnas del catálogo, sin costos ni listas internas.
- Funciones solo para el servidor (`fiscal__claim`, `fiscal__record_result`, `fiscal__webhook_*`, `fiscal__provider_*`…): `revoke` a `public/anon/authenticated` y `grant` explícito a `service_role`.
- Las funciones devuelven `{ok:false, code, message}` cuando fallan por causas esperadas, en lugar de lanzar un error. Así los **eventos de seguridad** (intentos sobre otro punto, NIT ajeno, numeración ajena, descargas o exportaciones sin permiso, webhooks mal firmados) quedan guardados y alimentan las alertas del super admin.
- `admin_security_posture()` lista las tablas públicas sin RLS y las funciones privilegiadas sin `search_path` fijo.

## 6. Flujo de emisión (POS)

```
POS (navegador)                       Servidor (/api/fiscal/pos/invoice)            Base de datos
create_order_from_cart ──────────────────────────────────────────────────────────▶ orders + order_items
POST {token, punto, vendedor, cliente, idempotency_key}
                                      requireUser + requireOrganizationAccess
                                      rpc fiscal_issue_from_order (como usuario) ─▶ valida permiso y alcance del punto
                                                                                    readiness completo (si falta algo: NOT_READY + lista)
                                                                                    cliente (tercero o consumidor final)
                                                                                    líneas desde order_items (no desde el navegador)
                                                                                    totales cuadran con lo cobrado
                                                                                    fiscal__allocate_number (FOR UPDATE)
                                                                                    fiscal_documents + líneas + eventos + auditoría
                                                                                    erp_order_meta.doc_number = número fiscal
                                      fiscal_can_send (como usuario)
                                      sendDocument (llave de servicio):
                                        fiscal__claim ─────────────────────────────▶ PROCESSING (bloquea doble envío)
                                        descifra credenciales; adaptador.submit()
                                        guarda XML/PDF en el bucket privado fiscal-docs
                                        fiscal__record_result ─────────────────────▶ ACCEPTED / REJECTED / SENT / ERROR + reintento
◀──────────── número, estado, mensaje claro
```

El navegador nunca decide el NIT, el prefijo, la resolución, el consecutivo, el proveedor ni las credenciales.

**Estados:** `DRAFT → QUEUED → PROCESSING → SENT → ACCEPTED`, con las ramas `REJECTED`, `ERROR` (reintento automático), `CONTINGENCY`, `CANCEL_PENDING`, `CANCELLED` (anulado por una nota crédito que cubre todo el valor) y `VOID` (anulado sin transmitir). Las transiciones permitidas están en `fiscal__transition_ok`. La interfaz muestra el estado de RemHub, el del proveedor y el de la DIAN.

## 7. Numeración y concurrencia

- Un rango pertenece a un **contribuyente**, un tipo de documento y un ambiente, y se autoriza **explícitamente** para uno o varios puntos (`point_ids`). No se asume que cada punto tenga su propia resolución; compartir un rango requiere validación contable.
- `fiscal__pick_range` elige un rango activo, vigente (en hora de Colombia), con números disponibles y autorizado para el punto. Si hay varios, toma el más antiguo y pasa al siguiente cuando ese se agota.
- `fiscal__allocate_number` bloquea la fila del rango (`SELECT … FOR UPDATE`). Si dos cajeros facturan a la vez, el segundo espera y recibe el número siguiente. Además, `fiscal_number_allocations` tiene `unique(range_id, number)` y `unique(entidad, ambiente, tipo, prefijo, número)`, y `fiscal_documents` también tiene un índice único por número.
- Nunca se entrega un número fuera del rango, de un rango vencido o inactivo, de otro punto, de otro contribuyente o de otro ambiente. Los rangos que se cruzan con el mismo prefijo se rechazan, y lo ya entregado no se puede retroceder.
- **No se consume consecutivo si la validación falla.** Primero se valida todo y solo después se asigna el número. Un documento numerado que falla al transmitirse se reintenta con el **mismo número**. Si nunca se transmitió y se anula, el número queda como `voided_unsent` y aparece en el expediente (REQUIERE VALIDACIÓN CONTABLE).
- Hay alertas por porcentaje usado y por días antes del vencimiento.

## 8. Idempotencia

- Cada intento de factura del POS lleva una `idempotency_key`, con un índice único por tienda. Además hay **una sola factura vigente por venta** (índice único parcial sobre `source_id`).
- Ante un doble clic, una carrera o un reintento se devuelve el documento existente (`reused: true`).
- `fiscal__claim` impide enviar dos veces a la vez y responde «El documento ya fue enviado y está siendo procesado». Si una respuesta del proveedor llega dos veces, se registra como confirmación y no duplica la auditoría.
- Se guardan `idempotency_key`, `provider_request_id`, `provider_document_id`, el id de RemHub y el CUFE/CUDE.

## 9. Adaptadores de proveedor

`src/lib/fiscal/provider.ts` define la interfaz `ElectronicInvoicingProvider`, con los métodos `healthCheck`, `createCompany`, `configureCompany`, `getNumbering`, `createInvoice`, `sendInvoice`, `getInvoiceStatus`, `createCreditNote`, `createDebitNote`, `cancelDocument`, `downloadXml`, `downloadPdf`, `verifyWebhook` y `processWebhook`.

- `providers/index.ts` es el **único** lugar que relaciona el código de un proveedor con su implementación.
- `providers/sandbox.ts` es el **simulador RemHub**: acepta, rechaza, simula fallas de red o responde después. Genera un XML marcado como simulación y un «CUFE» que empieza por `SIM-`. Nunca funciona en producción.
- `providers/alegra.ts` está **preparado y no inventa nada**: los endpoints, campos, autenticación y firma de webhooks son `TODO`. Para activarlo: (1) confirmar con Alegra la documentación oficial vigente y el contrato; (2) completar los TODO y `PROVIDER_CREDENTIAL_FIELDS.alegra` en `provider-fields.ts`; (3) probar en el ambiente de pruebas; (4) `update fiscal_providers set status='available' where code='alegra'`.
- Para agregar otro proveedor: crea `providers/<codigo>.ts` extendiendo `BaseInvoicingProvider`, regístralo en `providers/index.ts` y en `provider-fields.ts`, y agrega su fila a `fiscal_providers`.
- Dónde va cada dato: las credenciales en Centro fiscal → Proveedor (se cifran en el servidor); el identificador de la empresa en el proveedor en `external_account_id`; las opciones no secretas en `settings` (la base rechaza claves que parezcan secretos); el ambiente en la cuenta y en el punto (deben coincidir); y la URL del webhook es `/api/fiscal/webhooks/<proveedor>/<token>`.

## 10. Credenciales y secretos

- Las credenciales se cifran con AES-256-GCM (`src/lib/fiscal/crypto.ts`) usando `FISCAL_SECRETS_KEY`, una llave de 32 bytes en base64 que solo existe en el servidor. El dato cifrado se ata a su dueño mediante AAD (`tipo:id:nombre`), así que no sirve si se copia a otra cuenta.
- Para rotar la llave: pon la nueva en `FISCAL_SECRETS_KEY`, la anterior en `FISCAL_SECRETS_KEY_PREVIOUS` y vuelve a guardar las credenciales.
- Nada secreto usa `NEXT_PUBLIC_`. La interfaz solo muestra pistas (`••••1234`). Las respuestas del proveedor se guardan con `sanitizePayload`, que oculta tokens, contraseñas y llaves.
- La clave técnica de cada resolución se guarda cifrada como secreto de la numeración.
- Alternativa evaluada: Supabase Vault. Se prefirió el cifrado en el servidor porque no depende de una extensión, se puede probar localmente y las credenciales nunca pasan por SQL en claro.

## 11. Webhooks

`POST /api/fiscal/webhooks/[provider]/[token]` funciona así:

1. Rechaza cuerpos de más de 512 KB y tokens con formato inválido.
2. Busca la cuenta por token aleatorio (si no existe: 404 y evento de seguridad).
3. Valida la firma con el secreto de **esa** cuenta, el tiempo (5 minutos de tolerancia) y el formato del mensaje, mediante `verifyWebhook` del adaptador.
4. Guarda el evento con `fiscal__webhook_store`. Es idempotente por id del evento o por hash del cuerpo. Un evento rechazado no guarda su contenido y nunca bloquea uno legítimo idéntico.
5. Si la firma es inválida responde 401, registra un evento de seguridad crítico y marca el webhook como «con fallas» tras 3 fallas.
6. Procesa el evento con `fiscal__webhook_apply`. El documento se busca **solo dentro de la cuenta** que recibió el webhook y se respetan las transiciones de estado.
7. Si falla, reintenta con espera creciente (1 m, 5 m, 30 m, 2 h, 12 h) y después de 6 intentos lo marca como `dead`. Desde el panel se puede reintentar manualmente (`/api/fiscal/webhooks/retry`).

Esquema de firma del simulador: cabecera `x-remhub-signature: t=<unix>,v1=<hmac_sha256_hex(secreto, "t.cuerpo")>`. Cada proveedor real define el suyo en su adaptador.

## 12. Cola y reintentos

`/api/fiscal/jobs` funciona de dos formas:

- `GET` con `Authorization: Bearer CRON_SECRET` procesa la cola de todas las tiendas: documentos `QUEUED`, `ERROR` o `SENT` con reintento pendiente, envíos que quedaron a medias y webhooks fallidos.
- `POST` con la sesión del usuario y el permiso `fiscal_send` procesa solo su tienda (botón «Procesar pendientes»).

El POS envía de inmediato, y la cola es el respaldo. Para programarla puedes usar Vercel Cron, Supabase `pg_cron` + `pg_net` o un programador externo.

## 13. Contingencia

`fiscal_contingency_start/end` abre y cierra contingencias por punto o para toda la tienda. Mientras una está abierta, los documentos quedan en `CONTINGENCY` y `fiscal__claim` no los transmite. Al cerrarla vuelven a la cola. Las reglas oficiales de contingencia (documentos de contingencia, plazos, numeración especial) REQUIEREN VALIDACIÓN; la arquitectura ya tiene el tipo `contingency_invoice` y el vínculo `contingency_id`.

## 14. Documentos operativos y documentos fiscales

- Pedidos, remisiones, despachos, traslados y pedidos internos viven en el **Centro de operaciones** (`/dashboard/operaciones`). Los documentos electrónicos viven en el **Centro fiscal** (`/dashboard/fiscal`). La «Vista fiscal» solo filtra por la naturaleza del documento: no oculta ni borra nada.
- Relación pedido → remisión → factura: la factura guarda `source_id` (la venta) y `source_number` (el número de la remisión).
- Control anti-evasión configurable (`remission_policy`):
  - `warn`: alerta cuando una remisión de venta de un punto habilitado supera el plazo sin factura.
  - `block`: no permite crear remisiones de venta en esos puntos.
  - En los puntos habilitados, una «factura» interna (con otra numeración) está **bloqueada**: la factura siempre es electrónica.
  - Las ventas pendientes aparecen en Centro fiscal → «Por facturar».
- Qué operaciones deben facturarse y en qué plazo REQUIERE VALIDACIÓN CONTABLE.

## 15. Auditoría

- Se registran: inicio y cierre de sesión; usuarios, permisos y alcance; creación, cambios y estado de puntos; contribuyentes (NIT, DV, razón social, responsabilidades), establecimientos, resoluciones, prefijos y rangos; proveedor, ambiente y credenciales (solo pistas); certificados; configuración de la tienda; terceros; cambios de precio y costo; proveedores (suppliers); documentos fiscales (creación, número, envío, respuesta, rechazo, reintento, nota y anulación); descargas de XML/PDF; exportaciones; y eventos de seguridad. Los módulos anteriores (inventario, traslados, compras y POS) siguen usando `erp_audit`, que ahora también guarda IP y navegador.
- Cada registro guarda usuario, tienda, punto, acción, entidad e id, antes, después, motivo, IP, navegador, fecha e id de solicitud. Cuando el servidor actúa con la llave de servicio, envía `x-remhub-actor` y el registro queda a nombre del usuario real. Esa cabecera solo se acepta con el rol `service_role`.
- La auditoría no se modifica ni se borra (trigger `erp__audit_immutable`).
- Auditoría fiscal de un documento: el detalle responde quién lo creó, desde qué punto, para qué contribuyente y NIT, con qué resolución, prefijo y consecutivo, con qué proveedor, en qué fecha, qué respondieron el proveedor y la DIAN, si fue aceptado o rechazado y por qué, y si se reintentó y quién lo hizo.
- Expediente fiscal del punto (`fiscal_dossier`): resumen por tipo y estado, numeración (primero y último número usado y anulados sin transmitir), y documentos con líneas y eventos. Se exporta en JSON, CSV o impreso/PDF, y la exportación queda auditada.

## 16. Rendimiento

- Las búsquedas usan paginación por cursor (`issue_date, id`), filtros en el servidor y espera al escribir en la interfaz.
- Hay índices por tienda, punto, contribuyente, tipo, estado, fecha, prefijo/número, CUFE, documento del proveedor, usuario y reintento. La auditoría tiene índices por tienda/categoría/fecha, punto, entidad y usuario, más uno parcial para seguridad.
- Los paneles se cargan con una sola función (`fiscal_overview`, `erp_point_dossier`, `admin_fiscal_overview`), sin consultas N+1 desde el navegador.

## 17. Pruebas

| Comando | Qué cubre |
|---|---|
| `npm run test:sql` | 148 verificaciones sobre PostgreSQL real en memoria (PGlite) con la migración aplicada dos veces: los 16 escenarios pedidos (Robin y María facturan; María no factura como Javier; Javier no ve lo de María; la tienda madre ve sus puntos; el super admin ve todo; consecutivos sin duplicados ni saltos; rechazo y corrección; nada aceptado se borra; sin permiso no se cambia resolución, NIT ni se descarga XML; webhooks duplicados y mal firmados; numeración ajena; tienda A vs B), además de notas, contingencias, asistente atómico, cola, alertas, clientes compartidos, auditoría inmutable y la fuga pública. |
| `npm test` | 21 pruebas del código TypeScript: cifrado (ida y vuelta, AAD, alteración, sin llave), firmas de webhook (válida, inválida, alterada, vencida) y simulador/adaptadores (aceptar, rechazar, nunca producción, reintento, pendiente, Alegra sin inventar, saneo de secretos). |

**Concurrencia.** PGlite usa una sola conexión, así que la garantía se apoya en el bloqueo `FOR UPDATE` y en las restricciones únicas, ambas probadas. Antes de producción conviene repetir la prueba en un proyecto de *staging* de Supabase con dos sesiones facturando a la vez.

## 18. Archivos principales

- SQL: `supabase/migrations/20261027_fiscal_multipunto.sql`.
- Librería: `src/lib/fiscal/` (`types`, `crypto`, `webhook-signature`, `provider`, `provider-fields`, `providers/*`, `server`, `engine`, `client`) y `src/lib/audit-client.ts`.
- API: `src/app/api/fiscal/*` y `src/app/api/store-team/users` (alcance por punto y puntos adicionales).
- Interfaz: `src/app/dashboard/fiscal/*`, `src/app/dashboard/puntos/*`, `src/app/dashboard/operaciones`, `src/app/admin/fiscal`, POS, comprobante, usuarios, menú y campana.
- Pruebas: `tests/sql/*` y `tests/fiscal/*`.
