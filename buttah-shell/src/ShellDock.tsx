import { K8s } from '@kinvolk/headlamp-plugin/lib';
import { useTheme } from '@mui/material/styles';
import Tooltip from '@mui/material/Tooltip';
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { publishShellLayout } from './layout';
import {
  clampShellFont,
  clampShellHeight,
  cycleShellTone,
  identityFromPayloadSegment,
  readExecData,
  readStoredShellHeight,
  SHELL_FONT_DEFAULT,
  SHELL_HEIGHT_KEY,
  SHELL_HEIGHT_STEP,
  SHELL_IDENTITY_SCRIPT,
  SHELL_MIN_PX,
  SHELL_TAB_PX,
  SHELL_TOP_VAR,
  type ShellChrome,
  type ShellCommandName,
  shellDockLeft,
  shellHeaderPx,
  shellHeightFromPointer,
  type ShellLink,
  shellLink,
  shellPalette,
  type ShellTone,
  shellTone,
  type ShellTonePref,
} from './shellDock';
import { SHELL_CONTAINER, shellRunning, type ShellStatus, shellWait } from './shellPod';
import { focusShellTerminal, ShellTerminal } from './ShellTerminal';

const TONE_KEY = 'buttah-shell.tone';
const FONT_KEY = 'buttah-shell.fontSize';

function readTonePref(): ShellTonePref {
  try {
    const stored = localStorage.getItem(TONE_KEY);
    if (stored === 'dark' || stored === 'light' || stored === 'auto') {
      return stored;
    }
  } catch {
    // Private mode keeps the page theme for this visit.
  }
  return 'dark';
}

function readFontSize(): number {
  try {
    const stored = localStorage.getItem(FONT_KEY);
    if (!stored) {
      return SHELL_FONT_DEFAULT;
    }
    return clampShellFont(Number(stored));
  } catch {
    return SHELL_FONT_DEFAULT;
  }
}

export type ShellSession = {
  namespace: string;
  name: string;
  identity: 'oidc' | 'service-account';
  user: string;
};

type ExecHandle = {
  cancel: () => void;
  getSocket: () => WebSocket | null;
};

function errorText(error: unknown): string {
  if (typeof error === 'string' && error) {
    return error;
  }
  if (
    error &&
    typeof error === 'object' &&
    'message' in error &&
    typeof error.message === 'string'
  ) {
    return error.message || 'Could not open the shell.';
  }
  return 'Could not open the shell.';
}

function isGone(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'status' in error && error.status === 404);
}

function podApi(): {
  delete: (
    namespace: string,
    name: string,
    params: { gracePeriodSeconds: number },
    cluster: string
  ) => Promise<unknown>;
} {
  return K8s.ResourceClasses.Pod.apiEndpoint as unknown as {
    delete: (
      namespace: string,
      name: string,
      params: { gracePeriodSeconds: number },
      cluster: string
    ) => Promise<unknown>;
  };
}

function rememberShellHeight(height: number): void {
  try {
    localStorage.setItem(SHELL_HEIGHT_KEY, String(height));
  } catch {
    // Private mode can reject the write. The height still applies for this visit.
  }
}

function storedShellHeight(): number {
  try {
    return readStoredShellHeight(localStorage.getItem(SHELL_HEIGHT_KEY), window.innerHeight);
  } catch {
    return readStoredShellHeight(null, window.innerHeight);
  }
}

