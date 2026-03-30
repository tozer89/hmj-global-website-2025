-- Shared server-side rate limiting for public Netlify Functions.
-- Apply this alongside the main reconciliation SQL to enable Supabase-backed,
-- cross-instance throttling. The runtime falls back to local memory until this
-- schema is present, so this script is safe to deploy ahead of the migration.

create table if not exists public.function_rate_limits (
  id uuid primary key default gen_random_uuid(),
  bucket text not null,
  subject_hash text not null,
  window_start timestamptz not null,
  request_count integer not null default 0,
  limit_value integer not null,
  window_seconds integer not null,
  metadata jsonb not null default '{}'::jsonb,
  expires_at timestamptz not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists function_rate_limits_bucket_subject_window_uidx
  on public.function_rate_limits (bucket, subject_hash, window_start);

create index if not exists function_rate_limits_expires_idx
  on public.function_rate_limits (expires_at);

comment on table public.function_rate_limits is
  'Server-side request buckets used by Netlify Functions for cross-instance rate limiting.';

create or replace function public.consume_function_rate_limit(
  p_bucket text,
  p_subject_hash text,
  p_window_seconds integer,
  p_limit integer,
  p_metadata jsonb default '{}'::jsonb
)
returns table (
  allowed boolean,
  request_count integer,
  remaining integer,
  retry_after_seconds integer,
  window_start timestamptz,
  reset_at timestamptz,
  storage text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := timezone('utc', now());
  v_bucket text := left(trim(coalesce(p_bucket, '')), 120);
  v_subject_hash text := left(trim(coalesce(p_subject_hash, '')), 120);
  v_window_seconds integer := greatest(coalesce(p_window_seconds, 60), 1);
  v_limit integer := greatest(coalesce(p_limit, 1), 1);
  v_window_start timestamptz;
  v_reset_at timestamptz;
  v_count integer;
begin
  if v_bucket = '' then
    raise exception 'bucket_required';
  end if;

  if v_subject_hash = '' then
    raise exception 'subject_hash_required';
  end if;

  v_window_start := to_timestamp(
    floor(extract(epoch from v_now) / v_window_seconds) * v_window_seconds
  ) at time zone 'utc';
  v_reset_at := v_window_start + make_interval(secs => v_window_seconds);

  insert into public.function_rate_limits (
    bucket,
    subject_hash,
    window_start,
    request_count,
    limit_value,
    window_seconds,
    metadata,
    expires_at
  )
  values (
    v_bucket,
    v_subject_hash,
    v_window_start,
    1,
    v_limit,
    v_window_seconds,
    coalesce(p_metadata, '{}'::jsonb),
    v_reset_at + interval '1 hour'
  )
  on conflict (bucket, subject_hash, window_start)
  do update set
    request_count = public.function_rate_limits.request_count + 1,
    limit_value = greatest(excluded.limit_value, public.function_rate_limits.limit_value),
    window_seconds = greatest(excluded.window_seconds, public.function_rate_limits.window_seconds),
    metadata = case
      when coalesce(excluded.metadata, '{}'::jsonb) = '{}'::jsonb then public.function_rate_limits.metadata
      else excluded.metadata
    end,
    expires_at = greatest(public.function_rate_limits.expires_at, excluded.expires_at),
    updated_at = timezone('utc', now())
  returning public.function_rate_limits.request_count into v_count;

  delete from public.function_rate_limits
  where expires_at < v_now;

  allowed := v_count <= v_limit;
  request_count := v_count;
  remaining := greatest(v_limit - v_count, 0);
  retry_after_seconds := case
    when v_count > v_limit then greatest(ceil(extract(epoch from v_reset_at - v_now))::integer, 1)
    else 0
  end;
  window_start := v_window_start;
  reset_at := v_reset_at;
  storage := 'supabase';

  return next;
end;
$$;

alter table public.function_rate_limits enable row level security;

revoke all on public.function_rate_limits from anon, authenticated;
grant execute on function public.consume_function_rate_limit(text, text, integer, integer, jsonb) to service_role;
