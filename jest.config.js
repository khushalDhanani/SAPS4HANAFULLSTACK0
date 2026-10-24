module.exports = {
  testEnvironment: 'node',
  testTimeout: 60000,
  verbose: true,
  testMatch: [
    '**/test/unit/**/*.test.js',
    '**/test/integration/**/*.test.js',
    '**/test/performance/**/*.test.js',
    '**/test/a11y/**/*.test.js',
    '**/test/e2e/**/*.test.js'
  ],
  setupFiles: ['<rootDir>/test/setupEnv.js'],
  moduleNameMapper: {
    '^node-rfc$': '<rootDir>/test/mocks/node-rfc.js'
  },
  collectCoverageFrom: [
    'srv/common/**/*.js',
    '!**/node_modules/**'
  ],
  coverageReporters: ['text', 'lcov', 'json-summary', 'clover'],
  coverageThreshold: {
    './srv/common/productionGuard.js': {
      branches: 70,
      functions: 100,
      lines: 90,
      statements: 80
    },
    './srv/common/wmStatus.js': {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80
    }
  }
};