function Icon({
  name,
}: {
  name:
    | 'refresh'
    | 'min'
    | 'max'
    | 'restore'
    | 'close'
    | 'search'
    | 'copy'
    | 'paste'
    | 'clear'
    | 'minus'
    | 'plus'
    | 'theme'
    | 'add';
}) {
  const common = {
    width: 16,
    height: 16,
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true as const,
  };
  if (name === 'min') {
    return (
      <svg {...common}>
        <path d="M3 11.5h10" />
      </svg>
    );
  }
  if (name === 'max') {
    return (
      <svg {...common}>
        <rect x="3" y="3" width="10" height="10" rx="1" />
      </svg>
    );
  }
  if (name === 'restore') {
    return (
      <svg {...common}>
        <path d="M6.5 4.5H13V10" />
        <rect x="3" y="6.5" width="7" height="6.5" rx="1" />
      </svg>
    );
  }
  if (name === 'close') {
    return (
      <svg {...common}>
        <path d="M4 4l8 8M12 4L4 12" />
      </svg>
    );
  }
  if (name === 'search') {
    return (
      <svg {...common}>
        <circle cx="7" cy="7" r="3.2" />
        <path d="M9.5 9.5 13 13" />
      </svg>
    );
  }
  if (name === 'copy') {
    return (
      <svg {...common}>
        <rect x="5.5" y="5.5" width="7" height="7" rx="1" />
        <path d="M10.5 5.5V4.2A1.2 1.2 0 0 0 9.3 3H4.2A1.2 1.2 0 0 0 3 4.2v5.1a1.2 1.2 0 0 0 1.2 1.2h1.3" />
      </svg>
    );
  }
  if (name === 'paste') {
    return (
      <svg {...common}>
        <path d="M6 3.5h4" />
        <rect x="4" y="4.5" width="8" height="8.5" rx="1.2" />
      </svg>
    );
  }
  if (name === 'clear') {
    return (
      <svg {...common}>
        <path d="M3 8h10M5 8l1.5 5h3L11 8" />
      </svg>
    );
  }
  if (name === 'minus') {
    return (
      <svg {...common}>
        <path d="M4 8h8" />
      </svg>
    );
  }
  if (name === 'plus' || name === 'add') {
    return (
      <svg {...common}>
        <path d="M8 3.5v9M3.5 8h9" />
      </svg>
    );
  }
  if (name === 'theme') {
    return (
      <svg {...common}>
        <path d="M8 2.2v1.3M8 12.5v1.3M2.2 8h1.3M12.5 8h1.3" />
        <circle cx="8" cy="8" r="2.4" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M13 8a5 5 0 1 1-1.1-3.1" />
      <path d="M13 2.8V5.4H10.4" />
    </svg>
  );
}

function DockButton({
  label,
  kind,
  onClick,
  children,
}: {
  label: string;
  kind?: 'close';
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip title={label} placement="top" enterDelay={400}>
      <button type="button" aria-label={label} data-kind={kind} onClick={onClick}>
        {children}
      </button>
    </Tooltip>
  );
}

function ShellMark() {
  return (
    <svg
      className="buttah-shell-mark"
      width="16"
      height="16"
      viewBox="0 0 16 16"
      aria-hidden="true"
    >
      <path
        fill="currentColor"
        d="M2 3.2h12v9.6H2V3.2Zm1.15 1.15v7.3h9.7v-7.3h-9.7ZM4.2 6.05l1.55 1.2L4.2 8.45l.72.9 2.45-1.95L4.92 5.2l-.72.85Zm3.55 3.35h3.15v1.05H7.75V9.4Z"
      />
    </svg>
  );
}

export function ShellDock({
  cluster,
  sessions,
  active,
  chrome,
  onChrome,
  onActive,
  onAdd,
  onClose,
}: {
  cluster: string;
  sessions: ShellSession[];
  active: number;
  chrome: ShellChrome;
  onChrome: (next: ShellChrome) => void;
  onActive: (index: number) => void;
  onAdd: () => void;
  onClose: (session: ShellSession) => void;
}) {
  const dockRef = useRef<HTMLElement | null>(null);
  const [height, setHeight] = useState(storedShellHeight);
  const [dragging, setDragging] = useState(false);
  const [terminalLink, setTerminalLink] = useState<ShellLink>('connecting');
  const [generation, setGeneration] = useState<Record<string, number>>({});
  const [user, setUser] = useState('');
  const [closeError, setCloseError] = useState<string | null>(null);
  const [layout, setLayout] = useState({ left: 0, appBarBottom: 0, coarse: false });
  const [tonePref, setTonePref] = useState<ShellTonePref>(readTonePref);
  const [fontSize, setFontSize] = useState(readFontSize);
  const [findOpen, setFindOpen] = useState(false);
  const [findText, setFindText] = useState('');
  const [command, setCommand] = useState<{ id: number; name: ShellCommandName } | null>(null);
  const [metrics, setMetrics] = useState({ cols: 0, rows: 0 });
  const pageTone: ShellTone = useTheme().palette.mode === 'light' ? 'light' : 'dark';
  const tone = shellTone(tonePref, pageTone);
  const palette = shellPalette(tone);
  const picked = sessions[Math.min(active, Math.max(0, sessions.length - 1))];
  const session: ShellSession = picked ?? {
    namespace: 'default',
    name: 'buttah-shell-pending',
    identity: 'oidc',
    user: '',
  };
  const closing = useRef(false);
  const heightRef = useRef(height);
  heightRef.current = height;
  const [pod, podError] = K8s.ResourceClasses.Pod.useGet(session.name, session.namespace, {
    cluster,
  });
  const status = pod?.status as ShellStatus | undefined;
  const running = shellRunning(status);
  const podFailed =
    Boolean(podError) || status?.phase === 'Failed' || status?.phase === 'Succeeded';
  const link = shellLink({ podFailed, running, terminal: terminalLink });
  const onLink = useCallback((next: ShellLink) => {
    setTerminalLink(next);
  }, []);
  const identity =
    session.identity === 'service-account'
      ? 'Service account'
      : user || session.user || 'Your identity';
  const context = session.namespace + (cluster ? ` / ${cluster}` : '');
  const header = shellHeaderPx(layout.coarse) + (sessions.length > 1 ? SHELL_TAB_PX : 0);
  const openHeight = clampShellHeight(height, window.innerHeight);
  const mainStyles =
    typeof document !== 'undefined' && document.getElementById('buttah-shell-styles');
  const themeChrome = mainStyles
    ? {}
    : {
        background: palette.background,
        color: palette.foreground,
        borderRadius: 0,
        fontFamily: 'inherit',
        boxShadow: 'none',
      };
  const style =
    chrome === 'maximized'
      ? { left: 0, top: layout.appBarBottom, ...themeChrome }
      : {
          left: layout.left,
          top: 'auto' as const,
          height: chrome === 'minimized' ? header : openHeight,
          ...themeChrome,
        };
  const statusLabel =
    link === 'connected' ? 'Connected' : link === 'disconnected' ? 'Disconnected' : 'Connecting';

  useEffect(() => {
    setUser(session.user);
    setMetrics({ cols: 0, rows: 0 });
  }, [session.name, session.user]);

  useEffect(() => {
    if (chrome === 'minimized') {
      return undefined;
    }
    const frame = window.requestAnimationFrame(() => focusShellTerminal());
    return () => window.cancelAnimationFrame(frame);
  }, [chrome, generation]);

  useLayoutEffect(() => {
    const root = document.documentElement;
    const measure = () => {
      const nav = document.querySelector("nav[aria-label='Navigation']");
      const docked = nav?.querySelector('.MuiDrawer-docked');
      const paper = nav?.querySelector('.MuiDrawer-docked .MuiDrawer-paper');
      const edge =
        paper instanceof HTMLElement ? paper : docked instanceof HTMLElement ? docked : null;
      const navRight = edge ? edge.getBoundingClientRect().right : null;
      const left = shellDockLeft(window.innerWidth, navRight);
      const appBar = document.querySelector('.MuiAppBar-root');
      const appBarBottom =
        appBar instanceof HTMLElement ? Math.round(appBar.getBoundingClientRect().bottom) : 0;
      const coarse = root.hasAttribute('data-buttah-coarse');
      setLayout(current =>
        current.left === left && current.appBarBottom === appBarBottom && current.coarse === coarse
          ? current
          : { left, appBarBottom, coarse }
      );
      const dock = dockRef.current;
      if (dock) {
        root.style.setProperty(SHELL_TOP_VAR, `${Math.round(dock.getBoundingClientRect().top)}px`);
      }
      publishShellLayout();
    };
    measure();
    const observer = new ResizeObserver(measure);
    const nav = document.querySelector("nav[aria-label='Navigation']");
    if (nav) {
      observer.observe(nav);
    }
    const appBar = document.querySelector('.MuiAppBar-root');
    if (appBar) {
      observer.observe(appBar);
    }
    if (dockRef.current) {
      observer.observe(dockRef.current);
    }
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
      root.style.removeProperty(SHELL_TOP_VAR);
      publishShellLayout();
    };
  }, [chrome, height, layout.left]);

  useEffect(() => {
    if (!running || user || session.identity !== 'oidc') {
      return undefined;
    }
    let cancelled = false;
    let text = '';
    const podExec = new K8s.ResourceClasses.Pod(
      {
        apiVersion: 'v1',
        kind: 'Pod',
        metadata: {
          name: session.name,
          namespace: session.namespace,
          uid: session.name,
          creationTimestamp: '',
        },
        spec: { containers: [], nodeName: '' },
        status: { conditions: [], containerStatuses: [], phase: 'Running', startTime: '' },
      },
      cluster
    );
    const finish = () => {
      const next = identityFromPayloadSegment(text);
      if (!cancelled && next) {
        setUser(next);
      }
    };
    const handle = podExec.exec(
      SHELL_CONTAINER,
      data => {
        const frame = readExecData(data);
        if (frame && (frame.channel === 1 || frame.channel === 2)) {
          text += frame.text;
        }
      },
      {
        command: ['/bin/sh', '-c', SHELL_IDENTITY_SCRIPT],
        tty: false,
        stdin: false,
        stdout: true,
        stderr: true,
        reconnectOnFailure: false,
        failCb: finish,
      }
    ) as ExecHandle;
    return () => {
      cancelled = true;
      handle.cancel();
    };
  }, [running, user, session.identity, session.name, session.namespace, cluster]);

  useEffect(() => {
    rootDragging(dragging);
    return () => rootDragging(false);
  }, [dragging]);

  function applyHeight(next: number, persist: boolean) {
    const clamped = clampShellHeight(next, window.innerHeight);
    heightRef.current = clamped;
    setHeight(clamped);
    if (chrome !== 'open') {
      onChrome('open');
    }
    if (persist) {
      rememberShellHeight(clamped);
    }
  }

  function onResizeKey(event: React.KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? SHELL_HEIGHT_STEP * 3 : SHELL_HEIGHT_STEP;
    const viewport = window.innerHeight;
    let next: number | null = null;
    if (event.key === 'ArrowUp') {
      next = heightRef.current + step;
    } else if (event.key === 'ArrowDown') {
      next = heightRef.current - step;
    } else if (event.key === 'Home') {
      next = SHELL_MIN_PX;
    } else if (event.key === 'End') {
      next = viewport;
    }
    if (next === null) {
      return;
    }
    event.preventDefault();
    applyHeight(next, true);
  }

  function onResizePointer(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    const pointerId = event.pointerId;
    event.currentTarget.setPointerCapture(pointerId);
    setDragging(true);
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) {
        return;
      }
      applyHeight(shellHeightFromPointer(window.innerHeight, ev.clientY), false);
    };
    const finish = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) {
        return;
      }
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      setDragging(false);
      applyHeight(shellHeightFromPointer(window.innerHeight, ev.clientY), true);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish);
  }

  async function closeSession(target: ShellSession) {
    if (closing.current) {
      return;
    }
    closing.current = true;
    setCloseError(null);
    try {
      await podApi().delete(target.namespace, target.name, { gracePeriodSeconds: 1 }, cluster);
      onClose(target);
    } catch (error) {
      if (!isGone(error)) {
        setCloseError(errorText(error));
        return;
      }
      onClose(target);
    } finally {
      closing.current = false;
    }
  }

  function runCommand(name: ShellCommandName) {
    setCommand({ id: Date.now(), name });
  }

  function changeFont(next: number) {
    const size = clampShellFont(next);
    setFontSize(size);
    try {
      localStorage.setItem(FONT_KEY, String(size));
    } catch {
      // The size still applies for this visit.
    }
  }

  function changeTone() {
    const next = cycleShellTone(tonePref);
    setTonePref(next);
    try {
      localStorage.setItem(TONE_KEY, next);
    } catch {
      // The tone still applies for this visit.
    }
  }

  const themeLabel =
    tonePref === 'auto'
      ? 'Theme follows Headlamp'
      : tonePref === 'dark'
      ? 'Dark terminal'
      : 'Light terminal';
  const maximized = chrome === 'maximized';
  if (!picked) {
    return null;
  }
  return (
    <section
      ref={dockRef}
      className="buttah-shell-dock"
      data-chrome={chrome}
      data-tone={tone}
      data-dragging={dragging ? 'true' : 'false'}
      data-shell-pod={session.name}
      data-shell-link={link}
      style={style}
      aria-label={`Shell in ${session.namespace}`}
    >
      <div
        className="buttah-shell-resize"
        role="slider"
        aria-orientation="horizontal"
        aria-label="Shell height"
        aria-valuemin={SHELL_MIN_PX}
        aria-valuemax={clampShellHeight(window.innerHeight, window.innerHeight)}
        aria-valuenow={openHeight}
        aria-valuetext={`${openHeight} pixels`}
        tabIndex={0}
        onPointerDown={onResizePointer}
        onKeyDown={onResizeKey}
      />
      {sessions.length > 1 ? (
        <div className="buttah-shell-tabs" role="tablist" aria-label="Shell sessions">
          {sessions.map((item, index) => (
            <div
              key={item.name}
              className="buttah-shell-tab-item"
              data-active={index === active ? 'true' : 'false'}
            >
              <button
                type="button"
                role="tab"
                aria-selected={index === active}
                onClick={() => onActive(index)}
              >
                {item.namespace}
              </button>
              <button
                type="button"
                className="buttah-shell-tab-close"
                aria-label={`Close ${item.namespace}`}
                onClick={() => void closeSession(item)}
              >
                <Icon name="close" />
              </button>
            </div>
          ))}
        </div>
      ) : null}
      <div className="buttah-shell-bar">
        <div className="buttah-shell-tab">
          <ShellMark />
          <span className="buttah-shell-context">{context}</span>
          <span className="buttah-shell-status">
            <span className="buttah-shell-dot" data-state={link} aria-hidden="true" />
            <span>{statusLabel}</span>
          </span>
          <span className="buttah-shell-identity">{identity}</span>
        </div>
        <div className="buttah-shell-actions">
          <DockButton label="Find" onClick={() => setFindOpen(open => !open)}>
            <Icon name="search" />
          </DockButton>
          <DockButton label="Copy" onClick={() => runCommand('copy')}>
            <Icon name="copy" />
          </DockButton>
          <DockButton label="Paste" onClick={() => runCommand('paste')}>
            <Icon name="paste" />
          </DockButton>
          <DockButton label="Clear" onClick={() => runCommand('clear')}>
            <Icon name="clear" />
          </DockButton>
          <DockButton label="Smaller text" onClick={() => changeFont(fontSize - 1)}>
            <Icon name="minus" />
          </DockButton>
          <DockButton label="Larger text" onClick={() => changeFont(fontSize + 1)}>
            <Icon name="plus" />
          </DockButton>
          <DockButton label={themeLabel} onClick={changeTone}>
            <Icon name="theme" />
          </DockButton>
          <DockButton label="New shell" onClick={onAdd}>
            <Icon name="add" />
          </DockButton>
          <DockButton
            label="Reconnect"
            onClick={() =>
              setGeneration(current => ({
                ...current,
                [session.name]: (current[session.name] ?? 0) + 1,
              }))
            }
          >
            <Icon name="refresh" />
          </DockButton>
          <DockButton
            label={chrome === 'minimized' ? 'Restore' : 'Minimize'}
            onClick={() => onChrome(chrome === 'minimized' ? 'open' : 'minimized')}
          >
            <Icon name="min" />
          </DockButton>
          <DockButton
            label={maximized ? 'Restore' : 'Maximize'}
            onClick={() => onChrome(maximized ? 'open' : 'maximized')}
          >
            <Icon name={maximized ? 'restore' : 'max'} />
          </DockButton>
          <DockButton label="Close" kind="close" onClick={() => void closeSession(session)}>
            <Icon name="close" />
          </DockButton>
        </div>
      </div>
      <div className="buttah-shell-body">
        {closeError ? (
          <p className="buttah-shell-inline-error" role="alert">
            {closeError}
          </p>
        ) : null}
        {findOpen ? (
          <form
            className="buttah-shell-find"
            onSubmit={event => {
              event.preventDefault();
              runCommand('find-next');
            }}
          >
            <input
              aria-label="Find in terminal"
              value={findText}
              onChange={event => setFindText(event.target.value)}
              placeholder="Find"
            />
            <button type="button" onClick={() => runCommand('find-prev')}>
              Previous
            </button>
            <button type="submit">Next</button>
            <button
              type="button"
              onClick={() => {
                setFindOpen(false);
                setFindText('');
              }}
            >
              Close
            </button>
          </form>
        ) : null}
        <div className="buttah-shell-panes">
          {sessions.map((item, index) => (
            <ShellSessionPane
              key={item.name}
              cluster={cluster}
              session={item}
              active={index === active && chrome !== 'minimized'}
              generation={generation[item.name] ?? 0}
              fontSize={fontSize}
              tone={tone}
              findText={index === active && findOpen ? findText : ''}
              command={index === active ? command : null}
              onLink={onLink}
              onMetrics={(cols, rows) => setMetrics({ cols, rows })}
            />
          ))}
        </div>
        <footer className="buttah-shell-statusline">
          <span>{metrics.cols > 0 ? `${metrics.cols}×${metrics.rows}` : '—'}</span>
          <span>{fontSize}px</span>
          <span>{tone === 'dark' ? 'Dark' : 'Light'}</span>
          <span>{statusLabel}</span>
        </footer>
      </div>
    </section>
  );
}

