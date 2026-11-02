/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3000',
        rewrite: (path) => path.replace(/^\/api/, ''),
        // Without this, the browser isn't told when the server dies, and a status stream waits
        // for its dead-connection check instead of reconnecting straight away.
        configure: (proxy) => {
          proxy.on('proxyRes', (upstream, _request, response) => {
            upstream.on('close', () => {
              if (!response.writableEnded) response.destroy();
            });
          });
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.{ts,tsx}'],
    setupFiles: ['test/setup.ts'],
  },
});
