-- Tempo: "payer" access level and Venmo usernames.
-- Paste into Supabase → SQL Editor → Run. Safe to re-run; it keeps existing data.
--
-- A payer can see everything, record payments, plan shifts, and create jobs with
-- their own rates. They can't change time entries, or jobs and rates someone else made.

alter type public.workspace_role add value if not exists 'payer';

alter table public.profiles add column if not exists venmo_username text
  check (venmo_username is null or venmo_username ~ '^[A-Za-z0-9_-]{1,40}$');

-- Owners and full members (not payers). Uses only the pre-existing role values, so it
-- works in the same transaction that adds 'payer'.
create or replace function public.is_workspace_editor(target_workspace_id uuid)
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
      and role in ('owner', 'member')
  );
$$;

-- Editors can change any job; payers only the jobs they created.
create or replace function public.can_manage_job(target_job_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.jobs
    where jobs.id = target_job_id
      and (public.is_workspace_editor(jobs.workspace_id)
           or (jobs.created_by = auth.uid() and public.is_workspace_member(jobs.workspace_id)))
  );
$$;

-- Time entries: everyone in the workspace can read; only editors can write.
drop policy if exists "members can manage time entries" on public.time_entries;
drop policy if exists "members can read time entries" on public.time_entries;
drop policy if exists "editors can write time entries" on public.time_entries;
create policy "members can read time entries"
on public.time_entries for select to authenticated
using (public.is_workspace_member(workspace_id));
create policy "editors can write time entries"
on public.time_entries for all to authenticated
using (public.is_workspace_editor(workspace_id))
with check (public.is_workspace_editor(workspace_id));

-- Breaks follow their time entry.
drop policy if exists "members can manage breaks" on public.breaks;
drop policy if exists "members can read breaks" on public.breaks;
drop policy if exists "editors can write breaks" on public.breaks;
create policy "members can read breaks"
on public.breaks for select to authenticated
using (exists (
  select 1 from public.time_entries
  where time_entries.id = breaks.time_entry_id
    and public.is_workspace_member(time_entries.workspace_id)
));
create policy "editors can write breaks"
on public.breaks for all to authenticated
using (exists (
  select 1 from public.time_entries
  where time_entries.id = breaks.time_entry_id
    and public.is_workspace_editor(time_entries.workspace_id)
))
with check (exists (
  select 1 from public.time_entries
  where time_entries.id = breaks.time_entry_id
    and public.is_workspace_editor(time_entries.workspace_id)
));

-- Jobs: everyone reads and can create; editors change any job, payers only their own.
drop policy if exists "members can manage jobs" on public.jobs;
drop policy if exists "members can read jobs" on public.jobs;
drop policy if exists "members can create jobs" on public.jobs;
drop policy if exists "job managers can update jobs" on public.jobs;
drop policy if exists "job managers can delete jobs" on public.jobs;
create policy "members can read jobs"
on public.jobs for select to authenticated
using (public.is_workspace_member(workspace_id));
create policy "members can create jobs"
on public.jobs for insert to authenticated
with check (public.is_workspace_member(workspace_id) and created_by = auth.uid());
create policy "job managers can update jobs"
on public.jobs for update to authenticated
using (public.is_workspace_editor(workspace_id) or (created_by = auth.uid() and public.is_workspace_member(workspace_id)))
with check (public.is_workspace_editor(workspace_id) or (created_by = auth.uid() and public.is_workspace_member(workspace_id)));
create policy "job managers can delete jobs"
on public.jobs for delete to authenticated
using (public.is_workspace_editor(workspace_id) or (created_by = auth.uid() and public.is_workspace_member(workspace_id)));

-- Job rates: everyone reads; writes need permission to manage that job.
drop policy if exists "members can manage job rates" on public.job_rates;
drop policy if exists "members can read job rates" on public.job_rates;
drop policy if exists "job managers can write job rates" on public.job_rates;
create policy "members can read job rates"
on public.job_rates for select to authenticated
using (public.is_workspace_member(workspace_id));
create policy "job managers can write job rates"
on public.job_rates for all to authenticated
using (public.can_manage_job(job_id))
with check (public.can_manage_job(job_id) and exists (
  select 1 from public.jobs where jobs.id = job_rates.job_id and jobs.workspace_id = job_rates.workspace_id
));

-- Jobs created through the app should always record their creator.
alter table public.jobs alter column created_by set default auth.uid();

-- Planned shifts and week payments stay open to everyone in the workspace (unchanged).
