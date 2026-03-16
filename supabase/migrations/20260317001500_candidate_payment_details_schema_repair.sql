-- Candidate payment details production schema repair.
-- Creates the secure payment details table used by candidate onboarding/admin summaries
-- and refreshes the PostgREST schema cache so live Netlify functions can read it immediately.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

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
      'reference',
      'bank_document',
      'other'
    )
  );

create table if not exists public.candidate_payment_details (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  auth_user_id uuid,
  account_currency text not null default 'GBP',
  payment_method text not null default 'gbp_local',
  account_holder_name text not null default '',
  bank_name text not null default '',
  bank_location_or_country text not null default '',
  account_type text,
  encrypted_sort_code text,
  encrypted_account_number text,
  encrypted_iban text,
  encrypted_swift_bic text,
  sort_code_masked text,
  account_number_masked text,
  iban_masked text,
  swift_bic_masked text,
  last_four text,
  is_complete boolean not null default true,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table if exists public.candidate_payment_details
  add column if not exists auth_user_id uuid;
alter table if exists public.candidate_payment_details
  add column if not exists account_currency text;
alter table if exists public.candidate_payment_details
  add column if not exists payment_method text;
alter table if exists public.candidate_payment_details
  add column if not exists account_holder_name text;
alter table if exists public.candidate_payment_details
  add column if not exists bank_name text;
alter table if exists public.candidate_payment_details
  add column if not exists bank_location_or_country text;
alter table if exists public.candidate_payment_details
  add column if not exists account_type text;
alter table if exists public.candidate_payment_details
  add column if not exists encrypted_sort_code text;
alter table if exists public.candidate_payment_details
  add column if not exists encrypted_account_number text;
alter table if exists public.candidate_payment_details
  add column if not exists encrypted_iban text;
alter table if exists public.candidate_payment_details
  add column if not exists encrypted_swift_bic text;
alter table if exists public.candidate_payment_details
  add column if not exists sort_code_masked text;
alter table if exists public.candidate_payment_details
  add column if not exists account_number_masked text;
alter table if exists public.candidate_payment_details
  add column if not exists iban_masked text;
alter table if exists public.candidate_payment_details
  add column if not exists swift_bic_masked text;
alter table if exists public.candidate_payment_details
  add column if not exists last_four text;
alter table if exists public.candidate_payment_details
  add column if not exists is_complete boolean not null default true;
alter table if exists public.candidate_payment_details
  add column if not exists verified_at timestamptz;
alter table if exists public.candidate_payment_details
  add column if not exists created_at timestamptz not null default now();
alter table if exists public.candidate_payment_details
  add column if not exists updated_at timestamptz not null default now();

update public.candidate_payment_details
set
  account_currency = coalesce(nullif(trim(account_currency), ''), 'GBP'),
  payment_method = coalesce(
    nullif(trim(payment_method), ''),
    case when nullif(trim(encrypted_iban), '') is not null then 'iban_swift' else 'gbp_local' end
  ),
  account_holder_name = coalesce(nullif(trim(account_holder_name), ''), ''),
  bank_name = coalesce(nullif(trim(bank_name), ''), ''),
  bank_location_or_country = coalesce(nullif(trim(bank_location_or_country), ''), ''),
  created_at = coalesce(created_at, now()),
  updated_at = coalesce(updated_at, created_at, now()),
  is_complete = coalesce(is_complete, true)
where true;

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

drop trigger if exists candidate_payment_details_touch_updated_at on public.candidate_payment_details;

create trigger candidate_payment_details_touch_updated_at
before update on public.candidate_payment_details
for each row
execute function public.set_updated_at();

alter table if exists public.candidate_payment_details enable row level security;

revoke all on public.candidate_payment_details from anon;
revoke all on public.candidate_payment_details from authenticated;
grant select, insert, update on public.candidate_payment_details to authenticated;
grant all on public.candidate_payment_details to service_role;

drop policy if exists candidate_payment_details_select_own on public.candidate_payment_details;
create policy candidate_payment_details_select_own
  on public.candidate_payment_details
  for select
  to authenticated
  using (
    auth.uid() is not null
    and auth.uid() = auth_user_id
  );

drop policy if exists candidate_payment_details_insert_own on public.candidate_payment_details;
create policy candidate_payment_details_insert_own
  on public.candidate_payment_details
  for insert
  to authenticated
  with check (
    auth.uid() is not null
    and auth.uid() = auth_user_id
  );

drop policy if exists candidate_payment_details_update_own on public.candidate_payment_details;
create policy candidate_payment_details_update_own
  on public.candidate_payment_details
  for update
  to authenticated
  using (
    auth.uid() is not null
    and auth.uid() = auth_user_id
  )
  with check (
    auth.uid() is not null
    and auth.uid() = auth_user_id
  );

notify pgrst, 'reload schema';
