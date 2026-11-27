-- =====================================================================
-- REMHUB · Conteo en grupo con contraseña: invitados sin cuenta (sobre 20261351)
--
--   Pedido del usuario (27/11/2026): «que se pueda crear una contraseña de mínimo 4 dígitos
--   y que no importa a quién le comparta el link, al ingresar la contraseña puede entrar»;
--   «solo el anfitrión necesita [cuenta], y si tiene permiso, entrar a cerrarlo».
--
--   · El anfitrión (quien abrió el conteo o quien tiene «Ajustes de inventario») pone una
--     contraseña de 4 a 8 dígitos. Se guarda cifrada (con sal), nunca en claro.
--   · El enlace público es /conteo/<código>: un código aparte, imposible de adivinar (no es
--     el del conteo). Sin contraseña puesta, ese enlace no abre nada.
--   · Quien tenga el enlace escribe su nombre y la contraseña y cuenta. No necesita cuenta.
--   · 10 contraseñas equivocadas seguidas bloquean el enlace 15 minutos.
--   · El invitado SOLO cuenta: busca y anota lo suyo. No ve lo que dice el sistema (aunque
--     el conteo no sea a ciegas), ni costos, ni precios; no termina, no aplica, no anula.
--   · Cambiar la contraseña o el enlace saca a los invitados (deben volver a entrar); lo que
--     ya anotaron se queda.
--   · Terminar, pasar al ajuste y aplicar sigue igual: con cuenta y con «Ajustes de inventario».
--
--   Anfitrión: erp_gc_set_pin · erp_gc_new_link
--   Invitados (sin sesión): erp_gc_guest_info · erp_gc_guest_join · erp_gc_guest_get ·
--                           erp_gc_guest_set · erp_gc_guest_remove · erp_gc_guest_search
-- Requiere 20261351. No borra datos. Es idempotente.
-- =====================================================================

do $$
begin
  if to_regclass('public.erp_group_counts') is null then raise exception 'Primero corre 20261351_conteo_en_grupo.sql.'; end if;
end $$;

alter table public.erp_group_counts add column if not exists share_token uuid not null default gen_random_uuid();
alter table public.erp_group_counts add column if not exists pin_salt text;
alter table public.erp_group_counts add column if not exists pin_hash text;
alter table public.erp_group_counts add column if not exists pin_version integer not null default 0;
alter table public.erp_group_counts add column if not exists pin_failed integer not null default 0;
alter table public.erp_group_counts add column if not exists pin_locked_until timestamptz;
create unique index if not exists erp_group_counts_share_token on public.erp_group_counts (share_token);

