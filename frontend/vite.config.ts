import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // API на том же origin — refresh-cookie (SameSite=Strict) работает без CORS
    proxy: { '/api': 'http://localhost:3000' },
  },
});
