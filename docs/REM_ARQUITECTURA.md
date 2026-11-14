# REM: arquitectura, estado y mantenimiento

REM es el asistente de voz de RemHub. Este documento explica cómo está hecho, qué hace hoy, qué falta y cómo se mantiene.

- **Lo que REM sabe hacer:** [`REM_CAPACIDADES.md`](REM_CAPACIDADES.md). Se genera desde el código y tiene el mapa de módulos, la matriz de permisos, las acciones y sus riesgos.
- **Uso diario** (esfera, voz, pronunciación, pantallas con voz): [`REM_VOZ_REMHUB.md`](REM_VOZ_REMHUB.md).

**REM no usa IA generativa.** Entiende con reglas escritas en el código y con lo que aprende de cada persona, todo en el navegador y sin costo. Está preparado para conectar otro motor más adelante (ver «Proveedores de comprensión»).

---

## 1. Diagnóstico (13/11/2026)

### Lo que ya existía y se conserva

| Pieza | Dónde | Qué hace |
|---|---|---|
| Voz | `src/lib/voice/speech.ts` | Web Speech API: reconocimiento y síntesis. Llamado «rem/ren», interrupción en computador, desbloqueo de sonido en iPhone y medidor del micrófono. |
| Pronunciación | `src/lib/voice/pronunciation.ts` | Dice «ren» solo en la voz. En pantalla sigue «REM». |
| Esfera y conversación | `src/components/rem/RemOrb.tsx`, `RemButton.tsx` | Una sola esfera sobre todo, la conversación tipo chat, encender y apagar. |
| Pantallas con voz | `src/lib/voice/rem.ts` (pila de pantallas) + cada pantalla | Traslados, conteos, pedidos internos, compras, POS y Productos. Antes de guardar preguntan «Di sí o no». |
| Navegación | `src/lib/voice/navigate.ts` | «Abre los gastos». Usa la lista del buscador Ctrl+K, ya filtrada por los permisos. |
| Aprendizaje | `fuzzy.ts`, `navigate.ts` | Productos y frases que no entendió y después sí. |

### Lo que faltaba (y se hizo en esta entrega)

1. **No sabía explicar nada.** No podía responder «¿para qué sirve…?» ni «¿cómo registro…?».
2. **No consultaba datos.** No respondía «¿cuánto vendimos hoy?» y no entendía «¿y ayer?».
3. **No sabía dónde estaba la persona.** «Crea uno nuevo» no significaba nada.
4. **La memoria era por equipo, no por persona.** Si dos personas usaban el mismo computador, veían la conversación y lo aprendido de la otra.
5. **No había catálogo.** Las pantallas con voz estaban escritas dentro de `RemButton`. Si se agregaba una página, nada avisaba que REM no la conocía.
6. **No había registro de acciones con riesgo.** La regla «confirmar antes de guardar» estaba en cada pantalla, pero no en un lugar común.

### Lo que se verificó del sistema

- **Rutas:** 37 páginas en `src/app/dashboard`. La prueba de sincronización las lee del disco.
- **Permisos:**
  - Hay una lista oficial: `PERMISSION_LIST` en `src/lib/permissions.ts`.
  - El menú (`src/lib/module-tabs.ts`) y el buscador (`src/lib/search-index.ts`) declaran qué permisos abren cada cosa.
  - `DashboardShell` filtra esa lista con `canOpen` y se la pasa a REM.
