-- =====================================================================
-- REMHUB · Costo promedio sin «unidades sin costo» y precio escrito a mano
--
--   1. Costo promedio: si el producto tenía unidades SIN costo (cargadas
--      antes de usar el ingreso de factura, costo $0), al ingresar una
--      factura el costo NO se promedia con ellas: queda el costo real de la
--      factura. (Ej.: 1.999 und. a $0 + 1.000 und. a $47.900 daba $15.972.)
--      Si el producto ya tenía costo, el promedio ponderado sigue igual.
--   2. Precio por %: se redondea primero al peso y luego al paso elegido.
--      Así, si escribes el precio ($47.000) y el sistema calcula el %, el
--      precio queda exactamente en $47.000 (no salta al siguiente $1.000).
--
-- Requiere 20261113. No borra datos. Es idempotente.
-- =====================================================================

-- 1. Antes de recalcular precios: corrige el costo de un producto que no tenía costo.
--    Se detecta la factura de ESTA misma operación (misma transacción: created_at = now()).
create or replace function public.erp__product_cost_from_invoice()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_cost numeric;
begin
  if coalesce(old.cost_price, 0) > 0 or coalesce(new.cost_price, 0) <= 0 then return new; end if;
  select round(sum(i.qty * i.unit_cost) / nullif(sum(i.qty), 0), 4) into v_cost
  from public.erp_purchase_items i
  join public.erp_purchases p on p.id = i.purchase_id
  where i.product_id = new.id and p.store_id = new.store_id and p.created_at = now() and i.unit_cost > 0;
  if v_cost is not null and v_cost > 0 then new.cost_price := v_cost; end if;
  return new;
end;
$$;
-- El nombre empieza por «a_» para que corra ANTES que el cálculo de precios (erp_products_autoprice).
drop trigger if exists erp_products_a_cost_from_invoice on public.products;
create trigger erp_products_a_cost_from_invoice before update of cost_price on public.products
for each row execute function public.erp__product_cost_from_invoice();

-- 2. Precio por %: redondeo al peso y luego al paso de la tienda.
create or replace function public.erp__product_autoprice()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_step integer := 100; v_dir text := 'nearest'; v_changed boolean;
begin
  if coalesce(current_setting('erp.skip_reprice', true), '') = '1' then return new; end if;
  if coalesce(new.cost_price, 0) <= 0 then return new; end if;
  if new.markup_1 is null and new.markup_2 is null and new.markup_3 is null and new.markup_4 is null and new.markup_5 is null then return new; end if;
  v_changed := tg_op = 'INSERT'
    or new.cost_price is distinct from old.cost_price
    or new.markup_1 is distinct from old.markup_1 or new.markup_2 is distinct from old.markup_2 or new.markup_3 is distinct from old.markup_3
    or new.markup_4 is distinct from old.markup_4 or new.markup_5 is distinct from old.markup_5;
  if not v_changed then return new; end if;
  select coalesce(s.product_round_step, 100), coalesce(s.product_round_dir, 'nearest') into v_step, v_dir from public.erp_profit_settings s where s.store_id = new.store_id;
  v_step := coalesce(v_step, 100); v_dir := coalesce(v_dir, 'nearest');
  if new.markup_1 is not null then new.price_1 := public.erp__round_step(round(new.cost_price * (1 + new.markup_1 / 100), 0), v_step, v_dir); end if;
  if new.markup_2 is not null then new.price_2 := public.erp__round_step(round(new.cost_price * (1 + new.markup_2 / 100), 0), v_step, v_dir); end if;
  if new.markup_3 is not null then new.price_3 := public.erp__round_step(round(new.cost_price * (1 + new.markup_3 / 100), 0), v_step, v_dir); end if;
  if new.markup_4 is not null then new.price_4 := public.erp__round_step(round(new.cost_price * (1 + new.markup_4 / 100), 0), v_step, v_dir); end if;
  if new.markup_5 is not null then new.price_5 := public.erp__round_step(round(new.cost_price * (1 + new.markup_5 / 100), 0), v_step, v_dir); end if;
  new.price_retail := new.price_3;
  new.price_wholesale := new.price_2;
  return new;
end;
$$;

notify pgrst, 'reload schema';
