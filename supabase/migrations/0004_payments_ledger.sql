-- Tempo: payments as their own records, applied to the oldest unpaid week first.
-- Paste into Supabase → SQL Editor → Run. Safe to re-run; it keeps existing data.
--
-- Each row is one payment (amount, date, method, note) to one person. The app works
-- out which weeks it covers. Amounts already entered per week are copied in once.

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  person_id uuid not null references auth.users(id) on delete cascade,
  amount_cents integer not null check (amount_cents > 0),
  paid_on date not null default current_date,
  method text not null default 'other' check (method in ('venmo', 'cash', 'check', 'bank', 'other')),
  note text,
  deleted_at timestamptz,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists payments_workspace_idx on public.payments (workspace_id, person_id, paid_on);

drop trigger if exists payments_touch_trigger on public.payments;
create trigger payments_touch_trigger
before update on public.payments
for each row execute function public.touch_updated_at();

alter table public.payments enable row level security;

drop policy if exists "members can manage payments" on public.payments;
create policy "members can manage payments"
on public.payments for all to authenticated
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'payments'
  ) then
    alter publication supabase_realtime add table public.payments;
  end if;
end;
$$;

-- One-time copy of the old per-week amounts. Each becomes a payment dated the Sunday
-- that ended its week. Re-running skips rows already copied (matched by the note).
insert into public.payments (workspace_id, person_id, amount_cents, paid_on, method, note, created_by, created_at)
select wp.workspace_id,
       wp.person_id,
       wp.amount_cents_paid,
       wp.week_start + 6,
       'other',
       'Recorded for week of ' || to_char(wp.week_start, 'Mon FMDD, YYYY'),
       coalesce(wp.updated_by, wp.person_id),
       wp.updated_at
from (
  select workspace_id, person_id, week_start, amount_paid_cents as amount_cents_paid, updated_by, updated_at
  from public.week_payments
  where amount_paid_cents > 0
) wp
where not exists (
  select 1 from public.payments p
  where p.workspace_id = wp.workspace_id
    and p.person_id = wp.person_id
    and p.note = 'Recorded for week of ' || to_char(wp.week_start, 'Mon FMDD, YYYY')
);
