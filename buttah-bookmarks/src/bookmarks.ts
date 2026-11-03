/**
 * Bookmarks are navigation shortcuts. Headlamp keeps a group's children closed
 * until that group is selected, so the section is a subheader plus one root
 * entry per bookmark. The stylesheet pins that block to the top of the sidebar.
 */

export const BOOKMARKS_KEY = 'buttah-bookmarks';
export const BOOKMARKS_EVENT = 'buttah-bookmarks';
export const BOOKMARKS_HEADER = 'buttah-bookmarks';
export const BOOKMARK_ICON = 'mdi:bookmark';
export const MAX_BOOKMARKS = 40;
const MAX_LABEL = 80;
const MAX_URL = 2000;

const ICON_NAME = /^[a-z0-9-]+:[a-z0-9-]+$/i;
const SLOT_NAME = /^buttah-bookmark-(\d+)$/;

export type Bookmark = {
  id: string;
  cluster: string;
  label: string;
  url: string;
  icon: string;
};

export type BookmarkDraft = {
  cluster: string;
  label: string;
  url: string;
  icon?: string;
};

export type NavEntry = {
  name: string;
  label: string;
  url?: string;
  icon?: string;
  parent?: string | null;
  useClusterURL?: boolean;
  entryType?: 'link' | 'subheader';
  title?: string;
  subList?: NavEntry[];
  'data-buttah-bookmark'?: string;
  'data-buttah-bookmark-index'?: string;
  'data-buttah-bookmark-last'?: 'true';
};

export type BookmarkSource = {
  cluster: string;
  items: Bookmark[];
};

let source: () => BookmarkSource = () => ({ cluster: '', items: [] });

export function setBookmarkSource(next: () => BookmarkSource): void {
  source = next;
}

export function bookmarkSource(): BookmarkSource {
  return source();
}

export function slotName(index: number): string {
  return `buttah-bookmark-${index}`;
}

export function isBookmarkNavName(name: string): boolean {
  return name === BOOKMARKS_HEADER || bookmarkSlotIndex(name) !== null;
}

export function bookmarkSlotIndex(name: string): number | null {
  const match = SLOT_NAME.exec(name);
  if (!match) {
    return null;
  }
  if (match[1].length > 1 && match[1].startsWith('0')) {
    return null;
  }
  const index = Number(match[1]);
  if (!Number.isInteger(index) || index < 0 || index >= MAX_BOOKMARKS) {
    return null;
  }
  return index;
}

