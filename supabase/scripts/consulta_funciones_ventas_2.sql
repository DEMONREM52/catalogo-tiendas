-- =====================================================================
-- REMHUB · SOLO LECTURA (parte 2): anulaciones, estados, triggers y permisos
--
-- No cambia nada. Devuelve UNA sola celda con el código de las funciones
-- y triggers que usan las ventas, para diseñar los precios por punto y la
-- foto financiera de cada venta sin romper lo que ya funciona.
--
-- Cómo usarlo: SQL Editor → Run → clic en la celda «codigo» → copiar →
-- pegarlo en un archivo de texto y compartirlo.
-- (No incluye datos de clientes, ventas ni contraseñas: solo código.)
-- =====================================================================
select string_agg('-- ' || name || E'\n' || def, E'\n\n-- ------------------------------------------------------------\n\n' order by name) as codigo
from (
  select p.proname as name, pg_get_functiondef(p.oid) as def
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prokind = 'f'
    and p.proname in (
      'erp_sale_void', 'erp_sale_void_rights', 'erp_tag_order', 'owner_set_order_status',
      'store_team_set_order_status', 'update_order_items_by_token', 'update_order_items_by_token_v2', 'catalog__items'
    )
  union all
  select 'trigger ' || c.relname || '.' || t.tgname, pg_get_triggerdef(t.oid)
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and not t.tgisinternal
    and c.relname in ('orders', 'order_items', 'erp_order_meta', 'products', 'inventory_movements', 'erp_receivables', 'erp_receivable_payments')
  union all
  select 'permisos columna products.cost_price', coalesce(string_agg(grantee || ':' || privilege_type, ', '), '(sin permisos por columna)')
  from information_schema.column_privileges
  where table_schema = 'public' and table_name = 'products' and column_name = 'cost_price'
  union all
  select 'permisos tabla products', coalesce(string_agg(distinct grantee || ':' || privilege_type, ', '), '(ninguno)')
  from information_schema.table_privileges
  where table_schema = 'public' and table_name = 'products' and grantee in ('anon', 'authenticated')
  union all
  select 'quién ejecuta create_order_from_cart', coalesce(string_agg(distinct grantee, ', '), '(nadie)')
  from information_schema.routine_privileges
  where routine_schema = 'public' and routine_name = 'create_order_from_cart'
) x;
