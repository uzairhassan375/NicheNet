-- Account tables for NicheNet.
-- The browser never connects with the database password. It calls these
-- functions through the Supabase API. Passwords are stored only as hashes.

create extension if not exists pgcrypto;

create table if not exists public.admin_auth (
  id integer primary key default 1 check (id = 1),
  password_hash text not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.app_users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  password_hash text not null,
  name text not null default '',
  active boolean not null default true,
  searches_per_day integer not null default 5 check (searches_per_day >= 0),
  max_pages integer check (max_pages is null or max_pages >= 1),
  max_results integer check (max_results is null or max_results >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.app_users add column if not exists price_min numeric;
alter table public.app_users add column if not exists price_max numeric;
alter table public.app_users add column if not exists min_rating numeric;
alter table public.app_users add column if not exists min_reviews integer;
alter table public.app_users add column if not exists target_reviews integer;
alter table public.app_users add column if not exists ships_from text;
alter table public.app_users add column if not exists deliver_zip text;

create table if not exists public.search_usage (
  user_id uuid not null references public.app_users(id) on delete cascade,
  usage_date date not null,
  search_count integer not null default 0 check (search_count >= 0),
  primary key (user_id, usage_date)
);

create table if not exists public.sessions (
  token text primary key,
  user_id uuid references public.app_users(id) on delete cascade,
  is_admin boolean not null default false,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

alter table public.admin_auth enable row level security;
alter table public.app_users enable row level security;
alter table public.search_usage enable row level security;
alter table public.sessions enable row level security;

revoke all on table public.admin_auth from public, anon, authenticated;
revoke all on table public.app_users from public, anon, authenticated;
revoke all on table public.search_usage from public, anon, authenticated;
revoke all on table public.sessions from public, anon, authenticated;

create or replace function public.admin_login(p_password text)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_hash text;
  v_token text;
begin
  if p_password is null or length(p_password) < 8 then
    return json_build_object('ok', false, 'code', 'unauthorized', 'error', 'Wrong admin password.');
  end if;
  select password_hash into v_hash from public.admin_auth where id = 1;
  if v_hash is null or crypt(p_password, v_hash) <> v_hash then
    return json_build_object('ok', false, 'code', 'unauthorized', 'error', 'Wrong admin password.');
  end if;
  delete from public.sessions where expires_at < now();
  v_token := encode(gen_random_bytes(32), 'hex');
  insert into public.sessions (token, user_id, is_admin, expires_at)
  values (v_token, null, true, now() + interval '12 hours');
  return json_build_object('ok', true, 'token', v_token);
end;
$$;

create or replace function public.admin_change_password(p_token text, p_password text)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if not exists (
    select 1 from public.sessions
    where token = p_token and is_admin and expires_at > now()
  ) then
    return json_build_object('ok', false, 'code', 'unauthorized', 'error', 'Sign in again.');
  end if;
  if p_password is null or length(p_password) < 8 then
    return json_build_object('ok', false, 'error', 'Use a password of at least 8 characters.');
  end if;
  update public.admin_auth
  set password_hash = crypt(p_password, gen_salt('bf')), updated_at = now()
  where id = 1;
  return json_build_object('ok', true);
end;
$$;

create or replace function public.limit_fields(p public.app_users, p_used integer)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'email', p.email,
    'name', p.name,
    'active', p.active,
    'searches_per_day', p.searches_per_day,
    'used_today', coalesce(p_used, 0),
    'remaining', greatest(p.searches_per_day - coalesce(p_used, 0), 0),
    'max_pages', p.max_pages,
    'max_results', p.max_results,
    'price_min', p.price_min,
    'price_max', p.price_max,
    'min_rating', p.min_rating,
    'min_reviews', p.min_reviews,
    'target_reviews', p.target_reviews,
    'ships_from', p.ships_from,
    'deliver_zip', p.deliver_zip
  );
$$;

create or replace function public.user_login(p_email text, p_password text)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user public.app_users%rowtype;
  v_token text;
  v_used integer;
begin
  if p_password is null or length(p_password) < 1 then
    return json_build_object('ok', false, 'code', 'unauthorized', 'error', 'Wrong email or password.');
  end if;
  select * into v_user
  from public.app_users
  where email = lower(trim(coalesce(p_email, '')));
  if v_user.id is null or crypt(p_password, v_user.password_hash) <> v_user.password_hash then
    return json_build_object('ok', false, 'code', 'unauthorized', 'error', 'Wrong email or password.');
  end if;
  if not v_user.active then
    return json_build_object('ok', false, 'code', 'inactive', 'error', 'This account is paused. An admin has to allow searches again.');
  end if;
  delete from public.sessions where expires_at < now();
  v_token := encode(gen_random_bytes(32), 'hex');
  insert into public.sessions (token, user_id, is_admin, expires_at)
  values (v_token, v_user.id, false, now() + interval '14 days');
  select coalesce(search_count, 0) into v_used
  from public.search_usage
  where user_id = v_user.id and usage_date = (now() at time zone 'utc')::date;
  v_used := coalesce(v_used, 0);
  insert into public.activity_log (user_id, action, detail)
  values (v_user.id, 'Signed in', coalesce(v_user.email, ''));
  return (jsonb_build_object('ok', true, 'token', v_token) || public.limit_fields(v_user, v_used))::json;
end;
$$;

create or replace function public.session_status(p_token text)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user public.app_users%rowtype;
  v_used integer;
begin
  select u.* into v_user
  from public.sessions s
  join public.app_users u on u.id = s.user_id
  where s.token = p_token and s.is_admin = false and s.expires_at > now();
  if v_user.id is null then
    return json_build_object('ok', false, 'code', 'unauthorized', 'error', 'Sign in again.');
  end if;
  select coalesce(search_count, 0) into v_used
  from public.search_usage
  where user_id = v_user.id and usage_date = (now() at time zone 'utc')::date;
  v_used := coalesce(v_used, 0);
  return (jsonb_build_object('ok', true, 'token', p_token) || public.limit_fields(v_user, v_used))::json;
end;
$$;

create or replace function public.sign_out(p_token text)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user_id uuid;
begin
  select user_id into v_user_id
  from public.sessions
  where token = p_token and is_admin = false;
  if v_user_id is not null then
    insert into public.activity_log (user_id, action, detail)
    values (v_user_id, 'Signed out', '');
  end if;
  delete from public.sessions where token = p_token;
  return json_build_object('ok', true);
end;
$$;

drop function if exists public.consume_search(text, integer, integer);

create or replace function public.consume_search(
  p_token text,
  p_pages integer,
  p_results integer,
  p_min_price numeric default null,
  p_max_price numeric default null,
  p_min_rating numeric default null,
  p_min_reviews integer default null,
  p_ships text default null,
  p_zip text default null
)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user public.app_users%rowtype;
  v_used integer;
begin
  select u.* into v_user
  from public.sessions s
  join public.app_users u on u.id = s.user_id
  where s.token = p_token and s.is_admin = false and s.expires_at > now()
  for update of u;
  if v_user.id is null then
    return json_build_object('ok', false, 'code', 'unauthorized', 'error', 'Sign in again.');
  end if;
  if not v_user.active then
    return json_build_object('ok', false, 'code', 'inactive', 'error', 'This account is paused. An admin has to allow searches again.');
  end if;
  if v_user.max_pages is not null and p_pages > v_user.max_pages then
    return json_build_object('ok', false, 'code', 'pages', 'error', format('This account can search at most %s pages per keyword.', v_user.max_pages));
  end if;
  if v_user.max_results is not null and p_results > v_user.max_results then
    return json_build_object('ok', false, 'code', 'results', 'error', format('This account can keep at most %s results per keyword.', v_user.max_results));
  end if;
  if v_user.price_min is not null and p_min_price is not null and p_min_price < v_user.price_min then
    return json_build_object('ok', false, 'code', 'price', 'error', format('This account cannot search below $%s.', v_user.price_min));
  end if;
  if v_user.price_max is not null and p_max_price is not null and p_max_price > v_user.price_max then
    return json_build_object('ok', false, 'code', 'price', 'error', format('This account cannot search above $%s.', v_user.price_max));
  end if;
  if v_user.min_rating is not null and p_min_rating is not null and p_min_rating < v_user.min_rating then
    return json_build_object('ok', false, 'code', 'rating', 'error', format('This account must use a minimum rating of %s.', v_user.min_rating));
  end if;
  if v_user.min_reviews is not null and p_min_reviews is not null and p_min_reviews < v_user.min_reviews then
    return json_build_object('ok', false, 'code', 'reviews', 'error', format('This account must require at least %s reviews.', v_user.min_reviews));
  end if;
  if v_user.ships_from is not null and p_ships is not null and p_ships <> v_user.ships_from then
    return json_build_object('ok', false, 'code', 'ships', 'error', 'This account has a fixed Ships from setting.');
  end if;
  if v_user.deliver_zip is not null and p_zip is not null and p_zip <> v_user.deliver_zip then
    return json_build_object('ok', false, 'code', 'zip', 'error', format('This account must deliver to %s.', v_user.deliver_zip));
  end if;
  select search_count into v_used
  from public.search_usage
  where user_id = v_user.id and usage_date = (now() at time zone 'utc')::date
  for update;
  v_used := coalesce(v_used, 0);
  if v_used >= v_user.searches_per_day then
    insert into public.activity_log (user_id, action, detail)
    values (v_user.id, 'Limit reached', format('%s of %s searches used today.', v_used, v_user.searches_per_day));
    return (
      jsonb_build_object(
        'ok', false,
        'code', 'limit',
        'error', format('Daily search limit reached (%s of %s). You can search again tomorrow, or when an admin raises the limit or resets today''s count.', v_used, v_user.searches_per_day)
      ) || public.limit_fields(v_user, v_used)
    )::json;
  end if;
  insert into public.search_usage (user_id, usage_date, search_count)
  values (v_user.id, (now() at time zone 'utc')::date, v_used + 1)
  on conflict (user_id, usage_date)
  do update set search_count = public.search_usage.search_count + 1;
  v_used := v_used + 1;
  insert into public.activity_log (user_id, action, detail)
  values (v_user.id, 'Search started', format('%s of %s searches used today. %s remaining.', v_used, v_user.searches_per_day, greatest(v_user.searches_per_day - v_used, 0)));
  return (jsonb_build_object('ok', true, 'allowed', true) || public.limit_fields(v_user, v_used))::json;
end;
$$;

create or replace function public.admin_list_users(p_token text)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_users json;
begin
  if not exists (
    select 1 from public.sessions
    where token = p_token and is_admin and expires_at > now()
  ) then
    return json_build_object('ok', false, 'code', 'unauthorized', 'error', 'Sign in again.');
  end if;
  select coalesce(json_agg(row_to_json(t) order by t.created_at desc), '[]'::json)
  into v_users
  from (
    select
      u.id,
      u.email,
      u.name,
      u.active,
      u.searches_per_day,
      u.max_pages,
      u.max_results,
      u.price_min,
      u.price_max,
      u.min_rating,
      u.min_reviews,
      u.target_reviews,
      u.ships_from,
      u.deliver_zip,
      u.created_at,
      coalesce(s.search_count, 0) as used_today
    from public.app_users u
    left join public.search_usage s
      on s.user_id = u.id and s.usage_date = (now() at time zone 'utc')::date
  ) t;
  return json_build_object('ok', true, 'users', v_users);
end;
$$;

drop function if exists public.admin_save_user(text, uuid, text, text, text, boolean, integer, integer, integer);

create or replace function public.admin_save_user(
  p_token text,
  p_id uuid,
  p_email text,
  p_password text,
  p_name text,
  p_active boolean,
  p_searches_per_day integer,
  p_max_pages integer default null,
  p_max_results integer default null,
  p_price_min numeric default null,
  p_price_max numeric default null,
  p_min_rating numeric default null,
  p_min_reviews integer default null,
  p_target_reviews integer default null,
  p_ships_from text default null,
  p_deliver_zip text default null
) returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_id uuid := p_id;
begin
  if not exists (
    select 1 from public.sessions
    where token = p_token and is_admin and expires_at > now()
  ) then
    return json_build_object('ok', false, 'code', 'unauthorized', 'error', 'Sign in again.');
  end if;
  if position('@' in v_email) < 2 or length(v_email) > 200 then
    return json_build_object('ok', false, 'error', 'Enter a valid email address.');
  end if;
  if p_searches_per_day is null or p_searches_per_day < 0 then
    return json_build_object('ok', false, 'error', 'Searches per day must be 0 or more.');
  end if;
  if p_max_pages is not null and p_max_pages < 1 then
    return json_build_object('ok', false, 'error', 'Max pages must be blank for no cap, or 1 or more.');
  end if;
  if p_max_results is not null and p_max_results < 1 then
    return json_build_object('ok', false, 'error', 'Max results must be blank for no cap, or 1 or more.');
  end if;
  if p_price_min is not null and p_price_min < 0 then
    return json_build_object('ok', false, 'error', 'Minimum price must be blank or 0 or more.');
  end if;
  if p_price_max is not null and p_price_max < 0 then
    return json_build_object('ok', false, 'error', 'Maximum price must be blank or 0 or more.');
  end if;
  if p_price_min is not null and p_price_max is not null and p_price_max < p_price_min then
    return json_build_object('ok', false, 'error', 'Maximum price must be at least the minimum price.');
  end if;
  if p_min_rating is not null and (p_min_rating < 0 or p_min_rating > 5) then
    return json_build_object('ok', false, 'error', 'Minimum rating must be blank or between 0 and 5.');
  end if;
  if p_min_reviews is not null and p_min_reviews < 0 then
    return json_build_object('ok', false, 'error', 'Minimum reviews must be blank or 0 or more.');
  end if;
  if p_target_reviews is not null and p_target_reviews < 0 then
    return json_build_object('ok', false, 'error', 'Target reviews must be blank or 0 or more.');
  end if;
  if p_ships_from is not null and p_ships_from not in ('fbm', 'fba', 'any') then
    return json_build_object('ok', false, 'error', 'Ships from must be blank, seller, Amazon, or any.');
  end if;
  if p_deliver_zip is not null and length(trim(p_deliver_zip)) > 12 then
    return json_build_object('ok', false, 'error', 'ZIP must be 12 characters or fewer.');
  end if;
  if v_id is null then
    if p_password is null or length(p_password) < 8 then
      return json_build_object('ok', false, 'error', 'Set a password of at least 8 characters.');
    end if;
    insert into public.app_users (
      email, password_hash, name, active, searches_per_day, max_pages, max_results,
      price_min, price_max, min_rating, min_reviews, target_reviews, ships_from, deliver_zip
    )
    values (
      v_email,
      crypt(p_password, gen_salt('bf')),
      coalesce(nullif(trim(p_name), ''), v_email),
      coalesce(p_active, true),
      p_searches_per_day,
      p_max_pages,
      p_max_results,
      p_price_min,
      p_price_max,
      p_min_rating,
      p_min_reviews,
      p_target_reviews,
      nullif(p_ships_from, ''),
      nullif(trim(coalesce(p_deliver_zip, '')), '')
    )
    returning id into v_id;
  else
    if not exists (select 1 from public.app_users where id = v_id) then
      return json_build_object('ok', false, 'error', 'That user no longer exists.');
    end if;
    if p_password is not null and length(p_password) > 0 and length(p_password) < 8 then
      return json_build_object('ok', false, 'error', 'A new password must be at least 8 characters.');
    end if;
    update public.app_users
    set
      email = v_email,
      name = coalesce(nullif(trim(p_name), ''), v_email),
      active = coalesce(p_active, true),
      searches_per_day = p_searches_per_day,
      max_pages = p_max_pages,
      max_results = p_max_results,
      price_min = p_price_min,
      price_max = p_price_max,
      min_rating = p_min_rating,
      min_reviews = p_min_reviews,
      target_reviews = p_target_reviews,
      ships_from = nullif(p_ships_from, ''),
      deliver_zip = nullif(trim(coalesce(p_deliver_zip, '')), ''),
      password_hash = case
        when p_password is null or length(p_password) = 0 then password_hash
        else crypt(p_password, gen_salt('bf'))
      end,
      updated_at = now()
    where id = v_id;
  end if;
  return json_build_object('ok', true, 'id', v_id);
exception
  when unique_violation then
    return json_build_object('ok', false, 'error', 'That email is already used.');
end;
$$;

create or replace function public.admin_reset_usage(p_token text, p_user_id uuid)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if not exists (
    select 1 from public.sessions
    where token = p_token and is_admin and expires_at > now()
  ) then
    return json_build_object('ok', false, 'code', 'unauthorized', 'error', 'Sign in again.');
  end if;
  delete from public.search_usage
  where user_id = p_user_id and usage_date = (now() at time zone 'utc')::date;
  return json_build_object('ok', true);
end;
$$;

create or replace function public.admin_delete_user(p_token text, p_user_id uuid)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if not exists (
    select 1 from public.sessions
    where token = p_token and is_admin and expires_at > now()
  ) then
    return json_build_object('ok', false, 'code', 'unauthorized', 'error', 'Sign in again.');
  end if;
  delete from public.app_users where id = p_user_id;
  return json_build_object('ok', true);
end;
$$;

revoke all on function public.admin_login(text) from public;
revoke all on function public.admin_change_password(text, text) from public;
revoke all on function public.user_login(text, text) from public;
revoke all on function public.session_status(text) from public;
revoke all on function public.sign_out(text) from public;
revoke all on function public.limit_fields(public.app_users, integer) from public;
revoke all on function public.consume_search(text, integer, integer, numeric, numeric, numeric, integer, text, text) from public;
revoke all on function public.admin_list_users(text) from public;
revoke all on function public.admin_save_user(text, uuid, text, text, text, boolean, integer, integer, integer, numeric, numeric, numeric, integer, integer, text, text) from public;
revoke all on function public.admin_reset_usage(text, uuid) from public;
revoke all on function public.admin_delete_user(text, uuid) from public;

grant execute on function public.admin_login(text) to anon, authenticated;
grant execute on function public.admin_change_password(text, text) to anon, authenticated;
grant execute on function public.user_login(text, text) to anon, authenticated;
grant execute on function public.session_status(text) to anon, authenticated;
grant execute on function public.sign_out(text) to anon, authenticated;
grant execute on function public.consume_search(text, integer, integer, numeric, numeric, numeric, integer, text, text) to anon, authenticated;
grant execute on function public.admin_list_users(text) to anon, authenticated;
grant execute on function public.admin_save_user(text, uuid, text, text, text, boolean, integer, integer, integer, numeric, numeric, numeric, integer, integer, text, text) to anon, authenticated;
grant execute on function public.admin_reset_usage(text, uuid) to anon, authenticated;
grant execute on function public.admin_delete_user(text, uuid) to anon, authenticated;

create table if not exists public.activity_log (
  id bigint generated always as identity primary key,
  user_id uuid references public.app_users(id) on delete cascade,
  action text not null,
  detail text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists activity_log_created_idx on public.activity_log (created_at desc);
create index if not exists activity_log_user_idx on public.activity_log (user_id, created_at desc);

alter table public.activity_log enable row level security;
revoke all on table public.activity_log from public, anon, authenticated;

create or replace function public.record_activity(p_token text, p_action text, p_detail text)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user_id uuid;
  v_action text := left(trim(coalesce(p_action, '')), 80);
  v_detail text := left(coalesce(p_detail, ''), 2000);
begin
  select user_id into v_user_id
  from public.sessions
  where token = p_token and is_admin = false and expires_at > now();
  if v_user_id is null then
    return json_build_object('ok', false, 'code', 'unauthorized', 'error', 'Sign in again.');
  end if;
  if v_action = '' then
    return json_build_object('ok', false, 'error', 'Missing action.');
  end if;
  insert into public.activity_log (user_id, action, detail)
  values (v_user_id, v_action, v_detail);
  return json_build_object('ok', true);
end;
$$;

create or replace function public.admin_list_activity(p_token text, p_query text default '', p_user_id uuid default null)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_logs json;
  v_query text := replace(replace(trim(coalesce(p_query, '')), '%', ''), '_', '');
begin
  if not exists (
    select 1 from public.sessions
    where token = p_token and is_admin and expires_at > now()
  ) then
    return json_build_object('ok', false, 'code', 'unauthorized', 'error', 'Sign in again.');
  end if;
  select coalesce(json_agg(row_to_json(t) order by t.created_at desc), '[]'::json)
  into v_logs
  from (
    select
      a.id,
      a.user_id,
      coalesce(u.email, '') as email,
      coalesce(u.name, '') as name,
      a.action,
      a.detail,
      a.created_at
    from public.activity_log a
    left join public.app_users u on u.id = a.user_id
    where (p_user_id is null or a.user_id = p_user_id)
      and (
        v_query = ''
        or coalesce(u.email, '') ilike '%' || v_query || '%'
        or coalesce(u.name, '') ilike '%' || v_query || '%'
        or a.action ilike '%' || v_query || '%'
        or a.detail ilike '%' || v_query || '%'
      )
    order by a.created_at desc
    limit 500
  ) t;
  return json_build_object('ok', true, 'logs', v_logs);
end;
$$;

revoke all on function public.record_activity(text, text, text) from public;
revoke all on function public.admin_list_activity(text, text, uuid) from public;
grant execute on function public.record_activity(text, text, text) to anon, authenticated;
grant execute on function public.admin_list_activity(text, text, uuid) to anon, authenticated;

-- Search history: each user's past searches, saved by the extension after a search ends.
-- The newest 30 searches are kept per user. Only the signed-in user can read their own.

create table if not exists public.search_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users(id) on delete cascade,
  started_at timestamptz not null,
  finished_at timestamptz,
  keywords text[] not null default '{}',
  match_count integer not null default 0,
  filters jsonb not null default '{}'::jsonb,
  run jsonb not null,
  created_at timestamptz not null default now(),
  unique (user_id, started_at)
);

create index if not exists search_history_user_idx on public.search_history (user_id, started_at desc);

alter table public.search_history enable row level security;
revoke all on table public.search_history from public, anon, authenticated;

create or replace function public.save_search_history(p_token text, p_run jsonb)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user_id uuid;
  v_started timestamptz;
  v_finished timestamptz;
  v_keywords text[];
  v_id uuid;
begin
  select user_id into v_user_id
  from public.sessions
  where token = p_token and is_admin = false and expires_at > now();
  if v_user_id is null then
    return json_build_object('ok', false, 'code', 'unauthorized', 'error', 'Sign in again.');
  end if;
  if p_run is null or jsonb_typeof(p_run) <> 'object' or coalesce(jsonb_typeof(p_run->'groups'), '') <> 'array' then
    return json_build_object('ok', false, 'error', 'Missing search results.');
  end if;
  if octet_length(p_run::text) > 2000000 then
    return json_build_object('ok', false, 'error', 'This search is too large to save in history.');
  end if;
  begin
    v_started := coalesce(nullif(p_run->>'startedAt', '')::timestamptz, now());
    v_finished := nullif(p_run->>'finishedAt', '')::timestamptz;
  exception when others then
    return json_build_object('ok', false, 'error', 'The search has an invalid date.');
  end;
  if jsonb_typeof(p_run->'keywords') = 'array' then
    select coalesce(array_agg(value), '{}') into v_keywords
    from jsonb_array_elements_text(p_run->'keywords');
  end if;
  if coalesce(cardinality(v_keywords), 0) = 0 then
    select coalesce(array_agg(g->>'keyword'), '{}') into v_keywords
    from jsonb_array_elements(p_run->'groups') g;
  end if;

  insert into public.search_history (user_id, started_at, finished_at, keywords, match_count, filters, run)
  values (
    v_user_id,
    v_started,
    v_finished,
    v_keywords,
    (
      select coalesce(sum(case when jsonb_typeof(g->'matches') = 'array' then jsonb_array_length(g->'matches') else 0 end), 0)
      from jsonb_array_elements(p_run->'groups') g
    ),
    case when jsonb_typeof(p_run->'filters') = 'object' then p_run->'filters' else '{}'::jsonb end,
    p_run
  )
  on conflict (user_id, started_at) do update set
    finished_at = excluded.finished_at,
    keywords = excluded.keywords,
    match_count = excluded.match_count,
    filters = excluded.filters,
    run = excluded.run,
    created_at = now()
  returning id into v_id;

  delete from public.search_history
  where user_id = v_user_id
    and id not in (
      select id from public.search_history
      where user_id = v_user_id
      order by started_at desc
      limit 30
    );
  return json_build_object('ok', true, 'id', v_id);
end;
$$;

create or replace function public.list_search_history(p_token text)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user_id uuid;
  v_items json;
begin
  select user_id into v_user_id
  from public.sessions
  where token = p_token and is_admin = false and expires_at > now();
  if v_user_id is null then
    return json_build_object('ok', false, 'code', 'unauthorized', 'error', 'Sign in again.');
  end if;
  select coalesce(json_agg(row_to_json(t) order by t.started_at desc), '[]'::json)
  into v_items
  from (
    select id, started_at, finished_at, keywords, match_count, filters
    from public.search_history
    where user_id = v_user_id
    order by started_at desc
    limit 30
  ) t;
  return json_build_object('ok', true, 'history', v_items);
end;
$$;

create or replace function public.get_search_history(p_token text, p_id uuid)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user_id uuid;
  v_run jsonb;
begin
  select user_id into v_user_id
  from public.sessions
  where token = p_token and is_admin = false and expires_at > now();
  if v_user_id is null then
    return json_build_object('ok', false, 'code', 'unauthorized', 'error', 'Sign in again.');
  end if;
  select run into v_run
  from public.search_history
  where id = p_id and user_id = v_user_id;
  if v_run is null then
    return json_build_object('ok', false, 'code', 'not_found', 'error', 'That search is no longer in history.');
  end if;
  return json_build_object('ok', true, 'id', p_id, 'run', v_run);
end;
$$;

create or replace function public.delete_search_history(p_token text, p_id uuid)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user_id uuid;
begin
  select user_id into v_user_id
  from public.sessions
  where token = p_token and is_admin = false and expires_at > now();
  if v_user_id is null then
    return json_build_object('ok', false, 'code', 'unauthorized', 'error', 'Sign in again.');
  end if;
  delete from public.search_history where id = p_id and user_id = v_user_id;
  return json_build_object('ok', true);
end;
$$;

create or replace function public.clear_search_history(p_token text)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user_id uuid;
begin
  select user_id into v_user_id
  from public.sessions
  where token = p_token and is_admin = false and expires_at > now();
  if v_user_id is null then
    return json_build_object('ok', false, 'code', 'unauthorized', 'error', 'Sign in again.');
  end if;
  delete from public.search_history where user_id = v_user_id;
  return json_build_object('ok', true);
end;
$$;

revoke all on function public.save_search_history(text, jsonb) from public;
revoke all on function public.list_search_history(text) from public;
revoke all on function public.get_search_history(text, uuid) from public;
revoke all on function public.delete_search_history(text, uuid) from public;
revoke all on function public.clear_search_history(text) from public;
grant execute on function public.save_search_history(text, jsonb) to anon, authenticated;
grant execute on function public.list_search_history(text) to anon, authenticated;
grant execute on function public.get_search_history(text, uuid) to anon, authenticated;
grant execute on function public.delete_search_history(text, uuid) to anon, authenticated;
grant execute on function public.clear_search_history(text) to anon, authenticated;
