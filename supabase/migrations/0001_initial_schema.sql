-- Tempo shared workspace schema
-- All times are stored as timestamptz and displayed in America/New_York by the client.
--
-- Paste this whole file into Supabase → SQL Editor → Run. It is safe to re-run:
-- the reset block drops only Tempo's own tables, types and functions (test data only).

-- ---------------------------------------------------------------------------
-- Reset (Tempo objects only)
-- ---------------------------------------------------------------------------
drop table if exists public.sync_conflicts cascade;
drop table if exists public.audit_events cascade;
drop table if exists public.planned_shifts cascade;
drop table if exists public.breaks cascade;
drop table if exists public.time_entries cascade;
drop table if exists public.job_rates cascade;
drop table if exists public.rate_rules cascade;
drop table if exists public.jobs cascade;
drop table if exists public.workspace_invites cascade;
drop table if exists public.workspace_members cascade;
drop table if exists public.workspaces cascade;
drop table if exists public.profiles cascade;
drop function if exists public.bootstrap_workspace() cascade;
drop function if exists public.is_workspace_member(uuid) cascade;
drop function if exists public.is_workspace_owner(uuid) cascade;
drop function if exists public.bump_version() cascade;
drop function if exists public.touch_updated_at() cascade;
drop function if exists public.write_audit_event() cascade;
drop type if exists public.workspace_role cascade;
drop type if exists public.entry_mode cascade;
drop type if exists public.audit_action cascade;
drop type if exists public.conflict_status cascade;

create extension if not exists pgcrypto;

create type public.workspace_role as enum ('owner', 'member');
create type public.entry_mode as enum ('timer', 'range', 'duration');
create type public.audit_action as enum ('created', 'updated', 'deleted', 'started', 'stopped', 'planned', 'conflict');
create type public.conflict_status as enum ('open', 'resolved', 'dismissed');

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  initials text not null check (char_length(initials) between 1 and 4),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  timezone text not null default 'America/New_York',
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.workspace_role not null default 'member',
  default_rate_cents integer not null default 0 check (default_rate_cents >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

-- Pending email invitations. When someone signs in with an invited email,
-- bootstrap_workspace() turns the invite into a membership.
create table public.workspace_invites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  email text not null check (email = lower(email) and position('@' in email) > 1),
  role public.workspace_role not null default 'member',
  default_rate_cents integer not null default 0 check (default_rate_cents >= 0),
  invited_by uuid not null default auth.uid() references auth.users(id),
  accepted_by uuid references auth.users(id),
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index workspace_invites_pending_idx on public.workspace_invites (workspace_id, email) where accepted_at is null;

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  color text not null default 'indigo',
  is_general boolean not null default true,
  deleted_at timestamptz,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One hourly rate per person per job. No row = use the person's default rate.
create table public.job_rates (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  person_id uuid not null references auth.users(id) on delete cascade,
  rate_cents integer not null check (rate_cents >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (job_id, person_id)
);

create index job_rates_workspace_idx on public.job_rates (workspace_id);

create table public.time_entries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  person_id uuid not null references auth.users(id),
  job_id uuid not null references public.jobs(id),
  mode public.entry_mode not null,
  entry_date date,
  start_at timestamptz,
  end_at timestamptz,
  duration_minutes numeric(10, 2),
  rounded_minutes integer not null default 0 check (rounded_minutes >= 0),
  rate_override_cents integer check (rate_override_cents is null or rate_override_cents >= 0),
  applied_rate_cents integer not null default 0 check (applied_rate_cents >= 0),
  gross_pay_cents integer not null default 0 check (gross_pay_cents >= 0),
  note text,
  version bigint not null default 1,
  client_mutation_id uuid,
  deleted_at timestamptz,
  created_by uuid not null default auth.uid() references auth.users(id),
  updated_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (mode = 'duration' and entry_date is not null and duration_minutes is not null and duration_minutes > 0)
    or
    (mode in ('timer', 'range') and start_at is not null)
  ),
  check (end_at is null or start_at is null or end_at >= start_at)
);

create index time_entries_week_idx on public.time_entries (workspace_id, entry_date, start_at);
create index time_entries_person_idx on public.time_entries (workspace_id, person_id, start_at);

