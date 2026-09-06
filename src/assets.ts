/**
 * @haverstack/eleventy — asset staging
 * -------------------------------------------------------
 * Eleventy does not emit binaries well, so attachment bytes are staged to
 * disk before the build proper and passed through. Content addressing
 * makes the cache trivially correct: a `fileId` already on disk is never
 * refetched, and it can never go stale.
 *
 * `collectAssets` is pure — it decides which files a site needs and what
 * they will be named. `stageAssets` does the fetching and writing.
 *
 * See docs/design.md § Stage assets.
 */

import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { FileId, RecordId, StackClient, StackRecord } from '@haverstack/core';
import { PHOTO } from '@haverstack/commons';
import { EMBED_LABEL } from './types.js';
import type { StackIndex } from './load.js';
import type { ResolvedSite, ResolveWarning } from './resolve.js';

const baseId = (typeId: string): string => typeId.split('@')[0];

const EXT_BY_MIME: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/avif': '.avif',
  'image/svg+xml': '.svg',
  'application/pdf': '.pdf',
  'video/mp4': '.mp4',
  'audio/mpeg': '.mp3',
  'text/plain': '.txt',
};

function extForMime(mime: string): string {
  const known = EXT_BY_MIME[mime];
  if (known) return known;
  const sub = mime
    .split('/')[1]
    ?.split('+')[0]
    ?.replace(/[^a-z0-9.-]/gi, '');
  return sub ? `.${sub}` : '.bin';
}

export interface StagedFile {
  fileId: FileId;
  /** `<fileId><ext>` — the name on disk and in the URL. */
  fileName: string;
  /** Site-root-relative URL, e.g. `/_stack-assets/<fileId>.png`. */
  assetPath: string;
  mimeType: string;
}

export interface AssetPlan {
  /** As configured, e.g. `_stack-assets`. */
  assetDir: string;
  /** Every file this site references, by fileId. */
  files: Map<FileId, StagedFile>;
  /** Per record: the body filename → staged asset path map for embed substitution. */
  embedsByRecord: Map<RecordId, Map<string, string>>;
  warnings: ResolveWarning[];
}

function fileRefsIn(record: StackRecord): FileId[] {
  // The only `file-ref` content field in the commons publishing types.
  // Custom types with their own file-ref fields are not scanned yet.
  if (baseId(record.typeId) === baseId(PHOTO.id) && typeof record.content.image === 'string') {
    return [record.content.image];
  }
  return [];
}

function embedFileIds(record: StackRecord): FileId[] {
  const out: FileId[] = [];
  for (const a of record.associations ?? []) {
    if (a.kind === 'attachment' && a.label === EMBED_LABEL) out.push(a.fileId);
  }
  return out;
}

/**
 * Walk every record this site builds — pages and members, listed or not —
 * and collect the attachment files it references, by `embed` association
 * and by `file-ref` content field. Filenames for embed substitution are
 * resolved per record, never globally: two records can each carry an
 * `image.png` with different bytes.
 */
export function collectAssets(
  resolved: ResolvedSite,
  index: StackIndex,
  assetDir: string,
): AssetPlan {
  const files = new Map<FileId, StagedFile>();
  const embedsByRecord = new Map<RecordId, Map<string, string>>();
  const warnings: ResolveWarning[] = [];
  const dir = assetDir.replace(/^\/+|\/+$/g, '');

  const stage = (fileId: FileId, forRecord: RecordId): StagedFile | null => {
    const meta = index.attachmentsByFileId.get(fileId)?.[0];
    if (!meta) {
      warnings.push({
        kind: 'attachment-missing-metadata',
        recordId: forRecord,
        message: `Record ${forRecord} references file ${fileId}, which has no _attachment@1 record; skipped.`,
      });
      return null;
    }
    let staged = files.get(fileId);
    if (!staged) {
      const mimeType = String(meta.content.mimeType ?? 'application/octet-stream');
      const fileName = `${fileId}${extForMime(mimeType)}`;
      staged = { fileId, fileName, assetPath: `/${dir}/${fileName}`, mimeType };
      files.set(fileId, staged);
    }
    return staged;
  };

  const visit = (record: StackRecord): void => {
    for (const fileId of fileRefsIn(record)) stage(fileId, record.id);

    const embedMap = new Map<string, string>();
    for (const fileId of embedFileIds(record)) {
      const staged = stage(fileId, record.id);
      if (!staged) continue;
      // One fileId can have several _attachment@1 records (one per upload),
      // each with its own filename. The body might reference any of them,
      // so every known name points at the one staged path.
      for (const meta of index.attachmentsByFileId.get(fileId) ?? []) {
        const filename = meta.content.filename;
        if (typeof filename === 'string' && filename) embedMap.set(filename, staged.assetPath);
      }
    }
    if (embedMap.size > 0) embedsByRecord.set(record.id, embedMap);
  };

  const walkPages = (pages: { record: StackRecord; children: unknown[] }[]): void => {
    for (const page of pages) {
      visit(page.record);
      walkPages(page.children as typeof pages);
    }
  };
  walkPages(resolved.pages);
  for (const member of resolved.members) visit(member.record);

  return { assetDir: dir, files, embedsByRecord, warnings };
}

export interface StageResult {
  written: number;
  skipped: number;
}

/** How many attachments to fetch at once — a remote stack is the case this bounds. */
const DOWNLOAD_CONCURRENCY = 6;

/**
 * Fetch and write every file in `plan` into `outDir`, skipping any that
 * are already there — the content-addressed cache. `outDir` is the
 * on-disk location of `plan.assetDir`. Downloads run in a bounded pool.
 */
export async function stageAssets(
  stack: StackClient,
  plan: AssetPlan,
  outDir: string,
): Promise<StageResult> {
  await mkdir(outDir, { recursive: true });

  const toFetch: StagedFile[] = [];
  let skipped = 0;
  for (const file of plan.files.values()) {
    if (existsSync(join(outDir, file.fileName))) skipped++;
    else toFetch.push(file);
  }

  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < toFetch.length) {
      const file = toFetch[next++];
      const bytes = await stack.getAttachment(file.fileId);
      await writeFile(join(outDir, file.fileName), bytes);
    }
  };
  await Promise.all(Array.from({ length: Math.min(DOWNLOAD_CONCURRENCY, toFetch.length) }, worker));

  return { written: toFetch.length, skipped };
}
