/**
 * @haverstack/eleventy — the `publish` command
 * -------------------------------------------------------
 * Stamps `article.url` / `post.url` with the canonical location at first
 * publish, so any app can render a "view published" link. This is a
 * write, and it does not belong in a build: a build that mutates what it
 * read cannot run twice safely, against production, or from CI without
 * write credentials. So it is a separate command, run deliberately after
 * a successful build.
 *
 * See docs/design.md § publish.
 */

import type { Stack } from '@haverstack/core';
import { ARTICLE, POST } from '@haverstack/commons';
import { load } from './load.js';
import { resolve, type SlugStrategy } from './resolve.js';
import { HaverstackEleventyError } from './errors.js';

const baseId = (typeId: string): string => typeId.split('@')[0];

/**
 * Strip trailing slashes without a backtracking regex — `/\/+$/` on an
 * unanchored start is quadratic on adversarial input (many slashes
 * followed by a non-slash), and `baseUrl` comes from record content.
 */
function stripTrailingSlashes(s: string): string {
  let end = s.length;
  while (end > 0 && s.charCodeAt(end - 1) === 47 /* '/' */) end--;
  return s.slice(0, end);
}

/** Types whose `url` field is the canonical published location (not, say, a bookmark's target). */
const CANONICAL_URL_TYPES = new Set([baseId(ARTICLE.id), baseId(POST.id)]);

export interface PublishOptions {
  site?: string;
  slugStrategy?: SlugStrategy;
  /** Report what would be written without writing. */
  dryRun?: boolean;
}

export interface PublishReport {
  site: string;
  baseUrl: string;
  dryRun: boolean;
  /** `url` was absent and this site stamped it. */
  stamped: { recordId: string; url: string }[];
  /** `url` already points into this site — nothing to do. */
  alreadyHome: { recordId: string; storedUrl: string }[];
  /** `url` points at another site — this site renders rel=canonical, does not restamp. */
  canonicalElsewhere: { recordId: string; storedUrl: string }[];
  /** Members whose type carries no canonical `url` field (photos, bookmarks). */
  skipped: number;
}

export async function runPublish(stack: Stack, opts: PublishOptions = {}): Promise<PublishReport> {
  const index = await load(stack, { site: opts.site });
  // A clean resolve is a precondition — publish follows a successful build.
  const resolved = resolve(index, { slugStrategy: opts.slugStrategy ?? 'title', strict: true });

  if (!resolved.site) {
    throw new HaverstackEleventyError(
      'publish needs a site@1 record: canonical URLs are built from its baseUrl.',
    );
  }
  const baseUrl = stripTrailingSlashes(String(resolved.site.content.baseUrl ?? ''));
  if (!baseUrl) {
    throw new HaverstackEleventyError(
      `Site "${resolved.site.content.handle as string}" has no baseUrl.`,
    );
  }

  const report: PublishReport = {
    site: resolved.site.content.handle as string,
    baseUrl,
    dryRun: Boolean(opts.dryRun),
    stamped: [],
    alreadyHome: [],
    canonicalElsewhere: [],
    skipped: 0,
  };

  for (const member of resolved.members) {
    if (!CANONICAL_URL_TYPES.has(baseId(member.record.typeId))) {
      report.skipped++;
      continue;
    }
    const stored = member.record.content.url;
    if (typeof stored === 'string' && stored) {
      if (stored.startsWith(baseUrl))
        report.alreadyHome.push({ recordId: member.record.id, storedUrl: stored });
      else report.canonicalElsewhere.push({ recordId: member.record.id, storedUrl: stored });
      continue;
    }
    const url = `${baseUrl}${member.url}`;
    if (!opts.dryRun) await stack.patchContent(member.record.id, { url });
    report.stamped.push({ recordId: member.record.id, url });
  }

  return report;
}

export function formatPublishReport(report: PublishReport): string {
  const lines: string[] = [];
  lines.push(
    `${report.dryRun ? 'Would publish' : 'Published'} canonical URLs for "${report.site}" ` +
      `(${report.baseUrl}).\n`,
  );
  for (const { recordId, url } of report.stamped) {
    lines.push(`  ${report.dryRun ? 'would stamp' : 'stamped'}   ${recordId}  → ${url}`);
  }
  for (const { recordId } of report.alreadyHome) {
    lines.push(`  already home ${recordId}`);
  }
  for (const { recordId, storedUrl } of report.canonicalElsewhere) {
    lines.push(`  elsewhere    ${recordId}  (canonical at ${storedUrl})`);
  }
  lines.push(
    `\n${report.stamped.length} ${report.dryRun ? 'to stamp' : 'stamped'}, ` +
      `${report.alreadyHome.length} already canonical here, ` +
      `${report.canonicalElsewhere.length} canonical elsewhere, ` +
      `${report.skipped} without a canonical url field.`,
  );
  return lines.join('\n');
}
