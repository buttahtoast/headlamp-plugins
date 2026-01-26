import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { Link, Resource, SectionBox } from '@kinvolk/headlamp-plugin/lib/components/common';
import { ActionButton } from '@kinvolk/headlamp-plugin/lib/components/common';
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  LinearProgress,
  Paper,
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
import { useSnackbar } from 'notistack';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import SshConsole from '../SshConsole/SshConsole';
import Terminal from '../Terminal/Terminal';
import VncConsole from '../VncConsole/VncConsole';
import VirtualMachine from './VirtualMachine';

export interface VirtualMachineDetailsProps {
  showLogsDefault?: boolean;
  name?: string;
  namespace?: string;
}

// Helper to format bytes
function formatBytes(bytes: number | string | undefined, decimals = 1): string {
  if (bytes === undefined || bytes === null) return '-';
  const num = typeof bytes === 'string' ? parseInt(bytes, 10) : bytes;
  if (isNaN(num)) return String(bytes);
  if (num === 0) return '0 B';

  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];
  let unitIndex = 0;
  let value = num;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }

  return `${value.toFixed(decimals)} ${units[unitIndex]}`;
}

// Helper to parse Kubernetes memory format to bytes
function parseK8sMemoryToBytes(memory: string | undefined): number {
  if (!memory) return 0;
  const match = memory.match(/^(\d+(?:\.\d+)?)\s*([KMGTP]i?)?$/i);
  if (!match) return 0;

  const value = parseFloat(match[1]);
  const unit = (match[2] || '').toLowerCase();

  const multipliers: { [key: string]: number } = {
    '': 1,
    'k': 1000,
    'ki': 1024,
    'm': 1000 * 1000,
    'mi': 1024 * 1024,
    'g': 1000 * 1000 * 1000,
    'gi': 1024 * 1024 * 1024,
    't': 1000 * 1000 * 1000 * 1000,
    'ti': 1024 * 1024 * 1024 * 1024,
    'p': 1000 * 1000 * 1000 * 1000 * 1000,
    'pi': 1024 * 1024 * 1024 * 1024 * 1024,
  };

  return value * (multipliers[unit] || 1);
}

