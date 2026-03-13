import React from 'react';

const MicrosoftLoginButton = () => {
  const loginUrl = `${window.location.origin}/api/sso/login`;

  return (
    <a
      href={loginUrl}
      style={{
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'center',
        gap:            '10px',
        marginTop:      '16px',
        padding:        '10px 16px',
        border:         '1px solid #d1d5db',
        borderRadius:   '4px',
        textDecoration: 'none',
        color:          '#374151',
        fontWeight:     500,
        fontSize:       '14px',
        background:     '#ffffff',
        cursor:         'pointer',
      }}
    >
      {/* Microsoft logo SVG */}
      <svg width="20" height="20" viewBox="0 0 21 21" xmlns="http://www.w3.org/2000/svg">
        <rect x="1"  y="1"  width="9" height="9" fill="#F25022" />
        <rect x="11" y="1"  width="9" height="9" fill="#7FBA00" />
        <rect x="1"  y="11" width="9" height="9" fill="#00A4EF" />
        <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
      </svg>
      Sign in with Microsoft
    </a>
  );
};

export default {
  register() {},

  bootstrap(app) {
    app.injectComponent('Auth', 'bottom', {
      name:      'microsoft-entra-sso-button',
      Component: MicrosoftLoginButton,
    });
  },
};
