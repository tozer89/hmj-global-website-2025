## HMJ Admin Auth Trial Checklist

Date: 2026-03-15

### Before trial

- Confirm Netlify Identity `Site URL` points to the live HMJ production domain used for the trial.
- Confirm `HMJ_IDENTITY_BASE` is set if production Identity should be forced to a specific host.
- If used, confirm `HMJ_CANONICAL_SITE_URL` matches the production HMJ domain.
- Confirm the current invite email wording matches "Complete account / create password".
- Confirm any reset-password email wording in Netlify still points users back to the HMJ site.
- Confirm the new expected admin routes are live:
  - `/admin/`
  - `/admin/complete-account.html`
  - `/admin/forgot-password.html`
  - `/admin/reset-password.html`
  - `/admin/account.html`

### UAT flow checks

1. Existing admin sign-in
- Open `/admin/` on the production domain.
- Sign in with a known working admin account.
- Confirm the dashboard opens.
- Open `/admin/account.html`.
- Sign out and confirm return to `/admin/?auth_notice=signed-out`.

2. Fresh admin invite
- Send a brand-new invite to a test HMJ admin email.
- Open the invite from the email.
- Confirm the user lands on `/admin/complete-account.html`.
- Create the password and confirm redirect back into HMJ admin.
- Sign out and sign back in with the new password.

3. Fresh password reset
- From `/admin/forgot-password.html`, request a reset for a valid admin account.
- Open the newest reset email only.
- Confirm the user lands on `/admin/reset-password.html`.
- Save a new password and confirm redirect back into HMJ admin.
- Sign in again with the new password.

4. Failure-state coverage
- Open `/admin/complete-account.html` directly with no token and confirm the missing-link message.
- Open `/admin/reset-password.html` directly with no token and confirm the missing-link message.
- Reuse an old or already-consumed invite/reset link and confirm the expired/invalid guidance is shown.
- Confirm non-admin accounts do not get access to admin pages.

5. Mobile checks
- Repeat the fresh invite flow from an iPhone email app into Safari.
- Repeat the fresh reset flow from an Android email app into Chrome.
- Confirm password fields, validation messages, and submit buttons stay visible without overlap.

6. Domain sanity checks
- Confirm the full invite/reset journey stays on the production HMJ domain during the live trial.
- Sanity-check the Netlify subdomain manually, but do not use it for user trial unless intentionally testing fallback behaviour.
- If preview URLs are used internally, confirm they still reach the correct dedicated auth pages.

### What support should capture if anything fails

- Exact page URL shown in the browser after the problem occurs
- Approximate local time of the attempt
- Whether the user opened an invite email or a reset email
- Whether the link was opened from desktop, iPhone Safari, or Android Chrome
- A screenshot of the full page, including the browser address bar if possible
- The email address used, shared internally only
- Whether the link had already been opened before
