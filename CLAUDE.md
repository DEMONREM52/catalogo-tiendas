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
