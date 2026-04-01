create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.credit_limit_checker_leads (
  id uuid primary key default gen_random_uuid(),
  lead_reference text not null unique,
  full_name text not null,
  company_name text not null,
  email text not null,
  phone text,
  turnover_band text not null,
  years_trading_band text not null,
  sector text not null,
  consent_confirmed boolean not null default false,
  status text not null default 'new'
    check (status in ('new', 'contacted', 'qualified', 'closed')),
  source_page text,
  source_context text,
  indicative_low numeric(12,2) not null default 0,
  indicative_mid numeric(12,2) not null default 0,
  indicative_high numeric(12,2) not null default 0,
  indicative_range_label text not null,
  result_payload jsonb not null default '{}'::jsonb,
  calculator_snapshot jsonb not null default '{}'::jsonb,
  storage_status text not null default 'stored',
  assigned_to text,
  admin_notes text not null default '',
  follow_up_date date,
  contacted_at timestamptz,
  qualified_at timestamptz,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_credit_limit_checker_leads_created
  on public.credit_limit_checker_leads (created_at desc);

create index if not exists idx_credit_limit_checker_leads_status
  on public.credit_limit_checker_leads (status, created_at desc);

create index if not exists idx_credit_limit_checker_leads_company
  on public.credit_limit_checker_leads (lower(company_name));

create index if not exists idx_credit_limit_checker_leads_email
  on public.credit_limit_checker_leads (lower(email));

alter table public.credit_limit_checker_leads enable row level security;

drop trigger if exists credit_limit_checker_leads_set_updated_at on public.credit_limit_checker_leads;
create trigger credit_limit_checker_leads_set_updated_at
before update on public.credit_limit_checker_leads
for each row execute function public.set_updated_at();
