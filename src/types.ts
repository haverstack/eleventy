/**
 * @haverstack/eleventy — type registration
 * -------------------------------------------------------
 * The record types this integration reads and the two sidecar types it
 * owns, plus `defineEleventyTypes()` to register the whole set on a stack.
 *
 * Consumed commons types are registered exactly as `@haverstack/commons`
 * defines them. The sidecars — `page-meta` and `menu` — are this package's
 * own, minted under `org.haverstack.eleventy`: a first-party namespace
 * under the same authority as the commons, but not a commons type and not
 * under commons governance. See site-generator-types.md § Namespace.
 */

import { Stack, StackPermissionError, type TypeId, type TypeSchema } from '@haverstack/core';
import { ARTICLE, BOOKMARK, PAGE, PHOTO, POST, SITE } from '@haverstack/commons';

/** Reverse-DNS namespace for the sidecar types this package owns. */
export const ELEVENTY_NAMESPACE = 'org.haverstack.eleventy';

/**
 * Association label that scopes a `page-meta` sidecar to one site. This
 * package's own label, deliberately distinct from the commons `site`
 * membership convention below: a sidecar carrying `for-site` is published
 * nowhere — it is metadata that applies when that site builds. See
 * site-generator-types.md § Sidecars are scoped.
 */
export const FOR_SITE_LABEL = 'for-site';

/**
 * Commons cross-type convention: an `article`, `post`, `photo` or
 * `bookmark` carrying this relationship is published on that site.
 */
export const SITE_MEMBERSHIP_LABEL = 'site';

/** Commons cross-type convention for body-embedded media. */
export const EMBED_LABEL = 'embed';

/** A registrable type: an id, a display name, and a content schema. */
export interface EleventyType {
  readonly id: TypeId;
  readonly name: string;
  readonly schema: TypeSchema;
}

/**
 * `org.haverstack.eleventy/page-meta@1` — generator metadata about a record
 * it does not own, linked to that record by `parentId`. Every field is
 * optional: a page-meta record exists only when it has something to say.
 * See site-generator-types.md § page-meta.
 */
export const PAGE_META: EleventyType = {
  id: `${ELEVENTY_NAMESPACE}/page-meta@1`,
  name: 'Page Metadata',
  schema: {
    slug: { kind: 'string' },
    template: { kind: 'string' },
    order: { kind: 'number' },
    hidden: { kind: 'boolean' },
    draft: { kind: 'boolean' },
  },
};

/**
 * `org.haverstack.eleventy/menu@1` — a named, ordered navigation menu
 * belonging to one site (`parentId` = the site). Items live in the content
 * array rather than as separate records because menus are small and edited
 * as a unit. See site-generator-types.md § menu.
 */
export const MENU: EleventyType = {
  id: `${ELEVENTY_NAMESPACE}/menu@1`,
  name: 'Menu',
  schema: {
    handle: { kind: 'string', required: true },
    label: { kind: 'string' },
    items: {
      kind: 'array',
      items: {
        kind: 'object',
        properties: {
          label: { kind: 'string', required: true },
          order: { kind: 'number', required: true },
          url: { kind: 'string' },
          recordId: { kind: 'record-ref' },
          rel: { kind: 'string' },
        },
      },
    },
  },
};

/**
 * Content shape of a `page-meta@1` record. `slug` overrides a listing
 * member's derived permalink; `template` names a template in the building
 * site's own vocabulary; `order` is a reserved curated-position field, not
 * read until curated collections land; `hidden` keeps the record out of
 * this site's indexes while still building it; `draft` keeps it from being
 * built at all on this site.
 */
export interface PageMeta {
  slug?: string;
  template?: string;
  order?: number;
  hidden?: boolean;
  draft?: boolean;
}

/** One item in a `menu@1`. An item sets `url` or `recordId`, never both. */
export interface MenuItem {
  label: string;
  order: number;
  url?: string;
  recordId?: string;
  rel?: string;
}

/** Content shape of a `menu@1` record. */
export interface Menu {
  handle: string;
  label?: string;
  items: MenuItem[];
}

/**
 * The commons publishing types this integration reads. `_entity@1` and
 * `_attachment@1` are also read but are system types every stack already
 * seeds, so they need no registration here.
 */
export const CONSUMED_COMMONS_TYPES: readonly EleventyType[] = [
  SITE,
  PAGE,
  ARTICLE,
  POST,
  PHOTO,
  BOOKMARK,
];

/** The sidecar types this package owns. */
export const ELEVENTY_TYPES: readonly EleventyType[] = [PAGE_META, MENU];

/**
 * Register one type, tolerating a scoped credential that cannot define
 * types: a non-owner build is legitimate as long as whoever populated the
 * stack already registered it. A genuine schema conflict
 * (`StackSchemaDriftError`) still propagates — that is a real error.
 */
async function ensureType(stack: Stack, type: EleventyType): Promise<void> {
  try {
    await stack.defineType(type.id, type.name, type.schema);
  } catch (err) {
    if (err instanceof StackPermissionError) {
      const existing = await stack.getType(type.id);
      if (!existing) throw err;
      return;
    }
    throw err;
  }
}

/**
 * Register every type the integration reads or owns. Idempotent — an
 * identical schema is a no-op that leaves `createdAt` untouched — so
 * calling it every build is cheap. Safe to run under a non-owner
 * credential: types that already exist are left alone and a permission
 * error on an already-registered type is swallowed.
 */
export async function defineEleventyTypes(stack: Stack): Promise<void> {
  for (const type of [...CONSUMED_COMMONS_TYPES, ...ELEVENTY_TYPES]) {
    await ensureType(stack, type);
  }
}
