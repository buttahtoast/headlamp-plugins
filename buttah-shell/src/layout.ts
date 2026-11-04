import jetbrainsMono from '@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2?inline';
import dockCss from './dock.css?inline';

/** Duplicated in the console plugin. Plugins do not import each other. */
export const SHELL_LAYOUT_EVENT = 'buttah-shell-layout';

/** Structural rules for when the console stylesheet is not installed. */
export function installShellLayout(): void {
  if (typeof document === 'undefined') {
    return;
  }
  if (
    document.getElementById('buttah-shell-styles') ||
    document.getElementById('buttah-shell-layout')
  ) {
    return;
  }
  const style = document.createElement('style');
  style.id = 'buttah-shell-layout';
  style.textContent = dockCss;
  document.head.appendChild(style);
}

/** JetBrains Mono, inlined so the plugin bundle does not need a second file. */
export function installShellFont(): void {
  if (typeof document === 'undefined' || document.getElementById('buttah-shell-font')) {
    return;
  }
  const source = typeof jetbrainsMono === 'string' ? jetbrainsMono : '';
  if (!source) {
    return;
  }
  const href =
    source.startsWith('data:') || source.startsWith('blob:') || source.startsWith('http')
      ? source
      : `data:font/woff2;base64,${source}`;
  const style = document.createElement('style');
  style.id = 'buttah-shell-font';
  style.textContent = `@font-face{font-family:"JetBrains Mono";font-style:normal;font-weight:400;font-display:swap;src:url("${href}") format("woff2");}`;
  document.head.appendChild(style);
}

export function publishShellLayout(): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.dispatchEvent(new CustomEvent(SHELL_LAYOUT_EVENT));
}

export function readShellTop(raw: string): number | null {
  const value = raw.trim();
  if (!value.endsWith('px')) {
    return null;
  }
  const parsed = Number(value.slice(0, -2));
  return Number.isFinite(parsed) ? parsed : null;
}

export function navHandleBox(
  navTop: number,
  navHeight: number,
  shellTop: number | null
): { top: number; height: number } {
  if (shellTop === null || !Number.isFinite(navTop) || !Number.isFinite(navHeight)) {
    return { top: navTop, height: Math.max(0, navHeight) };
  }
  const navBottom = navTop + navHeight;
  if (shellTop >= navBottom) {
    return { top: navTop, height: Math.max(0, navHeight) };
  }
  return { top: navTop, height: Math.max(0, shellTop - navTop) };
}
