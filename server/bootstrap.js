'use strict';

const msal = require('@azure/msal-node');

/**
 * Plugin bootstrap — runs once when Strapi starts.
 * Reads Azure credentials from plugin config, creates the MSAL client,
 * and attaches it to the strapi instance so the SSO controller can use it.
 */
module.exports = ({ strapi }) => {
  const cfg = strapi.config.get('plugin::strapi-admin-entra-sso');

  if (!cfg?.clientId || !cfg?.clientSecret || !cfg?.tenantId) {
    strapi.log.warn(
      '[strapi-admin-entra-sso] Not configured — ' +
      'set AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, and AZURE_TENANT_ID in your .env file'
    );
    return;
  }

  strapi.msalClient = new msal.ConfidentialClientApplication({
    auth: {
      clientId:     cfg.clientId,
      clientSecret: cfg.clientSecret,
      authority:    `https://login.microsoftonline.com/${cfg.tenantId}`,
    },
    system: {
      loggerOptions: {
        loggerCallback: (level, message) => {
          if (level <= msal.LogLevel.Warning) {
            strapi.log.info(`[MSAL] ${message}`);
          }
        },
        piiLoggingEnabled: false,
        logLevel: msal.LogLevel.Warning,
      },
    },
  });

  strapi.msalConfig = {
    redirectUri: cfg.callbackUrl,
    scopes: ['openid', 'profile', 'email', 'User.Read'],
  };

  strapi.log.info('[strapi-admin-entra-sso] Microsoft Entra SSO initialised');
};
