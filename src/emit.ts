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
import type { StackClient } from '@haverstack/core';
import { collectAssets, stageAssets, type AssetPlan } from './assets.js';
import { atomFeed, feedSpecs, sitemapXml } from './feeds.js';
import {
  renderMember,
  renderMemberFragment,
  renderPage,
  renderPageFragment,
  type RenderContext,
} from './templates.js';
import { renderBody } from './markdown.js';
import type { StackIndex } from './load.js';
import type { ResolvedPage, ResolvedSite } from './resolve.js';

/**
 * Maps a `template` name to a layout the site provides in its own
 * `_includes`. A mapped page emits its content fragment plus that
 * `layout`; an unmapped one keeps the self-contained built-in render.
 * `base` is the fallback for any name not otherwise listed.
 */
export type TemplateOverrides = { base?: string } & Record<string, string | undefined>;

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
}

export interface EmitResult {
  pages: number;
  members: number;
  feeds: number;
  assets: { written: number; skipped: number };
}

const flatten = (pages: ResolvedPage[]): ResolvedPage[] =>
  pages.flatMap((page) => [page, ...flatten(page.children)]);

/** Data attached to every virtual template — usable by a site's own layouts. */
const PASSTHROUGH_ENGINE = { templateEngineOverride: false, eleventyExcludeFromCollections: true };

export async function emit(opts: EmitOptions): Promise<EmitResult> {
  const { eleventyConfig, stack, resolved, index, assetDir, feedLimit } = opts;

  const assets = collectAssets(resolved, index, assetDir);
  const staged = await stageAssets(
    stack,
    assets,
    resolvePath(opts.cwd ?? process.cwd(), assets.assetDir),
  );
  eleventyConfig.addPassthroughCopy(assets.assetDir);

  const allPages = flatten(resolved.pages);

  const bodyByRecord = new Map<string, string>();
  for (const page of allPages) {
    bodyByRecord.set(
      page.record.id,
      renderBody(
        String(page.record.content.text ?? ''),
        page.record.content.format,
        assets.embedsByRecord.get(page.record.id),
      ),
    );
  }
  for (const member of resolved.members) {
    bodyByRecord.set(
      member.record.id,
      renderBody(
        String(member.record.content.text ?? ''),
        member.record.content.format,
        assets.embedsByRecord.get(member.record.id),
      ),
    );
  }

  const feeds = feedSpecs(resolved);
  const ctx: RenderContext = { resolved, assets, feeds, bodyByRecord };
  const overrides = opts.templates;
  const layoutFor = (name: string): string | undefined => overrides?.[name] ?? overrides?.base;

  for (const page of allPages) {
    const layout = layoutFor(page.template);
    const collection = resolved.collections.get(String(page.record.content.slug));
    eleventyConfig.addTemplate(
      `haverstack/page-${page.record.id}.html`,
      layout ? renderPageFragment(page, ctx) : renderPage(page, ctx),
      {
        ...PASSTHROUGH_ENGINE,
        ...(layout ? { layout } : {}),
        permalink: page.url,
        title: page.record.content.title ?? null,
        record: page.record,
        meta: page.meta,
        url: page.url,
        unlisted: page.unlisted,
        haverstackTemplate: page.template,
        ...(collection ? { collection } : {}),
      },
    );
  }

  for (const member of resolved.members) {
    const layout = layoutFor(member.template);
    eleventyConfig.addTemplate(
      `haverstack/member-${member.record.id}.html`,
      layout ? renderMemberFragment(member, ctx) : renderMember(member, ctx),
      {
        ...PASSTHROUGH_ENGINE,
        ...(layout ? { layout } : {}),
        permalink: member.url,
        title: member.record.content.title ?? member.record.content.caption ?? null,
        record: member.record,
        meta: member.meta,
        url: member.url,
        canonical: member.canonical,
        unlisted: member.unlisted,
        haverstackTemplate: member.template,
      },
    );
  }

  for (const spec of feeds) {
    eleventyConfig.addTemplate(
      `haverstack/feed-${spec.path.replace(/[^a-z0-9]+/gi, '-')}.html`,
      atomFeed(spec, resolved, feedLimit),
      { ...PASSTHROUGH_ENGINE, permalink: spec.path },
    );
  }

  const sitemap = sitemapXml(resolved);
  if (sitemap) {
    eleventyConfig.addTemplate('haverstack/sitemap.html', sitemap, {
      ...PASSTHROUGH_ENGINE,
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
    pages: allPages.length,
    members: resolved.members.length,
    feeds: feeds.length,
    assets: staged,
  };
}

export type { AssetPlan };
