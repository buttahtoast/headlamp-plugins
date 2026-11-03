import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { NavRegistration } from './bookmarks';
import {
  addBookmark,
  type Bookmark,
  BOOKMARK_ICON,
  bookmarkGoPath,
  bookmarkId,
  bookmarkPagePath,
  bookmarkRegistrations,
  BOOKMARKS_HEADER,
  BOOKMARKS_KEY,
  bookmarksFor,
  canonicalUrl,
  clusterFromPath,
  decodeBookmarkKey,
  describePage,
  describeResource,
  encodeBookmarkKey,
  filterBookmarkNav,
  findBookmark,
  MAX_BOOKMARKS,
  moveBookmark,
  namespaceLabel,
  pageHeading,
  parseBookmarks,
  removeBookmark,
  reorderBookmark,
  serializeBookmarks,
  setBookmarkSource,
  slotName,
  titleFromPath,
  toggleBookmark,
  withNamespace,
} from './bookmarks';
import {
  currentBookmarks,
  readStoredBookmarks,
  refreshBookmarkNav,
  rememberBookmarks,
  replaceBookmarks,
  setBookmarkRegistrar,
  toggleStoredBookmark,
  writeStoredBookmarks,
} from './bookmarkStore';

function draft(cluster: string, url: string, label: string): Bookmark {
  const [added] = addBookmark([], { cluster, url, label }).slice(-1);
  if (!added) {
    throw new Error(`could not build ${label}`);
  }
  return added;
}

afterEach(() => {
  setBookmarkSource(() => ({ cluster: '', items: [] }));
  rememberBookmarks(null);
  localStorage.clear();
  window.history.pushState({}, '', '/');
});