- **Base de datos:** las consultas que REM usa son funciones `security definer` que ya usaban las pantallas. Revisan `auth.uid()`, que la persona sea de la tienda, el permiso (`erp_can`) y, donde aplica, sus puntos (`erp_my_points`):
  - `erp_home_today(p_store)`: ventas de hoy y de ayer, las propias y lo más vendido en 7 días. Basta uno de los permisos `pos`, `reports` u `orders`.
  - `erp_daily_close(p_store, p_day)`: el cierre de un día, por punto y por vendedor. Basta uno de los permisos `reports`, `cash_manage` o `profit_view`.
  - `search_products_safe` + `erp_product_stock_by_point(p_product)`: existencias de un producto por punto. Basta uno de los permisos `products`, `products_view`, `inventory`, `pos` o `purchases`. Muestra todos los puntos, igual que la pantalla.
  - `erp_expenses_list(...)`: gastos de un rango, solo de los puntos de la persona. Basta uno de los permisos `expenses`, `expenses_pay` o `budgets`.
  - `erp_profit_summary(p_store, p_from, p_to)`: ventas, costo y ganancia de un rango (y por punto y producto). Pide `profit_view` y respeta los puntos. REM la usa para «¿cuánto vendimos este mes?», «lo más vendido este mes» y «¿cuánto ganamos?».
  - `erp_my_tasks(p_store)`: «Tus pendientes» del inicio. Cada pendiente sale solo si la persona tiene el permiso.
  - `erp_payables_board(p_store)`: cuentas por pagar a proveedores. Pide `payables` y respeta los puntos.
  - `erp_cash_board(p_store)`: cajas de los puntos de la persona. Pide `cash` o `cash_manage`.
  - `erp_goals_progress` y `erp_commissions`: metas y comisión del mes. Quien no administra el equipo ve solo lo suyo.
  - `erp_receivables_overview(p_store)`: la cartera. Es la misma que usa la pantalla de Cartera. **Su definición no está en el repositorio**: se creó antes y sus permisos no se pudieron leer. REM solo la llama si la persona tiene `receivables` o `credit`, como la pestaña.
- **Planes:** `canOpen` en `DashboardShell` ya descuenta lo que el plan bloquea (`saas_plan_blocked_permissions`), y la lista que recibe REM sale de ahí. Cuando algo no está disponible, REM distingue si es por el plan o por el permiso: compara con `canOpenByRole`, que no cuenta el plan.

### Lo que NO se verificó (pendiente)

- **Las políticas RLS de cada tabla.** REM no las toca: toda escritura pasa por las funciones de cada pantalla, que ya existían.
- **Los pasos manuales de cada módulo.** Solo están escritos los que se leyeron en el código: crear producto, registrar gasto, ingresar factura de compra, crear cliente o tercero, abrir y cerrar caja, crear categoría, crear usuario, apartado, cotización, promoción y garantía o devolución. En el resto, REM explica para qué sirve el módulo y ofrece abrirlo. No inventa pasos.
- **Prueba con micrófono y parlante reales** (computador, iPhone y Android).

---

## 2. Arquitectura

Cada capa hace una sola cosa. Una capa de comprensión nunca ejecuta y nunca decide permisos.

```
 voz (src/lib/voice/speech.ts)
   │  texto oído
   ▼
 RemButton ──► pantalla con voz abierta (rem.ts)  ← si la frase es suya (claims) o hay un trabajo en curso
   │
   ├─► cerebro (src/lib/rem/brain.ts)
   │      ├─ comprensión   understand.ts   «¿qué pidió?» + confianza   (proveedores: hoy, reglas locales)
   │      ├─ acciones      actions.ts      permisos + validación + riesgo + ejecución (con la sesión de la persona)
   │      └─ respuesta     respond.ts      texto natural, variaciones, nada inventado
   │
   ├─► pantallas con voz por nombre (catalog.ts → VOICE_SCREENS)
   └─► abrir una página (navigate.ts, lista Ctrl+K filtrada por permisos)

 conocimiento: catalog.ts (arma todo desde search-index + module-tabs) + modules.ts (qué es y cómo se usa)
 memoria:      memory.ts (por usuario y tienda; nunca da permisos)
```

### Archivos

