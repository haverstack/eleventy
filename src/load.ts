/**
 * @haverstack/eleventy — load phase
 * -------------------------------------------------------
 * Fetch every record a build needs and turn it into in-memory indexes.
 * This phase is mechanical: it resolves the site, walks the change-free
 * structure, and groups records for lookup. Every decision — cascades,
 * collisions, permalinks, collection membership — belongs to resolve.
 *
 * Two disciplines the sketch (eleventy-integration.md § Load) is emphatic
 * about, both enforced here:
 *
 *   - Every query loops on the cursor to exhaustion. `cursor === null` is
 *     the only end-of-results signal; a short or empty page is not. `total`
 *     is `null` under a scoped stack, so there is no count to check.
 *   - Every query asks for unlisted records. They still build at their
 *     URLs, so the build must see them; excluding them from listings is
 *     resolve's job. `includeUnlisted` is owner-only, so a build under a
 *     scoped credential silently loses them — `unlistedVisible` records
 *     whether that happened.
 */

import {
  StackPermissionError,
  SYSTEM_TYPES,
  type FileId,
  type RecordFilter,
  type RecordId,
  type StackClient,
  type StackRecord,
} from '@haverstack/core';
import { PAGE, SITE } from '@haverstack/commons';
import { FOR_SITE_LABEL, MENU, PAGE_META } from './types.js';
import { HaverstackEleventyError } from './errors.js';

const QUERY_PAGE_SIZE = 100;

export interface LoadOptions {
  /**
   * The `site@1` record to build, by `handle` or by record id. Omit only
   * on a stack with no `site@1` records — the single-site case.
   */
  site?: string;
}

/** `page-meta` sidecars for one described record, split by scope. */
export interface SidecarSet {
  /** Sidecars with no `for-site` association — the record's default. >1 is a writer error. */
  unscoped: StackRecord[];
  /** Sidecars scoped to the site being built. >1 is a writer error. */
  thisSite: StackRecord[];
  /** Every scoped sidecar by the site it targets — for resolving links to other sites. */
  bySite: Map<RecordId, StackRecord[]>;
}

/** A node in the site's page tree. */
export interface PageNode {
  record: StackRecord;
  parent: PageNode | null;
  children: PageNode[];
}

export interface StackIndex {
  /** The site being built, or `null` on a stack with no `site@1` records. */
  site: StackRecord | null;
  /** Every `site@1` record, for cross-site link resolution. */
  sitesById: Map<RecordId, StackRecord>;
  sitesByHandle: Map<string, StackRecord>;
  /**
   * Every record this phase fetched, by id: every site's pages, all menus,
   * sidecars, attachment metadata, the owner, and the listing members that
   * carry a sidecar. Every key of `sidecarsByParent` resolves here.
   */
  byId: Map<RecordId, StackRecord>;
  /** Root pages of the site being built, sorted stably. */
  pageRoots: PageNode[];
  /** Every page in the site's pruned subtree, by id. */
  pagesById: Map<RecordId, PageNode>;
  /** `page-meta` sidecars grouped by the record they describe. */
  sidecarsByParent: Map<RecordId, SidecarSet>;
  /** The site's menus, in fetch order. */
  menus: StackRecord[];
  /** The site's menus grouped by handle (one-to-many: uniqueness is unenforced). */
  menusByHandle: Map<string, StackRecord[]>;
  /** `_attachment@1` records grouped by fileId, earliest `createdAt` first. */
  attachmentsByFileId: Map<FileId, StackRecord[]>;
  /** The stack owner's `_entity@1` card, or `null`. */
  owner: StackRecord | null;
  /** `false` when the build runs under a credential that cannot see unlisted records. */
  unlistedVisible: boolean;
}

/** Walk `filter` to exhaustion. See the module comment for why the loop is the only correct form. */
async function queryAll(stack: StackClient, filter: RecordFilter): Promise<StackRecord[]> {
  const out: StackRecord[] = [];
  let cursor: string | undefined;
  do {
    const page = await stack.query({ filter, cursor, limit: QUERY_PAGE_SIZE });
    out.push(...page.records);
    cursor = page.cursor ?? undefined;
  } while (cursor);
  return out;
}

