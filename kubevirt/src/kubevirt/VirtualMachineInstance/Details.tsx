import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { ActionButton, Link, Resource, SectionBox } from '@kinvolk/headlamp-plugin/lib/components/common';
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  IconButton,
  InputLabel,
  LinearProgress,
  MenuItem,
  Paper,
  Select,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { Icon } from '@iconify/react';
import { useSnackbar } from 'notistack';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import DiskManagement from '../components/DiskManagement';
import SchedulingAffinity from '../components/SchedulingAffinity';
import SshConsole from '../SshConsole/SshConsole';
import Terminal from '../Terminal/Terminal';
import { formatBytes } from '../utils/kubeVirtCheck';
import BackupSection from '../components/BackupSection';
import VncConsole from '../VncConsole/VncConsole';
import VirtualMachineInstance from './VirtualMachineInstance';

export interface VirtualMachineInstanceDetailsProps {
  showLogsDefault?: boolean;
  name?: string;
  namespace?: string;
}

// Usage bar component
function UsageBar({ used, total, label }: { used: number; total: number; label?: string }) {
  const percentage = total > 0 ? Math.min((used / total) * 100, 100) : 0;
  const color = percentage > 90 ? 'error' : percentage > 70 ? 'warning' : 'primary';

  return (
    <Tooltip title={label || `${percentage.toFixed(1)}% used`}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 120 }}>
        <LinearProgress
          variant="determinate"
          value={percentage}
          color={color}
          sx={{ flexGrow: 1, height: 8, borderRadius: 4 }}
        />
        <Typography variant="caption" sx={{ minWidth: 45 }}>
          {percentage.toFixed(0)}%
        </Typography>
      </Box>
    </Tooltip>
  );
}

function getPhaseColor(phase: string): 'success' | 'error' | 'warning' | 'default' {
  switch (phase) {
    case 'Running':
      return 'success';
    case 'Failed':
    case 'Unknown':
      return 'error';
    case 'Pending':
    case 'Scheduling':
    case 'Scheduled':
      return 'warning';
    default:
      return 'default';
  }
}

// Port presets for port forwarding
const PORT_PRESETS = [
  { name: 'SSH', port: 22, protocol: 'TCP' },
  { name: 'RDP', port: 3389, protocol: 'TCP' },
  { name: 'HTTP', port: 80, protocol: 'TCP' },
  { name: 'HTTPS', port: 443, protocol: 'TCP' },
  { name: 'VNC', port: 5900, protocol: 'TCP' },
];

// Port Forwarding Section for VMI Details
interface PortForwardingSectionProps {
  vmiName: string;
  namespace: string;
}

