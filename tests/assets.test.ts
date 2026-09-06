import { existsSync } from 'node:fs';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, test } from 'vitest';
import { Stack, type Permission } from '@haverstack/core';
import { MemoryAdapter } from '@haverstack/core/testing';
import { ARTICLE, PAGE, PHOTO, SITE } from '@haverstack/commons';
import {
  collectAssets,
  defineEleventyTypes,
  EMBED_LABEL,
  load,
  resolve,
  SITE_MEMBERSHIP_LABEL,
  stageAssets,
} from '../src/index.js';

const PUBLIC: Permission[] = [{ access: 'public' }];
const iso = (d: string) => new Date(d).toISOString();
const onSite = (id: string) => ({
  kind: 'relationship' as const,
  label: SITE_MEMBERSHIP_LABEL,
  target: { scope: 'record' as const, recordId: id },
});
const PNG = new Uint8Array(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  ),
);

let stack: Stack;

beforeEach(async () => {
  stack = await Stack.create(
    new MemoryAdapter({ ownerEntityId: 'did:key:zOwner', timezone: 'UTC' }),
  );
  await defineEleventyTypes(stack);
});

async function fixture() {
  const site = await stack.create(
    SITE.id,
    { title: 'T', baseUrl: 'https://ex.test', handle: 't' },
    { permissions: PUBLIC },
  );
  await stack.create(
    PAGE.id,
    {
      slug: 'gallery',
      text: 'x',
      publishedAt: iso('2025-01-01'),
      collection: { typeId: PHOTO.id },
    },
    { parentId: site.id, permissions: PUBLIC },
  );
  await stack.create(
    PAGE.id,
    { slug: 'blog', text: 'x', publishedAt: iso('2025-01-01'), collection: { typeId: ARTICLE.id } },
    { parentId: site.id, permissions: PUBLIC },
  );

  const img = await stack.putAttachment(PNG, 'image/png', 'harbor.png');
  await stack.create(
    PHOTO.id,
    { image: img.content.fileId, alt: 'a harbor' },
    { permissions: PUBLIC, associations: [onSite(site.id)] },
  );

  const embed = await stack.putAttachment(PNG, 'image/png', 'diagram.png');
  // A second _attachment record for the same bytes, a different name.
  await stack.putAttachment(PNG, 'image/png', 'schema.png');
  const article = await stack.create(
    ARTICLE.id,
    { title: 'A', text: '![d](diagram.png)', publishedAt: iso('2025-01-02') },
    { permissions: PUBLIC, associations: [onSite(site.id)] },
  );
  await stack.associate(article.id, {
    kind: 'attachment',
    label: EMBED_LABEL,
    fileId: embed.content.fileId,
  });

  return { fileId: img.content.fileId, embedFileId: embed.content.fileId, articleId: article.id };
}

async function resolvedIndex() {
  const index = await load(stack, { site: 't' });
  return { index, resolved: resolve(index, { slugStrategy: 'title' }) };
}

describe('collectAssets', () => {
  test('collects file-ref content fields and embed associations', async () => {
    const { fileId, embedFileId } = await fixture();
    const { index, resolved } = await resolvedIndex();
    const plan = collectAssets(resolved, index, '_stack-assets');

    expect(plan.files.has(fileId)).toBe(true);
    expect(plan.files.has(embedFileId)).toBe(true);
    expect(plan.files.get(fileId)?.assetPath).toBe(`/_stack-assets/${fileId}.png`);
  });

  test('maps every _attachment filename for a shared fileId to the one staged path', async () => {
    const { embedFileId, articleId } = await fixture();
    const { index, resolved } = await resolvedIndex();
    const plan = collectAssets(resolved, index, '_stack-assets');

    const embeds = plan.embedsByRecord.get(articleId)!;
    expect(embeds.get('diagram.png')).toBe(`/_stack-assets/${embedFileId}.png`);
    expect(embeds.get('schema.png')).toBe(`/_stack-assets/${embedFileId}.png`);
  });

  test('warns about an embed with no _attachment metadata', async () => {
    const site = await stack.create(
      SITE.id,
      { title: 'T', baseUrl: 'https://ex.test', handle: 't' },
      { permissions: PUBLIC },
    );
    await stack.create(
      PAGE.id,
      {
        slug: 'blog',
        text: 'x',
        publishedAt: iso('2025-01-01'),
        collection: { typeId: ARTICLE.id },
      },
      { parentId: site.id, permissions: PUBLIC },
    );
    const article = await stack.create(
      ARTICLE.id,
      { title: 'A', text: 'x', publishedAt: iso('2025-01-02') },
      { permissions: PUBLIC, associations: [onSite(site.id)] },
    );
    await stack.associate(article.id, {
      kind: 'attachment',
      label: EMBED_LABEL,
      fileId: 'ghostfile',
    });

    const { index, resolved } = await resolvedIndex();
    const plan = collectAssets(resolved, index, '_stack-assets');
    expect(plan.warnings.some((w) => w.kind === 'attachment-missing-metadata')).toBe(true);
    expect(plan.files.has('ghostfile')).toBe(false);
  });
});

describe('stageAssets', () => {
  test('writes each file once and skips what is already there', async () => {
    await fixture();
    const { index, resolved } = await resolvedIndex();
    const plan = collectAssets(resolved, index, '_stack-assets');
    const dir = await mkdtemp(join(tmpdir(), 'hs-assets-'));

    const first = await stageAssets(stack, plan, dir);
    expect(first.written).toBe(plan.files.size);
    expect(first.skipped).toBe(0);

    for (const file of plan.files.values()) {
      expect(existsSync(join(dir, file.fileName))).toBe(true);
      expect((await readFile(join(dir, file.fileName))).equals(Buffer.from(PNG))).toBe(true);
    }

    const second = await stageAssets(stack, plan, dir);
    expect(second.written).toBe(0);
    expect(second.skipped).toBe(plan.files.size);
  });

  test('writes more files than the download concurrency limit', async () => {
    const site = await stack.create(
      SITE.id,
      { title: 'T', baseUrl: 'https://ex.test', handle: 't' },
      { permissions: PUBLIC },
    );
    await stack.create(
      PAGE.id,
      { slug: 'g', text: 'x', publishedAt: iso('2025-01-01'), collection: { typeId: PHOTO.id } },
      { parentId: site.id, permissions: PUBLIC },
    );
    const fileIds: string[] = [];
    for (let i = 0; i < 15; i++) {
      const bytes = new Uint8Array([...PNG, i]); // distinct bytes → distinct fileId
      const img = await stack.putAttachment(bytes, 'image/png', `p${i}.png`);
      fileIds.push(img.content.fileId);
      await stack.create(
        PHOTO.id,
        { image: img.content.fileId, alt: `p${i}` },
        { permissions: PUBLIC, associations: [onSite(site.id)] },
      );
    }

    const { index, resolved } = await resolvedIndex();
    const plan = collectAssets(resolved, index, '_stack-assets');
    const dir = await mkdtemp(join(tmpdir(), 'hs-pool-'));
    const result = await stageAssets(stack, plan, dir);

    expect(result.written).toBe(15);
    for (const fileId of fileIds) {
      expect(existsSync(join(dir, `${fileId}.png`))).toBe(true);
    }
  });
});
