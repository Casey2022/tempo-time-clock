-- Tempo: photos on time entries and planned shifts.
-- Paste into Supabase → SQL Editor → Run. Safe to re-run; it keeps existing data.
--
-- Files live in a private storage bucket under <workspace id>/<photo id>.jpg. Everyone in
-- the workspace can view and add photos; the person who added one (or the owner) can delete it.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('tempo-photos', 'tempo-photos', false, 8388608, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.attachments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  entry_id uuid references public.time_entries(id) on delete cascade,
  shift_id uuid references public.planned_shifts(id) on delete cascade,
  storage_path text not null unique,
  caption text check (caption is null or char_length(caption) <= 200),
  width integer,
  height integer,
  size_bytes integer,
  deleted_at timestamptz,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  check ((entry_id is not null)::int + (shift_id is not null)::int = 1),
  check (storage_path like workspace_id::text || '/%')
);

create index if not exists attachments_entry_idx on public.attachments (entry_id) where deleted_at is null;
create index if not exists attachments_shift_idx on public.attachments (shift_id) where deleted_at is null;
create index if not exists attachments_workspace_idx on public.attachments (workspace_id, created_at desc);

alter table public.attachments enable row level security;

drop policy if exists "members can read attachments" on public.attachments;
drop policy if exists "members can add attachments" on public.attachments;
drop policy if exists "uploader or owner can change attachments" on public.attachments;
drop policy if exists "uploader or owner can delete attachments" on public.attachments;

create policy "members can read attachments"
on public.attachments for select to authenticated
using (public.is_workspace_member(workspace_id));

-- The entry or shift must belong to the same workspace.
create policy "members can add attachments"
on public.attachments for insert to authenticated
with check (
  public.is_workspace_member(workspace_id)
  and created_by = auth.uid()
  and (entry_id is null or exists (select 1 from public.time_entries t where t.id = entry_id and t.workspace_id = attachments.workspace_id))
  and (shift_id is null or exists (select 1 from public.planned_shifts s where s.id = shift_id and s.workspace_id = attachments.workspace_id))
);

create policy "uploader or owner can change attachments"
on public.attachments for update to authenticated
using (created_by = auth.uid() or public.is_workspace_owner(workspace_id))
with check (public.is_workspace_member(workspace_id));

create policy "uploader or owner can delete attachments"
on public.attachments for delete to authenticated
using (created_by = auth.uid() or public.is_workspace_owner(workspace_id));

-- Storage: the first folder of the file path is the workspace id.
create or replace function public.photo_workspace(object_name text)
returns uuid
language sql
immutable
as $$
  select case when split_part(object_name, '/', 1) ~ '^[0-9a-fA-F-]{36}$'
              then split_part(object_name, '/', 1)::uuid end;
$$;

drop policy if exists "tempo members can view photos" on storage.objects;
drop policy if exists "tempo members can upload photos" on storage.objects;
drop policy if exists "tempo uploader or owner can delete photos" on storage.objects;

create policy "tempo members can view photos"
on storage.objects for select to authenticated
using (bucket_id = 'tempo-photos' and public.is_workspace_member(public.photo_workspace(name)));

create policy "tempo members can upload photos"
on storage.objects for insert to authenticated
with check (bucket_id = 'tempo-photos' and public.is_workspace_member(public.photo_workspace(name)));

create policy "tempo uploader or owner can delete photos"
on storage.objects for delete to authenticated
using (bucket_id = 'tempo-photos' and (owner_id = auth.uid()::text or public.is_workspace_owner(public.photo_workspace(name))));

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'attachments'
  ) then
    alter publication supabase_realtime add table public.attachments;
  end if;
end;
$$;
