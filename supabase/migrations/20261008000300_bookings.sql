-- Bookings, resource occupancy, access tokens, payments.
--
-- A booking holds a *snapshot* of the service (name, price, duration, buffer) taken
-- at creation, so later price changes never rewrite history. The client never sends
-- price, tenant or duration: RPCs derive them on the server.
--
-- resource_occupancies is the single source of truth for "is this box busy".
-- Bookings and owner blocks both live here, and the EXCLUDE constraint makes any
-- overlap on the same resource impossible, whatever the concurrency.

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  code text not null check (code ~ '^[A-Z0-9]{6}$'),
  service_id uuid not null,
  resource_id uuid not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,

  -- Snapshot of the service at booking time.
  service_name text not null,
  price_minor bigint not null check (price_minor >= 0),
  price_is_from boolean not null default false,
  currency text not null,
  duration_minutes int not null check (duration_minutes > 0),
  buffer_minutes int not null check (buffer_minutes >= 0),

  customer_name text not null check (char_length(customer_name) between 1 and 80),
  customer_phone text not null check (customer_phone ~ '^\+[0-9]{10,15}$'),
  car_label text not null check (char_length(car_label) between 1 and 80),
  car_plate text check (char_length(car_plate) <= 16),
  customer_comment text check (char_length(customer_comment) <= 500),
  owner_note text check (char_length(owner_note) <= 500),
  -- Consent to process personal data for this booking (required for client bookings).
  consent_at timestamptz,

  status text not null default 'confirmed'
    check (status in ('confirmed', 'arrived', 'done', 'cancelled', 'no_show')),
  source text not null check (source in ('client', 'owner')),
  is_demo boolean not null default false,

  idempotency_key uuid not null,
  request_fingerprint text not null,

  arrived_at timestamptz,
  done_at timestamptz,
  no_show_at timestamptz,
  cancelled_at timestamptz,
  cancelled_by text check (cancelled_by in ('client', 'owner')),
  cancel_reason text check (char_length(cancel_reason) <= 300),
  reschedule_count int not null default 0,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (tenant_id, id),
  unique (tenant_id, code),
  unique (tenant_id, idempotency_key),
  check (ends_at > starts_at),
  check (source <> 'client' or consent_at is not null),
  foreign key (tenant_id, service_id) references public.services (tenant_id, id) on delete restrict,
  foreign key (tenant_id, resource_id) references public.resources (tenant_id, id) on delete restrict
);

create index bookings_tenant_start_idx on public.bookings (tenant_id, starts_at);
create index bookings_tenant_arrived_idx on public.bookings (tenant_id, arrived_at) where arrived_at is not null;
create index bookings_tenant_done_idx on public.bookings (tenant_id, done_at) where done_at is not null;

create trigger bookings_touch before update on public.bookings
  for each row execute function private.touch_updated_at();

create table public.resource_occupancies (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  resource_id uuid not null,
  kind text not null check (kind in ('booking', 'block')),
  booking_id uuid,
  during tstzrange not null,
  note text check (char_length(note) <= 200),
  released_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, resource_id) references public.resources (tenant_id, id) on delete cascade,
  foreign key (tenant_id, booking_id) references public.bookings (tenant_id, id) on delete cascade,
  check ((kind = 'booking') = (booking_id is not null)),
  check (not isempty(during) and lower_inc(during) and not upper_inc(during)
         and lower(during) is not null and upper(during) is not null),
  -- The invariant: one active occupant per resource at any instant.
  constraint resource_occupancies_no_overlap
    exclude using gist (tenant_id with =, resource_id with =, during with &&)
    where (released_at is null)
);

create unique index resource_occupancies_one_active_per_booking
  on public.resource_occupancies (booking_id)
  where released_at is null and kind = 'booking';
create index resource_occupancies_tenant_during_idx
  on public.resource_occupancies using gist (tenant_id, during)
  where released_at is null;

-- Client access to exactly one booking. Only the SHA-256 of the token is stored.
-- The token itself is HMAC(server key, booking_id:idempotency_key), so a retry of
-- the same create request can hand back the same token without storing it.
create table public.booking_access_tokens (
  booking_id uuid primary key,
  tenant_id uuid not null,
  token_hash bytea not null unique,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  foreign key (tenant_id, booking_id) references public.bookings (tenant_id, id) on delete cascade
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  booking_id uuid not null,
  kind text not null check (kind in ('payment', 'refund')),
  amount_minor bigint not null check (amount_minor > 0),
  method text not null check (method in ('cash', 'card', 'transfer', 'other')),
  paid_at timestamptz not null default now(),
  note text check (char_length(note) <= 200),
  is_demo boolean not null default false,
  idempotency_key uuid not null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (tenant_id, idempotency_key),
  foreign key (tenant_id, booking_id) references public.bookings (tenant_id, id) on delete cascade
);

