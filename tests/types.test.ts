import { beforeEach, describe, expect, test } from 'vitest';
import { Stack, StackSchemaDriftError } from '@haverstack/core';
import { MemoryAdapter } from '@haverstack/core/testing';
import { defineCommonsTypes, PAGE } from '@haverstack/commons';
import {
  CONSUMED_COMMONS_TYPES,
  defineEleventyTypes,
  ELEVENTY_NAMESPACE,
  ELEVENTY_TYPES,
  MENU,
  PAGE_META,
} from '../src/index.js';

let stack: Stack;

beforeEach(async () => {
  stack = await Stack.create(
    new MemoryAdapter({ ownerEntityId: 'did:key:zOwner', timezone: 'UTC' }),
  );
});

describe('defineEleventyTypes', () => {
  test('registers every consumed commons type and every owned sidecar', async () => {
    await defineEleventyTypes(stack);

    for (const type of [...CONSUMED_COMMONS_TYPES, ...ELEVENTY_TYPES]) {
      const registered = await stack.getType(type.id);
      expect(registered, type.id).not.toBeNull();
      expect(registered?.schema).toEqual(type.schema);
    }
  });

  test('is idempotent — a second call leaves createdAt untouched', async () => {
    await defineEleventyTypes(stack);
    const first = await stack.getType(PAGE_META.id);

    await defineEleventyTypes(stack);
    const second = await stack.getType(PAGE_META.id);

    expect(second?.createdAt.getTime()).toBe(first?.createdAt.getTime());
  });

  test('tolerates commons types already registered by the stack owner', async () => {
    await defineCommonsTypes(stack, [PAGE]);
    await expect(defineEleventyTypes(stack)).resolves.toBeUndefined();
  });

  test('propagates a genuine schema conflict on a sidecar type', async () => {
    await stack.defineType(PAGE_META.id, 'Page Metadata', {
      slug: { kind: 'number' },
    });

    await expect(defineEleventyTypes(stack)).rejects.toBeInstanceOf(StackSchemaDriftError);
  });
});

describe('sidecar type definitions', () => {
  test('are namespaced under org.haverstack.eleventy at version 1', () => {
    for (const type of ELEVENTY_TYPES) {
      expect(type.id).toMatch(
        new RegExp(`^${ELEVENTY_NAMESPACE.replace(/\./g, '\\.')}/[a-z-]+@1$`),
      );
    }
  });

  test('page-meta carries the per-site draft field', () => {
    expect(PAGE_META.schema.draft).toEqual({ kind: 'boolean' });
    expect(PAGE_META.schema.hidden).toEqual({ kind: 'boolean' });
  });

  test('page-meta has no required fields — a sidecar exists only when it has something to say', () => {
    for (const field of Object.values(PAGE_META.schema)) {
      expect('required' in field && field.required).toBeFalsy();
    }
  });

  test('menu requires a handle and carries an items array of objects', () => {
    expect(MENU.schema.handle).toEqual({ kind: 'string', required: true });
    const items = MENU.schema.items;
    expect(items.kind).toBe('array');
    if (items.kind !== 'array' || !items.items) throw new Error('unreachable');
    expect(items.items.kind).toBe('object');
  });
});