-- A break can be open (start only), finished (start + end), or a plain duration.
create table public.breaks (
  id uuid primary key default gen_random_uuid(),
  time_entry_id uuid not null references public.time_entries(id) on delete cascade,
  start_at timestamptz,
  end_at timestamptz,
  duration_minutes numeric(10, 2),
  paid boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (start_at is not null or duration_minutes is not null),
  check (end_at is null or (start_at is not null and end_at >= start_at)),
  check (duration_minutes is null or duration_minutes >= 0)
);

create index breaks_entry_idx on public.breaks (time_entry_id);

create table public.planned_shifts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  person_id uuid references auth.users(id),
  job_id uuid not null references public.jobs(id),
  start_at timestamptz not null,
  end_at timestamptz not null,
  note text,
  version bigint not null default 1,
  client_mutation_id uuid,
  deleted_at timestamptz,
  created_by uuid not null default auth.uid() references auth.users(id),
  updated_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_at >= start_at)
);

create index planned_shifts_calendar_idx on public.planned_shifts (workspace_id, start_at);

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  actor_id uuid references auth.users(id),
  action public.audit_action not null,
  entity_type text not null,
  entity_id uuid,
  before_data jsonb,
  after_data jsonb,
  client_mutation_id uuid,
  created_at timestamptz not null default now()
);

create index audit_events_workspace_idx on public.audit_events (workspace_id, created_at desc);

create table public.sync_conflicts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  entity_type text not null,
  entity_id uuid not null,
  client_mutation_id uuid,
  client_version bigint,
  server_version bigint,
  client_data jsonb not null,
  server_data jsonb not null,
  status public.conflict_status not null default 'open',
  created_by uuid references auth.users(id),
  resolved_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index sync_conflicts_open_idx on public.sync_conflicts (workspace_id, status, created_at desc);

-- ---------------------------------------------------------------------------
-- Helper functions
-- ---------------------------------------------------------------------------
create or replace function public.is_workspace_member(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.workspace_members
    where workspace_id = target_workspace_id
      and user_id = auth.uid()
  );
$$;

create or replace function public.is_workspace_owner(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.workspace_members
    where workspace_id = target_workspace_id
      and user_id = auth.uid()
      and role = 'owner'
  );
$$;

-- Called by the app right after sign-in. Accepts any pending invites for the
-- signed-in email, otherwise creates a personal workspace with default jobs.
-- Returns the workspace the app should open.
create or replace function public.bootstrap_workspace()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  user_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  invite record;
  target uuid;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;

  for invite in
    select * from public.workspace_invites
    where email = user_email and accepted_at is null
    order by created_at
  loop
    insert into public.workspace_members (workspace_id, user_id, role, default_rate_cents)
    values (invite.workspace_id, uid, invite.role, invite.default_rate_cents)
    on conflict (workspace_id, user_id) do nothing;
    update public.workspace_invites set accepted_at = now(), accepted_by = uid where id = invite.id;
  end loop;

  -- Most recently joined workspace wins, so an accepted invite opens the shared workspace.
  select workspace_id into target
  from public.workspace_members
  where user_id = uid
  order by created_at desc
  limit 1;
  if target is not null then
    return target;
  end if;

  insert into public.workspaces (name, created_by)
  values ('Personal time clock', uid)
  returning id into target;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (target, uid, 'owner');

  insert into public.jobs (workspace_id, name, color, is_general, created_by) values
    (target, 'General work', 'indigo', true, uid),
    (target, 'Client work', 'indigo', false, uid),
    (target, 'Studio admin', 'orange', true, uid),
    (target, 'Planning & research', 'green', true, uid),
    (target, 'Personal project', 'purple', true, uid);

  return target;
end;
$$;

revoke all on function public.bootstrap_workspace() from public, anon;
grant execute on function public.bootstrap_workspace() to authenticated;

create or replace function public.bump_version()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  new.version = old.version + 1;
  new.created_by = old.created_by;
  new.updated_by = coalesce(auth.uid(), old.updated_by);
  return new;
end;
$$;

create trigger time_entries_version_trigger
before update on public.time_entries
for each row execute function public.bump_version();

create trigger planned_shifts_version_trigger
before update on public.planned_shifts
for each row execute function public.bump_version();

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger jobs_touch_trigger before update on public.jobs for each row execute function public.touch_updated_at();
create trigger job_rates_touch_trigger before update on public.job_rates for each row execute function public.touch_updated_at();
create trigger breaks_touch_trigger before update on public.breaks for each row execute function public.touch_updated_at();
create trigger workspace_members_touch_trigger before update on public.workspace_members for each row execute function public.touch_updated_at();

