-- =====================================================================
-- REMHUB · SOLO LECTURA: código de las funciones de ventas, precios y costos
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
      'create_order_from_cart', 'erp_tag_order', 'erp_pos_order_set_items', 'update_order_items_by_token',
      'update_order_items_by_token_v2', 'confirm_order', 'confirm_order_v2', 'apply_stock_on_confirm',
      'erp__apply_order_stock', 'erp__sale_out', 'erp__sale_lines', 'erp_report', 'erp_sale_void',
      'erp_sale_void_rights', 'erp_pos_documents', 'erp_credit_register', 'erp_customer_pay',
      'erp_receivable_pay', 'owner_set_order_status', 'store_team_set_order_status', 'erp_can',
      'erp_my_point', 'erp_my_points', 'erp_point_allowed', 'erp_my_scope', 'catalog__price',
      'catalog_create_order', 'create_order_with_items', 'erp_receive_purchase', 'erp_receive_invoice'
    )
  union all
  select 'trigger ' || c.relname || '.' || t.tgname, pg_get_triggerdef(t.oid)
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and not t.tgisinternal
    and c.relname in ('orders', 'order_items', 'erp_order_meta', 'products', 'inventory_movements', 'erp_receivables', 'erp_receivable_payments')
  union all
  select 'columnas ' || table_name, string_agg(column_name || ' ' || data_type, ', ' order by ordinal_position)
  from information_schema.columns
  where table_schema = 'public' and table_name in ('orders', 'order_items', 'erp_order_meta', 'products')
  group by table_name
  union all
  select 'permisos columna products.cost_price', coalesce(string_agg(grantee || ':' || privilege_type, ', '), '(sin permisos por columna)')
  from information_schema.column_privileges
  where table_schema = 'public' and table_name = 'products' and column_name = 'cost_price'
) x;
