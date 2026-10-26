# RemHub sin conexión: vender aunque se caiga el internet o la base de datos

## Qué falla y qué hace RemHub

| Lo que falla | Aviso arriba | Qué se puede hacer |
|---|---|---|
| Internet del punto | 🟠 «Sin internet» | Vender en el POS: las ventas quedan guardadas en el equipo y se registran solas al volver |
| La base de datos (Supabase) | 🔴 «La base de datos no responde» (2 fallas seguidas de `remhub_ping`) | Igual que sin internet; el panel entra con los permisos guardados |
| La base está lenta (> 3 s) | 🟠 «La base de datos está lenta» | Todo sigue; puede tardar |
| La DIAN o Alanube | (ninguno: es del servidor) | La factura electrónica se emite normal y queda en cola; se reintenta sola |

`src/lib/net/status.ts` revisa internet (`/manifest.webmanifest`) y la base (`remhub_ping`, 20261242).
`canReachData()` = hay internet y la base no está caída.

## Qué guarda cada equipo (y dónde)

- **IndexedDB** (`src/lib/offline/idb.ts`, cientos de MB): productos, clientes, precios del punto,
  existencias, configuración fiscal del punto, permisos del usuario y números de contingencia.
- **Ventas sin conexión**: en localStorage **y** en IndexedDB (dos copias, `src/lib/pos/drafts.ts`).
  Si el navegador no deja guardar en ninguna, el POS lo dice y **no** da la venta por guardada.
- **Página del POS**: la guarda el service worker (`/dashboard` y `/dashboard/pos`), así abre aunque
  se recargue sin internet.
- **Sesión**: sin internet, cuando el token de una hora vence, Supabase no la entrega pero la conserva;
  `resilientUser()` la lee del equipo (`src/lib/supabase/offline-session.ts`). Al volver se renueva sola.
- Al cerrar sesión se borra todo lo anterior **menos** las ventas sin enviar y el identificador del equipo.
  Si hay ventas sin enviar, se avisa antes de salir.

## Cómo se registra una venta hecha sin conexión (20261243)

`erp_pos_submit_offline_v2(p_store, p_draft)` (la llama `src/lib/pos/sync.ts`, desde cualquier pantalla del panel):

- Se registra **tal como se cobró**: precio cobrado (las diferencias con la lista quedan en `price_changes`),
  forma de pago con la **hora real** (la caja la cuenta en su turno) y una sola vez por borrador.
- Si la venta cae en una caja ya cerrada, avisa: explica un sobrante de esa caja.
- Si el reloj del equipo está muy mal (más de 45 días atrás o en el futuro), usa la hora de llegada y avisa.
- Lo que la base no acepta sola (sin inventario, precio bajo el mínimo, producto borrado, número de
  contingencia inválido…) queda en `erp_pos_offline_issues`: se ve en el POS de **todos** los equipos y en la campana.
- Los límites de descuento siguen mandando (sin conexión no se pueden revisar: se avisa al cobrar).
- El crédito sigue necesitando conexión (hay que revisar el cupo).

## Facturación electrónica sin internet (contingencia)

Resolución DIAN 000165 de 2023 (resumen, **validar con la contadora y Alanube**):

- **Falla del facturador** (internet, luz, computador, proveedor): factura de **talonario/papel** con una
  **numeración de contingencia** autorizada (MUISCA, formulario 1876). Al superar la falla se transmite a la
  DIAN como factura electrónica dentro de las **48 horas**.
- **Falla de la DIAN**: se emite la factura electrónica normal y se transmite cuando la DIAN se restablezca.

En RemHub:

1. Centro fiscal → Numeración: crear la numeración tipo «Factura de contingencia» y autorizar los puntos.
2. Cada equipo, con conexión, separa 15 números (`fiscal_offline_reserve`); se completa solo al bajar de 5.
   Cada número existe una sola vez (`fiscal_number_allocations`), así dos equipos nunca lo repiten.
3. Sin conexión, en «Factura» el POS imprime la factura de contingencia (`src/lib/pos/offline-receipt.ts`):
   emisor, NIT, número, resolución, IVA, pago y la leyenda de contingencia.
