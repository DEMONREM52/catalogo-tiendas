# RemHub Amethyst Glass Design System

Temas oficiales **Pearl Amethyst** (claro) y **Obsidian Amethyst** (oscuro), más temas personales ilimitados por usuario.

## Cómo está armado

| Pieza | Archivo | Qué hace |
|---|---|---|
| Motor | `src/lib/appearance/theme.ts` | Tipos, temas oficiales, validación y normalización (entrada no confiable), contraste WCAG, tokens `--t-*`, CSS seguro, importar y exportar. |
| Estado y sincronización | `src/lib/appearance/store.ts` | Preferencias por usuario, caché local por cuenta, vista previa solo en la pestaña, conflictos por versión, cierre y cambio de cuenta. |
| Arranque sin parpadeo | `src/app/layout.tsx` (`EARLY_THEME_SCRIPT`) | Antes de pintar aplica el último tema confirmado (`remhub-appearance-boot`). |
| Menú Apariencia | `src/components/ThemeControl.tsx` | Muestra los temas oficiales, *Mis temas*, los efectos (vidrio con su intensidad, fondo animado, reducir animaciones), *Personalizar* y *Restaurar*. |
| Administrador y editor | `src/components/appearance/ThemeStudio.tsx` | Se descarga solo al abrirlo. Tiene buscar, ordenar, favoritos, paginación, importar, exportar, duplicar, renombrar, eliminar, el modo automático por tema y un editor de 7 pestañas con vista previa en vivo. |
| Paletas oficiales y vidrio | `src/app/globals.css` | Son los bloques `:root[data-theme]` y `html.dark`/`html.light`, más el vidrio (`data-glass`, `data-glass-level`), `data-reduce-motion` y `data-user-theme`. |
| Base de datos | `supabase/migrations/20261284_temas_por_usuario.sql` | Tablas `user_themes` y `user_appearance`, con RLS por `auth.uid()`, validación en el servidor, versión, freno de abuso y limpieza de referencias. |
| Pruebas | `tests/appearance/theme.test.ts` y `tests/sql/temas_usuario.test.mjs` | 6 pruebas del motor y 21 de la base. |

### Tokens

Todo el panel ya usaba `--t-*` en sus estilos. El motor calcula esos mismos tokens desde el tema, así que un tema nuevo pinta todo RemHub sin tocar cada pantalla:

- **Estructura:** `--t-bg-base`, `--t-bg`, `--t-card-bg`, `--t-card-bg-soft`, `--t-card-border`, `--t-border`, `--t-menu-bg` y `--t-input-bg`.
- **Texto:** `--t-text`, `--t-muted` y `--t-on-accent` (el texto que va sobre el color principal).
- **Interacción:** de `--t-accent` a `--t-accent4` y `--t-cta`.
- **Estados:** `--t-success`, `--t-warning`, `--t-danger` e `--t-info`. Son fijos, no cambian con el tema, para que un «peligro» siempre se reconozca.
- **Efectos:** `--t-shadow`, `--t-glow` y `--t-glass-*`.
- **Diseño:** `--radius-lg`, `--radius-xl`, `--radius-2xl` y `--radius-3xl` (los que usa Tailwind 4 en `rounded-*`), `--t-radius` y `--t-font-scale` (tamaño de letra multiplicado por la densidad).

### Reglas

- **Dónde se aplica el tema personal:** solo en `/dashboard` y `/admin`, mediante `html[data-user-theme]`. Los catálogos y las landings conservan su marca y nunca reciben el tema personal.
- **Qué se guarda de un tema:** solo HEX de 6 dígitos y números dentro de límites. La base revisa lo mismo con `erp__theme_config_valid`. Nunca se guarda CSS escrito por la persona.
- **De quién es cada tema:** el `user_id` lo pone la base. RLS impide ver, cambiar o borrar temas ajenos, y elegir un tema ajeno en las preferencias se quita solo.
- **Cantidad de temas:** sin límite. Sí hay un tamaño máximo por configuración (6 KB) y un freno de 60 temas nuevos por hora por persona.
- **Conflictos entre dispositivos:** `user_appearance.version` sube en cada cambio. Un dispositivo con una versión vieja no pisa la nueva: trae lo último y vuelve a aplicar su cambio encima.
- **Cancelar en el editor:** quita la vista previa. Las preferencias nunca se tocaron mientras se editaba.
- **Cerrar sesión:** se borra el tema privado de la pantalla y del arranque. Al cambiar de cuenta se olvida la anterior.
- **Migración desde la versión anterior:** la primera vez se pasa a la cuenta lo que ya tenía el navegador (`remhub-color-mode`, `remhub-glass`, `remhub-bg-anim`). Esas claves se siguen escribiendo por compatibilidad.

## Pendiente

1. **Etapa 8: revisar los colores fijos módulo por módulo.**
   - Muchas pantallas usan `--t-*`, pero todavía quedan clases fijas de Tailwind (`text-white`, `bg-fuchsia-*`, `slate-*`, `#ef4444`…).
   - Hay que pasarlas a tokens módulo por módulo (POS, Inventario, Pedidos, Caja…) y revisar el contraste con un tema claro personal.
2. **Probarlo en celular real y en la PWA instalada.** Sobre todo el editor en pantallas chicas y el arranque sin parpadeo.
3. **Ejecutar en Supabase la migración `20261284_temas_por_usuario.sql`.** Sin ella, el menú avisa y todo sigue funcionando en el navegador como antes.
4. **Opcional:**
   - Aplicar la densidad a cada componente; hoy se aplica escalando la letra.
   - Hacer que el fondo animado lea la intensidad del tema.
