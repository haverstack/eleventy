/**
 * @haverstack/eleventy — resolve phase
 * -------------------------------------------------------
 * Turn a `StackIndex` into a site: one URL per record, the sidecar
 * cascade applied, collections filtered and sorted, menus pointed at real
 * URLs. A pure function of the index and this build's config — it runs no
 * queries.
 *
 * Fatal faults throw `HaverstackEleventyError` (the `check` command
 * catches them): two sidecars at the same scope for one record, and two
 * records resolving to the same path. Softer problems — a dangling menu
 * target, an item that names both `url` and `recordId` — are collected in
 * `warnings` and the build continues.
 *
 * See eleventy-integration.md § Resolve and site-generator-types.md.
 */

import type { RecordId, StackRecord } from '@haverstack/core';
import { ARTICLE, BOOKMARK, PAGE, PHOTO, POST } from '@haverstack/commons';
import { SITE_MEMBERSHIP_LABEL } from './types.js';
import { HaverstackEleventyError } from './errors.js';
import type { CollectionSpec, PageNode, SidecarSet, StackIndex } from './load.js';

/**
 * How this site derives a permalink for a listing member when no sidecar
 * overrides it. `'title'` slugifies the record's `title` (default);
 * `'recordId'` publishes under the opaque record id; a function lets the
 * site decide. See eleventy-integration.md § slugStrategy.
 */
export type SlugStrategy = 'title' | 'recordId' | ((record: StackRecord) => string);

export interface ResolveConfig {
  slugStrategy: SlugStrategy;
  /**
   * `true` (default): throw `HaverstackEleventyError` listing every fatal
   * fault. `false`: collect them in `ResolvedSite.errors` and resolve
   * best-effort — what the `check` command uses to report them all.
   */
  strict?: boolean;
}

/** A fault that fails a build: conflicting sidecars, or a path two records share. */
export interface ResolveError {
  kind: 'sidecar-conflict' | 'path-collision';
  message: string;
  recordIds: RecordId[];
  /** Present on a collision. */
  path?: string;
}

/** The sidecar cascade's result for one record — never a raw sidecar. */
export interface ResolvedMeta {
  slug?: string;
  template?: string;
  /** Reserved for curated collections; not read until they land. */
  order?: number;
  hidden?: boolean;
  draft?: boolean;
}

export interface ResolvedPage {
  record: StackRecord;
  /** Site-root-relative path, e.g. `/about/history/`. */
  url: string;
  meta: ResolvedMeta;
  /** Explicit `meta.template`, or inferred from the page's shape. */
  template: string;
  /** `unlistedAt` set, or the cascade set `hidden` — out of nav, feeds and the sitemap. */
  unlisted: boolean;
  children: ResolvedPage[];
}

export interface ResolvedMember {
  record: StackRecord;
  url: string;
  meta: ResolvedMeta;
  template: string;
  unlisted: boolean;
  /** `true` when `url` came from a sidecar `slug` rather than `slugStrategy`. */
  slugExplicit: boolean;
  /** The record's canonical URL when it lives on another site; else `null`. */
  canonical: string | null;
}

export interface ResolvedCollection {
  /** The listing root's slug — the key in `collections`. */
  slug: string;
  rootUrl: string;
  /** Listed members only (drafts and unlisted excluded), sorted. */
  members: ResolvedMember[];
}

export interface ResolvedMenuItem {
  label: string;
  order: number;
  /** External/absolute URL as written, or a resolved permalink. `#` when dangling. */
  url: string;
  rel?: string;
  dangling: boolean;
}

export interface ResolvedMenu {
  handle: string;
  label?: string;
  items: ResolvedMenuItem[];
}

export interface ResolveWarning {
  kind: string;
  message: string;
  recordId?: RecordId;
}

export interface ResolvedSite {
  site: StackRecord | null;
  /** Every `site@1` record by handle — for cross-site links in templates. */
  sites: Map<string, StackRecord>;
  owner: StackRecord | null;
  /** Root pages, each carrying its resolved subtree. Drafts pruned. */
  pages: ResolvedPage[];
  pagesByUrl: Map<string, ResolvedPage>;
  /** Every built member, deduped, including unlisted ones. */
  members: ResolvedMember[];
  /** By listing-root slug. */
  collections: Map<string, ResolvedCollection>;
  /** By handle. */
  menus: Map<string, ResolvedMenu>;
  /** Fatal faults, collected rather than thrown when `strict` is `false`. */
  errors: ResolveError[];
  warnings: ResolveWarning[];
}

// -------------------------------------------------------
// Type-keyed lookups — by baseId, so a future @2 still matches.
// -------------------------------------------------------

const baseId = (typeId: string): string => typeId.split('@')[0];

