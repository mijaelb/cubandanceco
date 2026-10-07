import { url } from '../lib/utils';

// The admin is not mentioned here on purpose (its page carries a noindex tag instead).
export function GET({ site }: { site: URL }) {
  return new Response(`User-agent: *\nAllow: /\n\nSitemap: ${new URL(url('/sitemap.xml'), site).href}\n`);
}
