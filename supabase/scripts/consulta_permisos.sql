-- REMHUB · Consulta de permisos (SOLO LECTURA: no cambia nada)
-- Copia el resultado completo y compártelo para terminar los permisos «reports» y «costs_view».

select p.proname as funcion,
       pg_get_function_identity_arguments(p.oid) as argumentos,
       pg_get_functiondef(p.oid) as definicion
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('erp_report', 'erp_overview', 'erp_stock_page', 'erp_stock_browse', 'erp_kardex',
                    'erp_pay_supplier', 'erp_update_purchase', 'erp_cancel_purchase',
                    'erp_post_adjustment', 'erp_product_costs')
union all
select 'POLITICA ' || tablename, policyname,
       cmd || ' · ' || coalesce(qual, '') || ' · ' || coalesce(with_check, '')
from pg_policies
where schemaname = 'public' and tablename like 'erp\_%'
order by 1, 2;