// Helper to parse Kubernetes memory format
function parseK8sMemory(memory: string | undefined): string {
  if (!memory) return 'Unknown';
  // Already in readable format like "4Gi", "512Mi"
  return memory;
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
                    {parseK8sMemory(hw.memory.allocated)}
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
                              <TableCell>{parseK8sMemory(hw.memory.allocated)}</TableCell>
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

                    {/* Disks Section */}
                    <Box>
                      <Typography variant="subtitle2" gutterBottom>
                        Disks ({hw.disks.length})
                      </Typography>
                      <TableContainer component={Paper} variant="outlined">
                        <Table size="small">
                          <TableHead>
                            <TableRow>
                              <TableCell sx={{ fontWeight: 'bold' }}>Name</TableCell>
                              <TableCell sx={{ fontWeight: 'bold' }}>Type</TableCell>
                              <TableCell sx={{ fontWeight: 'bold' }}>Bus</TableCell>
                              <TableCell sx={{ fontWeight: 'bold' }}>Boot Order</TableCell>
                              <TableCell sx={{ fontWeight: 'bold' }}>Source</TableCell>
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {hw.disks.map((disk: any, idx: number) => (
                              <TableRow key={idx}>
                                <TableCell>{disk.name}</TableCell>
                                <TableCell>
                                  <Chip
                                    label={disk.type}
                                    size="small"
                                    variant="outlined"
                                    color={disk.type === 'cdrom' ? 'secondary' : 'primary'}
                                  />
                                </TableCell>
                                <TableCell>{disk.bus}</TableCell>
                                <TableCell>{disk.bootOrder || '-'}</TableCell>
                                <TableCell>
                                  {disk.volume?.dataVolume?.name ? (
                                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                                      <Link
                                        routeName="datavolume"
                                        params={{
                                          name: disk.volume.dataVolume.name,
                                          namespace: item.getNamespace(),
                                        }}
                                      >
                                        {disk.volume.dataVolume.name}
                                      </Link>
                                      {disk.volume.dataVolume.hotpluggable && (
                                        <Chip label="hotpluggable" size="small" variant="outlined" color="warning" />
                                      )}
                                    </Box>
                                  ) : disk.volume?.persistentVolumeClaim?.claimName ? (
                                    <Link
                                      routeName="persistentVolumeClaim"
                                      params={{
                                        name: disk.volume.persistentVolumeClaim.claimName,
                                        namespace: item.getNamespace(),
                                      }}
                                    >
                                      {disk.volume.persistentVolumeClaim.claimName}
                                    </Link>
                                  ) : disk.volume?.containerDisk?.image ? (
                                    <Tooltip title={disk.volume.containerDisk.image}>
                                      <Typography variant="body2" sx={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                        {disk.volume.containerDisk.image}
                                      </Typography>
                                    </Tooltip>
                                  ) : disk.volume?.cloudInitConfigDrive ? (
                                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                                      <Chip label="cloud-init (ConfigDrive)" size="small" variant="outlined" color="info" />
                                      {disk.volume.cloudInitConfigDrive.secretRef?.name && (
                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                          <Typography variant="caption" color="text.secondary">Secret:</Typography>
                                          <Link
                                            routeName="secret"
                                            params={{
                                              name: disk.volume.cloudInitConfigDrive.secretRef.name,
                                              namespace: item.getNamespace(),
                                            }}
                                          >
                                            {disk.volume.cloudInitConfigDrive.secretRef.name}
                                          </Link>
                                        </Box>
                                      )}
                                      {disk.volume.cloudInitConfigDrive.networkDataSecretRef?.name && (
                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                          <Typography variant="caption" color="text.secondary">Network:</Typography>
                                          <Link
                                            routeName="secret"
                                            params={{
                                              name: disk.volume.cloudInitConfigDrive.networkDataSecretRef.name,
                                              namespace: item.getNamespace(),
                                            }}
                                          >
                                            {disk.volume.cloudInitConfigDrive.networkDataSecretRef.name}
                                          </Link>
                                        </Box>
                                      )}
                                    </Box>
                                  ) : disk.volume?.cloudInitNoCloud ? (
                                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                                      <Chip label="cloud-init (NoCloud)" size="small" variant="outlined" color="info" />
                                      {disk.volume.cloudInitNoCloud.secretRef?.name && (
                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                          <Typography variant="caption" color="text.secondary">Secret:</Typography>
                                          <Link
                                            routeName="secret"
                                            params={{
                                              name: disk.volume.cloudInitNoCloud.secretRef.name,
                                              namespace: item.getNamespace(),
                                            }}
                                          >
                                            {disk.volume.cloudInitNoCloud.secretRef.name}
                                          </Link>
                                        </Box>
                                      )}
                                      {disk.volume.cloudInitNoCloud.networkDataSecretRef?.name && (
                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                          <Typography variant="caption" color="text.secondary">Network:</Typography>
                                          <Link
                                            routeName="secret"
                                            params={{
                                              name: disk.volume.cloudInitNoCloud.networkDataSecretRef.name,
                                              namespace: item.getNamespace(),
                                            }}
                                          >
                                            {disk.volume.cloudInitNoCloud.networkDataSecretRef.name}
                                          </Link>
                                        </Box>
                                      )}
                                    </Box>
                                  ) : disk.volume?.configMap?.name ? (
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                      <Chip label="ConfigMap" size="small" variant="outlined" />
                                      <Link
                                        routeName="configmap"
                                        params={{
                                          name: disk.volume.configMap.name,
                                          namespace: item.getNamespace(),
                                        }}
                                      >
                                        {disk.volume.configMap.name}
                                      </Link>
                                    </Box>
                                  ) : disk.volume?.secret?.secretName ? (
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                      <Chip label="Secret" size="small" variant="outlined" />
                                      <Link
                                        routeName="secret"
                                        params={{
                                          name: disk.volume.secret.secretName,
                                          namespace: item.getNamespace(),
                                        }}
                                      >
                                        {disk.volume.secret.secretName}
                                      </Link>
                                    </Box>
                                  ) : disk.volume?.serviceAccount?.serviceAccountName ? (
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                      <Chip label="ServiceAccount" size="small" variant="outlined" />
                                      <Link
                                        routeName="serviceaccount"
                                        params={{
                                          name: disk.volume.serviceAccount.serviceAccountName,
                                          namespace: item.getNamespace(),
                                        }}
                                      >
                                        {disk.volume.serviceAccount.serviceAccountName}
                                      </Link>
                                    </Box>
                                  ) : disk.volume?.downwardAPI ? (
                                    <Chip label="DownwardAPI" size="small" variant="outlined" />
                                  ) : disk.volume?.emptyDisk ? (
                                    <Chip label={`EmptyDisk (${disk.volume.emptyDisk.capacity || 'auto'})`} size="small" variant="outlined" />
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

                    {/* Filesystem Usage Section (from guest agent) */}
                    {hw.filesystems && hw.filesystems.length > 0 && (
                      <Box>
                        <Typography variant="subtitle2" gutterBottom>
                          Filesystem Usage (Guest Agent)
                        </Typography>
                        <TableContainer component={Paper} variant="outlined">
                          <Table size="small">
                            <TableHead>
                              <TableRow>
                                <TableCell sx={{ fontWeight: 'bold' }}>Mount Point</TableCell>
                                <TableCell sx={{ fontWeight: 'bold' }}>Filesystem</TableCell>
                                <TableCell sx={{ fontWeight: 'bold' }}>Total</TableCell>
                                <TableCell sx={{ fontWeight: 'bold' }}>Used</TableCell>
                                <TableCell sx={{ fontWeight: 'bold' }}>Available</TableCell>
                                <TableCell sx={{ fontWeight: 'bold', minWidth: 150 }}>Usage</TableCell>
                              </TableRow>
                            </TableHead>
                            <TableBody>
                              {hw.filesystems.map((fs: any, idx: number) => {
                                const totalBytes = fs.totalBytes || 0;
                                const usedBytes = fs.usedBytes || 0;
                                const availableBytes = totalBytes - usedBytes;
                                return (
                                  <TableRow key={idx}>
                                    <TableCell>
                                      <code style={{ fontSize: '0.85em' }}>{fs.mountPoint || '-'}</code>
                                    </TableCell>
                                    <TableCell>{fs.fileSystemType || '-'}</TableCell>
                                    <TableCell>{formatBytes(totalBytes)}</TableCell>
                                    <TableCell>{formatBytes(usedBytes)}</TableCell>
                                    <TableCell>{formatBytes(availableBytes)}</TableCell>
                                    <TableCell>
                                      <UsageBar
                                        used={usedBytes}
                                        total={totalBytes}
                                        label={`${formatBytes(usedBytes)} used of ${formatBytes(totalBytes)}`}
                                      />
                                    </TableCell>
                                  </TableRow>
                                );
                              })}
                            </TableBody>
                          </Table>
                        </TableContainer>
                      </Box>
                    )}

                    {!hw.filesystems?.length && hw.disks.length > 0 && (
                      <Typography variant="caption" color="text.secondary">
                        Disk usage information requires qemu-guest-agent running in the VM
                      </Typography>
                    )}

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
              section: (() => {
                const spec = item.jsonData?.spec?.template?.spec;
                const affinity = spec?.affinity;
                const tolerations = spec?.tolerations || [];
                const nodeSelector = spec?.nodeSelector || {};

                const hasAffinity = affinity?.nodeAffinity || affinity?.podAffinity || affinity?.podAntiAffinity;
                const hasTolerations = tolerations.length > 0;
                const hasNodeSelector = Object.keys(nodeSelector).length > 0;

                if (!hasAffinity && !hasTolerations && !hasNodeSelector) return null;

                return (
                  <SectionBox title={t('Scheduling & Affinity Rules')}>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      {/* Node Selector */}
                      {hasNodeSelector && (
                        <Box>
                          <Typography variant="subtitle2" gutterBottom>
                            Node Selector
                          </Typography>
                          <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                            {Object.entries(nodeSelector).map(([key, value]) => (
                              <Chip
                                key={key}
                                label={`${key}: ${value}`}
                                size="small"
                                variant="outlined"
                                color="primary"
                              />
                            ))}
                          </Box>
                        </Box>
                      )}

                      {/* Node Affinity */}
                      {affinity?.nodeAffinity && (
                        <Box>
                          <Typography variant="subtitle2" gutterBottom>
                            Node Affinity
                          </Typography>
                          <TableContainer component={Paper} variant="outlined">
                            <Table size="small">
                              <TableBody>
                                {affinity.nodeAffinity.requiredDuringSchedulingIgnoredDuringExecution && (
                                  <TableRow>
                                    <TableCell sx={{ fontWeight: 'bold', width: '30%' }}>Required</TableCell>
                                    <TableCell>
                                      {JSON.stringify(affinity.nodeAffinity.requiredDuringSchedulingIgnoredDuringExecution.nodeSelectorTerms, null, 2)}
                                    </TableCell>
                                  </TableRow>
                                )}
                                {affinity.nodeAffinity.preferredDuringSchedulingIgnoredDuringExecution && (
                                  <TableRow>
                                    <TableCell sx={{ fontWeight: 'bold' }}>Preferred</TableCell>
                                    <TableCell>
                                      {JSON.stringify(affinity.nodeAffinity.preferredDuringSchedulingIgnoredDuringExecution, null, 2)}
                                    </TableCell>
                                  </TableRow>
                                )}
                              </TableBody>
                            </Table>
                          </TableContainer>
                        </Box>
                      )}

                      {/* Pod Affinity */}
                      {affinity?.podAffinity && (
                        <Box>
                          <Typography variant="subtitle2" gutterBottom>
                            Pod Affinity
                          </Typography>
                          <Chip
                            label="Pod affinity rules configured"
                            size="small"
                            variant="outlined"
                            color="success"
                          />
                        </Box>
                      )}

                      {/* Pod Anti-Affinity */}
                      {affinity?.podAntiAffinity && (
                        <Box>
                          <Typography variant="subtitle2" gutterBottom>
                            Pod Anti-Affinity
                          </Typography>
                          <Chip
                            label="Pod anti-affinity rules configured"
                            size="small"
                            variant="outlined"
                            color="warning"
                          />
                        </Box>
                      )}

                      {/* Tolerations */}
                      {hasTolerations && (
                        <Box>
                          <Typography variant="subtitle2" gutterBottom>
                            Tolerations ({tolerations.length})
                          </Typography>
                          <TableContainer component={Paper} variant="outlined">
                            <Table size="small">
                              <TableHead>
                                <TableRow>
                                  <TableCell sx={{ fontWeight: 'bold' }}>Key</TableCell>
                                  <TableCell sx={{ fontWeight: 'bold' }}>Operator</TableCell>
                                  <TableCell sx={{ fontWeight: 'bold' }}>Value</TableCell>
                                  <TableCell sx={{ fontWeight: 'bold' }}>Effect</TableCell>
                                </TableRow>
                              </TableHead>
                              <TableBody>
                                {tolerations.map((tol: any, idx: number) => (
                                  <TableRow key={idx}>
                                    <TableCell>{tol.key || '*'}</TableCell>
                                    <TableCell>{tol.operator || 'Equal'}</TableCell>
                                    <TableCell>{tol.value || '-'}</TableCell>
                                    <TableCell>
                                      <Chip
                                        label={tol.effect || 'All'}
                                        size="small"
                                        variant="outlined"
                                        color={tol.effect === 'NoSchedule' ? 'error' : tol.effect === 'PreferNoSchedule' ? 'warning' : 'default'}
                                      />
                                    </TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </TableContainer>
                        </Box>
                      )}
                    </Box>
                  </SectionBox>
                );
              })(),
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
                  onClick={() => {
                    item
                      .migrate()
                      .then(() => {
                        enqueueSnackbar(t('Live migration initiated'), { variant: 'success' });
                      })
                      .catch((e: any) => {
                        console.error('Migration failed', e);
                        enqueueSnackbar(t('Failed to initiate live migration'), { variant: 'error' });
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
                <Dialog open={snapshotDialog} onClose={() => setSnapshotDialog(false)} maxWidth="sm" fullWidth>
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