const MEMBER_TEMPLATE: Record<string, string> = {
  [baseId(ARTICLE.id)]: 'article',
  [baseId(POST.id)]: 'post',
  [baseId(PHOTO.id)]: 'photo',
  [baseId(BOOKMARK.id)]: 'bookmark',
};

/**
 * Types whose own draft convention is "`publishedAt` present". Others
 * build every record. A custom member type that declares its own
 * `publishedAt` is not detected here yet — it would need the registered
 * schema, which this phase deliberately does not fetch.
 */
const TYPE_HAS_PUBLISHED_AT = new Set([baseId(ARTICLE.id), baseId(PAGE.id)]);

// -------------------------------------------------------
// Small helpers
// -------------------------------------------------------

export function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function pushInto<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

function pickMeta(record: StackRecord | undefined): ResolvedMeta {
  if (!record) return {};
  const c = record.content;
  const meta: ResolvedMeta = {};
  if (typeof c.slug === 'string') meta.slug = c.slug;
  if (typeof c.template === 'string') meta.template = c.template;
  if (typeof c.order === 'number') meta.order = c.order;
  if (typeof c.hidden === 'boolean') meta.hidden = c.hidden;
  if (typeof c.draft === 'boolean') meta.draft = c.draft;
  return meta;
}

/** Collects sidecar-cascade errors; returns the merged meta best-effort (first of each scope). */
class MetaResolver {
  readonly errors: ResolveError[] = [];
  private readonly reported = new Set<RecordId>();
  constructor(private readonly index: StackIndex) {}

  resolve(recordId: RecordId): ResolvedMeta {
    const set: SidecarSet | undefined = this.index.sidecarsByParent.get(recordId);
    if (!set) return {};
    for (const [list, scope] of [
      [set.unscoped, 'with no for-site scope'],
      [set.thisSite, 'scoped to this site'],
    ] as const) {
      if (list.length > 1 && !this.reported.has(recordId)) {
        this.reported.add(recordId);
        this.errors.push({
          kind: 'sidecar-conflict',
          recordIds: [recordId, ...list.map((r) => r.id)],
          message:
            `Record ${recordId} has ${list.length} page-meta sidecars ${scope} ` +
            `(${list.map((r) => r.id).join(', ')}). Picking one silently produces a site that ` +
            `differs between runs — remove the extra.`,
        });
      }
    }
    return { ...pickMeta(set.unscoped[0]), ...pickMeta(set.thisSite[0]) };
  }
}

function isDraft(record: StackRecord, meta: ResolvedMeta): boolean {
  if (meta.draft) return true;
  return TYPE_HAS_PUBLISHED_AT.has(baseId(record.typeId)) && !record.content.publishedAt;
}

const isUnlisted = (record: StackRecord, meta: ResolvedMeta): boolean =>
  Boolean(record.unlistedAt) || meta.hidden === true;

/** Path for a page: its ancestor slugs, `index` dropped, wrapped in slashes. */
function pagePath(node: PageNode): string {
  const segments: string[] = [];
  for (let cur: PageNode | null = node; cur; cur = cur.parent) {
    const slug = cur.record.content.slug;
    if (typeof slug === 'string' && slug && slug !== 'index') segments.unshift(slug);
  }
  return segments.length ? `/${segments.join('/')}/` : '/';
}

/** Path for a page reached only through the raw record graph — a cross-site link target. */
function rawPagePath(
  index: StackIndex,
  pageId: RecordId,
): { path: string; siteId: RecordId | null } {
  const segments: string[] = [];
  const seen = new Set<RecordId>();
  let current = index.byId.get(pageId);
  while (current && baseId(current.typeId) === baseId(PAGE.id)) {
    if (seen.has(current.id)) break;
    seen.add(current.id);
    const slug = current.content.slug;
    if (typeof slug === 'string' && slug && slug !== 'index') segments.unshift(slug);
    const parentId = current.parentId;
    current = parentId ? index.byId.get(parentId) : undefined;
  }
  const siteId = current && index.sitesById.has(current.id) ? current.id : null;
  return { path: segments.length ? `/${segments.join('/')}/` : '/', siteId };
}

function memberSlug(
  record: StackRecord,
  meta: ResolvedMeta,
  config: ResolveConfig,
): { slug: string; explicit: boolean } {
  if (meta.slug) return { slug: meta.slug, explicit: true };
  const strategy = config.slugStrategy;
  if (typeof strategy === 'function')
    return { slug: strategy(record) || record.id, explicit: false };
  if (strategy === 'recordId') return { slug: record.id, explicit: false };
  const title = record.content.title;
  const fromTitle = typeof title === 'string' ? slugify(title) : '';
  return { slug: fromTitle || record.id, explicit: false };
}

function pageTemplate(node: PageNode, meta: ResolvedMeta): string {
  if (meta.template) return meta.template;
  if (node.record.content.collection) return 'listing';
  if (node.record.content.slug === 'index' && node.parent === null) return 'home';
  return 'content';
}

