/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The browser run starts its own copy beside a developer's, on another port and API.
const port = Number(process.env.SLOP_WEB_PORT ?? 5173);
const apiUrl = process.env.SLOP_API_URL ?? 'http://127.0.0.1:3000';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port,
    strictPort: true,
    proxy: {
      '/api': {
        target: apiUrl,
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
