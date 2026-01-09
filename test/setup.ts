import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Set up test environment variables
const TEST_DIR = path.join(os.tmpdir(), 'deliberate-test-' + Date.now());

process.env.DELIBERATE_TEST_MODE = '1';
process.env.DELIBERATE_TEST_DIR = TEST_DIR;

// Create test directory
beforeAll(() => {
  fs.mkdirSync(TEST_DIR, { recursive: true });
  fs.mkdirSync(path.join(TEST_DIR, 'sandbox'), { recursive: true });
});

// Clean up after all tests
afterAll(() => {
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  }
});