# RemHub como SaaS: planes, prueba, cobros y administración

## Dos sistemas de pago que NO se mezclan

| | Cobros de RemHub (suscripciones) | Cobros de cada tienda (sus ventas) |
|---|---|---|
| Para qué | Que las tiendas te paguen el plan | Que los clientes de la tienda le paguen a la tienda |
| Cuenta Wompi | La de **RemHub** | La de **cada tienda** |
| Llaves | Variables de Vercel `WOMPI_REMHUB_*` | `billing_settings.payment_methods` de la tienda |
| Avisos (webhook) | `/api/saas/wompi/webhook` | `/api/payments/wompi/webhook` (igual que antes) |
| Tablas | `saas_payments`, `saas_webhook_events` | `orders`, `process_wompi_event` |
| Dónde se ve | Admin → 💎 Suscripciones | Panel de cada tienda |

Las referencias de RemHub empiezan por `RH-`. Un aviso con otra referencia no toca ninguna suscripción.

## Planes (precios de trabajo, editables en Admin → Suscripciones → Planes)

| Plan | Mes | Año | Productos | Usuarios | Puntos |
|---|---|---|---|---|---|
| Gratis | $0 | — | 10 | 1 | 1 |
| Emprendedor | $49.900 | $499.000 | 300 | 3 | 1 |
| Negocio ⭐ | $99.900 | $999.000 | 2.000 | 10 | 3 |
| Empresarial | $199.900 | $1.999.000 | ∞ | 30 | 10 |
| Fundador (oculto) | — | — | ∞ | ∞ | ∞ |

- **Quién paga:** la tienda madre. Sus puntos, usuarios y productos cuentan contra su plan. Puntos extra: `extra_points` (lo pone el admin).
- **Clientes actuales:** quedan en **Fundador** con su `active_until` de siempre. Nada cambia para ellos.
- **Cambio de precio:** quien ya pagó renueva con su precio pactado (`locked_*`) hasta que cambie de plan.

## Estados de una suscripción

`free` (gratis) · `trialing` (prueba) · `active` (pagada) · `payment_pending` · `past_due` (vencida, en días de gracia) · `canceled` (no renueva, sigue hasta el fin del período) · `expired` (venció → plan Gratis) · `suspended` (la suspende RemHub).

El estado se calcula con las fechas **cada vez** que se consulta (`saas__effective`): no depende de que alguien abra la página ni de una tarea programada. Al vencer **no se borra nada**: la tienda queda en Gratis con todos sus datos.

## Prueba gratuita

- 7 días del plan Negocio, sin tarjeta. La activa el dueño desde **Mi plan**.
- Una sola vez por tienda **y** por dueño (`saas_trials`): no se reinicia creando otra tienda.

## Límites

- Se revisan en la base al crear productos, usuarios y puntos. Ocultar un botón no basta, así que se hace en la base.
- Arrancan en **modo observar**: dejan crear y anotan `limit_hit`, que se ve en el resumen del admin.
- Para bloquear: Admin → Suscripciones → Ajustes → «Bloquear al superar los límites del plan».

## Cómo se cobra (paso a paso)

1. El dueño elige el plan en **/dashboard/plan**.
2. `/api/saas/checkout` pide a la base el precio (`saas_checkout_create`). El navegador nunca manda el precio. Se crea la referencia `RH-…`.
3. El servidor firma el pago con `WOMPI_REMHUB_INTEGRITY_SECRET` y manda al cliente al Web Checkout de Wompi (el link vence en 1 hora).
4. Wompi avisa a `/api/saas/wompi/webhook`. Se revisa el checksum con `WOMPI_REMHUB_EVENTS_SECRET`, se **consulta la transacción a Wompi** y se aplica una sola vez (`saas_payment_apply`):
   - Si el monto, la moneda o el entorno no coinciden, queda **en revisión**.
   - Un aviso repetido no suma otro mes.
