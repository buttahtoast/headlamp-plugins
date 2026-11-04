import '@xterm/xterm/css/xterm.css';
import { K8s } from '@kinvolk/headlamp-plugin/lib';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Terminal } from '@xterm/xterm';
import { useEffect, useRef, useState } from 'react';
import {
  readExecData,
  sendExecFrame,
  SHELL_FONT,
  type ShellCommandName,
  type ShellLink,
  shellPalette,
  shellStreamFault,
  type ShellTone,
  shellXtermOptions,
} from './shellDock';
import { SHELL_CONTAINER } from './shellPod';

type ExecHandle = {
  cancel: () => void;
  getSocket: () => WebSocket | null;
};

type Props = {
  cluster: string;
  namespace: string;
  name: string;
  active: boolean;
  generation: number;
  fontSize: number;
  tone: ShellTone;
  findText: string;
  command: { id: number; name: ShellCommandName } | null;
  onLink: (link: ShellLink) => void;
  onMetrics: (cols: number, rows: number) => void;
};

function shellPod(cluster: string, namespace: string, name: string) {
  return new K8s.ResourceClasses.Pod(
    {
      apiVersion: 'v1',
      kind: 'Pod',
      metadata: { name, namespace, uid: name, creationTimestamp: '' },
      spec: { containers: [], nodeName: '' },
      status: {
        conditions: [],
        containerStatuses: [],
        phase: 'Running',
        startTime: '',
      },
    },
    cluster
  );
}

export function focusShellTerminal(): void {
  const area = document.querySelector('.buttah-shell-dock .xterm-helper-textarea');
  if (area instanceof HTMLTextAreaElement) {
    area.focus();
  }
}

/**
 * Interactive exec into the shell pod.
 *
 * Headlamp's dialog terminal forces a 100vh xterm and only refits on window
 * resize, so a docked panel stays a small prompt in an empty box. This one
 * fills its container, refits when the dock is dragged, and paints with the
 * dock palette.
 */
