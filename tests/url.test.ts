import { describe, expect, test } from 'vitest';
import { stripTrailingSlashes, trimSlashes } from '../src/url.js';

describe('stripTrailingSlashes', () => {
  test('removes one or more trailing slashes', () => {
    expect(stripTrailingSlashes('https://x.com/')).toBe('https://x.com');
    expect(stripTrailingSlashes('https://x.com///')).toBe('https://x.com');
  });

  test('leaves a string with no trailing slash alone', () => {
    expect(stripTrailingSlashes('https://x.com')).toBe('https://x.com');
  });

  test('an all-slash string reduces to empty', () => {
    expect(stripTrailingSlashes('///')).toBe('');
    expect(stripTrailingSlashes('')).toBe('');
  });
});

describe('trimSlashes', () => {
  test('removes leading and trailing slashes', () => {
    expect(trimSlashes('/foo/bar/')).toBe('foo/bar');
  });

  test('leaves interior slashes and a slash-free string alone', () => {
    expect(trimSlashes('foo/bar')).toBe('foo/bar');
  });

  test('an all-slash string reduces to empty', () => {
    expect(trimSlashes('///')).toBe('');
    expect(trimSlashes('')).toBe('');
  });
});