4. Al volver, `fiscal__offline_contingency` crea el documento `contingency_invoice` con ese número y la fecha
   real; se transmite a Alanube como `documentType: "04"` con `additionalDocumentReference` (la factura en papel).
5. Centro fiscal → Contingencias: facturas por aceptar con sus horas de plazo, números separados por equipo
   y «Liberar» (equipo perdido: los números sin usar quedan anulados sin transmitir).

Sin numeración de contingencia, «Factura» sin conexión se emite como factura electrónica normal al volver
(y la campana avisa que falta la numeración).

## Modo práctica

POS → «Listo sin internet» → «Practicar sin internet»: simula la caída solo en esa pestaña.
Las ventas de práctica **no se registran**, sus facturas usan números «PRUEBA-» (no los reales) y se borran al terminar.

## Pendiente de validar

- Con Karina (Alanube): que el tipo «04» con `additionalDocumentReference` es lo correcto para la factura
  en papel, si la numeración de contingencia debe estar asociada en Alanube y si pide clave técnica.
- Con la contadora: la numeración de contingencia (rango y vigencia) y la leyenda impresa.
- Puntos con documento equivalente POS: la contingencia se hace como factura de talonario (confirmar).

## Impresión directa (opcional, por equipo)

POS → botón «Impresora». Lo predeterminado sigue siendo la ventana del navegador. Modos directos:
Chrome/Edge con `--kiosk-printing` (Windows, impresora predeterminada), térmica USB (WebUSB), puerto COM o
Bluetooth emparejado en Windows (Web Serial), térmica Bluetooth BLE (Web Bluetooth) y la app RawBT (Android).
Ancho 58/80 mm, tildes (PC850 / Windows-1252 / sin tildes), corte, cajón en ventas con efectivo, 2 copias y QR.
`next.config.ts` permite USB/serie/Bluetooth solo en `/dashboard`. Código: `src/lib/print/`.

## WhatsApp del plazo de contingencia (20261244)

Cron `/api/notify/offline-watch` cada hora: avisa a las 24 h, 6 h y al vencer (una vez por etapa; si falla
reintenta hasta 3 veces). Configuración: Centro fiscal → Contingencias → «Aviso por WhatsApp».

- **CallMeBot (gratis):** cada número activa su clave con el bot y se pega en RemHub.
- **WhatsApp oficial de RemHub (Meta):** variables de Vercel `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`
  (opcionales: `WHATSAPP_TEMPLATE_CONTINGENCY`, `WHATSAPP_TEMPLATE_LANG`, `WHATSAPP_GRAPH_VERSION`).
  Plantilla de utilidad `remhub_contingencia`, idioma `es`, cuerpo:
  `⚠️ {{1}}: hay {{2}} factura(s) de contingencia sin aceptar por la DIAN. {{3}} (vence {{4}}). Revísalas en RemHub → Centro fiscal → Contingencias.`

## Simulacro mensual

Cada cajero (usuario con POS) practica una vez al mes: POS → «Empezar» → venta de contado → factura de
contingencia de práctica (si el punto factura) → imprimir → «Terminar». Recordatorio al celular el día 1 y el
día límite (9 a. m.); al día siguiente, resumen al dueño. Inicio → tarjeta «Simulacro» (quién lo hizo y configuración).

## Bandeja «Avisos del día» y avisos al equipo (20261245)

- **Terceros → Avisos del día:** cuentas por cobrar que vencen en los próximos N días (3 por defecto) y las vencidas,
  con el mensaje armado. «Enviar» abre WhatsApp en ese equipo con el texto: sale desde el número de quien envía, gratis.
  Queda marcado «enviado hoy». Mensajes editables con {cliente} {valor} {fecha} {documento} {dias} {tienda}.
- **Avisos automáticos al equipo** (hasta 3 números, por tienda): contingencia (cada hora), cuentas por pagar por vencer
  (8 a. m., `/api/push/payables`) y cierre del día (9 p. m., `/api/push/daily-close`). Con CallMeBot salen gratis;
  con el WhatsApp oficial de RemHub necesitan la plantilla `WHATSAPP_TEMPLATE_NOTICE` (cuerpo: `Aviso de RemHub para {{1}}: {{2}}`).
