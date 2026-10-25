// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://isyuricunha.github.io',
  base: '/top-github-users',
  output: 'static',
  trailingSlash: 'never',
  integrations: [
    sitemap({
      // Internal links never carry a trailing slash; keep sitemap locs aligned.
      serialize(item) {
        return { ...item, url: item.url.replace(/\/$/, '') }
      },
    }),
  ],
});
