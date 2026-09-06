/**
 * @haverstack/eleventy — the `check` command
 * -------------------------------------------------------
 * Load + resolve, report structural problems, write and emit nothing.
 * Read-only and safe against production data. These are the faults an
 * editing tool structurally cannot catch, because they are only defined
 * relative to a build: a slug collides only relative to a path, a sidecar
 * is misdirected only relative to which sites a record is published on.
 *
 * See eleventy-integration.md § What `check` reports.
 */

import type { RecordFilter, StackClient, StackRecord } from '@haverstack/core';
import { ARTICLE, BOOKMARK, PHOTO, POST } from '@haverstack/commons';
import { load } from './load.js';
import { resolve, type ResolvedPage, type SlugStrategy } from './resolve.js';
import { SITE_MEMBERSHIP_LABEL } from './types.js';

const MEMBER_TYPES = [ARTICLE.id, POST.id, PHOTO.id, BOOKMARK.id];

export interface CheckItem {
  kind: string;
  message: string;
}

export interface CheckReport {
  /** The resolved site's handle, or `null` for a single-site stack. */
  site: string | null;
  /** Faults that would also fail a build. */
  failures: CheckItem[];
  /** Problems a build tolerates. */
  warnings: CheckItem[];
  /** Not problems — an audit of what the build did with edge-case records. */
  info: CheckItem[];
}

export interface CheckOptions {
  site?: string;
  slugStrategy?: SlugStrategy;
}

async function queryAll(stack: StackClient, filter: RecordFilter): Promise<StackRecord[]> {
  const out: StackRecord[] = [];
  let cursor: string | undefined;
  do {
    const page = await stack.query({ filter, cursor, limit: 100 });
    out.push(...page.records);
    cursor = page.cursor ?? undefined;
  } while (cursor);
  return out;
}

const siteMembershipIds = (record: StackRecord): string[] => {
  const out: string[] = [];
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
};

const title = (r: StackRecord): string =>
  String(r.content.title ?? r.content.caption ?? r.content.text ?? r.id).slice(0, 60);

export async function runCheck(stack: StackClient, opts: CheckOptions = {}): Promise<CheckReport> {
  const index = await load(stack, { site: opts.site });
  const resolved = resolve(index, {
    slugStrategy: opts.slugStrategy ?? 'title',
    strict: false,
  });

  const failures: CheckItem[] = resolved.errors.map((e) => ({ kind: e.kind, message: e.message }));
  const warnings: CheckItem[] = resolved.warnings.map((w) => ({
    kind: w.kind,
    message: w.message,
  }));
  const info: CheckItem[] = [];

  // A sidecar scoped to a site the record it describes isn't published on.
  for (const [parentId, set] of index.sidecarsByParent) {
    const record = index.byId.get(parentId);
    if (!record) continue;
    const memberships = new Set(siteMembershipIds(record));
    for (const scopedSiteId of set.bySite.keys()) {
      if (memberships.has(scopedSiteId)) continue;
      const scopedSite = index.sitesById.get(scopedSiteId);
      warnings.push({
        kind: 'sidecar-for-unpublished-site',
        message:
          `Record ${parentId} ("${title(record)}") has a page-meta scoped to ` +
          `${scopedSite ? `site "${scopedSite.content.handle as string}"` : scopedSiteId}, ` +
          `which it carries no membership association for — usually a forgotten \`site\` association.`,
      });
    }
  }

  // Member records carrying no `site` association at all.
  for (const typeId of MEMBER_TYPES) {
    for (const record of await queryAll(stack, {
      typeId,
      ...(index.unlistedVisible ? { includeUnlisted: true } : {}),
    })) {
      if (siteMembershipIds(record).length === 0) {
        warnings.push({
          kind: 'record-on-no-site',
          message: `${record.id} (${record.typeId}) "${title(record)}" is published on no site.`,
        });
      }
    }
  }

  // Unlisted records built this run — nothing else in the output points at them.
  if (!index.unlistedVisible) {
    info.push({
      kind: 'unlisted-not-visible',
      message:
        'Running under a credential that cannot see unlisted records; any built this run ' +
        'are missing and cannot be reported.',
    });
  } else {
    const report = (url: string, record: StackRecord, meta: { hidden?: boolean }) => {
      const mechanism = record.unlistedAt ? 'unlistedAt' : meta.hidden ? 'hidden' : 'unknown';
      info.push({
        kind: 'unlisted-built',
        message: `${url}  (${mechanism})  "${title(record)}"`,
      });
    };
    const walk = (pages: ResolvedPage[]): void => {
      for (const page of pages) {
        if (page.unlisted) report(page.url, page.record, page.meta);
        walk(page.children);
      }
    };
    walk(resolved.pages);
    for (const member of resolved.members) {
      if (member.unlisted) report(member.url, member.record, member.meta);
    }
  }

  return {
    site: resolved.site ? (resolved.site.content.handle as string) : null,
    failures,
    warnings,
    info,
  };
}

export function formatCheckReport(report: CheckReport): string {
  const lines: string[] = [];
  const where = report.site ? `site "${report.site}"` : 'the single site';
  lines.push(`Checked ${where}.\n`);

  const section = (label: string, items: CheckItem[]) => {
    if (items.length === 0) return;
    lines.push(`${label}  (${items.length})`);
    for (const item of items) {
      lines.push(item.message.includes('\n') ? item.message : `  - ${item.message}`);
    }
    lines.push('');
  };
  section('FAIL', report.failures);
  section('WARN', report.warnings);
  section('INFO', report.info);

  lines.push(
    report.failures.length > 0
      ? `${report.failures.length} failure(s), ${report.warnings.length} warning(s).`
      : `OK — no failures, ${report.warnings.length} warning(s).`,
  );
  return lines.join('\n');
}

export const checkExitCode = (report: CheckReport): number => (report.failures.length > 0 ? 1 : 0);
