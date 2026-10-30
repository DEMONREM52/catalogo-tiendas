-- =====================================================================
-- REMHUB · Parte 2 (lo que no cupo en el primer resultado)
-- Solo lee: el código de firmar, enviar y crear pedidos, y los disparadores
-- de las firmas. No muestra datos de clientes ni claves.
-- =====================================================================
select jsonb_build_object(
  'funciones', (
    select jsonb_object_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', pg_get_functiondef(p.oid))
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
      and p.proname in ('erp_stock_request_sign', 'erp_stock_request_dispatch', 'erp_stock_request_create', 'erp_transfer_track_sign',
                        'erp_transfer_update_items', 'erp__sr_move_out', 'erp_sr_can_view')
  ),
  'disparadores', (
    select jsonb_agg(jsonb_build_object('tabla', c.relname, 'nombre', tg.tgname, 'funcion', pr.proname,
             'codigo', case when c.relname in ('erp_transfer_signatures', 'erp_stock_request_signatures', 'erp_stock_request_items') then pg_get_functiondef(pr.oid) end))
    from pg_trigger tg join pg_class c on c.oid = tg.tgrelid join pg_proc pr on pr.oid = tg.tgfoid join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and not tg.tgisinternal and (c.relname like 'erp_transfer%' or c.relname like 'erp_stock_request%')
  )
)::text as resultado;
