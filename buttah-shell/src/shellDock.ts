/**
 * Layout and terminal options for the docked OIDC shell.
 *
 * The panel sits in the content column, to the right of a docked sidebar, and
 * above the page. The navigation resize line reads `--buttah-shell-top` and
 * stops there, so it cannot run through the terminal. Below 960px the drawer
 * is an overlay and the panel uses the full width. The terminal follows the
 * Headlamp theme unless the toolbar cycle picks dark or light.
 */
import { tokenIdentity } from './kubeconfig';
import { decodeExecFrame } from './oidc';

export { navHandleBox, readShellTop } from './layout';

export const SHELL_HEIGHT_KEY = 'buttah-shell.shellHeight';
export const SHELL_TOP_VAR = '--buttah-shell-top';
export const SHELL_DOCK_BREAKPOINT = 960;
export const SHELL_HEADER_PX = 40;
export const SHELL_HEADER_COARSE_PX = 48;
export const SHELL_TAB_PX = 34;
export const SHELL_MIN_PX = 180;
export const SHELL_DEFAULT_PX = 360;
export const SHELL_MAX_RATIO = 0.72;
export const SHELL_HEIGHT_STEP = 32;
export const SHELL_FONT_MIN = 12;
export const SHELL_FONT_MAX = 20;
export const SHELL_FONT_DEFAULT = 14;
export const SHELL_FONT =
  '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

export type ShellChrome = 'open' | 'minimized' | 'maximized';
export type ShellLink = 'connecting' | 'connected' | 'disconnected';
export type ShellTone = 'dark' | 'light';
export type ShellTonePref = 'auto' | ShellTone;
export type ShellCommandName = 'copy' | 'paste' | 'clear' | 'find-next' | 'find-prev';

const DARK_ANSI = {
  selectionBackground: '#45475a',
  black: '#45475a',
  red: '#f38ba8',
  green: '#a6e3a1',
  yellow: '#f9e2af',
  blue: '#89b4fa',
  magenta: '#cba6f7',
  cyan: '#94e2d5',
  white: '#bac2de',
  brightBlack: '#585b70',
  brightRed: '#f5a3b8',
  brightGreen: '#b5ebaf',
  brightYellow: '#fbe7b8',
  brightBlue: '#a6c8fb',
  brightMagenta: '#d7bff9',
  brightCyan: '#aaeadf',
  brightWhite: '#cdd6f4',
};

const LIGHT_ANSI = {
  selectionBackground: '#acb0be',
  black: '#5c5f77',
  red: '#d20f39',
  green: '#40a02b',
  yellow: '#df8e1d',
  blue: '#1e66f5',
  magenta: '#8839ef',
  cyan: '#179299',
  white: '#4c4f69',
  brightBlack: '#6c6f85',
  brightRed: '#e64553',
  brightGreen: '#40a02b',
  brightYellow: '#df8e1d',
  brightBlue: '#1e66f5',
  brightMagenta: '#8839ef',
  brightCyan: '#179299',
  brightWhite: '#4c4f69',
};

export function shellTone(pref: ShellTonePref, page: ShellTone): ShellTone {
  return pref === 'auto' ? page : pref;
}

export function cycleShellTone(pref: ShellTonePref): ShellTonePref {
  if (pref === 'dark') {
    return 'light';
  }
  if (pref === 'light') {
    return 'auto';
  }
  return 'dark';
}

export function clampShellFont(size: number): number {
  if (!Number.isFinite(size)) {
    return SHELL_FONT_DEFAULT;
  }
  return Math.min(SHELL_FONT_MAX, Math.max(SHELL_FONT_MIN, Math.round(size)));
}

/** Chrome colors for the dock. The xterm palette uses the same pair. */
export function shellPalette(tone: ShellTone): {
  background: string;
  foreground: string;
  cursor: string;
  chrome: string;
  muted: string;
  border: string;
} {
  if (tone === 'light') {
    return {
      background: '#eff1f5',
      foreground: '#4c4f69',
      cursor: '#40a02b',
      chrome: '#e6e9ef',
      muted: '#6c6f85',
      border: 'rgba(76, 79, 105, 0.16)',
    };
  }
  return {
    background: '#1e1e2e',
    foreground: '#cdd6f4',
    cursor: '#a6e3a1',
    chrome: '#181825',
    muted: '#a6adc8',
    border: 'rgba(205, 214, 244, 0.12)',
  };
}

/** Terminal options for one tone. Callers can still override the three base colors. */
export function shellXtermOptions(input: {
  background: string;
  foreground: string;
  cursor: string;
  fontFamily: string;
  fontSize?: number;
  tone?: ShellTone;
}) {
  const ansi = input.tone === 'light' ? LIGHT_ANSI : DARK_ANSI;
  return {
    cursorBlink: true,
    cursorStyle: 'bar' as const,
    fontFamily: input.fontFamily,
    fontSize: input.fontSize ?? SHELL_FONT_DEFAULT,
    lineHeight: 1.45,
    scrollback: 5000,
    theme: {
      background: input.background,
      foreground: input.foreground,
      cursor: input.cursor,
      cursorAccent: input.background,
      selectionForeground: input.foreground,
      ...ansi,
    },
  };
}

