import { defineConfig } from 'astro/config';

// SITE_URL / BASE_PATH are provided by the GitHub Pages workflow.
// With a custom domain (cubandance.co) BASE_PATH is empty.
export default defineConfig({
  site: process.env.SITE_URL || 'https://cubandance.co',
  base: process.env.BASE_PATH || '/',
  trailingSlash: 'ignore',
  // Styles go inside each page: every deploy renames the stylesheet and removes the old one,
  // so a page restored from the browser cache after a deploy would otherwise load unstyled.
  build: { format: 'directory', inlineStylesheets: 'always' },
  // Old WordPress addresses (cubandance.co before 2026) still linked from Google and social media
  redirects: {
    '/company-members': '/company/',
    '/musicians': '/company/#musicians',
    '/upcoming-shows': '/performances/',
    '/upcoming-training-dates': '/trainings/',
    '/2023/06/06/hello-world-2': '/es/faq/',
  },
});
