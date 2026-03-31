alter table public.candidates
  add column if not exists onboarding_status text;

alter table public.candidates
  add column if not exists onboarding_status_updated_at timestamptz;

alter table public.candidates
  add column if not exists onboarding_status_updated_by text;

alter table public.candidates
  add column if not exists right_to_work_evidence_type text;

alter table public.candidates
  add column if not exists consent_captured boolean not null default false;

alter table public.candidates
  add column if not exists consent_captured_at timestamptz;

update public.candidates
set
  onboarding_status = case
    when lower(nullif(trim(onboarding_status), '')) in (
      'new',
      'awaiting_documents',
      'awaiting_verification',
      'ready_for_payroll',
      'onboarding_complete',
      'archived'
    ) then lower(nullif(trim(onboarding_status), ''))
    when onboarding_mode = true and lower(nullif(trim(status), '')) = 'invited' then 'new'
    when lower(nullif(trim(status), '')) = 'archived' then 'archived'
    else null
  end,
  onboarding_status_updated_by = nullif(trim(onboarding_status_updated_by), ''),
  right_to_work_evidence_type = case
    when lower(nullif(trim(right_to_work_evidence_type), '')) in (
      'passport',
      'id_card',
      'visa',
      'brp',
      'share_code',
      'settlement',
      'other'
    ) then lower(nullif(trim(right_to_work_evidence_type), ''))
    when lower(nullif(trim(right_to_work_evidence_type), '')) in ('visa_permit', 'visa / permit') then 'visa'
    when lower(nullif(trim(right_to_work_evidence_type), '')) in ('right_to_work', 'right to work', 'share code / settlement / right-to-work evidence') then 'share_code'
    else nullif(lower(trim(right_to_work_evidence_type)), '')
  end,
  consent_captured = coalesce(consent_captured, false),
  consent_captured_at = case
    when consent_captured = true and consent_captured_at is null then coalesce(updated_at, created_at, now())
    else consent_captured_at
  end
where true;

alter table public.candidates
  drop constraint if exists candidates_onboarding_status_check;

alter table public.candidates
  add constraint candidates_onboarding_status_check
  check (
    onboarding_status is null
    or onboarding_status in (
      'new',
      'awaiting_documents',
      'awaiting_verification',
      'ready_for_payroll',
      'onboarding_complete',
      'archived'
    )
  );

alter table public.candidates
  drop constraint if exists candidates_right_to_work_evidence_type_check;

alter table public.candidates
  add constraint candidates_right_to_work_evidence_type_check
  check (
    right_to_work_evidence_type is null
    or right_to_work_evidence_type in (
      'passport',
      'id_card',
      'visa',
      'brp',
      'share_code',
      'settlement',
      'other'
    )
  );

create index if not exists idx_candidates_onboarding_status
  on public.candidates (onboarding_status)
  where onboarding_status is not null;

create index if not exists idx_candidates_onboarding_mode_status
  on public.candidates (onboarding_mode, onboarding_status)
  where onboarding_mode = true;

notify pgrst, 'reload schema';
