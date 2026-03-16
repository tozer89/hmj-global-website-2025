alter table if exists public.candidates
  add column if not exists salary_expectation_unit text;

update public.candidates
set salary_expectation_unit = case
  when lower(nullif(trim(salary_expectation_unit), '')) in ('annual', 'per_year', 'year', 'annual_salary') then 'annual'
  when lower(nullif(trim(salary_expectation_unit), '')) in ('daily', 'per_day', 'day') then 'daily'
  when lower(nullif(trim(salary_expectation_unit), '')) in ('hourly', 'per_hour', 'hour') then 'hourly'
  when salary_expectation ilike '%per year%' then 'annual'
  when salary_expectation ilike '%per day%' then 'daily'
  when salary_expectation ilike '%per hour%' then 'hourly'
  else salary_expectation_unit
end
where salary_expectation is not null
  or salary_expectation_unit is not null;

alter table if exists public.assignments
  add column if not exists candidate_id text;

create index if not exists idx_assignments_candidate_id
  on public.assignments(candidate_id);