function resolveSite(sites: StackRecord[], want: string | undefined): StackRecord | null {
  if (want === undefined) {
    if (sites.length === 0) return null;
    const known = sites.map((s) => (s.content.handle as string) ?? `(${s.id})`).join(', ');
    throw new HaverstackEleventyError(
      `This stack has ${sites.length} site@1 record(s); name one with the \`site\` option ` +
        `(handle or record id). Known: ${known}.`,
    );
  }
  const byHandle = sites.filter((s) => s.content.handle === want);
  if (byHandle.length === 1) return byHandle[0];
  if (byHandle.length > 1) {
    throw new HaverstackEleventyError(
      `The \`site\` handle "${want}" resolves to ${byHandle.length} records ` +
        `(${byHandle.map((s) => s.id).join(', ')}). Handle uniqueness is a writer obligation.`,
    );
  }
  const byId = sites.find((s) => s.id === want);
  if (byId) return byId;
  throw new HaverstackEleventyError(`No site@1 record with handle or id "${want}".`);
}

/**
 * The first ancestor of `startId` that is not itself a page in `rawPages`,
 * or `null` for a page with no parent (or an ancestry cycle). A `site@1`
 * parent is one such stop; so is a parent that was never fetched.
 */
function terminalAncestor(
  startId: RecordId,
  rawPages: Map<RecordId, StackRecord>,
): RecordId | null {
  const seen = new Set<RecordId>();
  let current = rawPages.get(startId);
  while (current) {
    if (seen.has(current.id)) return null;
    seen.add(current.id);
    const parentId = current.parentId;
    if (!parentId) return null;
    const parent = rawPages.get(parentId);
    if (!parent) return parentId;
    current = parent;
  }
  return null;
}

const pageOrder = (a: PageNode, b: PageNode): number =>
  a.record.createdAt.getTime() - b.record.createdAt.getTime() ||
  (a.record.id < b.record.id ? -1 : a.record.id > b.record.id ? 1 : 0);

