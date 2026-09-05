module.exports = {
  testEnvironment: 'node',
  testTimeout: 15000,
  verbose: true,
  testMatch: [
    '**/test/unit/**/*.test.js',
    '**/test/integration/**/*.test.js',
    '**/test/e2e/**/*.test.js'
  ]
};
