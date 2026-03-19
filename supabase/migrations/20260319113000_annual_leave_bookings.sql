-- Annual leave booking workspace for HMJ admin.

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.annual_leave_bookings (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  user_email text not null,
  user_name text not null,
  leave_year integer not null,
  start_date date not null,
  end_date date not null,
  duration_mode text not null default 'full_day'
    check (duration_mode = any (array['full_day', 'half_day_am', 'half_day_pm'])),
  leave_type text not null default 'annual_leave'
    check (leave_type = any (array['annual_leave', 'unpaid_leave', 'sick', 'other'])),
  source_region text not null default 'england-and-wales'
    check (source_region = any (array['england-and-wales', 'scotland', 'northern-ireland'])),
  working_days_count numeric(6,2) not null default 0,
  bank_holidays_count numeric(6,2) not null default 0,
  excluded_weekend_days_count numeric(6,2) not null default 0,
  effective_leave_days numeric(6,2) not null default 0,
  note text,
  status text not null default 'booked'
    check (status = any (array['booked', 'cancelled'])),
  reminder_7d_sent_at timestamptz,
  reminder_1wd_sent_at timestamptz,
  created_by_user_id text,
  created_by_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  cancelled_at timestamptz,
  cancelled_by_user_id text,
  cancelled_by_email text,
  constraint annual_leave_dates_chk check (end_date >= start_date)
);

create index if not exists annual_leave_bookings_year_status_idx
  on public.annual_leave_bookings (leave_year, status, start_date);

create index if not exists annual_leave_bookings_user_year_idx
  on public.annual_leave_bookings (user_id, leave_year, start_date);

create index if not exists annual_leave_bookings_email_year_idx
  on public.annual_leave_bookings ((lower(user_email)), leave_year, start_date);

create index if not exists annual_leave_bookings_date_span_idx
  on public.annual_leave_bookings (start_date, end_date);

drop trigger if exists annual_leave_bookings_set_updated_at on public.annual_leave_bookings;
create trigger annual_leave_bookings_set_updated_at
before update on public.annual_leave_bookings
for each row execute function public.set_updated_at();

alter table public.annual_leave_bookings enable row level security;

revoke all on public.annual_leave_bookings from anon, authenticated;
grant all on public.annual_leave_bookings to service_role;
