# strapi-admin-entra-sso

Microsoft Entra ID (Azure AD) Single Sign-On for the **Strapi v5** admin panel.

- No Strapi Enterprise licence required
- Implements OAuth 2.0 Authorization Code Flow with PKCE
- Automatically creates or updates admin users on first login
- Maps Azure app roles to Strapi admin roles
- Adds a **"Sign in with Microsoft"** button to the admin login page

---

## Requirements

- Strapi v5.0.0 or later
- Node.js 18+
- An Azure app registration (see setup below)

---

## Installation

```bash
npm install strapi-admin-entra-sso
```

---

## Configuration

### 1. `config/plugins.js`

```js
module.exports = ({ env }) => ({
  // ... your other plugins

  'strapi-admin-entra-sso': {
    enabled: true,
    config: {
      clientId:     env('AZURE_CLIENT_ID',    ''),
      clientSecret: env('AZURE_CLIENT_SECRET',''),
      tenantId:     env('AZURE_TENANT_ID',    ''),
      callbackUrl:  env('AZURE_CALLBACK_URL', 'http://localhost:1337/api/sso/callback'),

      // Map Azure app roles → Strapi admin role names
      roleMapping: {
        'cms-admin':     'Admin',
        'cms-publisher': 'Publisher',
        'cms-editor':    'Editor',
        'cms-viewer':    'Viewer',
      },

      // Fallback role if the user has no matching Azure role
      defaultRole: 'Author',
    },
  },
});
```

> **Local development:** If you are using the plugin from a local path instead of npm,
> add `resolve: '/absolute/path/to/strapi-admin-entra-sso'` to the config block above.

### 2. `.env`

```env
AZURE_TENANT_ID=your-azure-tenant-id
AZURE_CLIENT_ID=your-app-registration-client-id
AZURE_CLIENT_SECRET=your-client-secret-value
AZURE_CALLBACK_URL=http://localhost:1337/api/sso/callback
```

### 3. Rebuild the admin panel

The plugin injects a "Sign in with Microsoft" button into the admin login page. This
requires a one-time admin panel build:

```bash
npm run build
```

---

## Azure app registration setup

1. Go to **Azure Portal → Entra ID → App registrations → New registration**
2. Set the redirect URI to:
   - `http://localhost:1337/api/sso/callback` (development)
   - `https://your-domain.com/api/sso/callback` (production)
3. Under **Certificates & secrets**, create a new client secret and copy the value
4. Under **Token configuration**, add an optional claim:
   - Token type: **ID**
   - Claim: **email**
5. Under **App roles**, create roles that match your `roleMapping` keys, e.g.:
   - `cms-admin`, `cms-publisher`, `cms-editor`, `cms-viewer`
6. Assign these roles to users (or groups) in **Enterprise applications → Users and groups**

---

## How it works

1. User visits `/admin/auth/login` and clicks **"Sign in with Microsoft"**
2. Browser is redirected to `GET /api/sso/login` which builds a PKCE-protected
   Microsoft authorization URL and redirects the user to Microsoft login
3. After successful Microsoft login, Microsoft calls `GET /api/sso/callback`
4. The plugin exchanges the auth code for an ID token, decodes the user's email and
   Azure roles, then creates or updates the Strapi admin user
5. A Strapi v5 session (refresh + access tokens) is created via `sessionManager`
6. An HTML response sets the session cookies and localStorage keys, then redirects
   to `/admin`

---

## Role mapping (optional)

`roleMapping` and `defaultRole` are both **optional**. The plugin resolves the
Strapi admin role using this priority order:

| Priority | Source | Behaviour |
|----------|--------|-----------|
| 1 | `roleMapping` | Matches the user's Azure app roles against the map keys. First match wins. |
| 2 | `defaultRole` | Used when no Azure role matches (or `roleMapping` is not set). |
| 3 | Auto-fallback | If neither produces a match, the **first role that exists in Strapi** is assigned automatically. |

This means the plugin works out of the box with **zero role config** — every
Microsoft user will simply get the first available Strapi admin role.

To restrict access by Azure role, configure `roleMapping` in `config/plugins.js`
and create the matching App roles in Azure Portal:

```js
roleMapping: {
  'cms-admin':     'Admin',
  'cms-publisher': 'Publisher',
  'cms-editor':    'Editor',
  'cms-viewer':    'Viewer',
},
defaultRole: 'Author',   // users with no matching Azure role get this
```

Example: a user with Azure role `cms-editor` gets the Strapi `Editor` role.

---

## Login button

After `npm run build`, the plugin injects a "Sign in with Microsoft" button at the
bottom of the Strapi admin login form via `app.injectComponent('Auth', 'bottom', ...)`.

If the button does not appear (e.g. due to a Strapi version difference), you can
trigger the login flow directly:

```
https://your-strapi-url/api/sso/login
```

---

## License

MIT
