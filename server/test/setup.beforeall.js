/**
 * Minimal test setup with beforeAll hook
 */
const { join } = require('path');
const dotenv = require('dotenv');

console.log('  [setup] Starting...');

try {
  dotenv.config({ path: join(__dirname, '..', '.env.test') });
  console.log('  [setup] dotenv config done');
} catch (e) {
  console.log('  [setup] dotenv error:', e.message);
}

// Test with beforeAll hook
beforeAll(async () => {
  console.log('  [setup-beforeAll] Running beforeAll hook...');
  console.log('  [setup-beforeAll] Done');
}, 60000);

afterAll(async () => {
  console.log('  [setup-afterAll] Running afterAll hook...');
}, 30000);

beforeEach(async () => {
  console.log('  [setup-beforeEach] Running beforeEach hook...');
}, 30000);

console.log('  [setup] Done');