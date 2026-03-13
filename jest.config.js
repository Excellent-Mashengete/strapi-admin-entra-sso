'use strict';

/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  
  collectCoverageFrom: [
    'strapi-server.js',
    'server/bootstrap.js',
    'server/controllers/sso.js',
  ],

  coverageThreshold: {
    global: {
      branches:   60,
      functions:  80,
      lines:      80,
      statements: 80,
    },
  },

  testMatch: ['**/__tests__/**/*.test.js'],

  verbose: true,
};
