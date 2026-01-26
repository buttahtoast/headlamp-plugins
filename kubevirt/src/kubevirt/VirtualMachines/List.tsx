import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { Link } from '@kinvolk/headlamp-plugin/lib/components/common';
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
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { Icon } from '@iconify/react';
import { useSnackbar } from 'notistack';
import { useCallback, useEffect, useMemo, useState } from 'react';
import LiveMigrationDialog from '../components/LiveMigrationDialog';
import { ResourceList, ResourceListColumn } from '../components/ResourceList';
import { useKubeVirtInstalled, KubeVirtNotInstalled, KubeVirtCheckLoading, formatBytes } from '../utils/kubeVirtCheck';
import SshTerminal from '../SshTerminal/SshTerminal';
import VncConsole from '../VncConsole/VncConsole';
import VirtualMachineInstance from '../VirtualMachineInstance/VirtualMachineInstance';
import VirtualMachineClusterInstancetype from '../VirtualMachineClusterInstancetype/VirtualMachineClusterInstancetype';
import VirtualMachineClusterPreference from '../VirtualMachineClusterPreference/VirtualMachineClusterPreference';
import VirtualMachine from './VirtualMachine';

// OS icon mapping based on guest OS info
function getOSIcon(osName: string): { icon: string; color: string } {
  const lowerName = osName.toLowerCase();

  if (lowerName.includes('windows') || lowerName.includes('win32') || lowerName.includes('win64')) {
    return { icon: 'mdi:microsoft-windows', color: '#0078D4' };
  }
  if (lowerName.includes('rhel') || lowerName.includes('red hat')) {
    return { icon: 'mdi:redhat', color: '#EE0000' };
  }
  if (lowerName.includes('fedora')) {
    return { icon: 'mdi:fedora', color: '#51A2DA' };
  }
  if (lowerName.includes('centos')) {
    return { icon: 'mdi:centos', color: '#262577' };
  }
  if (lowerName.includes('ubuntu')) {
    return { icon: 'mdi:ubuntu', color: '#E95420' };
  }
  if (lowerName.includes('debian')) {
    return { icon: 'mdi:debian', color: '#A81D33' };
  }
  if (lowerName.includes('suse') || lowerName.includes('sles')) {
    return { icon: 'mdi:suse', color: '#73BA25' };
  }
  if (lowerName.includes('arch')) {
    return { icon: 'mdi:arch', color: '#1793D1' };
  }
  if (lowerName.includes('linux')) {
    return { icon: 'mdi:linux', color: '#FCC624' };
  }
  return { icon: 'mdi:help-circle-outline', color: '#9E9E9E' };
}

// Helper functions - defined before useMemo
function getPrimaryIP(vmi: VirtualMachineInstance | undefined): string {
  if (!vmi?.status?.interfaces) return '';

  for (const iface of vmi.status.interfaces) {
    if (iface.ipAddresses?.length > 0) {
      const ipv4 = iface.ipAddresses.find((ip: string) => ip && !ip.includes(':'));
      if (ipv4) return ipv4;
    }
    if (iface.ipAddress && !iface.ipAddress.includes(':')) {
      return iface.ipAddress;
    }
  }

  for (const iface of vmi.status.interfaces) {
    if (iface.ipAddresses?.length > 0) {
      return iface.ipAddresses[0];
    }
    if (iface.ipAddress) {
      return iface.ipAddress;
    }
  }

  return '';
}

function getReadyStatus(vm: VirtualMachine, vmi: VirtualMachineInstance | undefined): string {
  const vmConditions = vm.status?.conditions || [];
  const vmReady = vmConditions.find((c: any) => c.type === 'Ready');
  if (vmReady) {
    return vmReady.status === 'True' ? 'True' : 'False';
  }

  if (vmi?.status?.conditions) {
    const vmiReady = vmi.status.conditions.find((c: any) => c.type === 'Ready');
    if (vmiReady) {
      return vmiReady.status === 'True' ? 'True' : 'False';
    }
  }

  return vm.status?.printableStatus === 'Running' ? 'True' : 'False';
}

