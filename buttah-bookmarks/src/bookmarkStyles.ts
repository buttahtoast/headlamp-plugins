/**
 * Sidebar chrome for bookmark stars, reorder controls, and the pinned block.
 * Colors follow Headlamp's MUI palette.
 */
export function bookmarkChromeCss(maxBookmarks: number): string {
  const lists = [
    "nav[aria-label='Navigation'] .MuiDrawer-paper .MuiGrid-container > .MuiGrid-item > .MuiList-root",
    '[data-buttah-nav] .MuiList-root',
  ];
  const rules: string[] = [];
  for (const list of lists) {
    rules.push(`${list} { display: flex !important; flex-direction: column !important; }`);
    rules.push(
      `${list} > .MuiListSubheader-root, ${list} > .MuiDivider-root { order: -1000 !important; }`
    );
    for (let index = 0; index < maxBookmarks; index += 1) {
      rules.push(
        `${list} > li:has(> a[data-buttah-bookmark-index="${index}"]) { order: ${
          -900 + index
        } !important; }`
      );
    }
  }

  rules.push(`
:is(nav[aria-label='Navigation'], [data-buttah-nav]) .MuiListSubheader-root {
  text-transform: none !important;
  font-size: 13px !important;
  font-weight: 600 !important;
  letter-spacing: 0.01em !important;
  opacity: 0.72;
}

:is(nav[aria-label='Navigation'], [data-buttah-nav]) li:has(> a[data-buttah-bookmark]),
:is(nav[aria-label='Navigation'], [data-buttah-nav]) li:has(> .buttah-nav-star) {
  position: relative;
}

:is(nav[aria-label='Navigation'], [data-buttah-nav]):has(a .MuiListItemText-root)
  a[data-buttah-bookmark] {
  padding-right: 108px !important;
}

:is(nav[aria-label='Navigation'], [data-buttah-nav]):has(a .MuiListItemText-root) li:hover > a,
:is(nav[aria-label='Navigation'], [data-buttah-nav]):has(a .MuiListItemText-root)
  li:focus-within
  > a,
:is(nav[aria-label='Navigation'], [data-buttah-nav]):has(a .MuiListItemText-root)
  li:has(> .buttah-nav-star.is-on)
  > a {
  padding-right: 34px !important;
}

:is(nav[aria-label='Navigation'], [data-buttah-nav]):has(a .MuiListItemText-root)
  li:hover
  > a[data-buttah-submenu],
:is(nav[aria-label='Navigation'], [data-buttah-nav]):has(a .MuiListItemText-root)
  li:focus-within
  > a[data-buttah-submenu],
:is(nav[aria-label='Navigation'], [data-buttah-nav]):has(a .MuiListItemText-root)
  li:has(> .buttah-nav-star.is-on)
  > a[data-buttah-submenu] {
  padding-right: 54px !important;
}

:is(nav[aria-label='Navigation'], [data-buttah-nav]) li:has(> a[data-buttah-bookmark-last]) {
  margin-bottom: 8px;
  box-shadow: inset 0 -1px 0 var(--mui-palette-divider, rgba(0, 0, 0, 0.12));
}

.buttah-bookmark-actions,
.buttah-nav-star {
  position: absolute;
  top: 50%;
  z-index: 1;
  display: flex;
  align-items: center;
  transform: translateY(-50%);
}

.buttah-bookmark-actions {
  right: 4px;
  gap: 2px;
}

.buttah-nav-star {
  right: 4px;
  color: inherit;
  opacity: 0;
  pointer-events: none;
}

:is(nav[aria-label='Navigation'], [data-buttah-nav]):has(a .MuiListItemText-root)
  li:hover
  > .buttah-nav-star,
:is(nav[aria-label='Navigation'], [data-buttah-nav]):has(a .MuiListItemText-root)
  li:focus-within
  > .buttah-nav-star,
:is(nav[aria-label='Navigation'], [data-buttah-nav]) .buttah-nav-star.is-on {
  opacity: 1;
  pointer-events: auto;
}

.buttah-nav-star .buttah-star-fill {
  display: none;
}

.buttah-nav-star.is-on .buttah-star-outline {
  display: none;
}

.buttah-nav-star.is-on .buttah-star-fill {
  display: block;
}

:is(nav[aria-label='Navigation'], [data-buttah-nav])
  li:has(> a[data-buttah-submenu])
  > .buttah-nav-star {
  right: 26px;
}

.buttah-nav-star:hover,
.buttah-nav-star:focus-visible {
  color: var(--mui-palette-text-secondary, rgba(0, 0, 0, 0.6));
}

.buttah-bookmark-actions button,
.buttah-nav-star {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: inherit;
  cursor: pointer;
}

.buttah-nav-star {
  color: inherit;
}

.buttah-bookmark-actions button:hover,
.buttah-bookmark-actions button:focus-visible {
  color: var(--mui-palette-primary-main, #1976d2);
  background: transparent;
}

.buttah-nav-star.is-on,
.buttah-nav-star.is-on:hover,
.buttah-nav-star.is-on:focus-visible {
  color: var(--mui-palette-primary-main, #1976d2);
  background: transparent;
}

.buttah-bookmark-actions button:disabled {
  opacity: 0.28;
  cursor: default;
}

.buttah-bookmark-actions button:focus-visible,
.buttah-nav-star:focus-visible {
  outline: 2px solid currentColor;
  outline-offset: 2px;
}

:is(nav[aria-label='Navigation'], [data-buttah-nav]):not(:has(a .MuiListItemText-root))
  .buttah-bookmark-actions,
:is(nav[aria-label='Navigation'], [data-buttah-nav]):not(:has(a .MuiListItemText-root))
  .buttah-nav-star {
  display: none !important;
}

:is(nav[aria-label='Navigation'], [data-buttah-nav]) li.is-dragging > a {
  opacity: 0.45;
}

html[data-buttah-coarse] [data-buttah-nav] .buttah-nav-star,
html[data-buttah-coarse] [data-buttah-nav] .buttah-bookmark-actions button {
  width: 44px;
  height: 44px;
  opacity: 1 !important;
  pointer-events: auto !important;
}

html[data-buttah-coarse] [data-buttah-nav]:has(a .MuiListItemText-root) li > a {
  padding-right: 52px !important;
}

html[data-buttah-coarse]
  [data-buttah-nav]:has(a .MuiListItemText-root)
  li
  > a[data-buttah-submenu] {
  padding-right: 76px !important;
}

html[data-buttah-coarse]
  [data-buttah-nav]:has(a .MuiListItemText-root)
  a[data-buttah-bookmark] {
  padding-right: 192px !important;
}

@media (max-width: 599px) {
  [data-buttah-nav] .buttah-nav-star,
  [data-buttah-nav] .buttah-bookmark-actions button {
    width: 44px;
    height: 44px;
    opacity: 1 !important;
    pointer-events: auto !important;
  }

  [data-buttah-nav]:has(a .MuiListItemText-root) li > a {
    padding-right: 52px !important;
  }

  [data-buttah-nav]:has(a .MuiListItemText-root) li > a[data-buttah-submenu] {
    padding-right: 76px !important;
  }

  :is(nav[aria-label='Navigation'], [data-buttah-nav]):has(a .MuiListItemText-root)
    a[data-buttah-bookmark] {
    padding-right: 192px !important;
  }
}
`);
  return rules.join('\n');
}
