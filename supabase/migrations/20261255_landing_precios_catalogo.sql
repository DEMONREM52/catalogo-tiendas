-- =====================================================================
-- REMHUB · Landing pages: leer bien el precio y las existencias del catálogo
--
--   En producción catalog_public_stock devuelve una lista JSON
--   ([{"id":…,"price":…,"stock":…}]) y no filas; erp__landing_prices la leía
--   como fila y quedaba vacía → la landing decía «Esta oferta se agotó».
--   Ahora acepta las dos formas (filas, lista JSON o {"items": […]}).
-- Requiere 20261252. No borra datos. Es idempotente.
-- =====================================================================

create or replace function public.erp__landing_prices(p_store text, p_catalog text, p_key text, p_ids uuid[])
returns table (id uuid, price numeric, stock numeric)
language plpgsql stable security definer set search_path = public as $$
declare
  v jsonb;
  e jsonb;
begin
  if coalesce(array_length(p_ids, 1), 0) = 0 then return; end if;
  for v in select to_jsonb(x) from public.catalog_public_stock(p_store => p_store, p_catalog => p_catalog, p_key => p_key, p_ids => p_ids) x loop
    -- Función que devuelve un solo valor: to_jsonb trae {"<columna>": valor}; se desenvuelve.
    if jsonb_typeof(v) = 'object' and not (v ? 'id' or v ? 'product_id' or v ? 'items') and (select count(*) from jsonb_object_keys(v)) = 1 then
      select t.value into v from jsonb_each(v) t limit 1;
    end if;
    if jsonb_typeof(v) = 'object' and jsonb_typeof(v -> 'items') = 'array' then v := v -> 'items'; end if;
    for e in select a.value from jsonb_array_elements(case when jsonb_typeof(v) = 'array' then v else jsonb_build_array(v) end) a loop
      continue when jsonb_typeof(e) <> 'object' or coalesce(e ->> 'id', e ->> 'product_id', '') !~* '^[0-9a-f-]{36}$';
      id := (coalesce(e ->> 'id', e ->> 'product_id'))::uuid;
      price := nullif(e ->> 'price', '')::numeric;
      stock := nullif(e ->> 'stock', '')::numeric;
      return next;
    end loop;
  end loop;
end $$;
revoke all on function public.erp__landing_prices(text, text, text, uuid[]) from public, anon, authenticated;