describe('bookmark storage', () => {
  it('canonicalizes a path and keeps a plus in the namespace', () => {
    expect(canonicalUrl('/c/kind/pods/', '?namespace=kube-system+default&b=1')).toBe(
      '/c/kind/pods?b=1&namespace=kube-system+default'
    );
    expect(canonicalUrl('/c/kind/pods', '?b=1&namespace=kube-system+default')).toBe(
      '/c/kind/pods?b=1&namespace=kube-system+default'
    );
    expect(clusterFromPath('/c/alpina%20prod/pods')).toBe('alpina prod');
    const id = bookmarkId('kind', '/c/kind/pods?namespace=kube-system+default');
    expect(decodeBookmarkKey(encodeBookmarkKey(id))).toBe(id);
    expect(clusterFromPath('/settings')).toBe('');
    expect(namespaceLabel('?namespace=kube-system+default')).toBe('kube-system, default');
    expect(withNamespace('Pods', '?namespace=default')).toBe('Pods · default');
    expect(titleFromPath('/c/kind/pods/nginx')).toBe('nginx');
  });

  it('drops unreadable, unsafe, and cross-cluster entries', () => {
    expect(parseBookmarks(null)).toEqual([]);
    expect(parseBookmarks('{')).toEqual([]);
    expect(parseBookmarks('{"items":"nope"}')).toEqual([]);
    const raw = JSON.stringify({
      version: 1,
      items: [
        { cluster: 'kind', url: '/c/kind/pods', label: 'Pods', icon: 'not an icon' },
        { cluster: 'kind', url: 'javascript:alert(1)', label: 'Bad' },
        { cluster: 'kind', url: '/c/other/nodes', label: 'Wrong cluster' },
        { cluster: '', url: '/settings/general', label: '  Settings  ' },
        { cluster: 'kind', url: '/c/kind/pods', label: 'Pods again' },
      ],
    });
    expect(parseBookmarks(raw)).toEqual([
      {
        id: bookmarkId('kind', '/c/kind/pods'),
        cluster: 'kind',
        url: '/c/kind/pods',
        label: 'Pods',
        icon: BOOKMARK_ICON,
      },
      {
        id: bookmarkId('', '/settings/general'),
        cluster: '',
        url: '/settings/general',
        label: 'Settings',
        icon: BOOKMARK_ICON,
      },
    ]);
  });

  it('round-trips a saved list', () => {
    const items = [draft('kind', '/c/kind/pods?namespace=default', 'Pods')];
    const storage = new Map<string, string>();
    const memory = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
    };
    writeStoredBookmarks(memory, items);
    expect(readStoredBookmarks(memory)).toEqual(items);
    expect(parseBookmarks(serializeBookmarks(items))).toEqual(items);
  });

  it('adds, toggles, and stops at the per-cluster cap', () => {
    const first = addBookmark([], {
      cluster: 'kind',
      url: '/c/kind/pods/',
      label: 'Pods',
      icon: 'mdi:cube-outline',
    });
    expect(first).toEqual([
      {
        id: bookmarkId('kind', '/c/kind/pods'),
        cluster: 'kind',
        url: '/c/kind/pods',
        label: 'Pods',
        icon: 'mdi:cube-outline',
      },
    ]);
    expect(addBookmark(first, { cluster: 'kind', url: '/c/kind/pods', label: 'Pods' })).toBe(first);
    expect(addBookmark(first, { cluster: 'other', url: '/c/kind/pods', label: 'Pods' })).toBe(
      first
    );
    const toggled = toggleBookmark(first, { cluster: 'kind', url: '/c/kind/pods', label: 'Pods' });
    expect(toggled).toEqual([]);
    expect(findBookmark(first, 'kind', '/c/kind/pods/')).toBe(first[0]);

    let full: Bookmark[] = [];
    for (let index = 0; index < MAX_BOOKMARKS; index += 1) {
      full = addBookmark(full, {
        cluster: 'kind',
        url: `/c/kind/page-${index}`,
        label: `Page ${index}`,
      });
    }
    expect(bookmarksFor(full, 'kind')).toHaveLength(MAX_BOOKMARKS);
    expect(addBookmark(full, { cluster: 'kind', url: '/c/kind/overflow', label: 'Overflow' })).toBe(
      full
    );
    expect(
      addBookmark(full, { cluster: 'other', url: '/c/other/nodes', label: 'Nodes' })
    ).toHaveLength(MAX_BOOKMARKS + 1);
  });

  it('reorders inside one cluster and leaves the other cluster in place', () => {
    const kindPods = draft('kind', '/c/kind/pods', 'Pods');
    const otherNodes = draft('other', '/c/other/nodes', 'Nodes');
    const kindDeploy = draft('kind', '/c/kind/deployments', 'Deployments');
    const otherSecrets = draft('other', '/c/other/secrets', 'Secrets');
    const items = [kindPods, otherNodes, kindDeploy, otherSecrets];

    const moved = moveBookmark(items, kindDeploy.id, -1);
    expect(bookmarksFor(moved, 'kind').map(item => item.label)).toEqual(['Deployments', 'Pods']);
    expect(bookmarksFor(moved, 'other').map(item => item.label)).toEqual(['Nodes', 'Secrets']);
    expect(moveBookmark(moved, bookmarksFor(moved, 'kind')[0].id, -1)).toBe(moved);
    expect(removeBookmark(items, 'missing')).toBe(items);

    const reordered = reorderBookmark(items, 'other', otherSecrets.id, otherNodes.id);
    expect(bookmarksFor(reordered, 'other').map(item => item.label)).toEqual(['Secrets', 'Nodes']);
    expect(bookmarksFor(reordered, 'kind').map(item => item.label)).toEqual([
      'Pods',
      'Deployments',
    ]);
  });

  it('names a page from its heading and namespace', () => {
    const root = document.createElement('div');
    root.innerHTML = '<main><h2 class="buttah-page-title">Overview</h2><h1>Events</h1></main>';
    expect(pageHeading(root)).toBe('Overview');
    expect(
      describePage({
        pathname: '/c/kind/pods',
        search: '?namespace=default',
        heading: 'Pods',
      })
    ).toEqual({
      cluster: 'kind',
      url: '/c/kind/pods?namespace=default',
      label: 'Pods · default',
      icon: BOOKMARK_ICON,
    });
    expect(describePage({ pathname: '//evil', search: '', heading: 'Nope' })).toBeNull();
  });

  it('bookmarks the resource open in the details drawer', () => {
    expect(
      describeResource(
        {
          kind: 'Pod',
          getName: () => 'coredns-a',
          getNamespace: () => 'kube-system',
          getDetailsLink: () => '/c/buttah/pods/kube-system/coredns-a',
        },
        { pathname: '/c/buttah/pods', search: '', heading: 'Pods' }
      )
    ).toMatchObject({
      cluster: 'buttah',
      url: '/c/buttah/pods/kube-system/coredns-a',
      label: 'Pod coredns-a · kube-system',
    });
    expect(
      describeResource({ kind: 'Pod' }, { pathname: '/c/buttah/pods', search: '', heading: 'Pods' })
    ).toMatchObject({ url: '/c/buttah/pods', label: 'Pods' });
    expect(
      describeResource(
        {
          kind: 'Pod',
          getDetailsLink: () => {
            throw new Error('no route');
          },
        },
        { pathname: '/c/buttah/pods', search: '', heading: 'Pods' }
      )
    ).toMatchObject({ url: '/c/buttah/pods', label: 'Pods' });
  });
});