function PortForwardingSection({ vmiName, namespace }: PortForwardingSectionProps) {
  const { t } = useTranslation('glossary');
  const { enqueueSnackbar } = useSnackbar();
  const [services, setServices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [portName, setPortName] = useState('');
  const [targetPort, setTargetPort] = useState(22);
  const [serviceType, setServiceType] = useState('LoadBalancer');
  const [protocol, setProtocol] = useState('TCP');

  // Fetch existing services for this VMI
  useEffect(() => {
    const fetchServices = async () => {
      try {
        const response = await ApiProxy.request(`/api/v1/namespaces/${namespace}/services`) as { items: any[] };
        const vmiServices = response.items?.filter(svc =>
          svc.spec?.selector?.['vm.kubevirt.io/name'] === vmiName ||
          svc.metadata?.labels?.['kubevirt.io/vm'] === vmiName
        ) || [];
        setServices(vmiServices);
        setLoading(false);
      } catch (error) {
        console.error('Failed to fetch services:', error);
        setLoading(false);
      }
    };

    fetchServices();
    const interval = setInterval(fetchServices, 10000);
    return () => clearInterval(interval);
  }, [vmiName, namespace]);

  const handleCreatePortForward = async () => {
    if (!portName || !targetPort) {
      enqueueSnackbar('Please fill all required fields', { variant: 'warning' });
      return;
    }

    const serviceName = `${vmiName}-${portName.toLowerCase()}-${targetPort}`;
    const service = {
      apiVersion: 'v1',
      kind: 'Service',
      metadata: {
        name: serviceName,
        namespace: namespace,
        labels: {
          'kubevirt.io/vm': vmiName,
          'app': `vm-${vmiName}`,
        },
      },
      spec: {
        type: serviceType,
        selector: {
          'vm.kubevirt.io/name': vmiName,
        },
        ports: [
          {
            name: portName.toLowerCase(),
            protocol: protocol,
            port: targetPort,
            targetPort: targetPort,
          },
        ],
      },
    };

    try {
      await ApiProxy.request(`/api/v1/namespaces/${namespace}/services`, {
        method: 'POST',
        body: JSON.stringify(service),
        headers: { 'Content-Type': 'application/json' },
      });

      enqueueSnackbar('Port forward created successfully', { variant: 'success' });
      setDialogOpen(false);
      setPortName('');
      setTargetPort(22);

      // Refresh services
      const response = await ApiProxy.request(`/api/v1/namespaces/${namespace}/services`) as { items: any[] };
      const vmiServices = response.items?.filter(svc =>
        svc.spec?.selector?.['vm.kubevirt.io/name'] === vmiName ||
        svc.metadata?.labels?.['kubevirt.io/vm'] === vmiName
      ) || [];
      setServices(vmiServices);
    } catch (error: any) {
      enqueueSnackbar(`Failed to create port forward: ${error.message}`, { variant: 'error' });
    }
  };

  const handleDeleteService = async (svc: any) => {
    try {
      await ApiProxy.request(`/api/v1/namespaces/${namespace}/services/${svc.metadata.name}`, {
        method: 'DELETE',
      });
      enqueueSnackbar('Port forward deleted', { variant: 'success' });
      setServices(services.filter(s => s.metadata.name !== svc.metadata.name));
    } catch (error: any) {
      enqueueSnackbar(`Failed to delete: ${error.message}`, { variant: 'error' });
    }
  };

  const getConnectionCommand = (svc: any, port: any): string => {
    const host = svc.status?.loadBalancer?.ingress?.[0]?.ip || '<node-ip>';
    const p = port.nodePort || port.port;
    if (port.targetPort === 22) return `ssh user@${host} -p ${p}`;
    if (port.targetPort === 3389) return `xfreerdp /v:${host}:${p}`;
    return `${host}:${p}`;
  };

  return (
    <SectionBox title={t('Port Forwarding')}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="body2" color="text.secondary">
          Expose VMI ports via Kubernetes Services
        </Typography>
        <Button
          variant="outlined"
          size="small"
          startIcon={<Icon icon="mdi:plus" />}
          onClick={() => setDialogOpen(true)}
        >
          Add Port Forward
        </Button>
      </Box>

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
          <CircularProgress size={24} />
        </Box>
      ) : services.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 2, textAlign: 'center' }}>
          <Typography variant="body2" color="text.secondary">
            No port forwards configured for this VMI
          </Typography>
        </Paper>
      ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Service</TableCell>
                <TableCell>Type</TableCell>
                <TableCell>Port</TableCell>
                <TableCell>Node Port</TableCell>
                <TableCell>Connection</TableCell>
                <TableCell>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {services.flatMap(svc =>
                svc.spec?.ports?.map((port: any, idx: number) => (
                  <TableRow key={`${svc.metadata.name}-${idx}`}>
                    <TableCell>{svc.metadata.name}</TableCell>
                    <TableCell>
                      <Chip label={svc.spec.type} size="small" variant="outlined" />
                    </TableCell>
                    <TableCell>{port.port}</TableCell>
                    <TableCell>{port.nodePort || '-'}</TableCell>
                    <TableCell>
                      <Tooltip title="Click to copy">
                        <Box
                          component="code"
                          sx={{
                            fontSize: '0.8em',
                            cursor: 'pointer',
                            bgcolor: 'action.hover',
                            color: 'text.primary',
                            padding: '2px 6px',
                            borderRadius: 1,
                          }}
                          onClick={() => {
                            navigator.clipboard.writeText(getConnectionCommand(svc, port));
                            enqueueSnackbar('Copied to clipboard', { variant: 'success' });
                          }}
                        >
                          {getConnectionCommand(svc, port)}
                        </Box>
                      </Tooltip>
                    </TableCell>
                    <TableCell>
                      <IconButton size="small" color="error" onClick={() => handleDeleteService(svc)}>
                        <Icon icon="mdi:delete" />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        maxWidth={false}
        PaperProps={{
          sx: {
            width: '100%',
            maxWidth: { xs: '95%', sm: 500, md: 600 },
            m: { xs: 1, sm: 2 },
          }
        }}
      >
        <DialogTitle>Create Port Forward</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              <Typography variant="caption" color="text.secondary" sx={{ width: '100%' }}>
                Quick presets:
              </Typography>
              {PORT_PRESETS.map(preset => (
                <Chip
                  key={preset.name}
                  label={`${preset.name} (${preset.port})`}
                  size="small"
                  onClick={() => {
                    setPortName(preset.name);
                    setTargetPort(preset.port);
                    setProtocol(preset.protocol);
                  }}
                  sx={{ cursor: 'pointer' }}
                />
              ))}
            </Box>
            <TextField
              label="Port Name"
              value={portName}
              onChange={(e) => setPortName(e.target.value)}
              placeholder="e.g., ssh, http"
              fullWidth
            />
            <TextField
              label="Target Port"
              type="number"
              value={targetPort}
              onChange={(e) => setTargetPort(parseInt(e.target.value) || 0)}
              fullWidth
            />
            <FormControl fullWidth>
              <InputLabel>Service Type</InputLabel>
              <Select value={serviceType} label="Service Type" onChange={(e) => setServiceType(e.target.value)}>
                <MenuItem value="NodePort">NodePort</MenuItem>
                <MenuItem value="LoadBalancer">LoadBalancer</MenuItem>
                <MenuItem value="ClusterIP">ClusterIP (internal only)</MenuItem>
              </Select>
            </FormControl>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleCreatePortForward} variant="contained">Create</Button>
        </DialogActions>
      </Dialog>
    </SectionBox>
  );
}

export default function VirtualMachineInstanceDetails(props: VirtualMachineInstanceDetailsProps) {
  const params = useParams<{ namespace: string; name: string }>();
  const { name = params.name, namespace = params.namespace } = props;
  const { t } = useTranslation('glossary');
  const { enqueueSnackbar } = useSnackbar();
  const [showTerminal, setShowTerminal] = useState(false);
  const [showVnc, setShowVnc] = useState(false);
  const [showSsh, setShowSsh] = useState(false);
  const [vmiItem, setVmiItem] = useState<VirtualMachineInstance | null>(null);

  const [podName, setPodName] = useState<string | null>(null);
  const [guestInfo, setGuestInfo] = useState<any>(null);
  const [filesystemInfo, setFilesystemInfo] = useState<any>(null);

  // Fetch pod info
  useEffect(() => {
    if (!name || !namespace) return;

    const fetchPodInfo = async () => {
      try {
        const queryParams = new URLSearchParams();
        queryParams.append('labelSelector', `vm.kubevirt.io/name=${name}`);
        const response = await ApiProxy.request(
          `/api/v1/namespaces/${namespace}/pods?${queryParams.toString()}`,
          { method: 'GET' }
        );
        const pod = (response as any)?.items?.[0];
        if (pod) {
          setPodName(pod.metadata.name);
        }
      } catch (error) {
        console.log('Failed to fetch pod info:', error);
      }
    };

    fetchPodInfo();
  }, [name, namespace]);

  // Fetch guest agent info
  useEffect(() => {
    if (!name || !namespace) return;

    const fetchGuestInfo = async () => {
      try {
        const guestResponse = await ApiProxy.request(
          `/apis/subresources.kubevirt.io/v1/namespaces/${namespace}/virtualmachineinstances/${name}/guestosinfo`,
          { method: 'GET' }
        );
        setGuestInfo(guestResponse);
      } catch (error) {
        console.log('Guest agent info not available:', error);
        setGuestInfo(null);
      }

      try {
        const fsResponse = await ApiProxy.request(
          `/apis/subresources.kubevirt.io/v1/namespaces/${namespace}/virtualmachineinstances/${name}/filesystemlist`,
          { method: 'GET' }
        );
        setFilesystemInfo(fsResponse);
      } catch (error) {
        console.log('Filesystem info not available:', error);
        setFilesystemInfo(null);
      }
    };

    fetchGuestInfo();
    const interval = setInterval(fetchGuestInfo, 30000);
    return () => clearInterval(interval);
  }, [name, namespace]);

  // Extract hardware info from VMI spec and status
  const getHardwareInfo = (item: VirtualMachineInstance) => {
    const spec = item.spec;
    const status = item.status;
    const domain = spec?.domain;

    // CPU
    const cpuCores = domain?.cpu?.cores || 1;
    const cpuSockets = domain?.cpu?.sockets || 1;
    const cpuThreads = domain?.cpu?.threads || 1;
    const totalCPUs = cpuCores * cpuSockets * cpuThreads;
    const cpuModel = domain?.cpu?.model || 'host-model';

    // Memory
    const memorySpec = domain?.resources?.requests?.memory ||
                       domain?.memory?.guest ||
                       'Unknown';
    const memoryDomainStats = status?.memory;

    // Disks
    const disks = domain?.devices?.disks || [];
    const volumes = spec?.volumes || [];
    const filesystems = filesystemInfo?.items || [];

    // Network interfaces
    const interfaces = domain?.devices?.interfaces || [];
    const networks = spec?.networks || [];
    const vmiInterfaces = status?.interfaces || [];

    return {
      cpu: {
        cores: cpuCores,
        sockets: cpuSockets,
        threads: cpuThreads,
        total: totalCPUs,
        model: cpuModel,
      },
      memory: {
        allocated: memorySpec,
        totalBytes: memoryDomainStats?.totalBytes,
        usedBytes: memoryDomainStats?.usedBytes,
        availableBytes: memoryDomainStats?.availableBytes,
      },
      disks: disks.map((disk: any) => {
        const volume = volumes.find((v: any) => v.name === disk.name);
        let fsInfo = null;
        if (filesystems.length > 0) {
          fsInfo = filesystems.find((fs: any) =>
            fs.diskName === disk.name ||
            (disk.name === 'rootdisk' && fs.mountPoint === '/')
          );
        }
        return {
          name: disk.name,
          type: disk.disk ? 'disk' : disk.cdrom ? 'cdrom' : 'unknown',
          bus: disk.disk?.bus || disk.cdrom?.bus || 'virtio',
          bootOrder: disk.bootOrder,
          volume: volume,
          filesystem: fsInfo,
        };
      }),
      filesystems: filesystems,
      networks: interfaces.map((iface: any) => {
        const network = networks.find((n: any) => n.name === iface.name);
        const runtimeInfo = vmiInterfaces.find((vi: any) => vi.name === iface.name);

        const allIPs = runtimeInfo?.ipAddresses || [];
        const ipv4Addresses = allIPs.filter((ip: string) => ip && !ip.includes(':'));
        const ipv6Addresses = allIPs.filter((ip: string) => ip && ip.includes(':'));

        if (allIPs.length === 0 && runtimeInfo?.ipAddress) {
          if (runtimeInfo.ipAddress.includes(':')) {
            ipv6Addresses.push(runtimeInfo.ipAddress);
          } else {
            ipv4Addresses.push(runtimeInfo.ipAddress);
          }
        }

        return {
          name: iface.name,
          type: iface.masquerade ? 'masquerade' :
                iface.bridge ? 'bridge' :
                iface.sriov ? 'sriov' : 'unknown',
          model: iface.model || 'virtio',
          macAddress: runtimeInfo?.mac || iface.macAddress,
          network: network,
          ipv4: ipv4Addresses,
          ipv6: ipv6Addresses,
          interfaceName: runtimeInfo?.interfaceName,
        };
      }),
      guestOSInfo: status?.guestOSInfo || guestInfo,
    };
  };

  return (
    <>
      {vmiItem && showTerminal && (
        <Terminal
          open
          item={vmiItem}
          onClose={() => setShowTerminal(false)}
        />
      )}
      {vmiItem && showVnc && (
        <VncConsole
          open
          item={vmiItem}
          onClose={() => setShowVnc(false)}
        />
      )}
      {vmiItem && showSsh && (
        <SshConsole
          open
          item={vmiItem}
          onClose={() => setShowSsh(false)}
        />
      )}
      <Resource.DetailsGrid
        name={name}
        namespace={namespace}
        resourceType={VirtualMachineInstance}
        withEvents
        extraInfo={item => {
          if (item && item !== vmiItem) {
            setTimeout(() => setVmiItem(item), 0);
          }

          if (!item) return null;

          const hw = getHardwareInfo(item);
          const osInfo = hw.guestOSInfo;
          const osName = osInfo?.prettyName || osInfo?.name || osInfo?.id || '';
          const osVersion = osInfo?.version || osInfo?.versionId || '';
          const osKernel = osInfo?.kernelVersion || osInfo?.kernelRelease || '';

          return [
            {
              name: t('Phase'),
              value: (
                <Chip
                  label={item.status?.phase || 'Unknown'}
                  color={getPhaseColor(item.status?.phase || 'Unknown')}
                  variant="outlined"
                  size="small"
                />
              ),
            },
            {
              name: t('Operating System'),
              value: osName ? (
                <Box>
                  <Typography variant="body2">{osName}</Typography>
                  {(osVersion || osKernel) && (
                    <Typography variant="caption" color="text.secondary">
                      {osVersion && `v${osVersion}`}
                      {osVersion && osKernel && ' • '}
                      {osKernel && `Kernel ${osKernel}`}
                    </Typography>
                  )}
                </Box>
              ) : (
                <Typography variant="caption" color="text.secondary">
                  Requires guest agent
                </Typography>
              ),
            },
            {
              name: t('CPU'),
              value: (
                <Box>
                  <Typography variant="body2">
                    {hw.cpu.total} vCPU{hw.cpu.total > 1 ? 's' : ''}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {hw.cpu.sockets} socket(s) × {hw.cpu.cores} core(s) × {hw.cpu.threads} thread(s)
                  </Typography>
                </Box>
              ),
            },
            {
              name: t('Memory'),
              value: (
                <Box>
                  <Typography variant="body2">
                    {formatBytes(hw.memory.allocated)}
                  </Typography>
                  {hw.memory.usedBytes && hw.memory.totalBytes && (
                    <Typography variant="caption" color="text.secondary">
                      {formatBytes(hw.memory.usedBytes)} used / {formatBytes(hw.memory.totalBytes)} total
                    </Typography>
                  )}
                </Box>
              ),
            },
            {
              name: t('Disks'),
              value: `${hw.disks.length} disk(s)`,
            },
            {
              name: t('Network'),
              value: `${hw.networks.length} interface(s)`,
            },
            {
              name: 'VirtualMachine',
              value: (
                <Link
                  routeName="virtualmachine"
                  params={{ name: item.getName(), namespace: item.getNamespace() }}
                >
                  {item.getName()}
                </Link>
              ),
            },
            {
              name: 'Pod',
              value:
                podName ? (
                  <Link
                    routeName="pod"
                    params={{ name: podName, namespace: item.getNamespace() }}
                  >
                    {podName}
                  </Link>
                ) : (
                  <Typography variant="caption" color="text.secondary">-</Typography>
                ),
            },
            {
              name: 'Node',
              value:
                item.status?.nodeName ? (
                  <Link routeName="node" params={{ name: item.status.nodeName }}>
                    {item.status.nodeName}
                  </Link>
                ) : (
                  <Typography variant="caption" color="text.secondary">-</Typography>
                ),
            },
          ];
        }}
        extraSections={item => {
          if (!item) return null;

          const hw = getHardwareInfo(item);

          return [
            {
              id: 'hardware',
              section: (
                <SectionBox title={t('Hardware Configuration')}>
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    {/* CPU Section */}
                    <Box>
                      <Typography variant="subtitle2" gutterBottom>
                        CPU Configuration
                      </Typography>
                      <TableContainer component={Paper} variant="outlined">
                        <Table size="small">
                          <TableBody>
                            <TableRow>
                              <TableCell sx={{ fontWeight: 'bold', width: '30%' }}>Allocated vCPUs</TableCell>
                              <TableCell>{hw.cpu.total}</TableCell>
                            </TableRow>
                            <TableRow>
                              <TableCell sx={{ fontWeight: 'bold' }}>Topology</TableCell>
                              <TableCell>
                                {hw.cpu.sockets} socket(s) × {hw.cpu.cores} core(s) × {hw.cpu.threads} thread(s)
                              </TableCell>
                            </TableRow>
                            <TableRow>
                              <TableCell sx={{ fontWeight: 'bold' }}>Model</TableCell>
                              <TableCell>{hw.cpu.model}</TableCell>
                            </TableRow>
                          </TableBody>
                        </Table>
                      </TableContainer>
                      <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                        Note: Real-time CPU usage requires metrics-server or Prometheus integration
                      </Typography>
                    </Box>

                    {/* Memory Section */}
                    <Box>
                      <Typography variant="subtitle2" gutterBottom>
                        Memory
                      </Typography>
                      <TableContainer component={Paper} variant="outlined">
                        <Table size="small">
                          <TableBody>
                            <TableRow>
                              <TableCell sx={{ fontWeight: 'bold', width: '30%' }}>Allocated</TableCell>
                              <TableCell>{formatBytes(hw.memory.allocated)}</TableCell>
                            </TableRow>
                            {hw.memory.totalBytes && (
                              <TableRow>
                                <TableCell sx={{ fontWeight: 'bold' }}>Total (Guest)</TableCell>
                                <TableCell>{formatBytes(hw.memory.totalBytes)}</TableCell>
                              </TableRow>
                            )}
                            {hw.memory.usedBytes !== undefined && hw.memory.totalBytes && (
                              <TableRow>
                                <TableCell sx={{ fontWeight: 'bold' }}>Used</TableCell>
                                <TableCell>
                                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                                    <span>{formatBytes(hw.memory.usedBytes)}</span>
                                    <UsageBar
                                      used={hw.memory.usedBytes}
                                      total={hw.memory.totalBytes}
                                      label={`${formatBytes(hw.memory.usedBytes)} used of ${formatBytes(hw.memory.totalBytes)}`}
                                    />
                                  </Box>
                                </TableCell>
                              </TableRow>
                            )}
                            {hw.memory.availableBytes !== undefined && (
                              <TableRow>
                                <TableCell sx={{ fontWeight: 'bold' }}>Available</TableCell>
                                <TableCell>{formatBytes(hw.memory.availableBytes)}</TableCell>
                              </TableRow>
                            )}
                          </TableBody>
                        </Table>
                      </TableContainer>
                      {!hw.memory.totalBytes && (
                        <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                          Memory usage requires qemu-guest-agent running in the VM
                        </Typography>
                      )}
                    </Box>

                    {/* Network Section */}
                    <Box>
                      <Typography variant="subtitle2" gutterBottom>
                        Network Interfaces ({hw.networks.length})
                      </Typography>
                      <TableContainer component={Paper} variant="outlined">
                        <Table size="small">
                          <TableHead>
                            <TableRow>
                              <TableCell sx={{ fontWeight: 'bold' }}>Name</TableCell>
                              <TableCell sx={{ fontWeight: 'bold' }}>Type</TableCell>
                              <TableCell sx={{ fontWeight: 'bold' }}>Model</TableCell>
                              <TableCell sx={{ fontWeight: 'bold' }}>MAC Address</TableCell>
                              <TableCell sx={{ fontWeight: 'bold' }}>IPv4</TableCell>
                              <TableCell sx={{ fontWeight: 'bold' }}>IPv6</TableCell>
                              <TableCell sx={{ fontWeight: 'bold' }}>Network</TableCell>
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {hw.networks.map((iface: any, idx: number) => (
                              <TableRow key={idx}>
                                <TableCell>{iface.name}</TableCell>
                                <TableCell>
                                  <Chip label={iface.type} size="small" variant="outlined" />
                                </TableCell>
                                <TableCell>{iface.model}</TableCell>
                                <TableCell>
                                  <code style={{ fontSize: '0.8em' }}>{iface.macAddress || 'auto'}</code>
                                </TableCell>
                                <TableCell>
                                  {iface.ipv4?.length > 0 ? (
                                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                                      {iface.ipv4.map((ip: string, ipIdx: number) => (
                                        <code key={ipIdx} style={{ fontSize: '0.8em' }}>{ip}</code>
                                      ))}
                                    </Box>
                                  ) : (
                                    <Typography variant="caption" color="text.secondary">-</Typography>
                                  )}
                                </TableCell>
                                <TableCell>
                                  {iface.ipv6?.length > 0 ? (
                                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                                      {iface.ipv6.map((ip: string, ipIdx: number) => (
                                        <code key={ipIdx} style={{ fontSize: '0.75em' }}>{ip}</code>
                                      ))}
                                    </Box>
                                  ) : (
                                    <Typography variant="caption" color="text.secondary">-</Typography>
                                  )}
                                </TableCell>
                                <TableCell>
                                  {iface.network?.pod ? (
                                    'Pod Network'
                                  ) : iface.network?.multus?.networkName ? (
                                    (() => {
                                      const networkName = iface.network.multus.networkName;
                                      let nadName = networkName;
                                      let nadNamespace = item.getNamespace();
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
                            ))}
                          </TableBody>
                        </Table>
                      </TableContainer>
                    </Box>
                  </Box>
                </SectionBox>
              ),
            },
            {
              id: 'diskManagement',
              section: (() => {
                const phase = item.status?.phase || '';
                const conditions = item.status?.conditions || [];
                const isPaused = conditions.some((c: any) => c.type === 'Paused' && c.status === 'True');
                const isRunning = phase === 'Running' && !isPaused;
                return (
                  <DiskManagement
                    vmi={item}
                    namespace={item.getNamespace()}
                    isRunning={isRunning}
                    filesystemInfo={filesystemInfo}
                    showRecommendations={false}
                  />
                );
              })(),
            },
            {
              id: 'accessCredentials',
              section: (() => {
                const accessCredentials = item.spec?.accessCredentials || [];

                if (accessCredentials.length === 0) return null;

                return (
                  <SectionBox title={t('Access Credentials')}>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      {accessCredentials.map((cred: any, idx: number) => {
                        // User Password Credential
                        if (cred.userPassword) {
                          const propagation = cred.userPassword.propagationMethod;
                          const source = cred.userPassword.source;
                          return (
                            <Paper key={idx} variant="outlined" sx={{ p: 2 }}>
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                                <Chip label="User Password" size="small" color="warning" />
                              </Box>
                              <TableContainer>
                                <Table size="small">
                                  <TableBody>
                                    <TableRow>
                                      <TableCell sx={{ fontWeight: 'bold', width: '30%' }}>Propagation Method</TableCell>
                                      <TableCell>
                                        {propagation?.qemuGuestAgent && (
                                          <Chip label="QEMU Guest Agent" size="small" variant="outlined" color="info" />
                                        )}
                                        {propagation?.noCloud && (
                                          <Chip label="NoCloud" size="small" variant="outlined" color="info" />
                                        )}
                                      </TableCell>
                                    </TableRow>
                                    <TableRow>
                                      <TableCell sx={{ fontWeight: 'bold' }}>Secret</TableCell>
                                      <TableCell>
                                        {source?.secret?.secretName ? (
                                          <Link
                                            routeName="secret"
                                            params={{
                                              name: source.secret.secretName,
                                              namespace: item.getNamespace(),
                                            }}
                                          >
                                            {source.secret.secretName}
                                          </Link>
                                        ) : (
                                          '-'
                                        )}
                                      </TableCell>
                                    </TableRow>
                                  </TableBody>
                                </Table>
                              </TableContainer>
                            </Paper>
                          );
                        }

                        // SSH Public Key Credential
                        if (cred.sshPublicKey) {
                          const propagation = cred.sshPublicKey.propagationMethod;
                          const source = cred.sshPublicKey.source;
                          const users = propagation?.qemuGuestAgent?.users || [];
                          return (
                            <Paper key={idx} variant="outlined" sx={{ p: 2 }}>
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                                <Chip label="SSH Public Key" size="small" color="success" />
                              </Box>
                              <TableContainer>
                                <Table size="small">
                                  <TableBody>
                                    <TableRow>
                                      <TableCell sx={{ fontWeight: 'bold', width: '30%' }}>Propagation Method</TableCell>
                                      <TableCell>
                                        {propagation?.qemuGuestAgent && (
                                          <Chip label="QEMU Guest Agent" size="small" variant="outlined" color="info" />
                                        )}
                                        {propagation?.noCloud && (
                                          <Chip label="NoCloud" size="small" variant="outlined" color="info" />
                                        )}
                                        {propagation?.configDrive && (
                                          <Chip label="Config Drive" size="small" variant="outlined" color="info" />
                                        )}
                                      </TableCell>
                                    </TableRow>
                                    {users.length > 0 && (
                                      <TableRow>
                                        <TableCell sx={{ fontWeight: 'bold' }}>Target Users</TableCell>
                                        <TableCell>
                                          <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                                            {users.map((user: string, userIdx: number) => (
                                              <Chip
                                                key={userIdx}
                                                label={user}
                                                size="small"
                                                variant="outlined"
                                              />
                                            ))}
                                          </Box>
                                        </TableCell>
                                      </TableRow>
                                    )}
                                    <TableRow>
                                      <TableCell sx={{ fontWeight: 'bold' }}>Secret</TableCell>
                                      <TableCell>
                                        {source?.secret?.secretName ? (
                                          <Link
                                            routeName="secret"
                                            params={{
                                              name: source.secret.secretName,
                                              namespace: item.getNamespace(),
                                            }}
                                          >
                                            {source.secret.secretName}
                                          </Link>
                                        ) : (
                                          '-'
                                        )}
                                      </TableCell>
                                    </TableRow>
                                  </TableBody>
                                </Table>
                              </TableContainer>
                            </Paper>
                          );
                        }

                        return null;
                      })}
                      <Typography variant="caption" color="text.secondary">
                        Access credentials are injected into the VM via the specified propagation method.
                        QEMU Guest Agent requires the guest agent to be running inside the VM.
                      </Typography>
                    </Box>
                  </SectionBox>
                );
              })(),
            },
            {
              id: 'affinity',
              section: (
                <SchedulingAffinity
                  vmi={item}
                  namespace={item.getNamespace()}
                />
              ),
            },
            {
              id: 'portForwarding',
              section: (
                <PortForwardingSection
                  vmiName={item.getName()}
                  namespace={item.getNamespace()}
                />
              ),
            },
            {
              id: 'backups',
              section: (
                <BackupSection
                  vmName={item.getName()}
                  namespace={item.getNamespace()}
                />
              ),
            },
            {
              id: 'conditions',
              section: <Resource.ConditionsSection resource={item?.jsonData} />,
            },
          ].filter(s => s.section !== null);
        }}
        actions={item => {
          if (!item) return [];

          const phase = item.status?.phase || '';
          const conditions = item.status?.conditions || [];
          const isPaused = conditions.some((c: any) => c.type === 'Paused' && c.status === 'True');
          const isRunning = phase === 'Running' && !isPaused;

          const actionsList = [];

          // Pause button - when running
          if (isRunning) {
            actionsList.push({
              id: 'pause',
              action: (
                <ActionButton
                  description={t('Pause')}
                  icon="mdi:pause"
                  onClick={() => {
                    item
                      .pause()
                      .then(() =>
                        enqueueSnackbar(t('Virtual Machine Instance paused'), { variant: 'success' })
                      )
                      .catch((e: any) => {
                        console.error('Pause failed', e);
                        enqueueSnackbar(t('Failed to pause'), { variant: 'error' });
                      });
                  }}
                />
              ),
            });
          }

          // Unpause button - when paused
          if (isPaused) {
            actionsList.push({
              id: 'unpause',
              action: (
                <ActionButton
                  description={t('Unpause')}
                  icon="mdi:play-pause"
                  onClick={() => {
                    item
                      .unpause()
                      .then(() =>
                        enqueueSnackbar(t('Virtual Machine Instance unpaused'), { variant: 'success' })
                      )
                      .catch((e: any) => {
                        console.error('Unpause failed', e);
                        enqueueSnackbar(t('Failed to unpause'), { variant: 'error' });
                      });
                  }}
                />
              ),
            });
          }

          // Console buttons - when running or paused
          if (isRunning || isPaused) {
            actionsList.push({
              id: 'console',
              action: (
                <ActionButton
                  description={t('Terminal')}
                  aria-label={t('terminal')}
                  icon="mdi:console"
                  onClick={() => setShowTerminal(true)}
                />
              ),
            });

            actionsList.push({
              id: 'vnc',
              action: (
                <ActionButton
                  description={t('VNC Console')}
                  icon="mdi:monitor"
                  onClick={() => setShowVnc(true)}
                />
              ),
            });

            actionsList.push({
              id: 'ssh',
              action: (
                <ActionButton
                  description={t('SSH Connection')}
                  icon="mdi:console-network"
                  onClick={() => setShowSsh(true)}
                />
              ),
            });
          }

          // Metrics button - always available
          actionsList.push({
            id: 'metrics',
            action: (
              <ActionButton
                description={t('View Metrics')}
                icon="mdi:chart-line"
                onClick={() => {
                  window.location.assign(`/kubevirt/monitoring/?namespace=${encodeURIComponent(namespace || '')}&vm=${encodeURIComponent(name || '')}`);
                }}
              />
            ),
          });

          return actionsList;
        }}
      />
    </>
  );
}
