import { defineConfig, devices } from '@playwright/test';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: path.resolve(__dirname, '.env.test') });

export default defineConfig({
  testDir: './specs',
  timeout: 30_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,       // orden importa en flujos con estado compartido
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : 1,

  reporter: [
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['junit', { outputFile: 'test-results/junit.xml' }],
    ['list'],
  ],

  use: {
    baseURL:           process.env.APP_URL || 'http://localhost:3000',
    trace:             'on-first-retry',
    screenshot:        'only-on-failure',
    video:             'retain-on-failure',
    locale:            'es-CO',
    timezoneId:        'America/Bogota',
    actionTimeout:     10_000,
    navigationTimeout: 15_000,
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox',  use: { ...devices['Desktop Firefox'] } },
    { name: 'mobile',   use: { ...devices['Pixel 5'] } },
  ],

  webServer: {
    command:             'node staging-server.js',
    url:                 process.env.APP_URL || 'http://localhost:3000',
    reuseExistingServer: true,
    timeout:             15_000,
    cwd:                 __dirname,
  },
});
