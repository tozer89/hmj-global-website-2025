create extension if not exists pgcrypto;

create or replace function public.set_row_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.admin_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'admin_settings_set_updated_at'
  ) then
    create trigger admin_settings_set_updated_at
      before update on public.admin_settings
      for each row
      execute function public.set_row_updated_at();
  end if;
end
$$;

create table if not exists public.noticeboard_posts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text,
  created_by_email text,
  updated_by_email text,
  title text not null,
  slug text not null unique,
  summary text,
  body text not null,
  image_url text,
  image_storage_key text,
  image_alt_text text,
  cta_label text,
  cta_url text,
  status text not null default 'draft'
    check (status = any (array['draft', 'scheduled', 'published', 'archived'])),
  publish_at timestamptz,
  expires_at timestamptz,
  featured boolean not null default false,
  sort_order integer not null default 100
);

create index if not exists noticeboard_posts_status_publish_idx
  on public.noticeboard_posts (status, publish_at desc);

create index if not exists noticeboard_posts_featured_sort_idx
  on public.noticeboard_posts (featured desc, sort_order asc, publish_at desc);

create index if not exists noticeboard_posts_expires_idx
  on public.noticeboard_posts (expires_at);

alter table public.noticeboard_posts enable row level security;

comment on table public.noticeboard_posts is
  'HMJ public noticeboard posts. Browser clients should not query this table directly; Netlify Functions handle public filtering and admin writes.';

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'noticeboard_posts_set_updated_at'
  ) then
    create trigger noticeboard_posts_set_updated_at
      before update on public.noticeboard_posts
      for each row
      execute function public.set_row_updated_at();
  end if;
end
$$;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'noticeboard-images',
  'noticeboard-images',
  true,
  6291456,
  array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/avif'
  ]::text[]
)
on conflict (id) do update
set
  name = excluded.name,
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

insert into public.admin_settings (key, value)
values ('noticeboard_enabled', 'true'::jsonb)
on conflict (key) do nothing;
