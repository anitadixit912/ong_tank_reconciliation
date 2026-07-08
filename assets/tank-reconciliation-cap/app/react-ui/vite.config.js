import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // In dev mode, proxy API calls to the local CAP server
      '/reconciliation': {
        target: 'http://localhost:4004',
        changeOrigin: true,
        secure: false
      }
    }
  },
  build: {
    outDir: '../../app/dist',
    emptyOutDir: true
  }
});
