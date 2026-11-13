# REM: asistente de voz

REM es **una esfera de cristal morada** que flota sobre todo el panel, también encima de las ventanas. Es una sola y siempre la misma: no se abre una nueva cada vez.

- **Encender:** botón **REM** del encabezado. Queda encendido en ese equipo, también al recargar, hasta decir «apágate» o tocar ⏻.
- **Llamarlo:** decir **«Rem…»** («Rem, abre los gastos»), tocar el botón REM o 🎙️ en la conversación.
- **La esfera reacciona:**
  - En reposo respira.
  - Al escuchar crece y brilla con la voz. En computador lo mide el micrófono; en celular, lo que va reconociendo.
  - Al hablar late con cada palabra; al pensar gira rápido.
  - Un punto verde indica que espera «Rem».
- **Tocar la esfera:** abre o cierra la conversación (como ChatGPT). Si REM está hablando, lo calla y escucha.
- **Conversación:** muestra todo lo hablado (queda guardado en el equipo), el botón Hablar / Interrumpir / Detener, el interruptor «Rem», ⏻ para apagar y ✕ para ocultarla.
- **Junto a la esfera:** con la conversación cerrada, sale en una burbuja lo que va oyendo y lo que responde.
- **Moverla:** se arrastra a donde no estorbe y queda guardado.
- **Interrumpir:** en computador, hablándole encima. En celular, tocando la esfera.

**Todo es gratis.** No usa IA de pago ni pasa por un servidor de RemHub.

## Buscar y manejar productos

«Ren, búscame en los productos la cámara SC30A».

1. Abre Productos y escribe «cámara sc30a» en el buscador.
2. Dice qué encontró (los 3 primeros) y pregunta «¿Qué quieres que haga por ti?».
3. Se le sigue hablando:
   - «léemelos», «cuántos hay»
   - «abre el primero», «ábrelo», «abre la cámara solar»
   - «inactiva el dos», «ya no hay de la tres», «actívalo» (siempre pregunta «¿Inactivo…? Di sí o no»)
   - «solo los agotados», «solo los inactivos», «ordénalos por precio», «los más caros primero»
   - «ahora busca la zapatera», «limpia», «listo»

- Frases: `src/lib/voice/products-voice.ts` (pruebas en `tests/voice/products-voice.test.ts`). Lo que hace: `src/app/dashboard/products/useProductsVoice.ts`.
- «Busca el cliente…» no es de productos.
- La pantalla «reclama» sus frases (`claims` en `rem.ts`): «muéstrame solo los agotados» no se toma como ir a otra página.

## Abrir cualquier sección

«Rem, abre los gastos», «llévame a la nómina», «muéstrame la rentabilidad por punto», «ve a clientes».

- Usa la misma lista del buscador Ctrl+K, ya filtrada por los permisos de quien habla: no abre nada que la persona no pueda abrir a mano (`src/lib/voice/navigate.ts`, con pruebas en `tests/voice/navigate.test.ts`).
- Sin verbo («nómina») solo abre si se parece mucho.
- En medio de un traslado o una venta exige un parecido todavía mayor, para no salirse de la pantalla por una frase.

## Aprende solo (en este equipo)

- **Productos:**
  - Si no encontró «termólico» y enseguida «termo licuadora HM 03» sí, la frase que falló queda aprendida como ese producto.
  - Las dos frases tienen que parecerse (una palabra que empieza a sonar igual, o el mismo número) y haber pasado máximo 3 turnos (`missToLearn` en `fuzzy.ts`).
  - Lo mismo cuando se rechazan sus propuestas («no») y se dice de otra forma.
  - Si después se le dice «no» a lo aprendido, lo olvida.
