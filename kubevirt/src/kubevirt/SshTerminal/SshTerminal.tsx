import '@xterm/xterm/css/xterm.css';
import ApiProxy, { StreamArgs, StreamResultsCb } from '@kinvolk/headlamp-plugin/lib/ApiProxy';
import { Dialog, Link } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { KubeObject } from '@kinvolk/headlamp-plugin/lib/K8s/cluster';
import type { DialogProps } from '@mui/material';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  FormControl,
  IconButton,
  InputAdornment,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Tab,
  Tabs,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import DialogContent from '@mui/material/DialogContent';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal as XTerminal } from '@xterm/xterm';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import VirtualMachine from '../VirtualMachines/VirtualMachine';
import VirtualMachineInstance from '../VirtualMachineInstance/VirtualMachineInstance';

interface ConsoleObject extends KubeObject {
  exec(
    onExec: StreamResultsCb,
    options: StreamArgs
  ): { cancel: () => void; getSocket: () => WebSocket };
}

type execReturn = ReturnType<ConsoleObject['exec']>;

interface SshTerminalProps extends DialogProps {
  item: VirtualMachineInstance | VirtualMachine;
  vmSpec?: any;
  targetIp?: string;
  isPodNetwork?: boolean;
  onClose?: () => void;
  open: boolean;
  /** Default tab: 'console' (0) or 'ssh' (1). Defaults to 'console' */
  defaultTab?: 'console' | 'ssh';
}

interface NetworkInterface {
  name: string;
  ipAddresses: string[];
  isPodNetwork: boolean;
}

interface SshConnectionInfo {
  interfaces: NetworkInterface[];
  sshCredentials: {
    type: 'userPassword' | 'sshPublicKey';
    secretName: string;
    users?: string[];
  }[];
  ready: boolean;
}

/**
 * SSH & Console Access Dialog
 *
 * Provides access to VMs via:
 * 1. SSH Commands tab: Copy-paste virtctl/direct SSH commands for CLI use
 * 2. Serial Console tab: Direct serial console access in the browser (no SSH needed)
 */
