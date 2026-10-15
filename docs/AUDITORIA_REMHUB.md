# Auditoría global de RemHub — diagnóstico, diseño y estado

Fecha: 15/10/2026 · Migración: `supabase/migrations/20261117_auditoria_global.sql` · Pruebas: `tests/sql/auditoria.test.mjs`

Estados usados: **✅ Implementado y probado** · **🧪 Implementado, pendiente de prueba real** · **🟡 Parcial** · **⏳ Pendiente** · **⚙️ Pendiente de configuración externa** · **⚖️ Pendiente de revisión legal**.

---

## Etapa A · Diagnóstico

### Tecnología real
- Next.js 16.1.3 (App Router), React 19.2, TypeScript, Tailwind v4, framer-motion, lucide-react, SweetAlert2.
- Supabase (Postgres + Auth + Storage + Realtime). La lógica sensible está en funciones `SECURITY DEFINER` con RLS.
- Pruebas: `npm test` (node:test) y `npm run test:sql` (PGlite: Postgres real en memoria).

### Lo que ya existía (y se reutilizó)
- La tabla `erp_audit_logs` (migración fiscal 20261027) ya tenía:
  - Categorías, severidad, `before`/`after`, motivo, IP, navegador y `request_id`.
  - Un disparador que impide modificar o borrar.
  - RLS de lectura según el permiso `audit`/`fiscal_audit` y el punto asignado.
- `erp__audit_insert` atribuye cada evento al usuario, o a la integración cuando el servidor usa la llave de servicio (`erp__service_actor`).
- Ya se auditaban, con antes/después:
  - Puntos/bodegas, proveedores, usuarios (permisos), terceros (crédito) y cambios de precio/costo.
  - Eventos fiscales y de seguridad, y el inicio y cierre de sesión.
- `erp_sale_finance` guarda una foto financiera de cada venta: costo, precio y regla de punto usados. Es la base de la fase 5.
- Las devoluciones y anulaciones quedan en `erp_sale_voids`. La inmutabilidad de los documentos fiscales ya está en el módulo fiscal.

### Inventario de módulos (pantallas reales)
- **Tienda:** inicio; productos (crear y editar); lista general; categorías; inventario (stock, puntos, traslados, compras, ajustes, kardex); POS; pedidos (catálogo e internos); centro de operaciones; terceros y cartera; facturación electrónica; puntos (expediente); rentabilidad (precios por punto, límites, repartos, simulador); gastos y nómina; catálogos y campañas; mi tienda; usuarios; datos de facturación.
- **Público:** catálogos `/[slug]/[mode]`, producto, comprobante `/pedido/[token]`, traslado `/traslado/[token]`, comprobante de ingreso.
- **Admin global:** resumen, tiendas, usuarios, productos, pedidos, categorías, temas, fiscal y seguridad.

### Matriz de cobertura de auditoría

| Área | Qué queda registrado | Estado |
|---|---|---|
| Usuarios y permisos | Crear, cambiar rol, permisos o punto, desactivar (advertencia en cambios sensibles) | ✅ (existente + probado) |
| Roles (plantillas) | Crear/editar/borrar plantillas de permisos | ✅ nuevo |
| Puntos y bodegas | Datos, prefijos, resolución, estado | ✅ existente |
| Productos: precios y costo | Antes/después de precios 1-5, detal, mayor, costo, IVA | ✅ existente |
| Productos: datos | Nombre, código, activo, categoría, % de ganancia, mínimo mayor | ✅ nuevo |
| Categorías, catálogos, precio por catálogo | Altas, cambios y bajas | ✅ nuevo |
| Reglas de precio por punto, límites de precio, configuración de rentabilidad | Antes/después | ✅ nuevo |
| Autorizaciones de precio bajo el límite | Pedido, aprobado, rechazado, usado | ✅ (estado nuevo + eventos existentes) |
| Repartos, beneficiarios, liquidaciones | Altas, cambios de % y estados | ✅ nuevo (líneas y pagos de liquidación: 🟡) |
| Gastos, recurrentes, presupuestos, reservas | Altas, cambios, anulación lógica | ✅ nuevo |
| Empleados y nómina | Altas, salario (advertencia), estado; cuenta bancaria enmascarada | ✅ nuevo (líneas de nómina: 🟡) |
| Compras (ingreso de factura), traslados, ajustes | Altas, estados, totales, bodega | ✅ nuevo |
| Kardex (movimientos) | Es en sí un registro de movimientos; no se duplica en la auditoría | 🟡 hay que confirmar en producción que `inventory_movements` no se pueda editar ni borrar |
| Pedidos y ventas | Creación (también la del catálogo público, como «Cliente (público)»), estado, total, anulación | ✅ nuevo |
| Cuentas por cobrar y pagar | Estado, saldo, total | ✅ nuevo (abonos individuales: 🟡) |
| Terceros, proveedores | Datos y crédito | ✅ existente |
| Facturación electrónica | Documentos, notas, resoluciones, proveedor, descargas, webhooks | ✅ existente |
| Métodos de pago, datos de facturación, perfil de la tienda | Antes/después (sin secretos) | ✅ nuevo |
| Tienda (activación, vencimiento, enlace, dueño) | Antes/después | ✅ nuevo |
| Eliminación de una tienda | Evento crítico en la cadena de plataforma, con el último hash de su cadena | ✅ nuevo |
| Inicio y cierre de sesión | Lo reporta el navegador (`erp_audit_client_event`) | 🟡 no es evidencia del servidor; falta integrar los registros de Supabase Auth |
| Intentos fallidos de inicio de sesión | — | ⏳ requiere Supabase Auth Hooks o log drain |
| Consultas y exportaciones de auditoría | Abrir el centro, exportar, accesos denegados, pedir otro punto | ✅ nuevo |
| Otras exportaciones (CSV de rentabilidad, listas) | — | ⏳ |
| Importaciones masivas (`data_exchange_jobs`) y archivos o imágenes (Storage) | — | ⏳ |
| Campañas sociales, enlaces y contactos de la tienda | — | ⏳ (bajo riesgo) |
| Acciones del panel admin global con llave de servicio | Quedan como «Integración», sin la persona | 🟡 falta propagar quién era el administrador |
| Módulos antiguos (`pos_invoices`, `billing_documents`, `cash_sessions`…) | — | ⏳ verificar si siguen en uso antes de instrumentarlos |
| Consentimientos y documentos legales | — | ⏳ ⚖️ fase 7 |

