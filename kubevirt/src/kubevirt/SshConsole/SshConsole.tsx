import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { Dialog, Link } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import type { DialogProps } from '@mui/material';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  DialogContent,
  Divider,
  IconButton,
  InputAdornment,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import VirtualMachineInstance from '../VirtualMachineInstance/VirtualMachineInstance';

interface SshConsoleProps extends DialogProps {
  item: VirtualMachineInstance;
  vmSpec?: any; // VM spec to get accessCredentials
  onClose?: () => void;
  open: boolean;
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
  nodeName?: string;
  ready: boolean;
}

export default function SshConsole(props: SshConsoleProps) {
  const { item, vmSpec, onClose, ...other } = props;
  const { t } = useTranslation(['translation', 'glossary']);
  const [connectionInfo, setConnectionInfo] = useState<SshConnectionInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [secretData, setSecretData] = useState<Record<string, any>>({});
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [showPasswords, setShowPasswords] = useState<Record<string, boolean>>({});

  // Fetch connection info
  useEffect(() => {
    if (!props.open || !item) return;

    const fetchConnectionInfo = async () => {
      setLoading(true);
      try {
        // Get VMI status for IP addresses
        const vmiResponse = await ApiProxy.request(
          `/apis/kubevirt.io/v1/namespaces/${item.getNamespace()}/virtualmachineinstances/${item.getName()}`,
          { method: 'GET' }
        );

        const vmiStatus = (vmiResponse as any)?.status;
        const vmiSpec = (vmiResponse as any)?.spec;

        // Get network definitions to check which are pod networks
        const networks = vmiSpec?.networks || [];
        const podNetworkNames = new Set<string>();
        for (const network of networks) {
          if (network.pod) {
            podNetworkNames.add(network.name);
          }
        }

        // Helper to check if IP is loopback
        const isLoopbackIP = (ip: string): boolean => {
          if (!ip) return true;
          const trimmed = ip.trim();
          // IPv4 loopback: 127.x.x.x
          if (trimmed.startsWith('127.')) return true;
          // IPv6 loopback: ::1
          if (trimmed === '::1') return true;
          // IPv6 link-local: fe80::
          if (trimmed.toLowerCase().startsWith('fe80:')) return true;
          return false;
        };

        // Extract IP addresses from interfaces with network info
        const interfaces: NetworkInterface[] = [];
        if (vmiStatus?.interfaces) {
          for (const iface of vmiStatus.interfaces) {
            // Skip unknown interfaces
            if (!iface.name || iface.name === 'unknown' || iface.name === '') {
              continue;
            }

            const ipAddresses: string[] = [];
            if (iface.ipAddresses && Array.isArray(iface.ipAddresses)) {
              // Filter out empty/null values, loopback IPs, and prefer IPv4
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

        // Extract access credentials from VM spec (passed as prop) or VMI spec
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
          nodeName: vmiStatus?.nodeName,
          ready: vmiStatus?.phase === 'Running',
        });

        // Fetch secret data for credentials
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

  // Determine if a field should be treated as sensitive/password
  // Simple approach: if it's NOT clearly a username field, treat it as sensitive
  const isUsernameField = (key: string): boolean => {
    const lowerKey = key.toLowerCase();
    return lowerKey === 'user' || lowerKey === 'username' || lowerKey === 'name' ||
           lowerKey === 'login' || lowerKey === 'account' ||
           lowerKey.startsWith('user') || lowerKey.endsWith('user') ||
           lowerKey.endsWith('name') || lowerKey.endsWith('login');
  };

  // If it's not a username field, treat it as a password/sensitive field
  const isPasswordField = (key: string): boolean => {
    return !isUsernameField(key);
  };

  // Get username from userPassword credentials secret
  const getUsernameFromCredentials = (): string | undefined => {
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

  // Get primary interface (prefer pod network for virtctl, otherwise first interface)
  const getPrimaryInterface = (): NetworkInterface | undefined => {
    if (!connectionInfo?.interfaces?.length) return undefined;
    // Return first interface (could be pod or multus)
    return connectionInfo.interfaces[0];
  };

  const getSSHCommand = (user?: string): string => {
    const primaryInterface = getPrimaryInterface();
    if (!primaryInterface) return '';

    const vmName = item.getName();
    const namespace = item.getNamespace();

    // If it's a pod network, use virtctl ssh
    if (primaryInterface.isPodNetwork) {
      const userPart = user ? `${user}@` : '';
      return `virtctl ssh ${userPart}vm/${vmName} -n ${namespace}`;
    }

    // Otherwise use regular ssh with IP
    const primaryIP = primaryInterface.ipAddresses[0];
    const userPart = user ? `${user}@` : '';
    return `ssh ${userPart}${primaryIP}`;
  };

  // Priority: 1. SSH key users, 2. Username from userPassword secret, 3. undefined
  const sshKeyUser = connectionInfo?.sshCredentials?.find(c => c.type === 'sshPublicKey')?.users?.[0];
  const userPasswordUser = getUsernameFromCredentials();
  const primaryUser = sshKeyUser || userPasswordUser;
  const primaryInterface = getPrimaryInterface();

  // Get all IPs for display
  const allIPs = connectionInfo?.interfaces?.flatMap(iface => iface.ipAddresses) || [];

  return (
    <Dialog
      onClose={onClose}
      withFullScreen
      title={`SSH Connection: ${item?.getName()}`}
      {...other}
    >
      <DialogContent sx={{ p: 3, minWidth: 500 }}>
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
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {/* Quick Connect */}
            {primaryInterface && (
              <Paper variant="outlined" sx={{ p: 2 }}>
                <Typography variant="subtitle1" fontWeight="bold" gutterBottom>
                  Quick Connect
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                  <TextField
                    fullWidth
                    value={getSSHCommand(primaryUser)}
                    InputProps={{
                      readOnly: true,
                      sx: { fontFamily: 'monospace', fontSize: '0.9em' },
                      endAdornment: (
                        <InputAdornment position="end">
                          <Tooltip title={copiedField === 'sshCommand' ? 'Copied!' : 'Copy to clipboard'}>
                            <IconButton
                              onClick={() => copyToClipboard(getSSHCommand(primaryUser), 'sshCommand')}
                              size="small"
                            >
                              {copiedField === 'sshCommand' ? '✓' : '📋'}
                            </IconButton>
                          </Tooltip>
                        </InputAdornment>
                      ),
                    }}
                  />
                </Box>
                <Typography variant="caption" color="text.secondary">
                  {primaryInterface.isPodNetwork
                    ? 'Uses virtctl to connect via pod network (requires virtctl installed)'
                    : 'Copy this command to connect via your local terminal'}
                </Typography>
              </Paper>
            )}

            {/* Network Interfaces */}
            <Paper variant="outlined" sx={{ p: 2 }}>
              <Typography variant="subtitle1" fontWeight="bold" gutterBottom>
                Network Interfaces
              </Typography>
              {connectionInfo?.interfaces?.length > 0 ? (
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
                        <Chip label="Pod Network" size="small" color="info" variant="outlined" />
                      )}
                      {iface.ipAddresses.filter(ip => ip && ip.trim()).map((ip, ipIdx) => (
                        <Chip
                          key={ipIdx}
                          label={ip}
                          variant="outlined"
                          color={ip.includes(':') ? 'default' : 'success'}
                          onClick={() => copyToClipboard(ip, `ip-${idx}-${ipIdx}`)}
                          sx={{ fontFamily: 'monospace', cursor: 'pointer' }}
                          icon={copiedField === `ip-${idx}-${ipIdx}` ? <span>✓</span> : undefined}
                        />
                      ))}
                    </Box>
                  ))}
                </Box>
              ) : (
                <Alert severity="info" sx={{ mt: 1 }}>
                  No IP addresses found. Ensure the VM has network connectivity and guest agent is running.
                </Alert>
              )}
            </Paper>

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

            {/* Node Info */}
            {connectionInfo?.nodeName && (
              <Paper variant="outlined" sx={{ p: 2 }}>
                <Typography variant="subtitle1" fontWeight="bold" gutterBottom>
                  Host Information
                </Typography>
                <TableContainer>
                  <Table size="small">
                    <TableBody>
                      <TableRow>
                        <TableCell sx={{ fontWeight: 'bold', width: '30%' }}>Node</TableCell>
                        <TableCell>
                          <Link routeName="node" params={{ name: connectionInfo.nodeName }}>
                            {connectionInfo.nodeName}
                          </Link>
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </TableContainer>
              </Paper>
            )}

            <Divider />

            {/* Help Text */}
            <Alert severity="info">
              <Typography variant="body2" gutterBottom>
                <strong>SSH Connection Requirements:</strong>
              </Typography>
              <ul style={{ margin: 0, paddingLeft: 20 }}>
                <li>SSH server must be running inside the VM (e.g., OpenSSH)</li>
                <li>For Pod network: Install <code>virtctl</code> CLI tool</li>
                <li>For Multus network: Direct SSH access via the IP address</li>
                <li>For password auth, QEMU Guest Agent propagates credentials</li>
                <li>For SSH key auth, ensure your public key is in the referenced secret</li>
              </ul>
            </Alert>

            {/* Actions */}
            <Box sx={{ display: 'flex', gap: 2, justifyContent: 'flex-end' }}>
              <Button variant="outlined" onClick={() => onClose?.()}>
                Close
              </Button>
              {primaryInterface && !primaryInterface.isPodNetwork && (
                <Button
                  variant="contained"
                  onClick={() => {
                    const primaryIP = primaryInterface.ipAddresses[0];
                    const sshUrl = `ssh://${primaryUser ? primaryUser + '@' : ''}${primaryIP}`;
                    window.open(sshUrl, '_blank');
                  }}
                >
                  Open SSH Client
                </Button>
              )}
            </Box>
          </Box>
        )}
      </DialogContent>
    </Dialog>
  );
}
