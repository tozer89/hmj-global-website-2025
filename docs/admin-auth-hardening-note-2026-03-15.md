## HMJ Admin Auth Hardening Note

Date: 2026-03-15

### Current audited state

- Primary admin auth routes in play:
  - `/admin/`
  - `/admin/complete-account.html`
  - `/admin/reset-password.html`
  - `/admin/forgot-password.html`
  - `/admin/account.html`
- Dedicated HMJ-branded forms are now the main flow for login, password creation, reset, and account actions.
- Netlify Identity is still loaded on admin auth pages and remains necessary for:
  - GoTrue email/password login
  - password reset email requests
  - session/logout event handling
- A visible legacy widget fallback still exists on `/admin/`, creating an avoidable dual-flow experience.
- Identity URL resolution is mostly same-host aware, but two fixed `hmjg.netlify.app` fallbacks remain in:
  - `js/hmj-identity.js`
  - `netlify/functions/identity-proxy.js`
- There is no structured trial diagnostics layer yet for auth journey events.
- Invalid and expired link handling is generally present, but support messaging can be made more explicit.
- Signed-in redirects away from login/reset/setup pages are not yet consistently enforced.

### Hardening decisions for this pass

1. Keep the HMJ-branded pages as the only user-facing auth flow.
2. Remove the visible widget fallback from the login page and keep widget use as an internal transport/session layer only.
3. Add lightweight structured auth diagnostics without logging passwords, raw tokens, or other secrets.
4. Harden domain handling so production remains the source of truth while preview hosts continue to work through same-host proxying.
5. Improve signed-in redirects, logout notices, and expired/invalid link recovery guidance.
6. Add concise UAT and support documents for the live admin trial.

### Intentionally out of scope for this pass

- Candidate/public account implementation
- Reworking existing admin module security model beyond safe auth hardening
- Building a heavy monitoring pipeline beyond lightweight trial diagnostics
