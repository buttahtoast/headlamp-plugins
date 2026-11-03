import { ActionButton } from '@kinvolk/headlamp-plugin/lib/components/common';
import { useEffect, useLayoutEffect, useState } from 'react';
import { useHistory, useLocation } from 'react-router-dom';
import {
  type BookmarkDraft,
  decodeBookmarkKey,
  describeResource,
  findBookmark,
  pageHeading,
  type ResourceRef,
} from './bookmarks';
import { currentBookmarks, subscribeBookmarks, toggleStoredBookmark } from './bookmarkStore';

function useBookmarkState(resolve: () => BookmarkDraft | null): {
  active: boolean;
  toggle: () => void;
} {
  const [items, setItems] = useState(currentBookmarks);
  useEffect(() => subscribeBookmarks(setItems), []);
  const draft = resolve();
  const active = Boolean(draft && findBookmark(items, draft.cluster, draft.url));

  function toggle() {
    const next = resolve();
    if (next) {
      toggleStoredBookmark(next);
    }
  }

  return { active, toggle };
}

export function BookmarkJump() {
  const history = useHistory();
  useLayoutEffect(() => {
    const key = history.location.pathname.split('/').pop() ?? '';
    const id = decodeBookmarkKey(key);
    const item = currentBookmarks().find(entry => entry.id === id);
    history.replace(item?.url || '/');
  }, [history]);
  return null;
}

export function BookmarkHeaderAction({ item }: { item?: ResourceRef }) {
  const location = useLocation();
  const { active, toggle } = useBookmarkState(() =>
    describeResource(item, {
      pathname: location.pathname,
      search: location.search,
      heading: pageHeading(document),
    })
  );
  return (
    <ActionButton
      description={active ? 'Remove bookmark' : 'Bookmark'}
      longDescription={
        active
          ? 'Remove this page from bookmarks'
          : 'Bookmark this page. It is listed at the top of the navigation.'
      }
      icon={active ? 'mdi:star' : 'mdi:star-outline'}
      color={
        active
          ? 'var(--mui-palette-primary-main, #1976d2)'
          : 'var(--mui-palette-text-secondary, rgba(0, 0, 0, 0.6))'
      }
      iconButtonProps={{
        'aria-pressed': active,
        'aria-label': active ? 'Remove bookmark' : 'Bookmark',
      }}
      onClick={event => {
        event.preventDefault();
        toggle();
      }}
    />
  );
}
