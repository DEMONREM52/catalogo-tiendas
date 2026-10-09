# Guía del administrador: puntos y facturación electrónica en RemHub

Esta guía es para el dueño o administrador de la tienda madre y para la contadora. Explica paso a paso cómo crear un punto, darle su identidad fiscal y dejarlo listo para facturar electrónicamente.

> Ver o administrar un punto **no te hace responsable fiscal** de sus ventas. Cada punto factura con el NIT de su contribuyente.
> Lo marcado **«requiere validación contable»** lo decide tu contadora o tu proveedor tecnológico, no RemHub.

## 0. Antes de empezar (una sola vez)

1. En Supabase → SQL Editor, ejecuta completo `supabase/migrations/20261027_fiscal_multipunto.sql`.
2. En el hosting (por ejemplo Vercel → Settings → Environment Variables) agrega estas variables **sin** el prefijo `NEXT_PUBLIC_`:
   - `FISCAL_SECRETS_KEY`: genérala con `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` y **guárdala en un lugar seguro**. Si la pierdes, tendrás que volver a escribir las credenciales del proveedor.
   - `CRON_SECRET`: cualquier texto largo y aleatorio (lo usa la cola automática).
3. Vuelve a desplegar la aplicación.

## 1. Crear un punto

Entra a **Menú → Puntos → Crear punto**. El asistente tiene 8 pasos y puedes dejar para después lo que no tengas a mano:

1. **General:** nombre, código (si lo dejas vacío se genera), dirección, ciudad, teléfono y tipo (punto de venta o bodega).
2. **Responsable:** la persona a cargo y, si quieres, su usuario del sistema.
3. **Información fiscal:** el contribuyente que factura en el punto. Puedes elegir uno existente o crear uno nuevo con el NIT o la cédula, el DV (se calcula solo), la razón social, el régimen, las responsabilidades del RUT, las actividades CIIU, la dirección fiscal y el correo.
4. **Establecimiento:** la sede registrada (nombre, código, dirección y ciudad).
5. **Facturación electrónica:** el proveedor, el ambiente (**empieza en 🧪 pruebas**) y qué documento emite el POS al elegir «Factura» (requiere validación contable).
6. **Numeración:** la resolución de la DIAN (número, fecha, prefijo, rango y vigencia), o compartir una existente si tu contadora lo indica.
7. **Usuarios:** quiénes trabajan en el punto. Solo verán y operarán ese punto.
8. **Revisión:** todo se crea de una vez; si algo falla, no queda nada a medias.

Al terminar verás la lista de verificación con lo que falta para poder facturar.

## 2. La ficha del punto

**Puntos → (elige el punto)**. Las pestañas son:

- **Datos y responsable:** administración del punto, separada de la parte fiscal.
- **Fiscalidad:** el semáforo 🟢🟡🔴 y la configuración (contribuyente, establecimiento, ambiente, cuenta del proveedor y activación), la numeración autorizada y los últimos documentos.
- **Usuarios y permisos:** quién trabaja en el punto y quién solo lo consulta.
- **Inventario y caja:** unidades, valor, ventas de hoy y del mes, y ventas de hoy por medio de pago.
- **Auditoría:** los últimos cambios, con el valor anterior, el nuevo y el motivo.
- **Estado:** Activo, Suspendido, Inactivo o Borrador. Para suspender o desactivar se pide el motivo.

«Activo» quiere decir que el punto opera. «Habilitado fiscalmente» quiere decir que puede emitir documentos electrónicos. Son cosas distintas.

## 3. Configurar el contribuyente (entidad fiscal)

**Facturación electrónica → Contribuyentes**.

- Completa los datos **tal como aparecen en el RUT**: RemHub no inventa datos. El contribuyente se puede activar cuando todo está completo.
- Cambiar el NIT, el DV, la razón social o el tipo de persona pide un **motivo**, y queda auditado con el valor anterior y el nuevo.
- Un contribuyente que ya facturó **conserva su NIT**. Si el NIT es otro, se trata de otro contribuyente: créalo nuevo.
- Desde la misma tarjeta agregas los **establecimientos**.

## 4. Configurar la numeración

**Facturación electrónica → Numeración → Nueva numeración**.

1. Elige el contribuyente, el tipo de documento (factura, documento equivalente POS, nota crédito…) y el ambiente.
2. Escribe el número y la fecha de la resolución, la vigencia, el prefijo y el rango (desde y hasta).
3. Marca los **puntos autorizados**. Por defecto es uno solo; compartir una numeración entre puntos requiere validación contable.
4. Si ya usaste números de ese rango en otro sistema, indica el «siguiente número». Nunca puede bajar.
5. Pega la **clave técnica**: se guarda cifrada y solo se muestra `••••1234`.
6. Actívala.

RemHub avisa cuando el rango llega al porcentaje que elijas y antes de que venza. No entrega números fuera del rango ni de una resolución vencida, y nunca repite un número, aunque dos cajeros facturen al mismo tiempo. Las notas crédito y débito necesitan su propia numeración.

## 5. Conectar el proveedor tecnológico

**Facturación electrónica → Proveedor → Conectar proveedor**.

