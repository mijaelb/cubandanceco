import { defineConfig } from 'astro/config';

// SITE_URL / BASE_PATH are provided by the GitHub Pages workflow.
// With a custom domain (cubandance.co) BASE_PATH is empty.
export default defineConfig({
  site: process.env.SITE_URL || 'https://cubandance.co',
  base: process.env.BASE_PATH || '/',
  trailingSlash: 'ignore',
  build: { format: 'directory' },
});
