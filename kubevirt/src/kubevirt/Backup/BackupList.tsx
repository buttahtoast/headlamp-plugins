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
  Typography,
} from '@mui/material';
import { Icon } from '@iconify/react';
import { useSnackbar } from 'notistack';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ResourceList, ResourceListColumn, SelectionToolbar } from '../components/ResourceList';
import VirtualMachine from '../VirtualMachines/VirtualMachine';

interface VeleroBackup {
  apiVersion: string;
  kind: string;
  metadata: {
    name: string;
    namespace: string;
    creationTimestamp: string;
    labels?: Record<string, string>;
  };
  spec: {
    includedNamespaces?: string[];
    includedResources?: string[];
    labelSelector?: {
      matchLabels?: Record<string, string>;
    };
    orLabelSelectors?: Array<{ matchLabels?: Record<string, string> }>;
    storageLocation?: string;
    ttl?: string;
    snapshotVolumes?: boolean;
    snapshotMoveData?: boolean;
    defaultVolumesToFsBackup?: boolean;
  };
  status?: {
    phase: string;
    startTimestamp?: string;
    completionTimestamp?: string;
    expiration?: string;
    errors?: number;
    warnings?: number;
  };
}

// Helper functions
const getVMName = (backup: VeleroBackup): string => {
  return backup.metadata.labels?.['kubevirt.io/vm'] ||
         backup.spec?.labelSelector?.matchLabels?.['kubevirt.io/vm'] ||
         backup.spec?.labelSelector?.matchLabels?.['vm.kubevirt.io/name'] ||
         backup.spec?.orLabelSelectors?.[0]?.matchLabels?.['vm.kubevirt.io/name'] ||
         '';
};

const getBackupNamespace = (backup: VeleroBackup): string => {
  return backup.metadata.labels?.['kubevirt.io/vm-namespace'] ||
         backup.spec?.includedNamespaces?.[0] ||
         '';
};

const getStatusColor = (phase: string): 'success' | 'error' | 'warning' | 'info' | 'default' => {
  switch (phase) {
    case 'Completed': return 'success';
    case 'Failed': return 'error';
    case 'FailedValidation': return 'error';
    case 'InProgress': return 'warning';
    case 'PartiallyFailed': return 'warning';
    case 'New': return 'info';
    default: return 'default';
  }
};

