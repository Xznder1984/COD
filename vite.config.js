import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: 3000,
  },
  build: {
    target: 'esnext',
    rollupOptions: {
      output: {
        // Three is ~85% of the bundle and changes far less often than game code,
        // so it gets its own chunk and stays cached across app updates.
        manualChunks: {
          three: ['three'],
        },
      },
    },
    // Three alone is unavoidably large; this only raises the advisory threshold.
    chunkSizeWarningLimit: 700,
  },
});