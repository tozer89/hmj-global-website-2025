begin;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'cv-formatting-files',
  'cv-formatting-files',
  false,
  10485760,
  array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.cv_formatting_runs (
  id uuid primary key default gen_random_uuid(),
  created_by text,
  actor_email text,
  status text not null default 'processing'
    check (status in ('processing', 'completed', 'failed')),
  source text not null default 'pending',
  model text,
  candidate_reference text,
  target_role text,
  candidate_file_name text,
  job_spec_file_name text,
  output_file_name text,
  options_json jsonb not null default '{}'::jsonb,
  profile_json jsonb not null default '{}'::jsonb,
  analysis_json jsonb not null default '{}'::jsonb,
  ai_attempts_json jsonb not null default '[]'::jsonb,
  warning_count integer not null default 0,
  error_message text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.cv_formatting_files (
  id uuid primary key default gen_random_uuid(),
  formatting_run_id uuid not null references public.cv_formatting_runs(id) on delete cascade,
  kind text not null
    check (kind in ('candidate_cv', 'job_spec', 'formatted_output')),
  original_filename text not null,
  mime_type text,
  file_size_bytes bigint,
  storage_bucket text not null,
  storage_path text not null unique,
  created_at timestamptz not null default now()
);

create index if not exists idx_cv_formatting_runs_created
  on public.cv_formatting_runs (created_at desc);

create index if not exists idx_cv_formatting_runs_status
  on public.cv_formatting_runs (status, created_at desc);

create index if not exists idx_cv_formatting_runs_actor_email
  on public.cv_formatting_runs (lower(actor_email));

create index if not exists idx_cv_formatting_runs_candidate_reference
  on public.cv_formatting_runs (candidate_reference);

create index if not exists idx_cv_formatting_files_run
  on public.cv_formatting_files (formatting_run_id, created_at asc);

alter table public.cv_formatting_runs enable row level security;
alter table public.cv_formatting_files enable row level security;

drop trigger if exists cv_formatting_runs_set_updated_at on public.cv_formatting_runs;
create trigger cv_formatting_runs_set_updated_at
before update on public.cv_formatting_runs
for each row execute function public.set_updated_at();

grant select, insert, update on public.cv_formatting_runs to authenticated;
grant select, insert, delete on public.cv_formatting_files to authenticated;
grant all on public.cv_formatting_runs to service_role;
grant all on public.cv_formatting_files to service_role;

drop policy if exists "cv_formatting_runs_select_admins" on public.cv_formatting_runs;
drop policy if exists "cv_formatting_runs_insert_admins" on public.cv_formatting_runs;
drop policy if exists "cv_formatting_runs_update_admins" on public.cv_formatting_runs;
drop policy if exists "cv_formatting_files_select_admins" on public.cv_formatting_files;
drop policy if exists "cv_formatting_files_insert_admins" on public.cv_formatting_files;
drop policy if exists "cv_formatting_files_delete_admins" on public.cv_formatting_files;

do $$
begin
  if to_regprocedure('public.hmj_task_is_admin()') is not null then
    execute 'create policy "cv_formatting_runs_select_admins" on public.cv_formatting_runs for select to authenticated using (public.hmj_task_is_admin())';
    execute 'create policy "cv_formatting_runs_insert_admins" on public.cv_formatting_runs for insert to authenticated with check (public.hmj_task_is_admin())';
    execute 'create policy "cv_formatting_runs_update_admins" on public.cv_formatting_runs for update to authenticated using (public.hmj_task_is_admin()) with check (public.hmj_task_is_admin())';

    execute 'create policy "cv_formatting_files_select_admins" on public.cv_formatting_files for select to authenticated using (public.hmj_task_is_admin())';
    execute 'create policy "cv_formatting_files_insert_admins" on public.cv_formatting_files for insert to authenticated with check (public.hmj_task_is_admin())';
    execute 'create policy "cv_formatting_files_delete_admins" on public.cv_formatting_files for delete to authenticated using (public.hmj_task_is_admin())';
  end if;
end
$$;

do $$
begin
  if to_regclass('storage.objects') is not null and to_regprocedure('public.hmj_task_is_admin()') is not null then
    execute 'drop policy if exists "CV formatting files admin select" on storage.objects';
    execute 'drop policy if exists "CV formatting files admin insert" on storage.objects';
    execute 'drop policy if exists "CV formatting files admin delete" on storage.objects';

    execute 'create policy "CV formatting files admin select" on storage.objects for select to authenticated using (bucket_id = ''cv-formatting-files'' and public.hmj_task_is_admin())';
    execute 'create policy "CV formatting files admin insert" on storage.objects for insert to authenticated with check (bucket_id = ''cv-formatting-files'' and public.hmj_task_is_admin())';
    execute 'create policy "CV formatting files admin delete" on storage.objects for delete to authenticated using (bucket_id = ''cv-formatting-files'' and public.hmj_task_is_admin())';
  end if;
end
$$;

commit;
