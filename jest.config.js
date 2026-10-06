module.exports = {
  testEnvironment: 'node',
  testTimeout: 60000,
  verbose: true,
  testMatch: [
    '**/test/unit/**/*.test.js',
    '**/test/integration/**/*.test.js',
    '**/test/e2e/**/*.test.js'
  ],
  setupFiles: ['<rootDir>/test/setupEnv.js']
};
