alter table public.candidates
add column if not exists onboarding_mode boolean not null default false;