---

## Etapa B · Diseño

### Registro
- **Dónde se registra:** siempre en la base de datos, dentro de la misma transacción que el cambio, con disparadores `AFTER` y funciones del servidor.
  - El navegador no puede insertar eventos: el privilegio está revocado y se probó.
  - Si el registro falla, la operación entera se revierte: no hay cambios sin evidencia.
- **Datos de cada evento:**
  - Identificador y hora del servidor.
  - Usuario (id y nombre) con su **rol y permisos en ese momento**, y tipo de actor (persona, integración, sistema o cliente público).
  - Tienda, punto, módulo, entidad y registro.
  - Acción, resultado (exitoso, fallido, bloqueado, sospechoso), severidad y motivo.
  - Campos que cambiaron (antes → después), IP, navegador e identificador de la operación.
  - Eslabón y hash.
- **Datos sensibles:**
  - Se excluyen automáticamente las columnas que parecen secreto (password, secret, token, api_key, private, credential, signature, certificate).
  - Las cuentas bancarias se enmascaran (••••1234).
  - Las tablas de secretos (`fiscal_secrets`, `store_payment_secrets`, `store_addi_credentials`) no se auditan con antes/después.

### Inmutabilidad: capas y límites reales
1. **Privilegios:** `anon` y `authenticated` no pueden insertar, editar, borrar ni vaciar. `service_role` tampoco puede editar, borrar ni vaciar.
2. **Disparadores:** bloquean UPDATE, DELETE y TRUNCATE incluso para quien tenga acceso directo a la tabla.
   - El "mantenimiento" de emergencia solo funciona conectado como `postgres`/`supabase_admin`. Antes bastaba un ajuste de sesión.
3. **Cadena SHA-256 por tienda:**
   - `hash = SHA256(hash_anterior | evento canónico)` y numeración consecutiva (`chain_seq`).
   - `erp_audit_verify` detecta eventos **modificados** (el hash no coincide), **borrados** (huecos) y **enlaces rotos**.
   - Cada verificación queda guardada, también de forma inalterable. Si hay fallas, se genera una alerta crítica.
4. **Límites que hay que tener claros:**
   - Quien tenga la cuenta `postgres` puede desactivar disparadores y reconstruir la cadena.
   - Borrar los **últimos** eventos no deja hueco. Para cubrir ambos casos se necesita un **ancla externa** (ver "Configuración pendiente").
   - Los eventos anteriores a esta migración no tienen hash; aparecen como "anteriores a la cadena".

### Alcance de consulta (matriz)

| Rol | Ve | Edita o borra |
|---|---|---|
| Admin global (`user_profiles.role = admin`) | Toda la plataforma; filtra por tienda | Nunca |
| Dueño o usuario de la madre con permiso `audit`/`fiscal_audit` | Toda su tienda | Nunca |
| Usuario de punto con permiso `audit` | Sus puntos, sin eventos de seguridad de otros | Nunca |
| Usuarios de punto sin permiso | Nada, salvo que la madre active «cada usuario ve su punto», que muestra su punto sin seguridad, usuarios ni sesiones | Nunca |
| Otra tienda | Nada. El intento queda como evento de seguridad | Nunca |

