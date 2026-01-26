import { Link } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Icon } from '@iconify/react';
import {
  Box,
  Chip,
  IconButton,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material';

export interface NetworkInterface {
  name: string;
  type: string;
  model: string;
  macAddress?: string;
  ipv4?: string[];
  ipv6?: string[];
  network?: {
    pod?: boolean;
    multus?: {
      networkName?: string;
    };
  };
}

export interface NetworkInterfacesGridProps {
  /** Array of network interfaces to display */
  interfaces: NetworkInterface[];
  /** Namespace for link routing */
  namespace: string;
  /** Callback when SSH icon is clicked for an IP */
  onSshClick?: (ip: string, isPodNetwork: boolean) => void;
}

/**
 * Shared component for displaying network interfaces in a table grid.
 * Used in both VM Details and VMI Details pages.
 */
export default function NetworkInterfacesGrid({
  interfaces,
  namespace,
  onSshClick,
}: NetworkInterfacesGridProps) {
  const isLoopbackIPv4 = (ip: string): boolean => {
    return ip.startsWith('127.');
  };

  const isLoopbackIPv6 = (ip: string): boolean => {
    return ip === '::1' || ip.toLowerCase().startsWith('fe80:');
  };

  return (
    <Box>
      <Typography variant="subtitle1" sx={{ fontWeight: 'bold' }} gutterBottom>
        Network Interfaces ({interfaces.length})
      </Typography>
      <TableContainer component={Paper} variant="outlined">
        <Table size="medium">
          <TableHead>
            <TableRow>
              <TableCell sx={{ fontWeight: 'bold', fontSize: '1rem' }}>Name</TableCell>
              <TableCell sx={{ fontWeight: 'bold', fontSize: '1rem' }}>Type</TableCell>
              <TableCell sx={{ fontWeight: 'bold', fontSize: '1rem' }}>Model</TableCell>
              <TableCell sx={{ fontWeight: 'bold', fontSize: '1rem' }}>MAC Address</TableCell>
              <TableCell sx={{ fontWeight: 'bold', fontSize: '1rem' }}>IPv4</TableCell>
              <TableCell sx={{ fontWeight: 'bold', fontSize: '1rem' }}>IPv6</TableCell>
              <TableCell sx={{ fontWeight: 'bold', fontSize: '1rem' }}>Network</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {interfaces.map((iface, idx) => {
              const isPodNetwork = !!iface.network?.pod;

              return (
                <TableRow key={idx}>
                  <TableCell sx={{ fontSize: '1rem' }}>{iface.name}</TableCell>
                  <TableCell sx={{ fontSize: '1rem' }}>
                    <Chip label={iface.type} size="small" variant="outlined" />
                  </TableCell>
                  <TableCell sx={{ fontSize: '1rem' }}>{iface.model}</TableCell>
                  <TableCell sx={{ fontSize: '1rem' }}>
                    <code style={{ fontSize: '1rem' }}>
                      {iface.macAddress || 'auto'}
                    </code>
                  </TableCell>
                  <TableCell sx={{ fontSize: '1rem' }}>
                    {iface.ipv4 && iface.ipv4.length > 0 ? (
                      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                        {iface.ipv4.map((ip, ipIdx) => {
                          const isLoopback = isLoopbackIPv4(ip);
                          const showSshIcon = !isPodNetwork && !isLoopback && onSshClick;
                          return (
                            <Box
                              key={ipIdx}
                              sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}
                            >
                              <code style={{ fontSize: '1rem' }}>{ip}</code>
                              {showSshIcon && (
                                <Tooltip title={`SSH to ${ip}`}>
                                  <IconButton
                                    size="small"
                                    sx={{ p: 0.25 }}
                                    onClick={() => onSshClick(ip, isPodNetwork)}
                                  >
                                    <Icon icon="mdi:console-network" width={16} height={16} />
                                  </IconButton>
                                </Tooltip>
                              )}
                            </Box>
                          );
                        })}
                      </Box>
                    ) : (
                      <Typography variant="body1" color="text.secondary">
                        -
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell sx={{ fontSize: '1rem' }}>
                    {iface.ipv6 && iface.ipv6.length > 0 ? (
                      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                        {iface.ipv6.map((ip, ipIdx) => {
                          const isLoopback = isLoopbackIPv6(ip);
                          const showSshIcon = !isPodNetwork && !isLoopback && onSshClick;
                          return (
                            <Box
                              key={ipIdx}
                              sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}
                            >
                              <code style={{ fontSize: '1rem' }}>{ip}</code>
                              {showSshIcon && (
                                <Tooltip title={`SSH to ${ip}`}>
                                  <IconButton
                                    size="small"
                                    sx={{ p: 0.25 }}
                                    onClick={() => onSshClick(ip, isPodNetwork)}
                                  >
                                    <Icon icon="mdi:console-network" width={16} height={16} />
                                  </IconButton>
                                </Tooltip>
                              )}
                            </Box>
                          );
                        })}
                      </Box>
                    ) : (
                      <Typography variant="body1" color="text.secondary">
                        -
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell sx={{ fontSize: '1rem' }}>
                    {iface.network?.pod ? (
                      'Pod Network'
                    ) : iface.network?.multus?.networkName ? (
                      (() => {
                        const networkName = iface.network.multus.networkName;
                        // Network name can be "name" or "namespace/name"
                        let nadName = networkName;
                        let nadNamespace = namespace;
                        if (networkName.includes('/')) {
                          [nadNamespace, nadName] = networkName.split('/');
                        }
                        return (
                          <Link
                            routeName="networkattachmentdefinition"
                            params={{ name: nadName, namespace: nadNamespace }}
                          >
                            {networkName}
                          </Link>
                        );
                      })()
                    ) : (
                      'unknown'
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}
