import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { Link } from '@kinvolk/headlamp-plugin/lib/components/common';
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Tooltip,
  Typography,
} from '@mui/material';
import { Icon } from '@iconify/react';
import { useSnackbar } from 'notistack';
import { useMemo, useState } from 'react';
import LiveMigrationDialog from '../components/LiveMigrationDialog';
import { ResourceList, ResourceListColumn } from '../components/ResourceList';
import { useKubeVirtInstalled, KubeVirtNotInstalled, KubeVirtCheckLoading, formatBytes } from '../utils/kubeVirtCheck';
import SshTerminal from '../SshTerminal/SshTerminal';
import VncConsole from '../VncConsole/VncConsole';
import VirtualMachineInstance from './VirtualMachineInstance';

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

// Helper functions
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

function getReadyStatus(vmi: VirtualMachineInstance): string {
  const conditions = vmi.status?.conditions || [];
  const readyCondition = conditions.find((c: any) => c.type === 'Ready');
  if (readyCondition) {
    return readyCondition.status === 'True' ? 'True' : 'False';
  }
  return vmi.status?.phase === 'Running' ? 'True' : 'False';
}

function getOSInfo(vmi: VirtualMachineInstance): { name: string; full: string } {
  const guestOS = vmi?.status?.guestOSInfo;
  if (!guestOS) {
    return { name: '', full: '' };
  }

  const name = guestOS.prettyName || guestOS.name || guestOS.id || '';
  const version = guestOS.version || guestOS.versionId || '';
  const full = name + (version ? ` ${version}` : '');

  return { name, full };
}

function getPhaseColor(phase: string): 'success' | 'error' | 'warning' | 'info' | 'default' {
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
    case 'Succeeded':
      return 'info';
    default:
      return 'default';
  }
}

function isPaused(vmi: VirtualMachineInstance): boolean {
  return vmi.status?.conditions?.some((c: any) => c.type === 'Paused' && c.status === 'True') || false;
}

// VMI Bulk Operations Toolbar
interface VMISelectionToolbarProps {
  selectedRows: VirtualMachineInstance[];
  clearSelection: () => void;
  onMigrate: (vmis: VirtualMachineInstance[]) => void;
}

