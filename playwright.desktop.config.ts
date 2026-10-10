import { defineConfig } from '@playwright/test';
import { config } from 'dotenv';
config({ path: 'apps/api/.env', override: false, quiet: true });
export default defineConfig({
  testDir: './tests/desktop',
  testMatch: '*.spec.ts',
  workers: 1,
  use: { trace: 'off' },
  webServer: {
    command: 'node apps/api/dist/server.js',
    url: 'http://127.0.0.1:4000/api/health',
    reuseExistingServer: false,
    env: {
      PORT: '4000',
      DESKTOP_AUTH_ORIGINS: 'screenstash://renderer,http://localhost:5173',
    },
  },
});
