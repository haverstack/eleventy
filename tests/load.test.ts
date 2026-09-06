import { beforeEach, describe, expect, test } from 'vitest';
import { Stack, type Permission } from '@haverstack/core';
import { MemoryAdapter } from '@haverstack/core/testing';
import { ARTICLE, PAGE, SITE } from '@haverstack/commons';
import {
  defineEleventyTypes,
  FOR_SITE_LABEL,
  HaverstackEleventyError,
  load,
  MENU,
  PAGE_META,
  SITE_MEMBERSHIP_LABEL,
} from '../src/index.js';

const PUBLIC: Permission[] = [{ access: 'public' }];
const iso = (d: string) => new Date(d).toISOString();

const onSite = (siteId: string) => ({
  kind: 'relationship' as const,
  label: SITE_MEMBERSHIP_LABEL,
  target: { scope: 'record' as const, recordId: siteId },
});
const forSite = (siteId: string) => ({
  kind: 'relationship' as const,
  label: FOR_SITE_LABEL,
  target: { scope: 'record' as const, recordId: siteId },
});

let stack: Stack;

beforeEach(async () => {
  stack = await Stack.create(
    new MemoryAdapter({ ownerEntityId: 'did:key:zOwner', timezone: 'UTC' }),
  );
  await defineEleventyTypes(stack);
});

async function twoSites() {
  const personal = await stack.create(
    SITE.id,
    { title: 'Personal', baseUrl: 'https://p.example', handle: 'personal' },
    { permissions: PUBLIC },
  );
  const professional = await stack.create(
    SITE.id,
    { title: 'Pro', baseUrl: 'https://pro.example', handle: 'professional' },
    { permissions: PUBLIC },
  );

  const mkPage = (
    parentId: string,
    slug: string,
    extra: Record<string, unknown> = {},
    opts: Record<string, unknown> = {},
  ) =>
    stack.create(
      PAGE.id,
      { slug, text: slug, publishedAt: iso('2025-01-01'), ...extra },
      { parentId, permissions: PUBLIC, ...opts },
    );

  const pIndex = await mkPage(personal.id, 'index');
  const pAbout = await mkPage(personal.id, 'about');
  const pHistory = await mkPage(pAbout.id, 'history');
  const pArticles = await mkPage(personal.id, 'articles', {
    collection: { typeId: ARTICLE.id, order: 'newest' },
  });
  const pHidden = await mkPage(personal.id, 'secret', {}, { unlisted: true });

  const qIndex = await mkPage(professional.id, 'index');
  const qWriting = await mkPage(professional.id, 'writing', {
    collection: { typeId: ARTICLE.id },
  });

  const shared = await stack.create(
    ARTICLE.id,
    { title: 'Shared', text: 'body', publishedAt: iso('2025-02-01') },
    { permissions: PUBLIC, associations: [onSite(personal.id), onSite(professional.id)] },
  );
  await stack.create(
    PAGE_META.id,
    { slug: 'shared' },
    { parentId: shared.id, permissions: PUBLIC },
  );
  await stack.create(
    PAGE_META.id,
    { slug: 'shared-pro', template: 'case-study' },
    { parentId: shared.id, permissions: PUBLIC, associations: [forSite(professional.id)] },
  );

  await stack.create(
    MENU.id,
    { handle: 'top-nav', items: [{ label: 'Home', order: 1, recordId: pIndex.id }] },
    { parentId: personal.id, permissions: PUBLIC },
  );
  await stack.create(
    MENU.id,
    { handle: 'top-nav', items: [{ label: 'Home', order: 1, recordId: qIndex.id }] },
    { parentId: professional.id, permissions: PUBLIC },
  );

  return { personal, professional, pIndex, pAbout, pHistory, pArticles, pHidden, qWriting, shared };
}

describe('load — site resolution', () => {
  test('resolves the site by handle', async () => {
    await twoSites();
    const index = await load(stack, { site: 'personal' });
    expect(index.site?.content.handle).toBe('personal');
  });

  test('resolves the site by record id', async () => {
    const { professional } = await twoSites();
    const index = await load(stack, { site: professional.id });
    expect(index.site?.id).toBe(professional.id);
  });

  test('throws on an unknown site', async () => {
    await twoSites();
    await expect(load(stack, { site: 'nope' })).rejects.toBeInstanceOf(HaverstackEleventyError);
  });

  test('throws when a handle is ambiguous', async () => {
    await stack.create(
      SITE.id,
      { title: 'A', baseUrl: 'https://a', handle: 'dup' },
      { permissions: PUBLIC },
    );
    await stack.create(
      SITE.id,
      { title: 'B', baseUrl: 'https://b', handle: 'dup' },
      { permissions: PUBLIC },
    );
    await expect(load(stack, { site: 'dup' })).rejects.toThrow(/resolves to 2 records/);
  });

  test('throws when the site option is omitted but site records exist', async () => {
    await twoSites();
    await expect(load(stack)).rejects.toThrow(/personal/);
    await expect(load(stack)).rejects.toThrow(/professional/);
  });

  test('single-site: null site, roots are the parentless pages', async () => {
    await stack.create(
      PAGE.id,
      { slug: 'index', text: 'home', publishedAt: iso('2025-01-01') },
      { permissions: PUBLIC },
    );
    await stack.create(
      PAGE.id,
      { slug: 'about', text: 'about', publishedAt: iso('2025-01-01') },
      { permissions: PUBLIC },
    );
    const index = await load(stack);
    expect(index.site).toBeNull();
    expect(index.pageRoots.map((n) => n.record.content.slug).sort()).toEqual(['about', 'index']);
  });
});

