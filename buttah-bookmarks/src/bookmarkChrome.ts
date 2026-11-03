import {
  type Bookmark,
  type BookmarkDraft,
  BOOKMARKS_EVENT,
  decodeBookmarkKey,
  describePage,
  findBookmark,
  MAX_BOOKMARKS,
  splitHref,
} from './bookmarks';
import {
  currentBookmarks,
  moveStoredBookmark,
  removeStoredBookmark,
  reorderStoredBookmark,
  toggleStoredBookmark,
} from './bookmarkStore';
import { bookmarkChromeCss } from './bookmarkStyles';

const STAR_PATH = 'M8 1.7 9.7 6h4.5l-3.6 2.7 1.4 4.4L8 10.5 4 13.1l1.4-4.4L1.8 6h4.5L8 1.7z';
const STAR = `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path class="buttah-star-outline" fill="none" stroke="currentColor" stroke-width="1.2" d="${STAR_PATH}"/><path class="buttah-star-fill" fill="currentColor" d="${STAR_PATH}"/></svg>`;
const GRIP =
  '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path fill="currentColor" d="M5 3.2h1.4v1.4H5V3.2Zm4.6 0H11v1.4H9.6V3.2ZM5 7.3h1.4v1.4H5V7.3Zm4.6 0H11v1.4H9.6V7.3ZM5 11.4h1.4V12.8H5v-1.4Zm4.6 0H11v1.4H9.6v-1.4Z"/></svg>';
const UP =
  '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.6" d="M8 12.2V3.8M4.6 7.1 8 3.7l3.4 3.4"/></svg>';
const DOWN =
  '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.6" d="M8 3.8v8.4M4.6 8.9 8 12.3l3.4-3.4"/></svg>';
const REMOVE =
  '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.6" d="M4 4l8 8M12 4 4 12"/></svg>';

export type BookmarkClick =
  | { type: 'remove'; id: string }
  | { type: 'move'; id: string; delta: -1 | 1 }
  | { type: 'star'; draft: BookmarkDraft };

let installed = false;
let frame = 0;
let dragging: string | null = null;

export function bookmarkClickAction(target: Element): BookmarkClick | null {
  const remove = target.closest('[data-buttah-bookmark-remove]');
  if (remove instanceof HTMLElement) {
    const id = bookmarkIdFrom(remove);
    return id ? { type: 'remove', id } : null;
  }
  const move = target.closest('[data-buttah-bookmark-move]');
  if (move instanceof HTMLElement) {
    const id = bookmarkIdFrom(move);
    const delta = move.getAttribute('data-buttah-bookmark-move');
    if (!id || (delta !== '-1' && delta !== '1') || move.hasAttribute('disabled')) {
      return null;
    }
    return { type: 'move', id, delta: delta === '-1' ? -1 : 1 };
  }
  const star = target.closest('[data-buttah-nav-star]');
  if (star instanceof HTMLElement) {
    const href = star.getAttribute('data-url');
    const label = star.getAttribute('data-label') ?? '';
    if (!href) {
      return null;
    }
    const parts = splitHref(href);
    if (!parts) {
      return null;
    }
    const draft = describePage({ ...parts, heading: label });
    return draft ? { type: 'star', draft } : null;
  }
  return null;
}

export function installBookmarkStyles(): void {
  if (typeof document === 'undefined' || document.getElementById('buttah-bookmark-order')) {
    return;
  }
  const style = document.createElement('style');
  style.id = 'buttah-bookmark-order';
  style.textContent = bookmarkChromeCss(MAX_BOOKMARKS);
  document.head.appendChild(style);
}

function bookmarkIdFrom(node: Element): string | null {
  const row = node.closest('li');
  const link = row?.querySelector('a[data-buttah-bookmark]');
  const id = link?.getAttribute('data-buttah-bookmark');
  return id || null;
}

