-- Tenancy and studio catalog.
--
-- Every tenant-dependent row carries tenant_id. Child tables reference parents
-- through composite keys (tenant_id, id), so a row can never point at another
-- studio's service/resource/booking even if an id leaks.
--
-- `origin` = 'config' rows come from tenants/<slug>/business.json (tenant:publish);
-- 'owner' rows were created in the cabinet. `owner_modified` marks config rows the
-- owner edited: republishing the config never overwrites them.

create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique
    check (slug ~ '^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$'),
  status text not null default 'preview'
    check (status in ('preview', 'live', 'archived')),
  timezone text not null,
  currency text not null default 'RUB' check (currency ~ '^[A-Z]{3}$'),
  locale text not null default 'ru-RU',

  name text not null check (char_length(name) between 1 and 80),
  short_name text not null check (char_length(short_name) between 1 and 24),
  tagline text check (char_length(tagline) <= 120),
  description text check (char_length(description) <= 600),
  address text check (char_length(address) <= 200),
  address_note text check (char_length(address_note) <= 300),
  map_url text check (map_url ~ '^https://'),
  geo_lat double precision check (geo_lat between -90 and 90),
  geo_lng double precision check (geo_lng between -180 and 180),
  phone text check (phone ~ '^\+[0-9]{10,15}$'),
  phone_display text check (char_length(phone_display) <= 32),
  messenger_url text check (messenger_url ~ '^https://'),
  accent_color text not null check (accent_color ~ '^#[0-9A-Fa-f]{6}$'),
  logo_path text,
  hero_path text,
  hero_alt text check (char_length(hero_alt) <= 160),
  info_cards jsonb not null default '[]'::jsonb check (jsonb_typeof(info_cards) = 'array'),

  -- Booking rules.
  slot_step_minutes int not null default 30 check (slot_step_minutes in (10, 15, 20, 30, 60)),
  min_lead_minutes int not null default 120 check (min_lead_minutes between 0 and 10080),
  horizon_days int not null default 30 check (horizon_days between 1 and 180),
  cancel_until_hours int not null default 12 check (cancel_until_hours between 0 and 168),

  -- Pipeline bookkeeping.
  owner_overrides text[] not null default '{}',
  config_version int not null default 0,
  config_hash text,
  published_at timestamptz,
  live_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger tenants_touch before update on public.tenants
  for each row execute function private.touch_updated_at();

create table public.tenant_members (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'owner' check (role in ('owner', 'staff')),
  created_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);

create index tenant_members_user_idx on public.tenant_members (user_id);

-- Membership check used by RLS policies and owner RPCs. SECURITY DEFINER so it can
-- read tenant_members regardless of the caller's own grants.
create or replace function private.is_member(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.tenant_members m
    where m.tenant_id = p_tenant_id and m.user_id = (select auth.uid())
  );
$$;

revoke all on function private.is_member(uuid) from public, anon;
grant execute on function private.is_member(uuid) to authenticated, service_role;

create table public.resources (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  key text not null check (key ~ '^[a-z0-9][a-z0-9-]{0,47}$'),
  name text not null check (char_length(name) between 1 and 60),
  kind text not null default 'box' check (kind in ('box', 'lift', 'bay', 'master')),
  is_active boolean not null default true,
  sort int not null default 0,
  origin text not null default 'config' check (origin in ('config', 'owner')),
  owner_modified boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, key)
);

create trigger resources_touch before update on public.resources
  for each row execute function private.touch_updated_at();

create table public.services (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  key text not null check (key ~ '^[a-z0-9][a-z0-9-]{0,47}$'),
  name text not null check (char_length(name) between 1 and 80),
  description text check (char_length(description) <= 400),
  category text check (char_length(category) <= 40),
  price_minor bigint not null check (price_minor >= 0),
  price_is_from boolean not null default false,
  duration_minutes int not null check (duration_minutes between 15 and 20160),
  buffer_minutes int not null default 0 check (buffer_minutes between 0 and 1440),
  is_active boolean not null default true,
  sort int not null default 0,
  origin text not null default 'config' check (origin in ('config', 'owner')),
  owner_modified boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, key)
);