- **Para probar** todo sin riesgo usa el **Simulador RemHub** (siempre en pruebas). Puedes elegir cómo se comporta: aceptar, rechazar, fallar o responder después.
- **Para Alegra u otro proveedor:** crea la cuenta con el contribuyente, el ambiente y las credenciales del contrato. Las credenciales se cifran en el servidor y nunca se vuelven a mostrar completas. Hoy la integración con Alegra está **preparada pero pendiente**: debe completarse con su documentación oficial antes de transmitir.
- **Probar conexión:** es obligatorio para quedar 🟢. El resultado queda registrado.
- **Webhook:** copia la URL que aparece en la tarjeta y configúrala en el proveedor. Usa «Generar secreto» si el proveedor firma los avisos; el secreto se muestra una sola vez.
- **Desconectar o reconectar** piden un motivo. Mientras el proveedor esté desconectado, los puntos que lo usan no transmiten.
- Pruebas y producción son **cuentas separadas**: las credenciales nunca se mezclan.

## 6. Activar la facturación

1. En **Facturación electrónica → Configuración** activa el interruptor general de la tienda.
2. En la ficha de cada punto, en **Fiscalidad**, activa la facturación del punto cuando la lista esté completa.
3. Para pasar a **🟢 producción**, cambia el ambiente del punto y elige una cuenta del proveedor de producción. El sistema pide confirmarlo con un motivo, porque desde ese momento los documentos son reales.

Desde que un punto está activo, en el POS la opción **«Factura» siempre es electrónica**. El número, la resolución y el envío los resuelve el servidor. Si el punto no está listo, el POS muestra exactamente qué falta y no crea la venta como factura.

## 7. Revisar las facturas

**Facturación electrónica → Documentos**. Puedes buscar por número, prefijo, CUFE, NIT, cliente, punto, usuario o error, y filtrar por fecha, estado, tipo y ambiente.

Al abrir un documento ves:

- **Auditoría fiscal:** quién lo creó y desde qué punto, con qué NIT, resolución, prefijo y consecutivo, con qué proveedor, qué respondieron el proveedor y la DIAN, y si se reintentó.
- Los productos, el cliente, las notas relacionadas y la línea de tiempo completa.
- **Acciones según tus permisos:**
  - Enviar, reenviar o consultar estado.
  - **Nota crédito**: devolución parcial o total. Con el total acreditado, la factura queda «Anulada por nota» y se conserva.
  - **Nota débito**.
  - **Anular sin transmitir**: solo para documentos que nunca llegaron al proveedor. El número queda registrado (requiere validación contable).
  - Descargar XML o PDF.

Una factura **aceptada nunca se borra ni se modifica**: se corrige con notas.

## 8. Revisar errores y rechazos

- La **campana** del panel avisa de documentos rechazados, errores de envío, numeraciones por agotarse o vencer, proveedor caído, webhooks con fallas, certificados por vencer, puntos sin configuración, remisiones sin facturar e intentos sospechosos.
- **Rechazado:** abre el documento, lee el motivo, corrige el dato (por ejemplo el correo del cliente) y **reenvíalo**, o anúlalo sin transmitir y vuelve a facturar la venta.
- **Error de envío:** se reintenta solo, con espera creciente. Puedes forzarlo con «Procesar pendientes» en Salud fiscal.
- **Webhooks:** la pestaña muestra los eventos que fallaron; puedes reintentarlos manualmente.
- **Contingencias:** si el proveedor o la DIAN no responden, abre una contingencia. Los documentos quedan en cola y se transmiten al cerrarla.

## 9. Ventas por facturar (remisiones)

**Facturación electrónica → Por facturar** muestra las remisiones de venta de los puntos habilitados que aún no tienen documento fiscal, con los días que llevan. El botón **Facturar** emite la factura y la relaciona con su remisión.

En **Configuración** eliges la regla de la tienda: *sin control*, *avisar* después de N días, o *bloquear* las remisiones de venta. Cuál regla aplicar lo decide tu contadora.

## 10. Descargar documentos y armar el expediente fiscal

- **XML/PDF:** desde el detalle del documento. Necesitas el permiso «Descargar XML/PDF» y cada descarga queda auditada.
- **Expediente fiscal del punto:** en **Auditoría fiscal** eliges el punto, las fechas y los tipos y pulsas «Generar». Lo puedes descargar en JSON completo, en CSV o **imprimirlo / guardarlo como PDF**. Incluye el resumen, la numeración con los anulados sin transmitir y cada documento con su historial.

## 11. Usuarios y permisos

**Ajustes → Usuarios**:

- Asigna el **punto principal** del usuario y, si hace falta, **puntos adicionales que solo puede consultar**.
- Hay plantillas para Vendedor, Cajero, Contabilidad, Auditor y Administrador de punto, y puedes guardar **tus propios roles** con «Guardar como rol».
- Los permisos fiscales sensibles (configuración, numeración, proveedor, notas) dalos solo a personas de confianza.
- Un administrador de punto solo crea y edita usuarios de su punto.

## 12. Clientes compartidos

En **Facturación electrónica → Configuración**, «Clientes compartidos entre puntos» decide si todos los puntos ven los mismos clientes (y su cartera) o si cada punto ve solo los suyos y los de la tienda madre. Las tiendas que ya existían quedaron con **clientes compartidos**, como funcionaban antes. El cambio queda auditado.

## 13. Super administrador

**Panel Admin → Fiscal y seguridad** tiene cuatro pestañas:

- Los indicadores de todas las tiendas, con gráficas por día, por tienda, por punto y por contribuyente.
- La búsqueda global de documentos.
- La salud fiscal de todos los puntos.
- Los intentos sospechosos y la postura de seguridad de la base (tablas sin RLS).
