import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/desktop',
  testMatch: 'capture.spec.ts',
  workers: 1,
  use: { trace: 'off' },
});
