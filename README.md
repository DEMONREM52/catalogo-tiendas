This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

This repository now includes new dashboard features for store users:

- `/dashboard/pos` — POS / facturación rápida para ventas en vitrina.
- `/dashboard/clientes` — gestión de clientes por tienda.
- `/dashboard/store/users` — invitación y administración de usuarios por tienda.

Nueva base de datos necesaria:

- `store_members` para asignar usuarios a tiendas.
- `clients` para guardar clientes y datos fiscales.
- `siigo_invoices` como tabla opcional para rastrear la integración con Siigo.

## Pagos Wompi y comprobantes de pedidos

Ejecuta [`supabase/configuracion-pedidos-pagos.sql`](./supabase/configuracion-pedidos-pagos.sql) en el SQL Editor de Supabase después del esquema base de la aplicación. Requiere las tablas existentes `stores`, `orders` y `order_items`. El script instala RPCs versionados (`confirm_order_v2` y `update_order_items_by_token_v2`) para no cambiar ni eliminar funciones existentes que pueden tener otros tipos de retorno, además de agregar triggers que bloquean la edición y reapertura de pedidos confirmados. También crea el almacenamiento por tienda para las formas de pago y los secretos de Wompi, y permite guardar más de una opción del mismo proveedor.

Si ya existía una restricción que solo permitía una opción por proveedor y tienda, el script la elimina. Al guardar desde el dashboard se actualizan las opciones por su ID, evitando que una forma existente se borre accidentalmente al editarla.

Después de ejecutar el SQL:

1. Entra a **Dashboard → Facturación → Formas de pago**, añade una o más opciones Wompi o Addi y pulsa **Guardar formas de pago**.
2. Guarda la llave pública, el secreto de integridad y el secreto de eventos de la tienda desde el panel de comercios Wompi. Selecciona sandbox para pruebas y producción para recibir pagos reales. Los secretos se guardan en una tabla privada protegida con RLS y no se incluyen en el catálogo público.
3. Configura en Wompi la URL de eventos de producción o pruebas de tu aplicación: `https://TU-DOMINIO/api/payments/wompi/webhook`.
4. Para conectar Addi, instala [`supabase/migrations/20260927_addi_payments.sql`](./supabase/migrations/20260927_addi_payments.sql) después del esquema base y de `configuracion-pedidos-pagos.sql`. Define `NEXT_PUBLIC_SITE_URL` con el dominio HTTPS público de la aplicación y asegúrate de que `SUPABASE_SERVICE_ROLE_KEY` esté configurada solo en el servidor.
5. Cada propietario entra a **Dashboard → Facturación → Formas de pago**, selecciona el ambiente de pruebas o producción y guarda el client ID y client secret entregados por Addi para su comercio. La aplicación valida las credenciales antes de guardarlas en una tabla privada; nunca se devuelven al navegador ni se comparten entre tiendas. Después añade **Addi** como forma de pago, actívala y guarda los métodos.
6. El cliente verá Addi únicamente en pedidos **confirmados o completados**. Completa sus datos de identificación y entrega en el comprobante; la solicitud de crédito se crea en el servidor con el valor real de los ítems del pedido y se redirige a Addi. El pedido solo se muestra como pagado cuando se recibe el callback firmado para ese intento y se verifica que el estado sea `APPROVED`, la moneda sea COP y el monto aprobado coincida con el total.
7. La versión `POST /v1/online-applications` del manual de Addi corresponde a clientes nuevos. Si Addi responde que el cliente ya tiene crédito, no se registra un pago y el cliente debe contactar a la tienda para recibir instrucciones. Las credenciales reales de producción requieren aprobación y entrega directa de Addi; la integración no queda lista para cobros reales hasta completar ese paso.

