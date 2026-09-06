/**
 * @haverstack/eleventy
 * -------------------------------------------------------
 * An Eleventy plugin that builds a static site from a Haverstack stack.
 * Records are the content source; there are no content files on disk.
 *
 * ```js
 * import { haverstack } from '@haverstack/eleventy';
 * import { LocalAdapter } from '@haverstack/adapter-local';
 * import { Stack } from '@haverstack/core';
 *
 * export default async function (eleventyConfig) {
 *   const stack = await Stack.create(await LocalAdapter.open({ path: './stack.db' }));
 *   eleventyConfig.addPlugin(haverstack, { stack, site: 'personal' });
 * }
 * ```
 *
 * See docs/design.md for the design. Load → resolve → emit run at
 * plugin-init time; the plugin adds one virtual template per page and
 * member, the feeds, the sitemap, and `haverstack` global data.
 */

import type { Stack } from '@haverstack/core';
import { defineEleventyTypes } from './types.js';
import { load } from './load.js';
import { resolve, type SlugStrategy } from './resolve.js';
import { emit, type EmitEleventyConfig, type TemplateOverrides } from './emit.js';

export * from './types.js';
export * from './errors.js';
export * from './load.js';
export * from './resolve.js';
export * from './assets.js';
export * from './markdown.js';
export * from './feeds.js';
export * from './templates.js';
export * from './emit.js';
export * from './check.js';
export * from './publish.js';

const DEFAULT_ASSET_DIR = '_stack-assets';
const DEFAULT_FEED_LIMIT = 20;

export interface HaverstackPluginOptions {
  /**
   * The stack to build from. Backed by any adapter — `APIAdapter` for a
   * remote server, `LocalAdapter` for an offline or CI build, `MemoryAdapter`
   * for tests. The plugin never writes through it; that discipline is a
   * rule, not a guarantee. See docs/design.md § It takes a Stack, not a URL.
   */
  stack: Stack;
  /**
   * Names the `site@1` record to build, by `handle` or by record ID.
   * Resolving to zero or several records fails the build. Omit on a stack
   * with no `site@1` records — the single-site case.
   */
  site?: string;
  /** Directory the staged attachment bytes are written to and passed through. Default `_stack-assets`. */
  assetDir?: string;
  /** This site's permalink-derivation policy for listing members. Default `'title'`. */
  slugStrategy?: SlugStrategy;
  /** Maximum entries per Atom feed. Default 20. */
  feedLimit?: number;
  /**
   * Replace the built-in templates with the site's own. Maps a `template`
   * name (`home`, `content`, `listing`, `listing-inline`, `article`,
   * `post`, `photo`, `bookmark`, or a custom name from a sidecar) to a
   * layout the site provides in its `_includes`. A mapped page emits its
   * content fragment plus that `layout`; the layout receives `content`
   * plus `record`, `meta`, `url`, `collection`, and the `haverstack`
   * globals, and may chain to another layout. `base` catches every
   * unmapped name; anything still unmapped uses the built-in render.
   */
  templates?: TemplateOverrides;
}

/** The subset of Eleventy's config object this plugin uses. */
export type EleventyConfig = EmitEleventyConfig;

/**
 * The Eleventy plugin. Registered the ordinary way with
 * `eleventyConfig.addPlugin(haverstack, options)`.
 */
export async function haverstack(
  eleventyConfig: EleventyConfig,
  options: HaverstackPluginOptions,
): Promise<void> {
  if (!options || !options.stack) {
    throw new Error('@haverstack/eleventy: the `stack` option is required.');
  }

  await defineEleventyTypes(options.stack);

  const index = await load(options.stack, { site: options.site });
  const resolved = resolve(index, { slugStrategy: options.slugStrategy ?? 'title' });

  const name = resolved.site ? `"${resolved.site.content.title as string}"` : 'the single site';
  const unlisted = index.unlistedVisible
    ? ''
    : ' — unlisted records not visible under this credential';
  for (const w of resolved.warnings) console.warn(`[haverstack]  ! ${w.message}`);

  const result = await emit({
    eleventyConfig,
    stack: options.stack,
    resolved,
    index,
    assetDir: options.assetDir ?? DEFAULT_ASSET_DIR,
    feedLimit: options.feedLimit ?? DEFAULT_FEED_LIMIT,
    templates: options.templates,
  });

  console.info(
    `[haverstack] ${name}: ${result.pages} pages, ${result.members} members, ` +
      `${result.feeds} feeds, assets ${result.assets.written} written / ${result.assets.skipped} cached` +
      `${resolved.warnings.length ? `, ${resolved.warnings.length} warning(s)` : ''}${unlisted}`,
  );
}

export default haverstack;
