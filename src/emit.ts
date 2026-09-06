/**
 * @haverstack/eleventy — emit phase
 * -------------------------------------------------------
 * Turn a `ResolvedSite` into Eleventy virtual templates: one per page and
 * per member, plus the feeds and the sitemap. Attachment bytes are staged
 * to disk first and passed through. Global data exposes the resolved
 * structures so a site that brings its own templates can iterate them.
 *
 * See docs/design.md § Emit.
 */

import { resolve as resolvePath } from 'node:path';
import type { RecordId, StackClient, StackRecord } from '@haverstack/core';
import { collectAssets, stageAssets, type AssetPlan } from './assets.js';
import { atomFeed, feedSpecs, sitemapXml } from './feeds.js';
import {
  renderMember,
  renderMemberFragment,
  renderPage,
  renderPageFragment,
  type RenderContext,
} from './templates.js';
import { renderBody, substituteEmbeds } from './markdown.js';
import type { StackIndex } from './load.js';
import type { ResolvedMeta, ResolvedPage, ResolvedSite } from './resolve.js';

/**
 * Maps a `template` name to a layout the site provides in its own
 * `_includes`. A mapped page emits its content fragment plus that
 * `layout`; an unmapped one keeps the self-contained built-in render.
 * `base` is the fallback for any name not otherwise listed.
 */
export type TemplateOverrides = { base?: string } & Record<string, string | undefined>;

/** Passed to a `pageData` hook so it can compute extra template data per record. */
export interface PageDataContext {
  kind: 'page' | 'member';
  record: StackRecord;
  meta: ResolvedMeta;
  url: string;
  template: string;
  canonical: string | null;
  unlisted: boolean;
  resolved: ResolvedSite;
}

export type PageDataHook = (ctx: PageDataContext) => Record<string, unknown>;

export interface EmitEleventyConfig {
  addTemplate(virtualPath: string, content: string, data?: Record<string, unknown>): unknown;
  addPassthroughCopy(path: string | Record<string, string>): unknown;
  addGlobalData(name: string, value: unknown): unknown;
}

export interface EmitOptions {
  eleventyConfig: EmitEleventyConfig;
  stack: StackClient;
  resolved: ResolvedSite;
  index: StackIndex;
  assetDir: string;
  /** Maximum entries per feed. */
  feedLimit: number;
  /** Directory `assetDir` is resolved against when staging bytes. Default `process.cwd()`. */
  cwd?: string;
  /** Per-template-name layout overrides. Unmapped names use the built-in render. */
  templates?: TemplateOverrides;
  /**
   * `false` keeps the plugin's pages out of Eleventy's `collections` and
   * `eleventyNavigation` entirely. Default `true`.
   */
  eleventyCollections?: boolean;
  /** Extra data merged into every page/member template, last (so it can override). */
  pageData?: PageDataHook;
}

export interface EmitResult {
  pages: number;
  members: number;
  feeds: number;
  assets: { written: number; skipped: number };
}

interface FlatPage {
  page: ResolvedPage;
  parentId?: RecordId;
}

const flattenWithParent = (pages: ResolvedPage[], parentId?: RecordId): FlatPage[] =>
  pages.flatMap((page) => [
    { page, parentId },
    ...flattenWithParent(page.children, page.record.id),
  ]);

/** Content is verbatim (already HTML); layouts and transforms still apply. */
const CONTENT_VERBATIM = { templateEngineOverride: false } as const;
/** Feeds and the sitemap are output, never content — keep them out of collections. */
const OUTPUT_FILE = { ...CONTENT_VERBATIM, eleventyExcludeFromCollections: true } as const;

const typeSlug = (typeId: string): string => typeId.split('@')[0].split('/').pop() ?? 'record';

const tagAssociations = (record: StackRecord): string[] =>
  (record.associations ?? []).flatMap((a) => (a.kind === 'tag' ? [a.label] : []));

