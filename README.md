# RemHub — Catálogo de tiendas

Plataforma multi-tienda construida con Next.js y Supabase. Cada tienda tiene un catálogo público (detal y mayorista), fichas de producto, pedidos por WhatsApp con comprobante, pagos en línea (Wompi y Addi), POS, inventario, clientes, usuarios internos con permisos y campañas de RemHub Social. Un panel administrativo global gestiona todas las tiendas.

## Stack

- **Next.js 16** (App Router, React 19, React Compiler) + TypeScript
- **Supabase**: Auth, PostgreSQL con RLS y Storage
- **Tailwind CSS 4**, Framer Motion, Lucide, SweetAlert2
- **Vercel**: hosting, Analytics y Speed Insights

## Puesta en marcha

Requisitos: Node.js 20+ y un proyecto de Supabase.

```bash
npm install
cp .env.example .env.local   # completa los valores (ver abajo)
npm run dev                  # http://localhost:3000
```

| Script          | Uso                          |
| --------------- | ---------------------------- |
| `npm run dev`   | Servidor de desarrollo       |
| `npm run build` | Build de producción          |
| `npm run start` | Sirve el build de producción |
| `npm run lint`  | ESLint                       |

### Variables de entorno

| Variable                        | Dónde       | Requerida | Descripción                                                                                                      |
| ------------------------------- | ----------- | --------- | ---------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | Cliente     | Sí        | URL del proyecto Supabase                                                                                        |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Cliente     | Sí        | Llave `anon` de Supabase                                                                                         |
| `SUPABASE_SERVICE_ROLE_KEY`     | **Servidor** | Sí       | Llave `service_role`. La usan las rutas de usuarios internos, campañas, pagos y Siigo. **Nunca** con prefijo `NEXT_PUBLIC_` |
| `NEXT_PUBLIC_SITE_URL`          | Ambos       | Para Addi | Dominio HTTPS público (callbacks de Addi, metadatos del catálogo). Alternativas: `SITE_URL`, `VERCEL_URL`        |
| `SIIGO_API_URL`, `SIIGO_API_TOKEN`, `SIIGO_API_KEY`, `SIIGO_COMPANY_ID`, `SIIGO_INVOICE_PATH` | Servidor | Opcional | Valores por defecto para facturación electrónica con Siigo (`SIIGO_INVOICE_PATH` por defecto `/v1/invoices`) |

`.env*` está en `.gitignore`: no subas llaves al repositorio. En Vercel, defínelas en **Project → Settings → Environment Variables** y vuelve a desplegar.

## Base de datos (Supabase)

> **Nota:** los scripts SQL mencionados a continuación no están actualmente en el árbol de trabajo (`supabase/migrations/` está vacío); existen en el historial de git. Recupéralos o agrégalos de nuevo antes de configurar un entorno nuevo.

Ejecútalos en el **SQL Editor** de Supabase, después del esquema base (`stores`, `store_profiles`, `products`, `categories`, `orders`, `order_items`). Todos son idempotentes. Orden recomendado:

1. `supabase/configuracion-pedidos-pagos.sql`: RPCs `confirm_order_v2` / `update_order_items_by_token_v2`, bloqueo de pedidos confirmados, formas de pago y secretos de Wompi (`store_payment_secrets`). Solo si usas pagos.
2. `supabase/migrations/20260927_addi_payments.sql`: credenciales y pagos de Addi. Requiere el anterior.
3. `supabase/pos-precios-clientes.sql`: cinco listas de precios para producto/POS y `billing_customers.price_list`. Necesario antes de usar POS, productos o clientes.
4. `supabase/usuarios-internos-tiendas.sql`: `store_users`, permisos RLS por `store_id` y políticas restrictivas. **Ejecútalo después** del SQL de pagos.
5. `supabase/migrations/20261001_product_landings_social.sql`: fichas de producto ampliadas, campañas y RLS por tienda.
6. `supabase/migrations/20261002_store_contact_and_quick_access_settings.sql`: contactos WhatsApp, puntos físicos y accesos rápidos en `store_profiles`.
7. Migraciones de campañas `20261002_*` a `20261005_*`, incluida `20261003_social_campaign_catalog_controls.sql` (`cover_image_url`, `category_id`, `is_public`, `sort_order`).
8. Scripts ERP (`erp_core.sql`, `erp_ops.sql`, `erp_points.sql`, `erp_billing_points.sql`, `erp_purchase_files.sql`) para inventario, operaciones y facturación por punto.

Storage: el bucket `product-images` debe permitir subir archivos al administrador autenticado.

## Rutas principales

| Ruta                                  | Descripción                                                          |
| ------------------------------------- | -------------------------------------------------------------------- |
| `/`                                   | Landing                                                              |
| `/[slug]/[mode]`                      | Catálogo público (`detal` o `mayor`; mayor requiere clave mayorista) |
| `/[slug]/producto/[id]`               | Ficha pública del producto                                           |
| `/pedido/[token]`                     | Comprobante del pedido y pago (Wompi / Addi)                         |
| `/login`, `/forgot-password`, `/reset-password` | Acceso de propietarios                                     |
| `/acceso/[slug]`                      | Acceso de usuarios internos de una tienda                            |
| `/dashboard`                          | Panel de la tienda (protegido por `middleware.ts`)                   |
| `/dashboard/products`, `/categories`  | Productos y categorías                                               |
| `/dashboard/pedidos`                  | Pedidos                                                              |
| `/dashboard/pos`                      | POS / facturación rápida                                             |
| `/dashboard/clientes`                 | Clientes y datos fiscales                                            |
| `/dashboard/inventario`               | Stock, compras, traslados y operaciones                              |
| `/dashboard/store`                    | Mi tienda: identidad, tema, contactos, puntos, accesos rápidos       |
| `/dashboard/store/billing`            | Formas de pago y facturación                                         |
| `/dashboard/store/users`              | Usuarios internos y permisos                                         |
| `/dashboard/social`                   | Campañas de RemHub Social                                            |
| `/admin/*`                            | Panel administrativo global (tiendas, usuarios, productos, pedidos, temas) |
| `/api/*`                              | Rutas de servidor: pagos, Siigo, equipo de tienda, campañas, notificaciones admin |

