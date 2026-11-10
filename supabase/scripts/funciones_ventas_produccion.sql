-- Solo lectura: cómo están hoy en producción las funciones de venta del POS y las reglas que amarran a un usuario
-- a UN solo punto. Sirve para: vendedores en dos puntos, prefijos únicos en todas las tiendas y que la cartera
-- se ajuste al editar una venta a crédito.
-- Es UNA sola consulta: córrela completa en Supabase → SQL Editor y pega el resultado (o descárgalo como CSV).
select 'funcion' as tipo, p.proname as nombre, pg_get_functiondef(p.oid) as definicion
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and (
    p.proname in (
      'erp_sellers', 'erp_tag_order', 'create_order_from_cart', 'erp_pos_documents', 'erp_pos_order_set_items',
      'erp_pos_set_payment', 'erp_pos_submit_offline_v2', 'fiscal_offline_reserve', 'fiscal_issue_from_order',
      'fiscal_can_send', 'erp_sale_void', 'erp_sale_void_rights', 'erp_my_point', 'erp_my_points', 'erp_point_allowed',
      'erp_my_scope', 'erp_credit_register', 'erp_credit_check', 'erp_point_save', 'erp_point_wizard_create'
    )
    or p.prosrc ilike '%erp_my_point(%'
  )
union all
select 'regla', tablename || ' · ' || policyname || ' · ' || cmd,
       coalesce('USING ' || qual, '') || coalesce(' CHECK ' || with_check, '')
from pg_policies
where schemaname = 'public'
  and (coalesce(qual, '') ilike '%erp_my_point(%' or coalesce(with_check, '') ilike '%erp_my_point(%')
order by 1, 2;
