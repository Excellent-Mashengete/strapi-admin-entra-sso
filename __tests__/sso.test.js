'use strict';

jest.mock('jsonwebtoken', () => ({ decode: jest.fn() }));

const jwt = require('jsonwebtoken');
const sso = require('../server/controllers/sso');

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeCtx(overrides = {}) {
  const cookieStore = {};
  return {
    redirect: jest.fn(),
    query:    {},
    cookies: {
      set: jest.fn((key, value) => {
        if (!value || value === '') delete cookieStore[key];
        else cookieStore[key] = value;
      }),
      get: jest.fn((key) => cookieStore[key]),
      _store: cookieStore,
    },
    set:  jest.fn(),
    body: undefined,
    ...overrides,
  };
}

function makeMsalClient() {
  return {
    getAuthCodeUrl:     jest.fn().mockResolvedValue('https://login.microsoftonline.com/auth?code=x'),
    acquireTokenByCode: jest.fn().mockResolvedValue({ idToken: 'id.token.here' }),
  };
}

const DEFAULT_MSAL_CONFIG = {
  redirectUri: 'https://example.com/api/sso/callback',
  scopes:      ['openid', 'profile', 'email', 'User.Read'],
};

const DEFAULT_ROLES = [
  { id: 1, name: 'Editor' },
  { id: 2, name: 'Author' },
];

const DECODED_TOKEN = {
  email:       'user@example.com',
  given_name:  'Jane',
  family_name: 'Doe',
  roles:       ['GlobalAdmin'],
};

function makeStrapi({
  msalClient   = null,
  msalConfig   = null,
  pluginCfg    = { roleMapping: {}, defaultRole: '' },
  roles        = DEFAULT_ROLES,
  existingUser = null,
} = {}) {
  const sessionManager = {
    generateRefreshToken: jest.fn().mockResolvedValue({ token: 'refresh-token-abc' }),
    generateAccessToken:  jest.fn().mockResolvedValue({ token: 'access-token-xyz' }),
  };

  const dbQuery = jest.fn().mockReturnValue({
    findMany: jest.fn().mockResolvedValue(roles),
    findOne:  jest.fn().mockResolvedValue(existingUser),
    update:   jest.fn().mockResolvedValue({ id: existingUser?.id ?? 1, roles: [{ id: 1 }] }),
    create:   jest.fn().mockResolvedValue({ id: 99, roles: [{ id: 1 }] }),
  });

  return {
    msalClient,
    msalConfig,
    config: { get: jest.fn().mockReturnValue(pluginCfg) },
    log:    { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() },
    db:     { query: dbQuery },
    sessionManager: jest.fn().mockReturnValue(sessionManager),
  };
}

function makeValidCallbackCtx() {
  const ctx = makeCtx({ query: { code: 'auth-code-123', state: 'valid-state' } });
  ctx.cookies._store['oauth_state']   = 'valid-state';
  ctx.cookies._store['pkce_verifier'] = 'verifier-xyz';
  return ctx;
}

