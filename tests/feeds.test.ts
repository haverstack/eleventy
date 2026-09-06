import { beforeEach, describe, expect, test } from 'vitest';
import { Stack, type Permission } from '@haverstack/core';
import { MemoryAdapter } from '@haverstack/core/testing';
import { ARTICLE, PAGE, SITE } from '@haverstack/commons';
import {
  atomFeed,
  defineEleventyTypes,
  feedSpecs,
  load,
  resolve,
  SITE_MEMBERSHIP_LABEL,
  sitemapXml,
  type ResolvedSite,
} from '../src/index.js';

const PUBLIC: Permission[] = [{ access: 'public' }];
const iso = (d: string) => new Date(d).toISOString();
const onSite = (id: string) => ({
  kind: 'relationship' as const,
  label: SITE_MEMBERSHIP_LABEL,
  target: { scope: 'record' as const, recordId: id },
});

let stack: Stack;
let resolved: ResolvedSite;

beforeEach(async () => {
  stack = await Stack.create(
    new MemoryAdapter({ ownerEntityId: 'did:key:zOwner', timezone: 'UTC' }),
    {
      ownerProfile: { name: 'Owner' },
    },
  );
  await defineEleventyTypes(stack);

  const site = await stack.create(
    SITE.id,
    { title: 'Test', baseUrl: 'https://ex.test/', handle: 'test' },
    { permissions: PUBLIC },
  );
  await stack.create(
    PAGE.id,
    { slug: 'blog', text: 'x', publishedAt: iso('2025-01-01'), collection: { typeId: ARTICLE.id } },
    { parentId: site.id, permissions: PUBLIC },
  );
  const article = (
    title: string,
    when: string,
    extra: Record<string, unknown> = {},
    unlisted = false,
  ) =>
    stack.create(
      ARTICLE.id,
      { title, text: 'body', publishedAt: iso(when), ...extra },
      { permissions: PUBLIC, associations: [onSite(site.id)], unlisted },
    );
  await article('Newer', '2025-03-01', { summary: 'the newer one' });
  await article('Older', '2025-01-15');
  await article('Elsewhere', '2025-02-01', { url: 'https://other.test/x/' });
  await article('Hidden', '2025-02-20', {}, true);

  resolved = resolve(await load(stack, { site: 'test' }), { slugStrategy: 'title' });
});

describe('feedSpecs', () => {
  test('one feed per collection; no combined feed for a single collection', () => {
    const specs = feedSpecs(resolved);
    expect(specs.map((s) => s.path)).toEqual(['/feeds/blog.xml']);
  });

  test('returns nothing for a site-less build', () => {
    expect(feedSpecs({ ...resolved, site: null })).toEqual([]);
  });
});

describe('atomFeed', () => {
  test('lists listed members newest-first, respects the limit, and omits unlisted', () => {
    const [spec] = feedSpecs(resolved);
    const xml = atomFeed(spec, resolved, 1);
    expect(xml.match(/<entry>/g)).toHaveLength(1);
    expect(xml).toContain('<title>Newer</title>');
    expect(xml).not.toContain('Hidden');
  });

  test('uses the stored url as the entry id when the record lives elsewhere', () => {
    const [spec] = feedSpecs(resolved);
    const xml = atomFeed(spec, resolved, 10);
    expect(xml).toContain('<id>https://other.test/x/</id>');
    expect(xml).toContain('<summary>the newer one</summary>');
    expect(xml).toContain('<author><name>');
  });
});

describe('sitemapXml', () => {
  test('is every resolved permalink minus the unlisted, absolute', () => {
    const xml = sitemapXml(resolved)!;
    expect(xml).toContain('<loc>https://ex.test/blog/</loc>');
    expect(xml).toContain('<loc>https://ex.test/blog/newer/</loc>');
    expect(xml).not.toContain('/blog/hidden/');
  });

  test('is null without a site record', () => {
    expect(sitemapXml({ ...resolved, site: null })).toBeNull();
  });
});
