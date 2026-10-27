import { UserProfile } from '@clerk/nextjs';
export default function AccountPage() {
  return (
    <section className="account-page">
      <div className="vault-heading mb-8">
        <div>
          <p className="eyebrow">Workspace settings</p>
          <h1>Account</h1>
          <p>Manage your profile and sign-in details.</p>
        </div>
      </div>
      <UserProfile routing="hash" />
    </section>
  );
}