/**
 * Prints only the ID token's payload segment. The shell pod holds the token
 * in its kubeconfig; the browser exchange often never sees it.
 */
export const SHELL_IDENTITY_SCRIPT = [
  'cfg=${KUBECONFIG:-$HOME/.kube/config}',
  'tok=$(sed -n \'s/^[[:space:]]*token:[[:space:]]*"\\{0,1\\}\\([^"[:space:]]*\\)"\\{0,1\\}.*/\\1/p\' "$cfg" | head -n 1)',
  'printf %s "$tok" | cut -d. -f2',
].join('; ');

export function maxShellHeight(viewport: number): number {
  const usable = Number.isFinite(viewport) && viewport > 0 ? viewport : SHELL_DEFAULT_PX;
  return Math.max(SHELL_MIN_PX, Math.floor(usable * SHELL_MAX_RATIO));
}

export function clampShellHeight(height: number, viewport: number): number {
  const max = maxShellHeight(viewport);
  const min = Math.min(SHELL_MIN_PX, max);
  if (!Number.isFinite(height)) {
    return Math.min(SHELL_DEFAULT_PX, max);
  }
  return Math.round(Math.min(max, Math.max(min, height)));
}

export function readStoredShellHeight(stored: string | null, viewport: number): number {
  if (stored === null || stored.trim() === '') {
    return clampShellHeight(SHELL_DEFAULT_PX, viewport);
  }
  return clampShellHeight(Number(stored), viewport);
}

export function shellHeightFromPointer(viewportHeight: number, clientY: number): number {
  return clampShellHeight(viewportHeight - clientY, viewportHeight);
}

export function shellHeaderPx(coarse: boolean): number {
  return coarse ? SHELL_HEADER_COARSE_PX : SHELL_HEADER_PX;
}

/** A docked sidebar keeps its column. An overlay drawer, and every phone width, does not. */
export function shellDockLeft(viewportWidth: number, dockedNavRight: number | null): number {
  if (!Number.isFinite(viewportWidth) || viewportWidth < SHELL_DOCK_BREAKPOINT) {
    return 0;
  }
  if (dockedNavRight === null || !Number.isFinite(dockedNavRight) || dockedNavRight <= 0) {
    return 0;
  }
  return Math.round(dockedNavRight);
}

export function shellLink(input: {
  podFailed: boolean;
  running: boolean;
  terminal: ShellLink;
}): ShellLink {
  if (input.podFailed) {
    return 'disconnected';
  }
  if (!input.running) {
    return 'connecting';
  }
  return input.terminal;
}

export function identityFromIdToken(token: string): string {
  const trimmed = token.trim();
  if (!trimmed) {
    return '';
  }
  try {
    return tokenIdentity(trimmed).userName;
  } catch {
    return '';
  }
}

/** The pod probe prints the JWT payload segment, not the bearer token. */
export function identityFromPayloadSegment(segment: string): string {
  const trimmed = segment.trim();
  if (!trimmed || trimmed.includes('.')) {
    return '';
  }
  return identityFromIdToken(`e30.${trimmed}.sig`);
}

export function encodeExecFrame(channel: number, text: string): Uint8Array {
  const body = new TextEncoder().encode(text);
  const frame = new Uint8Array(body.length + 1);
  frame[0] = channel;
  frame.set(body, 1);
  return frame;
}

export function bytesFromExecData(data: unknown): Uint8Array | null {
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  if (typeof data !== 'string' || data === '') {
    return null;
  }
  try {
    const binary = atob(data);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    return null;
  }
}

export function readExecData(data: unknown): { channel: number; text: string } | null {
  const bytes = bytesFromExecData(data);
  if (!bytes) {
    return null;
  }
  return decodeExecFrame(bytes);
}

type ExecSocket = {
  protocol: string;
  send: (data: string | Uint8Array) => void;
};

export function sendExecFrame(socket: ExecSocket, channel: number, text: string): void {
  const frame = encodeExecFrame(channel, text);
  if (socket.protocol.includes('base64')) {
    let binary = '';
    for (const byte of frame) {
      binary += String.fromCharCode(byte);
    }
    socket.send(btoa(binary));
    return;
  }
  socket.send(frame);
}

/** Channel 3 is the Kubernetes exec status. Success closes the PTY. A missing shell is a 500. */
export function shellStreamFault(channel: number, text: string): 'exit' | 'missing' | null {
  if (channel !== 3 || !text) {
    return null;
  }
  try {
    const error = JSON.parse(text) as {
      status?: string;
      code?: number;
      reason?: string;
      metadata?: unknown;
    };
    const metadata = error.metadata;
    const emptyMeta =
      metadata === undefined ||
      (typeof metadata === 'object' &&
        metadata !== null &&
        !Array.isArray(metadata) &&
        Object.keys(metadata).length === 0);
    if (error.status === 'Success' && emptyMeta) {
      return 'exit';
    }
    if (error.code === 500 && error.status === 'Failure' && error.reason === 'InternalError') {
      return 'missing';
    }
  } catch {
    return null;
  }
  return null;
}
