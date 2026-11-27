# RemHub Label Studio (Etiquetas)

Diseño e impresión de etiquetas con QR y códigos de barras reales, en cualquier papel, sin depender de HereLabel.
Pantalla: **Productos → Etiquetas** (`/dashboard/etiquetas`). Migración: `20261347_etiquetas.sql`.

## Arquitectura

Todo el motor es TypeScript puro en `src/lib/labels/`. No usa el navegador ni la base, así que se prueba completo en `tests/labels`.

| Módulo | Qué hace |
|---|---|
| `types.ts` | Formato de plantilla versionado (`v: 1`) en **milímetros**: diseño de w × h mm con elementos texto, QR, código de barras, rectángulo, círculo, línea e imagen. Cada elemento tiene un id estable. |
| `data.ts` | Variables seguras `{nombre}`, `{referencia\|codigo}`, `{campo\|"texto"}`. Nunca ejecutan código ni muestran «undefined». Arma los datos de un producto, sin costos. |
| `text-fit.ts` | Ajuste de texto: saltos con Enter, saltos por palabra, máximo de líneas, letra que se achica sola y líneas parejas. Nunca corta una referencia, salvo que se active «Partir palabras». Si no cabe, avisa. |
| `codes.ts` | QR (`qrcode`) y barras (codificaciones de `jsbarcode`). Cada módulo mide un número **entero de puntos** a la resolución de la impresora (203 dpi: 1 punto = 0,125 mm). Revisión propia de caracteres por formato, porque la librería pasaba CODE39 a mayúsculas y tomaba «É» como control. Dígito GS1. Cuando el código no cabe, explica qué hacer y sugiere un QR. |
| `render.ts` | Un SVG en mm por etiqueta, el mismo para la vista previa, el diseñador y la impresión. Escapa todo el texto. Imágenes: solo https, rutas de RemHub o PNG, JPG, WEBP o GIF subidos; nunca SVG ni `javascript:`. Revisa elementos que se salen de la etiqueta. |
| `layout.ts` | Perfiles de papel (rollo u hoja), validación física, filas y columnas, posición inicial y documento de impresión con `@page` del tamaño exacto. |
| `templates.ts` | 10 plantillas de RemHub que se acomodan al tamaño de la etiqueta, y `normalizeDesign`, que limpia lo que llega de la base o de un archivo. |
| `measure-browser.ts` | Mide el texto con el lienzo del navegador, con la misma letra que se imprime. |

Pantalla en `src/app/dashboard/etiquetas/`:

- `page.tsx`: pestañas Imprimir, Plantillas, Impresoras e Historial, y los enlaces de entrada.
- `PrintPanel.tsx`: modo rápido y masivo.
- `Designer.tsx`: diseñador. Se carga solo al abrirlo.
- `TemplatesPanel.tsx`, `ProfilesPanel.tsx`.
- `library.ts`: base de datos y preferencias de cada equipo.
- `products.ts`: productos, precios del punto, ingresos y traslados.

### Base de datos (20261347)

Todas las tablas tienen RLS por tienda, y la migración quita los permisos que Supabase da por defecto a `authenticated` antes de conceder los necesarios.

| Tabla | Para qué |
|---|---|
| `label_templates` | Plantillas, con tope de 700 KB por diseño. Un disparador guarda la versión anterior en `label_template_versions` (las últimas 30). |
| `label_printer_profiles` | Papel e impresora. |
| `label_print_jobs` | Historial. Solo «generado» o «enviado»: nunca «salió bien en papel». |

Funciones:

- `label_set_default(kind, id)`: deja una sola plantilla o perfil predeterminado por tienda, en un solo paso.

Quién puede hacer qué:

| Acción | Permiso |
|---|---|
| Ver plantillas e impresoras, imprimir y registrar en el historial | Permisos de la Lista general (`products_view`, `products`, `inventory`, `stock_requests`, `stock_requests_manage`, `transfers`, `pos`) |
| Crear y cambiar plantillas | `products` |
| Crear y cambiar impresoras | `products` o `inventory` |

## Decisiones

- **Se imprime con el controlador del sistema** (ventana de impresión, páginas del tamaño exacto). Funciona sin instalar nada y con cualquier impresora que tenga controlador.
- **No hay impresión ZPL directa todavía.** Una página web no puede usar una impresora USB que ya tiene controlador de Windows. Mandar ZPL exigiría un agente local o WebUSB con otro controlador (WinUSB), y eso no se ha probado.
- **Velocidad y oscuridad son una nota.** RemHub no las envía y no convierte el porcentaje del controlador en comandos.
- **Códigos alineados a puntos enteros.** Las posiciones de etiquetas y elementos se redondean al punto de la impresora. Si el código no cabe con módulos de al menos 1 punto, no se imprime: se explica y se sugiere un QR. El contenido nunca se recorta ni se cambia.
- **Rollo: cada fila es una página.** Por ejemplo, 102 × 25 mm con 3 etiquetas. La separación entre filas la pone el sensor de espacios de la impresora.
- **EAN, UPC e ITF-14 solo con códigos registrados en GS1.** La interfaz lo advierte y RemHub no inventa códigos comerciales.
- **Las etiquetas no llevan costos**: los productos se cargan sin columnas de costo.

