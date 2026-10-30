-- =====================================================================
-- REMHUB · Cómo se guardan las firmas de pedidos internos y traslados
-- Solo lee: devuelve el código de las funciones de firma y las columnas de
-- sus tablas, para poder agregar las firmas por enlace antes de enviar.
-- No muestra datos de clientes ni claves.
-- =====================================================================
select jsonb_build_object(
  'funciones', (
    select jsonb_object_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', pg_get_functiondef(p.oid))
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      'erp_stock_request_sign', 'erp_transfer_track_sign', 'erp_transfer_track', 'erp_transfer_track_request',
      'erp_transfer_track_renew', 'erp_stock_request_detail', 'erp_stock_request_dispatch')
  ),
  'tablas', (
    select jsonb_object_agg(t.table_name, (
      select jsonb_agg(c.column_name || ' ' || c.data_type || case when c.is_nullable = 'NO' then ' not null' else '' end order by c.ordinal_position)
      from information_schema.columns c where c.table_schema = 'public' and c.table_name = t.table_name))
    from information_schema.tables t
    where t.table_schema = 'public' and (t.table_name like '%signature%' or t.table_name like 'erp_transfer%' or t.table_name like 'erp_stock_request%')
  ),
  'disparadores', (
    select jsonb_agg(jsonb_build_object('tabla', c.relname, 'nombre', tg.tgname, 'funcion', pr.proname))
    from pg_trigger tg join pg_class c on c.oid = tg.tgrelid join pg_proc pr on pr.oid = tg.tgfoid join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and not tg.tgisinternal and (c.relname like '%signature%' or c.relname like 'erp_transfer%' or c.relname like 'erp_stock_request%')
  )
)::text as resultado;