describe('bookmark navigation entries', () => {
  const pods = draft('kind', '/c/kind/pods', 'Pods');
  const nodes = draft('other', '/c/other/nodes', 'Nodes');

  it('hides the section when this cluster has none', () => {
    expect(
      filterBookmarkNav({ name: BOOKMARKS_HEADER, label: 'Bookmarks' }, 'kind', [])
    ).toBeNull();
    expect(filterBookmarkNav({ name: slotName(0), label: 'temp' }, 'kind', [nodes])).toBeNull();
    expect(filterBookmarkNav({ name: 'Pods', label: 'Pods' }, 'kind', [pods])?.name).toBe('Pods');
  });

  it('builds a subheader and ordered links for the open cluster', () => {
    const second = draft('kind', '/c/kind/deployments', 'Deployments');
    expect(
      filterBookmarkNav({ name: BOOKMARKS_HEADER, label: 'Bookmarks' }, 'kind', [
        pods,
        nodes,
        second,
      ])
    ).toEqual({
      name: BOOKMARKS_HEADER,
      label: 'Bookmarks',
      parent: null,
      useClusterURL: false,
      entryType: 'subheader',
    });
    expect(
      filterBookmarkNav({ name: slotName(0), label: 'temp' }, 'kind', [pods, nodes, second])
    ).toMatchObject({
      label: 'Pods',
      url: bookmarkGoPath(pods.id),
      useClusterURL: true,
      parent: null,
      'data-buttah-bookmark-index': '0',
    });
    expect(
      filterBookmarkNav({ name: slotName(1), label: 'temp' }, 'kind', [pods, nodes, second])
    ).toMatchObject({
      label: 'Deployments',
      'data-buttah-bookmark-last': 'true',
    });
    expect(
      filterBookmarkNav({ name: slotName(2), label: 'temp' }, 'kind', [pods, nodes, second])
    ).toBeNull();
    expect(bookmarkRegistrations([pods, nodes], 'kind').map(entry => entry.name)).toEqual([
      BOOKMARKS_HEADER,
      slotName(0),
    ]);
    expect(
      filterBookmarkNav({ name: slotName(0), label: 'temp' }, 'other', [pods, nodes])
    ).toMatchObject({
      label: 'Nodes',
      url: bookmarkGoPath(nodes.id),
      useClusterURL: true,
    });
    const account = draft('', '/buttah', 'Account');
    expect(filterBookmarkNav({ name: slotName(0), label: 'temp' }, '', [account])).toMatchObject({
      label: 'Account',
      url: bookmarkPagePath(account.id),
      useClusterURL: false,
    });
  });
});

describe('bookmark persistence', () => {
  const registered: NavRegistration[] = [];

  beforeEach(() => {
    registered.length = 0;
    setBookmarkRegistrar(entry => {
      registered.push(entry);
    });
  });

  it('publishes only the open cluster and keeps both clusters in storage', () => {
    window.history.pushState({}, '', '/c/kind/pods');
    toggleStoredBookmark({ cluster: 'kind', url: '/c/kind/pods', label: 'Pods' });
    toggleStoredBookmark({ cluster: 'other', url: '/c/other/nodes', label: 'Nodes' });
    expect(currentBookmarks().map(item => item.cluster)).toEqual(['kind', 'other']);
    expect(registered.map(entry => entry.label)).toEqual([
      'Bookmarks',
      'Pods',
      'Bookmarks',
      'Pods',
    ]);

    registered.length = 0;
    window.history.pushState({}, '', '/c/other/nodes');
    refreshBookmarkNav();
    expect(registered.map(entry => entry.label)).toEqual(['Bookmarks', 'Nodes']);

    const stored = parseBookmarks(localStorage.getItem(BOOKMARKS_KEY));
    expect(stored.map(item => item.label)).toEqual(['Pods', 'Nodes']);

    replaceBookmarks(removeBookmark(currentBookmarks(), stored[1].id));
    expect(bookmarksFor(currentBookmarks(), 'other')).toEqual([]);
    expect(bookmarksFor(currentBookmarks(), 'kind')).toHaveLength(1);
  });
});
