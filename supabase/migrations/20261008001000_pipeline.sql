-- Tenant pipeline (service role only): business.json → database.
--
-- Merge rules on republish:
--   * bookings, payments and owner-uploaded photos are never touched;
--   * profile fields listed in tenants.owner_overrides keep the owner's value;
--   * config rows the owner edited (owner_modified) are skipped and reported;
--   * config rows that disappeared from business.json are deactivated, not deleted;
--   * status stays as is; `activate` switches preview → live after strict checks and
--     removes demo bookings made while the studio was a preview.

create or replace function private.cfg_text(p jsonb, p_path text[], p_min int, p_max int)
returns text
language sql
immutable
set search_path = ''
as $$
  select private.clean_text(p #>> p_path, p_min, p_max);
$$;

create or replace function public.admin_publish_tenant(p_config jsonb, p_options jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  c jsonb := p_config;
  v_slug text := lower(btrim(p_config ->> 'slug'));
  v_hash text := md5(p_config::text);
  v_activate boolean := coalesce((p_options ->> 'activate')::boolean, false);
  t public.tenants;
  v_created boolean := false;
  v_ov text[];
  v_skipped jsonb := '[]'::jsonb;
  v_item jsonb;
  v_id uuid;
  v_modified boolean;
  v_purged int := 0;
  v_cards jsonb;
begin
  if v_slug is null or v_slug !~ '^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$' then
    perform private.fail(422, 'invalid_config', 'slug: латиница, цифры и дефис');
  end if;
  if not private.is_valid_timezone(c ->> 'timezone') then
    perform private.fail(422, 'invalid_config', 'timezone: неизвестный часовой пояс');
  end if;
  if coalesce(c ->> 'accent_color', '') !~ '^#[0-9A-Fa-f]{6}$' then
    perform private.fail(422, 'invalid_config', 'accent_color: формат #RRGGBB');
  end if;

  select * into t from public.tenants where slug = v_slug for update;
  if t.id is null then
    insert into public.tenants (slug, status, timezone, currency, locale, name, short_name, accent_color)
    values (v_slug, 'preview', c ->> 'timezone', coalesce(c ->> 'currency', 'RUB'),
            coalesce(c ->> 'locale', 'ru-RU'), c ->> 'name', c ->> 'short_name', upper(c ->> 'accent_color'))
    returning * into t;
    v_created := true;
  end if;
  v_ov := t.owner_overrides;
  v_cards := private.validate_info_cards(c -> 'info_cards');

  update public.tenants set
    timezone = c ->> 'timezone',
    currency = coalesce(c ->> 'currency', currency),
    locale = coalesce(c ->> 'locale', locale),
    name = case when 'name' = any (v_ov) then name else private.cfg_text(c, '{name}', 1, 80) end,
    short_name = case when 'short_name' = any (v_ov) then short_name else private.cfg_text(c, '{short_name}', 1, 24) end,
    tagline = case when 'tagline' = any (v_ov) then tagline else private.cfg_text(c, '{tagline}', 1, 120) end,
    description = case when 'description' = any (v_ov) then description else private.cfg_text(c, '{description}', 1, 600) end,
    address = case when 'address' = any (v_ov) then address else private.cfg_text(c, '{contacts,address}', 1, 200) end,
    address_note = case when 'address_note' = any (v_ov) then address_note else private.cfg_text(c, '{contacts,address_note}', 1, 300) end,
    map_url = case when 'map_url' = any (v_ov) then map_url else c #>> '{contacts,map_url}' end,
    messenger_url = case when 'messenger_url' = any (v_ov) then messenger_url else c #>> '{contacts,messenger_url}' end,
    geo_lat = (c #>> '{contacts,geo,lat}')::double precision,
    geo_lng = (c #>> '{contacts,geo,lng}')::double precision,
    phone = case when 'phone' = any (v_ov) then phone else private.normalize_phone(c #>> '{contacts,phone}') end,
    phone_display = case when 'phone_display' = any (v_ov) then phone_display else private.cfg_text(c, '{contacts,phone_display}', 1, 32) end,
    accent_color = case when 'accent_color' = any (v_ov) then accent_color else upper(c ->> 'accent_color') end,
    hero_alt = case when 'hero_alt' = any (v_ov) then hero_alt else private.cfg_text(c, '{media,hero_alt}', 1, 160) end,
    logo_path = case when 'logo' = any (v_ov) then logo_path else c #>> '{media,logo_path}' end,
    hero_path = case when 'hero' = any (v_ov) then hero_path else c #>> '{media,hero_path}' end,
    info_cards = case when 'info_cards' = any (v_ov) then info_cards else v_cards end,
    slot_step_minutes = case when 'slot_step_minutes' = any (v_ov) then slot_step_minutes
                             else coalesce((c #>> '{booking,slot_step_minutes}')::int, slot_step_minutes) end,
    min_lead_minutes = case when 'min_lead_minutes' = any (v_ov) then min_lead_minutes
                            else coalesce((c #>> '{booking,min_lead_minutes}')::int, min_lead_minutes) end,
    horizon_days = case when 'horizon_days' = any (v_ov) then horizon_days
                        else coalesce((c #>> '{booking,horizon_days}')::int, horizon_days) end,
    cancel_until_hours = case when 'cancel_until_hours' = any (v_ov) then cancel_until_hours
                              else coalesce((c #>> '{booking,cancel_until_hours}')::int, cancel_until_hours) end,
    config_version = config_version + case when config_hash is distinct from v_hash then 1 else 0 end,
    config_hash = v_hash,
    published_at = now()
  where id = t.id;

  select coalesce(jsonb_agg(f), '[]'::jsonb) into v_skipped
  from unnest(v_ov) f;
  v_skipped := jsonb_build_array(jsonb_build_object('kind', 'profile_fields', 'items', v_skipped));

  -- Resources -------------------------------------------------------------
  for v_item in select * from jsonb_array_elements(coalesce(c -> 'resources', '[]'::jsonb)) loop
    select id, owner_modified into v_id, v_modified from public.resources
    where tenant_id = t.id and key = v_item ->> 'key';
    if v_id is null then
      insert into public.resources (tenant_id, key, name, kind, sort, origin)
      values (t.id, v_item ->> 'key', v_item ->> 'name', coalesce(v_item ->> 'kind', 'box'),
              coalesce((v_item ->> 'sort')::int, 0), 'config');
    elsif v_modified then
      v_skipped := v_skipped || jsonb_build_object('kind', 'resource', 'key', v_item ->> 'key');
    else
      update public.resources
      set name = v_item ->> 'name', kind = coalesce(v_item ->> 'kind', 'box'),
          sort = coalesce((v_item ->> 'sort')::int, 0), is_active = true
      where id = v_id;
    end if;
  end loop;
  update public.resources r set is_active = false
  where r.tenant_id = t.id and r.origin = 'config' and not r.owner_modified
    and not exists (select 1 from jsonb_array_elements(coalesce(c -> 'resources', '[]'::jsonb)) x
                    where x ->> 'key' = r.key);

  -- Services --------------------------------------------------------------
  for v_item in select * from jsonb_array_elements(coalesce(c -> 'services', '[]'::jsonb)) loop
    select id, owner_modified into v_id, v_modified from public.services
    where tenant_id = t.id and key = v_item ->> 'key';
    if v_id is not null and v_modified then
      v_skipped := v_skipped || jsonb_build_object('kind', 'service', 'key', v_item ->> 'key');
      continue;
    end if;
    if v_id is null then
      insert into public.services (tenant_id, key, name, description, category, price_minor, price_is_from,
                                   duration_minutes, buffer_minutes, sort, origin)
      values (t.id, v_item ->> 'key', v_item ->> 'name', v_item ->> 'description', v_item ->> 'category',
              (v_item ->> 'price_minor')::bigint, coalesce((v_item ->> 'price_is_from')::boolean, false),
              (v_item ->> 'duration_minutes')::int, coalesce((v_item ->> 'buffer_minutes')::int, 0),
              coalesce((v_item ->> 'sort')::int, 0), 'config')
      returning id into v_id;
    else
      update public.services
      set name = v_item ->> 'name', description = v_item ->> 'description', category = v_item ->> 'category',
          price_minor = (v_item ->> 'price_minor')::bigint,
          price_is_from = coalesce((v_item ->> 'price_is_from')::boolean, false),
          duration_minutes = (v_item ->> 'duration_minutes')::int,
          buffer_minutes = coalesce((v_item ->> 'buffer_minutes')::int, 0),
          sort = coalesce((v_item ->> 'sort')::int, 0), is_active = true
      where id = v_id;
    end if;
    delete from public.service_resources where tenant_id = t.id and service_id = v_id;
    insert into public.service_resources (tenant_id, service_id, resource_id)
    select t.id, v_id, r.id
    from public.resources r
    where r.tenant_id = t.id
      and r.key in (select jsonb_array_elements_text(coalesce(v_item -> 'resources', '[]'::jsonb)));
  end loop;
  update public.services s set is_active = false
  where s.tenant_id = t.id and s.origin = 'config' and not s.owner_modified
    and not exists (select 1 from jsonb_array_elements(coalesce(c -> 'services', '[]'::jsonb)) x
                    where x ->> 'key' = s.key);

  -- Working hours -----------------------------------------------------------
  if 'working_hours' = any (v_ov) then
    v_skipped := v_skipped || jsonb_build_object('kind', 'working_hours');
  else
    delete from public.working_hours where tenant_id = t.id;
    insert into public.working_hours (tenant_id, weekday, opens_at, closes_at)
    select t.id, (h ->> 'weekday')::smallint, (h ->> 'opens_at')::time, (h ->> 'closes_at')::time
    from jsonb_array_elements(coalesce(c -> 'hours', '[]'::jsonb)) h;
  end if;

  -- Date exceptions from config (owner-made exceptions on the same date win) ----
  delete from public.schedule_exceptions e
  where e.tenant_id = t.id and e.origin = 'config'
    and not exists (select 1 from jsonb_array_elements(coalesce(c -> 'exceptions', '[]'::jsonb)) x
                    where (x ->> 'date')::date = e.date);
  insert into public.schedule_exceptions (tenant_id, date, is_closed, opens_at, closes_at, note, origin)
  select t.id, (x ->> 'date')::date, coalesce((x ->> 'is_closed')::boolean, true),
         (x ->> 'opens_at')::time, (x ->> 'closes_at')::time, x ->> 'note', 'config'
  from jsonb_array_elements(coalesce(c -> 'exceptions', '[]'::jsonb)) x
  on conflict (tenant_id, date) do update
    set is_closed = excluded.is_closed, opens_at = excluded.opens_at,
        closes_at = excluded.closes_at, note = excluded.note
    where public.schedule_exceptions.origin = 'config';

  -- Portfolio photos from config (owner uploads and owner-edited cards untouched) --
  for v_item in select * from jsonb_array_elements(coalesce(c -> 'photos', '[]'::jsonb)) loop
    select id, owner_modified into v_id, v_modified from public.tenant_photos
    where tenant_id = t.id and key = v_item ->> 'key';
    if v_id is null then
      insert into public.tenant_photos (tenant_id, key, storage_path, caption, sort, origin)
      values (t.id, v_item ->> 'key', v_item ->> 'path', v_item ->> 'caption',
              coalesce((v_item ->> 'sort')::int, 0), 'config');
    elsif v_modified then
      v_skipped := v_skipped || jsonb_build_object('kind', 'photo', 'key', v_item ->> 'key');
    else
      update public.tenant_photos
      set storage_path = v_item ->> 'path', caption = v_item ->> 'caption',
          sort = coalesce((v_item ->> 'sort')::int, 0), is_active = true
      where id = v_id;
    end if;
  end loop;
  update public.tenant_photos p set is_active = false
  where p.tenant_id = t.id and p.origin = 'config' and not p.owner_modified
    and not exists (select 1 from jsonb_array_elements(coalesce(c -> 'photos', '[]'::jsonb)) x
                    where x ->> 'key' = p.key);

  -- Activation ---------------------------------------------------------------
  select * into t from public.tenants where id = t.id;
  if v_activate and t.status <> 'live' then
    if t.phone is null or t.address is null then
      perform private.fail(422, 'not_ready', 'Для запуска нужны телефон и адрес');
    end if;
    if not exists (select 1 from public.working_hours where tenant_id = t.id) then
      perform private.fail(422, 'not_ready', 'Для запуска нужны часы работы');
    end if;
    if not exists (select 1 from public.services s
                   join public.service_resources sr on sr.tenant_id = s.tenant_id and sr.service_id = s.id
                   join public.resources r on r.tenant_id = sr.tenant_id and r.id = sr.resource_id and r.is_active
                   where s.tenant_id = t.id and s.is_active) then
      perform private.fail(422, 'not_ready', 'Нужна хотя бы одна услуга с боксом');
    end if;
    delete from public.bookings where tenant_id = t.id and is_demo;
    get diagnostics v_purged = row_count;
    update public.tenants set status = 'live', live_at = coalesce(live_at, now()) where id = t.id;
  end if;

  select * into t from public.tenants where id = t.id;
  return jsonb_build_object(
    'tenant_id', t.id, 'slug', t.slug, 'status', t.status, 'created', v_created,
    'config_version', t.config_version, 'purged_demo_bookings', v_purged,
    'owner_overrides', to_jsonb(t.owner_overrides), 'skipped', v_skipped);
end;
$$;

create or replace function public.admin_add_member(p_slug text, p_user_id uuid, p_role text default 'owner')
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  select id into v_tenant from public.tenants where slug = lower(btrim(p_slug));
  if v_tenant is null then
    perform private.fail(404, 'not_found', 'Студия не найдена');
  end if;
  insert into public.tenant_members (tenant_id, user_id, role)
  values (v_tenant, p_user_id, coalesce(p_role, 'owner'))
  on conflict (tenant_id, user_id) do update set role = excluded.role;
  return jsonb_build_object('tenant_id', v_tenant, 'user_id', p_user_id);
end;
$$;

create or replace function public.admin_tenant_info(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'tenant_id', t.id, 'slug', t.slug, 'status', t.status, 'name', t.name,
    'config_version', t.config_version, 'published_at', t.published_at, 'live_at', t.live_at,
    'owner_overrides', to_jsonb(t.owner_overrides),
    'services_active', (select count(*) from public.services where tenant_id = t.id and is_active),
    'resources_active', (select count(*) from public.resources where tenant_id = t.id and is_active),
    'photos_active', (select count(*) from public.tenant_photos where tenant_id = t.id and is_active),
    'bookings_demo', (select count(*) from public.bookings where tenant_id = t.id and is_demo),
    'bookings_real', (select count(*) from public.bookings where tenant_id = t.id and not is_demo),
    'members', (select count(*) from public.tenant_members where tenant_id = t.id))
  from public.tenants t where t.slug = lower(btrim(p_slug));
$$;

revoke all on function public.admin_publish_tenant(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.admin_add_member(text, uuid, text) from public, anon, authenticated;
revoke all on function public.admin_tenant_info(text) from public, anon, authenticated;
grant execute on function public.admin_publish_tenant(jsonb, jsonb) to service_role;
grant execute on function public.admin_add_member(text, uuid, text) to service_role;
grant execute on function public.admin_tenant_info(text) to service_role;
