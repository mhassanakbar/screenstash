import { defineConfig } from 'vite';
export default defineConfig({
  build: {
    lib: {
      entry: 'src/main/index.ts',
      formats: ['cjs'],
      fileName: () => 'main.cjs',
    },
    // Forge ships only .vite output. Bundle runtime dependencies so the
    // packaged app does not depend on the workspace's node_modules directory.
    rollupOptions: { external: ['electron', '@clerk/electron-passkeys'] },
  },
});
