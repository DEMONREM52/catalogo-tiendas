-- Solo lectura: trae cómo están hoy en producción las funciones y reglas que amarran a un vendedor a UN solo punto,
-- para dejar que un usuario venda en dos (o más) puntos sin abrirle los demás.
-- Córrelo en Supabase → SQL Editor y pega el resultado (las dos consultas).

-- 1) Funciones de venta y POS, y toda función que use erp_my_point (punto principal) en vez de la lista de puntos.
select p.proname as funcion, pg_get_functiondef(p.oid) as definicion
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and (
    p.proname in (
      'erp_sellers', 'erp_tag_order', 'create_order_from_cart', 'erp_pos_documents', 'erp_pos_order_set_items',
      'erp_pos_set_payment', 'erp_pos_submit_offline_v2', 'fiscal_offline_reserve', 'fiscal_issue_from_order',
      'fiscal_can_send', 'erp_sale_void', 'erp_sale_void_rights', 'erp_my_point', 'erp_my_points', 'erp_point_allowed', 'erp_my_scope'
    )
    or (p.prosrc ilike '%erp_my_point(%' and p.proname not like 'fiscal\_%' escape '\')
    or (p.prosrc ilike '%erp_my_point(%' and p.proname in ('fiscal_issue_from_order', 'fiscal_can_send', 'fiscal_void_unsent', 'fiscal_create_note'))
  )
order by p.proname;

-- 2) Reglas de lectura (RLS) que usan el punto principal.
select tablename as tabla, policyname as regla, cmd as accion, qual as condicion, with_check
from pg_policies
where schemaname = 'public'
  and (coalesce(qual, '') ilike '%erp_my_point(%' or coalesce(with_check, '') ilike '%erp_my_point(%')
order by tablename, policyname;
