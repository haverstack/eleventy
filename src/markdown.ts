/**
 * @haverstack/eleventy — body rendering
 * -------------------------------------------------------
 * A plugin-owned markdown-it instance so record bodies render the same
 * regardless of the host's markdown config. Embed substitution runs first
 * (it rewrites link and image targets in the source text); the result is
 * sanitized, because a stack can hold records written by more than one
 * person and sanitizing on render costs little.
 *
 * `format` follows the commons vocabulary: `markdown` when absent, `plain`
 * when set, and any unrecognised value rendered as plain — never a richer
 * format than the record declares. See docs/design.md § Markdown.
 */

import MarkdownIt from 'markdown-it';
import sanitizeHtml from 'sanitize-html';

const md = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: true,
  langPrefix: 'language-',
});

const SANITIZE: sanitizeHtml.IOptions = {
  allowedTags: [
    ...sanitizeHtml.defaults.allowedTags,
    'img',
    'figure',
    'figcaption',
    'picture',
    'source',
    'h1',
    'h2',
    'del',
    'ins',
    'sup',
    'sub',
    'abbr',
  ],
  allowedAttributes: {
    ...sanitizeHtml.defaults.allowedAttributes,
    a: ['href', 'name', 'id', 'target', 'rel'],
    img: ['src', 'srcset', 'alt', 'title', 'width', 'height', 'loading'],
    source: ['src', 'srcset', 'type', 'media', 'sizes'],
    code: ['class'],
    span: ['class'],
    '*': ['id'],
  },
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
};

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Rewrite `](filename)` / `](<filename>)` targets to their staged asset paths. */
function substituteEmbeds(text: string, embeds: Map<string, string>): string {
  let out = text;
  for (const [filename, assetPath] of embeds) {
    const literal = filename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out
      .replace(new RegExp(`\\]\\(<${literal}>\\)`, 'g'), `](<${assetPath}>)`)
      .replace(new RegExp(`\\]\\(${literal}(\\s|\\))`, 'g'), `](${assetPath}$1`);
  }
  return out;
}

export function renderMarkdown(text: string): string {
  return sanitizeHtml(md.render(text), SANITIZE);
}

export function renderPlain(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((para) => `<p>${escapeHtml(para).replace(/\n/g, '<br>\n')}</p>`)
    .join('\n');
}

export function renderBody(text: string, format: unknown, embeds?: Map<string, string>): string {
  const isMarkdown = format === undefined || format === 'markdown';
  if (!isMarkdown) return renderPlain(text);
  const source = embeds && embeds.size > 0 ? substituteEmbeds(text, embeds) : text;
  return renderMarkdown(source);
}
