# Candidate Portal Auth Architecture - 2026-03-15

## Decision

Do not bolt public candidate accounts onto the current HMJ admin Netlify Identity flow.

## Why

- The existing live auth setup is built around HMJ admin access and Netlify role-guarded admin routes.
- Current candidate records are operational CRM-style rows, not clean self-service account records.
- The public site has candidate registration and application capture flows, but no existing candidate session model.
- The repo already uses Supabase heavily for data and private file storage, which makes Supabase Auth plus RLS the safer long-term candidate path.
- Netlify Identity is acceptable to stabilise for current admin users, but it is not the best foundation for a larger public-facing candidate portal.

## Recommended Separation

### Keep Now

- Admin users:
  - stay on Netlify Identity for the current production-safe admin access flow
  - continue to use Netlify role redirects plus Netlify function auth checks

### Build Next

- Candidate users:
  - use Supabase Auth
  - live in a separate public account area and session flow
  - never share admin route logic, role flags, or account UI with HMJ admin users

## Safe Data Model Direction

### New Auth-Owned Candidate Layer

- `candidate_profiles`
  - `id uuid primary key default gen_random_uuid()`
  - `auth_user_id uuid unique not null references auth.users(id)`
  - `candidate_id text null`
  - `first_name text`
  - `last_name text`
  - `email text not null`
  - `phone text`
  - `location text`
  - `work_rights jsonb not null default '{}'::jsonb`
  - `preferences jsonb not null default '{}'::jsonb`
  - `profile_status text not null default 'active'`
  - `created_at timestamptz not null default now()`
  - `updated_at timestamptz not null default now()`

- `candidate_account_links`
  - `candidate_id text primary key`
  - `auth_user_id uuid unique not null references auth.users(id)`
  - `linked_at timestamptz not null default now()`
  - use this if the existing `candidates` table should remain operationally stable and not be tightly coupled to auth yet

- `candidate_application_accounts`
  - not required if applications are already reliably tied to candidate rows
  - otherwise use a small mapping table between `candidate_profiles` and existing application/candidate records

### Candidate Documents

- Keep existing admin-facing `candidate_documents` for current back-office workflows.
- For self-service candidate uploads, add a candidate-owned document table later, for example:
  - `candidate_profile_documents`
  - `id uuid primary key default gen_random_uuid()`
  - `candidate_profile_id uuid not null references candidate_profiles(id)`
  - `kind text not null`
  - `filename text not null`
  - `storage_bucket text not null`
  - `storage_key text not null unique`
  - `meta jsonb not null default '{}'::jsonb`
  - `created_at timestamptz not null default now()`

- Storage:
  - private bucket only
  - candidate sees only their own files through signed URLs or controlled endpoints
  - admin views candidate files through service-role Netlify functions or Supabase Edge functions

### Applications

- If current job applications already exist in Supabase, extend them with candidate account ownership carefully.
- Recommended future shape:
  - `candidate_applications`
  - `id uuid primary key default gen_random_uuid()`
  - `candidate_profile_id uuid not null references candidate_profiles(id)`
  - `job_id text not null`
  - `status text not null default 'submitted'`
  - `submitted_at timestamptz not null default now()`
  - `updated_at timestamptz not null default now()`
  - `source text not null default 'portal'`

- `candidate_application_status_history`
  - `id uuid primary key default gen_random_uuid()`
  - `application_id uuid not null references candidate_applications(id)`
  - `status text not null`
  - `note text`
  - `changed_by text`
  - `created_at timestamptz not null default now()`

## RLS Direction

- `candidate_profiles`
  - candidate can `select` and `update` only where `auth.uid() = auth_user_id`
  - inserts happen from authenticated signup/profile-completion flow

- `candidate_profile_documents`
  - candidate can `select`, `insert`, and `delete` only their own rows
  - storage policies should tie object paths to the authenticated user or be brokered server-side

- `candidate_applications`
  - candidate can `select` only their own applications
  - candidate can create applications only for themselves
  - status updates should remain admin-controlled

- admin access
  - do not rely on public client RLS alone for admin tooling
  - continue using server-side admin functions or service-role paths for recruiter/admin workflows

## UI / Routing Direction

### Public Candidate Area

- `/login`
- `/register`
- `/forgot-password`
- `/reset-password`
- `/account`
- `/account/profile`
- `/account/applications`
- `/account/settings`

### Navigation

- public nav shows:
  - `Sign in`
  - `Register`
  - authenticated candidate name when signed in

- admin nav stays separate:
  - `/admin/`
  - no shared candidate/admin session UI

## Safe Delivery Phases

### Phase 1

- admin auth fix only
- no public candidate auth shipped
- architecture documented

### Phase 2

- add Supabase Auth candidate signup/login/reset
- add `candidate_profiles`
- add private candidate CV/document upload
- add candidate account pages

### Phase 3

- connect applications/status history
- connect existing candidate CRM records through explicit linking
- add richer account preferences and optional CV parsing helpers

## Important Guardrails

- never store passwords in HMJ tables
- keep admin and candidate auth providers logically separate
- do not treat a candidate auth session as proof of admin access
- do not expose candidate CVs from public buckets
- keep status changes admin-controlled
- prefer additive tables or explicit mapping tables over risky rewrites of the current `candidates` table