const memberTemplate = (record: StackRecord, meta: ResolvedMeta): string =>
  meta.template ?? MEMBER_TEMPLATE[baseId(record.typeId)] ?? 'content';

function memberCanonical(record: StackRecord, site: StackRecord | null): string | null {
  const url = record.content.url;
  if (typeof url !== 'string' || !url || !site) return null;
  const base = String(site.content.baseUrl ?? '').replace(/\/+$/, '');
  return base && url.startsWith(base) ? null : url;
}

function meaningfulDate(record: StackRecord): number {
  const publishedAt = record.content.publishedAt;
  const parsed = typeof publishedAt === 'string' ? Date.parse(publishedAt) : NaN;
  return Number.isNaN(parsed) ? record.createdAt.getTime() : parsed;
}

function sortMembers(members: ResolvedMember[], order: string | undefined): ResolvedMember[] {
  const sorted = [...members];
  if (order === 'oldest') {
    sorted.sort((a, b) => meaningfulDate(a.record) - meaningfulDate(b.record));
  } else if (order === 'title') {
    sorted.sort((a, b) =>
      String(a.record.content.title ?? '').localeCompare(String(b.record.content.title ?? '')),
    );
  } else {
    sorted.sort((a, b) => meaningfulDate(b.record) - meaningfulDate(a.record));
  }
  return sorted;
}

function siteMembership(record: StackRecord): RecordId[] {
  const out: RecordId[] = [];
  for (const a of record.associations ?? []) {
    if (
      a.kind === 'relationship' &&
      a.label === SITE_MEMBERSHIP_LABEL &&
      a.target.scope === 'record'
    ) {
      out.push(a.target.recordId);
    }
  }
  return out;
}

// -------------------------------------------------------
// resolve
// -------------------------------------------------------

