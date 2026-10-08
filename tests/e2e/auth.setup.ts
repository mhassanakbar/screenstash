import { config } from 'dotenv';
import { clerkSetup } from '@clerk/testing/playwright';

export default async function setup() {
  config({ path: 'apps/api/.env', quiet: true });
  config({ path: 'apps/web/.env', quiet: true });
  const secretKey = process.env.CLERK_SECRET_KEY;
  const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  if (
    !secretKey?.startsWith('sk_test_') ||
    !publishableKey?.startsWith('pk_test_')
  )
    throw new Error(
      'Browser authentication tests require development Clerk keys.',
    );
  await clerkSetup({ secretKey, publishableKey, dotenv: false });
}