function VMISelectionToolbar({
  selectedRows,
  clearSelection,
  onMigrate,
}: VMISelectionToolbarProps) {
  const { enqueueSnackbar } = useSnackbar();

  if (selectedRows.length === 0) return null;

  // Count VMIs by status
  const runningVMIs = selectedRows.filter(vmi => vmi.status?.phase === 'Running' && !isPaused(vmi));
  const pausedVMIs = selectedRows.filter(vmi => isPaused(vmi));

  const handleBulkAction = async (
    action: 'pause' | 'unpause' | 'delete',
    vmis: VirtualMachineInstance[]
  ) => {
    let successCount = 0;
    let errorCount = 0;

    for (const vmi of vmis) {
      try {
        switch (action) {
          case 'pause':
            await vmi.pause();
            break;
          case 'unpause':
            await vmi.unpause();
            break;
          case 'delete':
            await ApiProxy.request(
              `/apis/kubevirt.io/v1/namespaces/${vmi.getNamespace()}/virtualmachineinstances/${vmi.getName()}`,
              { method: 'DELETE' }
            );
            break;
        }
        successCount++;
      } catch (error) {
        errorCount++;
        console.error(`Failed to ${action} VMI ${vmi.getName()}:`, error);
      }
    }

    const actionLabels: Record<string, string> = {
      pause: 'paused',
      unpause: 'unpaused',
      delete: 'deleted',
    };

    if (successCount > 0) {
      enqueueSnackbar(`${successCount} VMI(s) ${actionLabels[action]}`, { variant: 'success' });
    }
    if (errorCount > 0) {
      enqueueSnackbar(`Failed to ${action} ${errorCount} VMI(s)`, { variant: 'error' });
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

      {runningVMIs.length > 0 && (
        <>
          <Button
            variant="outlined"
            size="small"
            startIcon={<Icon icon="mdi:pause" />}
            onClick={() => handleBulkAction('pause', runningVMIs)}
          >
            Pause ({runningVMIs.length})
          </Button>
          <Button
            variant="outlined"
            size="small"
            startIcon={<Icon icon="mdi:swap-horizontal" />}
            onClick={() => onMigrate(runningVMIs)}
          >
            Migrate ({runningVMIs.length})
          </Button>
        </>
      )}

      {pausedVMIs.length > 0 && (
        <Button
          variant="contained"
          color="info"
          size="small"
          startIcon={<Icon icon="mdi:play" />}
          onClick={() => handleBulkAction('unpause', pausedVMIs)}
        >
          Unpause ({pausedVMIs.length})
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

export default function VirtualMachineInstanceList() {
  const { enqueueSnackbar } = useSnackbar();
  const { installed: kubeVirtInstalled, checking: checkingKubeVirt } = useKubeVirtInstalled();
  const { items, error } = VirtualMachineInstance.useList({});

  // Dialog states
  const [selectedVMI, setSelectedVMI] = useState<VirtualMachineInstance | null>(null);
  const [vncOpen, setVncOpen] = useState(false);
  const [sshOpen, setSshOpen] = useState(false);
  const [migrationDialogOpen, setMigrationDialogOpen] = useState(false);
  const [bulkMigrationVMIs, setBulkMigrationVMIs] = useState<VirtualMachineInstance[]>([]);

  // Get unique phase options for filter
  const phaseOptions = useMemo(() => {
    const phases = new Set<string>();
    items?.forEach(vmi => phases.add(vmi.status?.phase || 'Unknown'));
    return Array.from(phases).sort();
  }, [items]);

  // Column definitions
  const columns: ResourceListColumn<VirtualMachineInstance>[] = useMemo(() => [
    {
      id: 'name',
      header: 'Name',
      accessorFn: (vmi) => vmi.getName(),
      Cell: ({ row }) => (
        <Link
          routeName="virtualmachineinstance"
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
      accessorFn: (vmi) => vmi.getNamespace(),
      Cell: ({ row }) => (
        <Link routeName="namespace" params={{ name: row.original.getNamespace() }}>
          {row.original.getNamespace()}
        </Link>
      ),
      filterVariant: 'select',
      filterSelectOptions: Array.from(new Set(items?.map(vmi => vmi.getNamespace()) || [])).sort(),
    },
    {
      id: 'status',
      header: 'Status',
      accessorFn: (vmi) => vmi.status?.phase || 'Unknown',
      Cell: ({ row }) => {
        const phase = row.original.status?.phase || 'Unknown';
        const paused = isPaused(row.original);
        return (
          <Box sx={{ display: 'flex', gap: 0.5 }}>
            <Chip label={phase} size="small" color={getPhaseColor(phase)} variant="outlined" />
            {paused && <Chip label="Paused" size="small" color="warning" variant="outlined" />}
          </Box>
        );
      },
      filterVariant: 'select',
      filterSelectOptions: phaseOptions,
      gridTemplate: '0.9fr',
    },
    {
      id: 'ip',
      header: 'IP',
      accessorFn: (vmi) => getPrimaryIP(vmi),
      Cell: ({ row }) => {
        const ip = getPrimaryIP(row.original);
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
      accessorFn: (vmi) => vmi.status?.nodeName || '',
      Cell: ({ row }) => {
        const nodeName = row.original.status?.nodeName;
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
      accessorFn: (vmi) => getOSInfo(vmi).full,
      Cell: ({ row }) => {
        const osInfo = getOSInfo(row.original);
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
      accessorFn: (vmi) => getReadyStatus(vmi),
      Cell: ({ row }) => {
        const ready = getReadyStatus(row.original);
        return <Chip label={ready} size="small" color={ready === 'True' ? 'success' : 'default'} variant="outlined" />;
      },
      show: false,
    },
    {
      id: 'cpu',
      header: 'CPU',
      accessorFn: (vmi) => {
        const domain = vmi.spec?.domain;
        const cores = domain?.cpu?.cores || 1;
        const sockets = domain?.cpu?.sockets || 1;
        const threads = domain?.cpu?.threads || 1;
        return cores * sockets * threads;
      },
      Cell: ({ row }) => {
        const domain = row.original.spec?.domain;
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
      accessorFn: (vmi) => {
        const domain = vmi.spec?.domain;
        return domain?.resources?.requests?.memory || domain?.memory?.guest || '';
      },
      Cell: ({ row }) => {
        const domain = row.original.spec?.domain;
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
        const phase = row.original.status?.phase || 'Unknown';
        const isRunning = phase === 'Running';
        if (!isRunning) {
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
                  setSelectedVMI(row.original);
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
                  setSelectedVMI(row.original);
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
        const vmi = row.original;
        const phase = vmi.status?.phase || 'Unknown';
        const isRunning = phase === 'Running';
        const paused = isPaused(vmi);

        return (
          <Box sx={{ display: 'flex', gap: 0.5 }}>
            {isRunning && !paused && (
              <>
                <Tooltip title="Pause">
                  <Button
                    size="small"
                    variant="outlined"
                    sx={{ minWidth: 32, p: 0.5 }}
                    onClick={(e) => {
                      e.stopPropagation();
                      vmi.pause();
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
                      setBulkMigrationVMIs([vmi]);
                      setMigrationDialogOpen(true);
                    }}
                  >
                    <Icon icon="mdi:swap-horizontal" width={18} />
                  </Button>
                </Tooltip>
              </>
            )}
            {paused && (
              <Tooltip title="Unpause">
                <Button
                  size="small"
                  variant="outlined"
                  color="success"
                  sx={{ minWidth: 32, p: 0.5 }}
                  onClick={(e) => {
                    e.stopPropagation();
                    vmi.unpause();
                  }}
                >
                  <Icon icon="mdi:play" width={18} />
                </Button>
              </Tooltip>
            )}
          </Box>
        );
      },
      gridTemplate: '0.6fr',
      enableColumnFilter: false,
      enableSorting: false,
    },
    {
      id: 'age',
      header: 'Age',
      accessorFn: (vmi) => new Date(vmi.metadata?.creationTimestamp || 0).getTime(),
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
  ], [items, phaseOptions]);

  // Handle bulk migration
  const handleBulkMigrate = (vmisToMigrate: VirtualMachineInstance[]) => {
    setBulkMigrationVMIs(vmisToMigrate);
    setMigrationDialogOpen(true);
  };

  const handleBulkMigrateConfirm = async () => {
    let successCount = 0;
    let errorCount = 0;

    for (const vmi of bulkMigrationVMIs) {
      try {
        const migrationName = `${vmi.getName()}-migration-${Date.now()}`;
        const migration = {
          apiVersion: 'kubevirt.io/v1',
          kind: 'VirtualMachineInstanceMigration',
          metadata: {
            name: migrationName,
            namespace: vmi.getNamespace(),
          },
          spec: {
            vmiName: vmi.getName(),
          },
        };

        await ApiProxy.request(
          `/apis/kubevirt.io/v1/namespaces/${vmi.getNamespace()}/virtualmachineinstancemigrations`,
          {
            method: 'POST',
            body: JSON.stringify(migration),
            headers: { 'Content-Type': 'application/json' },
          }
        );
        successCount++;
      } catch (error) {
        errorCount++;
        console.error(`Failed to migrate VMI ${vmi.getName()}:`, error);
      }
    }

    if (successCount > 0) {
      enqueueSnackbar(`${successCount} VMI(s) migration initiated`, { variant: 'success' });
    }
    if (errorCount > 0) {
      enqueueSnackbar(`Failed to migrate ${errorCount} VMI(s)`, { variant: 'error' });
    }

    setMigrationDialogOpen(false);
    setBulkMigrationVMIs([]);
  };

  if (checkingKubeVirt) {
    return <KubeVirtCheckLoading />;
  }

  if (kubeVirtInstalled === false) {
    return <KubeVirtNotInstalled />;
  }

  return (
    <>
      <ResourceList<VirtualMachineInstance>
        title="Virtual Machine Instances"
        data={items}
        columns={columns}
        loading={!items}
        errorMessage={error?.message}
        showNamespaceFilter={true}
        namespaceGetter={(vmi) => vmi.getNamespace()}
        enableRowSelection={true}
        id="kubevirt-virtualmachineinstances"
        defaultSortingColumn={{ id: 'name', desc: false }}
        emptyMessage="No virtual machine instances found"
        renderRowSelectionToolbar={({ selectedRows, clearSelection }) => (
          <VMISelectionToolbar
            selectedRows={selectedRows}
            clearSelection={clearSelection}
            onMigrate={handleBulkMigrate}
          />
        )}
      />

      {/* Console Dialogs */}
      {selectedVMI && (
        <>
          <VncConsole
            item={selectedVMI}
            open={vncOpen}
            onClose={() => {
              setVncOpen(false);
              setSelectedVMI(null);
            }}
          />
          <SshTerminal
            item={selectedVMI}
            open={sshOpen}
            onClose={() => {
              setSshOpen(false);
              setSelectedVMI(null);
            }}
          />
        </>
      )}

      {/* Bulk Migration Confirmation Dialog */}
      <Dialog
        open={migrationDialogOpen && bulkMigrationVMIs.length > 0}
        onClose={() => {
          setMigrationDialogOpen(false);
          setBulkMigrationVMIs([]);
        }}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Confirm Migration</DialogTitle>
        <DialogContent>
          <Typography>
            Are you sure you want to live migrate {bulkMigrationVMIs.length} VMI(s)?
          </Typography>
          <Box sx={{ mt: 2, maxHeight: 200, overflow: 'auto' }}>
            {bulkMigrationVMIs.map(vmi => (
              <Chip
                key={`${vmi.getNamespace()}/${vmi.getName()}`}
                label={vmi.getName()}
                size="small"
                sx={{ m: 0.5 }}
              />
            ))}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => {
            setMigrationDialogOpen(false);
            setBulkMigrationVMIs([]);
          }}>
            Cancel
          </Button>
          <Button onClick={handleBulkMigrateConfirm} variant="contained">
            Migrate
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
