-- Finance workspace schema for HMJ admin.
-- Adds finance forecasting, QuickBooks cache, and module settings tables.

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

create table if not exists public.finance_module_settings (
  id uuid primary key default gen_random_uuid(),
  module_key text not null,
  settings jsonb not null default '{}'::jsonb,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists finance_module_settings_module_key_uidx
  on public.finance_module_settings(module_key);

create table if not exists public.finance_cashflow_assumptions (
  id uuid primary key default gen_random_uuid(),
  scenario_key text not null default 'base',
  scenario_label text not null default 'Base',
  anchor_week_start date not null default current_date,
  opening_balance numeric(14,2) not null default 0,
  reporting_currency text not null default 'GBP',
  eur_to_gbp_rate numeric(12,6) not null default 0.86,
  include_qbo_open_invoices boolean not null default true,
  include_qbo_open_bills boolean not null default true,
  include_qbo_purchases_actuals boolean not null default true,
  notes text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists finance_cashflow_assumptions_scenario_key_uidx
  on public.finance_cashflow_assumptions(scenario_key);

create table if not exists public.finance_customers (
  id uuid primary key default gen_random_uuid(),
  scenario_key text not null default 'base',
  customer_name text not null,
  external_customer_id text,
  default_currency text not null default 'GBP',
  vat_treatment text not null default 'uk_standard',
  vat_rate numeric(8,2) not null default 20,
  expected_payment_days integer not null default 30,
  funding_enabled boolean not null default false,
  margin_percent numeric(8,2),
  is_active boolean not null default true,
  notes text,
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists finance_customers_scenario_name_uidx
  on public.finance_customers(scenario_key, lower(customer_name));

create table if not exists public.finance_funding_rules (
  id uuid primary key default gen_random_uuid(),
  scenario_key text not null default 'base',
  customer_name text not null,
  advance_percent numeric(8,2) not null default 90,
  retention_percent numeric(8,2) not null default 10,
  fee_percent numeric(8,2) not null default 1.5,
  interest_percent numeric(8,2) not null default 0,
  settlement_lag_days integer not null default 14,
  funded_on_issue boolean not null default true,
  is_active boolean not null default true,
  notes text,
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists finance_funding_rules_scenario_name_uidx
  on public.finance_funding_rules(scenario_key, lower(customer_name));

create table if not exists public.finance_cashflow_invoice_plans (
  id uuid primary key default gen_random_uuid(),
  scenario_key text not null default 'base',
  customer_name text not null,
  description text,
  source_system text not null default 'hmj_admin',
  source_reference text,
  invoice_date date not null,
  expected_payment_date date,
  currency text not null default 'GBP',
  net_amount numeric(14,2) not null default 0,
  vat_amount numeric(14,2) not null default 0,
  gross_amount numeric(14,2) not null default 0,
  vat_treatment text not null default 'uk_standard',
  vat_rate numeric(8,2) not null default 20,
  funded boolean not null default false,
  status text not null default 'forecast',
  notes text,
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists finance_cashflow_invoice_plans_scenario_idx
  on public.finance_cashflow_invoice_plans(scenario_key, invoice_date);

create table if not exists public.finance_cashflow_overheads (
  id uuid primary key default gen_random_uuid(),
  scenario_key text not null default 'base',
  label text not null,
  category text not null default 'overheads',
  amount numeric(14,2) not null default 0,
  currency text not null default 'GBP',
  first_due_date date not null,
  frequency text not null default 'monthly',
  interval_count integer not null default 1,
  is_active boolean not null default true,
  source_system text not null default 'hmj_admin',
  notes text,
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists finance_cashflow_overheads_scenario_idx
  on public.finance_cashflow_overheads(scenario_key, first_due_date);

create table if not exists public.finance_cashflow_adjustments (
  id uuid primary key default gen_random_uuid(),
  scenario_key text not null default 'base',
  label text not null,
  direction text not null default 'outflow',
  category text not null default 'adjustments',
  amount numeric(14,2) not null default 0,
  currency text not null default 'GBP',
  effective_date date not null,
  is_actual boolean not null default false,
  notes text,
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists finance_cashflow_adjustments_scenario_idx
  on public.finance_cashflow_adjustments(scenario_key, effective_date);

create table if not exists public.finance_cashflow_weeks (
  id uuid primary key default gen_random_uuid(),
  scenario_key text not null default 'base',
  week_start date not null,
  is_locked_actual boolean not null default false,
  opening_balance_override numeric(14,2),
  closing_balance_override numeric(14,2),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists finance_cashflow_weeks_scenario_week_uidx
  on public.finance_cashflow_weeks(scenario_key, week_start);

create table if not exists public.finance_qbo_connections (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'quickbooks',
  environment text not null default 'production',
  realm_id text not null,
  company_name text,
  encrypted_access_token text,
  encrypted_refresh_token text,
  access_token_expires_at timestamptz,
  scope text[] not null default '{}',
  connected_by text,
  connected_email text,
  connected_at timestamptz not null default now(),
  is_active boolean not null default true,
  last_sync_at timestamptz,
  last_error text,
  status text not null default 'connected',
  raw_company jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists finance_qbo_connections_provider_realm_uidx
  on public.finance_qbo_connections(provider, realm_id);

create table if not exists public.finance_qbo_sync_runs (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid references public.finance_qbo_connections(id) on delete set null,
  sync_type text not null default 'manual',
  status text not null default 'running',
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  entity_counts jsonb not null default '{}'::jsonb,
  error_message text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists finance_qbo_sync_runs_started_idx
  on public.finance_qbo_sync_runs(started_at desc);

create table if not exists public.finance_qbo_customers_cache (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid references public.finance_qbo_connections(id) on delete cascade,
  qbo_customer_id text not null,
  display_name text,
  primary_email text,
  currency text,
  balance numeric(14,2),
  is_active boolean not null default true,
  raw jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists finance_qbo_customers_cache_qbo_uidx
  on public.finance_qbo_customers_cache(qbo_customer_id);

create table if not exists public.finance_qbo_invoices_cache (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid references public.finance_qbo_connections(id) on delete cascade,
  qbo_invoice_id text not null,
  customer_id text,
  customer_name text,
  doc_number text,
  txn_date date,
  due_date date,
  total_amount numeric(14,2),
  balance_amount numeric(14,2),
  currency text,
  exchange_rate numeric(12,6),
  status text,
  raw jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists finance_qbo_invoices_cache_qbo_uidx
  on public.finance_qbo_invoices_cache(qbo_invoice_id);

create index if not exists finance_qbo_invoices_cache_due_idx
  on public.finance_qbo_invoices_cache(due_date);

create table if not exists public.finance_qbo_payments_cache (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid references public.finance_qbo_connections(id) on delete cascade,
  qbo_payment_id text not null,
  customer_id text,
  customer_name text,
  txn_date date,
  total_amount numeric(14,2),
  unapplied_amount numeric(14,2),
  currency text,
  payment_ref text,
  raw jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists finance_qbo_payments_cache_qbo_uidx
  on public.finance_qbo_payments_cache(qbo_payment_id);

create table if not exists public.finance_qbo_bills_cache (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid references public.finance_qbo_connections(id) on delete cascade,
  qbo_bill_id text not null,
  vendor_name text,
  txn_date date,
  due_date date,
  total_amount numeric(14,2),
  balance_amount numeric(14,2),
  currency text,
  raw jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists finance_qbo_bills_cache_qbo_uidx
  on public.finance_qbo_bills_cache(qbo_bill_id);

create table if not exists public.finance_qbo_purchases_cache (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid references public.finance_qbo_connections(id) on delete cascade,
  qbo_purchase_id text not null,
  payee_name text,
  txn_date date,
  total_amount numeric(14,2),
  currency text,
  payment_type text,
  raw jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists finance_qbo_purchases_cache_qbo_uidx
  on public.finance_qbo_purchases_cache(qbo_purchase_id);

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'finance_module_settings',
    'finance_cashflow_assumptions',
    'finance_customers',
    'finance_funding_rules',
    'finance_cashflow_invoice_plans',
    'finance_cashflow_overheads',
    'finance_cashflow_adjustments',
    'finance_cashflow_weeks',
    'finance_qbo_connections',
    'finance_qbo_sync_runs',
    'finance_qbo_customers_cache',
    'finance_qbo_invoices_cache',
    'finance_qbo_payments_cache',
    'finance_qbo_bills_cache',
    'finance_qbo_purchases_cache'
  ]
  loop
    execute format('alter table public.%I enable row level security;', table_name);
    execute format('revoke all on public.%I from anon, authenticated;', table_name);
    execute format('grant all on public.%I to service_role;', table_name);
  end loop;
end
$$;

drop trigger if exists finance_module_settings_touch_updated_at on public.finance_module_settings;
create trigger finance_module_settings_touch_updated_at
before update on public.finance_module_settings
for each row execute function public.set_updated_at();

drop trigger if exists finance_cashflow_assumptions_touch_updated_at on public.finance_cashflow_assumptions;
create trigger finance_cashflow_assumptions_touch_updated_at
before update on public.finance_cashflow_assumptions
for each row execute function public.set_updated_at();

drop trigger if exists finance_customers_touch_updated_at on public.finance_customers;
create trigger finance_customers_touch_updated_at
before update on public.finance_customers
for each row execute function public.set_updated_at();

drop trigger if exists finance_funding_rules_touch_updated_at on public.finance_funding_rules;
create trigger finance_funding_rules_touch_updated_at
before update on public.finance_funding_rules
for each row execute function public.set_updated_at();

drop trigger if exists finance_cashflow_invoice_plans_touch_updated_at on public.finance_cashflow_invoice_plans;
create trigger finance_cashflow_invoice_plans_touch_updated_at
before update on public.finance_cashflow_invoice_plans
for each row execute function public.set_updated_at();

drop trigger if exists finance_cashflow_overheads_touch_updated_at on public.finance_cashflow_overheads;
create trigger finance_cashflow_overheads_touch_updated_at
before update on public.finance_cashflow_overheads
for each row execute function public.set_updated_at();

drop trigger if exists finance_cashflow_adjustments_touch_updated_at on public.finance_cashflow_adjustments;
create trigger finance_cashflow_adjustments_touch_updated_at
before update on public.finance_cashflow_adjustments
for each row execute function public.set_updated_at();

drop trigger if exists finance_cashflow_weeks_touch_updated_at on public.finance_cashflow_weeks;
create trigger finance_cashflow_weeks_touch_updated_at
before update on public.finance_cashflow_weeks
for each row execute function public.set_updated_at();

drop trigger if exists finance_qbo_connections_touch_updated_at on public.finance_qbo_connections;
create trigger finance_qbo_connections_touch_updated_at
before update on public.finance_qbo_connections
for each row execute function public.set_updated_at();

drop trigger if exists finance_qbo_sync_runs_touch_updated_at on public.finance_qbo_sync_runs;
create trigger finance_qbo_sync_runs_touch_updated_at
before update on public.finance_qbo_sync_runs
for each row execute function public.set_updated_at();

drop trigger if exists finance_qbo_customers_cache_touch_updated_at on public.finance_qbo_customers_cache;
create trigger finance_qbo_customers_cache_touch_updated_at
before update on public.finance_qbo_customers_cache
for each row execute function public.set_updated_at();

drop trigger if exists finance_qbo_invoices_cache_touch_updated_at on public.finance_qbo_invoices_cache;
create trigger finance_qbo_invoices_cache_touch_updated_at
before update on public.finance_qbo_invoices_cache
for each row execute function public.set_updated_at();

drop trigger if exists finance_qbo_payments_cache_touch_updated_at on public.finance_qbo_payments_cache;
create trigger finance_qbo_payments_cache_touch_updated_at
before update on public.finance_qbo_payments_cache
for each row execute function public.set_updated_at();

drop trigger if exists finance_qbo_bills_cache_touch_updated_at on public.finance_qbo_bills_cache;
create trigger finance_qbo_bills_cache_touch_updated_at
before update on public.finance_qbo_bills_cache
for each row execute function public.set_updated_at();

drop trigger if exists finance_qbo_purchases_cache_touch_updated_at on public.finance_qbo_purchases_cache;
create trigger finance_qbo_purchases_cache_touch_updated_at
before update on public.finance_qbo_purchases_cache
for each row execute function public.set_updated_at();

notify pgrst, 'reload schema';
