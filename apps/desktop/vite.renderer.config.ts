import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
export default defineConfig({
  server: { host: 'localhost', port: 5173, strictPort: true },
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        region: path.resolve(__dirname, 'region.html'),
      },
    },
  },
});
