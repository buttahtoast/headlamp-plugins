import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { Link, Resource, SectionBox } from '@kinvolk/headlamp-plugin/lib/components/common';
import { ActionButton } from '@kinvolk/headlamp-plugin/lib/components/common';
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
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
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import LiveMigrationDialog from '../components/LiveMigrationDialog';
import SchedulingAffinity from '../components/SchedulingAffinity';
import SshConsole from '../SshConsole/SshConsole';
import Terminal from '../Terminal/Terminal';
import VncConsole from '../VncConsole/VncConsole';
import { formatBytes, parseK8sSize } from '../utils/kubeVirtCheck';
import VirtualMachine from './VirtualMachine';
import BackupSection from '../components/BackupSection';
import DiskManagement from '../components/DiskManagement';

// Port presets for port forwarding
const PORT_PRESETS = [
  { name: 'SSH', port: 22, protocol: 'TCP' },
  { name: 'RDP', port: 3389, protocol: 'TCP' },
  { name: 'HTTP', port: 80, protocol: 'TCP' },
  { name: 'HTTPS', port: 443, protocol: 'TCP' },
  { name: 'VNC', port: 5900, protocol: 'TCP' },
];

// Port Forwarding Section for VM Details
interface PortForwardingSectionProps {
  vmName: string;
  namespace: string;
}