create trigger services_touch before update on public.services
  for each row execute function private.touch_updated_at();

-- Which resources (boxes/posts) can perform a service.
create table public.service_resources (
  tenant_id uuid not null,
  service_id uuid not null,
  resource_id uuid not null,
  primary key (service_id, resource_id),
  foreign key (tenant_id, service_id) references public.services (tenant_id, id) on delete cascade,
  foreign key (tenant_id, resource_id) references public.resources (tenant_id, id) on delete cascade
);

create index service_resources_resource_idx on public.service_resources (tenant_id, resource_id);

-- Weekly hours: moments when cars are received. ISO weekday 1 = Monday.
create table public.working_hours (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  weekday smallint not null check (weekday between 1 and 7),
  opens_at time not null,
  closes_at time not null,
  check (closes_at > opens_at),
  unique (tenant_id, weekday, opens_at)
);

-- Date overrides: closed days or special hours (one row per date).
create table public.schedule_exceptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  date date not null,
  is_closed boolean not null default true,
  opens_at time,
  closes_at time,
  note text check (char_length(note) <= 120),
  origin text not null default 'owner' check (origin in ('config', 'owner')),
  created_at timestamptz not null default now(),
  unique (tenant_id, date),
  check (is_closed or (opens_at is not null and closes_at is not null and closes_at > opens_at))
);

-- Portfolio photos ("работы"). Each card is replaced/captioned independently.
create table public.tenant_photos (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  key text check (key ~ '^[a-z0-9][a-z0-9-]{0,47}$'),
  storage_path text not null,
  caption text check (char_length(caption) <= 140),
  sort int not null default 0,
  is_active boolean not null default true,
  origin text not null default 'config' check (origin in ('config', 'owner')),
  owner_modified boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, key)
);

create trigger tenant_photos_touch before update on public.tenant_photos
  for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------------------
-- RLS: owners read their own studio; anon reads nothing directly (public data is
-- served by SECURITY DEFINER RPCs that return only public fields).
-- ---------------------------------------------------------------------------
alter table public.tenants enable row level security;
alter table public.tenant_members enable row level security;
alter table public.resources enable row level security;
alter table public.services enable row level security;
alter table public.service_resources enable row level security;
alter table public.working_hours enable row level security;
alter table public.schedule_exceptions enable row level security;
alter table public.tenant_photos enable row level security;

create policy tenants_member_read on public.tenants
  for select to authenticated using ((select private.is_member(id)));
create policy tenant_members_self_read on public.tenant_members
  for select to authenticated using (user_id = (select auth.uid()));
create policy resources_member_read on public.resources
  for select to authenticated using ((select private.is_member(tenant_id)));
create policy services_member_read on public.services
  for select to authenticated using ((select private.is_member(tenant_id)));
create policy service_resources_member_read on public.service_resources
  for select to authenticated using ((select private.is_member(tenant_id)));
create policy working_hours_member_read on public.working_hours
  for select to authenticated using ((select private.is_member(tenant_id)));
create policy schedule_exceptions_member_read on public.schedule_exceptions
  for select to authenticated using ((select private.is_member(tenant_id)));
create policy tenant_photos_member_read on public.tenant_photos
  for select to authenticated using ((select private.is_member(tenant_id)));

revoke all on public.tenants, public.tenant_members, public.resources, public.services,
  public.service_resources, public.working_hours, public.schedule_exceptions,
  public.tenant_photos from anon, authenticated;

grant select on public.tenants, public.tenant_members, public.resources, public.services,
  public.service_resources, public.working_hours, public.schedule_exceptions,
  public.tenant_photos to authenticated;
