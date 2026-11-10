-- Solo lectura: reglas (RLS) y funciones de producción que hoy piden «Productos» para catálogos, campañas y landings.
-- Sirve para separar los permisos «Catálogos» y «Landing» de «Editar productos» sin abrir de más.
-- Es UNA sola consulta: córrela completa en Supabase → SQL Editor y pega el resultado.
select 'regla' as tipo,
       schemaname || '.' || tablename || ' · ' || policyname || ' · ' || cmd as nombre,
       coalesce('USING ' || qual, '') || coalesce(' CHECK ' || with_check, '') as definicion
from pg_policies
where (schemaname = 'public' and tablename in (
        'products', 'product_categories', 'store_catalogs', 'store_catalog_categories', 'store_social_campaigns',
        'store_social_campaign_items', 'store_social_posts', 'store_links', 'store_tracking', 'billing_settings',
        'store_payment_methods', 'orders', 'erp_landing_pages', 'erp_landings', 'erp_landing_templates'))
   or (schemaname = 'storage' and tablename = 'objects')
union all
select 'funcion', p.proname, pg_get_functiondef(p.oid)
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and (p.proname like 'catalog\_admin\_%' escape '\' or p.proname in ('erp_can', 'erp_can_any', 'store_short_link_save', 'store_short_link_delete'))
order by 1, 2;
