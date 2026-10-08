-- Tenant media bucket. Public read (photos are public on the studio page).
-- Writes: the pipeline uploads <tenant_id>/config/* with the service role;
-- owners upload <tenant_id>/owner/* for their own studio only.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('tenant-media', 'tenant-media', true, 8388608,
        array['image/webp', 'image/jpeg', 'image/png', 'image/avif'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Tenant id of an owner upload path "<uuid>/owner/<file>", or NULL for anything else.
create or replace function private.owner_media_tenant(p_name text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when p_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/owner/[A-Za-z0-9._-]{1,120}$'
      then split_part(p_name, '/', 1)::uuid
  end;
$$;

revoke all on function private.owner_media_tenant(text) from public, anon;
grant execute on function private.owner_media_tenant(text) to authenticated, service_role;

drop policy if exists tenant_media_owner_insert on storage.objects;
drop policy if exists tenant_media_owner_select on storage.objects;
drop policy if exists tenant_media_owner_delete on storage.objects;

create policy tenant_media_owner_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'tenant-media'
              and private.is_member(private.owner_media_tenant(name)));

create policy tenant_media_owner_select on storage.objects
  for select to authenticated
  using (bucket_id = 'tenant-media'
         and private.is_member(private.owner_media_tenant(name)));

create policy tenant_media_owner_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'tenant-media'
         and private.is_member(private.owner_media_tenant(name)));
