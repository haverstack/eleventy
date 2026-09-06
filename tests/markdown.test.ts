import { describe, expect, test } from 'vitest';
import { renderBody } from '../src/index.js';

describe('renderBody', () => {
  test('renders markdown when format is absent or "markdown"', () => {
    expect(renderBody('# Hi\n\ntext', undefined)).toContain('<h1>Hi</h1>');
    expect(renderBody('*em*', 'markdown')).toContain('<em>em</em>');
  });

  test('renders any other format as escaped plain text', () => {
    expect(renderBody('# not a heading', 'plain')).toBe('<p># not a heading</p>');
    expect(renderBody('a < b & c', 'plain')).toBe('<p>a &lt; b &amp; c</p>');
    expect(renderBody('*stars*', 'org')).toBe('<p>*stars*</p>');
  });

  test('sanitizes rendered markdown', () => {
    const html = renderBody(
      'ok <script>alert(1)</script> <a href="javascript:x">bad</a>',
      'markdown',
    );
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('javascript:');
  });

  test('substitutes embed filenames before parsing — image, angle-bracket, and titled forms', () => {
    const embeds = new Map([['diagram.png', '/_stack-assets/abc.png']]);
    expect(renderBody('![d](diagram.png)', 'markdown', embeds)).toContain(
      'src="/_stack-assets/abc.png"',
    );
    expect(renderBody('[link](<diagram.png>)', 'markdown', embeds)).toContain(
      'href="/_stack-assets/abc.png"',
    );
    expect(renderBody('![d](diagram.png "cap")', 'markdown', embeds)).toContain('title="cap"');
  });

  test('leaves an unreferenced filename alone', () => {
    const embeds = new Map([['other.png', '/_stack-assets/xyz.png']]);
    expect(renderBody('![d](diagram.png)', 'markdown', embeds)).toContain('src="diagram.png"');
  });
});
