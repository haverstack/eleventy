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
 * See eleventy-integration.md for the design. This entry wires option
 * handling, type registration and the load phase; resolve, asset staging
 * and emit land next.
 */

import type { Stack, StackRecord } from '@haverstack/core';
import { defineEleventyTypes } from './types.js';
import { load } from './load.js';

export * from './types.js';
export * from './errors.js';
export * from './load.js';

/**
 * How this site derives a permalink for a listing member when no sidecar
 * overrides it. `'title'` slugifies the record's `title` (default);
 * `'recordId'` publishes under the opaque record ID; a function lets the
 * site decide. See eleventy-integration.md § slugStrategy.
 */
export type SlugStrategy = 'title' | 'recordId' | ((record: StackRecord) => string);

export interface HaverstackPluginOptions {
  /**
   * The stack to build from. Backed by any adapter — `APIAdapter` for a
   * remote server, `LocalAdapter` for an offline or CI build, `MemoryAdapter`
   * for tests. The plugin never writes through it; that discipline is a
   * rule, not a guarantee. See eleventy-integration.md § It takes a Stack.
   */
  stack: Stack;
  /**
   * Names the `site@1` record to build, by `handle` or by record ID.
   * Resolving to zero or several records fails the build. Omit on a stack
   * with no `site@1` records — the single-site case.
   */
  site?: string;
  /** Directory the staged attachment bytes are written to and passed through. */
  assetDir?: string;
  /** This site's permalink-derivation policy for listing members. */
  slugStrategy?: SlugStrategy;
}

/** The subset of Eleventy's config object this plugin uses. Widened as later phases land. */
export interface EleventyConfig {
  addPassthroughCopy(path: string | Record<string, string>): unknown;
}

/**
 * The Eleventy plugin. Registered the ordinary way with
 * `eleventyConfig.addPlugin(haverstack, options)`.
 */
export async function haverstack(
  _eleventyConfig: EleventyConfig,
  options: HaverstackPluginOptions,
): Promise<void> {
  if (!options || !options.stack) {
    throw new Error('@haverstack/eleventy: the `stack` option is required.');
  }

  await defineEleventyTypes(options.stack);

  const index = await load(options.stack, { site: options.site });

  const name = index.site ? `"${index.site.content.title as string}"` : 'the single site';
  const unlisted = index.unlistedVisible
    ? ''
    : ' (unlisted records not visible under this credential)';
  console.info(
    `[haverstack] loaded ${name}: ${index.pagesById.size} pages, ${index.menus.length} menus, ` +
      `${index.attachmentsByFileId.size} attachment files${unlisted}`,
  );

  // Resolve, stage assets, emit — attach here.
}

export default haverstack;