| Archivo | Responsabilidad |
|---|---|
| `src/lib/rem/catalog.ts` | Catálogo de capacidades. Se **arma** con el buscador y el menú, así que no hay una lista duplicada. Incluye `VOICE_SCREENS` (pantallas con voz, antes dentro de `RemButton`) y `QUERIES` (consultas). |
| `src/lib/rem/modules.ts` | Qué es cada módulo y cómo se hacen sus tareas. Los pasos solo se escriben si están verificados. |
| `src/lib/rem/understand.ts` | Comprensión: normaliza el texto (tildes, «rem/ren», «por favor»), detecta la intención, saca los datos (fecha, punto, «las mías», «lo más vendido»), sigue el tema de la conversación, maneja la ambigüedad y da un nivel de confianza. |
| `src/lib/rem/period.ts` | Fechas dichas: hoy, ayer, antier, el lunes, hace 3 días, 5 de noviembre, 5/11. Rangos: este mes, el mes pasado, esta semana, la semana pasada, en octubre, este año. Siempre con la fecha de Colombia. |
| `src/lib/rem/money.ts` | Valores dentro de una frase: «50 mil», «cincuenta mil», «$20.000», «1 millón 200 mil». |
| `src/lib/rem/actions.ts` | Registro cerrado de acciones con riesgo, confirmación y permisos: `sales.summary`, `profit.summary`, `stock.product`, `expenses.summary`, `debts.summary`, `payables.summary`, `cash.status`, `goals.progress`, `tasks.mine`. |
| `src/lib/rem/team.ts` | Lo que REM no entendió en la tienda (sin nombres) y las frases que el dueño o el administrador enseñan para todos (migración 20261322). |
| `src/lib/rem/respond.ts` | Respuestas: explicar, cómo se hace, crear aquí, qué sé hacer, «¿te refieres a…?». |
| `src/lib/rem/brain.ts` | Une todo y guarda el estado corto de la conversación: el tema, lo que ofreció y las opciones que dio. |
| `src/lib/rem/memory.ts` | Memoria por usuario y tienda. También las frases que no entendió. |
| `src/lib/rem/routes.ts` | Páginas que REM no abre por nombre, con el porqué. |
| `src/lib/rem/catalog-doc.ts` | Genera `docs/REM_CAPACIDADES.md`. |
| `src/lib/module-tabs.ts` | Las secciones de cada módulo del menú (antes dentro de `DashboardShell`). Es una sola fuente para el menú y para REM. |

### Orden en que REM decide (al llamarlo)

1. Charla: la hora, el día, saludos.
2. «Apágate».
3. «Ayuda» o «¿qué sabes hacer?»: responde según los permisos de la persona.
4. **Cerebro:** responde a lo que REM acaba de ofrecer («sí, ábrela»), o elige entre las opciones que dio. Si no, intenta entender:
   - «qué tengo pendiente»;
   - «registra un gasto de 50 mil en arriendo», «crea un cliente que se llama…», «crea un producto que se llama…» (abren el formulario lleno);
   - caja, metas y comisión, ganancia, cuentas por pagar, existencias, cartera, gastos y ventas;
   - explicar o «cómo se hace»;
   - «crea uno nuevo».
5. La pantalla abierta reclama la frase (`claims`). Por ejemplo, «solo los agotados» en Productos.
6. Pantalla con voz por nombre: «quiero hacer un traslado».
7. Abrir una página: «abre los gastos».
8. No entendió: guarda la frase en «Lo que no te entendí».

**En medio de un trabajo** (un traslado, una venta), REM responde preguntas como «¿cuánto vendimos hoy?» y sigue en esa pantalla. En ese modo:

- No ofrece abrir otra cosa, ni crear ni llenar formularios, para que un «sí» siguiente no se confunda.
- Solo toma la pregunta completa («¿cuántas hay de la cámara?»). «Hay tres» o «hay termos» siguen siendo de la pantalla.

### Proveedores de comprensión (para una IA en el futuro)

Un proveedor de comprensión cumple esta interfaz:

```ts
interface UnderstandingProvider { id: string; understand(text: string, ctx: RemContext): Understanding | null }
```

`understand()` prueba los proveedores en orden y gana el primero cuya confianza sea igual o mayor que `CONFIDENT` (0,6). Hoy solo hay uno: `localRules`.

- **Para agregar un motor semántico o un modelo de lenguaje,** se pone delante en la lista. Su respuesta es solo una intención con datos. Pasa por el mismo cerebro y por las mismas acciones, con sus permisos, riesgos y confirmaciones.
- **Lo que un modelo nunca debe hacer:**
  - llamar a la base directamente;
  - recibir llaves;
  - ejecutar algo que no esté en el registro de `actions.ts`.

