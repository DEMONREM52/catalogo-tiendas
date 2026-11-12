# REM: asistente de voz

Se toca **🎙️ REM** en el encabezado del panel, se habla y REM contesta con voz. Por ahora sabe armar **traslados**.

## Cómo funciona

- **Escuchar.** Usa el reconocimiento de voz del navegador (`src/lib/voice/speech.ts`).
  - Funciona en Chrome y Edge, en Android y en computador, y en Safari 14.5 o más nuevo. En Chrome el audio lo procesa Google.
  - Es gratis y necesita internet.
  - Firefox no lo trae, y ahí el botón no aparece.
- **Hablar.** Usa la voz en español del equipo, de preferencia es-CO.
- **Entender.** No usa IA: un intérprete de frases propio (`src/lib/voice/spanish.ts`) con sus pruebas en `tests/voice/spanish.test.ts`.
  - Entiende números dichos: «veintidós», «ciento veinte».
  - Arma referencias dichas: «a be guion doce cuarenta» se vuelve AB-1240.
  - Reconoce puntos por nombre y las órdenes del traslado.
- **Quién atiende.** La pantalla de Traslados se registra en `src/lib/voice/rem.ts` mientras está abierta (`useTransferVoice.ts`).
  - Si REM se toca en otra pantalla y se dice «traslado», abre Inventario → Traslados y sigue ahí.
- **Cuándo escucha.** Solo con el panel de REM abierto: tras cada respuesta suena un pitido y escucha una frase.
  - Si dos veces no se dice nada, se pausa.

## Qué se le dice en un traslado

| Se dice | Qué hace |
|---|---|
| «Quiero hacer un traslado de bodega principal a Zamora» | Elige el origen y el destino (pueden ser varios: «a Zamora y Norte»). |
| «Tres de la A B guion doce cuarenta» / «cinco secadores para Norte» | Busca en el origen, solo productos con existencias, y pone la cantidad. |
| — | Si hay varios parecidos, lee hasta 3 opciones: «la dos», o «ninguno». |
| — | Si no se dijo la cantidad, la pregunta. |
| «Ahora para Norte» | Lo siguiente que se diga va para ese destino. |
| «Cambia la zapatera a cuatro» / «mejor dos» / «quita el último» / «quita la zapatera» | Corrige. |
| «¿Cuántos llevo?» | Lee un resumen. |
| «Lo lleva Pedro» / «revisó Juan» / «nota …» | Anota los responsables y las notas. |
| «Listo» | Pide lo que falte y lee el resumen. Pregunta «¿Lo envío?»: solo con «sí» se envía. |
| «Para» / «cancelar» | Termina. Lo armado queda como borrador. |

**Lo que REM revisa:**
- **Existencias.** Si no alcanza, avisa: «solo hay 2, ¿pongo 2?».
- **Antes de enviar.** Se revisa contra la base como siempre: existencias en vivo y `checkStockNow`.
- **Permisos.** Se respetan: sin el permiso de traslados, REM no lo abre.

## Pendiente (fases siguientes)

1. Compras, pedidos internos, conteos físicos y POS por voz.
2. «Oye REM» con la pantalla encendida.
3. Opcional y de pago: preguntas libres con IA.
4. «REM, foto»: abrir la búsqueda por foto desde la voz.
