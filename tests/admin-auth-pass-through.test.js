const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

function createMatchMedia(width) {
  return (query) => {
    const max = /max-width:\s*(\d+)px/i.exec(query);
    const min = /min-width:\s*(\d+)px/i.exec(query);
    let matches = true;
    if (max) matches = matches && width <= Number(max[1]);
    if (min) matches = matches && width >= Number(min[1]);
    return {
      matches,
      media: query,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
    };
  };
}

function createIdentityUser({ email, roles, token }) {
  return {
    email,
    app_metadata: { roles: Array.isArray(roles) ? roles : [] },
    async token() {
      return token || '';
    },
    async jwt() {
      return token || '';
    },
  };
}

function createJwt(email, roles) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    email,
    app_metadata: { roles: Array.isArray(roles) ? roles : [] },
  })).toString('base64url');
  return `${header}.${payload}.signature`;
}

function plainNavigation(list) {
  return JSON.parse(JSON.stringify(list));
}

function createIdentityStub(state) {
  const handlers = new Map();
  return {
    __hmjHooks: false,
    currentUser() {
      return state.currentUser;
    },
    on(event, callback) {
      const list = handlers.get(event) || [];
      list.push(callback);
      handlers.set(event, list);
    },
    async emit(event, payload) {
      const list = handlers.get(event) || [];
      for (const callback of list) {
        await callback(payload);
      }
    },
  };
}

function createAdminHarness({ url, width, whoamiResponses = [], adminRoleCheckResponses = [] }) {
  const html = `<!doctype html>
  <html>
    <body>
      <div class="top">
        <div class="row">
          <div class="brand">HMJ Global Admin</div>
          <div class="sp"></div>
          <button class="btn outline" type="button" data-admin-logout hidden aria-hidden="true">Sign out</button>
        </div>
      </div>
      <div id="gate" style="display:none">
        <h1 data-gate-heading>HMJ admin sign-in</h1>
        <p class="why">Checking your session…</p>
        <button type="button" data-admin-login data-admin-login-primary>Open secure sign-in</button>
      </div>
      <div id="app" style="display:none">
        <p>Admin app shell</p>
      </div>
    </body>
  </html>`;

  const dom = new JSDOM(html, {
    url,
    pretendToBeVisual: true,
    runScripts: 'outside-only',
  });

  const { window } = dom;
  const state = { currentUser: null };
  const calls = { whoami: 0, adminRoleCheck: 0 };
  const navigation = [];
  const identity = createIdentityStub(state);

  window.matchMedia = createMatchMedia(width);
  window.console = console;
  window.netlifyIdentity = identity;
  window.requestAnimationFrame = (callback) => setTimeout(() => callback(Date.now()), 0);
  window.cancelAnimationFrame = (id) => clearTimeout(id);
  window.__hmjNavigationHook = (entry) => {
    navigation.push(entry);
  };
  window.fetch = async (resource) => {
    const href = String(resource || '');
    if (href.includes('/.netlify/functions/identity-whoami')) {
      const index = Math.min(calls.whoami, Math.max(whoamiResponses.length - 1, 0));
      const payload = whoamiResponses[index] || { ok: true, identityEmail: null, roles: [] };
      calls.whoami += 1;
      return {
        ok: true,
        status: 200,
        async json() {
          return payload;
        },
      };
    }
    if (href.includes('/.netlify/functions/admin-role-check')) {
      const index = Math.min(calls.adminRoleCheck, Math.max(adminRoleCheckResponses.length - 1, 0));
      const payload = adminRoleCheckResponses[index] || { ok: false, error: 'Forbidden' };
      calls.adminRoleCheck += 1;
      return {
        ok: !!payload.ok,
        status: payload.ok ? 200 : Number(payload.status || 403),
        async json() {
          return payload;
        },
      };
    }
    return {
      ok: true,
      status: 200,
      async json() {
        return {};
      },
      async text() {
        return '{}';
      },
    };
  };

  const source = fs.readFileSync(path.join(process.cwd(), 'admin/common.js'), 'utf8');
  window.eval(source);

  return { dom, window, state, identity, calls, navigation };
}

test('forceFresh identity checks refetch whoami after an empty cookie-based snapshot', async () => {
  const harness = createAdminHarness({
    url: 'https://example.com/admin/',
    width: 390,
    whoamiResponses: [
      { ok: true, identityEmail: null, roles: [] },
      { ok: true, identityEmail: 'admin@hmj-global.com', roles: ['admin'] },
    ],
  });

  harness.state.currentUser = createIdentityUser({
    email: 'admin@hmj-global.com',
    roles: ['admin'],
    token: '',
  });

  const first = await harness.window.getIdentity({ requiredRole: 'admin', forceFresh: true, cacheTtlMs: 0 });
  const second = await harness.window.getIdentity({ requiredRole: 'admin', forceFresh: true, cacheTtlMs: 0 });

  assert.equal(first.ok, false);
  assert.equal(second.ok, true);
  assert.equal(harness.calls.whoami, 2);
});

