import { describe, expect, it } from 'vitest';
import { tokenIdentity } from './kubeconfig';
import {
  clampShellFont,
  clampShellHeight,
  cycleShellTone,
  encodeExecFrame,
  identityFromIdToken,
  identityFromPayloadSegment,
  maxShellHeight,
  navHandleBox,
  readExecData,
  readShellTop,
  readStoredShellHeight,
  SHELL_DEFAULT_PX,
  SHELL_DOCK_BREAKPOINT,
  SHELL_MIN_PX,
  shellDockLeft,
  shellHeaderPx,
  shellHeightFromPointer,
  shellLink,
  shellPalette,
  shellStreamFault,
  shellTone,
  shellXtermOptions,
} from './shellDock';

function token(payload: Record<string, unknown>): string {
  const encode = (value: object) =>
    btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode(payload)}.sig`;
}

describe('shell dock layout', () => {
  it('keeps a resizable height inside the viewport', () => {
    expect(clampShellHeight(320, 900)).toBe(320);
    expect(clampShellHeight(20, 900)).toBe(SHELL_MIN_PX);
    expect(clampShellHeight(5000, 900)).toBe(maxShellHeight(900));
    expect(clampShellHeight(Number.NaN, 900)).toBe(SHELL_DEFAULT_PX);
    expect(readStoredShellHeight(null, 900)).toBe(SHELL_DEFAULT_PX);
    expect(readStoredShellHeight('400', 900)).toBe(400);
    expect(shellHeightFromPointer(900, 500)).toBe(400);
  });

  it('uses the content column on a desktop sidebar and the full width on a phone', () => {
    expect(shellDockLeft(1440, 320)).toBe(320);
    expect(shellDockLeft(1440, 72)).toBe(72);
    expect(shellDockLeft(SHELL_DOCK_BREAKPOINT - 1, 320)).toBe(0);
    expect(shellDockLeft(1440, null)).toBe(0);
    expect(shellHeaderPx(false)).toBe(40);
    expect(shellHeaderPx(true)).toBe(48);
  });

  it('stops the navigation line at the top of the shell', () => {
    expect(navHandleBox(48, 852, null)).toEqual({ top: 48, height: 852 });
    expect(navHandleBox(48, 852, 640)).toEqual({ top: 48, height: 592 });
    expect(navHandleBox(48, 852, 20)).toEqual({ top: 48, height: 0 });
    expect(navHandleBox(48, 852, 900)).toEqual({ top: 48, height: 852 });
    expect(readShellTop('640px')).toBe(640);
    expect(readShellTop('')).toBeNull();
  });

  it('follows the page theme until the toolbar cycle pins one', () => {
    expect(shellTone('auto', 'light')).toBe('light');
    expect(shellTone('dark', 'light')).toBe('dark');
    expect(cycleShellTone('dark')).toBe('light');
    expect(cycleShellTone('light')).toBe('auto');
    expect(cycleShellTone('auto')).toBe('dark');
    expect(clampShellFont(9)).toBe(12);
    expect(clampShellFont(30)).toBe(20);
    expect(shellPalette('light').background).toBe('#eff1f5');
    expect(shellPalette('dark').background).toBe('#1e1e2e');
  });

  it('reports connecting until the pod and the terminal are both up', () => {
    expect(shellLink({ podFailed: false, running: false, terminal: 'connected' })).toBe(
      'connecting'
    );
    expect(shellLink({ podFailed: true, running: false, terminal: 'connecting' })).toBe(
      'disconnected'
    );
    expect(shellLink({ podFailed: false, running: true, terminal: 'connected' })).toBe('connected');
  });
});

describe('shell terminal stream', () => {
  it('uses the colors of the active theme', () => {
    const options = shellXtermOptions({
      background: '#111',
      foreground: '#eee',
      cursor: '#0a0',
      fontFamily: 'ui-monospace, monospace',
    });
    expect(options.fontSize).toBe(14);
    expect(options.fontFamily).toBe('ui-monospace, monospace');
    expect(options.theme.background).toBe('#111');
    expect(options.theme.foreground).toBe('#eee');
    expect(options.theme.cursor).toBe('#0a0');
    expect(options.cursorStyle).toBe('bar');
    expect(options.theme.green).toBe('#a6e3a1');
    expect(options.fontSize).toBe(14);
  });

  it('reads stdout from a binary frame and a base64 frame', () => {
    const frame = encodeExecFrame(1, 'storefront\r\n');
    expect(readExecData(frame.buffer)?.text).toBe('storefront\r\n');
    let binary = '';
    for (const byte of frame) {
      binary += String.fromCharCode(byte);
    }
    expect(readExecData(btoa(binary))?.text).toBe('storefront\r\n');
    expect(readExecData('@@@')?.channel).toBeUndefined();
  });

  it('tells an exited shell from a missing shell', () => {
    expect(shellStreamFault(3, JSON.stringify({ status: 'Success', metadata: {} }))).toBe('exit');
    expect(
      shellStreamFault(3, JSON.stringify({ code: 500, status: 'Failure', reason: 'InternalError' }))
    ).toBe('missing');
    expect(shellStreamFault(1, 'ready')).toBeNull();
  });

  it('reads the user from an ID token and from the pod payload segment', () => {
    const idToken = token({
      email: 'alice@alpina.test',
      exp: 1_800_000_000,
    });
    expect(identityFromIdToken(idToken)).toBe('alice@alpina.test');
    expect(identityFromIdToken('')).toBe('');
    expect(tokenIdentity(idToken).userName).toBe('alice@alpina.test');
    expect(identityFromPayloadSegment(idToken.split('.')[1])).toBe('alice@alpina.test');
    expect(identityFromPayloadSegment('not a payload')).toBe('');
  });
});
