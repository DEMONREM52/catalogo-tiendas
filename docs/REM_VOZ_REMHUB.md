# REM: asistente de voz

Se toca **🎙️ REM** en el encabezado del panel, o se dice **«Oye REM»** si esa opción está encendida. REM contesta con voz.

**Todo es gratis.** No usa IA ni pasa por un servidor de RemHub.

## Qué sabe hacer

| Pantalla | Se abre diciendo | Qué hace al decir «listo» |
|---|---|---|
| Inventario → Traslados | «quiero hacer un traslado» | Pide quién revisó y quién lleva la mercancía, y luego pregunta «¿Lo envío?». Con «sí», envía. |
| Inventario → Conteos | «quiero hacer un conteo» (con un conteo abierto) | «¿Guardo el conteo?». Con «sí», guarda. Enviarlo a aprobar se hace en pantalla. |
| Pedidos internos (nuevo pedido) | «quiero hacer un pedido interno», «pídele a la bodega» | «¿Lo envío?». Con «sí», envía. |
| Inventario → Compras | «registrar una compra» | Resume. Proveedor, factura y Registrar se hacen en pantalla. |
| POS | «vender» | Resume el carrito. Cobrar se hace en pantalla. |

**Cuándo no envía nada por voz:** en compras ni en el POS. Ahí se maneja plata, así que solo arma la lista.

## Frases

**En todas las pantallas:**
- **Agregar:** «tres de la a be guion doce cuarenta» o «cinco secadores».
- **Si hay varios parecidos:** REM lee hasta 3 opciones; se contesta «la dos» o «ninguno».
- **Si no se dijo la cantidad:** REM pregunta «¿Cuántas?».
- **Corregir:** «cambia la zapatera a cuatro», «mejor dos», «quita el último» o «quita la zapatera».
- **Repasar:** «¿cuántos llevo?», «repite» o «ayuda».
- **Buscar con la cámara:** «foto». Abre la búsqueda por foto de la pantalla y, al tocar el producto, REM pregunta cuántas.
- **Terminar:** «listo», y luego «sí» o «no». «Para» o «cancelar» terminan sin borrar nada.

**Propias de cada pantalla:**
- **Conteos:**
  - «zapatera negra hay doce» pone esa cantidad sin sumarla.
  - REM **nunca dice cuánto dice el sistema**, porque el conteo es a ciegas.
- **Compras:**
  - «diez de la AB-1240 a doce mil» o «… costo 8.000» pone el costo unitario.
  - «el costo es doce mil quinientos» cambia el costo del último producto.
  - Con «a» sola, el número cuenta como costo solo si es de mil o más, o si dice «pesos». Así «cambia la zapatera a cuatro» sigue siendo cantidad.
- **Pedidos internos:** «pídele a Zamora», «urgente», «no es urgente», «nota …».
- **Traslados:**
  - «de bodega a Zamora y Norte», «ahora para Norte»;
  - «lo lleva Pedro», «revisó Juan».
- **POS:** no deja pasar de las existencias del punto. Avisa: «solo hay 2, ¿pongo 2?».

**Cambiar de pantalla en plena conversación:** basta con decir «quiero hacer un conteo», por ejemplo.

## «Oye REM»

Se enciende en el panel de REM, en «¿Qué le puedo decir?» → «Llamarlo diciendo Oye REM». Queda guardado solo en ese equipo.

- **Cuándo escucha:** solo con RemHub abierto y la pestaña a la vista. Se apaga sola si se cambia de pestaña o se bloquea la pantalla.
- **Qué lo llama:** «oye», «hey», «hola» u «ok» seguido de «REM».
  - «REM» suelto no lo llama, para que «remisión» o «remera» no lo despierten.
  - Se puede decir todo de una vez: «Oye REM, quiero hacer un traslado».
- **Batería:** Chrome reinicia la escucha cada tanto. En Android puede sonar un pitido del sistema al reiniciar y gasta más batería. Se recomienda en computador o tablet fija.

## Cómo está hecho

- **Escuchar y hablar:** `src/lib/voice/speech.ts` usa SpeechRecognition y speechSynthesis.
  - Funciona en Chrome y Edge, en Android y computador, y en Safari 14.5 o más nuevo.
  - Firefox no lo trae, y ahí el botón no aparece.
  - En Chrome el audio lo procesa Google y necesita internet.
  - Ahí mismo está la escucha de «Oye REM» (`startWake`).
- **Entender:** `src/lib/voice/spanish.ts`, con pruebas en `tests/voice/spanish.test.ts`. Cubre números dichos, referencias dichas, valores en pesos, puntos por nombre y órdenes.
- **Quién atiende:** `src/lib/voice/rem.ts`. Es una pila: la última pantalla abierta atiende y, al cerrarse, vuelve la de abajo.
  - Allí también están `resumeRem`, que retoma la conversación después de la foto, y `clickRemPhoto`, que abre el botón 📷 marcado con `data-rem-photo`.
- **Conversación de listas:** `src/lib/voice/useListVoice.ts`. Cada pantalla le da un adaptador: cómo buscar, cómo poner la cantidad, qué falta y qué hacer al decir «listo».
  - La usan conteos (`CountsTab`), pedidos internos (`NewStockRequest`), compras (`PurchasesTabs`) y el POS.
- **Traslados:** `src/app/dashboard/inventario/useTransferVoice.ts`. Va aparte porque maneja origen, varios destinos y responsables.
- **Botón y panel:** `src/components/rem/RemButton.tsx`. Ahí está a qué pantalla lleva cada frase (`INTENTS`) y qué permisos pide.

## Para agregar REM a otra pantalla

1. Escribir un `ListVoiceAdapter` y llamar `useListVoice(adaptadorRef, habilitado)`.
2. Si la pantalla tiene botón 📷, envolverlo con `data-rem-photo` y llamar `voice.picked(hit)` al elegir.
3. Agregar la frase que la abre a `INTENTS`.

## Pendiente (opcional, de pago)

- Preguntas libres con IA, como «¿cuánto vendió Zamora ayer?». El usuario decidió dejarlo por fuera por ahora.
