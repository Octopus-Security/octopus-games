import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    proxy: {
      '/api': 'http://localhost:3013',
      '/login': 'http://localhost:3013',
      '/logout': 'http://localhost:3013',
    },
  },
  build: {
    outDir: 'dist',
  },
});
