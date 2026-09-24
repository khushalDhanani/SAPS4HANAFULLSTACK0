const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

// 1. Load local environment files if present
const localEnv = path.resolve(__dirname, '../.env.local');
if (fs.existsSync(localEnv)) {
  dotenv.config({ path: localEnv });
}
dotenv.config();

// 2. Safe fallbacks for headless CI environments (e.g. GitHub Actions)
// Ensures mock test execution without needing sensitive production or live backend secrets.
process.env.S4_SYSTEM_NAME = process.env.S4_SYSTEM_NAME || 'S4HANA_DEV';
process.env.S4_DESTINATION_URL = process.env.S4_DESTINATION_URL || 'http://mock-s4hana.test:8000';
process.env.S4_CLIENT = process.env.S4_CLIENT || '220';
process.env.S4_USERNAME = process.env.S4_USERNAME || 'MOCK_USER';
process.env.S4_PASSWORD = process.env.S4_PASSWORD || 'MOCK_PASSWORD';
process.env.ENABLE_DEV_TOKEN_ISSUER = process.env.ENABLE_DEV_TOKEN_ISSUER || 'true';
process.env.LOCAL_AUTH_SECRET = process.env.LOCAL_AUTH_SECRET || 'test-mock-secret-key-32-chars-long!';