5. Si el pago se aprueba, el plan se activa por un mes o un año, y `stores.active_until` se actualiza.

**No es cobro automático:** el cliente paga cada mes o cada año. El cobro recurrente con tarjeta guardada (fuentes de pago de Wompi) es una etapa posterior.

## Qué configurar

### Supabase
Ejecuta `supabase/migrations/20261211_saas_planes_suscripciones.sql`.

### Vercel (Settings → Environment Variables, solo servidor; nunca con `NEXT_PUBLIC_`)
```
WOMPI_REMHUB_ENV=sandbox            # luego production
WOMPI_REMHUB_PUBLIC_KEY=pub_test_…
WOMPI_REMHUB_PRIVATE_KEY=prv_test_…
WOMPI_REMHUB_INTEGRITY_SECRET=test_integrity_…
WOMPI_REMHUB_EVENTS_SECRET=test_events_…
```
`SUPABASE_SERVICE_ROLE_KEY` ya existe.

Si las llaves no corresponden al entorno (por ejemplo, llaves de prueba con `production`), el cobro no arranca.

### Wompi (dashboard de comercios de RemHub)
- URL de eventos: `https://remhub.co/api/saas/wompi/webhook`
- Probar primero en Sandbox con las tarjetas de prueba de Wompi.

## Cómo probar (sandbox)
1. Corre la migración y pon las variables `test`.
2. Con una tienda de prueba: Mi plan → «Probar 7 días» → ver los días restantes.
3. Mi plan → Emprendedor → Ir a pagar → pagar con la tarjeta de pruebas APROBADA de Wompi. Al volver dice «Pago aprobado» y el plan queda activo.
4. Admin → Suscripciones → Pagos: aparece el pago aprobado y el aviso `applied`.
5. Paga con la tarjeta de prueba RECHAZADA: queda «Rechazado» y el plan no cambia.

Pruebas automáticas: `node tests/sql/saas_planes.test.mjs` (base de datos) y `npm test` (firmas de Wompi en `tests/saas/wompi.test.ts`).

## Registro público (20261212)
- Página **/registro**, en 2 pasos: 1) crear la cuenta con correo y contraseña (o Google / Facebook si los activas); 2) crear la tienda (nombre, subdominio revisado en vivo, WhatsApp) y elegir «Probar Negocio 7 días» o «Empezar gratis».
- La crea la base (`saas_signup_create_store`): el dueño siempre es quien inició sesión. Hay una tienda por cuenta, y un empleado no puede crear otra con la misma cuenta. La tienda queda con su bodega principal.
- **Google:** en Supabase → Authentication → Providers → Google, pega el *Client ID* y el *Secret* de Google Cloud (OAuth).
  - En Google Cloud, la URL de redirección autorizada es `https://<tu-proyecto>.supabase.co/auth/v1/callback`.
  - En Supabase → Authentication → URL Configuration agrega `https://remhub.co/registro` a las URL permitidas.
  - En Vercel: `NEXT_PUBLIC_AUTH_GOOGLE=1`. No es secreto: solo muestra el botón.
- **Facebook:** igual, con una app de Meta for Developers, y `NEXT_PUBLIC_AUTH_FACEBOOK=1`.
- **Cuentas duplicadas:** si alguien se registra con correo y después entra con Google con el mismo correo verificado, Supabase vincula las dos formas de entrar a la misma cuenta.
- **Correo de confirmación:** si en Supabase está activo «Confirm email», la persona confirma y vuelve sola a /registro para crear la tienda.

## Módulos según el plan (20261213)
- Cada permiso pertenece a un módulo (POS, traslados, nómina…). Con **«Bloquear los módulos que el plan no incluye»** encendido (Admin → Suscripciones → Ajustes), `erp_can` responde «no» y el panel ofrece «Ver planes».
- Arranca **apagado**. Los Fundadores tienen todo incluido. El admin de RemHub nunca se frena.

