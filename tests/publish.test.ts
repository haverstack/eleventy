import { beforeEach, describe, expect, test } from 'vitest';
import { Stack, type Association, type Permission } from '@haverstack/core';
import { MemoryAdapter } from '@haverstack/core/testing';
import { ARTICLE, PAGE, PHOTO, POST, SITE } from '@haverstack/commons';
import {
  defineEleventyTypes,
  formatPublishReport,
  runPublish,
  SITE_MEMBERSHIP_LABEL,
} from '../src/index.js';

const PUBLIC: Permission[] = [{ access: 'public' }];
const iso = (d: string) => new Date(d).toISOString();
const onSite = (id: string): Association => ({
  kind: 'relationship',
  label: SITE_MEMBERSHIP_LABEL,
  target: { scope: 'record', recordId: id },
});
const PNG = new Uint8Array(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  ),
);

let stack: Stack;
let siteId: string;

beforeEach(async () => {
  stack = await Stack.create(
    new MemoryAdapter({ ownerEntityId: 'did:key:zOwner', timezone: 'UTC' }),
  );
  await defineEleventyTypes(stack);

  const site = await stack.create(
    SITE.id,
    { title: 'P', baseUrl: 'https://p.example/', handle: 'personal' },
    { permissions: PUBLIC },
  );
  siteId = site.id;
  await stack.create(
    PAGE.id,
    {
      slug: 'articles',
      text: 'x',
      publishedAt: iso('2025-01-01'),
      collection: { typeId: ARTICLE.id },
    },
    { parentId: site.id, permissions: PUBLIC },
  );
  await stack.create(
    PAGE.id,
    {
      slug: 'ephemera',
      text: 'x',
      publishedAt: iso('2025-01-01'),
      collection: { typeId: POST.id },
    },
    { parentId: site.id, permissions: PUBLIC },
  );
  await stack.create(
    PAGE.id,
    { slug: 'photos', text: 'x', publishedAt: iso('2025-01-01'), collection: { typeId: PHOTO.id } },
    { parentId: site.id, permissions: PUBLIC },
  );
}, 20000);

const article = (title: string, extra: Record<string, unknown> = {}) =>
  stack.create(
    ARTICLE.id,
    { title, text: 'b', publishedAt: iso('2025-02-01'), ...extra },
    { permissions: PUBLIC, associations: [onSite(siteId)] },
  );

describe('runPublish', () => {
  test('stamps url on articles and posts that lack one, from baseUrl + permalink', async () => {
    const a = await article('Fresh');
    await stack
      .putAttachment(PNG, 'image/png', 'p.png')
      .then((img) =>
        stack.create(
          PHOTO.id,
          { image: img.content.fileId, alt: 'x' },
          { permissions: PUBLIC, associations: [onSite(siteId)] },
        ),
      );
    await stack.create(
      POST.id,
      { text: 'a short note' },
      { permissions: PUBLIC, associations: [onSite(siteId)] },
    );

    const report = await runPublish(stack, { site: 'personal' });

    expect(report.stamped).toHaveLength(2); // the article and the post; the photo is skipped
    expect(report.skipped).toBe(1);
    expect(report.stamped.find((s) => s.recordId === a.id)?.url).toBe(
      'https://p.example/articles/fresh/',
    );
    expect((await stack.get(a.id))?.content.url).toBe('https://p.example/articles/fresh/');
  });

  test('leaves a url that already points into this site, and does not restamp one pointing elsewhere', async () => {
    const home = await article('Home already', { url: 'https://p.example/articles/home-already/' });
    const away = await article('Away', { url: 'https://elsewhere.test/x/' });

    const report = await runPublish(stack, { site: 'personal' });

    expect(report.stamped).toHaveLength(0);
    expect(report.alreadyHome.map((r) => r.recordId)).toEqual([expect.stringMatching(home.id)]);
    expect(report.canonicalElsewhere.map((r) => r.recordId)).toEqual([
      expect.stringMatching(away.id),
    ]);
    expect((await stack.get(away.id))?.content.url).toBe('https://elsewhere.test/x/');
  });

  test('dry-run writes nothing but still reports what it would stamp', async () => {
    const a = await article('Fresh');
    const report = await runPublish(stack, { site: 'personal', dryRun: true });

    expect(report.dryRun).toBe(true);
    expect(report.stamped).toHaveLength(1);
    expect((await stack.get(a.id))?.content.url).toBeUndefined();
    expect(formatPublishReport(report)).toContain('would stamp');
  });

  test('is idempotent — a second run stamps nothing', async () => {
    await article('Once');
    await runPublish(stack, { site: 'personal' });
    const second = await runPublish(stack, { site: 'personal' });
    expect(second.stamped).toHaveLength(0);
    expect(second.alreadyHome).toHaveLength(1);
  });
});
