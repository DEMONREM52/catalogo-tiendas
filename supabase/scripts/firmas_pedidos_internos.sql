-- =====================================================================
-- REMHUB · Cómo funcionan por dentro los pedidos internos y los traslados
-- Solo lee: devuelve el código de sus funciones, las columnas de sus tablas
-- y sus disparadores, para unir pedidos y traslados, agregar productos al
-- envío y firmar por enlace desde el principio.
-- No muestra datos de clientes ni claves.
-- =====================================================================
select jsonb_build_object(
  'funciones', (
    select jsonb_object_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', pg_get_functiondef(p.oid))
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
      and (p.proname like 'erp_stock_request%' or p.proname like 'erp_transfer%' or p.proname like 'erp\_\_sr\_%' or p.proname like 'erp\_\_transfer%'
           or p.proname in ('erp__scope_ok', 'erp__member_covers', 'erp_my_point'))
  ),
  'tablas', (
    select jsonb_object_agg(t.table_name, (
      select jsonb_agg(c.column_name || ' ' || c.data_type || case when c.is_nullable = 'NO' then ' not null' else '' end
                       || coalesce(' default ' || c.column_default, '') order by c.ordinal_position)
      from information_schema.columns c where c.table_schema = 'public' and c.table_name = t.table_name))
    from information_schema.tables t
    where t.table_schema = 'public' and t.table_type = 'BASE TABLE'
      and (t.table_name like 'erp_transfer%' or t.table_name like 'erp_stock_request%')
  ),
  'disparadores', (
    select jsonb_agg(jsonb_build_object('tabla', c.relname, 'nombre', tg.tgname, 'funcion', pr.proname, 'codigo', pg_get_functiondef(pr.oid)))
    from pg_trigger tg join pg_class c on c.oid = tg.tgrelid join pg_proc pr on pr.oid = tg.tgfoid join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and not tg.tgisinternal and (c.relname like 'erp_transfer%' or c.relname like 'erp_stock_request%')
  )
)::text as resultado;
