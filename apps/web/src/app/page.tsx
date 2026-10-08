import { APP_NAME } from '@screenstash/shared';

export default function HomePage() {
  return (
    <main>
      <p className="eyebrow">Project foundation</p>
      <h1>{APP_NAME}</h1>
      <p>
        The Next.js application is ready. Capture, authentication, and gallery
        features will be added after the foundation checks pass.
      </p>
    </main>
  );
}
