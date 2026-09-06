import { beforeEach, describe, expect, test } from 'vitest';
import { Stack, type Association, type Permission } from '@haverstack/core';
import { MemoryAdapter } from '@haverstack/core/testing';
import { ARTICLE, PAGE, POST, SITE } from '@haverstack/commons';
import {
  defineEleventyTypes,
  FOR_SITE_LABEL,
  HaverstackEleventyError,
  load,
  MENU,
  PAGE_META,
  resolve,
  SITE_MEMBERSHIP_LABEL,
  type ResolveConfig,
} from '../src/index.js';

const PUBLIC: Permission[] = [{ access: 'public' }];
const iso = (d: string) => new Date(d).toISOString();
const CONFIG: ResolveConfig = { slugStrategy: 'title' };

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

async function worked() {
  const personal = await stack.create(
    SITE.id,
    { title: 'Personal', baseUrl: 'https://p.example', handle: 'personal' },
    { permissions: PUBLIC },
  );
  const professional = await stack.create(
    SITE.id,
    { title: 'Pro', baseUrl: 'https://q.example', handle: 'professional' },
    { permissions: PUBLIC },
  );

  const page = (
    parentId: string,
    content: Record<string, unknown>,
    opts: Record<string, unknown> = {},
  ) =>
    stack.create(
      PAGE.id,
      { text: 'x', publishedAt: iso('2025-01-01'), ...content },
      { parentId, permissions: PUBLIC, ...opts },
    );
  const meta = (
    parentId: string,
    content: Record<string, unknown>,
    associations: Association[] = [],
  ) => stack.create(PAGE_META.id, content, { parentId, permissions: PUBLIC, associations });
  const article = (
    content: Record<string, unknown>,
    sites: string[],
    opts: { publishedAt?: string; unlisted?: boolean } = {},
  ) =>
    stack.create(
      ARTICLE.id,
      { text: 'body', ...content, ...(opts.publishedAt ? { publishedAt: opts.publishedAt } : {}) },
      { permissions: PUBLIC, associations: sites.map(onSite), unlisted: opts.unlisted },
    );

  const pIndex = await page(personal.id, { slug: 'index', title: 'Home' });
  const pAbout = await page(personal.id, { slug: 'about', title: 'About' });
  const pHistory = await page(pAbout.id, { slug: 'history', title: 'History' });
  const pArticles = await page(personal.id, {
    slug: 'articles',
    title: 'Articles',
    collection: { typeId: ARTICLE.id, order: 'newest' },
  });
  const pEphemera = await page(personal.id, {
    slug: 'ephemera',
    title: 'Ephemera',
    collection: { typeId: POST.id },
  });
  await meta(pEphemera.id, { template: 'listing-inline' });

  const qIndex = await page(professional.id, { slug: 'index', title: 'Home' });
  const qWriting = await page(professional.id, {
    slug: 'writing',
    title: 'Writing',
    collection: { typeId: ARTICLE.id, order: 'newest' },
  });

  const rewrite = await article(
    { title: 'Why I rewrote my site' },
    [personal.id, professional.id],
    {
      publishedAt: iso('2025-02-10'),
    },
  );
  await meta(rewrite.id, { slug: 'why-i-rewrote-my-site' });
  await meta(rewrite.id, { slug: 'site-rebuild', template: 'case-study', order: 1 }, [
    forSite(professional.id),
  ]);

  const bread = await article({ title: 'Bread notes, week 12' }, [personal.id], {
    publishedAt: iso('2025-03-01'),
  });
  await article({ title: 'On schema governance' }, [professional.id], {
    publishedAt: iso('2025-01-20'),
  });
  const draftA = await article({ title: 'The next thing' }, [personal.id]); // no publishedAt
  const old = await article({ title: 'Old setup guide' }, [personal.id], {
    publishedAt: iso('2019-06-01'),
    unlisted: true,
  });
  const rider = await article({ title: 'Consulting rider' }, [personal.id, professional.id], {
    publishedAt: iso('2025-02-25'),
  });
  await meta(rider.id, { hidden: true }, [forSite(professional.id)]);

  const p1 = await stack.create(
    POST.id,
    { text: 'first frost' },
    { permissions: PUBLIC, associations: [onSite(personal.id)] },
  );
  const pdraft = await stack.create(
    POST.id,
    { text: 'half-written' },
    { permissions: PUBLIC, associations: [onSite(personal.id)] },
  );
  await meta(pdraft.id, { draft: true });

  await stack.create(
    MENU.id,
    {
      handle: 'top-nav',
      items: [
        { label: 'Home', order: 1, recordId: pIndex.id },
        { label: 'Articles', order: 2, recordId: pArticles.id },
        { label: 'About', order: 3, recordId: pAbout.id },
      ],
    },
    { parentId: personal.id, permissions: PUBLIC },
  );
  await stack.create(
    MENU.id,
    {
      handle: 'top-nav',
      items: [
        { label: 'Home', order: 1, recordId: qIndex.id },
        { label: 'Writing', order: 2, recordId: qWriting.id },
        { label: 'Personal', order: 3, recordId: pAbout.id },
        { label: 'GitHub', order: 4, url: 'https://github.com/x', rel: 'me' },
        { label: 'Broken', order: 5, recordId: 'deadbeef01ab' },
      ],
    },
    { parentId: professional.id, permissions: PUBLIC },
  );

  return {
    personal,
    professional,
    pAbout,
    pHistory,
    rewrite,
    bread,
    draftA,
    old,
    rider,
    p1,
    pdraft,
  };
}

