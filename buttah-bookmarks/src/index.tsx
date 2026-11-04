import type { PluginSettingsDetailsProps } from '@kinvolk/headlamp-plugin/lib';
import {
  registerDetailsViewHeaderAction,
  registerPluginSettings,
  registerRoute,
  registerSidebarEntryFilter,
} from '@kinvolk/headlamp-plugin/lib';
import { BookmarkHeaderAction, BookmarkJump } from './BookmarkButton';
import { installBookmarkChrome } from './bookmarkChrome';
import { bookmarkSource, filterBookmarkNav, isBookmarkNavName, type NavEntry } from './bookmarks';
import { startBookmarks } from './bookmarkStore';

function BookmarkSettings(props: PluginSettingsDetailsProps) {
  void props;
  return (
    <p>Stars are saved in this browser.</p>
  );
}

registerPluginSettings('buttah-bookmarks', BookmarkSettings, false);
registerDetailsViewHeaderAction(BookmarkHeaderAction);

registerRoute({
  path: '/buttah/go/:bookmark',
  sidebar: null,
  name: 'buttah-bookmark-go',
  exact: true,
  component: BookmarkJump,
});

registerRoute({
  path: '/buttah/page/:bookmark',
  sidebar: null,
  name: 'buttah-bookmark-page',
  exact: true,
  useClusterURL: false,
  noAuthRequired: true,
  component: BookmarkJump,
});

registerSidebarEntryFilter(entry => {
  if (!isBookmarkNavName(entry.name ?? '')) {
    return entry;
  }
  const { cluster, items } = bookmarkSource();
  return filterBookmarkNav(entry as NavEntry, cluster, items) as typeof entry | null;
});

startBookmarks();
installBookmarkChrome();