const JUMP_HREF = /\/buttah\/(?:go|page)\/([^/?#]+)/;

/**
 * Headlamp's registerSidebarEntry drops unknown fields, so the live link has
 * no data attributes. The bookmark id is in the jump URL; stamp it here.
 */
function markBookmarkLink(link: HTMLAnchorElement, items: Bookmark[]): boolean {
  const href = link.getAttribute('href') ?? '';
  const match = href.match(JUMP_HREF);
  if (!match) {
    return link.hasAttribute('data-buttah-bookmark');
  }
  let key = match[1];
  try {
    key = decodeURIComponent(key);
  } catch {
    return false;
  }
  const id = decodeBookmarkKey(key);
  const item = items.find(entry => entry.id === id);
  if (!item) {
    return false;
  }
  const mine = items.filter(entry => entry.cluster === item.cluster);
  const index = mine.findIndex(entry => entry.id === id);
  link.setAttribute('data-buttah-bookmark', id);
  link.setAttribute('data-buttah-bookmark-index', String(index));
  if (index === mine.length - 1) {
    link.setAttribute('data-buttah-bookmark-last', 'true');
  } else {
    link.removeAttribute('data-buttah-bookmark-last');
  }
  return true;
}

/**
 * Ellipsis hides the rest of a label. The native title is the tooltip, and it
 * is set only when the text actually overflows so short rows stay quiet.
 * A width of 0 means the row has not been laid out yet.
 */
export function markTruncatedNavLabel(link: HTMLAnchorElement): void {
  const label = link.querySelector('.MuiListItemText-primary');
  if (!(label instanceof HTMLElement)) {
    return;
  }
  const text = label.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  if (!text || label.clientWidth <= 0) {
    return;
  }
  if (label.scrollWidth > label.clientWidth + 1) {
    link.title = text;
    label.title = text;
    return;
  }
  if (link.title === text) {
    link.removeAttribute('title');
  }
  if (label.title === text) {
    label.removeAttribute('title');
  }
}

const NAV_SELECTOR = "nav[aria-label='Navigation']";

/**
 * Headlamp's phone drawer is a modal portaled to document.body, so it is not
 * inside nav[aria-label=Navigation]. Stamp that root so the same sidebar CSS
 * and bookmark controls apply. A docked desktop drawer stays inside the nav.
 */
export function navigationSurfaces(root: ParentNode): HTMLElement[] {
  const surfaces: HTMLElement[] = [];
  root.querySelectorAll(NAV_SELECTOR).forEach(nav => {
    if (nav instanceof HTMLElement) {
      surfaces.push(nav);
    }
  });
  root.querySelectorAll('.MuiDrawer-root.MuiDrawer-modal').forEach(drawer => {
    if (!(drawer instanceof HTMLElement)) {
      return;
    }
    if (drawer.closest(NAV_SELECTOR)) {
      drawer.removeAttribute('data-buttah-nav');
      return;
    }
    const sidebar = drawer.querySelector('.MuiDrawer-paperAnchorLeft .MuiListItemButton-root');
    if (!sidebar) {
      drawer.removeAttribute('data-buttah-nav');
      return;
    }
    drawer.setAttribute('data-buttah-nav', '');
    surfaces.push(drawer);
  });
  return surfaces;
}

export function decorateBookmarkNav(root: ParentNode, items: Bookmark[]): void {
  navigationSurfaces(root).forEach(nav => {
    const expanded = Boolean(nav.querySelector('a .MuiListItemText-primary')?.textContent?.trim());
    if (!expanded) {
      return;
    }
    nav.querySelectorAll('a.MuiListItemButton-root').forEach(node => {
      if (!(node instanceof HTMLAnchorElement)) {
        return;
      }
      const row = node.parentElement;
      if (!(row instanceof HTMLElement)) {
        return;
      }
      markTruncatedNavLabel(node);
      if (markBookmarkLink(node, items)) {
        ensureBookmarkActions(row, node, items);
        return;
      }
      ensureNavStar(row, node, items);
    });
  });
}

function ensureNavStar(row: HTMLElement, link: HTMLAnchorElement, items: Bookmark[]): void {
  const href = link.getAttribute('href');
  const label =
    link.querySelector('.MuiListItemText-primary')?.textContent?.replace(/\s+/g, ' ').trim() ||
    link.getAttribute('aria-label') ||
    '';
  if (!href || !label) {
    return;
  }
  const parts = splitHref(href);
  const draft = parts ? describePage({ ...parts, heading: label }) : null;
  if (!draft) {
    return;
  }
  const on = Boolean(findBookmark(items, draft.cluster, draft.url));
  const star = navStar(row);
  star.classList.toggle('is-on', on);
  star.setAttribute('data-url', draft.url);
  star.setAttribute('data-label', label);
  star.setAttribute('aria-pressed', on ? 'true' : 'false');
  star.setAttribute('aria-label', on ? `Remove bookmark ${label}` : `Bookmark ${label}`);
  star.title = on ? `Remove bookmark ${label}` : `Bookmark ${label}`;
}

function navStar(row: HTMLElement): HTMLButtonElement {
  const existing = row.querySelector(':scope > [data-buttah-nav-star]');
  if (existing instanceof HTMLButtonElement) {
    return existing;
  }
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'buttah-nav-star';
  button.setAttribute('data-buttah-nav-star', '');
  button.innerHTML = STAR;
  row.append(button);
  return button;
}

function pinBookmarkRow(row: HTMLElement, index: number): void {
  const list = row.closest('ul');
  if (list instanceof HTMLElement) {
    list.style.display = 'flex';
    list.style.flexDirection = 'column';
    list
      .querySelectorAll(':scope > .MuiListSubheader-root, :scope > .MuiDivider-root')
      .forEach(node => {
        if (node instanceof HTMLElement) {
          node.style.order = '-1000';
        }
      });
  }
  row.style.order = String(-900 + index);
}

function ensureBookmarkActions(row: HTMLElement, link: HTMLAnchorElement, items: Bookmark[]): void {
  const id = link.getAttribute('data-buttah-bookmark');
  const index = Number(link.getAttribute('data-buttah-bookmark-index'));
  if (!id || !Number.isInteger(index)) {
    return;
  }
  pinBookmarkRow(row, index);
  const label =
    link.querySelector('.MuiListItemText-primary')?.textContent?.trim() || link.title || 'bookmark';
  const cluster = items.find(item => item.id === id)?.cluster;
  const count = cluster === undefined ? 0 : items.filter(item => item.cluster === cluster).length;
  const signature = `${id}|${index}|${count}|${label}`;
  const existing = row.querySelector(':scope > .buttah-bookmark-actions');
  if (existing?.getAttribute('data-signature') === signature) {
    return;
  }
  existing?.remove();
  const actions = document.createElement('div');
  actions.className = 'buttah-bookmark-actions';
  actions.setAttribute('data-signature', signature);
  if (count > 1) {
    actions.append(
      iconButton('buttah-bookmark-grip', GRIP, `Reorder ${label}`, 'data-buttah-bookmark-grip')
    );
    actions.append(moveButton(label, -1, index === 0));
    actions.append(moveButton(label, 1, index >= count - 1));
  }
  actions.append(
    iconButton(
      'buttah-bookmark-remove',
      REMOVE,
      `Remove bookmark ${label}`,
      'data-buttah-bookmark-remove'
    )
  );
  row.append(actions);
}

function moveButton(label: string, delta: -1 | 1, disabled: boolean): HTMLButtonElement {
  const button = iconButton(
    'buttah-bookmark-move',
    delta < 0 ? UP : DOWN,
    delta < 0 ? `Move ${label} up` : `Move ${label} down`,
    'data-buttah-bookmark-move'
  );
  button.setAttribute('data-buttah-bookmark-move', String(delta));
  button.disabled = disabled;
  return button;
}

function iconButton(
  className: string,
  svg: string,
  label: string,
  attr: string
): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.setAttribute(attr, '');
  button.setAttribute('aria-label', label);
  button.title = label;
  button.innerHTML = svg;
  if (attr === 'data-buttah-bookmark-grip') {
    button.draggable = true;
  }
  return button;
}

export function installBookmarkChrome(): void {
  if (installed || typeof document === 'undefined' || typeof MutationObserver === 'undefined') {
    return;
  }
  installed = true;
  installBookmarkStyles();
  const run = () => decorateBookmarkNav(document, currentBookmarks());
  const schedule = () => {
    if (frame) {
      return;
    }
    frame = requestAnimationFrame(() => {
      frame = 0;
      run();
    });
  };
  document.addEventListener(
    'click',
    event => {
      if (!(event.target instanceof Element)) {
        return;
      }
      const action = bookmarkClickAction(event.target);
      if (!action) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (action.type === 'remove') {
        removeStoredBookmark(action.id);
      } else if (action.type === 'move') {
        moveStoredBookmark(action.id, action.delta);
      } else {
        toggleStoredBookmark(action.draft);
      }
    },
    true
  );
  document.addEventListener('dragstart', event => {
    if (!(event.target instanceof Element) || !event.dataTransfer) {
      return;
    }
    const grip = event.target.closest('[data-buttah-bookmark-grip]');
    if (!(grip instanceof HTMLElement)) {
      return;
    }
    const id = bookmarkIdFrom(grip);
    if (!id) {
      return;
    }
    dragging = id;
    event.dataTransfer.setData('text/plain', id);
    event.dataTransfer.effectAllowed = 'move';
    grip.closest('li')?.classList.add('is-dragging');
  });
  document.addEventListener('dragover', event => {
    if (!dragging || !(event.target instanceof Element)) {
      return;
    }
    const row = event.target.closest('li');
    if (!row?.querySelector('a[data-buttah-bookmark]')) {
      return;
    }
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
  });
  document.addEventListener('drop', event => {
    const fromId = dragging;
    dragging = null;
    document.querySelectorAll('.is-dragging').forEach(node => node.classList.remove('is-dragging'));
    if (!fromId || !(event.target instanceof Element)) {
      return;
    }
    const row = event.target.closest('li');
    const toId = row
      ?.querySelector('a[data-buttah-bookmark]')
      ?.getAttribute('data-buttah-bookmark');
    if (!toId) {
      return;
    }
    event.preventDefault();
    reorderStoredBookmark(fromId, toId);
  });
  document.addEventListener('dragend', () => {
    dragging = null;
    document.querySelectorAll('.is-dragging').forEach(node => node.classList.remove('is-dragging'));
  });
  window.addEventListener(BOOKMARKS_EVENT, schedule);
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  schedule();
}
