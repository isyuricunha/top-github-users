// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://isyuricunha.github.io',
  base: '/top-github-users',
  output: 'static',
  trailingSlash: 'never',
  integrations: [sitemap()],
});
