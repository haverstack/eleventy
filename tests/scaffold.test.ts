import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { chdir, cwd } from 'node:process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { EJECTABLE_TEMPLATES, formatEjectResult, runEject } from '../src/index.js';

let dir: string;
let origin: string;

beforeEach(async () => {
  origin = cwd();
  dir = await mkdtemp(join(tmpdir(), 'hs-eject-'));
  chdir(dir);
});
afterEach(() => chdir(origin));

describe('runEject', () => {
  test('writes each ejectable template into the includes dir', async () => {
    const result = await runEject('_includes');
    expect(result.written).toEqual(EJECTABLE_TEMPLATES.map((t) => t.filename));
    expect(result.skipped).toEqual([]);
    for (const t of EJECTABLE_TEMPLATES) {
      const path = join(dir, '_includes', t.filename);
      expect(existsSync(path)).toBe(true);
      expect(await readFile(path, 'utf8')).toBe(t.contents);
    }
  });

  test('skips a file that already exists, unless --force', async () => {
    await runEject('_includes');
    const second = await runEject('_includes');
    expect(second.written).toEqual([]);
    expect(second.skipped).toEqual(EJECTABLE_TEMPLATES.map((t) => t.filename));

    const forced = await runEject('_includes', { force: true });
    expect(forced.written).toEqual(EJECTABLE_TEMPLATES.map((t) => t.filename));
  });

  test('honours a custom includes dir', async () => {
    await runEject('src/layouts');
    expect(existsSync(join(dir, 'src/layouts/haverstack-base.njk'))).toBe(true);
  });

  test('the base layout is Nunjucks that reads haverstack globals and content', () => {
    const base = EJECTABLE_TEMPLATES.find((t) => t.filename === 'haverstack-base.njk')!.contents;
    expect(base).toContain('{{ content | safe }}');
    expect(base).toContain('haverstack.site.content.title');
    expect(base).toContain('haverstack.menus');
  });

  test('formatEjectResult reports writes and the follow-up step', () => {
    const text = formatEjectResult({ written: ['haverstack-base.njk'], skipped: [] }, '_includes');
    expect(text).toContain('wrote    _includes/haverstack-base.njk');
    expect(text).toContain("templates: { base: 'haverstack-base' }");
  });
});
