import { beforeEach, describe, expect, test } from 'vitest';
import { Stack, type Association, type Permission } from '@haverstack/core';
import { MemoryAdapter } from '@haverstack/core/testing';
import { ARTICLE, PAGE, SITE } from '@haverstack/commons';
import {
  checkExitCode,
  defineEleventyTypes,
  FOR_SITE_LABEL,
  formatCheckReport,
  MENU,
  PAGE_META,
  runCheck,
  SITE_MEMBERSHIP_LABEL,
} from '../src/index.js';

const PUBLIC: Permission[] = [{ access: 'public' }];
const iso = (d: string) => new Date(d).toISOString();
const onSite = (id: string): Association => ({
  kind: 'relationship',
  label: SITE_MEMBERSHIP_LABEL,
  target: { scope: 'record', recordId: id },
});
const forSite = (id: string): Association => ({
  kind: 'relationship',
  label: FOR_SITE_LABEL,
  target: { scope: 'record', recordId: id },
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
    { title: 'P', baseUrl: 'https://p.example', handle: 'personal' },
    { permissions: PUBLIC },
  );
  const professional = await stack.create(
    SITE.id,
    { title: 'Q', baseUrl: 'https://q.example', handle: 'professional' },
    { permissions: PUBLIC },
  );
  const page = (parentId: string, content: Record<string, unknown>) =>
    stack.create(
      PAGE.id,
      { text: 'x', publishedAt: iso('2025-01-01'), ...content },
      { parentId, permissions: PUBLIC },
    );
  const article = (title: string, sites: string[], extra: Record<string, unknown> = {}) =>
    stack.create(
      ARTICLE.id,
      { title, text: 'b', publishedAt: iso('2025-02-01'), ...extra },
      { permissions: PUBLIC, associations: sites.map(onSite) },
    );

  await page(personal.id, { slug: 'index', title: 'Home' });
  await page(personal.id, {
    slug: 'articles',
    title: 'Articles',
    collection: { typeId: ARTICLE.id },
  });
  return { personal, professional, page, article };
}

describe('runCheck', () => {
  test('a clean site passes with exit code 0', async () => {
    await twoSites();
    const report = await runCheck(stack, { site: 'personal' });
    expect(report.failures).toEqual([]);
    expect(checkExitCode(report)).toBe(0);
    expect(formatCheckReport(report)).toContain('OK');
  });

  test('reports path collisions and same-scope sidecar conflicts as failures', async () => {
    const { personal, page, article } = await twoSites();
    await page(personal.id, { slug: 'dup', title: 'A' });
    await page(personal.id, { slug: 'dup', title: 'B' });

    const shared = await article('Shared', [personal.id]);
    await stack.create(PAGE_META.id, { slug: 'one' }, { parentId: shared.id, permissions: PUBLIC });
    await stack.create(PAGE_META.id, { slug: 'two' }, { parentId: shared.id, permissions: PUBLIC });

    const report = await runCheck(stack, { site: 'personal' });
    expect(report.failures.map((f) => f.kind).sort()).toEqual([
      'path-collision',
      'sidecar-conflict',
    ]);
    expect(checkExitCode(report)).toBe(1);
    expect(formatCheckReport(report)).toContain('FAIL');
  });

  test('warns on a dangling menu target and an ambiguous item', async () => {
    const { personal } = await twoSites();
    await stack.create(
      MENU.id,
      {
        handle: 'top-nav',
        items: [
          { label: 'Ghost', order: 1, recordId: 'nosuchrecord' },
          { label: 'Both', order: 2, url: 'https://x', recordId: 'alsobad' },
        ],
      },
      { parentId: personal.id, permissions: PUBLIC },
    );
    const kinds = (await runCheck(stack, { site: 'personal' })).warnings.map((w) => w.kind);
    expect(kinds).toContain('menu-dangling');
    expect(kinds).toContain('menu-item-ambiguous');
  });

  test('warns on a sidecar scoped to a site the record is not published on', async () => {
    const { personal, professional, article } = await twoSites();
    const a = await article('Personal only', [personal.id]);
    await stack.create(
      PAGE_META.id,
      { template: 'case-study' },
      { parentId: a.id, permissions: PUBLIC, associations: [forSite(professional.id)] },
    );
    const report = await runCheck(stack, { site: 'personal' });
    expect(report.warnings.some((w) => w.kind === 'sidecar-for-unpublished-site')).toBe(true);
  });

  test('warns on member records that belong to no site', async () => {
    await twoSites();
    await stack.create(
      ARTICLE.id,
      { title: 'Homeless', text: 'b', publishedAt: iso('2025-02-01') },
      { permissions: PUBLIC },
    );
    const report = await runCheck(stack, { site: 'personal' });
    expect(
      report.warnings.some((w) => w.kind === 'record-on-no-site' && w.message.includes('Homeless')),
    ).toBe(true);
  });

  test('lists unlisted records built this run, with the mechanism', async () => {
    const { personal, professional, article } = await twoSites();
    await stack.create(
      PAGE.id,
      { slug: 'secret', title: 'Secret', text: 'x', publishedAt: iso('2025-01-01') },
      { parentId: personal.id, permissions: PUBLIC, unlisted: true },
    );
    const rider = await article('Rider', [personal.id, professional.id]);
    await stack.create(
      PAGE_META.id,
      { hidden: true },
      { parentId: rider.id, permissions: PUBLIC, associations: [forSite(personal.id)] },
    );

    const info = (await runCheck(stack, { site: 'personal' })).info;
    expect(
      info.some((i) => i.message.includes('/secret/') && i.message.includes('unlistedAt')),
    ).toBe(true);
    expect(info.some((i) => i.message.includes('(hidden)') && i.message.includes('Rider'))).toBe(
      true,
    );
  });
});
