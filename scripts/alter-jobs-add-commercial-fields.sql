alter table if exists public.jobs
  add column if not exists client_name text,
  add column if not exists customer text,
  add column if not exists benefits text[],
  add column if not exists pay_type text,
  add column if not exists day_rate_min numeric,
  add column if not exists day_rate_max numeric,
  add column if not exists salary_min numeric,
  add column if not exists salary_max numeric,
  add column if not exists hourly_min numeric,
  add column if not exists hourly_max numeric,
  add column if not exists currency text;
