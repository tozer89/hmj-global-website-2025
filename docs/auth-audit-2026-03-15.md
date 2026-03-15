# HMJ Auth Audit - 2026-03-15

## Current Admin Auth Stack

- Frontend auth provider: Netlify Identity widget loaded from `https://identity.netlify.com/v1/netlify-identity-widget.js`.
- Frontend identity bootstrap:
  - [`/Users/joetozerosullivan/Desktop/HMJ Global Ltd/Website/WORKING COPY/js/hmj-identity.js`] configures the widget API URL.
  - [`/Users/joetozerosullivan/Desktop/HMJ Global Ltd/Website/WORKING COPY/js/identity-loader.js`] resolves same-host identity URLs and preview-safe proxy usage for admin pages.
  - [`/Users/joetozerosullivan/Desktop/HMJ Global Ltd/Website/WORKING COPY/js/hmj-auth-flow.js`] parses `#invite_token`, `#recovery_token`, `#confirmation_token`, `#access_token`, `type`, and auth errors.
  - [`/Users/joetozerosullivan/Desktop/HMJ Global Ltd/Website/WORKING COPY/js/hmj-auth-handoff.js`] forwards auth callback URLs that land on the public site to `/admin/`.
- Admin gate UI:
  - [`/Users/joetozerosullivan/Desktop/HMJ Global Ltd/Website/WORKING COPY/admin/index.html`] is the only branded auth entry page today.
  - [`/Users/joetozerosullivan/Desktop/HMJ Global Ltd/Website/WORKING COPY/assets/js/admin.auth.experience.js`] changes copy for invite/recovery states and auto-opens the widget, but does not render dedicated password forms.
  - [`/Users/joetozerosullivan/Desktop/HMJ Global Ltd/Website/WORKING COPY/admin/common.js`] performs session detection, admin gate logic, sign-in/sign-out handling, and post-login redirects.
- Backend/session protection:
  - [`/Users/joetozerosullivan/Desktop/HMJ Global Ltd/Website/WORKING COPY/netlify.toml`] uses Netlify role-based redirects to protect admin HTML pages.
  - [`/Users/joetozerosullivan/Desktop/HMJ Global Ltd/Website/WORKING COPY/netlify/functions/_auth.js`] enforces admin access for functions via Netlify Identity claims and an optional `admin_users` allow-list table.
  - [`/Users/joetozerosullivan/Desktop/HMJ Global Ltd/Website/WORKING COPY/netlify/functions/admin-role-check.js`] and other admin functions require admin context.
  - [`/Users/joetozerosullivan/Desktop/HMJ Global Ltd/Website/WORKING COPY/netlify/functions/identity-proxy.js`] proxies Identity traffic to the production identity service and rewrites cookies/redirects for previews.

## What Is Actually Wired Up

- Netlify Identity widget is included on public pages, `timesheets.html`, `unauthorized.html`, and all admin pages.
- Public site callback handling exists only on the home page today:
  - [`/Users/joetozerosullivan/Desktop/HMJ Global Ltd/Website/WORKING COPY/index.html`] includes `hmj-auth-flow.js` and `hmj-auth-handoff.js`.
  - Other public pages include the widget but not the callback handoff helper.
- Admin callback handling exists only as token detection plus widget modal opening:
  - `admin/index.html` includes `hmj-auth-flow.js` and `admin.auth.experience.js`.
  - The flow changes copy and calls `netlifyIdentity.open()` or `netlifyIdentity.open('login')`.
  - There is no dedicated create-password or reset-password form route.
- Forgot-password request flow exists only on `/admin/`:
  - `admin.auth.experience.js` calls `identity.gotrue.requestPasswordRecovery(email)`.
  - Success messaging is friendly and non-enumerating.
- Login flow exists only as widget modal login:
  - no dedicated `/login` page exists.
  - sign-out is handled via `netlifyIdentity.logout()` in `admin/common.js`.
- Route protection is not frontend-only:
  - Netlify edge role redirects protect admin HTML pages.
  - Admin functions call `_auth.getContext(..., { requireAdmin: true })`.
  - `_auth.js` can also verify admins through `public.admin_users` if the Identity role is missing.

## Current Token Handling

- Parsed token types:
  - `invite_token`
  - `recovery_token`
  - `confirmation_token`
  - `email_change_token`
  - `access_token`
  - `refresh_token`
  - `type`
  - `error`
  - `error_description`
- Current behaviour:
  - Public home page forwards auth callback URLs to `/admin/`.
  - `/admin/` detects intent and auto-opens the widget modal.
  - `admin/common.js` later scrubs auth params from the URL after a verified session is present.
- Missing behaviour:
  - no dedicated password creation form for invites.
  - no dedicated password reset form for recovery links.
  - no explicit invalid/expired token recovery page beyond modal error text.
  - no intent-specific routes like `/admin/reset-password.html` or `/admin/complete-account.html`.

## Root Causes Found

1. Invite/reset completion still depends on modal widget behaviour rather than a deterministic HMJ page flow.
2. The existing token handoff is generic: it forwards callbacks to `/admin/`, but the admin page only opens the widget and hopes the right widget state appears.
3. There is no first-class login/reset/create-password route structure, so email links do not land on dedicated screens.
4. Public callback forwarding is only guaranteed on `index.html`, not across all public entry pages.
5. Candidate auth does not exist yet; current candidate data is admin-managed record data, not a self-service account system.

## Candidate Portal Audit

- Existing candidate-facing public flow:
  - [`/Users/joetozerosullivan/Desktop/HMJ Global Ltd/Website/WORKING COPY/candidates.html`] is a public registration/profile submission page, not an authenticated account area.
  - job application links feed into contact/application flows via [`/Users/joetozerosullivan/Desktop/HMJ Global Ltd/Website/WORKING COPY/js/job-application-context.js`].
- Existing candidate data/backend:
  - admin functions operate on a `candidates` table if present, with static JSON fallback in previews.
  - `candidates` rows may contain a `user_id`, but there is no current candidate auth lifecycle around it.
  - document storage exists via `public.candidate_documents` plus a private `candidate-docs` bucket.
  - there is no current candidate auth UI, candidate session middleware, profile/account routes, or application-status portal.
- Safety assessment:
  - Netlify Identity is already entrenched for admin access, but Netlify Identity is not a good long-term foundation for a large public candidate portal.
  - Safer next phase: keep admin on current Identity flow, and design candidate accounts around Supabase Auth plus dedicated profile/application tables and RLS.

## Implementation Plan Before Coding

### Ship Now

1. Add dedicated HMJ admin auth pages for:
   - sign in
   - complete account / create password
   - reset password
   - simple account/session utility
2. Replace the current invite/recovery completion dependency on `identity.open()` with deterministic branded forms that use the real Netlify Identity / GoTrue flow safely.
3. Update callback handoff so token-bearing links route to the correct admin auth page by intent instead of only `/admin/`.
4. Preserve existing admin gate, Netlify redirects, function auth, and sign-out behaviour.
5. Add tests for intent routing and the new page logic where feasible in the current test setup.

### Stage Safely For Later

1. Add a documented candidate-auth architecture note and scaffolded route placeholders only if they can remain isolated from admin auth.
2. Do not merge candidate users into admin auth logic.
3. Recommend Supabase Auth plus separate `candidate_profiles`, `candidate_account_settings`, and application-linked ownership rules as phase 2.
