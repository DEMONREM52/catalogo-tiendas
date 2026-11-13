-- =====================================================================================================
-- 20261322 · REM aprende en la tienda (con el visto bueno del dueño o del administrador)
--
-- 1) Lo que REM no entendió, de todo el equipo. Se guarda la frase y la página, NUNCA se muestra quién la dijo
--    (el dueño ve la frase, cuántas veces y cuántas personas). Se borra sola a los 90 días; máximo 500 por tienda.
-- 2) Frases que el dueño o el administrador le enseña a REM para toda la tienda («la plata de los muchachos» →
--    Nómina). No se activan solas: alguien con ese cargo las aprueba. Y no dan permisos: en el navegador REM solo
--    abre la página si la persona la puede abrir, y la base vuelve a revisar al consultar o guardar.
-- Las tablas no se leen directo (RLS sin políticas): todo pasa por estas funciones, con la sesión de quien usa REM.
-- Se puede correr dos veces.
-- =====================================================================================================

create table if not exists public.rem_misses (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  user_id uuid not null,
  phrase text not null check (char_length(phrase) between 3 and 160),
  path text check (path is null or char_length(path) <= 200),
  times integer not null default 1,
  first_at timestamptz not null default now(),
  last_at timestamptz not null default now()
);
create unique index if not exists rem_misses_once on public.rem_misses (store_id, user_id, phrase);
create index if not exists rem_misses_store_last on public.rem_misses (store_id, last_at desc);
alter table public.rem_misses enable row level security;
revoke all on table public.rem_misses from public, anon, authenticated;

create table if not exists public.rem_store_phrases (
  store_id uuid not null references public.stores (id) on delete cascade,
  phrase_key text not null check (char_length(phrase_key) between 3 and 160),
  href text not null check (href like '/dashboard%' and char_length(href) <= 300 and href not like '%//%' and href not like '%:%'),
  label text not null check (char_length(label) between 1 and 80),
  created_by uuid,
  created_at timestamptz not null default now(),
  primary key (store_id, phrase_key)
);
alter table public.rem_store_phrases enable row level security;
revoke all on table public.rem_store_phrases from public, anon, authenticated;

-- La frase como llave: minúsculas, sin tildes, sin espacios de más (igual que phraseKey en src/lib/voice/navigate.ts).
create or replace function public.rem__key(p text)
returns text
language sql
immutable
set search_path = public
as $$
  select btrim(regexp_replace(translate(lower(coalesce(p, '')), 'áéíóúüñ', 'aeiouun'), '\s+', ' ', 'g'));
$$;

