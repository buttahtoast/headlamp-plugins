import { afterEach, describe, expect, it } from 'vitest';
import {
  bookmarkClickAction,
  decorateBookmarkNav,
  installBookmarkStyles,
  markTruncatedNavLabel,
  navigationSurfaces,
} from './bookmarkChrome';
import { bookmarkGoPath, bookmarkId } from './bookmarks';

const pods = {
  id: bookmarkId('kind', '/c/kind/pods'),
  cluster: 'kind',
  label: 'Pods',
  url: '/c/kind/pods',
  icon: 'mdi:bookmark',
};

function nav(): HTMLElement {
  document.body.innerHTML = `
    <nav aria-label="Navigation">
      <div class="MuiDrawer-paper">
        <ul class="MuiList-root">
          <li>
            <a class="MuiListItemButton-root" href="/c/kind/pods">
              <span class="MuiListItemText-primary">Pods</span>
            </a>
          </li>
          <li>
            <a class="MuiListItemButton-root" href="/c/kind/secrets" data-buttah-submenu="true">
              <span class="MuiListItemText-primary">Secrets</span>
            </a>
          </li>
          <li class="MuiListSubheader-root">Bookmarks</li>
          <li>
            <a class="MuiListItemButton-root" data-buttah-bookmark="${pods.id}" data-buttah-bookmark-index="0" data-buttah-bookmark-last="true" href="/c/kind/pods">
              <span class="MuiListItemText-primary">Pods</span>
            </a>
          </li>
        </ul>
      </div>
    </nav>`;
  return document.querySelector('nav') as HTMLElement;
}

afterEach(() => {
  document.body.innerHTML = '';
  document.getElementById('buttah-bookmark-order')?.remove();
});

