begin;

alter table if exists public.candidate_documents
  drop constraint if exists candidate_documents_document_type_check;

alter table if exists public.candidate_documents
  add constraint candidate_documents_document_type_check
  check (
    document_type in (
      'cv',
      'cover_letter',
      'certificate',
      'qualification_certificate',
      'passport',
      'right_to_work',
      'visa_permit',
      'bank_document',
      'other'
    )
  );

create table if not exists public.candidate_payment_details (
  id uuid primary key default gen_random_uuid(),
  candidate_id text not null,
  auth_user_id uuid null,
  account_currency text not null default 'GBP',
  payment_method text not null default 'gbp_local',
  account_holder_name text not null,
  bank_name text not null,
  bank_location_or_country text not null,
  account_type text null,
  encrypted_sort_code text null,
  encrypted_account_number text null,
  encrypted_iban text null,
  encrypted_swift_bic text null,
  sort_code_masked text null,
  account_number_masked text null,
  iban_masked text null,
  swift_bic_masked text null,
  last_four text null,
  verified_at timestamptz null,
  is_complete boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table if exists public.candidate_payment_details
  add column if not exists auth_user_id uuid null,
  add column if not exists account_currency text not null default 'GBP',
  add column if not exists payment_method text not null default 'gbp_local',
  add column if not exists account_holder_name text null,
  add column if not exists bank_name text null,
  add column if not exists bank_location_or_country text null,
  add column if not exists account_type text null,
  add column if not exists encrypted_sort_code text null,
  add column if not exists encrypted_account_number text null,
  add column if not exists encrypted_iban text null,
  add column if not exists encrypted_swift_bic text null,
  add column if not exists sort_code_masked text null,
  add column if not exists account_number_masked text null,
  add column if not exists iban_masked text null,
  add column if not exists swift_bic_masked text null,
  add column if not exists last_four text null,
  add column if not exists verified_at timestamptz null,
  add column if not exists is_complete boolean not null default false,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'candidate_payment_details'
      and column_name = 'candidate_id'
      and is_nullable = 'YES'
  ) then
    update public.candidate_payment_details
    set candidate_id = coalesce(candidate_id, '')
    where candidate_id is null;

    alter table public.candidate_payment_details
      alter column candidate_id set not null;
  end if;
end $$;

update public.candidate_payment_details payment
set auth_user_id = candidates.auth_user_id
from public.candidates candidates
where payment.candidate_id = candidates.id
  and payment.auth_user_id is null
  and candidates.auth_user_id is not null;

alter table if exists public.candidate_payment_details
  drop constraint if exists candidate_payment_details_payment_method_check;

alter table if exists public.candidate_payment_details
  add constraint candidate_payment_details_payment_method_check
  check (payment_method in ('gbp_local', 'iban_swift'));

create unique index if not exists candidate_payment_details_candidate_uidx
  on public.candidate_payment_details(candidate_id);

create index if not exists candidate_payment_details_auth_user_idx
  on public.candidate_payment_details(auth_user_id);

create or replace function public.candidate_payment_details_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists candidate_payment_details_touch_updated_at on public.candidate_payment_details;

create trigger candidate_payment_details_touch_updated_at
before update on public.candidate_payment_details
for each row
execute function public.candidate_payment_details_touch_updated_at();

alter table public.candidate_payment_details enable row level security;

revoke all on public.candidate_payment_details from anon;
revoke all on public.candidate_payment_details from authenticated;
grant select, insert, update on public.candidate_payment_details to authenticated;

drop policy if exists candidate_payment_details_select_own on public.candidate_payment_details;
create policy candidate_payment_details_select_own
  on public.candidate_payment_details
  for select
  using (
    auth.uid() is not null
    and auth.uid() = auth_user_id
  );

drop policy if exists candidate_payment_details_insert_own on public.candidate_payment_details;
create policy candidate_payment_details_insert_own
  on public.candidate_payment_details
  for insert
  with check (
    auth.uid() is not null
    and auth.uid() = auth_user_id
  );

drop policy if exists candidate_payment_details_update_own on public.candidate_payment_details;
create policy candidate_payment_details_update_own
  on public.candidate_payment_details
  for update
  using (
    auth.uid() is not null
    and auth.uid() = auth_user_id
  )
  with check (
    auth.uid() is not null
    and auth.uid() = auth_user_id
  );

commit;
