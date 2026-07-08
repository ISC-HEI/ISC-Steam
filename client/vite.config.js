import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The dev server proxies /api to the Express server so the client
// can use relative URLs in both development and production.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:5174',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://localhost:5174',
        ws: true,
      },
    },
  },
});
