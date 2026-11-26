# Auditoría de rendimiento, costos y seguridad de RemHub

Historial verificable: cada ronda dice qué se midió, cómo, qué cambió y qué quedó pendiente. Los números salen de mediciones; lo que no se pudo medir se marca así. Las reglas que deben cumplir los cambios futuros están en `CLAUDE.md` («Rendimiento, costos y seguridad»).

---

## Ronda 2 · 2026-11-26

### Cómo se midió

- **JS que descarga cada página:** builds de producción en el mismo equipo, medidos con `scripts/perf/bundle-size.mjs`.
  - Suma los chunks del manifiesto de cada página más los archivos raíz, comprimidos con gzip nivel 9 (también da brotli).
  - Mediciones: antes (Next 16.3.8, commit d39a1e6 + 20261344), con los cambios (16.3.8) y final (16.4.6).
- **Producción (remhub.co):** unas pocas peticiones de solo lectura con `curl`, para ver la compresión, la caché y el TTFB. No fue prueba de carga.
- **Código:** barrido estático de suscripciones Realtime, temporizadores, escuchas, `select("*")` y consultas dentro de bucles (script con conteo de llaves). Se revisó a mano lo que salió.
- **Base de datos:** no se midió en producción en esta ronda; los datos de la ronda 1 son de 2026-10. Quedó lista la consulta `supabase/scripts/consulta_rendimiento_4.sql`: una sola consulta de solo lectura, validada contra la base de prueba.
- **Pruebas:** `npm test` (334 pruebas), `tsc`, `eslint` en lo tocado, build de producción y prueba de humo con `next start` local (páginas, encabezados y un catálogo real).

### Estado inicial (lo encontrado)

| Hallazgo | Evidencia |
|---|---|
| El layout raíz metía el cliente de Supabase (~48 kB gzip) en TODAS las páginas. Lo usaba solo el tema por cuenta, que no hace falta para pintar. | El chunk con `GoTrueClient` aparecía en la página más simple (`/tienda-pausada`, 228 kB). |
| El catálogo, la ficha de producto y el buscador del catálogo también importaban Supabase directo, aunque la primera vista llega armada del servidor. | Rastreo de imports: `CatalogClient → CatalogFinder → supabase/client`. |
| Next.js 16.3.8 tenía 2 vulnerabilidades críticas (ejecución remota de código: optimización de imágenes con SVG y `use cache`), 1 alta y 6 moderadas. | `npm audit --omit=dev`. El sitio usa `next/image` y `unstable_cache`. |
| Las tarjetas (catálogo, más vendidos, POS, buscador, listas del panel) descargaban la foto de 1.600 px para mostrarla a 150–300 px. | Es lo que más pesa en el Cached Egress de Storage (123 de 250 GB en 2026-11). |
| 6 bucles esperaban una consulta tras otra con N chico (puntos, categorías, pedidos, productos). | Barrido N+1: precios por punto al trasladar, promociones del POS, vista previa del crédito interno, límite de precio a todos los puntos, completar pedidos en lote, marcar «Nuevo». |
| Los íconos de `public/` se revalidaban en cada visita. | Respondían `Cache-Control: public, max-age=0, must-revalidate`. |
| La fuente monoespaciada se precargaba en todas las páginas y solo se usa en el panel. | El HTML de inicio en producción traía 2 precargas `.woff2`. |
| No había control del peso del JS: una importación de más pasaba sin aviso. | Next 16 ya no imprime los tamaños en el build. |

Lo que ya estaba bien, verificado y sin tocar:

- **Compresión y caché del JS:** Brotli en HTML y JS, y `/_next/static` con `max-age=31536000, immutable`.
- **Caché de páginas:** el inicio sale de la caché de Vercel (HIT); las páginas privadas van con `no-store`.
- **Fuentes:** `next/font` las sirve desde el propio dominio con `display: swap`.
- **Limpieza de efectos:** todas las suscripciones de Realtime, `setInterval` y escuchas se limpian. Los «sin limpiar» del barrido son globales que se crean una vez, a propósito, o escuchas sobre elementos de una ventana que se destruye.
- **Búsquedas:** espera al escribir en 20 buscadores (`src/lib/search-timing.ts`); el lector de códigos va casi al instante (150 ms).
- **POS:** bloqueo de doble clic, llave de idempotencia, revisión de existencias contra la base antes de guardar y ventas sin conexión con identificador propio.

