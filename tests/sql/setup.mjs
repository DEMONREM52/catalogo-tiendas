// Base de datos de prueba parecida a Supabase + SQL histórico de REMHUB + la migración fiscal.
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// SQL histórico de REMHUB (erp_core, erp_ops, erp_points…) recuperado del repositorio.
const HIST = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

export async function makeDb(migrationPath, { twice = true, extensions } = {}) {
  const db = new PGlite(extensions ? { extensions } : undefined);
  await db.exec(`
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
create table auth.users (id uuid primary key, email text);
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant select on auth.users to service_role;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

create table public.stores (id uuid primary key default gen_random_uuid(), slug text, name text not null, owner_id uuid not null,
  active boolean not null default true, active_until timestamptz, whatsapp text default '', logo_url text, banner_url text, theme text,
  created_at timestamptz default now(), updated_at timestamptz default now());
create table public.user_profiles (user_id uuid primary key, role text not null default 'store', created_at timestamptz default now());
create table public.store_users (store_id uuid not null, user_id uuid not null, role text not null default 'seller', active boolean not null default true,
  permissions text[] not null default '{}', username text, display_name text, created_at timestamptz default now(), updated_at timestamptz default now(),
  primary key (store_id, user_id));
create table public.product_categories (id uuid primary key default gen_random_uuid(), store_id uuid, name text);
create table public.products (id uuid primary key default gen_random_uuid(), store_id uuid not null, name text not null, description text, sku text, barcode text,
  stock integer default 0, active boolean default true, track_inventory boolean default true, cost_price numeric default 0, tax_rate numeric not null default 0,
  price_1 numeric default 0, price_2 numeric default 0, price_3 numeric default 0, price_4 numeric default 0, price_5 numeric default 0,
  price_retail numeric default 0, price_wholesale numeric default 0, min_price numeric, min_wholesale integer, min_wholesale_qty integer default 0, product_details jsonb default '{}', image_url text, updated_at timestamptz default now(), created_at timestamptz default now());
create table public.orders (id uuid primary key default gen_random_uuid(), store_id uuid not null, token text not null unique, receipt_no bigint,
  total numeric not null default 0, status text not null default 'confirmed', catalog_type text default 'retail', customer_name text,
  customer_whatsapp text, payment_method text, created_at timestamptz not null default now());
create table public.order_items (id uuid primary key default gen_random_uuid(), order_id uuid not null references public.orders(id), product_id uuid not null,
  quantity integer not null, price numeric not null);
create table public.inventory_movements (id uuid primary key default gen_random_uuid(), store_id uuid not null, product_id uuid not null, order_id uuid,
  kind text not null, qty integer not null, note text, unit_cost numeric, ref_type text, ref_id uuid, created_by uuid, document_id uuid,
  created_at timestamptz not null default now());
create table public.billing_customers (id uuid primary key default gen_random_uuid(), store_id uuid not null, name text not null, doc_type text default 'CC',
  doc_number text, document_type text not null default 'CC', document_number text, email text, mobile text, phone text, address text, city text,
  department text, country text default 'CO', country_code text default 'CO', person_type text default 'natural', trade_name text, company_name text,
  tax_regime text, is_tax_responsible boolean default false, kinds text[] default '{customer}', active boolean default true,
  created_at timestamptz default now(), updated_at timestamptz default now());
create table public.store_catalogs (id uuid primary key default gen_random_uuid(), store_id uuid not null, name text, point_id uuid);
create table public.store_catalog_orders (order_id uuid primary key, catalog_id uuid, store_id uuid);
create table public.erp_receivables (id uuid primary key default gen_random_uuid(), store_id uuid not null, customer_id uuid, order_id uuid, point_id uuid,
  total numeric default 0, balance numeric default 0, status text default 'open');
create table public.erp_stock_requests (id uuid primary key default gen_random_uuid(), store_id uuid, from_point_id uuid, to_point_id uuid,
  status text default 'requested', created_at timestamptz default now());
create table public.pos_ar_accounts (id uuid primary key default gen_random_uuid(), store_id uuid, balance numeric, status text);
`);
  // SQL histórico (se ignoran sentencias que dependan de cosas de Supabase que no existen aquí).
  const split = (sql) => sql.split(/;\s*\n(?=(?:create|alter|drop|grant|revoke|do|insert|update|comment|notify)\b)/i);
  let skipped = 0;
  for (const f of ["erp_core.sql", "erp_ops.sql", "erp_points.sql", "erp_billing_points.sql"]) {
    for (const st of split(fs.readFileSync(path.join(HIST, f), "utf8"))) {
      try { await db.exec(st + ";"); } catch { skipped++; }
    }
  }
  await db.exec(`
alter table public.erp_warehouses add column if not exists logo_url text;
alter table public.erp_warehouses add column if not exists billing_resolution text;
alter table public.erp_warehouses add column if not exists billing_resolution_date date;
alter table public.erp_warehouses add column if not exists billing_resolution_from bigint;
alter table public.erp_warehouses add column if not exists billing_resolution_to bigint;
alter table public.erp_warehouses add column if not exists billing_resolution_valid_to date;
alter table public.erp_order_meta add column if not exists customer_doc text;
drop function if exists public.erp_sellers(uuid);
create or replace function public.erp_sellers(p_store uuid)
returns table (user_id uuid, name text, role text, point_id uuid) language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.erp_can(p_store, 'pos') or public.erp_can(p_store, 'orders') or public.erp_can(p_store, 'billing')) then
    raise exception 'No tienes permiso para ver los vendedores.';
  end if;
  return query
    select s.owner_id, 'Dueño'::text, 'owner'::text, null::uuid from public.stores s where s.id = p_store
    union all
    select su.user_id, coalesce(su.display_name, su.username, 'Usuario'), su.role, su.point_id from public.store_users su
    where su.store_id = p_store and su.active and (su.role in ('seller', 'store_admin') or 'pos' = any (su.permissions));
end $$;
-- Políticas permisivas parecidas a las de producción (para probar las restrictivas nuevas).
alter table public.orders enable row level security;
create policy orders_team_read on public.orders for select to authenticated using (public.erp_can(store_id, 'orders') or public.erp_can(store_id, 'pos'));
create policy orders_public_read on public.orders for select using (true);
create policy order_items_public_read on public.order_items for select using (true);
create policy orders_team_update on public.orders for update to authenticated using (public.erp_can(store_id, 'orders'));
alter table public.order_items enable row level security;
create policy order_items_team_read on public.order_items for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id and (public.erp_can(o.store_id, 'orders') or public.erp_can(o.store_id, 'pos'))));
alter table public.inventory_movements enable row level security;
create policy inventory_movements_read on public.inventory_movements for select to authenticated using (public.erp_can(store_id, 'inventory'));
alter table public.billing_customers enable row level security;
create policy billing_customers_team_read on public.billing_customers for select to authenticated
  using (public.erp_can(store_id, 'clients') or public.erp_can(store_id, 'pos'));
create policy billing_customers_team_insert on public.billing_customers for insert to authenticated
  with check (public.erp_can(store_id, 'clients') or public.erp_can(store_id, 'pos'));
alter table public.erp_receivables enable row level security;
create policy erp_receivables_read on public.erp_receivables for select to authenticated using (public.erp_can(store_id, 'receivables'));
alter table public.stores enable row level security;
create policy stores_read on public.stores for select to authenticated using (true);
`);
  const mig = fs.readFileSync(migrationPath, "utf8");
  await db.exec(mig);
  if (twice) await db.exec(mig);
  return { db, skipped };
}