### Botón espía 🕵️
- Insignia con el icono `ScanEye` y una línea de escaneo en CSS, sin librerías nuevas. Respeta "reducir movimiento".
- Funciona con teclado (Esc cierra) y lector de pantalla (`aria-label`).
- Sale solo si el usuario puede consultar la auditoría. Esa consulta no deja registro, para no llenar la auditoría de falsos intentos.
- **Encabezado de cada módulo:** filtra por el módulo de la página.
- **En los registros:** producto (historial completo), usuario (historial de sus permisos) y punto (todo lo del punto).
- **Centro global:** `/dashboard/auditoria` (tienda) y `/admin/auditoria` (plataforma).

---

## Etapa C · Lo implementado

### Base de datos (`20261117_auditoria_global.sql`, idempotente, sin borrar datos)
- **Columnas nuevas** en `erp_audit_logs`: `module`, `result`, `actor_type`, `actor_role`, `actor_permissions`, `correlation_id`, `chain_seq`, `prev_hash`, `hash`, `schema_version`. Se amplían las categorías.
- **Disparadores:**
  - `erp_audit_logs_chain` (cadena y datos del actor).
  - `erp_audit_logs_no_truncate`.
  - `stores_audit_deleted`.
  - `<tabla>_audit` en 29 tablas. Solo se crean si la tabla existe.
- **Funciones:**
  - `erp_audit_search` (filtros, cursor y alcance).
  - `erp_audit_export` (máximo 5.000 filas y queda registrado).
  - `erp_audit_overview`.
  - `erp_audit_verify`.
  - `erp_audit_access`.
  - `erp_audit_scope_save`.
  - `erp_audit_chain_heads` (solo `service_role`).
- **Tabla nueva:** `erp_audit_verifications` (inalterable).
- **Corrección de un error que ya existía:**
  - Borrar una tienda con puntos **fallaba**: los disparadores de auditoría de sus filas apuntaban a una tienda que ya no existía.
  - Ahora el borrado en cascada no se registra fila por fila; queda un resumen en la cadena de la plataforma.
- **Reversión:** el bloque comentado al final de la migración quita los disparadores. Los eventos se conservan.

### Interfaz
- `src/components/audit/`:
  - `AuditSpyButton.tsx`: botón y panel lateral.
  - `AuditEventCard.tsx`: evento con antes/después y evidencia.
  - `AuditCenter.tsx`: centro con resumen real, filtros, paginación, exportación CSV, verificación y alcance.
  - `audit-labels.ts`.
- `src/app/dashboard/auditoria/page.tsx` y `src/app/admin/auditoria/page.tsx`.
- `DashboardShell.tsx`: botón en el encabezado y opción "🕵️ Auditoría" en el menú.
- Botones contextuales en `products/[id]`, `store/users` y `puntos/[id]`.

---

## Etapa D · Pruebas (PGlite, Postgres real)

`auditoria.test.mjs`: **41/41**. La prueba fiscal existente con esta migración encima: **148/148**. El resto de suites sigue en verde.

| # | Prueba | Resultado |
|---|---|---|
| 1-2 | Creación y modificación con autor, rol, antes/después y cadena | ✅ |
| 3-4 | Editar, borrar, vaciar o insertar eventos (dueño, admin global y acceso directo) | ✅ bloqueado |
| 5 | Otra tienda consulta o exporta | ✅ bloqueado y registrado |
| 6 | Pedir otro punto cambiando el identificador | ✅ bloqueado y registrado |
| 7 | Cambio de permisos: queda auditado y aplica de inmediato | ✅ |
| 8 | Carga masiva (30 filas): cada una referenciada | ✅ |
| 9 | Si el registro falla, la operación se revierte (misma transacción) | 🟡 por diseño; no hay prueba de inyección de fallas |
| 10 | Alteración y borrado detectados, alerta crítica y verificación guardada | ✅ |
| 11 | Paginación con cursor sin repetir, contextual, exportación registrada, resumen real | ✅ |
| 12 | Botón y panel en escritorio y celular | ✅ revisado en navegador con datos de prueba |
| 13 | Tokens y secretos excluidos, cuenta enmascarada | ✅ |
| 14 | Compatibilidad: fiscal 148/148, POS, comprobante, inventario | ✅ |
| 15 | Primera página con más de 3.000 eventos (PGlite) | ✅ unos 7 ms |

No se probó contra la base de producción.

---

## Hallazgos de seguridad (revisados en esta fase)

