'use strict';

const mockMsalConstructor = jest.fn();

jest.mock('@azure/msal-node', () => ({
  ConfidentialClientApplication: mockMsalConstructor,
  LogLevel: { Warning: 2 },
}));

const bootstrap = require('../server/bootstrap');

function makeStrapi(cfg = {}) {
  return {
    config: {
      get: jest.fn().mockReturnValue(cfg),
    },
    log: {
      warn:  jest.fn(),
      info:  jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    },
    msalClient: undefined,
    msalConfig: undefined,
  };
}

const VALID_CFG = {
  clientId:     'client-id-123',
  clientSecret: 'client-secret-abc',
  tenantId:     'tenant-id-xyz',
  callbackUrl:  'https://example.com/api/sso/callback',
  roleMapping:  {},
  defaultRole:  '',
};

describe('server/bootstrap.js', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockMsalConstructor.mockReturnValue({ __isMsalMock: true });
  });

  // ── Missing credentials ────────────────────────────────────────────────────
  describe('when credentials are missing', () => {
    test('warns and returns early when clientId is empty', () => {
      const strapi = makeStrapi({ ...VALID_CFG, clientId: '' });
      bootstrap({ strapi });
      expect(strapi.log.warn).toHaveBeenCalledWith(expect.stringContaining('Not configured'));
      expect(strapi.msalClient).toBeUndefined();
    });

    test('warns and returns early when clientSecret is undefined', () => {
      const strapi = makeStrapi({ ...VALID_CFG, clientSecret: undefined });
      bootstrap({ strapi });
      expect(strapi.log.warn).toHaveBeenCalledTimes(1);
      expect(strapi.msalClient).toBeUndefined();
    });

    test('warns and returns early when tenantId is empty', () => {
      const strapi = makeStrapi({ ...VALID_CFG, tenantId: '' });
      bootstrap({ strapi });
      expect(strapi.log.warn).toHaveBeenCalledTimes(1);
      expect(strapi.msalClient).toBeUndefined();
    });

    test('warns and returns early when config is null', () => {
      const strapi = makeStrapi(null);
      bootstrap({ strapi });
      expect(strapi.log.warn).toHaveBeenCalledTimes(1);
      expect(strapi.msalClient).toBeUndefined();
    });

    test('does NOT log info when returning early', () => {
      const strapi = makeStrapi({ ...VALID_CFG, tenantId: '' });
      bootstrap({ strapi });
      expect(strapi.log.info).not.toHaveBeenCalled();
    });
  });

  // ── Happy path ─────────────────────────────────────────────────────────────
  describe('when all credentials are present', () => {
    test('constructs ConfidentialClientApplication with correct auth options', () => {
      const strapi = makeStrapi(VALID_CFG);
      bootstrap({ strapi });
      expect(mockMsalConstructor).toHaveBeenCalledTimes(1);
      const arg = mockMsalConstructor.mock.calls[0][0];
      expect(arg.auth.clientId).toBe(VALID_CFG.clientId);
      expect(arg.auth.clientSecret).toBe(VALID_CFG.clientSecret);
      expect(arg.auth.authority).toBe(
        `https://login.microsoftonline.com/${VALID_CFG.tenantId}`
      );
    });

    test('attaches the MSAL client instance to strapi', () => {
      const strapi = makeStrapi(VALID_CFG);
      bootstrap({ strapi });
      expect(strapi.msalClient).toEqual({ __isMsalMock: true });
    });

    test('attaches msalConfig.redirectUri matching callbackUrl', () => {
      const strapi = makeStrapi(VALID_CFG);
      bootstrap({ strapi });
      expect(strapi.msalConfig.redirectUri).toBe(VALID_CFG.callbackUrl);
    });

    test('attaches msalConfig.scopes with the four required OIDC scopes', () => {
      const strapi = makeStrapi(VALID_CFG);
      bootstrap({ strapi });
      expect(strapi.msalConfig.scopes).toEqual(
        expect.arrayContaining(['openid', 'profile', 'email', 'User.Read'])
      );
    });

    test('logs success info message', () => {
      const strapi = makeStrapi(VALID_CFG);
      bootstrap({ strapi });
      expect(strapi.log.info).toHaveBeenCalledWith(
        expect.stringContaining('initialised')
      );
    });

    test('disables PII logging', () => {
      const strapi = makeStrapi(VALID_CFG);
      bootstrap({ strapi });
      const arg = mockMsalConstructor.mock.calls[0][0];
      expect(arg.system.loggerOptions.piiLoggingEnabled).toBe(false);
    });

    test('loggerCallback forwards Warning-level messages to strapi.log.info', () => {
      const strapi = makeStrapi(VALID_CFG);
      bootstrap({ strapi });
      const { loggerCallback, logLevel } = mockMsalConstructor.mock.calls[0][0].system.loggerOptions;
      // Invoke the callback at Warning level — should forward to strapi.log.info
      loggerCallback(logLevel, 'test msal warning');
      expect(strapi.log.info).toHaveBeenCalledWith(expect.stringContaining('test msal warning'));
    });

    test('loggerCallback suppresses messages below Warning level', () => {
      const strapi = makeStrapi(VALID_CFG);
      bootstrap({ strapi });
      const { loggerCallback } = mockMsalConstructor.mock.calls[0][0].system.loggerOptions;
      // Level 3 > Warning (2) — should NOT forward
      loggerCallback(3, 'verbose message');
      // strapi.log.info was called once already for the init message — check no extra calls
      const infoCalls = strapi.log.info.mock.calls.filter((c) => c[0].includes('verbose'));
      expect(infoCalls).toHaveLength(0);
    });
  });
});