create index payments_tenant_paid_idx on public.payments (tenant_id, paid_at);
create index payments_booking_idx on public.payments (tenant_id, booking_id);

-- Append-only history (status changes, reschedules, payments) for the cabinet.
create table public.booking_events (
  id bigint generated always as identity primary key,
  tenant_id uuid not null,
  booking_id uuid not null,
  kind text not null,
  payload jsonb not null default '{}'::jsonb,
  actor text not null check (actor in ('client', 'owner', 'system')),
  actor_user_id uuid,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, booking_id) references public.bookings (tenant_id, id) on delete cascade
);

create index booking_events_booking_idx on public.booking_events (tenant_id, booking_id, created_at);

alter table public.bookings enable row level security;
alter table public.resource_occupancies enable row level security;
alter table public.booking_access_tokens enable row level security;
alter table public.payments enable row level security;
alter table public.booking_events enable row level security;

create policy bookings_member_read on public.bookings
  for select to authenticated using ((select private.is_member(tenant_id)));
create policy occupancies_member_read on public.resource_occupancies
  for select to authenticated using ((select private.is_member(tenant_id)));
create policy payments_member_read on public.payments
  for select to authenticated using ((select private.is_member(tenant_id)));
create policy booking_events_member_read on public.booking_events
  for select to authenticated using ((select private.is_member(tenant_id)));
-- booking_access_tokens: no policy and no grants — not readable by any API role.

revoke all on public.bookings, public.resource_occupancies, public.booking_access_tokens,
  public.payments, public.booking_events from anon, authenticated;
grant select on public.bookings, public.resource_occupancies, public.payments,
  public.booking_events to authenticated;

-- ---------------------------------------------------------------------------
-- Booking helpers
-- ---------------------------------------------------------------------------
create or replace function private.new_booking_code(p_tenant_id uuid)
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code text;
  v_bytes bytea;
begin
  loop
    v_bytes := extensions.gen_random_bytes(6);
    v_code := '';
    for i in 0..5 loop
      v_code := v_code || substr(alphabet, (get_byte(v_bytes, i) % 32) + 1, 1);
    end loop;
    exit when not exists (select 1 from public.bookings where tenant_id = p_tenant_id and code = v_code);
  end loop;
  return v_code;
end;
$$;

create or replace function private.booking_access_token(p_booking_id uuid, p_idempotency_key uuid)
returns text
language sql
stable
set search_path = ''
as $$
  select private.base64url(
    extensions.hmac(
      convert_to(p_booking_id::text || ':' || p_idempotency_key::text, 'UTF8'),
      (select value from private.app_secrets where name = 'booking_token_key'),
      'sha256'
    )
  );
$$;

create or replace function private.token_hash(p_token text)
returns bytea
language sql
immutable
set search_path = ''
as $$
  select extensions.digest(convert_to(coalesce(p_token, ''), 'UTF8'), 'sha256');
$$;

create or replace function private.log_booking_event(
  p_tenant_id uuid, p_booking_id uuid, p_kind text, p_payload jsonb, p_actor text)
returns void
language sql
set search_path = ''
as $$
  insert into public.booking_events (tenant_id, booking_id, kind, payload, actor, actor_user_id)
  values (p_tenant_id, p_booking_id, p_kind, coalesce(p_payload, '{}'::jsonb), p_actor,
          case when p_actor = 'owner' then (select auth.uid()) end);
$$;

-- Maps an EXCLUDE violation on a resource to the occupant that blocks it (for messages).
create or replace function private.conflicting_occupant(p_resource_id uuid, p_range tstzrange)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'kind', o.kind,
    'booking_code', b.code,
    'starts_at', lower(o.during),
    'ends_at', upper(o.during))
  from public.resource_occupancies o
  left join public.bookings b on b.id = o.booking_id
  where o.resource_id = p_resource_id and o.released_at is null and o.during && p_range
  order by lower(o.during)
  limit 1;
$$;