create or replace function public.write_audit_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  workspace uuid;
  entity uuid;
  action_name public.audit_action;
  old_record jsonb;
  new_record jsonb;
begin
  if tg_op = 'DELETE' then
    workspace := old.workspace_id;
    entity := old.id;
    action_name := 'deleted';
    old_record := to_jsonb(old);
    new_record := null;
  else
    workspace := new.workspace_id;
    entity := new.id;
    old_record := case when tg_op = 'UPDATE' then to_jsonb(old) else null end;
    new_record := to_jsonb(new);
    action_name := case
      when tg_op = 'INSERT' then 'created'
      when new_record ->> 'deleted_at' is not null and old_record ->> 'deleted_at' is null then 'deleted'
      else 'updated'
    end;
  end if;

  insert into public.audit_events (workspace_id, actor_id, action, entity_type, entity_id, before_data, after_data)
  values (workspace, auth.uid(), action_name, tg_table_name, entity, old_record, new_record);
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger time_entries_audit_trigger
after insert or update or delete on public.time_entries
for each row execute function public.write_audit_event();

create trigger planned_shifts_audit_trigger
after insert or update or delete on public.planned_shifts
for each row execute function public.write_audit_event();

create trigger jobs_audit_trigger
after insert or update or delete on public.jobs
for each row execute function public.write_audit_event();

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.workspace_invites enable row level security;
alter table public.jobs enable row level security;
alter table public.job_rates enable row level security;
alter table public.time_entries enable row level security;
alter table public.breaks enable row level security;
alter table public.planned_shifts enable row level security;
alter table public.audit_events enable row level security;
alter table public.sync_conflicts enable row level security;

create policy "members can read profiles"
on public.profiles for select to authenticated
using (id = auth.uid() or exists (
  select 1 from public.workspace_members mine
  join public.workspace_members theirs on theirs.workspace_id = mine.workspace_id
  where mine.user_id = auth.uid() and theirs.user_id = profiles.id
));

create policy "users can manage their profile"
on public.profiles for all to authenticated
using (id = auth.uid())
with check (id = auth.uid());

create policy "members can read workspaces"
on public.workspaces for select to authenticated
using (public.is_workspace_member(id));

create policy "owners can update workspaces"
on public.workspaces for update to authenticated
using (public.is_workspace_owner(id))
with check (public.is_workspace_owner(id));

create policy "members can read membership"
on public.workspace_members for select to authenticated
using (public.is_workspace_member(workspace_id));

create policy "owners can manage membership"
on public.workspace_members for all to authenticated
using (public.is_workspace_owner(workspace_id))
with check (public.is_workspace_owner(workspace_id));

create policy "owners can manage invites"
on public.workspace_invites for all to authenticated
using (public.is_workspace_owner(workspace_id))
with check (public.is_workspace_owner(workspace_id));

create policy "members can manage jobs"
on public.jobs for all to authenticated
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

create policy "members can manage job rates"
on public.job_rates for all to authenticated
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

create policy "members can manage time entries"
on public.time_entries for all to authenticated
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

create policy "members can manage breaks"
on public.breaks for all to authenticated
using (exists (
  select 1 from public.time_entries
  where time_entries.id = breaks.time_entry_id
    and public.is_workspace_member(time_entries.workspace_id)
))
with check (exists (
  select 1 from public.time_entries
  where time_entries.id = breaks.time_entry_id
    and public.is_workspace_member(time_entries.workspace_id)
));

create policy "members can manage planned shifts"
on public.planned_shifts for all to authenticated
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

create policy "members can read audit history"
on public.audit_events for select to authenticated
using (public.is_workspace_member(workspace_id));

create policy "members can read conflicts"
on public.sync_conflicts for select to authenticated
using (public.is_workspace_member(workspace_id));

create policy "members can resolve conflicts"
on public.sync_conflicts for update to authenticated
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

-- ---------------------------------------------------------------------------
-- Realtime: lets each person's app refresh when the other makes a change.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['jobs', 'job_rates', 'time_entries', 'breaks', 'planned_shifts', 'workspace_members'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end;
$$;