## Registro de fases

| Fase | Estado |
|---|---|
| 1. Análisis, arquitectura, persistencia | ✅ Hecha: motor separado, migración con RLS, versiones y pruebas. |
| 2. QR y códigos de barras | ✅ CODE128 (auto, A, B, C), CODE39, EAN-13/8, UPC-A/E, ITF, ITF-14, Codabar, MSI y Pharmacode. Pendiente: Data Matrix, PDF417 y GS1-128 con identificadores de aplicación (la librería actual no los tiene). |
| 3. Diseñador | ✅ Mover y redimensionar con guías magnéticas y cuadrícula; selección múltiple; alinear y repartir; capas; bloquear y ocultar; deshacer y rehacer; copiar, cortar, pegar y duplicar; atajos; menú contextual; reglas en mm; zoom; vista de impresión; giro de 0, 90, 180 o 270°. Pendiente: agrupar y desagrupar, giro libre. |
| 4. Textos, imágenes, enlaces, variables | ✅ Textos de varias líneas, letra automática, líneas parejas, variables con valor alternativo, QR de enlace, WhatsApp, teléfono y correo; logo, foto del producto, imagen por enlace o subida. Pendiente: vCard, Wi-Fi, fechas de vencimiento o lote, campos personalizados del producto. |
| 5. Plantillas y perfiles | ✅ Guardar, guardar como, renombrar, favorita, predeterminada, archivar, restaurar, eliminar, exportar e importar en JSON validado, versiones, borrador automático y aviso al salir. Pendiente: plantillas por punto, categoría o usuario. |
| 6. Papel, columnas, vista previa, impresión | ✅ Rollo u hoja, columnas, márgenes, separaciones, calibración, posición inicial, vista por fila u hoja y descarga SVG de una etiqueta. Para PDF: «Guardar como PDF» en la ventana de impresión. |
| 7. Integración | ✅ Ficha del producto, traslado, Lista general (con cantidades), buscador Ctrl+K y REM. **Ingreso de factura:** al registrar o actualizar sale «🏷️ Imprimir todas», y en el historial «🏷️ Etiquetas» imprime de una vez una por unidad (`?ingreso=<id>&imprimir=1`: se imprime solo cuando todo cargó y no hay errores). Pendiente: POS y catálogo. |
| 8. Masivo, importación, historial | ✅ Hasta 5.000 etiquetas por trabajo (las iguales se dibujan una vez); historial con «Repetir». Pendiente: importar Excel o CSV para etiquetas libres. |
| 9. Seguridad y pruebas | ✅ 18 pruebas del motor (los QR y CODE128 se leen de vuelta desde el SVG impreso) y 26 de la base (aislamiento, permisos, versiones, topes). |
| 10. Pruebas físicas | ⏳ **Bloqueada hasta que la imprimas.** Ver abajo. |
| QR dinámicos (enlace estable con destino editable y estadísticas) | ⏳ Pendiente. Necesita una tabla de enlaces y una ruta de redirección con límites contra abuso. |
| Impresión ZPL directa o agente local | ⏳ Pendiente (ver Decisiones). |

## Imprimir con la STARPOS iF4 (203 dpi, rollo de 102 mm, 3 × 31×25 mm)

1. **Papel en el controlador de Windows.** En Panel de control → Dispositivos e impresoras → STAR-iF4 → Preferencias de impresión, crea un papel de **102 × 25 mm**. Usa «Etiquetas con espacios», orientación vertical y los márgenes en 0. Deja velocidad y oscuridad como las tienes en HereLabel.
2. **Impresora en RemHub.** En Etiquetas → Impresoras ya viene el perfil «STARPOS iF4 · 3 × 31×25 mm», con 2,5 mm de margen a los lados y 2 mm entre etiquetas. Toca «Guardar impresora» para que toda la tienda lo use.
3. **Alineación.** Toca «Imprimir prueba de alineación». En la ventana de impresión elige la STAR-iF4, el papel de 102 × 25, márgenes «Ninguno» y **escala 100 %** (nunca «Ajustar a la página»).
   - Si el borde de las etiquetas sale corrido, cambia «Ajuste horizontal» o «Ajuste vertical» en pasos de 0,2 mm (positivo mueve a la derecha o hacia abajo).
   - Repite la prueba hasta que el borde quede adentro de las tres etiquetas.
4. **Códigos.** Toca «Imprimir prueba de códigos»: salen W 0806 RYL018, SC11 W F, MALUMETA DE 6.5 PULGADAS RYL002, 12345678910, 0000123456 y un enlace. Pásales tu lector; cada uno debe leer exactamente ese texto.
5. **Uso diario.** Elige productos y cantidades, la plantilla y «Imprimir».

**La prueba física no se da por buena hasta que tú confirmes** que salió bien en papel y que el lector lee los códigos.