function ShellSessionPane({
  cluster,
  session,
  active,
  generation,
  fontSize,
  tone,
  findText,
  command,
  onLink,
  onMetrics,
}: {
  cluster: string;
  session: ShellSession;
  active: boolean;
  generation: number;
  fontSize: number;
  tone: ShellTone;
  findText: string;
  command: { id: number; name: ShellCommandName } | null;
  onLink: (link: ShellLink) => void;
  onMetrics: (cols: number, rows: number) => void;
}) {
  const [pod, podError] = K8s.ResourceClasses.Pod.useGet(session.name, session.namespace, {
    cluster,
  });
  const status = pod?.status as ShellStatus | undefined;
  const running = shellRunning(status);
  const podFailed =
    Boolean(podError) || status?.phase === 'Failed' || status?.phase === 'Succeeded';
  if (!running || !pod) {
    if (!active) {
      return null;
    }
    return (
      <div
        className="buttah-shell-state"
        data-kind={podFailed ? 'error' : 'connecting'}
        role={podFailed ? 'alert' : 'status'}
      >
        <span
          className="buttah-shell-dot"
          data-state={podFailed ? 'disconnected' : 'connecting'}
          aria-hidden="true"
        />
        <strong>{podFailed ? 'Could not start the shell' : 'Connecting'}</strong>
        <p>{podError ? errorText(podError) : shellWait(status)}</p>
        {podFailed ? null : (
          <div className="buttah-shell-skeleton" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
        )}
      </div>
    );
  }
  return (
    <ShellTerminal
      cluster={cluster}
      namespace={session.namespace}
      name={session.name}
      active={active}
      generation={generation}
      fontSize={fontSize}
      tone={tone}
      findText={findText}
      command={command}
      onLink={active ? onLink : () => undefined}
      onMetrics={active ? onMetrics : () => undefined}
    />
  );
}

function rootDragging(active: boolean): void {
  document.documentElement.classList.toggle('buttah-shell-dragging', active);
}
