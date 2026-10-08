import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'development-csp',
      apply: 'serve',
      transformIndexHtml(html) {
        // Vite's React refresh preamble is inline only during development.
        return html.replace(
          "script-src 'self';",
          "script-src 'self' 'unsafe-inline';",
        );
      },
    },
  ],
});
