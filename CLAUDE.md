@AGENTS.md

## REM (asistente de voz): mantenimiento

REM no usa IA: entiende con reglas (src/lib/rem y src/lib/voice). Arquitectura y estado: docs/REM_ARQUITECTURA.md. Al tocar cualquier módulo del panel, revisa si REM también cambia:

- **Página nueva o movida:** agrégala a src/lib/search-index.ts (permisos + sinónimos). Si es un módulo nuevo, también a src/lib/rem/modules.ts, con un «para qué sirve» que diga lo que la pantalla hace de verdad. Las páginas de detalle van en src/lib/rem/routes.ts.
- **Cambió lo que hace una pantalla:** actualiza su `about` y sus `howto` en modules.ts. Los pasos solo se escriben leídos en el código (`verified: true`); si no, sin pasos.
- **Después de cambiar el catálogo:** corre `npm run rem:catalog` (regenera docs/REM_CAPACIDADES.md) y `npm test`. tests/rem/catalog-sync.test.ts falla si hay páginas o permisos desincronizados.
- **Acción nueva de REM:** solo en src/lib/rem/actions.ts, con riesgo, confirmación, permisos, validación y pruebas en tests/rem.
  - Las consultas usan funciones de la base que revisan tienda, permiso y puntos.
  - Riesgo alto: «Di sí o no» con el registro exacto. Crítico: no por voz.
  - Nunca `service_role` ni datos inventados.
- **Consulta o formulario por voz nuevo:** agrégalo también a `INTENT_CAP` en src/lib/rem/suggest.ts, para que «¿Quisiste decir…?» revise sus permisos antes de sugerirlo.
- **Frase que REM no entiende:** se arregla con su prueba en tests/voice o tests/rem. No dupliques reglas entre src/lib/voice y src/lib/rem.

## Rendimiento, costos y seguridad: reglas para todo cambio

Historial, mediciones y lo pendiente: docs/PERFORMANCE_AUDIT.md. Lo que se mide se compara con un build de producción, nunca a ojo.

- **Peso del JS:** `npm run build` corre al final `scripts/perf/bundle-size.mjs` (postbuild) y falla si una página pasa su presupuesto (scripts/perf/bundle-budget.json, kB gzip). No subas el presupuesto para que pase: primero busca qué se importó de más. Si el aumento es justo, rehazlo con `node scripts/perf/bundle-size.mjs --write-budget` y dilo en el commit. Para un despliegue urgente: `PERF_BUDGET=warn`.
- **Páginas públicas (catálogo, landing, ficha de producto, inicio) y todo lo que va en el layout raíz (`app/layout.tsx`, `providers.tsx`, ThemeControl, PwaProvider):** nunca importes `@/lib/supabase/client` directo; usa `await supabaseLazy()` (src/lib/supabase/lazy.ts). La primera vista llega del servidor y Supabase (~48 kB) llega aparte.
- **Librerías pesadas solo bajo demanda** (`next/dynamic` o `import()`): Excel, PDF, QR, códigos de barras, onnx, editores, ventanas y pestañas grandes. SweetAlert siempre desde `@/lib/swal`; framer como `import { m as motion }`. Lo que el POS usa sin internet se precarga con `preloadWhenIdle` (src/lib/idle-preload.ts).
- **Fotos:** en tarjetas y listas usa `<ThumbImg>` (src/components/ui/ThumbImg.tsx: miniatura de 480 px con vuelta a la original); en grande, la original. Las subidas a `product-images` y `category-images` pasan por `ImageUpload` o llaman `uploadThumb` (src/lib/images/thumb-upload.ts). Siempre `loading="lazy"` fuera de la primera pantalla y el `fetchPriority="high"` solo para la imagen principal.
- **Consultas:**
  - Independientes, en paralelo: `Promise.all` o `mapLimit(items, 3–6, fn)` (src/lib/net/map-limit.ts). Nunca `await` uno por uno dentro de un `for`, salvo que el orden importe (ventas sin conexión, borradores del POS).
  - Pide solo las columnas que usas: nada de `select("*")` en el navegador.
  - Pagina con `range`: PostgREST corta en 1.000 filas.
  - Búsquedas con `useSearchValue`/`searchDelay` (src/lib/search-timing.ts). El lector de códigos va casi al instante; no le pongas espera.
- **Efectos:** todo `setInterval`, `addEventListener`, canal de Realtime o `setTimeout` largo se limpia en el `return` del efecto. Realtime: una sola conexión en el panel (StockRequestWatcher reparte el evento); no abras canales nuevos sin necesidad.
- **Caché:** lo privado nunca va en cachés compartidas (`/api/*` privadas con `private, no-store`, ver next.config.ts). Existencias, saldos y precios para vender o cobrar se leen de la base en el momento (el POS ya revisa contra la base antes de guardar); la caché del navegador es solo para mostrar.
- **Base de datos:**
  - Índices nuevos solo con evidencia: pg_stat_statements con supabase/scripts/consulta_rendimiento_4.sql, que es una sola consulta de solo lectura.
  - Nunca desactives RLS ni uses `service_role` en el navegador.
  - Toda función `security definer` lleva `set search_path = public` y revisa tienda, permiso y punto.
- **Escritura masiva o críticas** (ventas, traslados, ajustes, cobros): atómicas en una función de la base, con llave para no repetir (idempotencia) y el botón bloqueado mientras guarda.
