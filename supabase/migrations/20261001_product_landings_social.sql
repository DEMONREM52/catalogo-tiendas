alter table public.products
  add column if not exists product_details jsonb not null default '{}'::jsonb;

alter table public.products
  drop constraint if exists products_product_details_object_check;
alter table public.products
  add constraint products_product_details_object_check
  check (jsonb_typeof(product_details) = 'object');

create table if not exists public.store_social_campaigns (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 160),
  description text not null default '',
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists store_social_campaigns_store_updated_idx
  on public.store_social_campaigns (store_id, updated_at desc);

create table if not exists public.store_social_posts (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  campaign_id uuid references public.store_social_campaigns(id) on delete set null,
  platform text not null check (platform in (
    'facebook', 'instagram', 'facebook_marketplace', 'whatsapp',
    'tiktok', 'pinterest', 'mercadolibre'
  )),
  status text not null default 'draft' check (status in (
    'draft', 'review', 'ready', 'scheduled', 'published', 'failed'
  )),
  title text not null default '',
  caption text not null default '',
  image_urls jsonb not null default '[]'::jsonb check (jsonb_typeof(image_urls) = 'array'),
  product_snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(product_snapshot) = 'object'),
  policy_warnings jsonb not null default '[]'::jsonb check (jsonb_typeof(policy_warnings) = 'array'),
  scheduled_at timestamptz,
  external_post_id text,
  error_message text,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  check ((status = 'scheduled' and scheduled_at is not null) or status <> 'scheduled'),
  check ((status = 'published' and published_at is not null) or status <> 'published')
);

create index if not exists store_social_posts_store_status_created_idx
  on public.store_social_posts (store_id, status, created_at desc);
create index if not exists store_social_posts_product_idx
  on public.store_social_posts (store_id, product_id, created_at desc);
create index if not exists store_social_posts_campaign_idx
  on public.store_social_posts (store_id, campaign_id, created_at desc);