async function resolveSite(site: string) {
  return resolve(await load(stack, { site }), CONFIG);
}

describe('resolve — pages', () => {
  test('permalinks drop index and nest by ancestry', async () => {
    await worked();
    const r = await resolveSite('personal');
    const urls = [...r.pagesByUrl.keys()].sort();
    expect(urls).toEqual(['/', '/about/', '/about/history/', '/articles/', '/ephemera/']);
  });

  test('templates infer from shape unless a sidecar overrides', async () => {
    await worked();
    const r = await resolveSite('personal');
    expect(r.pagesByUrl.get('/')?.template).toBe('home');
    expect(r.pagesByUrl.get('/about/')?.template).toBe('content');
    expect(r.pagesByUrl.get('/articles/')?.template).toBe('listing');
    expect(r.pagesByUrl.get('/ephemera/')?.template).toBe('listing-inline');
  });
});

describe('resolve — members and the sidecar cascade', () => {
  test('derives a member slug by strategy and honours an explicit sidecar slug', async () => {
    await worked();
    const r = await resolveSite('personal');
    const byTitle = r.members.find((m) => m.record.content.title === 'Bread notes, week 12');
    expect(byTitle?.url).toBe('/articles/bread-notes-week-12/');
    expect(byTitle?.slugExplicit).toBe(false);

    const shared = r.members.find((m) => m.record.content.title === 'Why I rewrote my site');
    expect(shared?.url).toBe('/articles/why-i-rewrote-my-site/');
    expect(shared?.slugExplicit).toBe(true);
  });

  test('a for-site sidecar overrides slug and template on that site only', async () => {
    await worked();
    const r = await resolveSite('professional');
    const shared = r.members.find((m) => m.record.content.title === 'Why I rewrote my site');
    expect(shared?.url).toBe('/writing/site-rebuild/');
    expect(shared?.template).toBe('case-study');
    expect(shared?.meta.order).toBe(1);
  });

  test('a shared article is canonical on the site that has no stored url yet', async () => {
    await worked();
    const r = await resolveSite('personal');
    const shared = r.members.find((m) => m.record.content.title === 'Why I rewrote my site');
    expect(shared?.canonical).toBeNull();
  });
});

