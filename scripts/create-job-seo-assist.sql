begin;

create extension if not exists pgcrypto;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.job_seo_suggestions (
  job_id text primary key references public.jobs(id) on delete cascade,
  optimized_title text,
  meta_title text,
  meta_description text,
  slug_hint text,
  sector_focus text,
  optimized_overview text,
  optimized_responsibilities jsonb not null default '[]'::jsonb,
  optimized_requirements jsonb not null default '[]'::jsonb,
  schema_missing_fields jsonb not null default '[]'::jsonb,
  source text not null default 'heuristic',
  model text,
  payload jsonb not null default '{}'::jsonb,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists job_seo_suggestions_source_idx
  on public.job_seo_suggestions (source);

create index if not exists job_seo_suggestions_updated_idx
  on public.job_seo_suggestions (updated_at desc);

drop trigger if exists job_seo_suggestions_touch_updated_at on public.job_seo_suggestions;
create trigger job_seo_suggestions_touch_updated_at
before update on public.job_seo_suggestions
for each row execute function public.touch_updated_at();

commit;
