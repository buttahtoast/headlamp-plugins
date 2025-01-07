import '@xterm/xterm/css/xterm.css';
import { StreamArgs, StreamResultsCb } from '@kinvolk/headlamp-plugin/lib/ApiProxy';
import { Dialog } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { KubeObject } from '@kinvolk/headlamp-plugin/lib/K8s/cluster';
import type { DialogProps } from '@mui/material';
import { Box } from '@mui/material';
import DialogContent from '@mui/material/DialogContent';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal as XTerminal } from '@xterm/xterm';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import VirtualMachineInstance from '../VirtualMachineInstance/VirtualMachineInstance';

enum Channel {
  StdIn = 0,
  StdOut,
  StdErr,
  ServerError,
  Resize,
}

interface TerminalProps extends DialogProps {
  item: VirtualMachineInstance;
  onClose?: () => void;
  open: boolean;
}

interface ConsoleObject extends KubeObject {
  exec(
      onExec: StreamResultsCb,
      options: StreamArgs
    ): { cancel: () => void; getSocket: () => WebSocket } 
}

interface XTerminalConnected {
  xterm: XTerminal;
  connected: boolean;
  reconnectOnEnter: boolean;
}
type execReturn = ReturnType<ConsoleObject['exec']>;

export default function Terminal(props: TerminalProps) {
  const { item, onClose, ...other } = props;
  const execRef = useRef<execReturn | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const xtermRef = useRef<XTerminalConnected | null>(null);
  const [terminalRef, setTerminalRef] = useState<HTMLElement | null>(null);

  const { t } = useTranslation(['translation', 'glossary']);
  const encoder = new TextEncoder();
  const decoder = new TextDecoder('utf-8');
  function setupTerminal(itemRef: HTMLElement, xterm: XTerminal, fitAddon: FitAddon) {
    if (!itemRef) {
      return;
    }

    xterm.open(itemRef);

    xterm.onData(data => {
      send(0, data);
    });

    xterm.onResize(size => {
      send(4, `{"Width":${size.cols},"Height":${size.rows}}`);
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
  }

  function send(channel: number, data: string) {
    console.debug('Sending data to exec:', data);
    const socket = execRef.current!.getSocket();

    if (!socket || socket.readyState !== 1) {
      console.debug('Could not send data to exec: Socket not ready...', socket);
      return;
    }
    const encoded = encoder.encode(data);
    //const buffer = new Uint8Array([encoded]);
    console.debug('Sending data to exec2:', data);

    socket.send(encoded);
  }
  function onData(xtermc: XTerminalConnected, bytes: ArrayBuffer) {
    console.debug('ondata', xtermc, bytes);
    const xterm = xtermc.xterm;
    // Only show data from stdout, stderr and server error channel.
    //const channel: Channel = new Int8Array(bytes.slice(0, 1))[0];
    const channel: Channel = Channel.StdOut;
    if (channel < Channel.StdOut || channel > Channel.ServerError) {
      console.warn('Ignoring channel:', channel);
      return;
    }

    // The first byte is discarded because it just identifies whether
    // this data is from stderr, stdout, or stdin.
    const text = decoder.decode(bytes);
    if (!xtermc.connected) {
      xtermc.connected = true;
      xterm.writeln(t('Connected to terminal…'));
    }
    //console.log('isSuccessfulExitError', isSuccessfulExitError(channel, text));
    console.log('isSuccessful');

    console.log('write');
    console.log(bytes);
    xterm.write(text);
  }
  useEffect(
    () => {
      console.log('useEffect');
      // Don't do anything if the dialog is not open.
      if (!props.open) {
        return;
      }

      if (xtermRef.current) {
        xtermRef.current.xterm.dispose();
        execRef.current?.cancel();
      }

      const isWindows = ['Windows', 'Win16', 'Win32', 'WinCE'].indexOf(navigator?.platform) >= 0;
      xtermRef.current = {
        xterm: new XTerminal({
          cursorBlink: true,
          cursorStyle: 'underline',
          scrollback: 10000,
          rows: 30, // initial rows before fit
          windowsMode: isWindows,
          allowProposedApi: true,
        }),
        connected: false,
        reconnectOnEnter: false,
      };

      fitAddonRef.current = new FitAddon();
      xtermRef.current.xterm.loadAddon(fitAddonRef.current);

      (async function () {
        //xtermRef?.current?.xterm.writeln(t('Trying to run "{{command}}"…', { command }) + '\n');
        xtermRef?.current?.xterm.writeln(t('⌛ Connecting to console…') + '\n');
        execRef.current = await item.exec(items => onData(xtermRef.current!, items), {
          reconnectOnFailure: false,
          failCb: () => {
            xtermRef.current!.xterm.write(encoder.encode(t('\r\n')));
          },
          connectCb: () => {
            xtermRef.current!.connected = true;
            xtermRef.current!.xterm.writeln(t('✅ Connected to console…'));
          },
          tty: false,
          stderr: false,
          stdin: false,
          stdout: false,
        });
        console.log(execRef.current);
        setupTerminal(terminalRef, xtermRef.current!.xterm, fitAddonRef.current!);
      })();

      const handler = () => {
        fitAddonRef.current!.fit();
      };

      window.addEventListener('resize', handler);

      return function cleanup() {
        xtermRef.current?.xterm.dispose();
        execRef.current?.cancel();
        window.removeEventListener('resize', handler);
      };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [terminalRef, props.open]
  );

  return (
    <Dialog
      onClose={onClose}
      onFullScreenToggled={() => {
        setTimeout(() => {
          fitAddonRef.current!.fit();
        }, 1);
      }}
      withFullScreen
      title={t('Terminal: {{ itemName }}', { itemName: item.getName() })}
      {...other}
    >
      <DialogContent
        sx={theme => ({
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          '& .xterm ': {
            height: '100vh', // So the terminal doesn't stay shrunk when shrinking vertically and maximizing again.
            '& .xterm-viewport': {
              width: 'initial !important', // BugFix: https://github.com/xtermjs/xterm.js/issues/3564#issuecomment-1004417440
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