create table if not exists public.store_social_campaign_items (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  campaign_id uuid not null references public.store_social_campaigns(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (campaign_id, product_id)
);

create index if not exists store_social_campaign_items_store_idx
  on public.store_social_campaign_items (store_id, campaign_id);

create or replace function public.can_manage_store_social(p_store_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_allowed boolean := false;
begin
  if v_user_id is null or p_store_id is null then
    return false;
  end if;

  select exists (
    select 1 from public.stores s
    where s.id = p_store_id and s.owner_id = v_user_id
  ) into v_allowed;
  if v_allowed then
    return true;
  end if;

  if to_regclass('public.store_users') is not null then
    execute $query$
      select exists (
        select 1
        from public.store_users su
        where (to_jsonb(su)->>'store_id')::uuid = $1
          and (to_jsonb(su)->>'user_id')::uuid = $2
          and coalesce(to_jsonb(su)->>'active', 'true') = 'true'
          and (
            to_jsonb(su)->>'role' = 'store_admin'
            or coalesce(to_jsonb(su)->'permissions', '[]'::jsonb) ? 'products'
          )
      )
    $query$ into v_allowed using p_store_id, v_user_id;
    if v_allowed then
      return true;
    end if;
  end if;

  if to_regclass('public.store_members') is not null then
    execute $query$
      select exists (
        select 1
        from public.store_members sm
        where (to_jsonb(sm)->>'store_id')::uuid = $1
          and (to_jsonb(sm)->>'user_id')::uuid = $2
          and coalesce(to_jsonb(sm)->>'active', 'true') = 'true'
          and (
            to_jsonb(sm)->>'role' = 'store_admin'
            or coalesce(to_jsonb(sm)->'permissions', '[]'::jsonb) ? 'products'
          )
      )
    $query$ into v_allowed using p_store_id, v_user_id;
  end if;

  return coalesce(v_allowed, false);
end;
$$;

revoke all on function public.can_manage_store_social(uuid) from public, anon;
grant execute on function public.can_manage_store_social(uuid) to authenticated;

create or replace function public.validate_store_social_relations()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_related_store_id uuid;
begin
  if tg_table_name = 'store_social_posts' then
    if new.product_id is not null then
      select p.store_id into v_related_store_id
      from public.products p where p.id = new.product_id;
      if v_related_store_id is distinct from new.store_id then
        raise exception 'PRODUCT_STORE_MISMATCH';
      end if;
    end if;
    if new.campaign_id is not null then
      select c.store_id into v_related_store_id
      from public.store_social_campaigns c where c.id = new.campaign_id;
      if v_related_store_id is distinct from new.store_id then
        raise exception 'CAMPAIGN_STORE_MISMATCH';
      end if;
      if new.product_id is not null and not exists (
        select 1
        from public.store_social_campaign_items ci
        where ci.store_id = new.store_id
          and ci.campaign_id = new.campaign_id
          and ci.product_id = new.product_id
      ) then
        raise exception 'PRODUCT_NOT_IN_CAMPAIGN';
      end if;
    end if;
  elsif tg_table_name = 'store_social_campaign_items' then
    select c.store_id into v_related_store_id
    from public.store_social_campaigns c where c.id = new.campaign_id;
    if v_related_store_id is distinct from new.store_id then
      raise exception 'CAMPAIGN_STORE_MISMATCH';
    end if;
    select p.store_id into v_related_store_id
    from public.products p where p.id = new.product_id;
    if v_related_store_id is distinct from new.store_id then
      raise exception 'PRODUCT_STORE_MISMATCH';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.guard_store_social_identity()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.store_id is distinct from old.store_id
    or new.created_by is distinct from old.created_by then
    raise exception 'SOCIAL_RECORD_IDENTITY_IMMUTABLE';
  end if;
  return new;
end;
$$;

drop trigger if exists store_social_posts_validate_relations on public.store_social_posts;
create trigger store_social_posts_validate_relations
  before insert or update of store_id, product_id, campaign_id on public.store_social_posts
  for each row execute function public.validate_store_social_relations();
drop trigger if exists store_social_campaign_items_validate_relations on public.store_social_campaign_items;
create trigger store_social_campaign_items_validate_relations
  before insert or update of store_id, campaign_id, product_id on public.store_social_campaign_items
  for each row execute function public.validate_store_social_relations();
drop trigger if exists store_social_campaigns_guard_identity on public.store_social_campaigns;
create trigger store_social_campaigns_guard_identity
  before update on public.store_social_campaigns
  for each row execute function public.guard_store_social_identity();
drop trigger if exists store_social_posts_guard_identity on public.store_social_posts;
create trigger store_social_posts_guard_identity
  before update on public.store_social_posts
  for each row execute function public.guard_store_social_identity();

revoke all on function public.validate_store_social_relations() from public, anon, authenticated;
revoke all on function public.guard_store_social_identity() from public, anon, authenticated;

create table if not exists public.store_social_post_events (
  id bigint generated always as identity primary key,
  store_id uuid not null references public.stores(id) on delete cascade,
  post_id uuid not null references public.store_social_posts(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null check (action in ('created', 'updated')),
  old_status text,
  new_status text not null,
  created_at timestamptz not null default now()
);

create index if not exists store_social_post_events_post_idx
  on public.store_social_post_events (store_id, post_id, created_at desc);

create or replace function public.log_store_social_post_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.store_social_post_events (store_id, post_id, actor_id, action, old_status, new_status)
  values (
    new.store_id,
    new.id,
    auth.uid(),
    case when tg_op = 'INSERT' then 'created' else 'updated' end,
    case when tg_op = 'INSERT' then null else old.status end,
    new.status
  );
  return new;
end;
$$;

drop trigger if exists store_social_posts_log_event on public.store_social_posts;
create trigger store_social_posts_log_event
  after insert or update on public.store_social_posts
  for each row execute function public.log_store_social_post_event();
revoke all on function public.log_store_social_post_event() from public, anon, authenticated;

alter table public.store_social_campaigns enable row level security;
alter table public.store_social_posts enable row level security;
alter table public.store_social_campaign_items enable row level security;
alter table public.store_social_post_events enable row level security;

revoke all on public.store_social_campaigns, public.store_social_posts,
  public.store_social_campaign_items, public.store_social_post_events
  from public, anon, authenticated;
grant select, insert, update, delete on public.store_social_campaigns,
  public.store_social_posts, public.store_social_campaign_items to authenticated;
grant select on public.store_social_post_events to authenticated;

drop policy if exists store_social_campaigns_select on public.store_social_campaigns;
create policy store_social_campaigns_select on public.store_social_campaigns
  for select to authenticated using (public.can_manage_store_social(store_id));
drop policy if exists store_social_campaigns_insert on public.store_social_campaigns;
create policy store_social_campaigns_insert on public.store_social_campaigns
  for insert to authenticated with check (
    public.can_manage_store_social(store_id) and created_by = auth.uid()
  );
drop policy if exists store_social_campaigns_update on public.store_social_campaigns;
create policy store_social_campaigns_update on public.store_social_campaigns
  for update to authenticated using (public.can_manage_store_social(store_id))
  with check (public.can_manage_store_social(store_id));
drop policy if exists store_social_campaigns_delete on public.store_social_campaigns;
create policy store_social_campaigns_delete on public.store_social_campaigns
  for delete to authenticated using (public.can_manage_store_social(store_id));

drop policy if exists store_social_posts_select on public.store_social_posts;
create policy store_social_posts_select on public.store_social_posts
  for select to authenticated using (public.can_manage_store_social(store_id));
drop policy if exists store_social_posts_insert on public.store_social_posts;
create policy store_social_posts_insert on public.store_social_posts
  for insert to authenticated with check (
    public.can_manage_store_social(store_id)
    and created_by = auth.uid()
    and status in ('draft', 'review', 'ready')
  );
drop policy if exists store_social_posts_update on public.store_social_posts;
create policy store_social_posts_update on public.store_social_posts
  for update to authenticated using (public.can_manage_store_social(store_id))
  with check (
    public.can_manage_store_social(store_id)
    and status in ('draft', 'review', 'ready')
  );
drop policy if exists store_social_posts_delete on public.store_social_posts;
create policy store_social_posts_delete on public.store_social_posts
  for delete to authenticated using (public.can_manage_store_social(store_id));

drop policy if exists store_social_campaign_items_select on public.store_social_campaign_items;
create policy store_social_campaign_items_select on public.store_social_campaign_items
  for select to authenticated using (public.can_manage_store_social(store_id));
drop policy if exists store_social_campaign_items_insert on public.store_social_campaign_items;
create policy store_social_campaign_items_insert on public.store_social_campaign_items
  for insert to authenticated with check (public.can_manage_store_social(store_id));
drop policy if exists store_social_campaign_items_delete on public.store_social_campaign_items;
create policy store_social_campaign_items_delete on public.store_social_campaign_items
  for delete to authenticated using (public.can_manage_store_social(store_id));

drop policy if exists store_social_post_events_select on public.store_social_post_events;
create policy store_social_post_events_select on public.store_social_post_events
  for select to authenticated using (public.can_manage_store_social(store_id));

create or replace function public.touch_store_social_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists store_social_campaigns_touch_updated_at on public.store_social_campaigns;
create trigger store_social_campaigns_touch_updated_at
  before update on public.store_social_campaigns
  for each row execute function public.touch_store_social_updated_at();
drop trigger if exists store_social_posts_touch_updated_at on public.store_social_posts;
create trigger store_social_posts_touch_updated_at
  before update on public.store_social_posts
  for each row execute function public.touch_store_social_updated_at();
revoke all on function public.touch_store_social_updated_at() from public, anon, authenticated;
