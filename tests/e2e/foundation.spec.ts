import { test, expect } from '@playwright/test';
test('web renders and API proxy preserves JSON and cache policy', async ({
  page,
  request,
}) => {
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Save the moment. Find the detail.' }),
  ).toBeVisible();
  const response = await request.get('/api/health');
  expect(response.status()).toBe(200);
  expect(response.headers()['cache-control']).toBe('no-store');
  expect(await response.json()).toEqual({
    status: 'ok',
    service: 'screenstash-api',
  });
});
