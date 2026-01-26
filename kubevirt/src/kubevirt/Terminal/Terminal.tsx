import '@xterm/xterm/css/xterm.css';
import { StreamArgs, StreamResultsCb } from '@kinvolk/headlamp-plugin/lib/ApiProxy';
import { Dialog } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { KubeObject } from '@kinvolk/headlamp-plugin/lib/K8s/cluster';
import type { DialogProps } from '@mui/material';
import { Box, Button } from '@mui/material';
import DialogContent from '@mui/material/DialogContent';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal as XTerminal } from '@xterm/xterm';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import VirtualMachineInstance from '../VirtualMachineInstance/VirtualMachineInstance';

interface TerminalProps extends DialogProps {
  item: VirtualMachineInstance;
  onClose?: () => void;
  open: boolean;
}

interface ConsoleObject extends KubeObject {
  exec(
    onExec: StreamResultsCb,
    options: StreamArgs
  ): { cancel: () => void; getSocket: () => WebSocket };
}

type execReturn = ReturnType<ConsoleObject['exec']>;

export default function Terminal(props: TerminalProps) {
  const { item, onClose, ...other } = props;
  const execRef = useRef<execReturn | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const xtermRef = useRef<XTerminal | null>(null);
  const [terminalRef, setTerminalRef] = useState<HTMLElement | null>(null);
  const [connected, setConnected] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const hasConnectedRef = useRef(false);
  const isConnectingRef = useRef(false);

  const { t } = useTranslation(['translation', 'glossary']);

  // Memoize encoder/decoder to prevent recreating on every render
  const encoder = useMemo(() => new TextEncoder(), []);
  const decoder = useMemo(() => new TextDecoder('utf-8'), []);

  const send = useCallback((data: string) => {
    if (!execRef.current) {
      return;
    }
    const socket = execRef.current.getSocket();

    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }

    // KubeVirt console expects raw data
    const encoded = encoder.encode(data);
    socket.send(encoded);
  }, [encoder]);

  const setupTerminal = useCallback((itemRef: HTMLElement, xterm: XTerminal, fitAddon: FitAddon) => {
    if (!itemRef || !xterm) {
      return;
    }

    xterm.open(itemRef);

    // Send input data to the console
    xterm.onData(data => {
      send(data);
    });

    // Allow copy/paste in terminal
    xterm.attachCustomKeyEventHandler(arg => {
      if (arg.ctrlKey && arg.type === 'keydown') {
        if (arg.code === 'KeyC') {
          const selection = xterm.getSelection();
          if (selection) {
            return false;
          }
        }
        if (arg.code === 'KeyV') {
          return false;
        }
      }
      return true;
    });

    fitAddon.fit();
  }, [send]);

  const connect = useCallback(() => {
    if (!item || !xtermRef.current) {
      return;
    }

    // Prevent duplicate connections
    if (isConnectingRef.current) {
      return;
    }

    const xterm = xtermRef.current;

    // Clean up any existing connection
    if (execRef.current) {
      execRef.current.cancel();
      execRef.current = null;
    }

    isConnectingRef.current = true;
    setConnected(false);
    setConnectionError(null);
    xterm.writeln(t('⌛ Connecting to console…'));

    execRef.current = item.exec(
      (data: ArrayBuffer) => {
        if (!mountedRef.current) return;

        // KubeVirt console returns raw bytes without channel prefix
        const text = decoder.decode(data);
        if (text) {
          xterm.write(text);
        }
      },
      {
        reconnectOnFailure: false, // Don't auto-reconnect to avoid loops
        failCb: () => {
          if (!mountedRef.current) return;
          isConnectingRef.current = false;
          hasConnectedRef.current = false;
          setConnected(false);
          setConnectionError('Connection closed');
          xterm.writeln(t('\r\n❌ Connection closed. Click "Reconnect" to try again.'));
        },
        connectCb: () => {
          if (!mountedRef.current) return;
          isConnectingRef.current = false;
          hasConnectedRef.current = true;
          setConnected(true);
          setConnectionError(null);
          xterm.writeln(t('✅ Connected. Press Enter to activate the console.\r\n'));
        },
      }
    );
  }, [item, t, decoder]);

  const handleReconnect = useCallback(() => {
    // Reset connection state for manual reconnect
    hasConnectedRef.current = false;
    isConnectingRef.current = false;
    if (xtermRef.current) {
      xtermRef.current.clear();
    }
    connect();
  }, [connect]);

  // Initialize terminal when dialog opens
  useEffect(() => {
    mountedRef.current = true;

    if (!props.open) {
      return;
    }

    // Reset connection tracking when dialog opens
    hasConnectedRef.current = false;
    isConnectingRef.current = false;

    // Create terminal instance
    const isWindows = ['Windows', 'Win16', 'Win32', 'WinCE'].indexOf(navigator?.platform) >= 0;
    const xterm = new XTerminal({
      cursorBlink: true,
      cursorStyle: 'underline',
      scrollback: 10000,
      rows: 30,
      windowsMode: isWindows,
      allowProposedApi: true,
    });
    xtermRef.current = xterm;

    const fitAddon = new FitAddon();
    fitAddonRef.current = fitAddon;
    xterm.loadAddon(fitAddon);

    return () => {
      mountedRef.current = false;
      hasConnectedRef.current = false;
      isConnectingRef.current = false;
      xterm.dispose();
      if (execRef.current) {
        execRef.current.cancel();
        execRef.current = null;
      }
    };
  }, [props.open]);

  // Setup terminal when DOM element is ready
  useEffect(() => {
    if (!props.open || !terminalRef || !xtermRef.current || !fitAddonRef.current) {
      return;
    }

    // Only setup and connect once per dialog open
    if (hasConnectedRef.current || isConnectingRef.current) {
      return;
    }

    setupTerminal(terminalRef, xtermRef.current, fitAddonRef.current);

    // Connect after terminal is set up
    connect();

    const handler = () => {
      fitAddonRef.current?.fit();
    };
    window.addEventListener('resize', handler);

    return () => {
      window.removeEventListener('resize', handler);
    };
  }, [props.open, terminalRef, setupTerminal, connect]);

  return (
    <Dialog
      onClose={onClose}
      onFullScreenToggled={() => {
        setTimeout(() => {
          fitAddonRef.current?.fit();
        }, 1);
      }}
      withFullScreen
      title={`Terminal: ${item.getName()}`}
      {...other}
    >
      <DialogContent
        sx={theme => ({
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          '& .xterm ': {
            height: '100vh',
            '& .xterm-viewport': {
              width: 'initial !important',
            },
          },
          '& #xterm-container': {
            overflow: 'hidden',
            width: '100%',
            '& .terminal.xterm': {
              padding: theme.spacing(1),
            },
          },
        })}
      >
        {connectionError && (
          <Box sx={{ mb: 1, display: 'flex', justifyContent: 'flex-end' }}>
            <Button
              variant="outlined"
              size="small"
              onClick={handleReconnect}
            >
              Reconnect
            </Button>
          </Box>
        )}
        <Box
          sx={theme => ({
            paddingTop: theme.spacing(1),
            flex: 1,
            width: '100%',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column-reverse',
          })}
        >
          <div
            id="xterm-container"
            ref={x => setTerminalRef(x)}
            style={{ flex: 1, display: 'flex', flexDirection: 'column-reverse' }}
          />
        </Box>
      </DialogContent>
    </Dialog>
  );
}
