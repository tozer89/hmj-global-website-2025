begin;

do $$
declare
  view_name text;
begin
  foreach view_name in array ARRAY[
    'analytics_daily_summary',
    'admin_candidate_application_overview',
    'audit_log',
    'analytics_session_summary',
    'analytics_page_summary',
    'task_items_view',
    'analytics_landing_pages',
    'analytics_page_transitions',
    'analytics_exit_pages'
  ]
  loop
    if exists (
      select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = view_name
        and c.relkind = 'v'
    ) then
      execute format('alter view public.%I set (security_invoker = true)', view_name);
    end if;
  end loop;
end
$$;

alter table if exists public.jobs enable row level security;
revoke all on public.jobs from anon, authenticated;
grant all on public.jobs to service_role;

alter table if exists public.candidate_skills enable row level security;
revoke all on public.candidate_skills from anon;
grant select, insert, delete on public.candidate_skills to authenticated;
grant all on public.candidate_skills to service_role;

do $$
begin
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'hmj_candidate_has_auth_user'
  ) then
    execute 'drop policy if exists "candidate skills self select" on public.candidate_skills';
    execute 'create policy "candidate skills self select"
      on public.candidate_skills
      for select
      to authenticated
      using (public.hmj_candidate_has_auth_user(candidate_id))';

    execute 'drop policy if exists "candidate skills self insert" on public.candidate_skills';
    execute 'create policy "candidate skills self insert"
      on public.candidate_skills
      for insert
      to authenticated
      with check (public.hmj_candidate_has_auth_user(candidate_id))';

    execute 'drop policy if exists "candidate skills self delete" on public.candidate_skills';
    execute 'create policy "candidate skills self delete"
      on public.candidate_skills
      for delete
      to authenticated
      using (public.hmj_candidate_has_auth_user(candidate_id))';
  end if;
end
$$;

commit;
