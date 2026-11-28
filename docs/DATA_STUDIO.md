# RemHub Data Studio — seguimiento

Pedido «REMHUB DATA STUDIO PRO» (47 secciones, 27/11/2026): importar, exportar y Excel profesionales en todo RemHub. Se hace por fases; aquí quedan la revisión, lo hecho, lo verificado, lo pendiente y los límites.

## 1. Revisión (lo que había)

| Pieza | Dónde | Estado antes |
|---|---|---|
| Motor de Excel | `src/lib/data/xlsx.ts` | Propio, sin librerías: ZIP sin comprimir, encabezado en negrita y fijo, filtro. Sin tipos (todo número o texto), sin formatos de plata ni fechas, sin totales ni tablas. |
| Usos del motor | `/dashboard/datos` (13 exportaciones), auditoría de conteo, cuentas por pagar, informe de traslados, radar, contador, nómina y préstamos | 10 lugares. |
| CSV | ~20 pantallas (rentabilidad, caja, gastos, existencias, fiscal…) | CSV propios por pantalla. |
| Importar | `/dashboard/datos` (7 temas: terceros, proveedores, categorías, cartera y cuentas por pagar iniciales, conteo) y `/dashboard/products/importar` | Revisan contra la base y muestran fila por fila; el de productos leía solo la primera hoja. |
| Lector | `read-excel-file` (dependencia existente) + `src/lib/data/read-table.ts` | Entiende $ 12.500, DD/MM/AAAA, fechas de Excel, Sí/No. |

## 2. Decisiones

1. **Sin librería nueva**: se amplió el motor propio. ExcelJS/SheetJS no hacen falta para lo pedido y suman ~250 kB; el motor propio pesa poco y se carga solo al exportar. Tablas dinámicas y segmentadores **no** se hacen (ninguna librería libre los escribe bien): se documenta como límite.
2. **Compatibilidad**: `XSheet`, `buildXlsx`, `downloadXlsx`, `xDate` siguen iguales; todos los Excel existentes mejoran sin tocarlos (tipos inferidos por el encabezado).
3. **Reimportar**: las hojas de datos dejan el encabezado en la fila 1. La portada «Resumen» va primero, y los importadores eligen la hoja por su nombre o sus columnas (`pickSheet`), nunca la portada.
4. **Seguridad**: los textos se escriben como texto literal (un nombre con «=» no se vuelve fórmula en el .xlsx); `csvSafe` para CSV; solo enlaces `https`.
5. **Verificación con Excel real**: los ejemplos se abren con Microsoft Excel por automatización (solo lectura) y se revisan los valores, los formatos y las imágenes de cada hoja.

## 3. Fases

| Fase | Estado | Qué |
|---|---|---|
| 1. Revisión | ✅ | Sección 1. |
| 2-3. Motor profesional | ✅ | Ver §4. |
| 4. Selector de columnas y plantillas | ⏳ | Asistente de exportación (columnas, orden, nombres, formato, tema) y plantillas guardadas. |
| 5-6. Importación, actualización masiva y simulación | ⏳ | Asociar columnas, simular, ver antes y después, aplicar solo lo confirmado (productos primero). |
| 7. Integración en módulos | 🟡 | Hecho: todo lo que usa el motor (10 lugares) mejora solo; portada en «Importar y exportar». Falta: pasar los CSV a Excel donde convenga. |
| 8. Imágenes, enlaces, QR | 🟡 | El motor ya pone fotos (sin deformar, la misma foto una sola vez) y enlaces. Falta llevarlo a las exportaciones de productos/catálogo. |
| 9. Resumen y gráficos | 🟡 | El motor ya hace la hoja «Resumen» con indicadores (fórmulas) y gráficos nativos (columnas, barras, líneas, torta). Falta en los informes. |
| 10-12. Masivo, móvil, automático, pruebas finales | ⏳ | |

## 4. Motor de Excel (hecho y verificado)

`src/lib/data/xlsx.ts` — `buildXlsx`/`buildXlsxAsync`/`downloadXlsx` con `{ sheets, meta }`:

- **Tipos**: referencia, código de barras, NIT, teléfono → texto (`@`, sin perder ceros ni pasar a 1E+15; sin el triángulo verde de «número como texto»). Plata → número con `"$"#,##0` (negativos en rojo). Cantidades → `#,##0`. Fechas → fecha real (`dd/mm/yyyy`, con hora si la tiene, hora de Colombia). Porcentaje → `0.0%`.
- **Tabla nativa** con filtros y orden, encabezado fijo, filas alternadas por formato condicional (siguen bien al ordenar), anchos por contenido (nombres largos en varias líneas; Excel ajusta el alto solo).
- **Totales** al pie con `SUBTOTAL(109, Tabla[Columna])`: respetan los filtros. Solo donde sumar tiene sentido (valores, saldos, cantidades; no precios ni costos unitarios).
- **Fórmulas por fila** con valor ya calculado; el libro se recalcula al abrir.
- **Formato condicional** por columna (menor, mayor, entre, vacío, contiene) con tonos bad/good/warn/info/muted; siempre con el valor o texto visible (no solo color).
- **Listas desplegables**, **enlaces** (solo https), **impresión** (horizontal si hay muchas columnas, ajustado al ancho, encabezado repetido, «Página X de Y», nombre de la empresa y fecha).
- **Resumen**: título, empresa, fecha real de generación, quién, filtros, indicadores con fórmulas, índice de hojas con enlaces y notas.
- **Fotos** dentro de la celda (sin deformar; la misma foto se guarda una vez) y **gráficos** nativos ligados a los datos.
- **Temas**: Amethyst, Profesional, Minimalista, Corporativo, Azul empresarial, Verde financiero, Blanco y negro, o un color propio.
- **Compresión** deflate en el navegador: archivos ~4 veces más livianos.

### Verificado en Microsoft Excel (27/11/2026)

`npm run excel:samples` genera `docs/ejemplos-excel/*-PRUEBA.xlsx` con datos de prueba. Abiertos con Excel por automatización:

- Los 5 abren sin «reparar». Excel ve las tablas (con fila de totales), las reglas de formato condicional, los enlaces, el gráfico y las 6 fotos.
- `00001234` y `0012345678905` siguen como texto; `$61,000` es número; `=E2*F2` da `$2,562,000`; el margen `=IF(G2=0,"",(G2-F2)/G2)` da `31.5%`; `SUBTOTAL(109,[Unidades])` da 208.
- Indicadores del resumen calculados por Excel; conteo «Falta» en rojo con diferencia en plata; `SUMIF` entre tablas en el traslado por cajas; listas desplegables «Belleza, Cocina…» y «Sí, No».
- Un nombre muy largo queda en 3 líneas (Excel ajusta el alto de la fila).
- Lo exportado se vuelve a leer con el lector de los importadores (prueba `tests/data/xlsx.test.ts`).

No verificado todavía: LibreOffice y Google Sheets (no instalados aquí), abrir en celular.

## 5. Límites reales

- Tablas dinámicas y segmentadores: no (se puede filtrar con la tabla y ordenar).
- Un libro de Excel admite 1.048.576 filas por hoja; las exportaciones de RemHub leen de a 1.000 filas y hasta 100.000 por tema.
- Las fotos se insertan como vengan (PNG/JPEG); falta reducirlas antes de ponerlas en exportaciones grandes.
