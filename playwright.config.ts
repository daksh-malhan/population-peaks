import { defineConfig, devices } from '@playwright/test';

const port = 4173;
const baseURL = `http://localhost:${port}/population-peaks/`;

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL, trace: 'retain-on-failure' },
  webServer: {
    command: `npm run build:fixture && npm run preview -- --port ${port} --strictPort`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], launchOptions: { args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] } },
    },
    {
      name: 'mobile',
      use: { ...devices['Pixel 7'], launchOptions: { args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] } },
    },
  ],
});