create or replace function public.rem__member(p_store uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and (
    exists (select 1 from public.stores s where s.id = p_store and s.owner_id = auth.uid())
    or exists (select 1 from public.store_users su where su.store_id = p_store and su.user_id = auth.uid() and su.active));
$$;

-- Quién le enseña a REM para toda la tienda: el dueño o un administrador de la tienda.
create or replace function public.rem__can_teach(p_store uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and (
    exists (select 1 from public.stores s where s.id = p_store and s.owner_id = auth.uid())
    or exists (select 1 from public.store_users su where su.store_id = p_store and su.user_id = auth.uid() and su.active and su.role = 'store_admin'));
$$;

-- REM no entendió algo: se anota (una fila por persona y frase; si se repite, suma).
create or replace function public.rem_report_miss(p_store uuid, p_phrase text, p_path text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  k text := public.rem__key(p_phrase);
  v_path text := nullif(left(split_part(coalesce(p_path, ''), '?', 1), 200), '');
begin
  if not public.rem__member(p_store) then return jsonb_build_object('ok', false, 'error', 'No perteneces a esta tienda.'); end if;
  -- Ruido (una palabra) o frases larguísimas no se guardan.
  if char_length(k) < 3 or char_length(k) > 160 or array_length(string_to_array(k, ' '), 1) < 2 then
    return jsonb_build_object('ok', true, 'saved', false);
  end if;
  insert into public.rem_misses (store_id, user_id, phrase, path)
  values (p_store, auth.uid(), k, v_path)
  on conflict (store_id, user_id, phrase) do update set times = public.rem_misses.times + 1, last_at = now(), path = excluded.path;
  -- Limpieza: 90 días y máximo 500 por tienda.
  delete from public.rem_misses where store_id = p_store and last_at < now() - interval '90 days';
  delete from public.rem_misses m where m.store_id = p_store and m.id in (
    select id from public.rem_misses where store_id = p_store order by last_at desc offset 500);
  return jsonb_build_object('ok', true, 'saved', true);
end;
$$;

-- Para el dueño o administrador: las frases que REM no entendió en la tienda. Sin nombres.
create or replace function public.rem_misses_review(p_store uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.rem__can_teach(p_store) then return jsonb_build_object('ok', false, 'error', 'Solo el dueño o un administrador de la tienda.'); end if;
  return jsonb_build_object('ok', true, 'rows', coalesce((
    select jsonb_agg(x order by x.times desc, x.last_at desc) from (
      select m.phrase, sum(m.times)::integer as times, count(distinct m.user_id)::integer as people, max(m.last_at) as last_at,
             (array_agg(m.path order by m.last_at desc) filter (where m.path is not null))[1] as path
      from public.rem_misses m
      where m.store_id = p_store
      group by m.phrase
      order by sum(m.times) desc, max(m.last_at) desc
      limit 60) x), '[]'::jsonb));
end;
$$;

-- Enseñar: «esta frase» lleva a «esta página», para todos en la tienda.
create or replace function public.rem_phrase_teach(p_store uuid, p_phrase text, p_href text, p_label text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare k text := public.rem__key(p_phrase);
begin
  if not public.rem__can_teach(p_store) then return jsonb_build_object('ok', false, 'error', 'Solo el dueño o un administrador de la tienda.'); end if;
  if char_length(k) < 3 or char_length(k) > 160 or array_length(string_to_array(k, ' '), 1) < 2 then
    return jsonb_build_object('ok', false, 'error', 'La frase necesita al menos dos palabras.');
  end if;
  if p_href is null or p_href not like '/dashboard%' or p_href like '%//%' or p_href like '%:%' or char_length(p_href) > 300 then
    return jsonb_build_object('ok', false, 'error', 'Solo se puede enseñar una página del panel.');
  end if;
  if char_length(btrim(coalesce(p_label, ''))) not between 1 and 80 then return jsonb_build_object('ok', false, 'error', 'Falta el nombre de la página.'); end if;
  insert into public.rem_store_phrases (store_id, phrase_key, href, label, created_by)
  values (p_store, k, p_href, btrim(p_label), auth.uid())
  on conflict (store_id, phrase_key) do update set href = excluded.href, label = excluded.label, created_by = excluded.created_by, created_at = now();
  delete from public.rem_misses where store_id = p_store and phrase = k;
  -- Máximo 300 frases por tienda.
  delete from public.rem_store_phrases p where p.store_id = p_store and p.phrase_key in (
    select phrase_key from public.rem_store_phrases where store_id = p_store order by created_at desc offset 300);
  return jsonb_build_object('ok', true, 'key', k);
end;
$$;

create or replace function public.rem_phrase_forget(p_store uuid, p_phrase text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if not public.rem__can_teach(p_store) then return jsonb_build_object('ok', false, 'error', 'Solo el dueño o un administrador de la tienda.'); end if;
  delete from public.rem_store_phrases where store_id = p_store and phrase_key = public.rem__key(p_phrase);
  return jsonb_build_object('ok', true);
end;
$$;

-- Descartar una frase de la lista (era ruido).
create or replace function public.rem_miss_dismiss(p_store uuid, p_phrase text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if not public.rem__can_teach(p_store) then return jsonb_build_object('ok', false, 'error', 'Solo el dueño o un administrador de la tienda.'); end if;
  delete from public.rem_misses where store_id = p_store and phrase = public.rem__key(p_phrase);
  return jsonb_build_object('ok', true);
end;
$$;

-- Las frases de la tienda, para que REM las entienda con todos (cualquiera de la tienda las lee).
create or replace function public.rem_store_phrases(p_store uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.rem__member(p_store) then return jsonb_build_object('ok', false, 'error', 'No perteneces a esta tienda.'); end if;
  return jsonb_build_object('ok', true, 'rows', coalesce((
    select jsonb_agg(jsonb_build_object('key', p.phrase_key, 'href', p.href, 'label', p.label) order by p.phrase_key)
    from public.rem_store_phrases p where p.store_id = p_store), '[]'::jsonb));
end;
$$;

revoke all on function public.rem__key(text) from public, anon;
revoke all on function public.rem__member(uuid) from public, anon, authenticated;
revoke all on function public.rem__can_teach(uuid) from public, anon, authenticated;
revoke all on function public.rem_report_miss(uuid, text, text) from public, anon;
revoke all on function public.rem_misses_review(uuid) from public, anon;
revoke all on function public.rem_phrase_teach(uuid, text, text, text) from public, anon;
revoke all on function public.rem_phrase_forget(uuid, text) from public, anon;
revoke all on function public.rem_miss_dismiss(uuid, text) from public, anon;
revoke all on function public.rem_store_phrases(uuid) from public, anon;
grant execute on function public.rem__key(text) to authenticated;
grant execute on function public.rem_report_miss(uuid, text, text) to authenticated;
grant execute on function public.rem_misses_review(uuid) to authenticated;
grant execute on function public.rem_phrase_teach(uuid, text, text, text) to authenticated;
grant execute on function public.rem_phrase_forget(uuid, text) to authenticated;
grant execute on function public.rem_miss_dismiss(uuid, text) to authenticated;
grant execute on function public.rem_store_phrases(uuid) to authenticated;

notify pgrst, 'reload schema';
