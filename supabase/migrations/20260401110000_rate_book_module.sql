create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.rate_book_roles (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  discipline text not null,
  sector text[] not null default '{}'::text[],
  seniority text not null,
  is_active boolean not null default true,
  is_public boolean not null default true,
  display_order integer not null default 100,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by_email text,
  updated_by_email text
);

create table if not exists public.rate_book_markets (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  currency text not null,
  is_active boolean not null default true,
  display_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.rate_book_rates (
  id uuid primary key default gen_random_uuid(),
  role_id uuid not null references public.rate_book_roles(id) on delete cascade,
  market_id uuid not null references public.rate_book_markets(id) on delete cascade,
  pay_rate numeric(10,2),
  charge_rate numeric(10,2),
  rate_unit text not null default 'hour',
  is_featured boolean not null default false,
  is_charge_overridden boolean not null default false,
  effective_from date not null default current_date,
  effective_to date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by_email text,
  updated_by_email text,
  constraint rate_book_rates_role_market_effective_unique unique (role_id, market_id, effective_from),
  constraint rate_book_rates_effective_window check (effective_to is null or effective_to >= effective_from)
);

create table if not exists public.rate_book_settings (
  id uuid primary key default gen_random_uuid(),
  margin_low_threshold numeric(10,2) not null default 34.00,
  margin_low_add numeric(10,2) not null default 3.50,
  margin_high_threshold numeric(10,2) not null default 35.00,
  margin_high_add numeric(10,2) not null default 5.00,
  other_currency_message text not null default 'Other currencies by discussion',
  public_disclaimer text not null default 'These figures are indicative commercial guide rates and may vary based on market conditions, shift pattern, overtime structure, local compliance, travel, lodge, accommodation and project complexity.',
  cta_label text not null default 'Request tailored rates',
  cta_url text not null default '/clients.html#clientFormTitle',
  updated_at timestamptz not null default now(),
  updated_by_email text
);

create table if not exists public.rate_book_audit_log (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id uuid,
  action text not null,
  before_json jsonb,
  after_json jsonb,
  changed_by text,
  changed_at timestamptz not null default now()
);

create index if not exists idx_rate_book_roles_public_filters
  on public.rate_book_roles (is_active, is_public, discipline, seniority, display_order);

create index if not exists idx_rate_book_roles_sector
  on public.rate_book_roles using gin (sector);

create index if not exists idx_rate_book_markets_active_order
  on public.rate_book_markets (is_active, display_order);

create index if not exists idx_rate_book_rates_role_market_dates
  on public.rate_book_rates (role_id, market_id, effective_from desc, effective_to);

create index if not exists idx_rate_book_rates_market_current
  on public.rate_book_rates (market_id, charge_rate, pay_rate)
  where effective_to is null;

create index if not exists idx_rate_book_audit_log_entity
  on public.rate_book_audit_log (entity_type, entity_id, changed_at desc);

alter table public.rate_book_roles enable row level security;
alter table public.rate_book_markets enable row level security;
alter table public.rate_book_rates enable row level security;
alter table public.rate_book_settings enable row level security;
alter table public.rate_book_audit_log enable row level security;

drop trigger if exists rate_book_roles_set_updated_at on public.rate_book_roles;
create trigger rate_book_roles_set_updated_at
before update on public.rate_book_roles
for each row execute function public.set_updated_at();

drop trigger if exists rate_book_markets_set_updated_at on public.rate_book_markets;
create trigger rate_book_markets_set_updated_at
before update on public.rate_book_markets
for each row execute function public.set_updated_at();

drop trigger if exists rate_book_rates_set_updated_at on public.rate_book_rates;
create trigger rate_book_rates_set_updated_at
before update on public.rate_book_rates
for each row execute function public.set_updated_at();

drop trigger if exists rate_book_settings_set_updated_at on public.rate_book_settings;
create trigger rate_book_settings_set_updated_at
before update on public.rate_book_settings
for each row execute function public.set_updated_at();

insert into public.rate_book_markets (
  code,
  name,
  currency,
  is_active,
  display_order
)
values
  ('UK', 'UK', 'GBP', true, 10),
  ('IE', 'Ireland', 'EUR', true, 20),
  ('NL', 'Netherlands', 'EUR', true, 30),
  ('DE', 'Germany', 'EUR', true, 40),
  ('SE', 'Sweden', 'EUR', true, 50)
on conflict (code) do update
set
  name = excluded.name,
  currency = excluded.currency,
  is_active = excluded.is_active,
  display_order = excluded.display_order;

insert into public.rate_book_settings (
  margin_low_threshold,
  margin_low_add,
  margin_high_threshold,
  margin_high_add,
  other_currency_message,
  public_disclaimer,
  cta_label,
  cta_url,
  updated_by_email
)
select
  34.00,
  3.50,
  35.00,
  5.00,
  'Other currencies by discussion',
  'These figures are indicative commercial guide rates and may vary based on market conditions, shift pattern, overtime structure, local compliance, travel, lodge, accommodation and project complexity.',
  'Request tailored rates',
  '/clients.html#clientFormTitle',
  'seed@hmj-global.local'
where not exists (
  select 1
  from public.rate_book_settings
);

with role_seed (
  name,
  uk_pay, uk_charge,
  ie_pay, ie_charge,
  nl_pay, nl_charge,
  de_pay, de_charge,
  se_pay, se_charge
) as (
  values
    ('Electrician', 34.00, 37.50, 37.40, 42.40, 35.70, 40.70, 35.02, 40.02, 36.72, 41.72),
    ('Approved Electrician', 36.00, 41.00, 39.60, 44.60, 37.80, 42.80, 37.08, 42.08, 38.88, 43.88),
    ('Electrical Improver', 24.00, 27.50, 26.40, 29.90, 25.20, 28.70, 24.72, 28.22, 25.92, 29.42),
    ('General Operative', 18.00, 21.50, 19.80, 23.30, 18.90, 22.40, 18.54, 22.04, 19.44, 22.94),
    ('Skilled Labourer', 20.00, 23.50, 22.00, 25.50, 21.00, 24.50, 20.60, 24.10, 21.60, 25.10),
    ('Cable Puller', 22.00, 25.50, 24.20, 27.70, 23.10, 26.60, 22.66, 26.16, 23.76, 27.26),
    ('Mechanical Fitter', 28.00, 31.50, 30.80, 34.30, 29.40, 32.90, 28.84, 32.34, 30.24, 33.74),
    ('Pipefitter', 30.00, 33.50, 33.00, 36.50, 31.50, 35.00, 30.90, 34.40, 32.40, 35.90),
    ('HVAC Duct Fitter', 29.00, 32.50, 31.90, 35.40, 30.45, 33.95, 29.87, 33.37, 31.32, 34.82),
    ('Plumber / Mechanical Technician', 28.00, 31.50, 30.80, 34.30, 29.40, 32.90, 28.84, 32.34, 30.24, 33.74),
    ('BMS Technician', 35.00, 40.00, 38.50, 43.50, 36.75, 41.75, 36.05, 41.05, 37.80, 42.80),
    ('BMS Engineer', 40.00, 45.00, 44.00, 49.00, 42.00, 47.00, 41.20, 46.20, 43.20, 48.20),
    ('QA/QC Inspector', 32.00, 35.50, 35.20, 40.20, 33.60, 38.60, 32.96, 37.96, 34.56, 39.56),
    ('QA/QC Engineer', 38.00, 43.00, 41.80, 46.80, 39.90, 44.90, 39.14, 44.14, 41.04, 46.04),
    ('QA/QC Manager', 48.00, 53.00, 52.80, 57.80, 50.40, 55.40, 49.44, 54.44, 51.84, 56.84),
    ('Health & Safety Advisor', 34.00, 37.50, 37.40, 42.40, 35.70, 40.70, 35.02, 40.02, 36.72, 41.72),
    ('Health & Safety Manager', 45.00, 50.00, 49.50, 54.50, 47.25, 52.25, 46.35, 51.35, 48.60, 53.60),
    ('Commissioning Technician', 36.00, 41.00, 39.60, 44.60, 37.80, 42.80, 37.08, 42.08, 38.88, 43.88),
    ('Commissioning Engineer', 45.00, 50.00, 49.50, 54.50, 47.25, 52.25, 46.35, 51.35, 48.60, 53.60),
    ('Lead Commissioning Engineer', 52.00, 57.00, 57.20, 62.20, 54.60, 59.60, 53.56, 58.56, 56.16, 61.16),
    ('Commissioning Manager', 60.00, 65.00, 66.00, 71.00, 63.00, 68.00, 61.80, 66.80, 64.80, 69.80),
    ('CSA Engineer', 38.00, 43.00, 41.80, 46.80, 39.90, 44.90, 39.14, 44.14, 41.04, 46.04),
    ('CSA Manager', 50.00, 55.00, 55.00, 60.00, 52.50, 57.50, 51.50, 56.50, 54.00, 59.00),
    ('Site Engineer', 34.00, 37.50, 37.40, 42.40, 35.70, 40.70, 35.02, 40.02, 36.72, 41.72),
    ('Setting Out Engineer', 35.00, 40.00, 38.50, 43.50, 36.75, 41.75, 36.05, 41.05, 37.80, 42.80),
    ('Planner', 42.00, 47.00, 46.20, 51.20, 44.10, 49.10, 43.26, 48.26, 45.36, 50.36),
    ('Senior Planner', 55.00, 60.00, 60.50, 65.50, 57.75, 62.75, 56.65, 61.65, 59.40, 64.40),
    ('Document Controller', 26.00, 29.50, 28.60, 32.10, 27.30, 30.80, 26.78, 30.28, 28.08, 31.58),
    ('BIM Coordinator', 35.00, 40.00, 38.50, 43.50, 36.75, 41.75, 36.05, 41.05, 37.80, 42.80),
    ('BIM Manager', 48.00, 53.00, 52.80, 57.80, 50.40, 55.40, 49.44, 54.44, 51.84, 56.84),
    ('Quantity Surveyor', 45.00, 50.00, 49.50, 54.50, 47.25, 52.25, 46.35, 51.35, 48.60, 53.60),
    ('Senior Quantity Surveyor', 58.00, 63.00, 63.80, 68.80, 60.90, 65.90, 59.74, 64.74, 62.64, 67.64),
    ('Commercial Manager', 65.00, 70.00, 71.50, 76.50, 68.25, 73.25, 66.95, 71.95, 70.20, 75.20),
    ('Procurement Manager', 45.00, 50.00, 49.50, 54.50, 47.25, 52.25, 46.35, 51.35, 48.60, 53.60),
    ('Package Manager - Electrical', 48.00, 53.00, 52.80, 57.80, 50.40, 55.40, 49.44, 54.44, 51.84, 56.84),
    ('Package Manager - Mechanical', 48.00, 53.00, 52.80, 57.80, 50.40, 55.40, 49.44, 54.44, 51.84, 56.84),
    ('Construction Manager', 55.00, 60.00, 60.50, 65.50, 57.75, 62.75, 56.65, 61.65, 59.40, 64.40),
    ('Senior Construction Manager', 65.00, 70.00, 71.50, 76.50, 68.25, 73.25, 66.95, 71.95, 70.20, 75.20),
    ('Project Engineer - Electrical', 40.00, 45.00, 44.00, 49.00, 42.00, 47.00, 41.20, 46.20, 43.20, 48.20),
    ('Project Engineer - Mechanical', 40.00, 45.00, 44.00, 49.00, 42.00, 47.00, 41.20, 46.20, 43.20, 48.20),
    ('Project Manager', 60.00, 65.00, 66.00, 71.00, 63.00, 68.00, 61.80, 66.80, 64.80, 69.80),
    ('Senior Project Manager', 72.00, 77.00, 79.20, 84.20, 75.60, 80.60, 74.16, 79.16, 77.76, 82.76),
    ('Project Director', 85.00, 90.00, 93.50, 98.50, 89.25, 94.25, 87.55, 92.55, 91.80, 96.80),
    ('M&E Manager', 55.00, 60.00, 60.50, 65.50, 57.75, 62.75, 56.65, 61.65, 59.40, 64.40),
    ('MEP Manager', 60.00, 65.00, 66.00, 71.00, 63.00, 68.00, 61.80, 66.80, 64.80, 69.80),
    ('MEP Lead', 70.00, 75.00, 77.00, 82.00, 73.50, 78.50, 72.10, 77.10, 75.60, 80.60),
    ('Cost Estimator', 42.00, 47.00, 46.20, 51.20, 44.10, 49.10, 43.26, 48.26, 45.36, 50.36),
    ('Senior Cost Estimator', 55.00, 60.00, 60.50, 65.50, 57.75, 62.75, 56.65, 61.65, 59.40, 64.40),
    ('Design Manager', 58.00, 63.00, 63.80, 68.80, 60.90, 65.90, 59.74, 64.74, 62.64, 67.64),
    ('Operations Manager', 60.00, 65.00, 66.00, 71.00, 63.00, 68.00, 61.80, 66.80, 64.80, 69.80)
),
role_details as (
  select
    lower(regexp_replace(name, '[^a-z0-9]+', '-', 'gi')) as slug,
    name,
    case
      when name ~* '(electrician|electrical|cable puller|bms)' then 'Electrical'
      when name ~* '(mechanical fitter|pipefitter|hvac duct fitter|plumber / mechanical technician)' then 'Mechanical'
      when name ~* '(qa/qc|health\s*&\s*safety)' then 'HSE / Quality'
      when name ~* 'commissioning' then 'Commissioning'
      when name ~* '(csa|site engineer|setting out engineer)' then 'CSA / Civils'
      when name ~* '(planner|document controller)' then 'Project Controls'
      when name ~* '(bim|design manager)' then 'BIM / Design'
      when name ~* '(quantity surveyor|commercial manager|procurement manager|cost estimator)' then 'Commercial'
      when name ~* '(general operative|skilled labourer|operations manager)' then 'Operations'
      else 'Project Delivery'
    end as discipline,
    case
      when name ~* 'director' then 'Director'
      when name ~* 'manager' then 'Manager'
      when name ~* 'lead ' then 'Lead / Senior'
      when name ~* 'senior project manager|senior construction manager' then 'Manager'
      when name ~* 'senior ' then 'Lead / Senior'
      when name ~* '(technician|inspector|document controller)' then 'Technician'
      when name ~* '(engineer|planner|quantity surveyor|cost estimator|advisor)' then 'Engineer'
      else 'Trades'
    end as seniority,
    case
      when name in (
        'Mechanical Fitter',
        'Pipefitter',
        'HVAC Duct Fitter',
        'Plumber / Mechanical Technician',
        'BMS Technician',
        'BMS Engineer',
        'QA/QC Inspector',
        'QA/QC Engineer',
        'QA/QC Manager',
        'Health & Safety Advisor',
        'Health & Safety Manager',
        'Commissioning Technician',
        'Commissioning Engineer',
        'Lead Commissioning Engineer',
        'Commissioning Manager',
        'Planner',
        'Senior Planner',
        'Document Controller',
        'BIM Coordinator',
        'BIM Manager',
        'Quantity Surveyor',
        'Senior Quantity Surveyor',
        'Commercial Manager',
        'Procurement Manager',
        'Package Manager - Electrical',
        'Package Manager - Mechanical',
        'Construction Manager',
        'Senior Construction Manager',
        'Project Engineer - Electrical',
        'Project Engineer - Mechanical',
        'Project Manager',
        'Senior Project Manager',
        'Project Director',
        'M&E Manager',
        'MEP Manager',
        'MEP Lead',
        'Cost Estimator',
        'Senior Cost Estimator',
        'Design Manager',
        'Operations Manager'
      )
      then array['Data centre', 'Mission critical', 'Engineering', 'Pharma']::text[]
      else array['Data centre', 'Mission critical', 'Engineering']::text[]
    end as sector,
    case
      when name in (
        'Electrician',
        'Mechanical Fitter',
        'BMS Engineer',
        'Commissioning Engineer',
        'QA/QC Engineer',
        'Health & Safety Manager',
        'Planner',
        'Quantity Surveyor',
        'Project Manager',
        'Senior Project Manager',
        'MEP Manager',
        'Project Director'
      )
      then true
      else false
    end as featured,
    row_number() over (order by name) * 10 as display_order,
    uk_pay, uk_charge,
    ie_pay, ie_charge,
    nl_pay, nl_charge,
    de_pay, de_charge,
    se_pay, se_charge
  from role_seed
),
upsert_roles as (
  insert into public.rate_book_roles (
    slug,
    name,
    discipline,
    sector,
    seniority,
    is_active,
    is_public,
    display_order,
    notes,
    created_by_email,
    updated_by_email
  )
  select
    slug,
    name,
    discipline,
    sector,
    seniority,
    true,
    true,
    display_order,
    null,
    'seed@hmj-global.local',
    'seed@hmj-global.local'
  from role_details
  on conflict (slug) do update
  set
    name = excluded.name,
    discipline = excluded.discipline,
    sector = excluded.sector,
    seniority = excluded.seniority,
    is_active = excluded.is_active,
    is_public = excluded.is_public,
    display_order = excluded.display_order,
    notes = excluded.notes,
    updated_by_email = excluded.updated_by_email
  returning id, slug
),
role_lookup as (
  select id, slug
  from upsert_roles
  union
  select id, slug
  from public.rate_book_roles
  where slug in (select slug from role_details)
),
expanded_rates as (
  select
    rl.id as role_id,
    markets.id as market_id,
    rates.market_code,
    rates.pay_rate,
    rates.charge_rate,
    rd.featured
  from role_details rd
  join role_lookup rl
    on rl.slug = rd.slug
  join lateral (
    values
      ('UK', rd.uk_pay, rd.uk_charge),
      ('IE', rd.ie_pay, rd.ie_charge),
      ('NL', rd.nl_pay, rd.nl_charge),
      ('DE', rd.de_pay, rd.de_charge),
      ('SE', rd.se_pay, rd.se_charge)
  ) as rates(market_code, pay_rate, charge_rate)
    on true
  join public.rate_book_markets markets
    on markets.code = rates.market_code
)
insert into public.rate_book_rates (
  role_id,
  market_id,
  pay_rate,
  charge_rate,
  rate_unit,
  is_featured,
  is_charge_overridden,
  effective_from,
  created_by_email,
  updated_by_email
)
select
  role_id,
  market_id,
  pay_rate,
  charge_rate,
  'hour',
  featured,
  false,
  date '2026-04-01',
  'seed@hmj-global.local',
  'seed@hmj-global.local'
from expanded_rates
on conflict (role_id, market_id, effective_from) do update
set
  pay_rate = excluded.pay_rate,
  charge_rate = excluded.charge_rate,
  rate_unit = excluded.rate_unit,
  is_featured = excluded.is_featured,
  is_charge_overridden = excluded.is_charge_overridden,
  updated_by_email = excluded.updated_by_email;

notify pgrst, 'reload schema';
