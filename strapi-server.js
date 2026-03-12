'use strict';

const bootstrap     = require('./server/bootstrap');
const ssoController = require('./server/controllers/sso');

module.exports = {
  register() {},
  bootstrap,

  // ── Default config values — overridden by config/plugins.js ───────────────
  // roleMapping and defaultRole are both optional.
  // If neither is configured the user is assigned the first available Strapi admin role.
  config: {
    default: {
      clientId:     '',
      clientSecret: '',
      tenantId:     '',
      callbackUrl:  'http://localhost:1337/api/sso/callback',
      roleMapping:  {},   // optional — map Azure app roles to Strapi role names
      defaultRole:  '',   // optional — fallback Strapi role name when no Azure role matches
    },
  },

  // ── Content-API routes (public, no auth) ──────────────────────────────────
  routes: {
    'content-api': {
      type: 'content-api',
      routes: [
        {
          method:  'GET',
          path:    '/sso/login',
          handler: 'sso.login',
          config:  { auth: false, policies: [], middlewares: [] },
        },
        {
          method:  'GET',
          path:    '/sso/callback',
          handler: 'sso.callback',
          config:  { auth: false, policies: [], middlewares: [] },
        },
      ],
    },
  },

  controllers: { sso: ssoController },
};