function buildPageTree(kept: StackRecord[]): { roots: PageNode[]; byId: Map<RecordId, PageNode> } {
  const byId = new Map<RecordId, PageNode>(
    kept.map((r) => [r.id, { record: r, parent: null, children: [] }]),
  );
  const roots: PageNode[] = [];
  for (const node of byId.values()) {
    const parentId = node.record.parentId;
    const parent = parentId ? byId.get(parentId) : undefined;
    if (parent) {
      node.parent = parent;
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }
  roots.sort(pageOrder);
  for (const node of byId.values()) node.children.sort(pageOrder);
  return { roots, byId };
}

function forSiteTargets(record: StackRecord): RecordId[] {
  const out: RecordId[] = [];
  for (const a of record.associations ?? []) {
    if (a.kind === 'relationship' && a.label === FOR_SITE_LABEL && a.target.scope === 'record') {
      out.push(a.target.recordId);
    }
  }
  return out;
}

function groupSidecars(
  sidecars: StackRecord[],
  siteId: RecordId | undefined,
): Map<RecordId, SidecarSet> {
  const map = new Map<RecordId, SidecarSet>();
  for (const sc of sidecars) {
    if (!sc.parentId) continue;
    const set: SidecarSet = map.get(sc.parentId) ?? {
      unscoped: [],
      thisSite: [],
      bySite: new Map(),
    };
    const targets = forSiteTargets(sc);
    if (targets.length === 0) {
      set.unscoped.push(sc);
    } else {
      for (const target of targets) {
        const list = set.bySite.get(target) ?? [];
        list.push(sc);
        set.bySite.set(target, list);
      }
      if (siteId !== undefined && targets.includes(siteId)) set.thisSite.push(sc);
    }
    map.set(sc.parentId, set);
  }
  return map;
}

export async function load(stack: StackClient, opts: LoadOptions = {}): Promise<StackIndex> {
  // Probe includeUnlisted once — it is owner-only, and a scoped stack
  // throws rather than downgrading silently.
  let unlistedVisible = true;
  let siteRecords: StackRecord[];
  try {
    siteRecords = await queryAll(stack, { typeId: SITE.id, includeUnlisted: true });
  } catch (err) {
    if (!(err instanceof StackPermissionError)) throw err;
    unlistedVisible = false;
    siteRecords = await queryAll(stack, { typeId: SITE.id });
  }
  const unlisted: Pick<RecordFilter, 'includeUnlisted'> = unlistedVisible
    ? { includeUnlisted: true }
    : {};

  const site = resolveSite(siteRecords, opts.site);

  const sitesById = new Map(siteRecords.map((s) => [s.id, s]));
  const sitesByHandle = new Map<string, StackRecord>();
  for (const s of siteRecords) {
    const handle = s.content.handle;
    if (typeof handle === 'string' && handle && !sitesByHandle.has(handle)) {
      sitesByHandle.set(handle, s);
    }
  }

  const [allPages, allSidecars, allMenus, allAttachments, owner] = await Promise.all([
    queryAll(stack, { typeId: PAGE.id, ...unlisted }),
    queryAll(stack, { typeId: PAGE_META.id, ...unlisted }),
    queryAll(stack, { typeId: MENU.id, ...(site ? { parentId: site.id } : {}), ...unlisted }),
    queryAll(stack, { baseId: SYSTEM_TYPES.ATTACHMENT, ...unlisted }),
    stack.getOwnerEntity(),
  ]);

  const rawPages = new Map(allPages.map((p) => [p.id, p]));
  const kept = allPages.filter((p) => {
    const terminal = terminalAncestor(p.id, rawPages);
    return site ? terminal === site.id : terminal === null || !sitesById.has(terminal);
  });
  const { roots: pageRoots, byId: pagesById } = buildPageTree(kept);

  const sidecarsByParent = groupSidecars(allSidecars, site?.id);

  const menusByHandle = new Map<string, StackRecord[]>();
  for (const menu of allMenus) {
    const handle = menu.content.handle;
    if (typeof handle !== 'string') continue;
    const list = menusByHandle.get(handle) ?? [];
    list.push(menu);
    menusByHandle.set(handle, list);
  }

  const attachmentsByFileId = new Map<FileId, StackRecord[]>();
  for (const attachment of allAttachments) {
    const fileId = attachment.content.fileId as FileId | undefined;
    if (!fileId) continue;
    const list = attachmentsByFileId.get(fileId) ?? [];
    list.push(attachment);
    attachmentsByFileId.set(fileId, list);
  }
  for (const list of attachmentsByFileId.values()) {
    list.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  const byId = new Map<RecordId, StackRecord>();
  for (const record of [
    ...siteRecords,
    ...allPages,
    ...allMenus,
    ...allSidecars,
    ...allAttachments,
  ]) {
    byId.set(record.id, record);
  }
  if (owner) byId.set(owner.id, owner);

  // The records sidecars describe — listing members carrying page-meta —
  // are not bulk-fetched here (resolve's collection queries bring them in).
  // Point-read the few that carry a sidecar so every key in
  // `sidecarsByParent` resolves through `byId`: `check` names them, and a
  // scoped read that returns null just leaves the gap it would have anyway.
  const describedIds = [...sidecarsByParent.keys()].filter((id) => !byId.has(id));
  const described = await Promise.all(describedIds.map((id) => stack.get(id)));
  for (const record of described) if (record) byId.set(record.id, record);

  return {
    site,
    sitesById,
    sitesByHandle,
    byId,
    pageRoots,
    pagesById,
    sidecarsByParent,
    menus: allMenus,
    menusByHandle,
    attachmentsByFileId,
    owner,
    unlistedVisible,
  };
}
