## HMJ Admin Auth Support Note

### Expected admin access pages

- Sign-in: `/admin/`
- Complete account from invite: `/admin/complete-account.html`
- Request reset email: `/admin/forgot-password.html`
- Set new password from reset email: `/admin/reset-password.html`
- Signed-in account page: `/admin/account.html`

### If a new admin user cannot access their account

- Ask whether they are using the newest invite email.
- Ask them to open the link on the HMJ site, not from an old saved tab.
- If the page says the link is expired, invalid, or already used, send a fresh admin invite.
- If they already created a password before, send them to `/admin/forgot-password.html` instead of sending another invite.

### If a reset link fails

- Ask whether they opened the newest reset email.
- If the page says the link is invalid, expired, or already used, ask them to request a fresh reset from `/admin/forgot-password.html`.
- If they are already signed in, direct them to `/admin/account.html` and use "Send reset email".

### How to tell what kind of issue it is

- Wrong URL:
  - User is not on an `/admin/` page, or they opened an old Netlify link/bookmark instead of the HMJ site.
- Expired or reused link:
  - The page loads but clearly says the invite/reset link is no longer valid or already used.
- Sign-in issue:
  - User is on `/admin/` and cannot sign in with email and password.
- Access/permissions issue:
  - User signs in but is told the account is not authorised for HMJ admin.

### What to collect before escalating

- Screenshot of the full page
- Exact page URL
- Email address used
- Whether this was invite setup, normal sign-in, or password reset
- Whether the link was opened on desktop, iPhone Safari, or Android Chrome
- Approximate time of the attempt

### Internal note for escalation

- Trial diagnostics now emit safe auth journey events to the `admin-auth-event` Netlify function logs.
- Those logs include route, host, environment, coarse event status, reason code, masked email, and timestamp.
- They do not include raw passwords or raw invite/reset tokens.