function getStatusColor(status: string): 'success' | 'error' | 'warning' | 'info' | 'default' {
  switch (status) {
    case 'Running':
      return 'success';
    case 'Failed':
    case 'CrashLoopBackOff':
    case 'ErrorUnschedulable':
    case 'ErrImagePull':
    case 'ImagePullBackOff':
    case 'DataVolumeError':
      return 'error';
    case 'Migrating':
    case 'Starting':
    case 'Stopping':
    case 'Paused':
    case 'Scheduling':
    case 'Provisioning':
    case 'WaitingForVolumeBinding':
      return 'warning';
    case 'Stopped':
      return 'info';
    default:
      return 'default';
  }
}

function getOSInfo(vmi: VirtualMachineInstance | undefined): { name: string; version: string; full: string } {
  const guestOS = vmi?.status?.guestOSInfo;
  if (!guestOS) {
    return { name: '', version: '', full: '' };
  }

  const name = guestOS.prettyName || guestOS.name || guestOS.id || '';
  const version = guestOS.version || guestOS.versionId || '';
  const full = name + (version ? ` ${version}` : '');

  return { name, version, full };
}

// VM Bulk Operations Toolbar
interface VMSelectionToolbarProps {
  selectedRows: VirtualMachine[];
  clearSelection: () => void;
  vmiMap: Map<string, VirtualMachineInstance>;
  onMigrate: (vms: VirtualMachine[]) => void;
}

function VMSelectionToolbar({
  selectedRows,
  clearSelection,
  vmiMap,
  onMigrate,
}: VMSelectionToolbarProps) {
  const { enqueueSnackbar } = useSnackbar();

  if (selectedRows.length === 0) return null;

  // Count VMs by status
  const runningVMs = selectedRows.filter(vm => vm.status?.printableStatus === 'Running');
  const stoppedVMs = selectedRows.filter(vm => vm.status?.printableStatus === 'Stopped');
  const pausedVMs = selectedRows.filter(vm => vm.status?.printableStatus === 'Paused');

  const handleBulkAction = async (
    action: 'start' | 'stop' | 'restart' | 'pause' | 'unpause' | 'delete',
    vms: VirtualMachine[]
  ) => {
    let successCount = 0;
    let errorCount = 0;

    for (const vm of vms) {
      try {
        switch (action) {
          case 'start':
            await vm.start();
            break;
          case 'stop':
            await vm.stop();
            break;
          case 'restart':
            await vm.restart();
            break;
          case 'pause':
            await vm.pause();
            break;
          case 'unpause':
            await vm.unpause();
            break;
          case 'delete':
            await ApiProxy.request(
              `/apis/kubevirt.io/v1/namespaces/${vm.getNamespace()}/virtualmachines/${vm.getName()}`,
              { method: 'DELETE' }
            );
            break;
        }
        successCount++;
      } catch (error) {
        errorCount++;
        console.error(`Failed to ${action} VM ${vm.getName()}:`, error);
      }
    }

    const actionLabels: Record<string, string> = {
      start: 'started',
      stop: 'stopped',
      restart: 'restarted',
      pause: 'paused',
      unpause: 'unpaused',
      delete: 'deleted',
    };

    if (successCount > 0) {
      enqueueSnackbar(`${successCount} VM(s) ${actionLabels[action]}`, { variant: 'success' });
    }
    if (errorCount > 0) {
      enqueueSnackbar(`Failed to ${action} ${errorCount} VM(s)`, { variant: 'error' });
    }

    clearSelection();
  };

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        bgcolor: 'action.selected',
        borderRadius: 1,
        px: 1.5,
        py: 0.5,
        flexWrap: 'wrap',
      }}
    >
      <Typography variant="body2" color="text.secondary" sx={{ mr: 1 }}>
        {selectedRows.length} selected
      </Typography>

      {stoppedVMs.length > 0 && (
        <Button
          variant="contained"
          color="success"
          size="small"
          startIcon={<Icon icon="mdi:play" />}
          onClick={() => handleBulkAction('start', stoppedVMs)}
        >
          Start ({stoppedVMs.length})
        </Button>
      )}

      {runningVMs.length > 0 && (
        <>
          <Button
            variant="contained"
            color="warning"
            size="small"
            startIcon={<Icon icon="mdi:stop" />}
            onClick={() => handleBulkAction('stop', runningVMs)}
          >
            Stop ({runningVMs.length})
          </Button>
          <Button
            variant="outlined"
            size="small"
            startIcon={<Icon icon="mdi:restart" />}
            onClick={() => handleBulkAction('restart', runningVMs)}
          >
            Restart ({runningVMs.length})
          </Button>
          <Button
            variant="outlined"
            size="small"
            startIcon={<Icon icon="mdi:pause" />}
            onClick={() => handleBulkAction('pause', runningVMs)}
          >
            Pause ({runningVMs.length})
          </Button>
          <Button
            variant="outlined"
            size="small"
            startIcon={<Icon icon="mdi:swap-horizontal" />}
            onClick={() => onMigrate(runningVMs)}
          >
            Migrate ({runningVMs.length})
          </Button>
        </>
      )}

      {pausedVMs.length > 0 && (
        <Button
          variant="contained"
          color="info"
          size="small"
          startIcon={<Icon icon="mdi:play" />}
          onClick={() => handleBulkAction('unpause', pausedVMs)}
        >
          Unpause ({pausedVMs.length})
        </Button>
      )}

      <Button
        variant="contained"
        color="error"
        size="small"
        startIcon={<Icon icon="mdi:delete" />}
        onClick={() => handleBulkAction('delete', selectedRows)}
      >
        Delete ({selectedRows.length})
      </Button>
    </Box>
  );
}