- **Frases:** si no entendió algo y enseguida, dicho de otra forma, abrió una sección o una pantalla, la frase que falló queda guardada y la próxima vez lleva directo (`learnPhrase`, máximo 300).
- **Correcciones:** «no, es la VTS 30», como antes.
- La conversación muestra cuántas cosas lleva aprendidas.

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
- **Cómo encuentra el producto** (`resolveSpoken` en `src/lib/voice/fuzzy.ts`, pruebas en `tests/voice/fuzzy.test.ts`):
  1. Busca lo dicho tal cual, como referencia y con variantes que suenan igual (b/v/p, s/z/c/f, t/d, y/i/e, k/c/q/g, g/j, m/n, o/u), en singular y por partes. También busca el número de la referencia con el nombre («cámara 30»), que encuentra «VTS30» aunque las letras salgan mal.
  2. Ordena **todo** lo encontrado por parecido con lo dicho. Nunca se queda con lo primero que devuelva el buscador (antes «cámaras vts 30» agregó «cámara omni 3 cámaras»).
  3. Decide:
     - **Seguro** (se parece casi del todo, le saca ventaja al segundo y la referencia dicha está tal cual o suena igual): lo agrega.
     - **Duda**: «¿Estás intentando decir cámara de seguridad triple solar VTS30?». «Sí» lo agrega con la cantidad dicha; «no» pregunta por el siguiente (hasta 3); un número lo agrega con esa cantidad.
     - **Varios igual de parecidos**: «No lo encontré exacto. Encontré 3: …».
- **Corregir lo último:** justo después de que REM agrega algo:
  - «no» lo quita y pregunta por el siguiente parecido;
  - «esa no, la VTS 30», «no, es la…», «me refiero a…», «de la referencia vts 30» lo quitan y buscan lo nuevo con la misma cantidad.
- **Aprende:** lo que se le confirma («sí»), se elige («la dos») o se corrige queda guardado en ese equipo (`remhub:rem-learned`, máximo 500 frases). La próxima vez, la misma frase (como suena) va directo a ese producto. Si después se le dice «no», lo olvida.
- **Muletillas:** «necesito», «dame», «mándame», «necesito que me mandes», «de la referencia»… se ignoran.
- **«Sí» de muchas formas:** «sí esa», «esa esa», «ese mismo», «claro que sí», «ajá», «de una». «No esa no», «ese no» son no.
- **Hablarle encima (computador):** REM escucha desde que empieza a hablar (`capture` en `speech.ts`). Apenas la persona habla, se calla y oye la frase completa. Lo que REM mismo dice, si el micrófono lo oye por el parlante, se reconoce y se ignora.
- **Su propia voz por el parlante:** lo que empezó a oírse mientras hablaba (o hasta 1,8 s después, porque el reconocedor entrega tarde) se revisa con `isEchoOf`: si la mitad o más son palabras de lo que dijo y quedan menos de 3 propias, se descarta. Mientras habla solo vale una respuesta corta clara o una frase de 3 palabras o más que casi no tenga palabras suyas (el parlante mezclado sale como «nos comemos»). Si nadie lo interrumpió, al terminar reinicia la escucha en limpio. Si se oye dos veces, deja de escuchar mientras habla en esa sesión (`echoDetected`) y escucha al terminar. Opción «Interrumpirlo hablando» en la ayuda del panel (`remhub:rem-duplex`). Pruebas: `tests/voice/echo.test.ts`.
- **Pausas (computador):** la frase termina tras 1,3 segundos de silencio, o 2 si estaba a mitad de palabra. Así se puede decir «cinco cámaras… de la referencia… vts 30».
- **Celular:** abrir el micrófono corta la voz, así que escucha al terminar de hablar. Tocar 🔊 lo calla y escucha.
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

**Si la pantalla tarda en abrir:** REM espera hasta 15 segundos. Si no alcanza (o falta tocar «Nuevo pedido» o abrir un conteo), sigue solo apenas la pantalla aparezca, durante los 2 minutos siguientes.

**Ventanas que tapan el encabezado** (Nuevo pedido interno): traen su propio botón 🎙️ REM junto a la ✕ (`RemCallButton`, que llama `callRem()`).

## Llamarlo con «Rem» / «Oye REM»

Se enciende con el interruptor «Rem» de la conversación. Viene encendido en computador y apagado en celular, donde gasta batería y suena al reiniciar. Queda guardado solo en ese equipo. Ahí mismo muestra qué oyó mientras espera.