La integración sigue el [manual de Addi](https://api-docs.addi-staging.com/integration/) y la [documentación de autenticación de Addi](https://api-docs.addi-staging.com/auth/). Para hacer pruebas de callbacks en desarrollo, la aplicación también debe estar disponible públicamente mediante HTTPS; Addi no puede acceder a `localhost`.

El checkout alojado de Wompi deja que el comprador escoja entre los medios habilitados en la cuenta del comercio, incluyendo tarjetas débito/crédito (Visa, Mastercard y American Express), PSE, Nequi, transferencia Bancolombia, DaviPlata y otras opciones disponibles según el comercio. Addi utiliza la integración directa descrita en su manual y no se procesa a través de Wompi.

El comprobante del pedido puede imprimirse/guardarse como PDF y compartirse por WhatsApp. La factura electrónica fiscal requiere la configuración y emisión correspondiente con Siigo u otro proveedor autorizado.

## Usuarios internos y permisos por tienda

Ejecuta [`supabase/usuarios-internos-tiendas.sql`](./supabase/usuarios-internos-tiendas.sql) en Supabase después del esquema base y de [`supabase/configuracion-pedidos-pagos.sql`](./supabase/configuracion-pedidos-pagos.sql), si usas pagos. El script crea o amplía `store_users`, instala permisos RLS ligados al `store_id` y agrega la función segura que usa el dashboard para autorizar cambios de estado en pedidos. Ejecútalo después del SQL de pagos: añade políticas restrictivas para que políticas permisivas antiguas no amplíen el acceso de los usuarios autenticados. Las lecturas públicas intencionales de productos/categorías activos, perfiles de tienda y métodos de pago visibles se conservan.

Las credenciales privadas de Wompi en `store_payment_secrets` solo pueden ser consultadas o modificadas por el propietario de la tienda. Los usuarios internos con permiso de facturación pueden administrar los datos públicos de las formas de pago, pero no pueden leer los secretos ni activar Wompi. No copies secretos a catálogos ni a tablas con acceso público.

En el entorno **del servidor** configura `SUPABASE_SERVICE_ROLE_KEY` con la llave `service_role` de Supabase. En Vercel, agrégala en **Project → Settings → Environment Variables** para los entornos que utilices y vuelve a desplegar. En desarrollo local, agrégala a `.env.local` y reinicia `npm run dev`. No la nombres `NEXT_PUBLIC_*`, no la incluyas en código del navegador y no la compartas con los trabajadores. Las rutas protegidas la usan para crear y administrar cuentas Auth después de comprobar la sesión y que el administrador pertenezca a esa tienda; sin esta llave, esa gestión no puede funcionar.

El propietario entra con el correo y la contraseña que ya tiene en Supabase Auth y asociados a `stores.owner_id`. Desde **Dashboard → Usuarios**, crea cada acceso con un nombre de usuario interno (por ejemplo `USU01`), una contraseña de al menos ocho caracteres y solo las secciones que deba usar. La aplicación crea la cuenta Auth y genera un enlace propio para esa tienda, con la forma `https://TU-DOMINIO/acceso/slug-de-la-tienda?sid=...&usuario=...`. El enlace valida la tienda antes de iniciar sesión; la identidad Auth se genera a partir del ID de tienda y el usuario, de modo que el mismo nombre de usuario en otra tienda no comparte la cuenta. Permite editar permisos, cambiar la contraseña o desactivar/reactivar el usuario. El trabajador no necesita correo propio; la contraseña no se almacena en la tabla de miembros. Si se pierde, el administrador debe asignar una nueva.

Las opciones de permisos controlan tanto los elementos visibles del menú y el acceso directo a páginas como las políticas RLS de los datos de tienda. Cada cuenta interna queda asociada a una tienda. Al desactivarla, pierde acceso a las filas protegidas de inmediato; vuelve a entrar al reactivarla. Usuarios creados antes de esta función conservan su acceso existente por correo, pero para generarles un enlace interno nuevo se debe crear un acceso interno nuevo.

El POS obtiene los productos y clientes de la tienda asignada y ya no carga la llave de Siigo en el navegador. La emisión electrónica valida la sesión y el permiso POS en el servidor antes de usar credenciales privadas.

## Precios del POS y clientes

Ejecuta [`supabase/pos-precios-clientes.sql`](./supabase/pos-precios-clientes.sql) después del esquema base. Agrega de forma idempotente los cinco precios usados por el editor y el POS, completa los precios de productos antiguos a partir de sus precios detal/mayor existentes, agrega `billing_customers.price_list` y permite dejar vacío el documento del cliente. Orden recomendado: esquema base, `configuracion-pedidos-pagos.sql` si usas pagos, `pos-precios-clientes.sql` y por último `usuarios-internos-tiendas.sql`. Ejecuta este archivo antes de usar POS, crear productos o guardar clientes.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
