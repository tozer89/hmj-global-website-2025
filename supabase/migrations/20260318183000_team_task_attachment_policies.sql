begin;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'task-files',
  'task-files',
  false,
  15728640,
  array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/avif',
    'image/gif'
  ]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

do $$
begin
  if to_regclass('public.task_attachments') is not null then
    execute 'alter table public.task_attachments enable row level security';
  end if;
end
$$;

grant select, insert, delete on public.task_attachments to authenticated;
grant all on public.task_attachments to service_role;

drop policy if exists "task_attachments_select_admins" on public.task_attachments;
create policy "task_attachments_select_admins"
on public.task_attachments
for select
to authenticated
using (public.hmj_task_is_admin());

drop policy if exists "task_attachments_insert_admins" on public.task_attachments;
create policy "task_attachments_insert_admins"
on public.task_attachments
for insert
to authenticated
with check (public.hmj_task_is_admin());

drop policy if exists "task_attachments_delete_admins" on public.task_attachments;
create policy "task_attachments_delete_admins"
on public.task_attachments
for delete
to authenticated
using (public.hmj_task_is_admin());

do $$
begin
  if to_regclass('storage.objects') is not null then
    execute 'drop policy if exists "Task files admin select" on storage.objects';
    execute 'drop policy if exists "Task files admin insert" on storage.objects';
    execute 'drop policy if exists "Task files admin delete" on storage.objects';

    execute 'create policy "Task files admin select" on storage.objects for select to authenticated using (bucket_id = ''task-files'' and public.hmj_task_is_admin())';
    execute 'create policy "Task files admin insert" on storage.objects for insert to authenticated with check (bucket_id = ''task-files'' and public.hmj_task_is_admin())';
    execute 'create policy "Task files admin delete" on storage.objects for delete to authenticated using (bucket_id = ''task-files'' and public.hmj_task_is_admin())';
  end if;
end
$$;

commit;