describe('bookmark controls', () => {
  it('adds a star on navigation rows and remove on a bookmark', () => {
    nav();
    decorateBookmarkNav(document, [pods]);
    const stars = document.querySelectorAll('[data-buttah-nav-star]');
    expect(stars).toHaveLength(2);
    expect(stars[0]?.getAttribute('aria-pressed')).toBe('true');
    expect(stars[1]?.getAttribute('aria-pressed')).toBe('false');
    expect(document.querySelector('[data-buttah-bookmark-remove]')).not.toBeNull();
    expect(document.querySelectorAll('[data-buttah-nav-star]').length).toBe(2);

    decorateBookmarkNav(document, [pods]);
    expect(document.querySelectorAll('[data-buttah-nav-star]')).toHaveLength(2);
    expect(document.querySelectorAll('[data-buttah-bookmark-remove]')).toHaveLength(1);
  });

  it('fills the star while the page is bookmarked and greys it when removed', () => {
    nav();
    decorateBookmarkNav(document, [pods]);
    const star = document
      .querySelector('a[href="/c/kind/pods"]')
      ?.parentElement?.querySelector('[data-buttah-nav-star]');
    expect(star?.classList.contains('is-on')).toBe(true);
    expect(star?.querySelector('.buttah-star-outline')).not.toBeNull();
    expect(star?.querySelector('.buttah-star-fill')).not.toBeNull();
    expect(star?.getAttribute('title')).toBe('Remove bookmark Pods');

    decorateBookmarkNav(document, []);
    expect(star?.classList.contains('is-on')).toBe(false);
    expect(star?.getAttribute('aria-pressed')).toBe('false');
    expect(star?.getAttribute('aria-label')).toBe('Bookmark Pods');
  });

  it('reads remove, move, and star clicks from the row', () => {
    nav();
    const second = {
      ...pods,
      id: bookmarkId('kind', '/c/kind/deployments'),
      label: 'Deployments',
      url: '/c/kind/deployments',
    };
    document
      .querySelector('ul')
      ?.insertAdjacentHTML(
        'beforeend',
        `<li><a class="MuiListItemButton-root" data-buttah-bookmark="${second.id}" data-buttah-bookmark-index="1" href="/c/kind/deployments"><span class="MuiListItemText-primary">Deployments</span></a></li>`
      );
    decorateBookmarkNav(document, [pods, second]);
    const remove = document.querySelector('[data-buttah-bookmark-remove]');
    const move = document.querySelector('[data-buttah-bookmark-move="1"]');
    const star = document.querySelector('[data-buttah-nav-star][aria-pressed="false"]');
    expect(remove).not.toBeNull();
    expect(move).not.toBeNull();
    expect(star).not.toBeNull();
    if (!remove || !move || !star) {
      return;
    }
    expect(bookmarkClickAction(remove)).toEqual({ type: 'remove', id: pods.id });
    expect(bookmarkClickAction(move)).toEqual({ type: 'move', id: pods.id, delta: 1 });
    expect(bookmarkClickAction(star)).toEqual({
      type: 'star',
      draft: {
        cluster: 'kind',
        url: '/c/kind/secrets',
        label: 'Secrets',
        icon: 'mdi:bookmark',
      },
    });
  });

  it('marks a jump link that Headlamp rendered without data attributes', () => {
    const href = `/c/kind${bookmarkGoPath(pods.id)}`;
    document.body.innerHTML = `
      <nav aria-label="Navigation">
        <ul>
          <li>
            <a class="MuiListItemButton-root" href="${href}">
              <span class="MuiListItemText-primary">Pods</span>
            </a>
          </li>
        </ul>
      </nav>`;
    decorateBookmarkNav(document, [pods]);
    const link = document.querySelector('a');
    expect(link?.getAttribute('data-buttah-bookmark')).toBe(pods.id);
    expect(link?.getAttribute('data-buttah-bookmark-index')).toBe('0');
    expect(document.querySelector('[data-buttah-bookmark-remove]')).not.toBeNull();
    expect(document.querySelector('[data-buttah-nav-star]')).toBeNull();
  });

  it('tooltips a label only when the text overflows its box', () => {
    nav();
    const label = document.querySelector(
      'a[href="/c/kind/secrets"] .MuiListItemText-primary'
    ) as HTMLElement;
    const link = label.closest('a') as HTMLAnchorElement;
    Object.defineProperty(label, 'scrollWidth', { configurable: true, value: 180 });
    Object.defineProperty(label, 'clientWidth', { configurable: true, value: 40 });
    markTruncatedNavLabel(link);
    expect(link.title).toBe('Secrets');
    expect(label.title).toBe('Secrets');

    Object.defineProperty(label, 'scrollWidth', { configurable: true, value: 40 });
    Object.defineProperty(label, 'clientWidth', { configurable: true, value: 80 });
    markTruncatedNavLabel(link);
    expect(link.hasAttribute('title')).toBe(false);
    expect(label.hasAttribute('title')).toBe(false);
  });

  it('stamps a portaled phone drawer and adds its stars', () => {
    document.body.innerHTML = `
      <nav aria-label="Navigation"></nav>
      <div class="MuiDrawer-root MuiDrawer-modal">
        <div class="MuiDrawer-paper MuiDrawer-paperAnchorLeft">
          <a class="MuiListItemButton-root" href="/c/kind/pods">
            <span class="MuiListItemText-primary">Pods</span>
          </a>
        </div>
      </div>`;
    const surfaces = navigationSurfaces(document);
    expect(surfaces).toHaveLength(2);
    expect(document.querySelector('.MuiDrawer-modal')?.hasAttribute('data-buttah-nav')).toBe(true);
    decorateBookmarkNav(document, []);
    const star = document.querySelector('.MuiDrawer-modal [data-buttah-nav-star]');
    expect(star?.getAttribute('aria-label')).toBe('Bookmark Pods');
    expect(document.querySelector('nav [data-buttah-nav-star]')).toBeNull();
  });

  it('leaves a collapsed rail alone', () => {
    document.body.innerHTML = `
      <nav aria-label="Navigation">
        <a class="MuiListItemButton-root" href="/c/kind/pods" aria-label="Pods"></a>
      </nav>`;
    decorateBookmarkNav(document, [pods]);
    expect(document.querySelector('[data-buttah-nav-star]')).toBeNull();
  });

  it('injects the bookmark stylesheet once', () => {
    installBookmarkStyles();
    installBookmarkStyles();
    const style = document.getElementById('buttah-bookmark-order');
    expect(style).not.toBeNull();
    expect(document.querySelectorAll('#buttah-bookmark-order')).toHaveLength(1);
    expect(style?.textContent).toContain('.buttah-nav-star');
    expect(style?.textContent).toContain('data-buttah-bookmark-index="0"');
    expect(style?.textContent).toContain('[data-buttah-nav]');
  });
});