describe('load — indexes', () => {
  test('prunes the page tree to the named site and nests children', async () => {
    const { pAbout, pHistory } = await twoSites();
    const index = await load(stack, { site: 'personal' });

    const slugs = [...index.pagesById.values()].map((n) => n.record.content.slug).sort();
    expect(slugs).toEqual(['about', 'articles', 'history', 'index', 'secret']);

    const about = index.pagesById.get(pAbout.id);
    expect(about?.children.map((c) => c.record.id)).toEqual([pHistory.id]);
    expect(index.pagesById.get(pHistory.id)?.parent?.record.id).toBe(pAbout.id);
    expect(index.pageRoots.some((n) => n.record.content.slug === 'history')).toBe(false);
  });

  test('splits sidecars into unscoped, this-site, and by-site', async () => {
    const { professional, shared } = await twoSites();

    const personalView = await load(stack, { site: 'personal' });
    const setP = personalView.sidecarsByParent.get(shared.id);
    expect(setP?.unscoped).toHaveLength(1);
    expect(setP?.thisSite).toHaveLength(0);
    expect(setP?.bySite.get(professional.id)).toHaveLength(1);

    const proView = await load(stack, { site: 'professional' });
    const setPro = proView.sidecarsByParent.get(shared.id);
    expect(setPro?.unscoped).toHaveLength(1);
    expect(setPro?.thisSite).toHaveLength(1);
    expect(setPro?.thisSite[0].content.slug).toBe('shared-pro');
  });

  test('every sidecar parent resolves through byId, even an unfetched member', async () => {
    const { shared } = await twoSites();
    const index = await load(stack, { site: 'personal' });
    // `shared` is an article — never bulk-fetched by load — but it carries a sidecar.
    expect(index.byId.get(shared.id)?.content.title).toBe('Shared');
    for (const parentId of index.sidecarsByParent.keys()) {
      expect(index.byId.has(parentId), parentId).toBe(true);
    }
  });

  test('filters menus to the named site and groups by handle', async () => {
    const { personal } = await twoSites();
    const index = await load(stack, { site: 'personal' });
    expect(index.menus).toHaveLength(1);
    expect(index.menus[0].parentId).toBe(personal.id);
    expect(index.menusByHandle.get('top-nav')).toHaveLength(1);
  });

  test('groups attachment metadata by fileId, earliest createdAt first', async () => {
    await stack.create(
      '_attachment@1',
      { fileId: 'aaaa', mimeType: 'image/png', size: 1, filename: 'newer.png' },
      { permissions: PUBLIC, createdAt: new Date('2025-06-01') },
    );
    await stack.create(
      '_attachment@1',
      { fileId: 'aaaa', mimeType: 'image/png', size: 1, filename: 'older.png' },
      { permissions: PUBLIC, createdAt: new Date('2024-01-01') },
    );

    const index = await load(stack);
    const group = index.attachmentsByFileId.get('aaaa');
    expect(group?.map((r) => r.content.filename)).toEqual(['older.png', 'newer.png']);
  });

  test('walks pagination past a single page', async () => {
    const site = await stack.create(
      SITE.id,
      { title: 'Big', baseUrl: 'https://big', handle: 'big' },
      { permissions: PUBLIC },
    );
    for (let i = 0; i < 60; i++) {
      await stack.create(
        PAGE.id,
        { slug: `p${i}`, text: 'x', publishedAt: iso('2025-01-01') },
        { parentId: site.id, permissions: PUBLIC },
      );
    }
    const index = await load(stack, { site: 'big' });
    expect(index.pagesById.size).toBe(60);
  });
});

describe('load — unlisted visibility', () => {
  test('an owner build sees unlisted pages', async () => {
    await twoSites();
    const index = await load(stack, { site: 'personal' });
    expect(index.unlistedVisible).toBe(true);
    expect([...index.pagesById.values()].some((n) => n.record.content.slug === 'secret')).toBe(
      true,
    );
  });

  test('a scoped non-owner build loses them and records that it did', async () => {
    await twoSites();
    const scoped = stack.asEntity('did:key:zStranger');
    const index = await load(scoped, { site: 'personal' });
    expect(index.unlistedVisible).toBe(false);
    expect([...index.pagesById.values()].some((n) => n.record.content.slug === 'secret')).toBe(
      false,
    );
  });
});