export async function emit(opts: EmitOptions): Promise<EmitResult> {
  const { eleventyConfig, stack, resolved, index, assetDir, feedLimit } = opts;

  const assets = collectAssets(resolved, index, assetDir);
  const staged = await stageAssets(
    stack,
    assets,
    resolvePath(opts.cwd ?? process.cwd(), assets.assetDir),
  );
  eleventyConfig.addPassthroughCopy(assets.assetDir);

  const flatPages = flattenWithParent(resolved.pages);

  const rawBody = (record: StackRecord): string =>
    substituteEmbeds(
      String(record.content.text ?? ''),
      assets.embedsByRecord.get(record.id) ?? new Map(),
    );

  const bodyByRecord = new Map<string, string>();
  for (const record of [
    ...flatPages.map((f) => f.page.record),
    ...resolved.members.map((m) => m.record),
  ]) {
    bodyByRecord.set(
      record.id,
      renderBody(
        String(record.content.text ?? ''),
        record.content.format,
        assets.embedsByRecord.get(record.id),
      ),
    );
  }

  const feeds = feedSpecs(resolved);
  const ctx: RenderContext = { resolved, assets, feeds, bodyByRecord };
  const overrides = opts.templates;
  const layoutFor = (name: string): string | undefined => overrides?.[name] ?? overrides?.base;
  const collectionsOn = opts.eleventyCollections !== false;

  /** Collection membership + the exclude flag for one record. */
  const graphData = (record: StackRecord, unlisted: boolean): Record<string, unknown> => {
    if (!collectionsOn || unlisted) return { eleventyExcludeFromCollections: true };
    return { tags: ['haverstack', typeSlug(record.typeId), ...tagAssociations(record)] };
  };

  for (const { page, parentId } of flatPages) {
    const layout = layoutFor(page.template);
    const collection = resolved.collections.get(String(page.record.content.slug));
    const nav =
      collectionsOn && !page.unlisted
        ? {
            eleventyNavigation: {
              key: page.record.id,
              ...(parentId ? { parent: parentId } : {}),
              title: page.record.content.title ?? page.record.content.slug,
              ...(typeof page.meta.order === 'number' ? { order: page.meta.order } : {}),
            },
          }
        : {};
    const hookData =
      opts.pageData?.({
        kind: 'page',
        record: page.record,
        meta: page.meta,
        url: page.url,
        template: page.template,
        canonical: null,
        unlisted: page.unlisted,
        resolved,
      }) ?? {};

    eleventyConfig.addTemplate(
      `haverstack/page-${page.record.id}.html`,
      layout ? renderPageFragment(page, ctx) : renderPage(page, ctx),
      {
        ...CONTENT_VERBATIM,
        ...graphData(page.record, page.unlisted),
        ...nav,
        ...(layout ? { layout } : {}),
        permalink: page.url,
        title: page.record.content.title ?? null,
        record: page.record,
        meta: page.meta,
        url: page.url,
        body: bodyByRecord.get(page.record.id) ?? '',
        bodyRaw: rawBody(page.record),
        unlisted: page.unlisted,
        haverstackTemplate: page.template,
        ...(collection ? { collection } : {}),
        ...hookData,
      },
    );
  }

  for (const member of resolved.members) {
    const layout = layoutFor(member.template);
    const hookData =
      opts.pageData?.({
        kind: 'member',
        record: member.record,
        meta: member.meta,
        url: member.url,
        template: member.template,
        canonical: member.canonical,
        unlisted: member.unlisted,
        resolved,
      }) ?? {};

    eleventyConfig.addTemplate(
      `haverstack/member-${member.record.id}.html`,
      layout ? renderMemberFragment(member, ctx) : renderMember(member, ctx),
      {
        ...CONTENT_VERBATIM,
        ...graphData(member.record, member.unlisted),
        ...(layout ? { layout } : {}),
        permalink: member.url,
        title: member.record.content.title ?? member.record.content.caption ?? null,
        record: member.record,
        meta: member.meta,
        url: member.url,
        body: bodyByRecord.get(member.record.id) ?? '',
        bodyRaw: rawBody(member.record),
        canonical: member.canonical,
        unlisted: member.unlisted,
        haverstackTemplate: member.template,
        ...hookData,
      },
    );
  }

  for (const spec of feeds) {
    eleventyConfig.addTemplate(
      `haverstack/feed-${spec.path.replace(/[^a-z0-9]+/gi, '-')}.html`,
      atomFeed(spec, resolved, feedLimit),
      { ...OUTPUT_FILE, permalink: spec.path },
    );
  }

  const sitemap = sitemapXml(resolved);
  if (sitemap) {
    eleventyConfig.addTemplate('haverstack/sitemap.html', sitemap, {
      ...OUTPUT_FILE,
      permalink: '/sitemap.xml',
    });
  }

  eleventyConfig.addGlobalData('haverstack', {
    site: resolved.site,
    sites: Object.fromEntries(resolved.sites),
    owner: resolved.owner,
    pages: resolved.pages,
    menus: Object.fromEntries(resolved.menus),
    collections: Object.fromEntries(resolved.collections),
    assetDir: assets.assetDir,
  });

  return {
    pages: flatPages.length,
    members: resolved.members.length,
    feeds: feeds.length,
    assets: staged,
  };
}

export type { AssetPlan };