const formatDateTime = (dateStr?: string): string => {
  if (!dateStr) return '-';
  const date = new Date(dateStr);
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

export default function BackupList() {
  const { enqueueSnackbar } = useSnackbar();
  const [backups, setBackups] = useState<VeleroBackup[]>([]);
  const [loading, setLoading] = useState(true);
  const [veleroInstalled, setVeleroInstalled] = useState(true);
  const [backupDialogOpen, setBackupDialogOpen] = useState(false);
  const [selectedBackups, setSelectedBackups] = useState<VeleroBackup[]>([]);

  // Form state
  const [backupName, setBackupName] = useState('');
  const [selectedNamespace, setSelectedNamespace] = useState('');
  const [selectedVM, setSelectedVM] = useState('');
  const [snapshotVolumes, setSnapshotVolumes] = useState(true);
  const [snapshotMoveData, setSnapshotMoveData] = useState(true);
  const [ttl, setTtl] = useState('720h');

  // Fetch VMs
  const { items: vms } = VirtualMachine.useList({});

  // Fetch backups
  const fetchBackups = useCallback(async () => {
    try {
      const response = await ApiProxy.request('/apis/velero.io/v1/backups') as { items: VeleroBackup[] };
      setBackups(response.items || []);
      setVeleroInstalled(true);
      setLoading(false);
    } catch (error: any) {
      if (error.status === 404 || error.message?.includes('not found')) {
        setVeleroInstalled(false);
      }
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBackups();
    const interval = setInterval(fetchBackups, 10000);
    return () => clearInterval(interval);
  }, [fetchBackups]);

  // Get unique namespaces from VMs
  const namespaces = useMemo(() => {
    const nsSet = new Set<string>();
    vms?.forEach(vm => nsSet.add(vm.getNamespace()));
    return Array.from(nsSet).sort();
  }, [vms]);

  // Get VMs in selected namespace
  const filteredVMs = useMemo(() => {
    if (!vms || !selectedNamespace) return [];
    return vms.filter(vm => vm.getNamespace() === selectedNamespace);
  }, [vms, selectedNamespace]);

  // Get unique statuses for filter
  const statusOptions = useMemo(() => {
    const statuses = new Set<string>();
    backups.forEach(b => statuses.add(b.status?.phase || 'New'));
    return Array.from(statuses).sort();
  }, [backups]);

  // Column definitions
  const columns: ResourceListColumn<VeleroBackup>[] = useMemo(() => [
    {
      id: 'name',
      header: 'Name',
      accessorFn: (backup) => backup.metadata.name,
      Cell: ({ row }) => (
        <Link
          routeName="backup"
          params={{
            namespace: row.original.metadata.namespace,
            name: row.original.metadata.name,
          }}
        >
          {row.original.metadata.name}
        </Link>
      ),
      gridTemplate: '1.5fr',
    },
    {
      id: 'namespace',
      header: 'Namespace',
      accessorFn: (backup) => getBackupNamespace(backup),
      filterVariant: 'select',
      filterSelectOptions: Array.from(new Set(backups.map(b => getBackupNamespace(b)).filter(Boolean))),
    },
    {
      id: 'vm',
      header: 'VM',
      accessorFn: (backup) => getVMName(backup) || 'All VMs',
    },
    {
      id: 'status',
      header: 'Status',
      accessorFn: (backup) => backup.status?.phase || 'New',
      Cell: ({ row }) => {
        const phase = row.original.status?.phase || 'New';
        return <Chip label={phase} size="small" color={getStatusColor(phase)} />;
      },
      filterVariant: 'select',
      filterSelectOptions: statusOptions,
    },
    {
      id: 'started',
      header: 'Started',
      accessorFn: (backup) => backup.status?.startTimestamp ? new Date(backup.status.startTimestamp).getTime() : 0,
      Cell: ({ row }) => formatDateTime(row.original.status?.startTimestamp),
      enableColumnFilter: false,
    },
    {
      id: 'completed',
      header: 'Completed',
      accessorFn: (backup) => backup.status?.completionTimestamp ? new Date(backup.status.completionTimestamp).getTime() : 0,
      Cell: ({ row }) => formatDateTime(row.original.status?.completionTimestamp),
      enableColumnFilter: false,
      show: false,
    },
    {
      id: 'expires',
      header: 'Expires',
      accessorFn: (backup) => backup.status?.expiration ? new Date(backup.status.expiration).getTime() : 0,
      Cell: ({ row }) => row.original.status?.expiration
        ? new Date(row.original.status.expiration).toLocaleDateString()
        : '-',
      enableColumnFilter: false,
      show: false,
    },
    {
      id: 'errors',
      header: 'Errors',
      accessorFn: (backup) => (backup.status?.errors || 0) + (backup.status?.warnings || 0),
      Cell: ({ row }) => {
        const errors = row.original.status?.errors || 0;
        const warnings = row.original.status?.warnings || 0;
        if (errors === 0 && warnings === 0) return '-';
        return (
          <Box sx={{ display: 'flex', gap: 0.5 }}>
            {errors > 0 && <Chip label={errors} size="small" color="error" />}
            {warnings > 0 && <Chip label={warnings} size="small" color="warning" />}
          </Box>
        );
      },
      enableColumnFilter: false,
      show: false,
    },
  ], [backups, statusOptions]);

  // Create backup
  const handleCreateBackup = async () => {
    if (!backupName || !selectedNamespace) {
      enqueueSnackbar('Please fill required fields', { variant: 'warning' });
      return;
    }

    const spec: any = {
      includedNamespaces: [selectedNamespace],
      resourcePolicies: {
        kind: 'configmap',
        name: 'velero-volume-policies',
      },
      itemOperationTimeout: '6h0m0s',
      ttl: ttl,
    };

    if (snapshotVolumes) {
      spec.snapshotVolumes = true;
      if (snapshotMoveData) {
        spec.snapshotMoveData = true;
      }
    } else {
      spec.snapshotVolumes = false;
    }

    if (selectedVM) {
      spec.labelSelector = {
        matchLabels: {
          'kubevirt.io/vm': selectedVM,
        },
      };
    }

    const backup = {
      apiVersion: 'velero.io/v1',
      kind: 'Backup',
      metadata: {
        name: backupName,
        namespace: 'velero',
        labels: {
          'kubevirt.io/backup': 'true',
          'kubevirt.io/vm-namespace': selectedNamespace,
          ...(selectedVM && { 'kubevirt.io/vm': selectedVM }),
        },
      },
      spec,
    };

    try {
      await ApiProxy.request('/apis/velero.io/v1/namespaces/velero/backups', {
        method: 'POST',
        body: JSON.stringify(backup),
        headers: { 'Content-Type': 'application/json' },
      });

      enqueueSnackbar('Backup created successfully', { variant: 'success' });
      setBackupDialogOpen(false);
      resetForm();
      fetchBackups();
    } catch (error: any) {
      enqueueSnackbar(`Failed to create backup: ${error.message}`, { variant: 'error' });
    }
  };

  // Delete selected backups
  const handleDeleteSelected = async (items: VeleroBackup[]) => {
    let successCount = 0;
    let errorCount = 0;

    for (const backup of items) {
      try {
        const deleteRequest = {
          apiVersion: 'velero.io/v1',
          kind: 'DeleteBackupRequest',
          metadata: {
            name: `delete-${backup.metadata.name}-${Date.now()}`,
            namespace: 'velero',
          },
          spec: {
            backupName: backup.metadata.name,
          },
        };

        await ApiProxy.request('/apis/velero.io/v1/namespaces/velero/deletebackuprequests', {
          method: 'POST',
          body: JSON.stringify(deleteRequest),
          headers: { 'Content-Type': 'application/json' },
        });
        successCount++;
      } catch {
        errorCount++;
      }
    }

    if (successCount > 0) {
      enqueueSnackbar(`${successCount} backup(s) deletion requested`, { variant: 'success' });
    }
    if (errorCount > 0) {
      enqueueSnackbar(`Failed to delete ${errorCount} backup(s)`, { variant: 'error' });
    }

    fetchBackups();
  };

  const resetForm = () => {
    setBackupName('');
    setSelectedNamespace('');
    setSelectedVM('');
    setSnapshotVolumes(true);
    setSnapshotMoveData(true);
    setTtl('720h');
  };

  if (loading) {
    return (
      <Box sx={{ p: 3, display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 400 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!veleroInstalled) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography variant="h4" gutterBottom>Backups</Typography>
        <Paper variant="outlined" sx={{ p: 4, textAlign: 'center' }}>
          <Icon icon="mdi:alert-circle" width={64} color="#ed6c02" />
          <Typography variant="h6" sx={{ mt: 2 }}>
            Velero Not Installed
          </Typography>
          <Typography variant="body1" color="text.secondary" sx={{ mt: 1 }}>
            Velero is required for VM backup and restore functionality.
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
            Install Velero with the kubevirt-velero-plugin to enable backups.
          </Typography>
        </Paper>
      </Box>
    );
  }

  return (
    <>
      <ResourceList<VeleroBackup>
        title="Backups"
        data={backups}
        columns={columns}
        loading={loading}
        showNamespaceFilter={true}
        namespaceGetter={getBackupNamespace}
        enableRowSelection={true}
        onSelectionChange={setSelectedBackups}
        id="kubevirt-backups"
        defaultSortingColumn={{ id: 'started', desc: true }}
        emptyMessage="No backups found"
        toolbarAction={
          <Button
            variant="contained"
            startIcon={<Icon icon="mdi:plus" />}
            onClick={() => setBackupDialogOpen(true)}
          >
            Create Backup
          </Button>
        }
        renderRowSelectionToolbar={({ selectedRows, clearSelection }) => (
          <SelectionToolbar
            selectedRows={selectedRows}
            clearSelection={clearSelection}
            onDelete={handleDeleteSelected}
            deleteLabel="Delete Selected"
          />
        )}
      />

      {/* Create Backup Dialog */}
      <Dialog
        open={backupDialogOpen}
        onClose={() => setBackupDialogOpen(false)}
        maxWidth={false}
        PaperProps={{
          sx: {
            width: '100%',
            maxWidth: { xs: '95%', sm: 500, md: 600 },
            m: { xs: 1, sm: 2 },
          }
        }}
      >
        <DialogTitle>Create Backup</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
            <TextField
              label="Backup Name"
              value={backupName}
              onChange={(e) => setBackupName(e.target.value)}
              placeholder="my-vm-backup"
              fullWidth
              required
            />

            <FormControl fullWidth required>
              <InputLabel>Namespace</InputLabel>
              <Select
                value={selectedNamespace}
                label="Namespace"
                onChange={(e) => {
                  setSelectedNamespace(e.target.value);
                  setSelectedVM('');
                }}
              >
                {namespaces.map(ns => (
                  <MenuItem key={ns} value={ns}>{ns}</MenuItem>
                ))}
              </Select>
            </FormControl>

            <FormControl fullWidth>
              <InputLabel>Virtual Machine (optional)</InputLabel>
              <Select
                value={selectedVM}
                label="Virtual Machine (optional)"
                onChange={(e) => setSelectedVM(e.target.value)}
                disabled={!selectedNamespace}
              >
                <MenuItem value="">All VMs in namespace</MenuItem>
                {filteredVMs.map(vm => (
                  <MenuItem key={vm.getName()} value={vm.getName()}>
                    {vm.getName()}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <FormControlLabel
              control={
                <Switch
                  checked={snapshotVolumes}
                  onChange={(e) => setSnapshotVolumes(e.target.checked)}
                />
              }
              label="Snapshot Volumes (CSI snapshots)"
            />

            <FormControlLabel
              control={
                <Switch
                  checked={snapshotMoveData}
                  onChange={(e) => setSnapshotMoveData(e.target.checked)}
                  disabled={!snapshotVolumes}
                />
              }
              label="Move Snapshots to Object Storage (for DR)"
            />

            <FormControl fullWidth>
              <InputLabel>Retention (TTL)</InputLabel>
              <Select
                value={ttl}
                label="Retention (TTL)"
                onChange={(e) => setTtl(e.target.value)}
              >
                <MenuItem value="168h">7 days</MenuItem>
                <MenuItem value="720h">30 days</MenuItem>
                <MenuItem value="2160h">90 days</MenuItem>
                <MenuItem value="8760h">1 year</MenuItem>
              </Select>
            </FormControl>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setBackupDialogOpen(false); resetForm(); }}>Cancel</Button>
          <Button onClick={handleCreateBackup} variant="contained">Create Backup</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
