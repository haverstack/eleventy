import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, test } from 'vitest';
import { Stack, type Permission } from '@haverstack/core';
import { MemoryAdapter } from '@haverstack/core/testing';
import { ARTICLE, PAGE, SITE } from '@haverstack/commons';
import {
  defineEleventyTypes,
  emit,
  load,
  PAGE_META,
  resolve,
  SITE_MEMBERSHIP_LABEL,
  type EmitEleventyConfig,
} from '../src/index.js';

const PUBLIC: Permission[] = [{ access: 'public' }];
const iso = (d: string) => new Date(d).toISOString();
const onSite = (id: string) => ({
  kind: 'relationship' as const,
  label: SITE_MEMBERSHIP_LABEL,
  target: { scope: 'record' as const, recordId: id },
});

class FakeConfig implements EmitEleventyConfig {
  templates: { path: string; content: string; data: Record<string, unknown> }[] = [];
  passthrough: unknown[] = [];
  globals: Record<string, unknown> = {};
  addTemplate(path: string, content: string, data: Record<string, unknown> = {}) {
    this.templates.push({ path, content, data });
  }
  addPassthroughCopy(path: unknown) {
    this.passthrough.push(path);
  }
  addGlobalData(name: string, value: unknown) {
    this.globals[name] = value;
  }
  permalinks() {
    return this.templates.map((t) => t.data.permalink);
  }
  byPermalink(p: string) {
    return this.templates.find((t) => t.data.permalink === p);
  }
}

let stack: Stack;

beforeEach(async () => {
  stack = await Stack.create(
    new MemoryAdapter({ ownerEntityId: 'did:key:zOwner', timezone: 'UTC' }),
  );
  await defineEleventyTypes(stack);
});

async function runEmit() {
  const site = await stack.create(
    SITE.id,
    { title: 'T', baseUrl: 'https://ex.test', handle: 't' },
    { permissions: PUBLIC },
  );
  await stack.create(
    PAGE.id,
    { slug: 'index', title: 'Home', text: '# hi', publishedAt: iso('2025-01-01') },
    { parentId: site.id, permissions: PUBLIC },
  );
  await stack.create(
    PAGE.id,
    {
      slug: 'blog',
      title: 'Blog',
      text: 'the blog',
      publishedAt: iso('2025-01-01'),
      collection: { typeId: ARTICLE.id, order: 'newest' },
    },
    { parentId: site.id, permissions: PUBLIC },
  );
  const article = (title: string, when: string | null, unlisted = false) =>
    stack.create(
      ARTICLE.id,
      { title, text: 'body', ...(when ? { publishedAt: iso(when) } : {}) },
      { permissions: PUBLIC, associations: [onSite(site.id)], unlisted },
    );
  await article('Live one', '2025-02-01');
  await article('Old one', '2025-01-10', true);
  const draft = await article('Draft one', null);
  await stack.create(PAGE_META.id, { draft: true }, { parentId: draft.id, permissions: PUBLIC });

  const index = await load(stack, { site: 't' });
  const resolved = resolve(index, { slugStrategy: 'title' });
  const config = new FakeConfig();
  const cwd = await mkdtemp(join(tmpdir(), 'hs-emit-'));
  const result = await emit({
    eleventyConfig: config,
    stack,
    resolved,
    index,
    assetDir: '_stack-assets',
    feedLimit: 20,
    cwd,
  });
  return { config, result, resolved };
}

describe('emit', () => {
  test('adds one template per built page and member, at the resolved permalink', async () => {
    const { config } = await runEmit();
    expect(config.byPermalink('/')?.data.haverstackTemplate).toBe('home');
    expect(config.byPermalink('/blog/')?.data.haverstackTemplate).toBe('listing');
    expect(config.byPermalink('/blog/live-one/')).toBeDefined();
    expect(config.byPermalink('/blog/old-one/')?.data.unlisted).toBe(true);
  });

  test('does not emit drafts', async () => {
    const { config } = await runEmit();
    expect(config.byPermalink('/blog/draft-one/')).toBeUndefined();
    expect(config.templates.some((t) => t.content.includes('Draft one'))).toBe(false);
  });

  test('emits a feed and a sitemap; the sitemap omits the unlisted member', async () => {
    const { config } = await runEmit();
    const feed = config.byPermalink('/feeds/blog.xml');
    expect(feed?.content).toContain('<feed xmlns="http://www.w3.org/2005/Atom">');
    const sitemap = config.byPermalink('/sitemap.xml');
    expect(sitemap?.content).toContain('https://ex.test/blog/live-one/');
    expect(sitemap?.content).not.toContain('/blog/old-one/');
  });

  test('passes the asset dir through and exposes haverstack global data', async () => {
    const { config } = await runEmit();
    expect(config.passthrough).toContain('_stack-assets');
    const data = config.globals.haverstack as Record<string, unknown>;
    expect(data.site).toBeTruthy();
    expect(Object.keys(data.collections as object)).toContain('blog');
    expect(data.menus).toBeDefined();
  });

  test('reports what it emitted', async () => {
    const { result } = await runEmit();
    expect(result.pages).toBe(2);
    expect(result.members).toBe(2); // Live one + Old one; Draft one excluded
    expect(result.feeds).toBe(1);
  });
});
