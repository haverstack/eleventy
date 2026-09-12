/**
 * @haverstack/eleventy — built-in templates
 * -------------------------------------------------------
 * A minimal default set so a stack builds a legible site with no template
 * work. They render complete HTML documents; a site that brings its own
 * templates replaces them (see the plugin's `templates` option). Kept
 * deliberately small and lightly styled — hard-to-override defaults are
 * worse than none.
 */

import type { RecordId, StackRecord } from '@haverstack/core';
import { PHOTO } from '@haverstack/commons';
import type { AssetPlan } from './assets.js';
import type { FeedSpec } from './feeds.js';
import type { ResolvedMember, ResolvedMenu, ResolvedPage, ResolvedSite } from './resolve.js';
import { stripTrailingSlashes } from './url.js';

const baseId = (typeId: string): string => typeId.split('@')[0];

const esc = (s: unknown): string =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const CSS = `
:root{--fg:#1a1a1a;--muted:#666;--accent:#0b5;--bg:#fff}
@media(prefers-color-scheme:dark){:root{--fg:#e8e8e8;--muted:#999;--accent:#3d9;--bg:#161616}}
*{box-sizing:border-box}
body{color:var(--fg);background:var(--bg);font:16px/1.6 system-ui,sans-serif;margin:0}
.wrap{max-width:42rem;margin:0 auto;padding:2rem 1rem}
header.site{display:flex;gap:1rem;align-items:baseline;flex-wrap:wrap;border-bottom:1px solid #8884;padding-bottom:1rem;margin-bottom:2rem}
header.site .title{font-weight:700;text-decoration:none;color:inherit}
nav a{margin-right:.75rem;color:var(--muted);text-decoration:none}
nav a:hover{color:var(--accent)}
main :is(h1,h2){line-height:1.25}
time{color:var(--muted);font-size:.9rem}
ul.listing{list-style:none;padding:0}
ul.listing li{margin:.75rem 0}
ul.listing a{font-weight:600;text-decoration:none;color:inherit}
ul.listing a:hover{color:var(--accent)}
img{max-width:100%;height:auto}
pre{overflow-x:auto;padding:1rem;background:#8881;border-radius:6px}
footer.site{border-top:1px solid #8884;margin-top:3rem;padding-top:1rem;color:var(--muted);font-size:.9rem}
`.trim();

function menuHtml(menu: ResolvedMenu | undefined): string {
  if (!menu || menu.items.length === 0) return '';
  const links = menu.items
    .map(
      (item) =>
        `<a href="${esc(item.url)}"${item.rel ? ` rel="${esc(item.rel)}"` : ''}>${esc(item.label)}</a>`,
    )
    .join('');
  return `<nav aria-label="${esc(menu.handle)}">${links}</nav>`;
}

function documentShell(opts: {
  title: string;
  resolved: ResolvedSite;
  feeds: FeedSpec[];
  canonical?: string | null;
  main: string;
}): string {
  const { resolved } = opts;
  const siteTitle = resolved.site ? String(resolved.site.content.title ?? '') : '';
  const description = resolved.site?.content.description;
  const baseUrl = stripTrailingSlashes(String(resolved.site?.content.baseUrl ?? ''));
  const fullTitle = [opts.title, siteTitle].filter(Boolean).join(' · ') || 'Site';

  const feedLinks = opts.feeds
    .map(
      (f) =>
        `<link rel="alternate" type="application/atom+xml" title="${esc(f.title)}" href="${esc(baseUrl + f.path)}">`,
    )
    .join('');

  return (
    `<!doctype html>\n<html lang="en">\n<head>\n` +
    `<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n` +
    `<title>${esc(fullTitle)}</title>\n` +
    (typeof description === 'string' && description
      ? `<meta name="description" content="${esc(description)}">\n`
      : '') +
    (opts.canonical ? `<link rel="canonical" href="${esc(opts.canonical)}">\n` : '') +
    `${feedLinks}\n<style>${CSS}</style>\n</head>\n<body>\n<div class="wrap">\n` +
    `<header class="site"><a class="title" href="/">${esc(siteTitle || 'Home')}</a>${menuHtml(resolved.menus.get('top-nav'))}</header>\n` +
    `<main>\n${opts.main}\n</main>\n` +
    `<footer class="site">${menuHtml(resolved.menus.get('social'))}` +
    (resolved.owner?.content.name ? `<p>© ${esc(resolved.owner.content.name)}</p>` : '') +
    `</footer>\n</div>\n</body>\n</html>\n`
  );
}

function publishedTime(record: StackRecord): string {
  const publishedAt = record.content.publishedAt;
  if (typeof publishedAt !== 'string') return '';
  const date = new Date(publishedAt);
  if (Number.isNaN(date.getTime())) return '';
  return `<time datetime="${esc(publishedAt)}">${date.toISOString().slice(0, 10)}</time>`;
}

