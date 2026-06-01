do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'team_members'
  ) then
    update public.team_members
    set role_title = 'Finance Partner',
        updated_at = now()
    where slug = 'joe-tozer-osullivan'
      and coalesce(role_title, '') <> 'Finance Partner';
  end if;
end
$$;
