import { resolve } from 'path';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: '/admin/',
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      '@beton-boi/shared': resolve(__dirname, '../shared/src'),
      '@beton-boi/ui/components': resolve(__dirname, '../ui/src/components/index.ts'),
      '@beton-boi/ui/shells': resolve(__dirname, '../ui/src/shells/index.ts'),
      '@beton-boi/ui/hooks': resolve(__dirname, '../ui/src/hooks/index.ts'),
      '@beton-boi/ui/utils': resolve(__dirname, '../ui/src/utils/index.ts'),
      '@beton-boi/ui/i18n': resolve(__dirname, '../ui/src/i18n/index.ts'),
      '@beton-boi/ui/api': resolve(__dirname, '../ui/src/api/index.ts'),
      '@beton-boi/ui/test': resolve(__dirname, '../ui/src/test/index.ts'),
      '@beton-boi/ui/mocks': resolve(__dirname, '../ui/src/test/msw/enable-mocking.ts'),
      '@beton-boi/ui/styles': resolve(__dirname, '../ui/src/styles/globals.css'),
      '@beton-boi/ui/tailwind': resolve(__dirname, '../ui/tailwind.preset.ts'),
      '@beton-boi/ui': resolve(__dirname, '../ui/src'),
    },
  },
  server: {
    port: 5174,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
