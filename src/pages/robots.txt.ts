import { url } from '../lib/utils';

export function GET({ site }: { site: URL }) {
  return new Response(`User-agent: *\nAllow: /\nDisallow: ${url('/admin/')}\n\nSitemap: ${new URL(url('/sitemap.xml'), site).href}\n`);
}
