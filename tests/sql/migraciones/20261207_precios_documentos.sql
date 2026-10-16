-- =====================================================================
-- REMHUB · Precios por mayor en traslados y pedidos internos (y su impresión)
--
--   · erp_product_list_prices: precio 2 (por mayor) y precio 3 (detal) de una
--     lista de productos, para mostrar el valor de un traslado o pedido.
--     Solo para quien tiene sesión en la tienda dueña de los productos:
--     el conductor que abre el enlace del traslado sin cuenta ve unidades,
--     no precios. Nunca entrega costos.
--   · «documento» queda reservado (ruta de las hojas imprimibles).
-- No borra datos. Es idempotente.
-- =====================================================================

create or replace function public.erp_product_list_prices(p_ids uuid[])
returns table (product_id uuid, sku text, price_2 numeric, price_3 numeric)
language sql stable security definer set search_path = public as $$
  select p.id, p.sku::text, coalesce(p.price_2, 0)::numeric, coalesce(p.price_3, 0)::numeric
  from public.products p
  where p.id = any (coalesce(p_ids[1:800], '{}'))
    and auth.uid() is not null and public.erp__is_store_member(p.store_id);
$$;
revoke all on function public.erp_product_list_prices(uuid[]) from public, anon;
grant execute on function public.erp_product_list_prices(uuid[]) to authenticated;

-- Ruta nueva de documentos imprimibles: tampoco puede ser nombre de tienda ni enlace corto.
create or replace function public.store__reserved_slug(p_slug text)
returns boolean language sql immutable as $$
  select p_slug = any (array[
    'www', 'app', 'api', 'admin', 'panel', 'dashboard', 'ayuda', 'help', 'soporte', 'estado', 'status', 'blog', 'mail', 'correo',
    'smtp', 'ftp', 'cdn', 'static', 'assets', 'img', 'docs', 'dev', 'test', 'staging', 'demo', 'remhub',
    'acceso', 'comprobante', 'forgot-password', 'instalar', 'login', 'offline', 'pedido', 'reset-password', 'traslado',
    'robots', 'sitemap', 'manifest', 'favicon', 'entrar', 'tienda-pausada', 'documento']);
$$;

create or replace function public.store__reserved_code(p_code text)
returns boolean language sql immutable as $$
  select p_code = any (array['detal', 'mayor', 'inicio', 'producto', 'dashboard', 'admin', 'login', 'acceso', 'instalar',
    'forgot-password', 'reset-password', 'offline', 'traslado', 'comprobante', 'pedido', 'api', 'robots', 'sitemap', 'manifest', 'favicon',
    'entrar', 'tienda-pausada', 'documento']);
$$;

notify pgrst, 'reload schema';
