-- Tempo: record how much of each person's week has been paid.
-- Paste into Supabase → SQL Editor → Run. Safe to re-run; it does not touch existing data.

create table if not exists public.week_payments (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  person_id uuid not null references auth.users(id) on delete cascade,
  week_start date not null check (extract(isodow from week_start) = 1),
  amount_paid_cents integer not null default 0 check (amount_paid_cents >= 0),
  updated_by uuid default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, person_id, week_start)
);

create or replace function public.week_payments_touch()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  new.updated_by = coalesce(auth.uid(), old.updated_by);
  return new;
end;
$$;

drop trigger if exists week_payments_touch_trigger on public.week_payments;
create trigger week_payments_touch_trigger
before update on public.week_payments
for each row execute function public.week_payments_touch();

alter table public.week_payments enable row level security;

drop policy if exists "members can manage week payments" on public.week_payments;
create policy "members can manage week payments"
on public.week_payments for all to authenticated
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'week_payments'
  ) then
    alter publication supabase_realtime add table public.week_payments;
  end if;
end;
$$;
