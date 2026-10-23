import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests', testMatch: '*.spec.js', fullyParallel: false, workers: 1,
  use: { headless: true, viewport: { width: 1000, height: 800 }, launchOptions: { executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' } },
  reporter: 'list'
});