export interface RenderContext {
  resolved: ResolvedSite;
  assets: AssetPlan;
  feeds: FeedSpec[];
  /** recordId → rendered body HTML, for every built page and member. */
  bodyByRecord: Map<RecordId, string>;
}

function contentMain(title: unknown, body: string): string {
  const heading = title ? `<h1>${esc(title)}</h1>\n` : '';
  return `<article>\n${heading}${body}\n</article>`;
}

function listingMain(page: ResolvedPage, body: string, ctx: RenderContext): string {
  const collection = ctx.resolved.collections.get(String(page.record.content.slug));
  const items = (collection?.members ?? [])
    .map((m) => {
      const label = esc(m.record.content.title ?? m.record.content.caption ?? m.record.id);
      return `<li><a href="${esc(m.url)}">${label}</a> ${publishedTime(m.record)}</li>`;
    })
    .join('\n');
  return `<article>\n${body}\n<ul class="listing">\n${items}\n</ul>\n</article>`;
}

function listingInlineMain(page: ResolvedPage, body: string, ctx: RenderContext): string {
  const collection = ctx.resolved.collections.get(String(page.record.content.slug));
  const entries = (collection?.members ?? [])
    .map((m) => {
      const title = m.record.content.title;
      const heading = title ? `<h2><a href="${esc(m.url)}">${esc(title)}</a></h2>\n` : '';
      return `<article>\n${heading}${publishedTime(m.record)}\n${ctx.bodyByRecord.get(m.record.id) ?? ''}\n</article>`;
    })
    .join('\n');
  return `<div class="intro">\n${body}\n</div>\n${entries}`;
}

function memberMain(member: ResolvedMember, body: string, ctx: RenderContext): string {
  const record = member.record;
  if (baseId(record.typeId) === baseId(PHOTO.id)) {
    const staged = ctx.assets.files.get(String(record.content.image));
    const img = staged
      ? `<img src="${esc(staged.assetPath)}" alt="${esc(record.content.alt ?? '')}">`
      : '';
    const caption = record.content.caption
      ? `<figcaption>${esc(record.content.caption)}</figcaption>`
      : '';
    return `<figure>\n${img}\n${caption}\n</figure>\n${body}`;
  }

  const title = record.content.title;
  const linkOut =
    typeof record.content.url === 'string' && !member.canonical
      ? ''
      : member.canonical
        ? `<p><a href="${esc(member.canonical)}">Originally published elsewhere ↗</a></p>`
        : '';
  const heading =
    typeof record.content.url === 'string' && title && !member.canonical
      ? `<h1><a href="${esc(record.content.url)}">${esc(title)}</a></h1>\n`
      : title
        ? `<h1>${esc(title)}</h1>\n`
        : '';
  return `<article>\n${heading}${publishedTime(record)}\n${body}\n${linkOut}\n</article>`;
}

/**
 * The inner content for a page when its `template` is mapped to a site
 * layout: the page's own rendered body, no chrome and no member list. A
 * listing layout builds its list from the `collection` in page data; this
 * is just the intro. `content`/`home` get the `<article>` wrapper.
 */
export function renderPageFragment(page: ResolvedPage, ctx: RenderContext): string {
  const body = ctx.bodyByRecord.get(page.record.id) ?? '';
  if (page.template === 'listing' || page.template === 'listing-inline') return body;
  // The home page's body usually carries its own hero heading; don't double it.
  return contentMain(page.template === 'home' ? undefined : page.record.content.title, body);
}

/** Inner content for a member — the `<article>` / `<figure>` markup, no chrome. */
export function renderMemberFragment(member: ResolvedMember, ctx: RenderContext): string {
  return memberMain(member, ctx.bodyByRecord.get(member.record.id) ?? '', ctx);
}

/** A complete HTML document for a page, using the built-in chrome. */
export function renderPage(page: ResolvedPage, ctx: RenderContext): string {
  const body = ctx.bodyByRecord.get(page.record.id) ?? '';
  let main: string;
  if (page.template === 'listing') main = listingMain(page, body, ctx);
  else if (page.template === 'listing-inline') main = listingInlineMain(page, body, ctx);
  else main = contentMain(page.template === 'home' ? undefined : page.record.content.title, body);

  return documentShell({
    title: String(page.record.content.title ?? ''),
    resolved: ctx.resolved,
    feeds: ctx.feeds,
    main,
  });
}

/** A complete HTML document for a member, using the built-in chrome. */
export function renderMember(member: ResolvedMember, ctx: RenderContext): string {
  return documentShell({
    title: String(member.record.content.title ?? member.record.content.caption ?? ''),
    resolved: ctx.resolved,
    feeds: ctx.feeds,
    canonical: member.canonical,
    main: renderMemberFragment(member, ctx),
  });
}