- **«Ren» lo llama** (así se pronuncia): «Ren, quiero ir a productos», al empezar o en medio de la frase. «rendir» o «Renault» no lo despiertan. En medio de una conversación, el nombre se quita y se entiende el resto (`withoutName` en `speech.ts`).
- **El nombre en medio de la frase también lo llama:** «bueno, Rem, abre los gastos». Solo valen las formas que no son otra palabra: «rem», «reem», «rhem».

- **Cuándo escucha:** solo con RemHub abierto y la pestaña a la vista. Se apaga sola si se cambia de pestaña o se bloquea la pantalla.
- **Qué lo llama:** «oye», «hey», «hola» u «ok» seguido de «REM», o la frase que empieza por «REM» («REM, quiero hacer un traslado»).
  - Acepta cómo lo suele escribir el reconocedor: «oye ren», «olle rem», «oyeren», «hey Ram», «R.E.M.» (`wakeRest` en `speech.ts`, con pruebas).
  - «remisión», «remera» o «memoria RAM» no lo despiertan.
  - Se puede decir todo de una vez: «Oye REM, quiero hacer un traslado».
- **Probar:** en «¿Qué le puedo decir?» → «🧪 Probar el llamado». Dice si así se despierta y muestra lo que oyó. Con la opción encendida, el panel muestra «Lo último que oí» mientras espera.
- **Si el navegador no deja escuchar sin tocar la pantalla** (pasa al abrir la página), espera el primer toque y vuelve a escuchar.
- **Pronunciación (solo la voz; en pantalla siempre «REM»):**
  - REM habla con la voz del navegador (Web Speech API). Ese motor no admite SSML ni fonemas, así que se cambia solo el texto que se le entrega a la voz.
  - Diccionario central: `src/lib/voice/pronunciation.ts` (`PRONUNCIATIONS`). Para otro nombre, una entrada más.
  - Por defecto la voz dice «ren» (decisión del dueño): toda voz en español lo lee de corrido. En pantalla sigue «REM». Opciones para elegir por equipo: «rem», «Rem», «Remm».
  - Nunca con tilde: «Rém» la voz del iPhone lo deletreaba («R, E con acento agudo, M»). «REM» en mayúsculas sonaba como sigla («rien»), y «Rrem», «rariem».
  - Reconoce «REM», «Rem» y «rem» como palabra completa; no toca «remisión», «remera», «remá» ni «Rémora» (pruebas en `tests/voice/pronunciation.test.ts`).
  - Cada teléfono trae voces distintas: en «¿Qué le puedo decir?» → «Cómo dice su nombre» se oyen las opciones y se elige una, guardada en ese equipo.
  - Voz: prefiere es-CO, luego Latinoamérica y al final España. Si las voces no han cargado, vuelve a buscar en la siguiente frase (antes se quedaba sin voz en español toda la sesión y el teléfono usaba su voz por defecto, a veces en inglés).
- **Reacciona rápido:** usa lo que va oyendo y no espera a que el reconocedor cierre la frase, que con ruido puede tardar mucho. Al oír «oye REM» espera 1,2 segundos por si sigue la orden.
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
- **Botón, conversación y orden de la charla:** `src/components/rem/RemButton.tsx`. Ahí está a qué pantalla lleva cada frase (`INTENTS`) y qué permisos pide.
- **La esfera:** `src/components/rem/RemOrb.tsx`. Lee el nivel de voz (`voiceLevel`, `pulseLevel` y `startMicMeter` en `speech.ts`) en cada cuadro, sin re-render de React.
  - El medidor del micrófono solo corre en computador y mientras conversa. En celular, abrir el micrófono dos veces corta el reconocimiento.
  - Va sin control automático de volumen, para no cambiarle el nivel al micrófono del reconocimiento.

## Para agregar REM a otra pantalla

1. Escribir un `ListVoiceAdapter` y llamar `useListVoice(adaptadorRef, habilitado)`.
2. Si la pantalla tiene botón 📷, envolverlo con `data-rem-photo` y llamar `voice.picked(hit)` al elegir.
3. Agregar la frase que la abre a `INTENTS`.

## Pendiente (opcional, de pago)

- Preguntas libres con IA, como «¿cuánto vendió Zamora ayer?». El usuario decidió dejarlo por fuera por ahora.
