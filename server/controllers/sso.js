'use strict';

const jwt    = require('jsonwebtoken');
const crypto = require('crypto');

module.exports = {
  /**
   * Redirect the user to the Microsoft Entra login page.
   * Uses PKCE + CSRF state for security.
   */
  async login(ctx) {
    try {
      const msalClient = strapi.msalClient;
      const msalConfig = strapi.msalConfig;

      if (!msalClient) {
        ctx.redirect('/admin/auth/login?error=sso_not_configured');
        return;
      }

      // ── PKCE setup ────────────────────────────────────────────────────────
      const pkceCodes = {
        verifier:         crypto.randomBytes(32).toString('base64url'),
        challenge:        '',
        challengeMethod:  'S256',
      };

      pkceCodes.challenge = crypto
        .createHash('sha256')
        .update(pkceCodes.verifier)
        .digest('base64url');

      ctx.cookies.set('pkce_verifier', pkceCodes.verifier, {
        httpOnly: true,
        secure:   process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge:   600000,
      });

      // ── CSRF state protection ─────────────────────────────────────────────
      const state = crypto.randomBytes(16).toString('hex');
      ctx.cookies.set('oauth_state', state, {
        httpOnly: true,
        secure:   process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge:   600000,
      });

      // ── Build Microsoft login URL ─────────────────────────────────────────
      const authUrl = await msalClient.getAuthCodeUrl({
        scopes:               msalConfig.scopes,
        redirectUri:          msalConfig.redirectUri,
        codeChallenge:        pkceCodes.challenge,
        codeChallengeMethod:  pkceCodes.challengeMethod,
        state,
      });

      ctx.redirect(authUrl);
    } catch (error) {
      strapi.log.error('[strapi-admin-entra-sso] login error', error);
      ctx.redirect('/admin/auth/login?error=sso_failed');
    }
  },

  /**
   * Handle the Microsoft callback, create/update the Strapi admin user,
   * and establish a valid Strapi v5 session (refresh + access tokens).
   */
  async callback(ctx) {
    try {
      const msalClient = strapi.msalClient;
      const msalConfig = strapi.msalConfig;

      if (!msalClient) {
        ctx.redirect('/admin/auth/login?error=sso_not_configured');
        return;
      }

      const { code, state, error } = ctx.query;

      if (error) {
        strapi.log.warn('[strapi-admin-entra-sso] Microsoft returned an error:', error);
        ctx.redirect('/admin/auth/login?error=sso_failed');
        return;
      }

      // ── Validate CSRF state ───────────────────────────────────────────────
      const savedState  = ctx.cookies.get('oauth_state');
      const codeVerifier = ctx.cookies.get('pkce_verifier');

      if (!savedState || savedState !== state || !codeVerifier) {
        ctx.redirect('/admin/auth/login?error=sso_failed');
        return;
      }

      // Clear one-time cookies
      ctx.cookies.set('oauth_state',   '', { maxAge: 0 });
      ctx.cookies.set('pkce_verifier', '', { maxAge: 0 });

      // ── Exchange auth code for tokens ─────────────────────────────────────
      const tokenResponse = await msalClient.acquireTokenByCode({
        code,
        scopes:       msalConfig.scopes,
        redirectUri:  msalConfig.redirectUri,
        codeVerifier,
      });

      const decoded = jwt.decode(tokenResponse.idToken);

      const email =
        decoded.email ||
        decoded.preferred_username ||
        decoded.upn;

      const firstName =
        decoded.given_name ||
        decoded.name?.split(' ')[0] ||
        '';

      const lastName =
        decoded.family_name ||
        decoded.name?.split(' ').slice(1).join(' ') ||
        '';

      const azureRoles = decoded.roles || [];

      // ── Resolve Strapi role (roleMapping and defaultRole are both optional) ──
      const cfg         = strapi.config.get('plugin::strapi-admin-entra-sso');
      const roleMapping = cfg?.roleMapping ?? {};
      const defaultRole = cfg?.defaultRole ?? '';

      const allRoles = await strapi.db.query('admin::role').findMany();

      if (!allRoles.length) {
        strapi.log.error('[strapi-admin-entra-sso] No admin roles found in Strapi DB');
        ctx.redirect('/admin/auth/login?error=role_not_found');
        return;
      }

      // 1. Try to match an Azure app role via roleMapping
      let role = null;
      for (const [azureRole, strapiRoleName] of Object.entries(roleMapping)) {
        if (azureRoles.includes(azureRole)) {
          role = allRoles.find((r) => r.name === strapiRoleName) ?? null;
          if (role) break;
        }
      }

      // 2. Fall back to the configured defaultRole (if set)
      if (!role && defaultRole) {
        role = allRoles.find((r) => r.name === defaultRole) ?? null;
      }

      // 3. Last resort: use the first role that exists in Strapi
      if (!role) {
        role = allRoles[0];
        strapi.log.debug(
          `[strapi-admin-entra-sso] No role matched — assigning first available role: "${role.name}"`
        );
      }

      // ── Find or create admin user ─────────────────────────────────────────
      let user = await strapi.db.query('admin::user').findOne({
        where:    { email: email.toLowerCase() },
        populate: ['roles'],
      });

      if (user) {
        user = await strapi.db.query('admin::user').update({
          where: { id: user.id },
          data: {
            firstname: firstName,
            lastname:  lastName,
            roles:     [role.id],
            isActive:  true,
          },
          populate: ['roles'],
        });
      } else {
        user = await strapi.db.query('admin::user').create({
          data: {
            email:             email.toLowerCase(),
            firstname:         firstName,
            lastname:          lastName,
            roles:             [role.id],
            isActive:          true,
            registrationToken: null,
          },
          populate: ['roles'],
        });
      }

      // ── Generate Strapi v5 session ────────────────────────────────────────
      const deviceId = crypto.randomBytes(16).toString('hex');

      const { token: refreshToken } =
        await strapi
          .sessionManager('admin')
          .generateRefreshToken(String(user.id), deviceId, {});

      const { token: accessToken } =
        await strapi
          .sessionManager('admin')
          .generateAccessToken(refreshToken);

      // Set the signed httpOnly refresh-token cookie
      const isProd = process.env.NODE_ENV === 'production';

      ctx.cookies.set('strapi_admin_refresh', refreshToken, {
        httpOnly: true,
        signed:   true,
        secure:   isProd,
        sameSite: 'lax',
        maxAge:   30 * 24 * 60 * 60 * 1000,
        path:     '/',
      });

      // ── Return HTML page that writes localStorage + jwtToken cookie ───────
      // Strapi's React admin checks localStorage.isLoggedIn and the jwtToken
      // cookie — these can only be set from browser-side JavaScript.
      const nonce       = crypto.randomBytes(16).toString('base64url');
      const cookieFlags = `path=/; max-age=86400${isProd ? '; Secure' : ''}; SameSite=Lax`;

      ctx.set('Content-Type', 'text/html; charset=utf-8');
      ctx.set('Content-Security-Policy', `default-src 'none'; script-src 'nonce-${nonce}'`);

      ctx.body = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Signing in...</title>
</head>
<body>
  <script nonce="${nonce}">
    (function () {
      try {
        document.cookie = 'jwtToken=${accessToken}; ${cookieFlags}';
        localStorage.setItem('isLoggedIn', 'true');
        localStorage.setItem('strapi.admin.deviceId', '${deviceId}');
        window.location.replace('/admin');
      } catch (e) {
        window.location.replace('/admin/auth/login?error=sso_failed');
      }
    })();
  </script>
</body>
</html>`;
    } catch (error) {
      strapi.log.error('[strapi-admin-entra-sso] callback error', error);
      ctx.redirect('/admin/auth/login?error=server_error');
    }
  },
};