Un modelo externo cuesta dinero y necesita un servidor. Para conectarlo hace falta la autorización explícita del dueño. Hoy está aplazado por decisión suya.

---

## 3. Seguridad y permisos

1. **REM no abre lo que la persona no puede abrir.** Navegar, ofrecer y «crear uno nuevo» usan la lista que el panel arma con `canOpen`. Esa lista se lee en cada frase: si le cambian los permisos en plena conversación, cuenta en la siguiente frase.
2. **El navegador no es la última palabra.** El chequeo de permisos en `actions.ts` es para responder con un mensaje claro. La consulta va a la base con la sesión de la persona (`supabaseBrowser`, nunca `service_role`), y la base vuelve a revisar la tienda, el permiso y los puntos. Por eso un vendedor de Zamora solo oye las ventas de Zamora.
3. **La memoria no da permisos.** Una frase aprendida solo lleva a una página si esa página está hoy en la lista de la persona. La conversación guardada tampoco autoriza nada. Hay una prueba para esto: si le quitan el permiso entre una pregunta y la siguiente, REM ya no consulta.
4. **Riesgo y confirmación** (en `actions.ts` y en las pantallas):
   - **Bajo:** abrir, buscar, explicar y consultar. Se hace sin preguntar.
   - **Medio:** abrir un formulario vacío, o lleno con lo dicho («un gasto de 50 mil en arriendo»). La persona lo revisa y lo guarda.
   - **Alto:** guardar, mover inventario, activar o inactivar. Solo con «sí», sabiendo exactamente qué registro se afecta. Si no sabe cuál, pregunta.
   - **Crítico:** borrar, permisos, otras tiendas. **No se hace por voz.**
   - La confirmación no reemplaza el permiso.
5. **No hay código armado con lo que se dice.** Solo existen las acciones del registro.
6. **Sin datos inventados.** Si la base falla, REM lo dice y no da números. Nunca dice «listo» si algo no se hizo.
7. **Aislamiento entre tiendas.** Toda consulta lleva el `storeId` de la sesión. La base revisa que la persona pertenezca a esa tienda.

---

## 4. Memoria por persona

Todo se guarda en `localStorage`, con llaves `remhub:rem-<cosa>:<usuario>:<tienda>`:

| Qué | Llave | Límite |
|---|---|---|
| Frases aprendidas («la plata de los muchachos» → Nómina) | `phrases` | 300 |
| Productos aprendidos (cómo los nombra) | `learned` | 500 |
| Conversación | `log` | 60 turnos |
| Lo que no entendió (frase + página) | `misses` | 40 |

- **No se guardan** contraseñas, tokens ni datos de clientes.
- **Ver, corregir y borrar:** en la conversación, «Lo que REM sabe de ti». Ahí se puede:
  - enseñarle a dónde llevaba una frase que no entendió;
  - borrar una frase aprendida;
  - olvidar los productos aprendidos;
  - borrar todo.
- **Lo que había antes guardado por equipo:**
  - Las frases y los productos aprendidos pasan a la primera persona que entra, porque no son privados.
  - La conversación vieja **se borra**, porque podía ser de otra persona.
- **Siguen por equipo**, porque son ajustes del aparato: encendido, «Rem» para llamar, interrumpir hablando, la pronunciación y dónde queda la esfera.

### Lo que una persona le enseña es solo suyo; lo de la tienda lo aprueba el dueño

Lo que alguien le enseña a REM no cambia lo que REM hace con los demás. Así nadie con malas intenciones puede alterar el comportamiento de todos.

**Para toda la tienda** (migración `20261322_rem_aprende_en_tienda.sql`):

- **Lo que REM no entendió** se anota en `rem_misses`: la frase, la página (sin parámetros) y quién la dijo. Quién la dijo sirve solo para contar personas; **nunca se muestra**.
  - Las frases de una palabra no se guardan.
  - Se borra sola a los 90 días, y hay máximo 500 por tienda.
