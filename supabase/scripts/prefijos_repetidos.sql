-- Solo lectura: prefijos y consecutivos de cada punto de LA VITRINA, y hasta qué número ya se usó cada prefijo.
-- Sirve para ver por qué la Bodega principal choca con REM-00001. Córrelo en Supabase → SQL Editor y pega el resultado.
with st as (select id from public.stores where name ilike 'la vitrina' limit 1),
used as (
  select m.doc_prefix, m.doc_kind, max(m.doc_seq) as ultimo_usado, count(*) as documentos,
         string_agg(distinct w.name, ', ') as puntos_que_lo_usan
  from public.erp_order_meta m
  join st on st.id = m.store_id
  left join public.erp_warehouses w on w.id = m.point_id
  group by m.doc_prefix, m.doc_kind
)
select w.name as punto, w.kind, w.active,
       w.remision_prefix, w.next_remision_number,
       ur.ultimo_usado as remision_ultimo_usado, ur.puntos_que_lo_usan as remision_prefijo_usado_por,
       w.invoice_prefix, w.next_invoice_number,
       uf.ultimo_usado as factura_ultimo_usado, uf.puntos_que_lo_usan as factura_prefijo_usado_por
from public.erp_warehouses w
join st on st.id = w.store_id
left join used ur on ur.doc_prefix = w.remision_prefix and ur.doc_kind = 'remision'
left join used uf on uf.doc_prefix = w.invoice_prefix and uf.doc_kind = 'factura'
order by w.kind desc, w.name;