function PortForwardingSection({ vmName, namespace }: PortForwardingSectionProps) {
  const { t } = useTranslation('glossary');
  const { enqueueSnackbar } = useSnackbar();
  const [services, setServices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [portName, setPortName] = useState('');
  const [targetPort, setTargetPort] = useState(22);
  const [serviceType, setServiceType] = useState('LoadBalancer');
  const [protocol, setProtocol] = useState('TCP');

  // Fetch existing services for this VM
  useEffect(() => {
    const fetchServices = async () => {
      try {
        const response = await ApiProxy.request(`/api/v1/namespaces/${namespace}/services`) as { items: any[] };
        const vmServices = response.items?.filter(svc =>
          svc.spec?.selector?.['vm.kubevirt.io/name'] === vmName ||
          svc.metadata?.labels?.['kubevirt.io/vm'] === vmName
        ) || [];
        setServices(vmServices);
        setLoading(false);
      } catch (error) {
        console.error('Failed to fetch services:', error);
        setLoading(false);
      }
    };

    fetchServices();
    const interval = setInterval(fetchServices, 10000);
    return () => clearInterval(interval);
  }, [vmName, namespace]);

  const handleCreatePortForward = async () => {
    if (!portName || !targetPort) {
      enqueueSnackbar('Please fill all required fields', { variant: 'warning' });
      return;
    }

    const serviceName = `${vmName}-${portName.toLowerCase()}-${targetPort}`;
    const service = {
      apiVersion: 'v1',
      kind: 'Service',
      metadata: {
        name: serviceName,
        namespace: namespace,
        labels: {
          'kubevirt.io/vm': vmName,
          'app': `vm-${vmName}`,
        },
      },
      spec: {
        type: serviceType,
        selector: {
          'vm.kubevirt.io/name': vmName,
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
      const vmServices = response.items?.filter(svc =>
        svc.spec?.selector?.['vm.kubevirt.io/name'] === vmName ||
        svc.metadata?.labels?.['kubevirt.io/vm'] === vmName
      ) || [];
      setServices(vmServices);
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
          Expose VM ports via Kubernetes Services
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
            No port forwards configured for this VM
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

export interface VirtualMachineDetailsProps {
  showLogsDefault?: boolean;
  name?: string;
  namespace?: string;
}

// Alias for backward compatibility
function parseK8sMemoryToBytes(memory: string | undefined): number {
  return parseK8sSize(memory) || 0;
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

export default function VirtualMachineDetails(props: VirtualMachineDetailsProps) {
  const params = useParams<{ namespace: string; name: string }>();
  const { name = params.name, namespace = params.namespace } = props;
  const { t } = useTranslation('glossary');
  const { enqueueSnackbar } = useSnackbar();
  const [showTerminal, setShowTerminal] = useState(false);
  const [showVnc, setShowVnc] = useState(false);
  const [showSsh, setShowSsh] = useState(false);
  const [vmItem, setVmItem] = useState<VirtualMachine | null>(null);
  const [snapshotDialog, setSnapshotDialog] = useState(false);
  const [snapshotName, setSnapshotName] = useState('');
  const [migrationDialogOpen, setMigrationDialogOpen] = useState(false);

  const [podName, setPodName] = useState<string | null>(null);
  const [nodeName, setNodeName] = useState<string | null>(null);
  const [vmiStatus, setVmiStatus] = useState<any>(null);
  const [guestInfo, setGuestInfo] = useState<any>(null);
  const [filesystemInfo, setFilesystemInfo] = useState<any>(null);

  // Fetch VMI status for runtime info (IPs, etc.)
  useEffect(() => {
    if (!name || !namespace) return;

    const fetchVmiStatus = async () => {
      try {
        const response = await ApiProxy.request(
          `/apis/kubevirt.io/v1/namespaces/${namespace}/virtualmachineinstances/${name}`,
          { method: 'GET' }
        );
        setVmiStatus((response as any)?.status || null);
      } catch (error) {
        console.log('VMI not found or not running:', error);
        setVmiStatus(null);
      }
    };

    fetchVmiStatus();

    // Watch for VMI changes
    const url = `/apis/kubevirt.io/v1/namespaces/${namespace}/virtualmachineinstances?fieldSelector=metadata.name=${name}&watch=true`;
    const { cancel } = ApiProxy.stream(url, (result: any, disconnect: () => void, error: any) => {
      if (error) {
        console.log('VMI watch error:', error);
        return;
      }
      if (result?.type === 'ADDED' || result?.type === 'MODIFIED') {
        setVmiStatus(result.object?.status || null);
      } else if (result?.type === 'DELETED') {
        setVmiStatus(null);
      }
    }, { isJson: true });

    return () => cancel();
  }, [name, namespace]);

  // Fetch guest agent info (filesystem, etc.) - requires qemu-guest-agent running in VM
  useEffect(() => {
    if (!name || !namespace || !vmiStatus) return;

    const fetchGuestInfo = async () => {
      try {
        // Fetch guest OS info
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
        // Fetch filesystem info
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

    // Refresh guest info periodically (every 30 seconds)
    const interval = setInterval(fetchGuestInfo, 30000);
    return () => clearInterval(interval);
  }, [name, namespace, vmiStatus]);

  useEffect(() => {
    const fetchInitial = async () => {
      try {
        const info = await getPodInfo(name, namespace);
        setPodName(info.podName);
        setNodeName(info.nodeName);
      } catch (error) {
        console.error('Failed to get pod info', error);
      }
    };

    fetchInitial();

    const queryParams = new URLSearchParams();
    queryParams.append('labelSelector', `vm.kubevirt.io/name=${name}`);
    queryParams.append('watch', 'true');
    const url = `/api/v1/namespaces/${namespace}/pods?${queryParams.toString()}`;

    const onStream = (result: any, disconnect: () => void, error: any) => {
      if (error) {
        console.error('Stream error:', error);
        disconnect();
        return;
      }

      const event = result;
      if (event.type === 'ADDED' || event.type === 'MODIFIED') {
        const pod = event.object;
        setPodName(pod.metadata.name);
        setNodeName(pod.spec.nodeName || 'Unknown');
      } else if (event.type === 'DELETED') {
        setPodName('Unknown');
        setNodeName('Unknown');
      }
    };

    const { cancel: cancelPod } = ApiProxy.stream(url, onStream, { isJson: true });
    return () => {
      cancelPod();
    };
  }, [name, namespace]);

  // Create snapshot handler
  const handleCreateSnapshot = async () => {
    if (!name || !namespace || !snapshotName) return;

    try {
      const snapshot = {
        apiVersion: 'snapshot.kubevirt.io/v1beta1',
        kind: 'VirtualMachineSnapshot',
        metadata: {
          name: snapshotName,
          namespace: namespace,
        },
        spec: {
          source: {
            apiGroup: 'kubevirt.io',
            kind: 'VirtualMachine',
            name: name,
          },
        },
      };

      await ApiProxy.request(
        `/apis/snapshot.kubevirt.io/v1beta1/namespaces/${namespace}/virtualmachinesnapshots`,
        {
          method: 'POST',
          body: JSON.stringify(snapshot),
          headers: { 'Content-Type': 'application/json' },
        }
      );

      enqueueSnackbar(t('Snapshot created successfully'), { variant: 'success' });
      setSnapshotDialog(false);
      setSnapshotName('');
    } catch (err: any) {
      enqueueSnackbar(`${t('Failed to create snapshot')}: ${err.message}`, { variant: 'error' });
    }
  };

  // Extract hardware info from VM spec and VMI status
  const getHardwareInfo = (item: VirtualMachine, vmiStatusData: any, guestData: any, fsData: any) => {
    const spec = item.jsonData?.spec?.template?.spec;
    const domain = spec?.domain;

    // CPU
    const cpuCores = domain?.cpu?.cores || 1;
    const cpuSockets = domain?.cpu?.sockets || 1;
    const cpuThreads = domain?.cpu?.threads || 1;
    const totalCPUs = cpuCores * cpuSockets * cpuThreads;
    const cpuModel = domain?.cpu?.model || 'host-model';

    // Memory - allocated from spec
    const memorySpec = domain?.resources?.requests?.memory ||
                       domain?.memory?.guest ||
                       'Unknown';
    const allocatedMemoryBytes = parseK8sMemoryToBytes(memorySpec);

    // Memory usage from VMI status (if available from guest agent)
    const memoryDomainStats = vmiStatusData?.memory;

    // Disks
    const disks = domain?.devices?.disks || [];
    const volumes = spec?.volumes || [];

    // Filesystem info from guest agent
    const filesystems = fsData?.items || [];

    // Network interfaces from spec
    const interfaces = domain?.devices?.interfaces || [];
    const networks = spec?.networks || [];

    // Runtime interface info from VMI status
    const vmiInterfaces = vmiStatusData?.interfaces || [];

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
        allocatedBytes: allocatedMemoryBytes,
        // Guest agent memory info (if available)
        totalBytes: memoryDomainStats?.totalBytes,
        usedBytes: memoryDomainStats?.usedBytes,
        availableBytes: memoryDomainStats?.availableBytes,
      },
      disks: disks.map((disk: any) => {
        const volume = volumes.find((v: any) => v.name === disk.name);

        // Try to find matching filesystem from guest agent
        // Match by disk name or device name patterns
        let fsInfo = null;
        if (filesystems.length > 0) {
          // Try to find by disk name or common mount point patterns
          fsInfo = filesystems.find((fs: any) =>
            fs.diskName === disk.name ||
            (disk.name === 'rootdisk' && fs.mountPoint === '/') ||
            (disk.name === 'cloudinitdisk' && fs.mountPoint?.includes('cloud'))
          );
        }

        return {
          name: disk.name,
          type: disk.disk ? 'disk' : disk.cdrom ? 'cdrom' : 'unknown',
          bus: disk.disk?.bus || disk.cdrom?.bus || 'virtio',
          bootOrder: disk.bootOrder,
          volume: volume,
          // Filesystem info from guest agent
          filesystem: fsInfo,
        };
      }),
      // All filesystems from guest agent
      filesystems: filesystems,
      networks: interfaces.map((iface: any) => {
        const network = networks.find((n: any) => n.name === iface.name);
        // Find runtime info from VMI status
        const runtimeInfo = vmiInterfaces.find((vi: any) => vi.name === iface.name);

        // Extract IPv4 and IPv6 addresses
        const allIPs = runtimeInfo?.ipAddresses || [];
        const ipv4Addresses = allIPs.filter((ip: string) => ip && !ip.includes(':'));
        const ipv6Addresses = allIPs.filter((ip: string) => ip && ip.includes(':'));

        // Fallback to single ipAddress field if ipAddresses not available
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
          queueCount: runtimeInfo?.queueCount,
        };
      }),
      // Add guest OS info if available
      guestOSInfo: vmiStatusData?.guestOSInfo || guestData,
    };
  };

  return (
    <>
      {vmItem && showTerminal && (
        <Terminal
          open
          item={vmItem}
          onClose={() => setShowTerminal(false)}
        />
      )}
      {vmItem && showVnc && (
        <VncConsole
          open
          item={vmItem}
          onClose={() => setShowVnc(false)}
        />
      )}
      {vmItem && showSsh && (
        <SshConsole
          open
          item={vmItem}
          vmSpec={vmItem.jsonData}
          onClose={() => setShowSsh(false)}
        />
      )}
      {vmItem && (
        <LiveMigrationDialog
          open={migrationDialogOpen}
          onClose={() => setMigrationDialogOpen(false)}
          vmName={vmItem.getName()}
          vmiName={vmItem.getName()}
          namespace={vmItem.getNamespace()}
          currentNode={nodeName || undefined}
        />
      )}
      <Resource.DetailsGrid
        name={name}
        namespace={namespace}
        resourceType={VirtualMachine}
        withEvents
        extraInfo={item => {
          // Capture item for dialogs
          if (item && item !== vmItem) {
            setTimeout(() => setVmItem(item), 0);
          }

          if (!item) return null;

          const hw = getHardwareInfo(item, vmiStatus, guestInfo, filesystemInfo);

          // Get OS info from guest agent
          const osInfo = hw.guestOSInfo;
          const osName = osInfo?.prettyName || osInfo?.name || osInfo?.id || '';
          const osVersion = osInfo?.version || osInfo?.versionId || '';
          const osKernel = osInfo?.kernelVersion || osInfo?.kernelRelease || '';

          return [
            {
              name: t('Status'),
              value: (
                <Chip
                  label={item?.jsonData.status?.printableStatus || 'Unknown'}
                  color={getStatusColor(item?.jsonData.status?.printableStatus || 'Unknown')}
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
              name: 'VirtualMachineInstance',
              value: (
                <Link
                  routeName="virtualmachineinstance"
                  params={{ name: item.getName(), namespace: item.getNamespace() }}
                >
                  {item.getName()}
                </Link>
              ),
            },
            {
              name: 'Pod',
              value:
                podName && podName !== 'Unknown' ? (
                  <Link
                    routeName="pod"
                    params={{
                      name: podName,
                      namespace: item.getNamespace(),
                    }}
                  >
                    {podName}
                  </Link>
                ) : (
                  'Unknown'
                ),
            },
            {
              name: 'Node',
              value:
                nodeName && nodeName !== 'Unknown' ? (
                  <Link routeName="node" params={{ name: nodeName }}>
                    {nodeName}
                  </Link>
                ) : (
                  'Unknown'
                ),
            },
          ];
        }}
        extraSections={item => {
          if (!item) return null;

          const hw = getHardwareInfo(item, vmiStatus, guestInfo, filesystemInfo);

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
                                  <Chip
                                    label={iface.type}
                                    size="small"
                                    variant="outlined"
                                  />
                                </TableCell>
                                <TableCell>{iface.model}</TableCell>
                                <TableCell>
                                  <code style={{ fontSize: '0.8em' }}>
                                    {iface.macAddress || 'auto'}
                                  </code>
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
                                      // Network name can be "name" or "namespace/name"
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
                const printableStatus = item.jsonData.status?.printableStatus || '';
                const isRunning = printableStatus === 'Running';
                return (
                  <DiskManagement
                    vm={item}
                    namespace={item.getNamespace()}
                    isRunning={isRunning}
                  />
                );
              })(),
            },
            {
              id: 'accessCredentials',
              section: (() => {
                const spec = item.jsonData?.spec?.template?.spec;
                const accessCredentials = spec?.accessCredentials || [];

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
                  vm={item}
                  namespace={item.getNamespace()}
                />
              ),
            },
            {
              id: 'portForwarding',
              section: (
                <PortForwardingSection
                  vmName={item.getName()}
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
          const printableStatus = item.jsonData.status?.printableStatus || '';
          const conditions = item.jsonData.status?.conditions || [];
          const isPaused =
            conditions.some((c: any) => c.type === 'Paused' && c.status === 'True') ||
            printableStatus === 'Paused';
          const isRunning = printableStatus === 'Running' && !isPaused;
          const isStopped = printableStatus === 'Stopped' || printableStatus === '';

          const actionsList = [];

          // Start button - only when stopped
          if (isStopped || (!isRunning && !isPaused)) {
            actionsList.push({
              id: 'start',
              action: (
                <ActionButton
                  description={t('Start')}
                  icon="mdi:play"
                  onClick={() => {
                    item
                      .start()
                      .then(() =>
                        enqueueSnackbar(t('Virtual Machine starting...'), { variant: 'success' })
                      )
                      .catch((e: any) => {
                        console.error('Start failed', e);
                        enqueueSnackbar(t('Failed to start Virtual Machine'), { variant: 'error' });
                      });
                  }}
                />
              ),
            });
          }

          // Stop button - when running or paused
          if (isRunning || isPaused) {
            actionsList.push({
              id: 'stop',
              action: (
                <ActionButton
                  description={t('Stop')}
                  icon="mdi:stop"
                  onClick={() => {
                    item
                      .stop()
                      .then(() =>
                        enqueueSnackbar(t('Virtual Machine stopping...'), { variant: 'success' })
                      )
                      .catch((e: any) => {
                        console.error('Stop failed', e);
                        enqueueSnackbar(t('Failed to stop Virtual Machine'), { variant: 'error' });
                      });
                  }}
                />
              ),
            });
          }

          // Restart button - when running
          if (isRunning) {
            actionsList.push({
              id: 'restart',
              action: (
                <ActionButton
                  description={t('Restart')}
                  icon="mdi:restart"
                  onClick={async () => {
                    try {
                      enqueueSnackbar(t('Restarting Virtual Machine...'), { variant: 'info' });
                      await item.stop();
                      // Wait a moment before starting again
                      setTimeout(async () => {
                        try {
                          await item.start();
                          enqueueSnackbar(t('Virtual Machine restarting...'), { variant: 'success' });
                        } catch (e: any) {
                          console.error('Start after restart failed', e);
                          enqueueSnackbar(t('Failed to restart Virtual Machine'), { variant: 'error' });
                        }
                      }, 2000);
                    } catch (e: any) {
                      console.error('Restart failed', e);
                      enqueueSnackbar(t('Failed to restart Virtual Machine'), { variant: 'error' });
                    }
                  }}
                />
              ),
            });
          }

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
                        enqueueSnackbar(t('Virtual Machine paused'), { variant: 'success' })
                      )
                      .catch((e: any) => {
                        console.error('Pause failed', e);
                        const errorMessage = e.message
                          ? `${t('Failed to pause Virtual Machine')}: ${e.message}`
                          : t('Failed to pause Virtual Machine');
                        enqueueSnackbar(errorMessage, { variant: 'error' });
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
                        enqueueSnackbar(t('Virtual Machine unpaused'), { variant: 'success' })
                      )
                      .catch((e: any) => {
                        console.error('Unpause failed', e);
                        enqueueSnackbar(t('Failed to unpause Virtual Machine'), { variant: 'error' });
                      });
                  }}
                />
              ),
            });
          }

          // Live Migrate button - when running
          if (isRunning) {
            actionsList.push({
              id: 'migrate',
              action: (
                <ActionButton
                  description={t('Live Migrate')}
                  icon="mdi:swap-horizontal"
                  onClick={() => setMigrationDialogOpen(true)}
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
                  onClick={() => {
                    console.log('Terminal clicked');
                    setShowTerminal(true);
                  }}
                />
              ),
            });

            actionsList.push({
              id: 'vnc',
              action: (
                <ActionButton
                  description={t('VNC Console')}
                  icon="mdi:monitor"
                  onClick={() => {
                    console.log('VNC clicked, vmItem:', vmItem?.getName());
                    setShowVnc(true);
                  }}
                />
              ),
            });

            actionsList.push({
              id: 'ssh',
              action: (
                <ActionButton
                  description={t('SSH Connection')}
                  icon="mdi:console-network"
                  onClick={() => {
                    setShowSsh(true);
                  }}
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

          // Snapshot button - always available
          actionsList.push({
            id: 'snapshot',
            action: (
              <>
                <ActionButton
                  description={t('Create Snapshot')}
                  icon="mdi:camera"
                  onClick={() => {
                    setSnapshotName(`${name}-snapshot-${Date.now()}`);
                    setSnapshotDialog(true);
                  }}
                />
                <Dialog
                  open={snapshotDialog}
                  onClose={() => setSnapshotDialog(false)}
                  maxWidth={false}
                  PaperProps={{
                    sx: {
                      width: '100%',
                      maxWidth: { xs: '95%', sm: 500, md: 600 },
                      m: { xs: 1, sm: 2 },
                    }
                  }}
                >
                  <DialogTitle>{t('Create Snapshot')}</DialogTitle>
                  <DialogContent>
                    <DialogContentText sx={{ mb: 2 }}>
                      Create a snapshot of VM "{name}". This will capture the current state of the VM including its disks.
                    </DialogContentText>
                    <TextField
                      label={t('Snapshot Name')}
                      value={snapshotName}
                      onChange={e => setSnapshotName(e.target.value)}
                      fullWidth
                      required
                    />
                  </DialogContent>
                  <DialogActions>
                    <Button onClick={() => setSnapshotDialog(false)}>{t('Cancel')}</Button>
                    <Button onClick={handleCreateSnapshot} color="primary" variant="contained">
                      {t('Create')}
                    </Button>
                  </DialogActions>
                </Dialog>
              </>
            ),
          });

          return actionsList;
        }}
      />
    </>
  );
}

function getStatusColor(status: string): 'success' | 'error' | 'warning' | 'default' {
  if (status === 'Running') return 'success';
  if (status === 'Failed' || status === 'CrashLoopBackOff' || status === 'ErrorUnschedulable') return 'error';
  if (['Migrating', 'Starting', 'Stopping', 'Paused', 'Scheduling'].includes(status)) return 'warning';
  return 'default';
}

async function getPodInfo(
  name: string | undefined,
  namespace: string | undefined
): Promise<{ podName: string; nodeName: string }> {
  if (!name || !namespace) {
    return { podName: 'Unknown', nodeName: 'Unknown' };
  }

  const request = ApiProxy.request;
  const queryParams = new URLSearchParams();
  queryParams.append('labelSelector', `vm.kubevirt.io/name=${name}`);
  try {
    const response = await request(
      `/api/v1/namespaces/${namespace}/pods?${queryParams.toString()}`,
      {
        method: 'GET',
      }
    );
    const pod = (response as any)?.items?.[0];
    if (pod) {
      return {
        podName: pod.metadata.name,
        nodeName: pod.spec.nodeName || 'Unknown',
      };
    }
    return { podName: 'Unknown', nodeName: 'Unknown' };
  } catch (error) {
    return { podName: 'Unknown', nodeName: 'Unknown' };
  }
}