- **El dueño o un administrador de la tienda** (no basta el permiso de usuarios) ve esa lista en la conversación, en «👑 Enseñarle a REM para toda la tienda»: la frase, cuántas veces y cuántas personas. Ahí elige a dónde lleva cada frase o la descarta.
- **Lo enseñado** queda en `rem_store_phrases`, máximo 300 por tienda.
  - REM lo trae al entrar y lo usa después de lo aprendido por cada persona.
  - La base solo acepta páginas del panel (`/dashboard…`, sin enlaces de afuera), y REM solo abre la página si la persona la puede abrir.
- Las dos tablas tienen RLS y ninguna política: solo se usan con las funciones `rem_*`, que revisan la tienda y el cargo.
- La persona ve el aviso en «Lo que REM sabe de ti»: lo que no entiende se le muestra al administrador sin su nombre.
- Si la migración no está corrida, todo sigue como antes, solo en el equipo.

---

## 5. Sincronización con RemHub (actualización del conocimiento)

**Fuente de verdad:**

- El buscador (`search-index.ts`) y el menú (`module-tabs.ts`) definen las páginas, los formularios y los permisos.
- REM los lee al armar el catálogo, así que no hay que enseñarle una página nueva: si está en el buscador, REM la abre.

**La prueba `tests/rem/catalog-sync.test.ts` falla si:**

1. Hay una página nueva en `src/app/dashboard` que no está en el buscador, en el menú ni en `routes.ts`.
2. Algo del catálogo, de un módulo o de `routes.ts` apunta a una página que ya no existe.
3. Un permiso del catálogo no existe en `PERMISSION_LIST`.
4. Un módulo o una pantalla con voz no tiene nada en el buscador.
5. Un «cómo se hace» tiene pasos sin verificar, o lleva a un enlace que no existe.
6. Una capacidad de riesgo alto o crítico no pide confirmación.
7. `docs/REM_CAPACIDADES.md` quedó viejo. Se arregla con `npm run rem:catalog`.

**Lo que se mira a mano:** que el «para qué sirve» de `modules.ts` siga siendo cierto cuando cambia una pantalla. Ninguna prueba puede saber si una frase dejó de ser verdad.

**Funciones nuevas:** no se habilitan solas. Una acción nueva de REM se agrega a mano en `actions.ts`, con su riesgo, sus permisos y sus pruebas. REM no modifica su propio código.

---

## 6. Pruebas

Se corren con `npm test` (299 en verde, 64 de REM) y `npm run test:sql`.

| Archivo | Qué prueba |
|---|---|
| `tests/rem/understand.test.ts` | Muchas formas de decir lo mismo, con y sin tildes y con «Rem». Que vender no se confunda con consultar ventas. Conversación de varios turnos («¿y las de ayer?»), cambio de tema, «crea uno nuevo» según la página, permisos (un vendedor no ve nómina), frases que no son de este motor y cada módulo por su nombre. |
| `tests/rem/period.test.ts` | Fechas en hora de Colombia a las 10 p. m. (en UTC ya es otro día), días de la semana, «hace N días», fechas dichas y con barra, y fechas que no existen. |
| `tests/rem/actions.test.ts` | Datos de la base, sin permiso no llama a la base, un vendedor no ve otros días, la base niega, la red falla (sin números inventados), fechas inválidas, riesgo alto con y sin «sí», crítico nunca, la confirmación no reemplaza el permiso y acciones desconocidas. |
| `tests/rem/brain.test.ts` | Ofrecer → «sí» abre y «no» no abre, sin acceso no ofrece, permisos quitados en plena conversación, ambigüedad → «la segunda», pantalla con voz y «¿qué sabes hacer?» según permisos. |
| `tests/rem/memory.test.ts` | Separación por usuario y por tienda, lo viejo por equipo (frases pasan, conversación se borra), frases no entendidas y borrar todo. |
| `tests/rem/queries.test.ts` | Existencias (exacto, varios parecidos → «la dos», inactivo, agotado, sin conexión), gastos por rango y estado, cartera total y por cliente, valores y rangos dichos, gasto llenado por voz, ofrecer solo lo que se puede abrir, ventas por rango sin inventar, plan contra permiso, cantidades sueltas en medio de un traslado y frases de la tienda. |
| `tests/rem/catalog-sync.test.ts` | La sincronización de la sección 5. |
| `tests/sql/rem_aprende_tienda.test.mjs` | Migración 20261322 (31 pruebas): quién anota, quién ve y quién enseña, sin nombres, aislamiento entre tiendas, enlaces peligrosos, limpieza a los 90 días, sin acceso directo a las tablas y que se pueda correr dos veces. |
| `tests/voice/*.test.ts` | Lo que ya existía: voz, navegación, pronunciación y Productos por voz. Sigue pasando. |