export default function VirtualMachineList() {
  const { enqueueSnackbar } = useSnackbar();
  const { installed: kubeVirtInstalled, checking: checkingKubeVirt } = useKubeVirtInstalled();
  const { items: vms, error: vmError } = VirtualMachine.useList({});
  const { items: vmis, error: vmiError } = VirtualMachineInstance.useList({});
  const { items: instanceTypes } = VirtualMachineClusterInstancetype.useList({});
  const { items: preferences } = VirtualMachineClusterPreference.useList({});

  // Dialog states
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [selectedVM, setSelectedVM] = useState<{ vm: VirtualMachine; vmi: VirtualMachineInstance | undefined } | null>(null);
  const [vncOpen, setVncOpen] = useState(false);
  const [sshOpen, setSshOpen] = useState(false);
  const [migrationDialogOpen, setMigrationDialogOpen] = useState(false);
  const [bulkMigrationVMs, setBulkMigrationVMs] = useState<VirtualMachine[]>([]);

  // Create VM form state
  const [vmName, setVmName] = useState('');
  const [vmNamespace, setVmNamespace] = useState('default');
  const [selectedInstanceType, setSelectedInstanceType] = useState('');
  const [selectedPreference, setSelectedPreference] = useState('');
  const [diskSize, setDiskSize] = useState('10Gi');
  const [diskSource, setDiskSource] = useState('blank');
  const [diskSourceUrl, setDiskSourceUrl] = useState('');
  const [startAfterCreate, setStartAfterCreate] = useState(true);

  // Fetch namespaces
  const [namespaces, setNamespaces] = useState<string[]>(['default']);
  useEffect(() => {
    const fetchNamespaces = async () => {
      try {
        const response = await ApiProxy.request('/api/v1/namespaces') as { items: any[] };
        const nsList = response.items?.map(ns => ns.metadata.name) || ['default'];
        setNamespaces(nsList.sort());
      } catch (error) {
        console.error('Failed to fetch namespaces:', error);
      }
    };
    fetchNamespaces();
  }, []);

  // Create a map of VMIs by namespace/name for quick lookup
  const vmiMap = useMemo(() => {
    const map = new Map<string, VirtualMachineInstance>();
    if (vmis) {
      for (const vmi of vmis) {
        const key = `${vmi.getNamespace()}/${vmi.getName()}`;
        map.set(key, vmi);
      }
    }
    return map;
  }, [vmis]);

  // Get unique status options for filter
  const statusOptions = useMemo(() => {
    const statuses = new Set<string>();
    vms?.forEach(vm => statuses.add(vm.status?.printableStatus || 'Unknown'));
    return Array.from(statuses).sort();
  }, [vms]);

  // Column definitions
  const columns: ResourceListColumn<VirtualMachine>[] = useMemo(() => [
    {
      id: 'name',
      header: 'Name',
      accessorFn: (vm) => vm.getName(),
      Cell: ({ row }) => (
        <Link
          routeName="virtualmachine"
          params={{ name: row.original.getName(), namespace: row.original.getNamespace() }}
        >
          {row.original.getName()}
        </Link>
      ),
      gridTemplate: '1.5fr',
    },
    {
      id: 'namespace',
      header: 'Namespace',
      accessorFn: (vm) => vm.getNamespace(),
      Cell: ({ row }) => (
        <Link routeName="namespace" params={{ name: row.original.getNamespace() }}>
          {row.original.getNamespace()}
        </Link>
      ),
      filterVariant: 'select',
      filterSelectOptions: Array.from(new Set(vms?.map(vm => vm.getNamespace()) || [])).sort(),
    },
    {
      id: 'status',
      header: 'Status',
      accessorFn: (vm) => vm.status?.printableStatus || 'Unknown',
      Cell: ({ row }) => {
        const status = row.original.status?.printableStatus || 'Unknown';
        return <Chip label={status} size="small" color={getStatusColor(status)} variant="outlined" />;
      },
      filterVariant: 'select',
      filterSelectOptions: statusOptions,
      gridTemplate: '0.7fr',
    },
    {
      id: 'ip',
      header: 'IP',
      accessorFn: (vm) => {
        const vmiKey = `${vm.getNamespace()}/${vm.getName()}`;
        const vmi = vmiMap.get(vmiKey);
        return getPrimaryIP(vmi);
      },
      Cell: ({ row }) => {
        const vmiKey = `${row.original.getNamespace()}/${row.original.getName()}`;
        const vmi = vmiMap.get(vmiKey);
        const ip = getPrimaryIP(vmi);
        return ip ? (
          <Chip label={ip} size="small" variant="outlined" color="info" sx={{ fontFamily: 'monospace' }} />
        ) : (
          <Typography variant="caption" color="text.secondary">-</Typography>
        );
      },
      enableColumnFilter: false,
    },
    {
      id: 'node',
      header: 'Node',
      accessorFn: (vm) => {
        const vmiKey = `${vm.getNamespace()}/${vm.getName()}`;
        const vmi = vmiMap.get(vmiKey);
        return vmi?.status?.nodeName || '';
      },
      Cell: ({ row }) => {
        const vmiKey = `${row.original.getNamespace()}/${row.original.getName()}`;
        const vmi = vmiMap.get(vmiKey);
        const nodeName = vmi?.status?.nodeName;
        return nodeName ? (
          <Link routeName="node" params={{ name: nodeName }}>
            {nodeName}
          </Link>
        ) : (
          <Typography variant="caption" color="text.secondary">-</Typography>
        );
      },
    },
    {
      id: 'os',
      header: 'OS',
      accessorFn: (vm) => {
        const vmiKey = `${vm.getNamespace()}/${vm.getName()}`;
        const vmi = vmiMap.get(vmiKey);
        return getOSInfo(vmi).full;
      },
      Cell: ({ row }) => {
        const vmiKey = `${row.original.getNamespace()}/${row.original.getName()}`;
        const vmi = vmiMap.get(vmiKey);
        const osInfo = getOSInfo(vmi);
        if (!osInfo.name) {
          return <Typography variant="caption" color="text.secondary">-</Typography>;
        }
        const osIcon = getOSIcon(osInfo.full);
        return (
          <Tooltip title={osInfo.full}>
            <Box sx={{ display: 'flex', alignItems: 'center' }}>
              <Icon icon={osIcon.icon} width={20} color={osIcon.color} />
            </Box>
          </Tooltip>
        );
      },
      gridTemplate: '0.4fr',
      enableColumnFilter: false,
    },
    {
      id: 'ready',
      header: 'Ready',
      accessorFn: (vm) => {
        const vmiKey = `${vm.getNamespace()}/${vm.getName()}`;
        const vmi = vmiMap.get(vmiKey);
        return getReadyStatus(vm, vmi);
      },
      Cell: ({ row }) => {
        const vmiKey = `${row.original.getNamespace()}/${row.original.getName()}`;
        const vmi = vmiMap.get(vmiKey);
        const ready = getReadyStatus(row.original, vmi);
        return <Chip label={ready} size="small" color={ready === 'True' ? 'success' : 'default'} variant="outlined" />;
      },
      show: false,
    },
    {
      id: 'cpu',
      header: 'CPU',
      accessorFn: (vm) => {
        const domain = vm.jsonData?.spec?.template?.spec?.domain;
        const cores = domain?.cpu?.cores || 1;
        const sockets = domain?.cpu?.sockets || 1;
        const threads = domain?.cpu?.threads || 1;
        return cores * sockets * threads;
      },
      Cell: ({ row }) => {
        const domain = row.original.jsonData?.spec?.template?.spec?.domain;
        const cores = domain?.cpu?.cores || 1;
        const sockets = domain?.cpu?.sockets || 1;
        const threads = domain?.cpu?.threads || 1;
        const total = cores * sockets * threads;
        return <Chip label={`${total} vCPU`} size="small" variant="outlined" />;
      },
      gridTemplate: '0.5fr',
      show: false,
      enableColumnFilter: false,
    },
    {
      id: 'memory',
      header: 'Mem',
      accessorFn: (vm) => {
        const domain = vm.jsonData?.spec?.template?.spec?.domain;
        return domain?.resources?.requests?.memory || domain?.memory?.guest || '';
      },
      Cell: ({ row }) => {
        const domain = row.original.jsonData?.spec?.template?.spec?.domain;
        const mem = domain?.resources?.requests?.memory || domain?.memory?.guest || '';
        return mem ? (
          <Chip label={formatBytes(mem)} size="small" variant="outlined" />
        ) : (
          <Typography variant="caption" color="text.secondary">-</Typography>
        );
      },
      gridTemplate: '0.5fr',
      show: false,
      enableColumnFilter: false,
    },
    {
      id: 'connect',
      header: 'Connect',
      accessorFn: () => '',
      Cell: ({ row }) => {
        const status = row.original.status?.printableStatus || 'Unknown';
        const isRunning = status === 'Running';
        const vmiKey = `${row.original.getNamespace()}/${row.original.getName()}`;
        const vmi = vmiMap.get(vmiKey);
        if (!isRunning || !vmi) {
          return <Typography variant="caption" color="text.secondary">-</Typography>;
        }
        return (
          <Box sx={{ display: 'flex', gap: 0.5 }}>
            <Tooltip title="VNC Console">
              <Button
                size="small"
                variant="outlined"
                sx={{ minWidth: 32, p: 0.5 }}
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedVM({ vm: row.original, vmi });
                  setVncOpen(true);
                }}
              >
                <Icon icon="mdi:monitor" width={18} />
              </Button>
            </Tooltip>
            <Tooltip title="SSH Console">
              <Button
                size="small"
                variant="outlined"
                sx={{ minWidth: 32, p: 0.5 }}
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedVM({ vm: row.original, vmi });
                  setSshOpen(true);
                }}
              >
                <Icon icon="mdi:console-network" width={18} />
              </Button>
            </Tooltip>
          </Box>
        );
      },
      gridTemplate: '0.6fr',
      enableColumnFilter: false,
      enableSorting: false,
    },
    {
      id: 'controls',
      header: 'Controls',
      accessorFn: () => '',
      Cell: ({ row }) => {
        const vm = row.original;
        const status = vm.status?.printableStatus || 'Unknown';
        const isRunning = status === 'Running';
        const isStopped = status === 'Stopped';
        const isPaused = status === 'Paused';
        const vmiKey = `${vm.getNamespace()}/${vm.getName()}`;
        const vmi = vmiMap.get(vmiKey);

        return (
          <Box sx={{ display: 'flex', gap: 0.5 }}>
            {isStopped && (
              <Tooltip title="Start VM">
                <Button
                  size="small"
                  variant="outlined"
                  color="success"
                  sx={{ minWidth: 32, p: 0.5 }}
                  onClick={(e) => {
                    e.stopPropagation();
                    vm.start();
                  }}
                >
                  <Icon icon="mdi:play" width={18} />
                </Button>
              </Tooltip>
            )}
            {isRunning && (
              <>
                <Tooltip title="Stop VM">
                  <Button
                    size="small"
                    variant="outlined"
                    color="error"
                    sx={{ minWidth: 32, p: 0.5 }}
                    onClick={(e) => {
                      e.stopPropagation();
                      vm.stop();
                    }}
                  >
                    <Icon icon="mdi:stop" width={18} />
                  </Button>
                </Tooltip>
                <Tooltip title="Restart VM">
                  <Button
                    size="small"
                    variant="outlined"
                    sx={{ minWidth: 32, p: 0.5 }}
                    onClick={(e) => {
                      e.stopPropagation();
                      vm.restart();
                    }}
                  >
                    <Icon icon="mdi:restart" width={18} />
                  </Button>
                </Tooltip>
                <Tooltip title="Pause VM">
                  <Button
                    size="small"
                    variant="outlined"
                    sx={{ minWidth: 32, p: 0.5 }}
                    onClick={(e) => {
                      e.stopPropagation();
                      vm.pause();
                    }}
                  >
                    <Icon icon="mdi:pause" width={18} />
                  </Button>
                </Tooltip>
                <Tooltip title="Live Migrate">
                  <Button
                    size="small"
                    variant="outlined"
                    sx={{ minWidth: 32, p: 0.5 }}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (vmi) {
                        setBulkMigrationVMs([vm]);
                        setMigrationDialogOpen(true);
                      }
                    }}
                  >
                    <Icon icon="mdi:swap-horizontal" width={18} />
                  </Button>
                </Tooltip>
              </>
            )}
            {isPaused && (
              <Tooltip title="Unpause VM">
                <Button
                  size="small"
                  variant="outlined"
                  color="success"
                  sx={{ minWidth: 32, p: 0.5 }}
                  onClick={(e) => {
                    e.stopPropagation();
                    vm.unpause();
                  }}
                >
                  <Icon icon="mdi:play" width={18} />
                </Button>
              </Tooltip>
            )}
          </Box>
        );
      },
      gridTemplate: '1fr',
      enableColumnFilter: false,
      enableSorting: false,
    },
    {
      id: 'age',
      header: 'Age',
      accessorFn: (vm) => new Date(vm.metadata?.creationTimestamp || 0).getTime(),
      Cell: ({ row }) => {
        const created = row.original.metadata?.creationTimestamp;
        if (!created) return '-';
        const date = new Date(created);
        const now = new Date();
        const diffMs = now.getTime() - date.getTime();
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        const diffHours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        if (diffDays > 0) return `${diffDays}d`;
        if (diffHours > 0) return `${diffHours}h`;
        const diffMins = Math.floor(diffMs / (1000 * 60));
        return `${diffMins}m`;
      },
      enableColumnFilter: false,
    },
  ], [vms, vmiMap, statusOptions]);

  // Handle bulk migration
  const handleBulkMigrate = (vmsToMigrate: VirtualMachine[]) => {
    setBulkMigrationVMs(vmsToMigrate);
    setMigrationDialogOpen(true);
  };

  const handleBulkMigrateConfirm = async () => {
    let successCount = 0;
    let errorCount = 0;

    for (const vm of bulkMigrationVMs) {
      try {
        await vm.migrate();
        successCount++;
      } catch (error) {
        errorCount++;
        console.error(`Failed to migrate VM ${vm.getName()}:`, error);
      }
    }

    if (successCount > 0) {
      enqueueSnackbar(`${successCount} VM(s) migration initiated`, { variant: 'success' });
    }
    if (errorCount > 0) {
      enqueueSnackbar(`Failed to migrate ${errorCount} VM(s)`, { variant: 'error' });
    }

    setMigrationDialogOpen(false);
    setBulkMigrationVMs([]);
  };

  // Create VM handler
  const handleCreateVM = async () => {
    if (!vmName || !vmNamespace) {
      enqueueSnackbar('Please fill required fields', { variant: 'warning' });
      return;
    }

    // Build VM spec
    const vmSpec: any = {
      apiVersion: 'kubevirt.io/v1',
      kind: 'VirtualMachine',
      metadata: {
        name: vmName,
        namespace: vmNamespace,
      },
      spec: {
        running: startAfterCreate,
        template: {
          metadata: {
            labels: {
              'kubevirt.io/vm': vmName,
            },
          },
          spec: {
            domain: {
              devices: {
                disks: [
                  {
                    name: 'rootdisk',
                    disk: { bus: 'virtio' },
                  },
                ],
                interfaces: [
                  {
                    name: 'default',
                    masquerade: {},
                  },
                ],
              },
            },
            networks: [
              {
                name: 'default',
                pod: {},
              },
            ],
            volumes: [
              {
                name: 'rootdisk',
                dataVolume: {
                  name: `${vmName}-rootdisk`,
                },
              },
            ],
          },
        },
        dataVolumeTemplates: [
          {
            metadata: {
              name: `${vmName}-rootdisk`,
            },
            spec: {
              storage: {
                resources: {
                  requests: {
                    storage: diskSize,
                  },
                },
              },
              source: diskSource === 'blank'
                ? { blank: {} }
                : diskSource === 'http'
                  ? { http: { url: diskSourceUrl } }
                  : { registry: { url: diskSourceUrl } },
            },
          },
        ],
      },
    };

    // Add instancetype reference if selected
    if (selectedInstanceType) {
      vmSpec.spec.instancetype = {
        kind: 'VirtualMachineClusterInstancetype',
        name: selectedInstanceType,
      };
    } else {
      // Default resources if no instancetype
      vmSpec.spec.template.spec.domain.resources = {
        requests: {
          memory: '1Gi',
          cpu: '1',
        },
      };
    }

    // Add preference reference if selected
    if (selectedPreference) {
      vmSpec.spec.preference = {
        kind: 'VirtualMachineClusterPreference',
        name: selectedPreference,
      };
    }

    try {
      await ApiProxy.request(
        `/apis/kubevirt.io/v1/namespaces/${vmNamespace}/virtualmachines`,
        {
          method: 'POST',
          body: JSON.stringify(vmSpec),
          headers: { 'Content-Type': 'application/json' },
        }
      );

      enqueueSnackbar('Virtual Machine created successfully', { variant: 'success' });
      setCreateDialogOpen(false);
      resetCreateForm();
    } catch (error: any) {
      enqueueSnackbar(`Failed to create VM: ${error.message}`, { variant: 'error' });
    }
  };

  const resetCreateForm = () => {
    setVmName('');
    setVmNamespace('default');
    setSelectedInstanceType('');
    setSelectedPreference('');
    setDiskSize('10Gi');
    setDiskSource('blank');
    setDiskSourceUrl('');
    setStartAfterCreate(true);
  };

  if (checkingKubeVirt) {
    return <KubeVirtCheckLoading />;
  }

  if (kubeVirtInstalled === false) {
    return <KubeVirtNotInstalled />;
  }

  const error = vmError || vmiError;

  return (
    <>
      <ResourceList<VirtualMachine>
        title="Virtual Machines"
        data={vms}
        columns={columns}
        loading={!vms}
        errorMessage={error?.message}
        showNamespaceFilter={true}
        namespaceGetter={(vm) => vm.getNamespace()}
        enableRowSelection={true}
        id="kubevirt-virtualmachines"
        defaultSortingColumn={{ id: 'name', desc: false }}
        emptyMessage="No virtual machines found"
        toolbarAction={
          <Button
            variant="contained"
            startIcon={<Icon icon="mdi:plus" />}
            onClick={() => setCreateDialogOpen(true)}
          >
            Create VM
          </Button>
        }
        renderRowSelectionToolbar={({ selectedRows, clearSelection }) => (
          <VMSelectionToolbar
            selectedRows={selectedRows}
            clearSelection={clearSelection}
            vmiMap={vmiMap}
            onMigrate={handleBulkMigrate}
          />
        )}
      />

      {/* Console Dialogs */}
      {selectedVM?.vmi && (
        <>
          <VncConsole
            item={selectedVM.vmi}
            open={vncOpen}
            onClose={() => {
              setVncOpen(false);
              setSelectedVM(null);
            }}
          />
          <SshTerminal
            item={selectedVM.vmi}
            vmSpec={selectedVM.vm?.jsonData}
            open={sshOpen}
            onClose={() => {
              setSshOpen(false);
              setSelectedVM(null);
            }}
          />
        </>
      )}

      {/* Bulk Migration Confirmation Dialog */}
      <Dialog
        open={migrationDialogOpen && bulkMigrationVMs.length > 0}
        onClose={() => {
          setMigrationDialogOpen(false);
          setBulkMigrationVMs([]);
        }}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Confirm Bulk Migration</DialogTitle>
        <DialogContent>
          <Typography>
            Are you sure you want to live migrate {bulkMigrationVMs.length} VM(s)?
          </Typography>
          <Box sx={{ mt: 2, maxHeight: 200, overflow: 'auto' }}>
            {bulkMigrationVMs.map(vm => (
              <Chip
                key={`${vm.getNamespace()}/${vm.getName()}`}
                label={vm.getName()}
                size="small"
                sx={{ m: 0.5 }}
              />
            ))}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => {
            setMigrationDialogOpen(false);
            setBulkMigrationVMs([]);
          }}>
            Cancel
          </Button>
          <Button onClick={handleBulkMigrateConfirm} variant="contained">
            Migrate All
          </Button>
        </DialogActions>
      </Dialog>

      {/* Create VM Dialog */}
      <Dialog
        open={createDialogOpen}
        onClose={() => setCreateDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Create Virtual Machine</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
            <TextField
              label="VM Name"
              value={vmName}
              onChange={(e) => setVmName(e.target.value)}
              placeholder="my-vm"
              fullWidth
              required
            />

            <FormControl fullWidth required>
              <InputLabel>Namespace</InputLabel>
              <Select
                value={vmNamespace}
                label="Namespace"
                onChange={(e) => setVmNamespace(e.target.value)}
              >
                {namespaces.map(ns => (
                  <MenuItem key={ns} value={ns}>{ns}</MenuItem>
                ))}
              </Select>
            </FormControl>

            <FormControl fullWidth>
              <InputLabel>Instance Type (optional)</InputLabel>
              <Select
                value={selectedInstanceType}
                label="Instance Type (optional)"
                onChange={(e) => setSelectedInstanceType(e.target.value)}
              >
                <MenuItem value="">None (manual config)</MenuItem>
                {instanceTypes?.map(it => (
                  <MenuItem key={it.getName()} value={it.getName()}>
                    {it.getName()} ({it.getCPU().guest} vCPU, {it.getMemory().guest})
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <FormControl fullWidth>
              <InputLabel>Preference (optional)</InputLabel>
              <Select
                value={selectedPreference}
                label="Preference (optional)"
                onChange={(e) => setSelectedPreference(e.target.value)}
              >
                <MenuItem value="">None</MenuItem>
                {preferences?.map(pref => (
                  <MenuItem key={pref.getName()} value={pref.getName()}>
                    {pref.getName()}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <FormControl fullWidth>
              <InputLabel>Disk Source</InputLabel>
              <Select
                value={diskSource}
                label="Disk Source"
                onChange={(e) => setDiskSource(e.target.value)}
              >
                <MenuItem value="blank">Blank Disk</MenuItem>
                <MenuItem value="http">HTTP URL (ISO/QCOW2)</MenuItem>
                <MenuItem value="registry">Container Registry</MenuItem>
              </Select>
            </FormControl>

            {(diskSource === 'http' || diskSource === 'registry') && (
              <TextField
                label={diskSource === 'http' ? 'Image URL' : 'Container Image'}
                value={diskSourceUrl}
                onChange={(e) => setDiskSourceUrl(e.target.value)}
                placeholder={diskSource === 'http'
                  ? 'https://example.com/image.qcow2'
                  : 'docker://quay.io/kubevirt/fedora-cloud-container-disk-demo'
                }
                fullWidth
                required
              />
            )}

            <TextField
              label="Disk Size"
              value={diskSize}
              onChange={(e) => setDiskSize(e.target.value)}
              placeholder="10Gi"
              fullWidth
              required
            />

            <FormControlLabel
              control={
                <Switch
                  checked={startAfterCreate}
                  onChange={(e) => setStartAfterCreate(e.target.checked)}
                />
              }
              label="Start VM after creation"
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setCreateDialogOpen(false); resetCreateForm(); }}>
            Cancel
          </Button>
          <Button onClick={handleCreateVM} variant="contained">
            Create VM
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
