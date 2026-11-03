import { registerSidebarEntry } from '@kinvolk/headlamp-plugin/lib';
import type { SidebarEntryProps } from '@kinvolk/headlamp-plugin/lib/components/Sidebar';
import {
  type Bookmark,
  type BookmarkDraft,
  bookmarkRegistrations,
  BOOKMARKS_EVENT,
  BOOKMARKS_KEY,
  clusterFromPath,
  moveBookmark,
  type NavRegistration,
  parseBookmarks,
  removeBookmark,
  reorderBookmark,
  serializeBookmarks,
  setBookmarkSource,
  toggleBookmark,
} from './bookmarks';

type RegisterNav = (entry: NavRegistration) => void;

let cache: Bookmark[] | null = null;
let registerNav: RegisterNav = entry => {
  registerSidebarEntry(entry as SidebarEntryProps);
};
let watchingLocation = false;

export function setBookmarkRegistrar(next: RegisterNav): void {
  registerNav = next;
}

export function rememberBookmarks(items: Bookmark[] | null): void {
  cache = items;
}

export function currentBookmarks(): Bookmark[] {
  if (!cache) {
    cache = readStoredBookmarks(safeStorage());
  }
  return cache;
}

export function readStoredBookmarks(storage: Pick<Storage, 'getItem'>): Bookmark[] {
  try {
    return parseBookmarks(storage.getItem(BOOKMARKS_KEY));
  } catch {
    return [];
  }
}

export function writeStoredBookmarks(storage: Pick<Storage, 'setItem'>, items: Bookmark[]): void {
  storage.setItem(BOOKMARKS_KEY, serializeBookmarks(items));
}

function safeStorage(): Pick<Storage, 'getItem' | 'setItem'> {
  return localStorage;
}

function publish(items: Bookmark[]): Bookmark[] {
  cache = items;
  try {
    writeStoredBookmarks(safeStorage(), items);
  } catch {
    // Private mode can reject the write. The list still applies for this visit.
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(BOOKMARKS_EVENT));
  }
  refreshBookmarkNav();
  return items;
}

export function refreshBookmarkNav(): void {
  const cluster = typeof window === 'undefined' ? '' : clusterFromPath(window.location.pathname);
  for (const entry of bookmarkRegistrations(currentBookmarks(), cluster)) {
    registerNav(entry);
  }
}

export function replaceBookmarks(items: Bookmark[]): Bookmark[] {
  return publish(items);
}

export function toggleStoredBookmark(draft: BookmarkDraft): Bookmark[] {
  return publish(toggleBookmark(currentBookmarks(), draft));
}

export function removeStoredBookmark(id: string): Bookmark[] {
  return publish(removeBookmark(currentBookmarks(), id));
}

export function moveStoredBookmark(id: string, delta: -1 | 1): Bookmark[] {
  return publish(moveBookmark(currentBookmarks(), id, delta));
}

export function reorderStoredBookmark(fromId: string, toId: string): Bookmark[] {
  const item = currentBookmarks().find(entry => entry.id === fromId);
  if (!item) {
    return currentBookmarks();
  }
  return publish(reorderBookmark(currentBookmarks(), item.cluster, fromId, toId));
}

export function subscribeBookmarks(listener: (items: Bookmark[]) => void): () => void {
  if (typeof window === 'undefined') {
    return () => undefined;
  }
  const onChange = () => listener(currentBookmarks());
  window.addEventListener(BOOKMARKS_EVENT, onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(BOOKMARKS_EVENT, onChange);
    window.removeEventListener('storage', onChange);
  };
}

export function startBookmarks(): void {
  setBookmarkSource(() => ({
    cluster: currentCluster(),
    items: currentBookmarks(),
  }));
  refreshBookmarkNav();
  watchClusterChanges();
}

function watchClusterChanges(): void {
  if (watchingLocation || typeof window === 'undefined') {
    return;
  }
  watchingLocation = true;
  let cluster = currentCluster();
  const check = () => {
    const next = currentCluster();
    if (next === cluster) {
      return;
    }
    cluster = next;
    refreshBookmarkNav();
  };
  window.addEventListener('popstate', check);
  for (const method of ['pushState', 'replaceState'] as const) {
    const original = history[method];
    history[method] = function (...args: Parameters<History['pushState']>) {
      const result = original.apply(this, args);
      check();
      return result;
    };
  }
}

function currentCluster(): string {
  if (typeof window === 'undefined') {
    return '';
  }
  return clusterFromPath(window.location.pathname);
}