export default function SshTerminal(props: SshTerminalProps) {
  const { item, vmSpec, targetIp, isPodNetwork: propIsPodNetwork, onClose, defaultTab, ...other } = props;
  const { t } = useTranslation(['translation', 'glossary']);
  const [connectionInfo, setConnectionInfo] = useState<SshConnectionInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [secretData, setSecretData] = useState<Record<string, any>>({});
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [showPasswords, setShowPasswords] = useState<Record<string, boolean>>({});
  const [sshPort, setSshPort] = useState(22);
  // Tab 0 = Serial Console, Tab 1 = SSH Commands
  const [activeTab, setActiveTab] = useState(defaultTab === 'ssh' ? 1 : 0);

  // Serial console state (uses KubeVirt /console endpoint which Headlamp proxies)
  const execRef = useRef<execReturn | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const xtermRef = useRef<XTerminal | null>(null);
  const [terminalRef, setTerminalRef] = useState<HTMLElement | null>(null);
  const [connected, setConnected] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const hasConnectedRef = useRef(false);
  const isConnectingRef = useRef(false);

  // Memoize encoder/decoder for serial console
  const encoder = useMemo(() => new TextEncoder(), []);
  const decoder = useMemo(() => new TextDecoder('utf-8'), []);

  // Fetch connection info
  useEffect(() => {
    if (!props.open || !item) return;

    const fetchConnectionInfo = async () => {
      setLoading(true);
      try {
        const vmiResponse = await ApiProxy.request(
          `/apis/kubevirt.io/v1/namespaces/${item.getNamespace()}/virtualmachineinstances/${item.getName()}`,
          { method: 'GET' }
        );

        const vmiStatus = (vmiResponse as any)?.status;
        const vmiSpec = (vmiResponse as any)?.spec;

        const networks = vmiSpec?.networks || [];
        const podNetworkNames = new Set<string>();
        for (const network of networks) {
          if (network.pod) {
            podNetworkNames.add(network.name);
          }
        }

        const isLoopbackIP = (ip: string): boolean => {
          if (!ip) return true;
          const trimmed = ip.trim();
          if (trimmed.startsWith('127.')) return true;
          if (trimmed === '::1') return true;
          return trimmed.toLowerCase().startsWith('fe80:');
        };

        const interfaces: NetworkInterface[] = [];
        if (vmiStatus?.interfaces) {
          for (const iface of vmiStatus.interfaces) {
            if (!iface.name || iface.name === 'unknown' || iface.name === '') {
              continue;
            }

            const ipAddresses: string[] = [];
            if (iface.ipAddresses && Array.isArray(iface.ipAddresses)) {
              const validIPs = iface.ipAddresses.filter((ip: any) =>
                ip && typeof ip === 'string' && ip.trim() !== '' && !isLoopbackIP(ip)
              );
              const ipv4 = validIPs.filter((ip: string) => !ip.includes(':'));
              const ipv6 = validIPs.filter((ip: string) => ip.includes(':'));
              ipAddresses.push(...ipv4, ...ipv6);
            } else if (iface.ipAddress && typeof iface.ipAddress === 'string' && iface.ipAddress.trim() !== '') {
              if (!isLoopbackIP(iface.ipAddress)) {
                ipAddresses.push(iface.ipAddress);
              }
            }

            if (ipAddresses.length > 0) {
              interfaces.push({
                name: iface.name,
                ipAddresses,
                isPodNetwork: podNetworkNames.has(iface.name),
              });
            }
          }
        }

        const accessCredentials = vmSpec?.spec?.template?.spec?.accessCredentials ||
                                  vmiSpec?.accessCredentials || [];

        const sshCredentials: SshConnectionInfo['sshCredentials'] = [];
        for (const cred of accessCredentials) {
          if (cred.sshPublicKey) {
            sshCredentials.push({
              type: 'sshPublicKey',
              secretName: cred.sshPublicKey.source?.secret?.secretName || '',
              users: cred.sshPublicKey.propagationMethod?.qemuGuestAgent?.users || [],
            });
          }
          if (cred.userPassword) {
            sshCredentials.push({
              type: 'userPassword',
              secretName: cred.userPassword.source?.secret?.secretName || '',
            });
          }
        }

        setConnectionInfo({
          interfaces,
          sshCredentials,
          ready: vmiStatus?.phase === 'Running',
        });

        for (const cred of sshCredentials) {
          if (cred.secretName) {
            try {
              const secretResponse = await ApiProxy.request(
                `/api/v1/namespaces/${item.getNamespace()}/secrets/${cred.secretName}`,
                { method: 'GET' }
              );
              setSecretData(prev => ({
                ...prev,
                [cred.secretName]: secretResponse,
              }));
            } catch (err) {
              console.log(`Failed to fetch secret ${cred.secretName}:`, err);
            }
          }
        }
      } catch (err) {
        console.error('Failed to fetch connection info:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchConnectionInfo();
  }, [props.open, item, vmSpec]);

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const decodeBase64 = (data: string): string => {
    try {
      return atob(data);
    } catch {
      return data;
    }
  };

  const togglePasswordVisibility = (key: string) => {
    setShowPasswords(prev => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const isUsernameField = (key: string): boolean => {
    const lowerKey = key.toLowerCase();
    return lowerKey === 'user' || lowerKey === 'username' || lowerKey === 'name' ||
           lowerKey === 'login' || lowerKey === 'account' ||
           lowerKey.startsWith('user') || lowerKey.endsWith('user') ||
           lowerKey.endsWith('name') || lowerKey.endsWith('login');
  };

  const isPasswordField = (key: string): boolean => {
    return !isUsernameField(key);
  };

  const getUsernameFromCredentials = (): string | undefined => {
    const sshKeyCred = connectionInfo?.sshCredentials?.find(c => c.type === 'sshPublicKey');
    if (sshKeyCred?.users?.[0]) {
      return sshKeyCred.users[0];
    }

    const userPasswordCred = connectionInfo?.sshCredentials?.find(c => c.type === 'userPassword');
    if (userPasswordCred && secretData[userPasswordCred.secretName]) {
      const data = secretData[userPasswordCred.secretName].data || {};
      for (const [key, value] of Object.entries(data)) {
        if (isUsernameField(key)) {
          return decodeBase64(value as string);
        }
      }
    }
    return undefined;
  };

  const getTargetInterface = (): NetworkInterface | undefined => {
    if (!connectionInfo?.interfaces?.length) return undefined;

    // If targetIp is specified, find the matching interface
    if (targetIp) {
      for (const iface of connectionInfo.interfaces) {
        if (iface.ipAddresses.includes(targetIp)) {
          return iface;
        }
      }
    }

    // When no targetIp (e.g., from action button), prefer non-pod networks for direct SSH
    const nonPodInterface = connectionInfo.interfaces.find(iface => !iface.isPodNetwork);
    if (nonPodInterface) {
      return nonPodInterface;
    }

    // Fall back to first interface (likely pod network)
    return connectionInfo.interfaces[0];
  };

  const targetInterface = getTargetInterface();
  const isPodNetwork = propIsPodNetwork ?? targetInterface?.isPodNetwork ?? false;
  const primaryUser = getUsernameFromCredentials();

  const getVirtctlSshCommand = () => {
    const userPart = primaryUser ? `${primaryUser}@` : '';
    return `virtctl ssh ${userPart}vm/${item.getName()} -n ${item.getNamespace()}`;
  };

  const getDirectSshCommand = () => {
    const userPart = primaryUser ? `${primaryUser}@` : '';
    const ip = targetIp || targetInterface?.ipAddresses[0] || '<IP>';
    return `ssh ${userPart}${ip}${sshPort !== 22 ? ` -p ${sshPort}` : ''}`;
  };

  const getVirtctlPortForwardCommand = () => {
    return `virtctl port-forward vm/${item.getName()} ${sshPort}:${sshPort} -n ${item.getNamespace()}`;
  };

  // Serial console functions
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
    if (!itemRef || !xterm) return;
    xterm.open(itemRef);
    xterm.onData(data => send(data));
    xterm.attachCustomKeyEventHandler(arg => {
      if (arg.ctrlKey && arg.type === 'keydown') {
        if (arg.code === 'KeyC') {
          const selection = xterm.getSelection();
          if (selection) return false;
        }
        if (arg.code === 'KeyV') return false;
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
    xterm.writeln(t('Connecting to serial console...'));

    // Use the exec method which connects to the /console endpoint
    // This endpoint is properly proxied by Headlamp (unlike portforward)
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
          xterm.writeln(t('\r\nConnection closed. Click "Reconnect" to try again.'));
        },
        connectCb: () => {
          if (!mountedRef.current) return;
          isConnectingRef.current = false;
          hasConnectedRef.current = true;
          setConnected(true);
          setConnectionError(null);
          xterm.writeln(t('Connected. Press Enter to activate the console.\r\n'));
        },
      }
    );
  }, [item, t, decoder]);

  const handleReconnect = useCallback(() => {
    // Reset connection state for manual reconnect
    hasConnectedRef.current = false;
    isConnectingRef.current = false;
    setConnectionError(null);
    if (xtermRef.current) {
      xtermRef.current.clear();
    }
    connect();
  }, [connect]);


  // Initialize terminal when serial console tab is active
  useEffect(() => {
    mountedRef.current = true;

    if (!props.open || activeTab !== 0 || loading || !connectionInfo?.ready) return;

    hasConnectedRef.current = false;
    isConnectingRef.current = false;

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
  }, [props.open, activeTab, loading, connectionInfo?.ready]);

  // Setup terminal when DOM is ready and auto-connect
  useEffect(() => {
    if (!props.open || activeTab !== 0 || !terminalRef || !xtermRef.current || !fitAddonRef.current) return;

    // Only setup and connect once per tab activation
    if (hasConnectedRef.current || isConnectingRef.current) {
      return;
    }

    setupTerminal(terminalRef, xtermRef.current, fitAddonRef.current);

    // Auto-connect to serial console
    connect();

    const handler = () => {
      fitAddonRef.current?.fit();
    };
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, [props.open, activeTab, terminalRef, setupTerminal, connect]);

  // Reset state when dialog opens/closes
  useEffect(() => {
    if (props.open) {
      // Set initial tab based on defaultTab prop when dialog opens
      setActiveTab(defaultTab === 'ssh' ? 1 : 0);
    } else {
      setConnected(false);
      setConnectionError(null);
      hasConnectedRef.current = false;
      isConnectingRef.current = false;
      // Cleanup connections
      if (execRef.current) {
        execRef.current.cancel();
        execRef.current = null;
      }
    }
  }, [props.open, defaultTab]);

  return (
    <Dialog
      onClose={onClose}
      onFullScreenToggled={() => {
        setTimeout(() => fitAddonRef.current?.fit(), 1);
      }}
      withFullScreen
      fullScreen
      title={`SSH/Serial Console: ${item?.getName()}${targetIp ? ` (${targetIp})` : ''}`}
      {...other}
    >
      <DialogContent
        sx={(theme: any) => ({
          p: 2,
          minWidth: 700,
          minHeight: 500,
          display: 'flex',
          flexDirection: 'column',
          '& .xterm': {
            height: '100%',
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
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', py: 4 }}>
            <CircularProgress />
            <Typography sx={{ ml: 2 }}>Loading connection info...</Typography>
          </Box>
        ) : !connectionInfo?.ready ? (
          <Alert severity="warning" sx={{ mb: 2 }}>
            VM is not running. SSH connection is only available when the VM is in Running state.
          </Alert>
        ) : (
          <>
            <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}>
              <Tabs value={activeTab} onChange={(_, v) => setActiveTab(v)}>
                <Tab label="Serial Console" />
                <Tab label="SSH Commands" />
              </Tabs>
            </Box>

            {/* Serial Console Tab */}
            {activeTab === 0 && (
              <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
                <Alert severity="info" sx={{ mb: 2 }}>
                  <Typography variant="body2">
                    <strong>Serial Console:</strong> Direct console access to the VM. This is the VM's serial port,
                    similar to connecting a physical serial cable. Login with your VM credentials when prompted.
                  </Typography>
                </Alert>

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
                  sx={{
                    flex: 1,
                    width: '100%',
                    overflow: 'hidden',
                    bgcolor: '#000',
                    borderRadius: 1,
                    minHeight: 350,
                  }}
                >
                  <div
                    id="xterm-container"
                    ref={x => setTerminalRef(x)}
                    style={{ height: '100%', width: '100%' }}
                  />
                </Box>

                <Box sx={{ display: 'flex', gap: 2, justifyContent: 'space-between', alignItems: 'center', mt: 2 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    {connected && (
                      <Chip label="Connected" size="small" color="success" />
                    )}
                    {!connected && !connectionError && (
                      <Chip label="Connecting..." size="small" color="warning" />
                    )}
                  </Box>
                  <Button variant="outlined" onClick={() => onClose?.()}>
                    Close
                  </Button>
                </Box>
              </Box>
            )}

            {/* SSH Commands Tab */}
            {activeTab === 1 && (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, overflow: 'auto', flex: 1 }}>
                {/* Connection Target Info */}
                <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
                  <Chip
                    label={isPodNetwork ? 'Pod Network' : 'Multus Network'}
                    size="small"
                    color={isPodNetwork ? 'primary' : 'default'}
                    variant="outlined"
                  />
                  {targetIp && (
                    <Chip label={targetIp} size="small" variant="outlined" sx={{ fontFamily: 'monospace' }} />
                  )}
                  {primaryUser && (
                    <Chip label={`User: ${primaryUser}`} size="small" color="info" variant="outlined" />
                  )}
                  <FormControl size="small" sx={{ minWidth: 100 }}>
                    <InputLabel>Port</InputLabel>
                    <Select
                      value={sshPort}
                      label="Port"
                      onChange={(e) => setSshPort(Number(e.target.value))}
                    >
                      <MenuItem value={22}>22</MenuItem>
                      <MenuItem value={2222}>2222</MenuItem>
                    </Select>
                  </FormControl>
                </Box>

                <Divider />

                {/* virtctl SSH */}
                <Paper variant="outlined" sx={{ p: 2 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                    <Typography variant="subtitle1" fontWeight="bold">
                      virtctl SSH
                    </Typography>
                    {isPodNetwork && <Chip label="Recommended" size="small" color="success" />}
                  </Box>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                    Tunnels SSH through the Kubernetes API. Works with pod networks without exposing ports.
                  </Typography>
                  <TextField
                    fullWidth
                    value={getVirtctlSshCommand()}
                    InputProps={{
                      readOnly: true,
                      sx: { fontFamily: 'monospace', fontSize: '0.9em' },
                      endAdornment: (
                        <InputAdornment position="end">
                          <Tooltip title={copiedField === 'virtctl-ssh' ? 'Copied!' : 'Copy'}>
                            <IconButton
                              onClick={() => copyToClipboard(getVirtctlSshCommand(), 'virtctl-ssh')}
                              size="small"
                            >
                              {copiedField === 'virtctl-ssh' ? '✓' : '📋'}
                            </IconButton>
                          </Tooltip>
                        </InputAdornment>
                      ),
                    }}
                    size="small"
                  />
                </Paper>

                {/* Direct SSH - only show for non-pod networks */}
                {!isPodNetwork && (
                  <Paper variant="outlined" sx={{ p: 2 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                      <Typography variant="subtitle1" fontWeight="bold">
                        Direct SSH
                      </Typography>
                      <Chip label="Recommended" size="small" color="success" />
                    </Box>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                      Connect directly to the VM's IP address (requires network access).
                    </Typography>
                    <Box sx={{ display: 'flex', gap: 1 }}>
                      <TextField
                        fullWidth
                        value={getDirectSshCommand()}
                        InputProps={{
                          readOnly: true,
                          sx: { fontFamily: 'monospace', fontSize: '0.9em' },
                          endAdornment: (
                            <InputAdornment position="end">
                              <Tooltip title={copiedField === 'direct-ssh' ? 'Copied!' : 'Copy'}>
                                <IconButton
                                  onClick={() => copyToClipboard(getDirectSshCommand(), 'direct-ssh')}
                                  size="small"
                                >
                                  {copiedField === 'direct-ssh' ? '✓' : '📋'}
                                </IconButton>
                              </Tooltip>
                            </InputAdornment>
                          ),
                        }}
                        size="small"
                      />
                      <Button
                        variant="outlined"
                        size="small"
                        onClick={() => {
                          const ip = targetIp || targetInterface?.ipAddresses[0];
                          if (ip) {
                            const sshUrl = `ssh://${primaryUser ? primaryUser + '@' : ''}${ip}:${sshPort}`;
                            window.open(sshUrl, '_blank');
                          }
                        }}
                      >
                        Open
                      </Button>
                    </Box>
                  </Paper>
                )}

                {/* Port Forward */}
                <Paper variant="outlined" sx={{ p: 2 }}>
                  <Typography variant="subtitle1" fontWeight="bold" gutterBottom>
                    Port Forward (Alternative)
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                    Forward the SSH port to localhost, then connect with regular SSH.
                  </Typography>
                  <TextField
                    fullWidth
                    value={getVirtctlPortForwardCommand()}
                    InputProps={{
                      readOnly: true,
                      sx: { fontFamily: 'monospace', fontSize: '0.9em' },
                      endAdornment: (
                        <InputAdornment position="end">
                          <Tooltip title={copiedField === 'port-forward' ? 'Copied!' : 'Copy'}>
                            <IconButton
                              onClick={() => copyToClipboard(getVirtctlPortForwardCommand(), 'port-forward')}
                              size="small"
                            >
                              {copiedField === 'port-forward' ? '✓' : '📋'}
                            </IconButton>
                          </Tooltip>
                        </InputAdornment>
                      ),
                    }}
                    size="small"
                  />
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                    Then run: <code>ssh {primaryUser || 'user'}@localhost -p {sshPort}</code>
                  </Typography>
                </Paper>

                {/* Network Interfaces */}
                {connectionInfo?.interfaces?.length > 0 && (
                  <Paper variant="outlined" sx={{ p: 2 }}>
                    <Typography variant="subtitle1" fontWeight="bold" gutterBottom>
                      Network Interfaces
                    </Typography>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                      {connectionInfo.interfaces.map((iface, idx) => (
                        <Box key={idx} sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                          <Chip
                            label={iface.name}
                            size="small"
                            color={iface.isPodNetwork ? 'primary' : 'default'}
                            variant="outlined"
                          />
                          {iface.isPodNetwork && (
                            <Chip label="Pod" size="small" color="info" variant="outlined" />
                          )}
                          {iface.ipAddresses.filter(ip => ip && ip.trim()).map((ip, ipIdx) => (
                            <Chip
                              key={ipIdx}
                              label={ip}
                              variant="outlined"
                              color={ip === targetIp ? 'success' : (ip.includes(':') ? 'default' : 'success')}
                              onClick={() => copyToClipboard(ip, `ip-${idx}-${ipIdx}`)}
                              sx={{ fontFamily: 'monospace', cursor: 'pointer' }}
                              icon={copiedField === `ip-${idx}-${ipIdx}` ? <span>✓</span> : undefined}
                            />
                          ))}
                        </Box>
                      ))}
                    </Box>
                  </Paper>
                )}

                {/* Access Credentials */}
                {connectionInfo?.sshCredentials?.length > 0 && (
                  <Paper variant="outlined" sx={{ p: 2 }}>
                    <Typography variant="subtitle1" fontWeight="bold" gutterBottom>
                      Access Credentials
                    </Typography>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      {connectionInfo.sshCredentials.map((cred, idx) => (
                        <Box key={idx}>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                            <Chip
                              label={cred.type === 'sshPublicKey' ? 'SSH Public Key' : 'User/Password'}
                              size="small"
                              color={cred.type === 'sshPublicKey' ? 'success' : 'warning'}
                            />
                            {cred.users && cred.users.length > 0 && (
                              <>
                                <Typography variant="caption" color="text.secondary">Users:</Typography>
                                {cred.users.map((user, userIdx) => (
                                  <Chip
                                    key={userIdx}
                                    label={user}
                                    size="small"
                                    variant="outlined"
                                    onClick={() => copyToClipboard(user, `user-${idx}-${userIdx}`)}
                                    sx={{ cursor: 'pointer' }}
                                  />
                                ))}
                              </>
                            )}
                          </Box>
                          <TableContainer>
                            <Table size="small">
                              <TableBody>
                                <TableRow>
                                  <TableCell sx={{ fontWeight: 'bold', width: '30%' }}>Secret</TableCell>
                                  <TableCell>
                                    <Link
                                      routeName="secret"
                                      params={{
                                        name: cred.secretName,
                                        namespace: item.getNamespace(),
                                      }}
                                    >
                                      {cred.secretName}
                                    </Link>
                                  </TableCell>
                                </TableRow>
                                {secretData[cred.secretName] && cred.type === 'userPassword' && (
                                  <>
                                    {Object.entries(secretData[cred.secretName].data || {}).map(([key, value]) => {
                                      const isPassword = isPasswordField(key);
                                      const decodedValue = decodeBase64(value as string);
                                      const fieldKey = `secret-${cred.secretName}-${key}`;
                                      const isVisible = showPasswords[fieldKey] === true;

                                      return (
                                        <TableRow key={key}>
                                          <TableCell sx={{ fontWeight: 'bold' }}>{key}</TableCell>
                                          <TableCell>
                                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                              <code style={{ fontSize: '0.85em', minWidth: 100 }}>
                                                {isPassword ? (isVisible ? decodedValue : '••••••••') : decodedValue}
                                              </code>
                                              {isPassword && (
                                                <Tooltip title={isVisible ? 'Hide' : 'Show'}>
                                                  <IconButton
                                                    size="small"
                                                    onClick={() => togglePasswordVisibility(fieldKey)}
                                                  >
                                                    {isVisible ? '🙈' : '👁️'}
                                                  </IconButton>
                                                </Tooltip>
                                              )}
                                              <Tooltip title={copiedField === fieldKey ? 'Copied!' : 'Copy'}>
                                                <IconButton
                                                  size="small"
                                                  onClick={() => copyToClipboard(decodedValue, fieldKey)}
                                                >
                                                  {copiedField === fieldKey ? '✓' : '📋'}
                                                </IconButton>
                                              </Tooltip>
                                            </Box>
                                          </TableCell>
                                        </TableRow>
                                      );
                                    })}
                                  </>
                                )}
                              </TableBody>
                            </Table>
                          </TableContainer>
                        </Box>
                      ))}
                    </Box>
                  </Paper>
                )}

                <Divider />

                <Alert severity="info">
                  <Typography variant="body2" gutterBottom>
                    <strong>SSH Connection Requirements:</strong>
                  </Typography>
                  <ul style={{ margin: 0, paddingLeft: 20 }}>
                    <li>SSH server must be running inside the VM (e.g., OpenSSH)</li>
                    <li>For Pod network: Install <code>virtctl</code> CLI tool</li>
                    <li>For Multus network: Direct SSH access via the IP address</li>
                  </ul>
                </Alert>

                <Box sx={{ display: 'flex', gap: 2, justifyContent: 'flex-end' }}>
                  <Button variant="outlined" onClick={() => onClose?.()}>
                    Close
                  </Button>
                </Box>
              </Box>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