| Id | Severidad | Hallazgo | Estado |
|---|---|---|---|
| S-01 | Crítica | `next@16.1.3`: 37 avisos, 2 críticos de ejecución remota y varios de evasión del proxy; también `sharp`, `ws`, `source-map-js` | ✅ next 16.3.8, sharp 0.35.5 y versiones corregidas de `ws` y `source-map-js` → `npm audit`: 0 vulnerabilidades; compila y pasan las pruebas |
| S-02 | Media | El "mantenimiento" de la auditoría se activaba con un ajuste de sesión | ✅ ahora solo `postgres`/`supabase_admin` |
| S-03 | Alta | Borrar una tienda con puntos fallaba por los disparadores de auditoría | ✅ corregido y probado |
| S-04 | Media | Borrar una tienda borra en cascada su auditoría | 🟡 ahora queda evidencia en la cadena de plataforma; ⏳ decisión de negocio: borrado lógico de tiendas |
| S-05 | Media | El inicio y cierre de sesión los reporta el navegador | ⏳ Supabase Auth Hooks o log drain |
| S-06 | Baja | Sin ancla externa no se detecta el borrado de los últimos eventos ni una cadena reconstruida por un superusuario | ✅ implementada: `/api/audit/anchor` con tarea diaria en `vercel.json`, firma con una llave fuera de la base y envío por correo o webhook. ⚙️ Faltan las variables en Vercel |
| S-08 | Alta | `/api/admin/notifications/*` usaban la llave de servicio **sin autenticación**: cualquiera veía nombre, enlace y vencimiento de todas las tiendas | ✅ ahora exigen la sesión del administrador global. Probado: 401 sin sesión o con una sesión falsa |
| S-09 | Media | El servidor descargaba cualquier dirección http(s) puesta como logo, incluso internas o con redirección | ✅ solo https a un dominio público, sin IP ni nombres internos, sin redirecciones y con tope de 8 MB (`tests/security/ssrf.test.ts`) |
| S-10 | Media | No había encabezados de seguridad (insertar el sitio en otra página, HSTS, tipos de archivo, permisos del navegador) | ✅ agregados en `next.config.ts` y verificados. ⏳ Falta la política de contenido completa (CSP), que requiere inventariar GTM, píxeles, Wompi, Addi y jsdelivr |
| S-11 | Info | El middleware solo mira si existe la cookie `app_session`, no la valida. La seguridad real está en RLS y en las funciones de la base | 🟡 aceptable |
| S-12 | Baja | `/api/push/stock-requests` es público porque lo llama la base. Solo acepta eventos recientes y cada uno una vez | 🟡 aceptable; se le puede agregar un secreto compartido |
| S-07 | Media | Acciones del admin global con llave de servicio sin la persona | ⏳ |

---

## Configuración pendiente (externa)
1. **Ejecutar** `20261117_auditoria_global.sql` en Supabase. Requiere que la migración fiscal 20261027 ya esté aplicada, como en producción.
2. **Ancla externa y verificación periódica.** Ya está implementada. Solo faltan estas variables en Vercel: `CRON_SECRET`, `AUDIT_ANCHOR_SECRET` (32 caracteres o más) y `RESEND_API_KEY` + `AUDIT_ANCHOR_EMAIL`, o en su lugar `AUDIT_ANCHOR_WEBHOOK_URL`. Lo que hace la tarea diaria (Vercel Cron), con la llave de servicio:
   - Llamar a `erp_audit_verify` para la plataforma y para cada tienda.
   - Guardar el resultado de `erp_audit_chain_heads()` **fuera** de Supabase: almacenamiento con retención o correo a una casilla aparte.

   Costos aproximados: sin costo en el plan de Vercel actual. El almacenamiento WORM (por ejemplo S3 Object Lock) cuesta centavos de dólar al mes por este volumen, pero **no está configurado**.
3. **Copias de seguridad:** confirmar el plan de backups de Supabase (Point-in-Time Recovery es de pago).

## Fases que siguen (no iniciadas en esta entrega)
- **Fase 6, cookies y rendimiento:** inventario real de cookies, localStorage y service worker; revisión de caché por tienda.
- **Fase 7, legal ⚖️:** términos, política de datos (Ley 1581 de 2012, Decreto 1074 de 2015), aviso de privacidad, cookies, autorizaciones con versión, y su registro en la base con revocación. Necesita datos de la empresa y revisión de un abogado.
- **Fase 8, OWASP completo:** endpoints `/api/*`, cabeceras, rate limiting, archivos y webhooks.
- **Fase 9, centro administrativo:** alertas, incidentes y aceptaciones legales. Lo de auditoría ya está.
- **Fase 10, precios y planes:** investigación con fuentes verificables.
- **Fase 5, detalle:** confirmar que cada liquidación guarda las reglas usadas y que las correcciones crean operaciones nuevas.
