// Sitemap with every page in every language (and hreflang alternates).
import { LANGS } from '../i18n';
import { link } from '../lib/utils';

const PAGES = ['', 'trainings', 'raices-cubanas', 'about', 'company', 'gallery', 'faq'];

export function GET({ site }: { site: URL }) {
  const abs = (lang: string, page: string) => new URL(link(lang, page), site).href;
  const urls = PAGES.flatMap((page) => LANGS.map((lang) => `  <url><loc>${abs(lang, page)}</loc>${LANGS.map((l) => `<xhtml:link rel="alternate" hreflang="${l}" href="${abs(l, page)}"/>`).join('')}</url>`));
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join('\n')}\n</urlset>\n`;
  return new Response(xml, { headers: { 'Content-Type': 'application/xml' } });
}