create table if not exists public.erp_group_count_guests (
  id uuid primary key default gen_random_uuid(),
  count_id uuid not null references public.erp_group_counts(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  secret_hash text not null,
  pin_version integer not null,
  created_at timestamptz not null default clock_timestamp(),
  last_seen_at timestamptz not null default clock_timestamp()
);
create index if not exists erp_group_count_guests_count on public.erp_group_count_guests (count_id);
alter table public.erp_group_count_guests enable row level security;
revoke all on public.erp_group_count_guests from anon, authenticated;

create or replace function public.erp__gc_hash(p_salt text, p_value text)
returns text language sql immutable as $$
  select encode(sha256(convert_to(coalesce(p_salt, '') || ':' || coalesce(p_value, ''), 'UTF8')), 'hex');
$$;
revoke all on function public.erp__gc_hash(text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------- lo común: anotar y ver

/** Anotar lo de una persona (con cuenta o invitada). Igual que erp_gc_set (20261351), para los dos casos. */
create or replace function public.erp__gc_put(g public.erp_group_counts, p_actor uuid, p_actor_name text, p_product uuid, p_qty integer, p_add boolean, p_key uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_new int; v_mine int; v_total int;
begin
  if p_qty is null or abs(p_qty) > 1000000 then raise exception 'Escribe una cantidad válida.'; end if;
  if not coalesce(p_add, false) and p_qty < 0 then raise exception 'La cantidad no puede ser negativa.'; end if;
  if not exists (select 1 from public.products where id = p_product and store_id = g.store_id) then raise exception 'Ese producto no es de la tienda.'; end if;
  if p_key is not null then
    if exists (select 1 from public.erp_group_count_ops where key = p_key) then
      select coalesce(sum(qty), 0) into v_total from public.erp_group_count_lines where count_id = g.id and product_id = p_product;
      select qty into v_mine from public.erp_group_count_lines where count_id = g.id and product_id = p_product and user_id = p_actor;
      return jsonb_build_object('ok', true, 'mine', coalesce(v_mine, 0), 'total', v_total, 'repeated', true);
    end if;
    insert into public.erp_group_count_ops (key, count_id) values (p_key, g.id);
  end if;
  select qty into v_mine from public.erp_group_count_lines where count_id = g.id and product_id = p_product and user_id = p_actor for update;
  v_new := case when coalesce(p_add, false) then coalesce(v_mine, 0) + p_qty else p_qty end;
  if v_new < 0 then v_new := 0; end if;
  if v_new > 1000000 then raise exception 'Escribe una cantidad válida.'; end if;
  insert into public.erp_group_count_lines (count_id, product_id, user_id, user_name, qty)
  values (g.id, p_product, p_actor, p_actor_name, v_new)
  on conflict (count_id, product_id, user_id) do update set qty = excluded.qty, user_name = excluded.user_name, updated_at = clock_timestamp();
  update public.erp_group_counts set updated_at = clock_timestamp() where id = g.id;
  select coalesce(sum(qty), 0) into v_total from public.erp_group_count_lines where count_id = g.id and product_id = p_product;
  return jsonb_build_object('ok', true, 'mine', v_new, 'total', v_total);
end $$;
revoke all on function public.erp__gc_put(public.erp_group_counts, uuid, text, uuid, integer, boolean, uuid) from public, anon, authenticated;

/** Lo contado por todos, visto por una persona (p_actor). p_system: si se muestra lo que dice el sistema. */
create or replace function public.erp__gc_lines(g public.erp_group_counts, p_actor uuid, p_system boolean)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce((
    select jsonb_agg(jsonb_build_object(
      'product_id', p.id, 'name', p.name, 'sku', p.sku, 'barcode', p.barcode, 'image_url', p.image_url,
      'total', x.total, 'mine', x.mine, 'by', x.by_people, 'updated_at', x.at,
      'system', case when p_system and not g.blind then coalesce((select sl.qty from public.erp_stock_levels sl where sl.warehouse_id = g.warehouse_id and sl.product_id = p.id), 0) end
    ) order by x.at desc)
    from (select l.product_id, sum(l.qty)::int total, max(case when l.user_id = p_actor then l.qty end) mine, max(l.updated_at) at,
                 jsonb_agg(jsonb_build_object('name', l.user_name, 'qty', l.qty) order by l.updated_at) by_people
            from public.erp_group_count_lines l where l.count_id = g.id group by l.product_id) x
    join public.products p on p.id = x.product_id), '[]'::jsonb);
$$;
revoke all on function public.erp__gc_lines(public.erp_group_counts, uuid, boolean) from public, anon, authenticated;

create or replace function public.erp__gc_people(g public.erp_group_counts, p_actor uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce((select jsonb_agg(jsonb_build_object('name', x.user_name, 'products', x.n, 'units', x.u, 'mine', x.user_id = p_actor) order by x.u desc)
                     from (select user_id, max(user_name) user_name, count(*) n, sum(qty) u from public.erp_group_count_lines where count_id = g.id group by user_id) x), '[]'::jsonb);
$$;
revoke all on function public.erp__gc_people(public.erp_group_counts, uuid) from public, anon, authenticated;

-- Con cuenta: igual que antes, pero por la parte común.
create or replace function public.erp_gc_set(p_id uuid, p_product uuid, p_qty integer, p_add boolean default false, p_key uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare g public.erp_group_counts;
begin
  g := public.erp__gc_lock(p_id, 'count', array['open']);
  return public.erp__gc_put(g, auth.uid(), public.erp_actor_name(g.store_id), p_product, p_qty, p_add, p_key);
end $$;
revoke all on function public.erp_gc_set(uuid, uuid, integer, boolean, uuid) from public, anon;
grant execute on function public.erp_gc_set(uuid, uuid, integer, boolean, uuid) to authenticated;

/** Con cuenta: el conteo con lo de todos. El anfitrión ve también si tiene contraseña y su enlace público. */
create or replace function public.erp_gc_get(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare g public.erp_group_counts; v_acc text; v_wh text; v_host boolean;
begin
  select * into g from public.erp_group_counts where id = p_id;
  if not found then return null; end if;
  v_acc := public.erp__gc_access(g.store_id, g.warehouse_id);
  if v_acc is null then return null; end if;
  v_host := v_acc = 'adjust' or g.created_by = auth.uid();
  select name into v_wh from public.erp_warehouses where id = g.warehouse_id;
  return jsonb_build_object(
    'count', jsonb_build_object('id', g.id, 'store_id', g.store_id, 'warehouse_id', g.warehouse_id, 'warehouse', v_wh, 'name', g.name,
      'blind', g.blind, 'status', g.status, 'created_by_name', g.created_by_name, 'created_at', g.created_at, 'updated_at', g.updated_at,
      'closed_by_name', g.closed_by_name, 'closed_at', g.closed_at, 'finished_by_name', g.finished_by_name, 'finished_at', g.finished_at,
      'has_pin', g.pin_hash is not null,
      'share_token', case when v_host and g.pin_hash is not null then g.share_token end,
      'guests', (select count(*) from public.erp_group_count_guests x where x.count_id = g.id and x.pin_version = g.pin_version)),
    'can_adjust', v_acc = 'adjust',
    'can_host', v_host,
    'me', public.erp_actor_name(g.store_id),
    'people', public.erp__gc_people(g, auth.uid()),
    'lines', public.erp__gc_lines(g, auth.uid(), true));
end $$;
revoke all on function public.erp_gc_get(uuid) from public, anon;
grant execute on function public.erp_gc_get(uuid) to authenticated;

-- ---------------------------------------------------------------- anfitrión

/** Poner (4 a 8 dígitos), cambiar o quitar (vacío) la contraseña para invitados. Quien abrió el conteo o quien tiene «Ajustes de inventario». */
create or replace function public.erp_gc_set_pin(p_id uuid, p_pin text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare g public.erp_group_counts; v_acc text; v_pin text := nullif(btrim(coalesce(p_pin, '')), ''); v_salt text;
begin
  select * into g from public.erp_group_counts where id = p_id for update;
  if not found then raise exception 'Conteo no encontrado.'; end if;
  v_acc := public.erp__gc_access(g.store_id, g.warehouse_id);
  if v_acc is null or not (v_acc = 'adjust' or g.created_by = auth.uid()) then raise exception 'La contraseña la pone quien abrió el conteo o quien tiene «Ajustes de inventario».'; end if;
  if g.status not in ('open', 'closed') then raise exception 'Este conteo ya terminó.'; end if;
  if v_pin is not null and v_pin !~ '^\d{4,8}$' then raise exception 'La contraseña debe tener de 4 a 8 números.'; end if;
  v_salt := case when v_pin is null then null else replace(gen_random_uuid()::text, '-', '') end;
  update public.erp_group_counts set
    pin_salt = v_salt, pin_hash = case when v_pin is null then null else public.erp__gc_hash(v_salt, v_pin) end,
    pin_version = pin_version + 1, pin_failed = 0, pin_locked_until = null, updated_at = clock_timestamp()
   where id = g.id returning * into g;
  perform public.erp__gc_audit(g, case when v_pin is null then 'group_count.pin_removed' else 'group_count.pin_set' end, null);
  return jsonb_build_object('ok', true, 'has_pin', v_pin is not null, 'share_token', case when v_pin is not null then g.share_token end);
end $$;
revoke all on function public.erp_gc_set_pin(uuid, text) from public, anon;
grant execute on function public.erp_gc_set_pin(uuid, text) to authenticated;

/** Enlace nuevo: el anterior deja de servir y los invitados deben volver a entrar (lo anotado se queda). */
create or replace function public.erp_gc_new_link(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare g public.erp_group_counts; v_acc text;
begin
  select * into g from public.erp_group_counts where id = p_id for update;
  if not found then raise exception 'Conteo no encontrado.'; end if;
  v_acc := public.erp__gc_access(g.store_id, g.warehouse_id);
  if v_acc is null or not (v_acc = 'adjust' or g.created_by = auth.uid()) then raise exception 'El enlace lo cambia quien abrió el conteo o quien tiene «Ajustes de inventario».'; end if;
  update public.erp_group_counts set share_token = gen_random_uuid(), pin_version = pin_version + 1, pin_failed = 0, pin_locked_until = null, updated_at = clock_timestamp()
   where id = g.id returning * into g;
  perform public.erp__gc_audit(g, 'group_count.new_link', null);
  return jsonb_build_object('ok', true, 'share_token', case when g.pin_hash is not null then g.share_token end);
end $$;
revoke all on function public.erp_gc_new_link(uuid) from public, anon;
grant execute on function public.erp_gc_new_link(uuid) to authenticated;

-- ---------------------------------------------------------------- invitados (sin sesión)

/** Lo mínimo para mostrar la entrada: tienda, bodega, nombre y si está bloqueado. Sin contraseña puesta, nada. */
create or replace function public.erp_gc_guest_info(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare g public.erp_group_counts;
begin
  if coalesce(p_token, '') !~ '^[0-9a-fA-F-]{36}$' then return jsonb_build_object('ok', false); end if;
  select * into g from public.erp_group_counts where share_token = p_token::uuid;
  if not found or g.pin_hash is null then return jsonb_build_object('ok', false); end if;
  return jsonb_build_object('ok', true, 'name', g.name, 'status', g.status,
    'warehouse', (select name from public.erp_warehouses where id = g.warehouse_id),
    'store', (select name from public.stores where id = g.store_id),
    'logo_url', (select logo_url from public.stores where id = g.store_id),
    'locked_minutes', case when g.pin_locked_until > now() then ceil(extract(epoch from g.pin_locked_until - now()) / 60)::int else 0 end);
end $$;
revoke all on function public.erp_gc_guest_info(text) from public;
grant execute on function public.erp_gc_guest_info(text) to anon, authenticated;

/**
 * Entrar con nombre y contraseña. No lanza error al equivocarse (así el intento fallido queda contado):
 * devuelve {ok:false, error}. 10 seguidos bloquean 15 minutos. Bien: {ok, guest_id, secret} (el secreto solo se ve aquí).
 */
create or replace function public.erp_gc_guest_join(p_token text, p_pin text, p_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare g public.erp_group_counts; v_name text := btrim(left(coalesce(p_name, ''), 40)); v_secret text; v_id uuid;
begin
  if coalesce(p_token, '') !~ '^[0-9a-fA-F-]{36}$' then return jsonb_build_object('ok', false, 'error', 'Enlace no válido.'); end if;
  select * into g from public.erp_group_counts where share_token = p_token::uuid for update;
  if not found or g.pin_hash is null then return jsonb_build_object('ok', false, 'error', 'Enlace no válido o sin contraseña.'); end if;
  if g.status <> 'open' then return jsonb_build_object('ok', false, 'error', 'Este conteo ya terminó.'); end if;
  if g.pin_locked_until > now() then
    return jsonb_build_object('ok', false, 'error', 'Demasiados intentos. Espera ' || ceil(extract(epoch from g.pin_locked_until - now()) / 60)::int || ' min.');
  end if;
  if v_name = '' then return jsonb_build_object('ok', false, 'error', 'Escribe tu nombre.'); end if;
  if public.erp__gc_hash(g.pin_salt, btrim(coalesce(p_pin, ''))) <> g.pin_hash then
    update public.erp_group_counts set
      pin_failed = case when pin_failed + 1 >= 10 then 0 else pin_failed + 1 end,
      pin_locked_until = case when pin_failed + 1 >= 10 then now() + interval '15 minutes' else pin_locked_until end
     where id = g.id;
    return jsonb_build_object('ok', false, 'error', case when g.pin_failed + 1 >= 10 then 'Demasiados intentos. Espera 15 min.' else 'Contraseña equivocada.' end,
      'left', greatest(0, 9 - g.pin_failed));
  end if;
  update public.erp_group_counts set pin_failed = 0 where id = g.id;
  v_secret := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into public.erp_group_count_guests (count_id, name, secret_hash, pin_version)
  values (g.id, v_name, public.erp__gc_hash(g.id::text, v_secret), g.pin_version) returning id into v_id;
  perform public.erp__gc_audit(g, 'group_count.guest_join', jsonb_build_object('guest', v_name));
  return jsonb_build_object('ok', true, 'guest_id', v_id, 'secret', v_secret, 'name', v_name);
end $$;
revoke all on function public.erp_gc_guest_join(text, text, text) from public;
grant execute on function public.erp_gc_guest_join(text, text, text) to anon, authenticated;

/** El conteo de un invitado válido (enlace vigente, mismo cambio de contraseña, secreto correcto). */
create or replace function public.erp__gc_guest(p_token text, p_guest uuid, p_secret text, p_lock boolean)
returns public.erp_group_counts language plpgsql security definer set search_path = public as $$
declare g public.erp_group_counts; v_ok boolean;
begin
  if coalesce(p_token, '') !~ '^[0-9a-fA-F-]{36}$' then raise exception 'Vuelve a entrar con la contraseña.'; end if;
  if p_lock then select * into g from public.erp_group_counts where share_token = p_token::uuid for update;
  else select * into g from public.erp_group_counts where share_token = p_token::uuid; end if;
  if not found or g.pin_hash is null then raise exception 'Vuelve a entrar con la contraseña.'; end if;
  select exists (select 1 from public.erp_group_count_guests x where x.id = p_guest and x.count_id = g.id and x.pin_version = g.pin_version
                   and x.secret_hash = public.erp__gc_hash(g.id::text, coalesce(p_secret, ''))) into v_ok;
  if not v_ok then raise exception 'Vuelve a entrar con la contraseña.'; end if;
  return g;
end $$;
revoke all on function public.erp__gc_guest(text, uuid, text, boolean) from public, anon, authenticated;

/** Lo contado por todos, para el invitado (nunca lo que dice el sistema). */
create or replace function public.erp_gc_guest_get(p_token text, p_guest uuid, p_secret text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare g public.erp_group_counts; v_me text;
begin
  g := public.erp__gc_guest(p_token, p_guest, p_secret, false);
  update public.erp_group_count_guests set last_seen_at = clock_timestamp() where id = p_guest returning name into v_me;
  return jsonb_build_object(
    'count', jsonb_build_object('name', g.name, 'status', g.status, 'blind', true,
      'warehouse', (select name from public.erp_warehouses where id = g.warehouse_id),
      'store', (select name from public.stores where id = g.store_id), 'created_by_name', g.created_by_name),
    'me', v_me,
    'people', public.erp__gc_people(g, p_guest),
    'lines', public.erp__gc_lines(g, p_guest, false));
end $$;
revoke all on function public.erp_gc_guest_get(text, uuid, text) from public;
grant execute on function public.erp_gc_guest_get(text, uuid, text) to anon, authenticated;

create or replace function public.erp_gc_guest_set(p_token text, p_guest uuid, p_secret text, p_product uuid, p_qty integer, p_add boolean default false, p_key uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare g public.erp_group_counts; v_name text;
begin
  g := public.erp__gc_guest(p_token, p_guest, p_secret, true);
  if g.status <> 'open' then raise exception 'El conteo ya terminó: ya no se anota.'; end if;
  select name into v_name from public.erp_group_count_guests where id = p_guest;
  return public.erp__gc_put(g, p_guest, v_name || ' (invitado)', p_product, p_qty, p_add, p_key);
end $$;
revoke all on function public.erp_gc_guest_set(text, uuid, text, uuid, integer, boolean, uuid) from public;
grant execute on function public.erp_gc_guest_set(text, uuid, text, uuid, integer, boolean, uuid) to anon, authenticated;

create or replace function public.erp_gc_guest_remove(p_token text, p_guest uuid, p_secret text, p_product uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare g public.erp_group_counts;
begin
  g := public.erp__gc_guest(p_token, p_guest, p_secret, true);
  if g.status <> 'open' then raise exception 'El conteo ya terminó: ya no se anota.'; end if;
  delete from public.erp_group_count_lines where count_id = g.id and product_id = p_product and user_id = p_guest;
  update public.erp_group_counts set updated_at = clock_timestamp() where id = g.id;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.erp_gc_guest_remove(text, uuid, text, uuid) from public;
grant execute on function public.erp_gc_guest_remove(text, uuid, text, uuid) to anon, authenticated;

/** Buscar productos de la tienda para contarlos: nombre, referencia o código. Sin precios ni costos ni existencias. Máximo 20. */
create or replace function public.erp_gc_guest_search(p_token text, p_guest uuid, p_secret text, p_q text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare g public.erp_group_counts; v_q text := btrim(left(coalesce(p_q, ''), 80)); v_like text;
begin
  g := public.erp__gc_guest(p_token, p_guest, p_secret, false);
  if v_q = '' then return '[]'::jsonb; end if;
  v_like := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'sku', p.sku, 'barcode', p.barcode, 'image_url', p.image_url, 'exact', x.exact) order by x.exact desc, p.name)
      from (select p2.id, (upper(btrim(coalesce(p2.sku, ''))) = upper(v_q) or btrim(coalesce(p2.barcode, '')) = v_q) as exact
              from public.products p2
             where p2.store_id = g.store_id
               and (p2.name ilike v_like or p2.sku ilike v_like or p2.barcode = v_q)
             order by 2 desc, p2.name limit 20) x
      join public.products p on p.id = x.id), '[]'::jsonb);
end $$;
revoke all on function public.erp_gc_guest_search(text, uuid, text, text) from public;
grant execute on function public.erp_gc_guest_search(text, uuid, text, text) to anon, authenticated;

notify pgrst, 'reload schema';
