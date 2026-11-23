module.exports = {
  testEnvironment: 'node',
  testTimeout: 60000,
  verbose: true,
  testMatch: [
    '**/test/unit/**/*.test.js',
    '**/test/integration/**/*.test.js',
    '**/test/performance/**/*.test.js',
    '**/test/a11y/**/*.test.js',
    '**/test/smoke/**/*.test.js'
  ],
  setupFiles: ['<rootDir>/test/setupEnv.js'],
  moduleNameMapper: {
    '^node-rfc$': '<rootDir>/test/mocks/node-rfc.js'
  },
  // All first-party server code. srv/external holds only generated service models (.cds/.csn/.edmx).
  collectCoverageFrom: [
    'server.js',
    'srv/**/*.js',
    '!srv/external/**',
    '!**/node_modules/**'
  ],
  coverageReporters: ['text', 'lcov', 'json-summary', 'clover'],
  // Floors sit about two points under the values measured on 2026-11-23, so a real drop
  // fails CI and normal churn does not. Raise them when coverage rises; never lower one to make a build pass.
  // A directory key is checked on the files under it taken together, and those files leave `global`.
  coverageThreshold: {
    // Everything not named below. Measured: statements 89.03, branches 80.30, functions 85.71, lines 90.51.
    global: {
      statements: 87,
      branches: 78,
      functions: 83,
      lines: 88
    },
    // S/4HANA adapters and clients. Measured: statements 92.28, branches 77.07, functions 97.96, lines 93.36.
    './srv/integration/s4hana/': {
      statements: 90,
      branches: 75,
      functions: 96,
      lines: 91
    },
    // Path prefix: srv/auth/ and srv/auth-service.js. Measured: statements 89.38, branches 83.58, functions 88.88, lines 92.02.
    './srv/auth': {
      statements: 87,
      branches: 81,
      functions: 85,
      lines: 90
    },
    './srv/common/productionGuard.js': {
      branches: 70,
      functions: 100,
      lines: 90,
      statements: 80
    }
  }
};
