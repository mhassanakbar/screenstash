import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';

const vault = createRouteMatcher(['/vault(.*)']);
export default clerkMiddleware(
  async (auth, request) => {
    if (vault(request)) await auth.protect();
  },
  { signInUrl: '/sign-in', signUpUrl: '/sign-up' },
);
export const config = {
  matcher: ['/vault/:path*', '/sign-in/:path*', '/sign-up/:path*'],
};
