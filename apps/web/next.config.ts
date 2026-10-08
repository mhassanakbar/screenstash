import type { NextConfig } from 'next';

const apiOrigin = process.env.EXPRESS_API_ORIGIN ?? 'http://127.0.0.1:4000';
const parsedOrigin = new URL(apiOrigin);
if (
  !['http:', 'https:'].includes(parsedOrigin.protocol) ||
  parsedOrigin.pathname !== '/' ||
  parsedOrigin.search ||
  parsedOrigin.hash ||
  parsedOrigin.username ||
  parsedOrigin.password
) {
  throw new Error(
    'EXPRESS_API_ORIGIN must be an HTTP(S) origin without a path or credentials',
  );
}
const config: NextConfig = {
  htmlLimitedBots: /.*/,
  async rewrites() {
    return {
      beforeFiles: [
        {
          source: '/api/:path*',
          destination: `${parsedOrigin.origin}/api/:path*`,
        },
        {
          source: '/s/:token/image',
          destination: `${parsedOrigin.origin}/s/:token/image`,
        },
        {
          source: '/s/:token/preview.jpg',
          destination: `${parsedOrigin.origin}/s/:token/preview.jpg`,
        },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
};
export default config;