export function ShellTerminal({
  cluster,
  namespace,
  name,
  active,
  generation,
  fontSize,
  tone,
  findText,
  command,
  onLink,
  onMetrics,
}: Props) {
  const screenRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const searchRef = useRef<SearchAddon | null>(null);
  const activeRef = useRef(active);
  const onLinkRef = useRef(onLink);
  const onMetricsRef = useRef(onMetrics);
  const fontSizeRef = useRef(fontSize);
  const toneRef = useRef(tone);
  const findTextRef = useRef(findText);
  const [fault, setFault] = useState<string | null>(null);
  const [linked, setLinked] = useState(false);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  activeRef.current = active;
  onLinkRef.current = onLink;
  onMetricsRef.current = onMetrics;
  fontSizeRef.current = fontSize;
  toneRef.current = tone;
  findTextRef.current = findText;

  useEffect(() => {
    const screen = screenRef.current;
    if (!screen) {
      return undefined;
    }
    let cancelled = false;
    let handle: ExecHandle | null = null;
    let connected = false;
    const palette = shellPalette(toneRef.current);
    const term = new Terminal(
      shellXtermOptions({
        background: palette.background,
        foreground: palette.foreground,
        cursor: palette.cursor,
        fontFamily: SHELL_FONT,
        fontSize: fontSizeRef.current,
        tone: toneRef.current,
      })
    );
    const fit = new FitAddon();
    const search = new SearchAddon();
    term.loadAddon(fit);
    term.loadAddon(search);
    term.loadAddon(new WebLinksAddon());
    term.open(screen);
    searchRef.current = search;
    term.onResize(size => {
      onMetricsRef.current(size.cols, size.rows);
    });
    termRef.current = term;
    fitRef.current = fit;
    setFault(null);
    setLinked(false);
    onLinkRef.current('connecting');

    const sendResize = () => {
      const socket = handle?.getSocket();
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        return;
      }
      sendExecFrame(socket, 4, JSON.stringify({ Width: term.cols, Height: term.rows }));
    };
    // fit() sends a resize while the prompt is already on screen. Keystrokes
    // that land in that window are eaten by the shell redraw, so they wait
    // until the first size has been sent.
    let acceptInput = false;
    const queued: string[] = [];
    const flushInput = () => {
      if (!acceptInput) {
        return;
      }
      const socket = handle?.getSocket();
      if (!socket || socket.readyState !== WebSocket.OPEN || queued.length === 0) {
        return;
      }
      sendExecFrame(socket, 0, queued.splice(0).join(''));
    };
    term.onData(data => {
      queued.push(data);
      flushInput();
    });
    let fitted = false;
    let arm = 0;
    const safeFit = () => {
      const box = screen.getBoundingClientRect();
      if (box.width < 8 || box.height < 8) {
        return;
      }
      const cols = term.cols;
      const rows = term.rows;
      try {
        fit.fit();
      } catch {
        // Minimized, or not open yet.
        return;
      }
      if (fitted && term.cols === cols && term.rows === rows) {
        return;
      }
      fitted = true;
      term.refresh(0, Math.max(0, term.rows - 1));
      sendResize();
      if (!acceptInput) {
        window.clearTimeout(arm);
        arm = window.setTimeout(() => {
          if (cancelled) {
            return;
          }
          acceptInput = true;
          flushInput();
        }, 80);
      }
    };

    const markConnected = () => {
      if (connected) {
        return;
      }
      connected = true;
      if (overlayRef.current) {
        overlayRef.current.hidden = true;
      }
      setLinked(true);
      onLinkRef.current('connected');
      safeFit();
      if (activeRef.current) {
        term.focus();
      }
    };
    const fail = (message: string) => {
      if (cancelled) {
        return;
      }
      onLinkRef.current('disconnected');
      setFault(message);
      if (!connected) {
        return;
      }
      term.writeln(`\r\n${message}`);
    };

    const onData = (data: unknown) => {
      if (cancelled) {
        return;
      }
      const frame = readExecData(data);
      if (!frame || frame.channel < 1 || frame.channel > 3) {
        return;
      }
      const problem = shellStreamFault(frame.channel, frame.text);
      if (problem === 'exit') {
        fail('The shell exited. Reconnect to open another.');
        handle?.cancel();
        return;
      }
      if (problem === 'missing') {
        fail('Could not connect to the shell.');
        handle?.cancel();
        return;
      }
      if (frame.channel === 3) {
        return;
      }
      if (frame.text) {
        markConnected();
        term.write(frame.text);
      }
    };

    handle = shellPod(cluster, namespace, name).exec(SHELL_CONTAINER, onData, {
      command: ['/bin/sh'],
      tty: true,
      stdin: true,
      stdout: true,
      stderr: true,
      reconnectOnFailure: false,
      failCb: () => {
        if (cancelled) {
          return;
        }
        fail(
          connected
            ? 'The session disconnected. Reconnect to continue.'
            : 'Could not connect to the shell.'
        );
      },
    }) as ExecHandle;

    const observer = new ResizeObserver(() => safeFit());
    observer.observe(screen);
    window.addEventListener('resize', safeFit);
    const kick = window.setInterval(() => {
      const socket = handle?.getSocket();
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        return;
      }
      window.clearInterval(kick);
      safeFit();
      flushInput();
    }, 50);
    let frames = 0;
    const pump = () => {
      if (cancelled || frames > 8) {
        return;
      }
      frames += 1;
      safeFit();
      window.requestAnimationFrame(pump);
    };
    window.requestAnimationFrame(pump);
    void document.fonts?.ready.then(() => {
      if (!cancelled) {
        safeFit();
      }
    });

    return () => {
      cancelled = true;
      window.clearTimeout(arm);
      window.clearInterval(kick);
      observer.disconnect();
      window.removeEventListener('resize', safeFit);
      handle?.cancel();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
      searchRef.current = null;
    };
    // generation remounts the PTY. onLink is read through a ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cluster, namespace, name, generation]);

  useEffect(() => {
    if (!active) {
      return;
    }
    const screen = screenRef.current;
    const box = screen?.getBoundingClientRect();
    if (box && box.width > 8 && box.height > 8) {
      try {
        fitRef.current?.fit();
      } catch {
        // The screen is between layouts.
      }
    }
    termRef.current?.focus();
    onLinkRef.current(linked ? 'connected' : fault ? 'disconnected' : 'connecting');
  }, [active, linked, fault]);

  useEffect(() => {
    const term = termRef.current;
    if (!term) {
      return;
    }
    const palette = shellPalette(tone);
    const options = shellXtermOptions({
      background: palette.background,
      foreground: palette.foreground,
      cursor: palette.cursor,
      fontFamily: SHELL_FONT,
      fontSize,
      tone,
    });
    term.options.fontSize = fontSize;
    term.options.fontFamily = SHELL_FONT;
    term.options.theme = options.theme;
    const box = screenRef.current?.getBoundingClientRect();
    if (box && box.width > 8 && box.height > 8) {
      try {
        fitRef.current?.fit();
      } catch {
        // The screen is between layouts.
      }
    }
  }, [fontSize, tone]);

  useEffect(() => {
    const search = searchRef.current;
    if (!search) {
      return;
    }
    if (!findText) {
      search.clearDecorations();
      return;
    }
    const palette = shellPalette(tone);
    search.findNext(findText, {
      incremental: true,
      decorations: {
        matchBackground: tone === 'light' ? '#acb0be' : '#45475a',
        activeMatchBackground: tone === 'light' ? '#1e66f5' : '#89b4fa',
        matchOverviewRuler: palette.cursor,
        activeMatchColorOverviewRuler: palette.cursor,
      },
    });
  }, [findText, tone]);

  useEffect(() => {
    if (!command || !activeRef.current) {
      return;
    }
    const term = termRef.current;
    if (!term) {
      return;
    }
    if (command.name === 'clear') {
      term.clear();
    } else if (command.name === 'copy') {
      const text = term.getSelection();
      if (text && navigator.clipboard?.writeText) {
        void navigator.clipboard.writeText(text);
      }
    } else if (command.name === 'paste') {
      if (!navigator.clipboard?.readText) {
        return;
      }
      void navigator.clipboard
        .readText()
        .then(text => {
          if (text) {
            term.paste(text);
          }
        })
        .catch(() => undefined);
    } else if (command.name === 'find-next') {
      searchRef.current?.findNext(findTextRef.current);
    } else if (command.name === 'find-prev') {
      searchRef.current?.findPrevious(findTextRef.current);
    }
  }, [command]);

  const showOverlay = !linked || Boolean(fault && !linked);
  return (
    <div
      className="buttah-shell-term"
      data-term={generation}
      data-active={active ? 'true' : 'false'}
      aria-hidden={active ? undefined : true}
    >
      <div className="buttah-shell-screen" ref={screenRef} />
      {showOverlay ? (
        <div
          className="buttah-shell-state"
          data-kind={fault ? 'error' : 'connecting'}
          role={fault ? 'alert' : 'status'}
          ref={overlayRef}
        >
          <span className="buttah-shell-dot" data-state={fault ? 'disconnected' : 'connecting'} />
          <strong>{fault ? 'Disconnected' : 'Connecting'}</strong>
          <p>{fault || `Opening a shell in ${namespace}`}</p>
          {fault ? null : (
            <div className="buttah-shell-skeleton" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
