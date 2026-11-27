-- =====================================================================
-- REMHUB · Label Studio: plantillas de etiquetas, impresoras e historial (sobre 20261346)
--
--   · label_templates: diseños guardados por tienda (JSON validado en la app y con tope de tamaño aquí).
--       Cada cambio guarda la versión anterior en label_template_versions (las últimas 30).
--   · label_printer_profiles: papel e impresora (rollo de 3 columnas, hoja carta…), por tienda.
--   · label_print_jobs: historial de lo que se mandó a imprimir (no dice que salió bien en papel:
--       RemHub no recibe confirmación de la impresora).
--   · Una sola plantilla y un solo perfil «predeterminado» por tienda (label_set_default).
--
-- Permisos (RLS): ven las de su tienda quienes pueden ver la lista general de productos
-- (products_view, products, inventory, stock_requests, stock_requests_manage, transfers, pos);
-- crean y cambian plantillas quienes editan productos (products); perfiles, products o inventory.
-- Nada es público ni de otra tienda. No borra datos. Es idempotente.
-- =====================================================================

create table if not exists public.label_templates (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  category text check (category is null or char_length(category) <= 40),
  design jsonb not null check (jsonb_typeof(design) = 'object' and octet_length(design::text) <= 700000),
  is_default boolean not null default false,
  favorite boolean not null default false,
  archived_at timestamptz,
  version integer not null default 1,
  created_by uuid default auth.uid(),
  updated_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists label_templates_store on public.label_templates (store_id, archived_at);
create unique index if not exists label_templates_one_default on public.label_templates (store_id) where is_default and archived_at is null;

create table if not exists public.label_template_versions (
  id bigint generated always as identity primary key,
  template_id uuid not null references public.label_templates(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  version integer not null,
  name text not null,
  design jsonb not null,
  saved_by uuid,
  saved_at timestamptz not null default now()
);
create index if not exists label_template_versions_tpl on public.label_template_versions (template_id, version desc);

create table if not exists public.label_printer_profiles (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  profile jsonb not null check (jsonb_typeof(profile) = 'object' and octet_length(profile::text) <= 20000),
  is_default boolean not null default false,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists label_printer_profiles_store on public.label_printer_profiles (store_id);
create unique index if not exists label_printer_profiles_one_default on public.label_printer_profiles (store_id) where is_default;

create table if not exists public.label_print_jobs (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  user_id uuid not null default auth.uid(),
  user_name text,
  template_id uuid references public.label_templates(id) on delete set null,
  template_name text not null check (char_length(template_name) <= 80),
  profile_name text not null check (char_length(profile_name) <= 80),
  items jsonb not null check (jsonb_typeof(items) = 'array' and octet_length(items::text) <= 300000),
  total_labels integer not null check (total_labels between 1 and 20000),
  method text not null check (method in ('dialog')),
  status text not null default 'sent' check (status in ('generated', 'sent')),
  client_key uuid unique,
  created_at timestamptz not null default now()
);
create index if not exists label_print_jobs_store on public.label_print_jobs (store_id, created_at desc);

-- ---------------------------------------------------------------------
-- Versiones: cada cambio de diseño o nombre guarda el anterior (las últimas 30)
-- ---------------------------------------------------------------------
create or replace function public.label_templates__touch()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.store_id <> old.store_id then raise exception 'Una plantilla no se puede pasar a otra tienda.'; end if;
  if new.design is distinct from old.design or new.name is distinct from old.name then
    insert into public.label_template_versions (template_id, store_id, version, name, design, saved_by)
    values (old.id, old.store_id, old.version, old.name, old.design, coalesce(old.updated_by, old.created_by));
    delete from public.label_template_versions
    where template_id = old.id and id not in (
      select id from public.label_template_versions where template_id = old.id order by version desc, id desc limit 30);
    new.version := old.version + 1;
  end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  return new;
end $$;
revoke all on function public.label_templates__touch() from public, anon, authenticated;
drop trigger if exists label_templates_touch on public.label_templates;
create trigger label_templates_touch before update on public.label_templates
  for each row execute function public.label_templates__touch();

create or replace function public.label_profiles__touch()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.store_id <> old.store_id then raise exception 'Un perfil no se puede pasar a otra tienda.'; end if;
  new.updated_at := now();
  return new;
end $$;
revoke all on function public.label_profiles__touch() from public, anon, authenticated;
drop trigger if exists label_printer_profiles_touch on public.label_printer_profiles;
create trigger label_printer_profiles_touch before update on public.label_printer_profiles
  for each row execute function public.label_profiles__touch();

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.label_templates enable row level security;
alter table public.label_template_versions enable row level security;
alter table public.label_printer_profiles enable row level security;
alter table public.label_print_jobs enable row level security;
-- Supabase da todo a «authenticated» por defecto: se quita y se da solo lo necesario.
revoke all on public.label_templates, public.label_template_versions, public.label_printer_profiles, public.label_print_jobs from anon, authenticated, public;
grant select, insert, update, delete on public.label_templates, public.label_printer_profiles to authenticated;
grant select on public.label_template_versions to authenticated;
grant select, insert on public.label_print_jobs to authenticated;

drop policy if exists label_templates_read on public.label_templates;
create policy label_templates_read on public.label_templates for select to authenticated
  using (public.erp_can_any(store_id, array['products_view', 'products', 'inventory', 'stock_requests', 'stock_requests_manage', 'transfers', 'pos']::text[]));
drop policy if exists label_templates_write on public.label_templates;
create policy label_templates_write on public.label_templates for insert to authenticated
  with check (public.erp_can_any(store_id, array['products']::text[]) and created_by is not distinct from auth.uid() and version = 1);
drop policy if exists label_templates_update on public.label_templates;
create policy label_templates_update on public.label_templates for update to authenticated
  using (public.erp_can_any(store_id, array['products']::text[])) with check (public.erp_can_any(store_id, array['products']::text[]));
drop policy if exists label_templates_delete on public.label_templates;
create policy label_templates_delete on public.label_templates for delete to authenticated
  using (public.erp_can_any(store_id, array['products']::text[]));

drop policy if exists label_template_versions_read on public.label_template_versions;
create policy label_template_versions_read on public.label_template_versions for select to authenticated
  using (public.erp_can_any(store_id, array['products']::text[]));

drop policy if exists label_profiles_read on public.label_printer_profiles;
create policy label_profiles_read on public.label_printer_profiles for select to authenticated
  using (public.erp_can_any(store_id, array['products_view', 'products', 'inventory', 'stock_requests', 'stock_requests_manage', 'transfers', 'pos']::text[]));
drop policy if exists label_profiles_insert on public.label_printer_profiles;
create policy label_profiles_insert on public.label_printer_profiles for insert to authenticated
  with check (public.erp_can_any(store_id, array['products', 'inventory']::text[]));
drop policy if exists label_profiles_update on public.label_printer_profiles;
create policy label_profiles_update on public.label_printer_profiles for update to authenticated
  using (public.erp_can_any(store_id, array['products', 'inventory']::text[])) with check (public.erp_can_any(store_id, array['products', 'inventory']::text[]));
drop policy if exists label_profiles_delete on public.label_printer_profiles;
create policy label_profiles_delete on public.label_printer_profiles for delete to authenticated
  using (public.erp_can_any(store_id, array['products', 'inventory']::text[]));

-- Historial: cada quien registra lo suyo; lo ven quienes ven la lista de productos de la tienda.
drop policy if exists label_jobs_read on public.label_print_jobs;
create policy label_jobs_read on public.label_print_jobs for select to authenticated
  using (public.erp_can_any(store_id, array['products_view', 'products', 'inventory', 'stock_requests', 'stock_requests_manage', 'transfers', 'pos']::text[]));
drop policy if exists label_jobs_insert on public.label_print_jobs;
create policy label_jobs_insert on public.label_print_jobs for insert to authenticated
  with check (user_id = auth.uid()
    and public.erp_can_any(store_id, array['products_view', 'products', 'inventory', 'stock_requests', 'stock_requests_manage', 'transfers', 'pos']::text[]));

-- ---------------------------------------------------------------------
-- Predeterminada: una sola por tienda, en un solo paso (sin choques entre dos personas)
-- ---------------------------------------------------------------------
create or replace function public.label_set_default(p_kind text, p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_store uuid;
begin
  if p_kind = 'template' then
    select store_id into v_store from public.label_templates where id = p_id and archived_at is null;
    if v_store is null then raise exception 'Esa plantilla no existe o está archivada.'; end if;
    if not public.erp_can_any(v_store, array['products']::text[]) then raise exception 'No tienes permiso para cambiar las plantillas.'; end if;
    perform pg_advisory_xact_lock(hashtext('label_default_tpl:' || v_store::text));
    update public.label_templates set is_default = false where store_id = v_store and is_default and id <> p_id;
    update public.label_templates set is_default = true where id = p_id;
  elsif p_kind = 'profile' then
    select store_id into v_store from public.label_printer_profiles where id = p_id;
    if v_store is null then raise exception 'Ese perfil no existe.'; end if;
    if not public.erp_can_any(v_store, array['products', 'inventory']::text[]) then raise exception 'No tienes permiso para cambiar las impresoras.'; end if;
    perform pg_advisory_xact_lock(hashtext('label_default_prof:' || v_store::text));
    update public.label_printer_profiles set is_default = false where store_id = v_store and is_default and id <> p_id;
    update public.label_printer_profiles set is_default = true where id = p_id;
  else
    raise exception 'Tipo no válido.';
  end if;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.label_set_default(text, uuid) from public, anon;
grant execute on function public.label_set_default(text, uuid) to authenticated;

notify pgrst, 'reload schema';
