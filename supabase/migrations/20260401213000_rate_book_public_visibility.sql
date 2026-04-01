alter table public.rate_book_settings
  add column if not exists public_enabled boolean not null default true;

update public.rate_book_settings
set public_enabled = true
where public_enabled is null;