## Avisos
- **En el menú del panel** (dueño y administradores): días de prueba, plan por vencer, días de gracia y límites casi llenos.
- **Al celular**, una vez al día: la tarea diaria `/api/push/payables` avisa al dueño cuando la prueba termina en 2 días, cuando el plan vence en 3 días o cuando está en días de gracia. Solo si las notificaciones push ya están configuradas (VAPID).

## Sin Wompi todavía (20261214)
- Si Wompi no está configurado, en «Mi plan» el botón de contratar ofrece **escribir por WhatsApp** con el plan y el precio ya escritos. El número es el de la página principal (se cambia con `NEXT_PUBLIC_REMHUB_WHATSAPP`).
- En **Admin → Suscripciones → Clientes → Gestionar** hay dos atajos:
  - **🎁 Habilitar todo incluido** por 30 días, 3 meses, 1 año o sin vencimiento: plan Fundador, sin límites y con todos los módulos.
  - **💵 Registrar un pago recibido** (transferencia, Nequi, Daviplata, efectivo…): activa el plan y cuenta en «Cobrado» y en el MRR igual que un pago en línea. En Pagos aparece como «Manual · nequi».
- Cuando tengas la cuenta de Wompi, solo pones las variables `WOMPI_REMHUB_*` en Vercel y el botón pasa solo al pago en línea.

## Crecimiento: conseguir clientes sin pasarela (20261215)
- **Sello «Hecho con RemHub · Crea tu tienda gratis»** al pie de cada catálogo y vitrina. Lleva a remhub.co con `?ref=<tienda>`; el registro recuerda esa tienda durante 30 días.
- **Invita y gana** (en «Mi plan»): cada tienda tiene su enlace `remhub.co/registro?ref=<tienda>`, con botones para copiarlo y compartirlo por WhatsApp. Muestra cuántas se unieron, cuántas contrataron y los días ganados.
  - La tienda nueva queda «referida por» quien la invitó: una sola vez, en sus primeros 7 días, y nunca a sí misma ni del mismo dueño.
  - **El premio lo das tú** en Admin → Suscripciones → Resumen → «Invita y gana» → 🎁 Premiar (días de todo incluido). No hay pagos ni comisiones automáticas.
- **Primeros pasos** en el inicio del panel, para el dueño:
  - logo;
  - primer producto;
  - 5 productos con foto;
  - catálogo;
  - compartir el enlace y recibir el primer pedido;
  - invitar al equipo.

  Tiene barra de progreso, se puede ocultar y desaparece sola al completar todo.
- **Vitrina de clientes** en la página principal («Tiendas que ya venden con RemHub»): solo las que marques en Gestionar → «Mostrar en…». Muestra nombre, logo y enlace. Si no hay ninguna marcada, no se muestra la sección.
- **Tienda de ejemplo:** pon en Vercel `NEXT_PUBLIC_DEMO_STORE_URL=https://tu-tienda-demo.remhub.co/` y aparece el botón «Ver una tienda de ejemplo».
- **Página principal:** el botón principal ahora es «Crear mi tienda gratis» (al registro). «Quiero una demo» sigue por WhatsApp.

## Productos nuevos siempre activos (20261216)
- Si creas un producto activo, queda activo aunque tenga 0 unidades.
- Un proceso automático de la base ya no puede desactivar un producto que ya estaba en 0: solo tú desde la app, o el sistema cuando se queda sin unidades después de haber tenido.
- Al correr la migración, Supabase muestra una tabla con los activadores de `products` que tocan «active», para saber cuál los desactivaba.

## Pendiente (siguientes etapas)
- Cobro recurrente automático (fuentes de pago de Wompi) y reembolsos.
- Avisos por correo (falta conectar un proveedor de correo).
- Costos de infraestructura y margen en el tablero (cuando haya una fuente real de datos).
- Datos de demostración para mostrar los planes superiores sin tocar datos reales.
