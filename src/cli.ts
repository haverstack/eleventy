#!/usr/bin/env node
/**
 * @haverstack/eleventy — the `haverstack-eleventy` CLI
 * -------------------------------------------------------
 * Two commands that sit alongside the build:
 *
 *   haverstack-eleventy check     load + resolve, report problems, write nothing
 *   haverstack-eleventy publish   stamp canonical URLs on articles and posts
 *
 * Both need a stack. They read it from a config module — the same place a
 * project already builds one for `eleventy.config.js` — so the plugin
 * package never has to know about adapters or credentials.
 */

import { existsSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import type { Stack } from '@haverstack/core';
import { checkExitCode, formatCheckReport, runCheck } from './check.js';
import { formatPublishReport, runPublish } from './publish.js';
import { formatEjectResult, runEject } from './scaffold.js';
import type { SlugStrategy } from './resolve.js';

const USAGE = `haverstack-eleventy <command> [options]

Commands:
  check      Load and resolve the site; report structural problems. Writes nothing.
  publish    Stamp canonical URLs on articles and posts that lack one.
  eject      Write a starter haverstack-base layout into _includes for editing.

Options:
  --config <path>            check/publish: module providing the stack
                             (default: ./haverstack.config.mjs). Default-exports a Stack,
                             a { stack, site? }, or a function returning one.
  --site <handle>            Site to build. Overrides the config's default.
  --slug-strategy <s>        'title' (default) or 'recordId'.
  --dry-run                  publish: show what would be written, write nothing.
  --includes-dir <path>      eject: where to write (default: _includes).
  --force                    eject: overwrite existing files.
  -h, --help
`;

async function loadStack(configPath: string): Promise<{ stack: Stack; site?: string }> {
  const abs = resolvePath(process.cwd(), configPath);
  if (!existsSync(abs)) {
    throw new Error(
      `Config not found: ${configPath}\n` +
        'Create one that default-exports your Stack (or { stack, site }), or pass --config.',
    );
  }
  const mod = (await import(pathToFileURL(abs).href)) as Record<string, unknown>;
  let value: unknown = mod.default ?? mod.stack ?? mod;
  if (typeof value === 'function') value = await (value as () => unknown)();

  const asRecord = value as { stack?: unknown; site?: unknown; query?: unknown };
  if (asRecord && typeof asRecord.stack === 'object' && asRecord.stack) {
    return { stack: asRecord.stack as Stack, site: asRecord.site as string | undefined };
  }
  if (asRecord && typeof asRecord.query === 'function') {
    return { stack: value as Stack };
  }
  throw new Error(
    'Config must default-export a Stack, a { stack, site? }, or a function returning one.',
  );
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      config: { type: 'string' },
      site: { type: 'string' },
      'slug-strategy': { type: 'string' },
      'dry-run': { type: 'boolean' },
      'includes-dir': { type: 'string' },
      force: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });

  const command = positionals[0];
  if (values.help || !command) {
    process.stdout.write(USAGE);
    process.exit(values.help ? 0 : 1);
  }
  if (command !== 'check' && command !== 'publish' && command !== 'eject') {
    process.stderr.write(`Unknown command: ${command}\n\n${USAGE}`);
    process.exit(1);
  }

  if (command === 'eject') {
    const dir = values['includes-dir'] ?? '_includes';
    const result = await runEject(dir, { force: Boolean(values.force) });
    process.stdout.write(`${formatEjectResult(result, dir)}\n`);
    process.exit(0);
  }

  const strategy = values['slug-strategy'];
  if (strategy && strategy !== 'title' && strategy !== 'recordId') {
    process.stderr.write('--slug-strategy must be "title" or "recordId".\n');
    process.exit(1);
  }
  const slugStrategy = (strategy ?? 'title') as SlugStrategy;

  const { stack, site: configSite } = await loadStack(values.config ?? './haverstack.config.mjs');
  const site = values.site ?? configSite;

  try {
    if (command === 'check') {
      const report = await runCheck(stack, { site, slugStrategy });
      process.stdout.write(`${formatCheckReport(report)}\n`);
      await stack.close();
      process.exit(checkExitCode(report));
    } else {
      const report = await runPublish(stack, {
        site,
        slugStrategy,
        dryRun: Boolean(values['dry-run']),
      });
      process.stdout.write(`${formatPublishReport(report)}\n`);
      await stack.close();
      process.exit(0);
    }
  } catch (err) {
    process.stderr.write(`\n${err instanceof Error ? err.message : String(err)}\n`);
    await stack.close().catch(() => {});
    process.exit(1);
  }
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