export function clusterFromPath(pathname: string): string {
  const match = /^\/c\/([^/]+)/.exec(pathname);
  if (!match) {
    return '';
  }
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

export function canonicalUrl(pathname: string, search: string): string {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname || '/';
  const raw = search.startsWith('?') ? search.slice(1) : search;
  if (!raw) {
    return path;
  }
  const pairs = raw
    .split('&')
    .filter(Boolean)
    .map(part => {
      const eq = part.indexOf('=');
      if (eq === -1) {
        return [part, ''] as const;
      }
      return [part.slice(0, eq), part.slice(eq + 1)] as const;
    })
    .filter(([key]) => key.length > 0);
  pairs.sort((left, right) => left[0].localeCompare(right[0]) || left[1].localeCompare(right[1]));
  return `${path}?${pairs.map(([key, value]) => `${key}=${value}`).join('&')}`;
}

export function isSafeUrl(url: string): boolean {
  if (!url.startsWith('/') || url.startsWith('//') || url.length > MAX_URL) {
    return false;
  }
  if (url.includes('\\') || url.includes('://') || /[\u0000-\u001f\u007f]/.test(url)) {
    return false;
  }
  return true;
}

export function bookmarkId(cluster: string, url: string): string {
  return `${cluster}\u001f${url}`;
}

/**
 * Sidebar links cannot carry their own query, so the row opens this and we jump.
 * Padding is stripped: react-router treats some reserved characters specially,
 * and Headlamp stores one route per path.
 */
export function encodeBookmarkKey(id: string): string {
  const bytes = new TextEncoder().encode(id);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeBookmarkKey(key: string): string {
  try {
    const padded = key.replace(/-/g, '+').replace(/_/g, '/');
    const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
    const binary = atob(padded + pad);
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return '';
  }
}

/** In-cluster jump. Headlamp prefixes /c/:cluster because useClusterURL is true. */
export function bookmarkGoPath(id: string): string {
  return `/buttah/go/${encodeBookmarkKey(id)}`;
}

/** Global jump. A different path so it does not replace the cluster route. */
export function bookmarkPagePath(id: string): string {
  return `/buttah/page/${encodeBookmarkKey(id)}`;
}

export function bookmarkJumpPath(id: string, cluster: string): string {
  return cluster ? bookmarkGoPath(id) : bookmarkPagePath(id);
}

export function cleanLabel(label: string): string {
  const collapsed = label.replace(/\s+/g, ' ').trim();
  if (!collapsed) {
    return 'Bookmark';
  }
  if (collapsed.length <= MAX_LABEL) {
    return collapsed;
  }
  return `${collapsed.slice(0, MAX_LABEL - 1)}…`;
}

export function cleanIcon(icon: unknown): string {
  return typeof icon === 'string' && ICON_NAME.test(icon) ? icon : BOOKMARK_ICON;
}

export function namespaceLabel(search: string): string | null {
  const raw = search.startsWith('?') ? search.slice(1) : search;
  if (!raw) {
    return null;
  }
  const names: string[] = [];
  for (const piece of raw.split('&')) {
    const eq = piece.indexOf('=');
    const key = eq === -1 ? piece : piece.slice(0, eq);
    if (key !== 'namespace') {
      continue;
    }
    const value = eq === -1 ? '' : piece.slice(eq + 1);
    for (const name of value.split('+')) {
      if (!name) {
        continue;
      }
      try {
        names.push(decodeURIComponent(name));
      } catch {
        names.push(name);
      }
    }
  }
  if (names.length === 0) {
    return null;
  }
  if (names.length === 1) {
    return names[0];
  }
  if (names.length <= 3) {
    return names.join(', ');
  }
  return `${names.length} namespaces`;
}

export function withNamespace(label: string, search: string): string {
  const namespace = namespaceLabel(search);
  if (!namespace || label === namespace || label.endsWith(` · ${namespace}`)) {
    return label;
  }
  return `${label} · ${namespace}`;
}

/** Page title for a bookmark. Cluster home uses an h2; resource pages use an h1. */
export function pageHeading(root: ParentNode): string | null {
  const scope = root.querySelector('main') ?? root;
  const titled = scope
    .querySelector('.buttah-page-title')
    ?.textContent?.replace(/\s+/g, ' ')
    .trim();
  if (titled) {
    return titled;
  }
  const h1 = scope.querySelector('h1')?.textContent?.replace(/\s+/g, ' ').trim();
  if (h1) {
    return h1;
  }
  const h2 = scope.querySelector('h2')?.textContent?.replace(/\s+/g, ' ').trim();
  return h2 || null;
}

export function titleFromPath(pathname: string): string {
  const parts = pathname.split('/').filter(Boolean);
  const rest = parts[0] === 'c' ? parts.slice(2) : parts;
  const last = rest[rest.length - 1];
  if (!last) {
    return 'Bookmark';
  }
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

export function splitHref(href: string): { pathname: string; search: string } | null {
  if (!href || href.startsWith('//') || href.startsWith('javascript:')) {
    return null;
  }
  let path = href.split('#')[0] ?? '';
  if (/^https?:\/\//i.test(path)) {
    const scheme = path.indexOf('//');
    const slash = path.indexOf('/', scheme + 2);
    path = slash === -1 ? '/' : path.slice(slash);
  }
  if (!path.startsWith('/')) {
    return null;
  }
  const query = path.indexOf('?');
  if (query === -1) {
    return { pathname: path, search: '' };
  }
  return { pathname: path.slice(0, query), search: path.slice(query) };
}

export type ResourceRef = {
  kind?: string;
  getDetailsLink?: () => string;
  getName?: () => string;
  getNamespace?: () => string | null | undefined;
};

/**
 * Details open in a drawer, so the address bar stays on the list. The header
 * action is given the resource; bookmark that resource's own page.
 */
export function describeResource(
  item: ResourceRef | null | undefined,
  page: { pathname: string; search: string; heading?: string | null }
): BookmarkDraft | null {
  if (item && typeof item.getDetailsLink === 'function') {
    try {
      const parts = splitHref(item.getDetailsLink());
      if (parts) {
        const name = typeof item.getName === 'function' ? item.getName() : '';
        const kind = typeof item.kind === 'string' ? item.kind : '';
        const namespace = typeof item.getNamespace === 'function' ? item.getNamespace() || '' : '';
        const base = [kind, name].filter(Boolean).join(' ');
        const heading =
          base && namespace && !base.endsWith(namespace) ? `${base} · ${namespace}` : base;
        const draft = describePage({
          pathname: parts.pathname,
          search: parts.search,
          heading: heading || page.heading,
        });
        if (draft) {
          return draft;
        }
      }
    } catch {
      // The resource link is optional. The open page is still bookmarkable.
    }
  }
  return describePage(page);
}

export function describePage(input: {
  pathname: string;
  search: string;
  heading?: string | null;
}): BookmarkDraft | null {
  const url = canonicalUrl(input.pathname, input.search);
  if (!isSafeUrl(url) || clusterFromPath(url) !== clusterFromPath(input.pathname)) {
    return null;
  }
  const heading = input.heading?.replace(/\s+/g, ' ').trim();
  const base = heading || titleFromPath(input.pathname);
  return {
    cluster: clusterFromPath(input.pathname),
    url,
    label: cleanLabel(withNamespace(base, input.search)),
    icon: BOOKMARK_ICON,
  };
}

export function bookmarksFor(items: Bookmark[], cluster: string): Bookmark[] {
  return items.filter(item => item.cluster === cluster);
}

export function findBookmark(
  items: Bookmark[],
  cluster: string,
  url: string
): Bookmark | undefined {
  const parts = splitHref(url);
  const canonical = parts ? canonicalUrl(parts.pathname, parts.search) : url;
  const id = bookmarkId(cluster, canonical);
  return items.find(item => item.id === id);
}

export function addBookmark(items: Bookmark[], draft: BookmarkDraft): Bookmark[] {
  const parts = splitHref(draft.url);
  if (!parts) {
    return items;
  }
  const url = canonicalUrl(parts.pathname, parts.search);
  if (!isSafeUrl(url) || clusterFromPath(url) !== draft.cluster) {
    return items;
  }
  const id = bookmarkId(draft.cluster, url);
  if (items.some(item => item.id === id)) {
    return items;
  }
  if (bookmarksFor(items, draft.cluster).length >= MAX_BOOKMARKS) {
    return items;
  }
  return [
    ...items,
    {
      id,
      cluster: draft.cluster,
      url,
      label: cleanLabel(draft.label),
      icon: cleanIcon(draft.icon),
    },
  ];
}

export function removeBookmark(items: Bookmark[], id: string): Bookmark[] {
  if (!items.some(item => item.id === id)) {
    return items;
  }
  return items.filter(item => item.id !== id);
}

export function toggleBookmark(items: Bookmark[], draft: BookmarkDraft): Bookmark[] {
  const parts = splitHref(draft.url);
  if (!parts) {
    return items;
  }
  const url = canonicalUrl(parts.pathname, parts.search);
  const existing = findBookmark(items, draft.cluster, url);
  if (existing) {
    return removeBookmark(items, existing.id);
  }
  return addBookmark(items, draft);
}

/**
 * Move `fromId` to the slot occupied by `toId` inside one cluster.
 * Other clusters keep their places in the stored list.
 */
export function reorderBookmark(
  items: Bookmark[],
  cluster: string,
  fromId: string,
  toId: string
): Bookmark[] {
  const scoped = bookmarksFor(items, cluster);
  const from = scoped.findIndex(item => item.id === fromId);
  const to = scoped.findIndex(item => item.id === toId);
  if (from < 0 || to < 0 || from === to) {
    return items;
  }
  const next = scoped.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  let index = 0;
  return items.map(item => (item.cluster === cluster ? next[index++] : item));
}

export function moveBookmark(items: Bookmark[], id: string, delta: -1 | 1): Bookmark[] {
  const item = items.find(entry => entry.id === id);
  if (!item) {
    return items;
  }
  const scoped = bookmarksFor(items, item.cluster);
  const index = scoped.findIndex(entry => entry.id === id);
  const target = scoped[index + delta];
  if (!target) {
    return items;
  }
  return reorderBookmark(items, item.cluster, id, target.id);
}

export function parseBookmarks(raw: string | null): Bookmark[] {
  if (!raw) {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const list = bookmarkList(parsed);
  const kept: Bookmark[] = [];
  const counts = new Map<string, number>();
  for (const entry of list) {
    const bookmark = normalizeBookmark(entry);
    if (!bookmark) {
      continue;
    }
    const count = counts.get(bookmark.cluster) ?? 0;
    if (count >= MAX_BOOKMARKS || kept.some(item => item.id === bookmark.id)) {
      continue;
    }
    counts.set(bookmark.cluster, count + 1);
    kept.push(bookmark);
  }
  return kept;
}

export function serializeBookmarks(items: Bookmark[]): string {
  return JSON.stringify({ version: 1, items });
}

function bookmarkList(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) {
    return parsed;
  }
  if (!parsed || typeof parsed !== 'object' || !('items' in parsed)) {
    return [];
  }
  const items = (parsed as { items?: unknown }).items;
  return Array.isArray(items) ? items : [];
}

function normalizeBookmark(entry: unknown): Bookmark | null {
  if (!entry || typeof entry !== 'object') {
    return null;
  }
  const record = entry as Record<string, unknown>;
  if (typeof record.cluster !== 'string' || typeof record.url !== 'string') {
    return null;
  }
  const parts = splitHref(record.url);
  if (!parts) {
    return null;
  }
  const url = canonicalUrl(parts.pathname, parts.search);
  if (!isSafeUrl(url) || clusterFromPath(url) !== record.cluster) {
    return null;
  }
  const label = typeof record.label === 'string' ? record.label : '';
  return {
    id: bookmarkId(record.cluster, url),
    cluster: record.cluster,
    url,
    label: cleanLabel(label),
    icon: cleanIcon(record.icon),
  };
}

export function filterBookmarkNav(
  entry: NavEntry,
  cluster: string,
  items: Bookmark[]
): NavEntry | null {
  const mine = bookmarksFor(items, cluster);
  if (entry.name === BOOKMARKS_HEADER) {
    if (mine.length === 0) {
      return null;
    }
    return {
      name: BOOKMARKS_HEADER,
      label: 'Bookmarks',
      parent: null,
      useClusterURL: false,
      entryType: 'subheader',
    };
  }
  const index = bookmarkSlotIndex(entry.name);
  if (index === null) {
    return entry;
  }
  const bookmark = mine[index];
  if (!bookmark) {
    return null;
  }
  const link: NavEntry = {
    name: entry.name,
    label: bookmark.label,
    url: bookmarkJumpPath(bookmark.id, bookmark.cluster),
    icon: bookmark.icon,
    parent: null,
    // Inside a cluster, Headlamp prefixes the link. Outside, the path is already absolute.
    useClusterURL: bookmark.cluster !== '',
    title: bookmark.label,
    'data-buttah-bookmark': bookmark.id,
    'data-buttah-bookmark-index': String(index),
  };
  if (index === mine.length - 1) {
    link['data-buttah-bookmark-last'] = 'true';
  }
  return link;
}

export type NavRegistration = {
  parent: null;
  name: string;
  label: string;
  url?: string;
  icon?: string;
  useClusterURL: boolean;
  entryType?: 'subheader';
};

/** Header first, then one slot per saved bookmark, so insertion order matches the list. */
export function bookmarkRegistrations(items: Bookmark[], cluster: string): NavRegistration[] {
  const mine = bookmarksFor(items, cluster).slice(0, MAX_BOOKMARKS);
  const header: NavRegistration = {
    parent: null,
    name: BOOKMARKS_HEADER,
    label: 'Bookmarks',
    useClusterURL: false,
    entryType: 'subheader',
  };
  const slots: NavRegistration[] = mine.map((bookmark, index) => ({
    parent: null,
    name: slotName(index),
    label: bookmark.label,
    url: bookmarkJumpPath(bookmark.id, bookmark.cluster),
    icon: bookmark.icon,
    useClusterURL: bookmark.cluster !== '',
  }));
  return [header, ...slots];
}
