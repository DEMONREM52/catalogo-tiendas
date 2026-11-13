-- 20261321: «¡Publícame!» en la lista de Productos.
-- Estado de publicación de varios productos en una sola consulta (antes era una por producto).
-- Mismo permiso que el resto de «¡Publícame!» (Productos). Necesita 20261305.
-- Se puede correr dos veces.

create or replace function public.product_publish_states(p_store uuid, p_products uuid[])
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.erp_can(p_store, 'products') then
    return jsonb_build_object('ok', false, 'message', 'No tienes permiso de Productos.');
  end if;
  return jsonb_build_object(
    'ok', true,
    'today', public.pub__today(),
    'states', coalesce((
      select jsonb_object_agg(p.id::text, public.pub__state(p.id))
      from public.products p
      -- Máximo 200 por consulta (una página de la lista es 20 a 50).
      where p.store_id = p_store and p.id = any ((coalesce(p_products, '{}'::uuid[]))[1:200])
    ), '{}'::jsonb)
  );
end;
$$;

revoke all on function public.product_publish_states(uuid, uuid[]) from public, anon;
grant execute on function public.product_publish_states(uuid, uuid[]) to authenticated;
