import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { testimonialsNoindex } from './src/content/testimonials.ts';

// Static output, zero framework JS (D3). Sitemap is configured further in 50.13.
export default defineConfig({
  site: 'https://schoolmanagerp.com',
  output: 'static',
  trailingSlash: 'always',
  integrations: [sitemap({ filter: (page) => !(testimonialsNoindex() && page.includes('/testimonials/')) })],
  i18n: { defaultLocale: 'bn', locales: ['bn', 'en'], routing: { prefixDefaultLocale: true } },
  build: { inlineStylesheets: 'always' },
  redirects: { '/': '/bn/' },
});
