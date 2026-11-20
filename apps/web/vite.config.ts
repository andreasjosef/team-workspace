/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '../..', '');
  return {
    envDir: '../..',
    plugins: [react()],
    server: {
      port: Number(env.WEB_PORT ?? 5173),
      // Same origin as production: the browser only ever calls /api here,
      // WebSocket included.
      proxy: {
        '/api': {
          target: `http://127.0.0.1:${env.API_PORT ?? 3000}`,
          ws: true,
        },
      },
    },
    test: { environment: 'node', globals: false },
  };
});
