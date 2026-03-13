create extension if not exists pgcrypto;

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

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
select
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
where not exists (
  select 1 from storage.buckets where id = 'noticeboard-images'
);

insert into public.admin_settings (key, value)
select 'noticeboard_enabled', 'true'::jsonb
where exists (
  select 1
  from information_schema.tables
  where table_schema = 'public'
    and table_name = 'admin_settings'
)
and not exists (
  select 1
  from public.admin_settings
  where key = 'noticeboard_enabled'
);