**No probado:** micrófono y parlante reales, iPhone, Android, y las consultas contra la base de producción. Las pruebas usan respuestas simuladas con la forma real de `erp_home_today` y `erp_daily_close`.

---

## 7. Estado

| Fase | Estado |
|---|---|
| Auditoría de REM, rutas, permisos y consultas | ✅ |
| Catálogo de capacidades armado desde el código | ✅ |
| Explicar módulos | ✅ los 32 |
| «Cómo se hace» | ✅ 12 con pasos verificados + 4 por voz · ⏳ el resto: explica y abre |
| Consultas: ventas hoy, ayer, otro día, por punto, las propias y lo más vendido | ✅ |
| Consultas: existencias de un producto, gastos por rango (pendientes y vencidos), cartera total y por cliente | ✅ |
| Consultas: ventas y lo más vendido de un rango, ganancia y margen, pendientes, cuentas por pagar (total y por proveedor), caja, metas y comisión | ✅ (ventas por rango y ganancia: con permiso de rentabilidad) |
| Llenar formularios por voz | ✅ gasto, cliente o proveedor (nombre, cédula o NIT, celular) y producto (nombre) · ⏳ otros formularios |
| Conversación con contexto, ambigüedad y confianza | ✅ |
| Contexto de la página («crea uno nuevo», «¿para qué sirve esto?») | ✅ |
| Registro de acciones con riesgo y confirmación | ✅ (las de riesgo alto siguen en sus pantallas, que ya confirman) |
| Memoria por persona y tienda: ver, enseñar y borrar | ✅ |
| Sincronización con pruebas + documentación generada | ✅ |
| Interfaz para otros motores de comprensión | ✅ interfaz · ⏸️ motor externo aplazado por decisión del dueño |
| Panel del dueño con lo que REM no entendió en todo el equipo, y frases para toda la tienda | ✅ migración 20261322 (falta correrla en Supabase) |
| Restricciones por plan | ✅ REM usa la lista ya filtrada por plan y dice «tu plan no lo incluye» |
| Prueba en equipos reales | ⏳ |

---

## 8. Cómo ampliar REM

- **Una página nueva:** se agrega al buscador (`src/lib/search-index.ts`) con sus permisos y sinónimos. Si es un módulo nuevo, también va en `src/lib/rem/modules.ts`, con un «para qué sirve» que diga lo que la pantalla hace de verdad. Luego se corre `npm run rem:catalog`.
- **Un «cómo se hace»:** se leen los campos y botones de la pantalla en el código, y se escriben los pasos con `verified: true`.
- **Una consulta nueva:**
  1. Buscar una función `security definer` que ya revise tienda, permiso y puntos. Si no existe, se crea en una migración nueva, con su copia en `tests/sql/migraciones` y su prueba.
  2. Registrar la acción en `actions.ts` con su riesgo, sus permisos y su validación. Si falla, dice qué pasó y no inventa datos.
  3. Agregar la intención en `understand.ts` y su prueba en `tests/rem`.
  4. Agregarla a `QUERIES` en `catalog.ts` y correr `npm run rem:catalog`.
- **Una pantalla con voz:**
  - Se registra con `registerRemHandler` (ver `src/app/dashboard/products/useProductsVoice.ts`).
  - Antes de guardar debe confirmar «Di sí o no», nombrando el registro exacto.
  - Declara `claims` para que sus frases no se tomen como «abrir otra página».
  - Se agrega a `VOICE_SCREENS`.
- **Una frase que REM no entendió:**
  - Si es de una sola persona, se le enseña desde «Lo que REM sabe de ti».
  - Si le sirve a todos, se agrega en el código: los sinónimos en el buscador o en `modules.ts`, o la regla en `understand.ts`. Siempre con su prueba.