### Cambios hechos

1. **Supabase sin frenar las páginas públicas.**
   - `src/lib/supabase/lazy.ts`: `supabaseLazy()` es el mismo cliente, pero llega en un archivo aparte.
   - Archivos que lo usan:
     - tema por cuenta (`lib/appearance/store.ts`);
     - catálogo (`CatalogClient`, `CatalogFinder`);
     - landing (`LandingView`);
     - inicio (`PricingSection`, `Showcase`);
     - carrito (`CartDrawer`, `CartExtras`) y «Avísame» (`NotifyMe`).
   - El panel no cambia: ya lo carga de entrada.
2. **Next.js 16.3.8 → 16.4.6** (y `eslint-config-next`). Quedan 0 vulnerabilidades en las dependencias de producción. Va en un commit aparte para poder revertirlo solo.
3. **Miniaturas de fotos (apagadas hasta que se activen).**
   - `src/lib/images/thumb.ts`: la miniatura va junto a la foto, en `<ruta>.v<versión>.thumb.webp`, con la versión del `?t=` de la dirección. Así una foto reemplazada nunca muestra una miniatura vieja ni hace falta sobrescribir archivos de otro dueño.
   - `ThumbImg` vuelve sola a la foto grande si falta la miniatura, también si falló antes de que la página despertara.
   - Se usa en las tarjetas del catálogo, más vendidos, relacionados, campañas, categorías, el POS, el buscador de productos y la miniatura ampliable del panel.
   - Las subidas nuevas (`ImageUpload` y la creación rápida de productos) suben su miniatura solas.
   - Las fotos que ya existen: `npm run images:thumbs` solo mira; con `-- --aplicar` crea las miniaturas y con `-- --quitar` las borra.
   - Se activa con `NEXT_PUBLIC_IMAGE_THUMBS=1` en Vercel.
4. **Consultas en paralelo con límite.** `src/lib/net/map-limit.ts` (`mapLimit`, en orden y con errores por elemento, con pruebas) en los 6 bucles. Cambio de comportamiento en «Aplicar a todos los puntos» (límite de precio): antes paraba en el primer error y dejaba los demás puntos sin guardar; ahora guarda todos los que puede y dice cuáles fallaron.
5. **Caché de 1 día para los íconos de `public/`** (`max-age=86400, stale-while-revalidate=604800`), verificada con `next start`. Los nombres no llevan versión: un ícono cambiado se ve al día siguiente.
6. **Fuente monoespaciada sin precarga** (`preload: false`): las páginas públicas no la descargan.
7. **Presupuesto de JS por página.**
   - `scripts/perf/bundle-size.mjs` corre solo al terminar `npm run build` (postbuild) y falla si una página pasa `scripts/perf/bundle-budget.json` (lo medido + 8 %).
   - `npm run perf:bundle` muestra todas las páginas; `--write-budget` rehace el presupuesto.
   - `PERF_BUDGET=warn` lo deja pasar avisando.
   - Probado: sale 1 al pasarse y 0 con `warn`.
8. **Diagnóstico de la base listo:** `supabase/scripts/consulta_rendimiento_4.sql` (ver «Pendiente»).
9. **Reglas para cambios futuros** en `CLAUDE.md`.

### Resultados: JS inicial (kB gzip, build de producción)

| Página | Antes (16.3.8) | Con los cambios (16.3.8) | Final (16.4.6) | Cambio |
|---|---:|---:|---:|---:|
| Catálogo `/[slug]/[mode]` | 300,6 | 253,3 | 251,4 | −16 % |
| Ficha de producto | 262,4 | 215,1 | 213,7 | −19 % |
| Landing `/[slug]/oferta/[page]` | 271,0 | 222,8 | 222,1 | −18 % |
| Página de la tienda `/[slug]` | 232,3 | 184,2 | 183,6 | −21 % |
| Inicio `/` | 306,5 | 258,4 | 256,9 | −16 % |
| Login | 255,4 | 255,5 | 254,2 | −0,5 % |
| Panel `/dashboard` | 343,3 | 343,4 | 340,1 | −0,9 % |
| POS | 429,2 | 430,3 | 425,5 | −0,9 % |
| Pedidos (la más pesada) | 483,0 | 484,2 | 478,4 | −1,0 % |
| Compartido por todas (raíz) | 127,8 | 127,8 | 129,2 | +1,1 % |

