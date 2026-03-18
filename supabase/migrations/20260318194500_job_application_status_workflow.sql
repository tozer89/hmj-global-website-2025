begin;

alter table if exists public.job_applications
  alter column status set default 'submitted';

update public.job_applications
set status = case
  when lower(btrim(coalesce(status, ''))) in ('submitted', 'applied') then 'submitted'
  when lower(btrim(coalesce(status, ''))) in ('interview', 'interviewing') then 'interview'
  when lower(btrim(coalesce(status, ''))) in ('reject', 'rejected', 'declined', 'decline') then 'reject'
  when btrim(coalesce(status, '')) = '' then 'submitted'
  when status is null then 'submitted'
  else 'in_progress'
end
where status is distinct from case
  when lower(btrim(coalesce(status, ''))) in ('submitted', 'applied') then 'submitted'
  when lower(btrim(coalesce(status, ''))) in ('interview', 'interviewing') then 'interview'
  when lower(btrim(coalesce(status, ''))) in ('reject', 'rejected', 'declined', 'decline') then 'reject'
  when btrim(coalesce(status, '')) = '' then 'submitted'
  when status is null then 'submitted'
  else 'in_progress'
end;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conrelid = 'public.job_applications'::regclass
      and conname = 'job_applications_status_check'
  ) then
    alter table public.job_applications
      drop constraint job_applications_status_check;
  end if;

  alter table public.job_applications
    add constraint job_applications_status_check
    check (status in ('submitted', 'in_progress', 'interview', 'reject'));
end
$$;

commit;
