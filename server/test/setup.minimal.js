/**
 * Minimal test setup for debugging
 */
const { join } = require('path');

console.log('  [setup] Starting...');

try {
  const dotenv = require('dotenv');
  console.log('  [setup] dotenv loaded');
  dotenv.config({ path: join(__dirname, '..', '.env.test') });
  console.log('  [setup] dotenv config done');
} catch (e) {
  console.log('  [setup] dotenv error:', e.message);
}

try {
  const typeorm = require('typeorm');
  console.log('  [setup] typeorm loaded, keys:', Object.keys(typeorm).slice(0, 5));
} catch (e) {
  console.log('  [setup] typeorm error:', e.message);
}

console.log('  [setup] Done');