export function resolve(index: StackIndex, config: ResolveConfig): ResolvedSite {
  const { site } = index;
  const warnings: ResolveWarning[] = [];
  const metaResolver = new MetaResolver(index);

  // 1. Pages — recurse the tree, dropping draft subtrees.
  const pagesById = new Map<RecordId, ResolvedPage>();
  const pages: ResolvedPage[] = [];
  const walk = (node: PageNode, parent: ResolvedPage | null): void => {
    const meta = metaResolver.resolve(node.record.id);
    if (isDraft(node.record, meta)) {
      if (node.children.length > 0) {
        warnings.push({
          kind: 'draft-page-subtree',
          recordId: node.record.id,
          message: `Page ${node.record.id} is a draft; ${node.children.length} descendant page(s) are excluded with it.`,
        });
      }
      return;
    }
    const resolvedPage: ResolvedPage = {
      record: node.record,
      url: pagePath(node),
      meta,
      template: pageTemplate(node, meta),
      unlisted: isUnlisted(node.record, meta),
      children: [],
    };
    pagesById.set(node.record.id, resolvedPage);
    if (parent) parent.children.push(resolvedPage);
    else pages.push(resolvedPage);
    for (const child of node.children) walk(child, resolvedPage);
  };
  for (const root of index.pageRoots) walk(root, null);

  // 2. Members — one ResolvedMember per record, shared across collections.
  const membersById = new Map<RecordId, ResolvedMember>();
  const collections = new Map<string, ResolvedCollection>();
  for (const [rootId, candidates] of index.membersByListingRoot) {
    const root = pagesById.get(rootId);
    if (!root) continue; // listing page was a draft
    const spec = index.pagesById.get(rootId)?.record.content.collection as
      CollectionSpec | undefined;
    const listed: ResolvedMember[] = [];
    for (const candidate of candidates) {
      const meta = metaResolver.resolve(candidate.id);
      if (isDraft(candidate, meta)) continue; // not built at all
      let member = membersById.get(candidate.id);
      if (!member) {
        const { slug, explicit } = memberSlug(candidate, meta, config);
        member = {
          record: candidate,
          url: `${root.url}${slug}/`,
          meta,
          template: memberTemplate(candidate, meta),
          unlisted: isUnlisted(candidate, meta),
          slugExplicit: explicit,
          canonical: memberCanonical(candidate, site),
        };
        membersById.set(candidate.id, member);
      }
      if (!member.unlisted) listed.push(member);
    }
    collections.set(root.record.content.slug as string, {
      slug: root.record.content.slug as string,
      rootUrl: root.url,
      members: sortMembers(listed, spec?.order),
    });
  }

  // 3. Collision detection — pages and built members, per site.
  const byUrl = new Map<string, { recordId: RecordId; kind: string; explicit: boolean }[]>();
  for (const page of pagesById.values()) {
    pushInto(byUrl, page.url, { recordId: page.record.id, kind: 'page', explicit: true });
  }
  for (const member of membersById.values()) {
    pushInto(byUrl, member.url, {
      recordId: member.record.id,
      kind: 'member',
      explicit: member.slugExplicit,
    });
  }
  const errors: ResolveError[] = [...metaResolver.errors];
  for (const [url, entries] of byUrl) {
    if (entries.length < 2) continue;
    errors.push({
      kind: 'path-collision',
      path: url,
      recordIds: entries.map((e) => e.recordId),
      message:
        `Path collision at ${url}:\n` +
        entries
          .map((e) => `  - ${e.recordId} (${e.kind}, slug ${e.explicit ? 'explicit' : 'derived'})`)
          .join('\n'),
    });
  }

  // 4. Menus — resolve every recordId to a URL.
  const resolveLink = (recordId: RecordId): string | null => {
    const localPage = pagesById.get(recordId);
    if (localPage) return localPage.url;
    const localMember = membersById.get(recordId);
    if (localMember) return localMember.url;

    const record = index.byId.get(recordId);
    if (!record) return null;

    if (baseId(record.typeId) === baseId(PAGE.id)) {
      const { path, siteId } = rawPagePath(index, recordId);
      const target = siteId ? index.sitesById.get(siteId) : undefined;
      if (target && target.id !== site?.id) {
        return `${String(target.content.baseUrl ?? '').replace(/\/+$/, '')}${path}`;
      }
      return path;
    }

    // A member on another site: link to that site, best effort.
    const otherSiteId = siteMembership(record).find(
      (id) => id !== site?.id && index.sitesById.has(id),
    );
    if (otherSiteId) {
      const target = index.sitesById.get(otherSiteId)!;
      warnings.push({
        kind: 'cross-site-member-approx',
        recordId,
        message: `Menu link to ${recordId} on site "${target.content.handle as string}" resolves only to that site's root; cross-site member permalinks are not derivable here.`,
      });
      return `${String(target.content.baseUrl ?? '').replace(/\/+$/, '')}/`;
    }
    return null;
  };

  const menus = new Map<string, ResolvedMenu>();
  for (const [handle, menuRecords] of index.menusByHandle) {
    if (menuRecords.length > 1) {
      warnings.push({
        kind: 'duplicate-menu-handle',
        message: `Handle "${handle}" names ${menuRecords.length} menus on this site; using ${menuRecords[0].id}.`,
      });
    }
    const menu = menuRecords[0];
    const rawItems = (menu.content.items as Array<Record<string, unknown>>) ?? [];
    const items: ResolvedMenuItem[] = [];
    for (const item of [...rawItems].sort((a, b) => Number(a.order) - Number(b.order))) {
      const label = String(item.label ?? '');
      const hasUrl = typeof item.url === 'string' && item.url.length > 0;
      const hasRecordId = typeof item.recordId === 'string' && item.recordId.length > 0;
      if (hasUrl && hasRecordId) {
        warnings.push({
          kind: 'menu-item-ambiguous',
          message: `Menu "${handle}" item "${label}" sets both url and recordId; using url.`,
        });
      }
      if (!hasUrl && !hasRecordId) {
        warnings.push({
          kind: 'menu-item-empty',
          message: `Menu "${handle}" item "${label}" sets neither url nor recordId; skipped.`,
        });
        continue;
      }
      let url: string;
      let dangling = false;
      if (hasUrl) {
        url = item.url as string;
      } else {
        const resolved = resolveLink(item.recordId as string);
        if (resolved === null) {
          dangling = true;
          url = '#';
          warnings.push({
            kind: 'menu-dangling',
            recordId: item.recordId as string,
            message: `Menu "${handle}" item "${label}" points at ${item.recordId as string}, which did not resolve.`,
          });
        } else {
          url = resolved;
        }
      }
      items.push({
        label,
        order: Number(item.order),
        url,
        rel: typeof item.rel === 'string' ? item.rel : undefined,
        dangling,
      });
    }
    menus.set(handle, {
      handle,
      label: typeof menu.content.label === 'string' ? menu.content.label : undefined,
      items,
    });
  }

  const pagesByUrl = new Map<string, ResolvedPage>();
  for (const page of pagesById.values()) pagesByUrl.set(page.url, page);

  if (config.strict !== false && errors.length > 0) {
    const where = site ? `site "${site.content.handle as string}"` : 'the site';
    throw new HaverstackEleventyError(
      `${errors.length} fatal fault${errors.length > 1 ? 's' : ''} resolving ${where}:\n\n` +
        errors.map((e) => e.message).join('\n\n'),
    );
  }

  return {
    site,
    sites: index.sitesByHandle,
    owner: index.owner,
    pages,
    pagesByUrl,
    members: [...membersById.values()],
    collections,
    menus,
    errors,
    warnings,
  };
}
