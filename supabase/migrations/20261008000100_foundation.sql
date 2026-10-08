-- Foundation: extensions, schemas, privileges, shared helpers.
--
-- Security model (see SETUP.md → "Модель доступа"):
--   * `public` holds API objects. anon/authenticated get NO table privileges by
--     default; they call an explicit allowlist of RPCs, and authenticated owners
--     read their tenant's rows through RLS.
--   * `private` holds helpers, counters and secrets. It is not exposed through the
--     Data API and nothing in it is executable by API roles unless granted below.

create extension if not exists pgcrypto with schema extensions;
create extension if not exists btree_gist with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
-- RLS policies call private.is_member(); the caller needs USAGE on the schema.
grant usage on schema private to authenticated, service_role;

-- Nothing new in public is reachable by API roles unless granted explicitly.
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke execute on functions from public, anon, authenticated;
alter default privileges for role postgres in schema private revoke execute on functions from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Errors. Public RPCs return {ok:false,error} envelopes for business errors so
-- that rate-limit counters commit; owner RPCs raise (and roll back) with
-- PostgREST status codes encoded as PTxxx SQLSTATEs.
-- ---------------------------------------------------------------------------
create or replace function private.fail(p_status int, p_code text, p_hint text default null)
returns void
language plpgsql
-- STABLE (not IMMUTABLE): never constant-folded at plan time, yet callable from
-- STABLE readers that validate input.
stable
set search_path = ''
as $$
begin
  raise exception using
    errcode = 'PT' || p_status::text,
    message = p_code,
    hint = coalesce(p_hint, p_code);
end;
$$;

-- ---------------------------------------------------------------------------
-- Generic helpers
-- ---------------------------------------------------------------------------
create or replace function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function private.is_valid_timezone(p_tz text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (select 1 from pg_catalog.pg_timezone_names where name = p_tz);
$$;

-- Collapses whitespace and trims. Returns NULL when blank or outside [p_min, p_max]
-- characters; callers decide whether NULL is an error (required) or allowed (optional).
create or replace function private.clean_text(p_value text, p_min int, p_max int)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := nullif(btrim(regexp_replace(coalesce(p_value, ''), '\s+', ' ', 'g')), '');
begin
  if v is null or char_length(v) < p_min or char_length(v) > p_max then
    return null;
  end if;
  return v;
end;
$$;

-- Phone normalisation: digits only, 10–15 digits, leading 8 (RU trunk prefix) → +7.
create or replace function private.normalize_phone(p_value text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  d text := regexp_replace(coalesce(p_value, ''), '\D', '', 'g');
begin
  if char_length(d) = 11 and left(d, 1) = '8' then
    d := '7' || substr(d, 2);
  elsif char_length(d) = 10 and left(d, 1) = '9' then
    d := '7' || d;
  end if;
  if char_length(d) < 10 or char_length(d) > 15 then
    return null;
  end if;
  return '+' || d;
end;
$$;

create or replace function private.base64url(p_bytes bytea)
returns text
language sql
immutable
set search_path = ''
as $$
  select rtrim(translate(encode(p_bytes, 'base64'), E'+/\n', '-_'), '=');
$$;

-- ---------------------------------------------------------------------------
-- Secrets and runtime configuration (never exposed to API roles).
-- ---------------------------------------------------------------------------
create table private.app_secrets (
  name text primary key,
  value bytea not null,
  created_at timestamptz not null default now()
);

-- HMAC key for booking access tokens. Generated once per database.
insert into private.app_secrets (name, value)
values ('booking_token_key', extensions.gen_random_bytes(32))
on conflict (name) do nothing;

create table private.app_config (
  key text primary key,
  value jsonb not null,
  description text
);

insert into private.app_config (key, value, description) values
  ('rate.public_ip_per_5min', '300', 'All public RPC calls from one IP per 5 minutes'),
  ('rate.slots_ip_per_5min', '120', 'Slot lookups from one IP per 5 minutes'),
  ('rate.booking_ip_per_hour', '10', 'Bookings created from one IP per hour'),
  ('rate.booking_tenant_per_hour', '200', 'Bookings created for one studio per hour'),
  ('rate.token_ip_per_10min', '60', 'Booking-token lookups from one IP per 10 minutes'),
  ('rate.push_ip_per_hour', '30', 'Push subscription changes from one IP per hour'),
  ('rate.assistant_ip_per_10min', '20', 'Assistant requests from one IP per 10 minutes'),
  ('llm.tenant_daily_requests', '400', 'Assistant requests per studio per day'),
  ('llm.tenant_daily_tokens', '200000', 'LLM tokens per studio per day'),
  ('llm.global_daily_tokens', '2000000', 'LLM tokens for the whole project per day')
on conflict (key) do nothing;

create or replace function private.config_int(p_key text, p_default int)
returns int
language sql
stable
set search_path = ''
as $$
  select coalesce((select (value #>> '{}')::int from private.app_config where key = p_key), p_default);
$$;

-- ---------------------------------------------------------------------------
-- Rate limiting: shared atomic counters in fixed windows.
-- A limited call raises PT429; the increment of a rejected call is rolled back
-- with it, so the counter saturates at the limit until the window rolls over.
-- ---------------------------------------------------------------------------
create table private.rate_counters (
  bucket text not null,
  window_start timestamptz not null,
  hits int not null default 0,
  primary key (bucket, window_start)
);

create or replace function private.client_ip()
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  h jsonb;
  xff text;
begin
  begin
    h := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then
    h := null;
  end;
  if h is null then
    return 'internal';
  end if;
  -- cf-connecting-ip is set by the edge and cannot be supplied by the client;
  -- otherwise use the address appended by the nearest proxy (last XFF entry).
  if coalesce(h ->> 'cf-connecting-ip', '') <> '' then
    return h ->> 'cf-connecting-ip';
  end if;
  if coalesce(h ->> 'x-real-ip', '') <> '' then
    return h ->> 'x-real-ip';
  end if;
  xff := h ->> 'x-forwarded-for';
  if coalesce(xff, '') <> '' then
    return btrim((regexp_split_to_array(xff, '\s*,\s*'))[array_length(regexp_split_to_array(xff, '\s*,\s*'), 1)]);
  end if;
  return 'unknown';
end;
$$;

create or replace function private.hit_rate_limit(p_bucket text, p_limit int, p_window interval)
returns int
language plpgsql
set search_path = ''
as $$
declare
  v_window timestamptz := date_bin(p_window, now(), timestamptz '2000-01-01 00:00:00+00');
  v_hits int;
begin
  insert into private.rate_counters as c (bucket, window_start, hits)
  values (p_bucket, v_window, 1)
  on conflict (bucket, window_start) do update set hits = c.hits + 1
  returning hits into v_hits;

  if v_hits > p_limit then
    perform private.fail(429, 'rate_limited', 'Слишком много запросов. Попробуйте через несколько минут.');
  end if;
  return v_hits;
end;
$$;

create or replace function private.cleanup_rate_counters()
returns void
language sql
set search_path = ''
as $$
  delete from private.rate_counters where window_start < now() - interval '1 day';
$$;
