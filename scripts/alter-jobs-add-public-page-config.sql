alter table if exists public.jobs
  add column if not exists public_page_config jsonb;