test('admin identity falls back to the server-side admin check when the browser-side role list is empty', async () => {
  const harness = createAdminHarness({
    url: 'https://example.com/admin/',
    width: 390,
    whoamiResponses: [
      { ok: true, identityEmail: 'owner@hmj-global.com', roles: [] },
    ],
    adminRoleCheckResponses: [
      { ok: true, email: 'owner@hmj-global.com', roles: ['owner', 'admin'] },
    ],
  });

  harness.state.currentUser = createIdentityUser({
    email: 'owner@hmj-global.com',
    roles: [],
    token: createJwt('owner@hmj-global.com', []),
  });

  const snapshot = await harness.window.getIdentity({ requiredRole: 'admin', forceFresh: true, cacheTtlMs: 0 });

  assert.equal(snapshot.ok, true);
  assert.deepEqual(Array.from(snapshot.roles), ['owner', 'admin']);
  assert.equal(snapshot.role, 'owner');
  assert.equal(harness.calls.adminRoleCheck, 1);
});

test('successful login waits for admin session verification before routing to the requested admin page', async () => {
  const harness = createAdminHarness({
    url: 'https://example.com/admin/?next=jobs.html',
    width: 390,
    whoamiResponses: [
      { ok: true, identityEmail: null, roles: [] },
      { ok: true, identityEmail: null, roles: [] },
      { ok: true, identityEmail: 'admin@hmj-global.com', roles: ['admin'] },
    ],
  });

  let mainRan = false;
  await harness.window.Admin.bootAdmin(async () => {
    mainRan = true;
  });

  assert.equal(mainRan, false);
  assert.deepEqual(harness.navigation, []);

  harness.state.currentUser = createIdentityUser({
    email: 'admin@hmj-global.com',
    roles: ['admin'],
    token: '',
  });

  await harness.identity.emit('login', harness.state.currentUser);

  assert.equal(harness.calls.whoami >= 3, true);
  assert.deepEqual(plainNavigation(harness.navigation), [
    { mode: 'replace', target: '/admin/jobs.html' },
  ]);
});

test('preview hosts resolve admin identity to the same-host netlify identity endpoint', () => {
  const harness = createAdminHarness({
    url: 'https://deploy-preview-105--hmjg.netlify.app/admin/',
    width: 390,
  });

  assert.equal(
    harness.window.ADMIN_IDENTITY_URL,
    'https://deploy-preview-105--hmjg.netlify.app/.netlify/identity'
  );
});

test('custom production hosts resolve admin identity to the same-host identity proxy', () => {
  const harness = createAdminHarness({
    url: 'https://hmj-global.com/admin/',
    width: 390,
  });

  assert.equal(
    harness.window.ADMIN_IDENTITY_URL,
    'https://hmj-global.com/.netlify/functions/identity-proxy'
  );
});

test('unauthenticated protected admin routes redirect back to the admin entry gate', async () => {
  const harness = createAdminHarness({
    url: 'https://example.com/admin/jobs.html',
    width: 1280,
    whoamiResponses: [
      { ok: true, identityEmail: null, roles: [] },
    ],
  });

  let mainRan = false;
  await harness.window.Admin.bootAdmin(async () => {
    mainRan = true;
  });

  assert.equal(mainRan, false);
  assert.deepEqual(plainNavigation(harness.navigation), [
    { mode: 'replace', target: '/admin/?next=jobs.html' },
  ]);
});

test('authenticated admin landing renders cleanly across small, mobile, tablet, and desktop widths', async (t) => {
  for (const width of [320, 390, 768, 1280]) {
    await t.test(`width ${width}`, async () => {
      const harness = createAdminHarness({
        url: 'https://example.com/admin/',
        width,
      });

      harness.state.currentUser = createIdentityUser({
        email: 'admin@hmj-global.com',
        roles: ['admin'],
        token: createJwt('admin@hmj-global.com', ['admin']),
      });

      let mainRan = false;
      await harness.window.Admin.bootAdmin(async () => {
        mainRan = true;
      });

      assert.equal(mainRan, true);
      assert.deepEqual(harness.navigation, []);
      assert.equal(harness.window.document.getElementById('gate').style.display, 'none');
      assert.equal(harness.window.document.getElementById('app').style.display, '');
    });
  }
});

test('logout transition returns the user to the admin entry page with a signed-out notice', () => {
  const harness = createAdminHarness({
    url: 'https://example.com/admin/',
    width: 390,
  });

  harness.window.Admin.finishLogoutTransition();

  assert.deepEqual(plainNavigation(harness.navigation), [
    { mode: 'replace', target: '/admin/?auth_notice=signed-out' },
  ]);
});
