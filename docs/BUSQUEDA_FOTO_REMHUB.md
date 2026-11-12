# Búsqueda por foto en RemHub

Busca productos con una foto: por cómo se ve (huella de la imagen) y por el texto que tenga (código, marca, modelo).

## Cómo funciona

1. **La foto se toma dentro de RemHub** (`src/components/product-finder/PhotoCamera.tsx`).
   - Antes se abría la app de cámara del celular. En celulares con poca memoria, Android cerraba el navegador mientras tanto, y la foto se perdía.
   - La resolución es moderada: 720p, o 480p en celulares lentos.
   - Tiene enfoque continuo, tocar para enfocar, linterna 🔦 y zoom ×2 cuando la cámara los trae.
   - Un recuadro muestra lo que mira el modelo: el cuadrado del centro.
   - La cámara se apaga si se sale de la app.
   - Si no hay permiso, hay un botón para usar la cámara del celular.
2. **La foto se reduce a 256×256** antes de analizarla (`prepareModelInput` en `src/lib/image-search/embed.ts`).
   - Ocupa unos 15 KB.
   - Cuando el navegador lo permite, no se abre completa en memoria.
3. **Se calcula su huella con MobileCLIP S0.** Son 512 números, calculados en uno de dos lugares:
   - **En el equipo:** el modelo, de unos 23 MB, se descarga una vez y queda guardado. Lo usan los computadores y los celulares buenos que ya lo tienen.
   - **Modo liviano (`/api/photo-embed`):** el celular manda la foto pequeña y RemHub devuelve la huella.
     - Es el mismo modelo, fijado por versión y comprobado con SHA-256, así que coincide en un 99 % con la del navegador.
     - Tarda unos 0,3 s por foto. La primera vez que arranca la instancia tarda unos 3 s más, porque descarga el modelo.
     - Lo usan:
       - los celulares lentos;
       - quien lo active a mano;
       - la primera búsqueda de un celular bueno, mientras el modelo se descarga sin afán para la siguiente;
       - cualquier equipo si el modelo local falla o tarda más de 25 s.
4. **Se lee el texto de la foto con Tesseract.**
   - En equipos buenos se hace al mismo tiempo que la huella.
   - En celulares lentos, solo con el botón «Leer el texto de la foto».

## Cuándo un equipo es «lento» (`src/lib/image-search/device.ts`)

- 2 GB de memoria o menos, o 4 núcleos o menos.
- El navegador no tiene WebAssembly SIMD (Safari anterior a 16.4, Chrome anterior a 91).
- La pestaña se cayó la última vez que analizó una foto en ese equipo. Esto se recuerda 14 días.

Con **ahorro de datos** o con **red 2G o 3G** no se descarga nada en segundo plano.

## Ruta `/api/photo-embed`

- Recibe JPEG, PNG o WebP de hasta 400 KB y responde `{ ok, embedding }`.
- No guarda la foto.
- Freno: 60 fotos por minuto por IP. Al analizar las fotos del catálogo, espera lo que pide el servidor y sigue.
- Usa `onnxruntime-web` (wasm, un solo hilo).
- `next.config.ts` lleva a esa ruta solo `ort.node.min.mjs` y `ort-wasm-simd-threaded.{mjs,wasm}`, unos 15 MB, y deja fuera los archivos de navegador, que pesan más de 100 MB.
- Pruebas: `tests/image-search/photo-embed-route.test.ts`.

## Analizar las fotos de los productos (`indexer.ts`)

- Usa el mismo motor: el del equipo en computadores y el modo liviano en celulares lentos.
- Una foto rota se marca para no reintentarla.
- Si falla el modelo o el servidor, el análisis se detiene y se guarda lo hecho. Antes, una falla del modelo podía marcar fotos buenas como rotas.
