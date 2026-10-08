import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  globalSetup: './tests/e2e/auth.setup.ts',
  fullyParallel: false,
  use: { baseURL: 'http://localhost:3000', trace: 'retain-on-failure' },
  webServer: [
    {
      command: 'node apps/api/dist/server.js',
      url: 'http://127.0.0.1:4000/api/health',
      reuseExistingServer: false,
      env: { PORT: '4000' },
    },
    {
      command:
        'pnpm --filter @screenstash/web start --hostname localhost --port 3000',
      url: 'http://localhost:3000',
      reuseExistingServer: false,
    },
  ],
});