- En las 32 páginas que no son del panel ni de admin, el promedio bajó de 243,8 a 227,4 kB con los cambios.
- El panel casi no cambia (+~1 kB por miniaturas y `mapLimit`, compensado por 16.4.6): ya cargaba Supabase de entrada.
- **No medido:** LCP, INP y CLS reales. Speed Insights solo está en las páginas públicas (decisión de costos de la ronda 1); hay que mirarlo en Vercel unos días después de desplegar y compararlo con la ronda 1 (LCP 4,8 s en escritorio y 3,7 s en celular; INP 301 ms en celular).

### Producción (lectura puntual, 2026-11-26, desde Colombia)

- **Inicio:** HTML en caché de Vercel (HIT), Brotli, TTFB ~0,63 s, 30 kB.
- **Login:** sin caché (privado), TTFB ~0,51 s.
- **Región:** funciones en `iad1` (EE. UU. este; `vercel.json` no fija región). La región de la base no se ve desde el código; el Supabase de la ronda 1 respondía bien desde ahí (catálogos de 40–67 ms en la base). Mirarla en Supabase → Settings → General; si no es `us-east-1`, ver «Requiere autorización».

### Estado de las 25 optimizaciones

Clasificación: ✅ correcta · 🟡 parcial · ❌ no implementada · ➖ no aplica · 🔎 pendiente de verificar. Prioridad: C crítica · A alta · M media · B baja.