describe('resolve — draft, unlisted, hidden', () => {
  test('drafts are not built at all', async () => {
    await worked();
    const r = await resolveSite('personal');
    expect(r.members.some((m) => m.record.content.title === 'The next thing')).toBe(false);
    expect(r.members.some((m) => m.record.content.text === 'half-written')).toBe(false);
    expect(r.collections.get('ephemera')?.members).toHaveLength(1);
  });

  test('a globally unlisted article builds but joins no collection', async () => {
    await worked();
    const r = await resolveSite('personal');
    const old = r.members.find((m) => m.record.content.title === 'Old setup guide');
    expect(old?.unlisted).toBe(true);
    expect(r.collections.get('articles')?.members.some((m) => m === old)).toBe(false);
  });

  test('page-meta.hidden excludes a member from one site and not the other', async () => {
    await worked();
    const pro = await resolveSite('professional');
    const rider = pro.members.find((m) => m.record.content.title === 'Consulting rider');
    expect(rider?.unlisted).toBe(true);
    expect(pro.collections.get('writing')?.members.some((m) => m === rider)).toBe(false);

    const personal = await resolveSite('personal');
    expect(
      personal.collections
        .get('articles')
        ?.members.some((m) => m.record.content.title === 'Consulting rider'),
    ).toBe(true);
  });

  test('collections sort newest-first by the meaningful date', async () => {
    await worked();
    const r = await resolveSite('personal');
    const titles = r.collections.get('articles')?.members.map((m) => m.record.content.title);
    expect(titles).toEqual(['Bread notes, week 12', 'Consulting rider', 'Why I rewrote my site']);
  });
});

describe('resolve — fatal faults', () => {
  test('two sidecars at the same scope throw', async () => {
    const { rewrite } = await worked();
    await stack.create(
      PAGE_META.id,
      { slug: 'dupe' },
      { parentId: rewrite.id, permissions: PUBLIC },
    );
    await expect(resolveSite('personal')).rejects.toBeInstanceOf(HaverstackEleventyError);
  });

  test('a path collision names both records', async () => {
    const site = await stack.create(
      SITE.id,
      { title: 'C', baseUrl: 'https://c', handle: 'c' },
      { permissions: PUBLIC },
    );
    const a = await stack.create(
      PAGE.id,
      { slug: 'dup', text: 'x', publishedAt: iso('2025-01-01') },
      { parentId: site.id, permissions: PUBLIC },
    );
    const b = await stack.create(
      PAGE.id,
      { slug: 'dup', text: 'x', publishedAt: iso('2025-01-01') },
      { parentId: site.id, permissions: PUBLIC },
    );
    await expect(resolveSite('c')).rejects.toThrow(new RegExp(`${a.id}[\\s\\S]*${b.id}`));
  });
});

describe('resolve — menus', () => {
  test('resolves recordId items to permalinks and passes external urls through', async () => {
    await worked();
    const r = await resolveSite('professional');
    const items = r.menus.get('top-nav')!.items;
    expect(items.find((i) => i.label === 'Home')?.url).toBe('/');
    expect(items.find((i) => i.label === 'Writing')?.url).toBe('/writing/');
    expect(items.find((i) => i.label === 'GitHub')?.url).toBe('https://github.com/x');
    expect(items.find((i) => i.label === 'GitHub')?.rel).toBe('me');
  });

  test('a cross-site page target resolves to an absolute url on that site', async () => {
    await worked();
    const r = await resolveSite('professional');
    const item = r.menus.get('top-nav')!.items.find((i) => i.label === 'Personal');
    expect(item?.url).toBe('https://p.example/about/');
  });

  test('a dangling target becomes a warning, not a crash', async () => {
    await worked();
    const r = await resolveSite('professional');
    const broken = r.menus.get('top-nav')!.items.find((i) => i.label === 'Broken');
    expect(broken?.dangling).toBe(true);
    expect(broken?.url).toBe('#');
    expect(r.warnings.some((w) => w.kind === 'menu-dangling')).toBe(true);
  });
});
