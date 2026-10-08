import { UserProfile } from '@clerk/nextjs';
export default function AccountPage() {
  return (
    <section>
      <h1 className="mb-8 text-3xl font-semibold tracking-tight">Account</h1>
      <UserProfile routing="hash" />
    </section>
  );
}
