-- Solo lectura: trae cómo están hoy en producción las funciones que deciden quién confirma lo que llegó
-- de un pedido interno (para abrir «Confirmar lo que llegó» a todos los que pueden hacer pedidos).
-- Córrelo en Supabase → SQL Editor y pega el resultado.
select p.proname as funcion, pg_get_functiondef(p.oid) as definicion
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('erp_stock_request_receive', 'erp_stock_request_sign', 'erp_stock_request_get', 'erp_my_point')
order by p.proname;
