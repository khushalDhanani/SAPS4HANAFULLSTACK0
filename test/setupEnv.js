const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

const localEnv = path.resolve(__dirname, '../.env.local');
if (fs.existsSync(localEnv)) {
  dotenv.config({ path: localEnv });
}
dotenv.config();