| # | Optimización | Estado | Prioridad | Qué hay / qué se hizo |
|---|---|---|---|---|
| 01 | Esqueletos de carga | ✅ | B | `SkeletonList` en 69 archivos, `dashboard/loading.tsx`. Las páginas públicas llegan armadas del servidor. |
| 02 | Imágenes WebP/AVIF | 🟡 | A | WebP de 1.600 px al subir (ronda 1). Esta ronda: miniaturas de 480 px, listas para activar. `next/image` solo en el inicio. AVIF no: el lienzo del navegador no lo genera en todos los equipos. |
| 03 | Llamadas duplicadas | 🟡 | M | Caché de funciones públicas (`CartExtras`), una sola conexión de Realtime, `unstable_cache` del catálogo. Sin librería de caché global (no se justificó). |
| 04 | Espera en búsquedas | ✅ | — | `search-timing.ts` en 20 buscadores; ignora respuestas viejas; lector de códigos casi al instante. |
| 05 | Paginación | 🟡 | M | Productos, catálogo (30 + «cargar más»), kardex (500), historiales con `limit`. Falta revisar una por una las listas del panel que traen todo. |
| 06 | Estáticos por CDN | ✅ | — | Vercel: `/_next/static` inmutable 1 año; íconos ahora con 1 día; fotos de Storage con 1 año. |
| 07 | Trabajos en segundo plano | 🟡 | B | Crons de Vercel (avisos, cierres). Las importaciones y exportaciones corren en el navegador con progreso. No se agregó cola: no hubo evidencia de bloqueos. |
| 08 | Consultas N+1 | 🟡 | M | 6 bucles pasados a paralelo con límite. Quedan en serie: las ventas sin conexión (a propósito: el orden importa) y, sin revisar a fondo en esta ronda, borrar productos e importar de Excel (avanzan con progreso por fila) y las rutas de cron que envían avisos. |
| 09 | Brotli/Gzip | ✅ | — | Verificado en producción (`Content-Encoding: br`). |
| 10 | Peticiones en paralelo | 🟡 | M | `Promise.all` en general; `mapLimit` nuevo para listas. |
| 11 | Índices | 🔎 | A | Ronda 1: índices duplicados y sin uso quitados (20261203, 20261274) e índices de FK. Esta ronda: sin datos nuevos; correr `consulta_rendimiento_4.sql`. |
| 12 | Monitoreo | 🟡 | M | Speed Insights en lo público; `pg_stat_statements` con la consulta 4. No hay trazas del servidor ni errores del navegador centralizados (ver «Requiere autorización»). |
| 13 | Cercanía servidor-base | 🔎 | M | Funciones en `iad1`; falta confirmar la región de Supabase. |
| 14 | SSR/SSG | ✅ | — | Catálogo armado en el servidor (ronda 1), inicio en caché, metadatos y píxel en `unstable_cache`. El panel sigue en el cliente, a propósito. |
| 15 | Scripts de terceros | ✅ | — | GTM, Analytics y Speed Insights solo en páginas públicas (ronda 1), con `next/script`. |
| 16 | JS por página | ✅ | A | Ronda 1: −30 a −60 %. Esta ronda: −16 a −21 % en lo público y presupuesto en el build. |
| 17 | Virtualización | ❌ | B | No se implementó: las listas grandes van paginadas o con «ver más». Una lista virtual rompe la búsqueda del navegador y el teclado en los formularios de conteo; solo con medición de una lista lenta. |
| 18 | Solo columnas necesarias | ✅ | B | `select("*")` aparece 18 veces, casi todas de una fila en el servidor; el navegador pide columnas. |
| 19 | Pool de conexiones | ➖ | — | No hay conexiones directas a Postgres: todo va por PostgREST/Supabase, que maneja el pool. |
| 20 | Renderizados | 🟡 | B | React Compiler activo (`reactCompiler: true`) memoiza solo. No se perfiló con React Profiler (sin navegador en esta ronda). |
| 21 | Caché del navegador | ✅ | — | Privado con `no-store`; fotos y estáticos versionados; existencias y precios para vender se leen de la base. |
| 22 | Varias instancias | 🟡 | M | Funciones sin estado (Vercel). Excepción: el freno de peticiones (`lib/server/rate-limit.ts`) cuenta por instancia; frena ráfagas, pero no es un límite global. |
| 23 | Fuentes | ✅ | — | `next/font` (WOFF2 propio, `swap`); monoespaciada ahora sin precarga. |
| 24 | Medición real | 🟡 | A | Laboratorio: tamaños por build (este documento). Usuarios reales: Speed Insights por revisar después del despliegue. |
| 25 | Celulares y redes lentas | 🟡 | M | `lite-device.ts`, vidrio reducido en equipos sencillos, modo sin conexión del POS. Esta ronda: menos JS en lo público y miniaturas. No se probó en un celular real. |

### POS e inventario

- **Revisado en el código, no se cambió:** venta atómica en la base, idempotencia, doble clic bloqueado, revisión de existencias contra la base antes de guardar, ventas sin conexión con ID propio en orden, y devoluciones y créditos con pruebas SQL (20261334, 20261335).
- **No simulado:** varios vendedores vendiendo el mismo producto a la vez. La base de prueba (PGlite) tiene una sola conexión y no puede simular concurrencia real. Hace falta una base de pruebas con Postgres de verdad (ver «Requiere autorización»).

### Aislamiento entre empresas

- **En las pruebas:** las funciones revisan tienda, permiso y punto, y lo comprueban `seguridad`, `permisos`, `search_path`, `funciones_sin_sesion`, `vistas_seguras` y `candado_tablas` en `npm run test:sql`.
- **En producción:** `consulta_rendimiento_4.sql` lista las tablas de `public` sin RLS que `anon` o `authenticated` pueden leer, y las funciones `security definer` sin `search_path`. Las dos listas deben salir vacías.
- **En el navegador:** el tema por cuenta borra lo privado al cerrar sesión (`onUser(null)`), igual que antes.

### Costos

- **Fotos:** con las miniaturas activas, una tarjeta baja de ~100–300 KB a ~20–40 KB (estimado por el tamaño de 480 px en WebP). El script imprime el ahorro real al aplicarlo. No se puede dar el porcentaje del Egress sin medir unos días con la variable puesta (Supabase → Usage → Cached Egress).
- **Supabase diferido:** en lo público, unos 48 kB menos por primera visita y por visita sin caché. En transferencia de Vercel es pequeño frente a las fotos.
- **No se cambió ningún servicio ni plan.**