## Estructura

```
src/
  app/          Rutas (App Router), API routes y paneles dashboard/admin
  components/   Componentes compartidos del catálogo
  lib/          Supabase (client/server), carrito, pagos, Siigo, temas y utilidades
middleware.ts   Redirige /dashboard a /login si no hay cookie de sesión
supabase/       Scripts SQL y migraciones
```

## Funcionalidades

### Pagos y comprobantes

- **Wompi**: en **Dashboard → Facturación → Formas de pago** agrega una o más opciones y guarda la llave pública, el secreto de integridad y el de eventos (sandbox o producción). Los secretos viven en una tabla privada con RLS, solo accesible al propietario. Configura en Wompi la URL de eventos `https://TU-DOMINIO/api/payments/wompi/webhook`. El checkout de Wompi ofrece tarjetas, PSE, Nequi, Bancolombia, DaviPlata, etc., según el comercio.
- **Addi**: cada propietario guarda su client ID / secret (se validan antes de guardarse y nunca vuelven al navegador). Addi solo aparece en pedidos **confirmados o completados**; la solicitud se crea en el servidor con el total real y el pedido se marca pagado únicamente tras un callback firmado con estado `APPROVED`, moneda COP y monto coincidente. Requiere `NEXT_PUBLIC_SITE_URL` público en HTTPS (Addi no alcanza `localhost`). Las credenciales de producción las entrega Addi tras aprobación. Ver el [manual de Addi](https://api-docs.addi-staging.com/integration/) y su [autenticación](https://api-docs.addi-staging.com/auth/).
- El comprobante se puede imprimir o guardar en PDF y compartir por WhatsApp. La factura electrónica fiscal requiere Siigo u otro proveedor autorizado.

### Usuarios internos y permisos

- El propietario entra con su correo de Supabase Auth (asociado a `stores.owner_id`).
- En **Dashboard → Usuarios** crea accesos con un usuario interno (p. ej. `USU01`), contraseña (mín. 8 caracteres) y las secciones permitidas. Se genera un enlace `https://TU-DOMINIO/acceso/slug?sid=...&usuario=...`. La identidad Auth se deriva de tienda + usuario, así que el mismo nombre en otra tienda es otra cuenta.
- Los permisos controlan menú, acceso a páginas y políticas RLS. Desactivar un usuario corta el acceso de inmediato. Las contraseñas no se guardan en la tabla de miembros; si se pierden, el administrador asigna una nueva.
- Los usuarios con permiso de facturación administran las formas de pago públicas, pero no leen secretos ni activan Wompi.

### POS y clientes

El POS carga productos y clientes de la tienda asignada, usa las cinco listas de precios y la lista asignada a cada cliente. La emisión con Siigo se valida en el servidor (sesión + permiso POS); las credenciales nunca llegan al navegador.

### Configuración de la tienda (Mi tienda)

Nombre, slug público (se normaliza al guardar), clave mayorista privada, catálogos habilitados, tema con vista previa, logo, banner, redes, contactos WhatsApp (activables, con avatares y uno principal), **Puntos para encontrarnos** (sucursales con mapa y rutas desde la ubicación del cliente, que no se guarda) y tarjetas de **Acceso rápido**. Suscripción y vigencia se administran desde `/admin`.

### Catálogo y fichas de producto

- Muestra productos activos y disponibles, con carrito, cantidades mínimas y envío del pedido por WhatsApp al asesor elegido.
- **Ver más** abre la ficha pública cuando hay descripción, imágenes o contenido ampliado: lupa 3×, visor a pantalla completa, video (YouTube o archivo), tutorial, especificaciones y botón **Compartir** (sin nombre ni URL de la tienda).
- Control de apariencia **Sistema / Claro / Oscuro** conservando el color de acento de la tienda.

### RemHub Social: campañas

- Se gestionan en **Dashboard → RemHub Social → Campañas** (búsqueda, filtros, orden y activación rápida; requiere portada para ser visible).
- El catálogo las obtiene vía `/api/catalog/[slug]/campaigns` (`is_public = true`, tiendas activas). En **mayor** solo tras validar la clave mayorista.
- Las portadas reemplazan el banner en un carrusel accesible (pausa, navegación, respeta *reduced motion*), con aviso de campaña una vez al día por tienda y navegador.
- La preparación de publicaciones sociales está desactivada temporalmente; no hay publicación automática ni redes conectadas.

## Despliegue

El proyecto está pensado para [Vercel](https://vercel.com): conecta el repositorio, define las variables de entorno y despliega. Después del primer despliegue, configura las URLs de webhook/callback de Wompi y Addi con el dominio de producción.
