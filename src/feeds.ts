/**
 * @haverstack/eleventy — feeds and the sitemap
 * -------------------------------------------------------
 * Output, not records: renderings of the collections the page tree already
 * describes, one set per site. A feed per listing root plus a combined
 * one; the sitemap is every resolved permalink minus the unlisted ones.
 * Absolute URLs come from the site record's `baseUrl`, so these need a
 * site record — a single-site stack with none gets neither.
 *
 * See eleventy-integration.md § Feeds and the sitemap.
 */

import type { StackRecord } from '@haverstack/core';
import type { ResolvedCollection, ResolvedMember, ResolvedPage, ResolvedSite } from './resolve.js';

const xmlEscape = (s: string): string =>
  s.replace(
    /[<>&'"]/g,
    (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c] as string,
  );

const absolute = (baseUrl: string, path: string): string =>
  `${baseUrl.replace(/\/+$/, '')}${path.startsWith('/') ? path : `/${path}`}`;

function memberDate(record: StackRecord): string {
  const publishedAt = record.content.publishedAt;
  const ms = typeof publishedAt === 'string' ? Date.parse(publishedAt) : NaN;
  return new Date(Number.isNaN(ms) ? record.createdAt.getTime() : ms).toISOString();
}

const memberTitle = (record: StackRecord): string =>
  String(record.content.title ?? record.content.caption ?? record.content.text ?? record.id).slice(
    0,
    200,
  );

export interface FeedSpec {
  /** Output path, e.g. `/feeds/articles.xml`. */
  path: string;
  /** Feed `<title>`. */
  title: string;
  members: ResolvedMember[];
}

/** One Atom feed per listing root, plus a combined `/feeds/all.xml`. */
export function feedSpecs(resolved: ResolvedSite): FeedSpec[] {
  if (!resolved.site) return [];
  const siteTitle = String(resolved.site.content.title ?? 'Feed');
  const specs: FeedSpec[] = [];
  const seen = new Set<string>();
  const combined: ResolvedMember[] = [];

  for (const [slug, collection] of resolved.collections as Map<string, ResolvedCollection>) {
    specs.push({
      path: `/feeds/${slug}.xml`,
      title: `${siteTitle} — ${slug}`,
      members: collection.members,
    });
    for (const member of collection.members) {
      if (seen.has(member.record.id)) continue;
      seen.add(member.record.id);
      combined.push(member);
    }
  }

  if (specs.length > 1) {
    combined.sort((a, b) => memberDate(b.record).localeCompare(memberDate(a.record)));
    specs.push({ path: '/feeds/all.xml', title: siteTitle, members: combined });
  }
  return specs;
}

export function atomFeed(spec: FeedSpec, resolved: ResolvedSite, limit: number): string {
  const site = resolved.site!;
  const baseUrl = String(site.content.baseUrl ?? '');
  const self = absolute(baseUrl, spec.path);
  const updated =
    spec.members.length > 0 ? memberDate(spec.members[0].record) : new Date().toISOString();
  const author = resolved.owner?.content.name;

  const entries = spec.members
    .slice(0, limit)
    .map((member) => {
      const link = member.canonical ?? absolute(baseUrl, member.url);
      const summary = member.record.content.summary;
      return (
        `  <entry>\n` +
        `    <title>${xmlEscape(memberTitle(member.record))}</title>\n` +
        `    <link href="${xmlEscape(link)}"/>\n` +
        `    <id>${xmlEscape(link)}</id>\n` +
        `    <updated>${memberDate(member.record)}</updated>\n` +
        (typeof summary === 'string' && summary
          ? `    <summary>${xmlEscape(summary)}</summary>\n`
          : '') +
        `  </entry>`
      );
    })
    .join('\n');

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<feed xmlns="http://www.w3.org/2005/Atom">\n` +
    `  <title>${xmlEscape(spec.title)}</title>\n` +
    `  <link href="${xmlEscape(absolute(baseUrl, '/'))}"/>\n` +
    `  <link rel="self" href="${xmlEscape(self)}"/>\n` +
    `  <id>${xmlEscape(self)}</id>\n` +
    `  <updated>${updated}</updated>\n` +
    (typeof author === 'string' && author
      ? `  <author><name>${xmlEscape(author)}</name></author>\n`
      : '') +
    `${entries}${entries ? '\n' : ''}` +
    `</feed>\n`
  );
}

export function sitemapXml(resolved: ResolvedSite): string | null {
  if (!resolved.site) return null;
  const baseUrl = String(resolved.site.content.baseUrl ?? '');
  const locs: string[] = [];
  const walk = (pages: ResolvedPage[]): void => {
    for (const page of pages) {
      if (!page.unlisted) locs.push(absolute(baseUrl, page.url));
      walk(page.children);
    }
  };
  walk(resolved.pages);
  for (const member of resolved.members) {
    if (!member.unlisted) locs.push(absolute(baseUrl, member.url));
  }

  const body = locs.map((loc) => `  <url><loc>${xmlEscape(loc)}</loc></url>`).join('\n');
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`
  );
}