### Requiere configuración o autorización

1. **Miniaturas:**
   - `npm run images:thumbs` para mirar.
   - `npm run images:thumbs -- --aplicar` para crearlas. Usa la llave de servicio de `.env.local`, lee una vez cada foto y sube ~2.500 archivos pequeños.
   - Después, `NEXT_PUBLIC_IMAGE_THUMBS=1` en Vercel y desplegar de nuevo.
2. **Diagnóstico de la base:** correr `supabase/scripts/consulta_rendimiento_4.sql` y mandar el resultado, para decidir índices y las funciones más lentas. Después de desplegar, se puede reiniciar las estadísticas con `select pg_stat_statements_reset();`.
3. **Región:** confirmar la de Supabase. Si no es `us-east-1`, mover las funciones de Vercel a la misma región (`"regions"` en `vercel.json`): es un cambio de infraestructura.
4. **Límite global de peticiones** con varias instancias: haría falta un almacén compartido (Vercel KV/Upstash, de pago).
5. **Errores del navegador y trazas del servidor centralizados:** Sentry o similar, de pago, o una tabla propia con muestreo.
6. **Pruebas de carga** (10–1.000 usuarios) y de ventas simultáneas: solo contra un proyecto de Supabase de pruebas, nunca producción. Hoy no existe uno.

### Riesgos y límites de esta ronda

- No se probó en un navegador ni en un celular. Lo nuevo del lado del cliente está cubierto por tipos, lint, pruebas unitarias y la prueba de humo del servidor.
  - Carga diferida de Supabase.
  - `ThumbImg`, que con la variable apagada se comporta como un `<img>` normal.
- **Primera interacción en el catálogo:** si alguien busca antes de que llegue el archivo de Supabase, espera ese archivo una vez (~48 kB, en paralelo desde que abre la página).
- **Next 16.4.6:** el build y las pruebas pasan. Si algo raro aparece en producción, se puede revertir ese commit solo.

### Recomendaciones de mantenimiento

- Mantener el presupuesto de JS. Cada vez que se suba, explicar por qué en el commit.
- Correr `consulta_rendimiento_4.sql` cada 1–2 meses y anotar aquí lo hallado.
- Revisar Speed Insights (p75 de LCP, INP y CLS) del catálogo y las landings después de cada entrega grande.
- Cuando haya un Supabase de pruebas, agregar las pruebas de concurrencia del POS y las de carga.
- Lo siguiente con más impacto probable:
  1. activar las miniaturas;
  2. revisar las 3 consultas más costosas de `pg_stat_statements`;
  3. bajar el JS de `/dashboard/pedidos` (478 kB), la página más pesada.

---

## Ronda 1 · 2026-10 / 2026-11 (resumen)

El detalle está en la memoria del proyecto y en los commits de esas fechas.

- **Base:** `pg_stat_statements` mostró `catalog_public_products` en ~511 ms y la búsqueda en ~342 ms. Se preparó la búsqueda una sola vez (20261204) y quedaron en 40–67 ms (catálogo) y 57–165 ms (búsqueda).
- **Índices:** se quitaron los duplicados (20261203) y los de texto que no se usaban, ~50 MB (20261274), los dos con vuelta atrás (`erp_restore_dropped_indexes()`).
- **Catálogo y metadatos:** catálogo armado en el servidor, y `unstable_cache` de metadatos y vitrina (0,73 s → 0,02 s en la segunda visita).
- **Realtime y scripts de terceros:** una sola conexión de Realtime en el panel; GTM y Vercel Analytics solo en lo público.
- **Fotos:** WebP de 1.600 px al subir y `scripts/optimizar-imagenes.mjs` para las viejas.
- **JS inicial** (commit 66b8fc4): panel 314 → 212 kB, POS 380 → 268 kB, inventario 459 → 188 kB, catálogo 234 → 168 kB.
  - Esos números se midieron por source map y no se comparan directo con los de la ronda 2, que suman los chunks completos por página.