function makeValidStrapi(overrides = {}) {
  return makeStrapi({
    msalClient: makeMsalClient(),
    msalConfig: DEFAULT_MSAL_CONFIG,
    ...overrides,
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// sso.login()
// ═════════════════════════════════════════════════════════════════════════════
describe('sso.login()', () => {
  beforeEach(() => jest.clearAllMocks());

  test('redirects to sso_not_configured when msalClient is absent', async () => {
    global.strapi = makeStrapi({ msalClient: null });
    const ctx = makeCtx();
    await sso.login(ctx);
    expect(ctx.redirect).toHaveBeenCalledWith('/admin/auth/login?error=sso_not_configured');
  });

  test('sets pkce_verifier as an httpOnly cookie', async () => {
    global.strapi = makeValidStrapi();
    const ctx = makeCtx();
    await sso.login(ctx);
    const call = ctx.cookies.set.mock.calls.find((c) => c[0] === 'pkce_verifier');
    expect(call).toBeDefined();
    expect(call[2]).toMatchObject({ httpOnly: true });
  });

  test('sets oauth_state as an httpOnly cookie', async () => {
    global.strapi = makeValidStrapi();
    const ctx = makeCtx();
    await sso.login(ctx);
    const call = ctx.cookies.set.mock.calls.find((c) => c[0] === 'oauth_state');
    expect(call).toBeDefined();
    expect(call[2]).toMatchObject({ httpOnly: true });
  });

  test('calls getAuthCodeUrl with scopes and redirectUri from msalConfig', async () => {
    const msalClient = makeMsalClient();
    global.strapi = makeValidStrapi({ msalClient });
    await sso.login(makeCtx());
    expect(msalClient.getAuthCodeUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        scopes:      DEFAULT_MSAL_CONFIG.scopes,
        redirectUri: DEFAULT_MSAL_CONFIG.redirectUri,
      })
    );
  });

  test('uses S256 PKCE challenge method with a base64url-encoded challenge', async () => {
    const msalClient = makeMsalClient();
    global.strapi = makeValidStrapi({ msalClient });
    await sso.login(makeCtx());
    const arg = msalClient.getAuthCodeUrl.mock.calls[0][0];
    expect(arg.codeChallengeMethod).toBe('S256');
    expect(arg.codeChallenge).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  test('redirects to the URL returned by getAuthCodeUrl', async () => {
    global.strapi = makeValidStrapi();
    const ctx = makeCtx();
    await sso.login(ctx);
    expect(ctx.redirect).toHaveBeenCalledWith('https://login.microsoftonline.com/auth?code=x');
  });

  test('redirects to sso_failed when getAuthCodeUrl throws', async () => {
    const msalClient = makeMsalClient();
    msalClient.getAuthCodeUrl.mockRejectedValue(new Error('network error'));
    global.strapi = makeValidStrapi({ msalClient });
    const ctx = makeCtx();
    await sso.login(ctx);
    expect(ctx.redirect).toHaveBeenCalledWith('/admin/auth/login?error=sso_failed');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// sso.callback()
// ═════════════════════════════════════════════════════════════════════════════
describe('sso.callback()', () => {
  beforeEach(() => jest.clearAllMocks());

  // ── Guards ────────────────────────────────────────────────────────────────
  test('redirects to sso_not_configured when msalClient is absent', async () => {
    global.strapi = makeStrapi({ msalClient: null });
    await sso.callback(makeCtx({ query: { code: 'c', state: 's' } }));
    expect(global.strapi.sessionManager).not.toHaveBeenCalled();
    const ctx = makeCtx({ query: { code: 'c', state: 's' } });
    global.strapi = makeStrapi({ msalClient: null });
    await sso.callback(ctx);
    expect(ctx.redirect).toHaveBeenCalledWith('/admin/auth/login?error=sso_not_configured');
  });

  test('redirects to sso_failed when Microsoft returns an error param', async () => {
    global.strapi = makeValidStrapi();
    const ctx = makeCtx({ query: { error: 'access_denied' } });
    await sso.callback(ctx);
    expect(ctx.redirect).toHaveBeenCalledWith('/admin/auth/login?error=sso_failed');
  });

  test('redirects to sso_failed when oauth_state cookie is missing', async () => {
    global.strapi = makeValidStrapi();
    const ctx = makeCtx({ query: { code: 'c', state: 'state-value' } });
    await sso.callback(ctx);
    expect(ctx.redirect).toHaveBeenCalledWith('/admin/auth/login?error=sso_failed');
  });

  test('redirects to sso_failed when state param does not match cookie', async () => {
    global.strapi = makeValidStrapi();
    const ctx = makeCtx({ query: { code: 'c', state: 'WRONG' } });
    ctx.cookies._store['oauth_state']   = 'CORRECT';
    ctx.cookies._store['pkce_verifier'] = 'verifier';
    await sso.callback(ctx);
    expect(ctx.redirect).toHaveBeenCalledWith('/admin/auth/login?error=sso_failed');
  });

  test('redirects to sso_failed when pkce_verifier cookie is missing', async () => {
    global.strapi = makeValidStrapi();
    const ctx = makeCtx({ query: { code: 'c', state: 'valid-state' } });
    ctx.cookies._store['oauth_state'] = 'valid-state';
    await sso.callback(ctx);
    expect(ctx.redirect).toHaveBeenCalledWith('/admin/auth/login?error=sso_failed');
  });

  // ── Role resolution ────────────────────────────────────────────────────────
  test('redirects to role_not_found when the DB has no admin roles', async () => {
    jwt.decode.mockReturnValue(DECODED_TOKEN);
    global.strapi = makeValidStrapi({ roles: [] });
    await sso.callback(makeValidCallbackCtx());
    const ctx = makeValidCallbackCtx();
    global.strapi = makeValidStrapi({ roles: [] });
    jwt.decode.mockReturnValue(DECODED_TOKEN);
    await sso.callback(ctx);
    expect(ctx.redirect).toHaveBeenCalledWith('/admin/auth/login?error=role_not_found');
  });

  test('resolves role via roleMapping when Azure role matches', async () => {
    jwt.decode.mockReturnValue({ ...DECODED_TOKEN, roles: ['GlobalAdmin'] });
    global.strapi = makeValidStrapi({
      pluginCfg: { roleMapping: { GlobalAdmin: 'Editor' }, defaultRole: '' },
    });
    await sso.callback(makeValidCallbackCtx());
    expect(global.strapi.sessionManager).toHaveBeenCalledWith('admin');
  });

  test('falls back to defaultRole when no Azure role matches', async () => {
    jwt.decode.mockReturnValue({ ...DECODED_TOKEN, roles: [] });
    global.strapi = makeValidStrapi({
      pluginCfg: { roleMapping: { GlobalAdmin: 'Editor' }, defaultRole: 'Author' },
    });
    await sso.callback(makeValidCallbackCtx());
    expect(global.strapi.sessionManager).toHaveBeenCalledWith('admin');
  });

  test('falls back to first DB role when neither roleMapping nor defaultRole matches', async () => {
    jwt.decode.mockReturnValue({ ...DECODED_TOKEN, roles: [] });
    global.strapi = makeValidStrapi({ pluginCfg: { roleMapping: {}, defaultRole: '' } });
    const ctx = makeValidCallbackCtx();
    await sso.callback(ctx);
    expect(global.strapi.sessionManager).toHaveBeenCalled();
    expect(global.strapi.log.debug).toHaveBeenCalledWith(
      expect.stringContaining('No role matched')
    );
  });

  // ── User create vs update ─────────────────────────────────────────────────
  test('creates a new user when the email is not found in the DB', async () => {
    jwt.decode.mockReturnValue(DECODED_TOKEN);
    global.strapi = makeValidStrapi({ existingUser: null });
    await sso.callback(makeValidCallbackCtx());
    const query = global.strapi.db.query.mock.results[0].value;
    expect(query.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ email: 'user@example.com', isActive: true }),
      })
    );
  });

  test('updates an existing user and does not call create', async () => {
    jwt.decode.mockReturnValue(DECODED_TOKEN);
    global.strapi = makeValidStrapi({ existingUser: { id: 42, email: 'user@example.com', roles: [] } });
    await sso.callback(makeValidCallbackCtx());
    const query = global.strapi.db.query.mock.results[0].value;
    expect(query.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 42 } }));
    expect(query.create).not.toHaveBeenCalled();
  });

  // ── Session generation ────────────────────────────────────────────────────
  test('calls generateRefreshToken with userId as string and a deviceId', async () => {
    jwt.decode.mockReturnValue(DECODED_TOKEN);
    global.strapi = makeValidStrapi();
    await sso.callback(makeValidCallbackCtx());
    const sm = global.strapi.sessionManager.mock.results[0].value;
    expect(sm.generateRefreshToken).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      {}
    );
  });

  test('calls generateAccessToken with the refresh token', async () => {
    jwt.decode.mockReturnValue(DECODED_TOKEN);
    global.strapi = makeValidStrapi();
    await sso.callback(makeValidCallbackCtx());
    const sm = global.strapi.sessionManager.mock.results[0].value;
    expect(sm.generateAccessToken).toHaveBeenCalledWith('refresh-token-abc');
  });

  // ── Cookie and HTML response ──────────────────────────────────────────────
  test('sets strapi_admin_refresh as a signed httpOnly cookie', async () => {
    jwt.decode.mockReturnValue(DECODED_TOKEN);
    global.strapi = makeValidStrapi();
    const ctx = makeValidCallbackCtx();
    await sso.callback(ctx);
    const call = ctx.cookies.set.mock.calls.find((c) => c[0] === 'strapi_admin_refresh');
    expect(call).toBeDefined();
    expect(call[1]).toBe('refresh-token-abc');
    expect(call[2]).toMatchObject({ httpOnly: true, signed: true });
  });

  test('returns HTML body containing the access token and localStorage call', async () => {
    jwt.decode.mockReturnValue(DECODED_TOKEN);
    global.strapi = makeValidStrapi();
    const ctx = makeValidCallbackCtx();
    await sso.callback(ctx);
    expect(typeof ctx.body).toBe('string');
    expect(ctx.body).toContain('access-token-xyz');
    expect(ctx.body).toContain('jwtToken=');
    expect(ctx.body).toContain("localStorage.setItem('isLoggedIn'");
  });

  test('sets Content-Type to text/html', async () => {
    jwt.decode.mockReturnValue(DECODED_TOKEN);
    global.strapi = makeValidStrapi();
    const ctx = makeValidCallbackCtx();
    await sso.callback(ctx);
    expect(ctx.set).toHaveBeenCalledWith('Content-Type', 'text/html; charset=utf-8');
  });

  test('sets Content-Security-Policy header with a nonce', async () => {
    jwt.decode.mockReturnValue(DECODED_TOKEN);
    global.strapi = makeValidStrapi();
    const ctx = makeValidCallbackCtx();
    await sso.callback(ctx);
    const cspCall = ctx.set.mock.calls.find((c) => c[0] === 'Content-Security-Policy');
    expect(cspCall).toBeDefined();
    expect(cspCall[1]).toMatch(/script-src 'nonce-/);
  });

  // ── Error handling ────────────────────────────────────────────────────────
  test('redirects to server_error when acquireTokenByCode throws', async () => {
    const msalClient = makeMsalClient();
    msalClient.acquireTokenByCode.mockRejectedValue(new Error('token exchange failed'));
    global.strapi = makeValidStrapi({ msalClient });
    const ctx = makeValidCallbackCtx();
    await sso.callback(ctx);
    expect(ctx.redirect).toHaveBeenCalledWith('/admin/auth/login?error=server_error');
  });

  // ── Email field fallbacks ─────────────────────────────────────────────────
  test('uses preferred_username when email field is absent', async () => {
    jwt.decode.mockReturnValue({ preferred_username: 'alt@example.com', given_name: 'Alt', family_name: 'User', roles: [] });
    global.strapi = makeValidStrapi();
    await sso.callback(makeValidCallbackCtx());
    const query = global.strapi.db.query.mock.results[0].value;
    expect(query.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: 'alt@example.com' } })
    );
  });

  test('stores email in lowercase', async () => {
    jwt.decode.mockReturnValue({ ...DECODED_TOKEN, email: 'UPPER@EXAMPLE.COM' });
    global.strapi = makeValidStrapi();
    await sso.callback(makeValidCallbackCtx());
    const query = global.strapi.db.query.mock.results[0].value;
    expect(query.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: 'upper@example.com' } })
    );
  });
});
