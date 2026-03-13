'use strict';

jest.mock('../server/bootstrap', () => jest.fn());
jest.mock('../server/controllers/sso', () => ({
  login:    jest.fn(),
  callback: jest.fn(),
}));

const plugin = require('../strapi-server');

describe('strapi-server.js — plugin manifest', () => {
  // ── Top-level shape ────────────────────────────────────────────────────────
  test('exports register as a function and it is callable', () => {
    expect(typeof plugin.register).toBe('function');
    expect(() => plugin.register()).not.toThrow();
  });

  test('exports bootstrap as a function', () => {
    expect(typeof plugin.bootstrap).toBe('function');
  });

  // ── Config defaults ────────────────────────────────────────────────────────
  describe('config.default', () => {
    const { default: defaults } = plugin.config;

    test('clientId defaults to empty string', () => {
      expect(defaults.clientId).toBe('');
    });

    test('clientSecret defaults to empty string', () => {
      expect(defaults.clientSecret).toBe('');
    });

    test('tenantId defaults to empty string', () => {
      expect(defaults.tenantId).toBe('');
    });

    test('callbackUrl defaults to localhost Strapi address', () => {
      expect(defaults.callbackUrl).toBe('http://localhost:1337/api/sso/callback');
    });

    test('roleMapping defaults to empty object', () => {
      expect(defaults.roleMapping).toEqual({});
    });

    test('defaultRole defaults to empty string', () => {
      expect(defaults.defaultRole).toBe('');
    });
  });

  // ── Routes ─────────────────────────────────────────────────────────────────
  describe('routes["content-api"]', () => {
    const routes = plugin.routes['content-api'].routes;

    test('defines exactly two routes', () => {
      expect(routes).toHaveLength(2);
    });

    test('first route is GET /sso/login with auth:false', () => {
      expect(routes[0].method).toBe('GET');
      expect(routes[0].path).toBe('/sso/login');
      expect(routes[0].handler).toBe('sso.login');
      expect(routes[0].config.auth).toBe(false);
    });

    test('second route is GET /sso/callback with auth:false', () => {
      expect(routes[1].method).toBe('GET');
      expect(routes[1].path).toBe('/sso/callback');
      expect(routes[1].handler).toBe('sso.callback');
      expect(routes[1].config.auth).toBe(false);
    });

    test('both routes have empty policies and middlewares arrays', () => {
      for (const route of routes) {
        expect(route.config.policies).toEqual([]);
        expect(route.config.middlewares).toEqual([]);
      }
    });
  });

  // ── Controllers ────────────────────────────────────────────────────────────
  test('controllers.sso exposes login and callback', () => {
    expect(typeof plugin.controllers.sso.login).toBe('function');
    expect(typeof plugin.controllers.sso.callback).toBe('function');
  });
});
