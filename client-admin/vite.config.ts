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
      '@biddaloy/shared': resolve(__dirname, '../shared/src'),
      '@biddaloy/ui/components': resolve(__dirname, '../ui/src/components/index.ts'),
      '@biddaloy/ui/shells': resolve(__dirname, '../ui/src/shells/index.ts'),
      '@biddaloy/ui/hooks': resolve(__dirname, '../ui/src/hooks/index.ts'),
      '@biddaloy/ui/routes': resolve(__dirname, '../ui/src/routes/index.ts'),
      '@biddaloy/ui/utils': resolve(__dirname, '../ui/src/utils/index.ts'),
      '@biddaloy/ui/i18n': resolve(__dirname, '../ui/src/i18n/index.ts'),
      '@biddaloy/ui/api': resolve(__dirname, '../ui/src/api/index.ts'),
      '@biddaloy/ui/test': resolve(__dirname, '../ui/src/test/index.ts'),
      '@biddaloy/ui/mocks': resolve(__dirname, '../ui/src/test/msw/enable-mocking.ts'),
      '@biddaloy/ui/styles': resolve(__dirname, '../ui/src/styles/globals.css'),
      '@biddaloy/ui/tailwind': resolve(__dirname, '../ui/tailwind.preset.ts'),
      '@biddaloy/ui': resolve(__dirname, '../ui/src'),
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
