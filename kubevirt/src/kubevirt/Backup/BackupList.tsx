import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { Link, SectionBox, SimpleTable } from '@kinvolk/headlamp-plugin/lib/components/common';
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

export default function BackupList() {
  const { enqueueSnackbar } = useSnackbar();
  const [backups, setBackups] = useState<VeleroBackup[]>([]);
  const [loading, setLoading] = useState(true);
  const [veleroInstalled, setVeleroInstalled] = useState(true);
  const [backupDialogOpen, setBackupDialogOpen] = useState(false);

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
      // Sort by completion timestamp or creation timestamp, latest first
      const sorted = (response.items || []).sort((a, b) => {
        const dateA = new Date(a.status?.completionTimestamp || a.status?.startTimestamp || a.metadata.creationTimestamp);
        const dateB = new Date(b.status?.completionTimestamp || b.status?.startTimestamp || b.metadata.creationTimestamp);
        return dateB.getTime() - dateA.getTime();
      });
      setBackups(sorted);
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

  // Get unique namespaces
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

  // Create backup for KubeVirt VMs
  // The kubevirt-velero-plugin automatically includes associated DataVolumes/PVCs
  const handleCreateBackup = async () => {
    if (!backupName || !selectedNamespace) {
      enqueueSnackbar('Please fill required fields', { variant: 'warning' });
      return;
    }

    // Build spec matching the velero CLI format that works with kubevirt-velero-plugin
    const spec: any = {
      includedNamespaces: [selectedNamespace],
      resourcePolicies: {
        kind: 'configmap',
        name: 'velero-volume-policies',
      },
      itemOperationTimeout: '6h0m0s',
      ttl: ttl,
    };

    // Only add snapshot options if enabled
    if (snapshotVolumes) {
      spec.snapshotVolumes = true;
      if (snapshotMoveData) {
        spec.snapshotMoveData = true;
      }
    } else {
      spec.snapshotVolumes = false;
    }

    // When backing up a specific VM, use label selector with kubevirt.io/vm label
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

  // Delete backup using Velero's DeleteBackupRequest
  const handleDeleteBackup = async (backup: VeleroBackup) => {
    try {
      // Create a DeleteBackupRequest to properly delete the backup and its data
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

      enqueueSnackbar('Backup deletion requested', { variant: 'success' });
      fetchBackups();
    } catch (error: any) {
      enqueueSnackbar(`Failed to delete backup: ${error.message}`, { variant: 'error' });
    }
  };

  const resetForm = () => {
    setBackupName('');
    setSelectedNamespace('');
    setSelectedVM('');
    setSnapshotVolumes(true);
    setSnapshotMoveData(true);
    setTtl('720h');
  };

  // Get status color
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

  // Get VM name from backup
  const getVMName = (backup: VeleroBackup): string => {
    return backup.metadata.labels?.['kubevirt.io/vm'] ||
           backup.spec?.labelSelector?.matchLabels?.['kubevirt.io/vm'] ||
           backup.spec?.labelSelector?.matchLabels?.['vm.kubevirt.io/name'] ||
           backup.spec?.orLabelSelectors?.[0]?.matchLabels?.['vm.kubevirt.io/name'] ||
           '';
  };

  // Get namespace from backup
  const getBackupNamespace = (backup: VeleroBackup): string => {
    return backup.metadata.labels?.['kubevirt.io/vm-namespace'] ||
           backup.spec?.includedNamespaces?.[0] ||
           '';
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
      <SectionBox
        title="Backups"
        headerProps={{
          actions: [
            <Button
              key="create"
              variant="contained"
              startIcon={<Icon icon="mdi:plus" />}
              onClick={() => setBackupDialogOpen(true)}
            >
              Create Backup
            </Button>,
          ],
        }}
      >
        <SimpleTable
          columns={[
            {
              label: 'Name',
              getter: (backup: VeleroBackup) => (
                <Link
                  routeName="backup"
                  params={{
                    namespace: backup.metadata.namespace,
                    name: backup.metadata.name,
                  }}
                >
                  {backup.metadata.name}
                </Link>
              ),
            },
            {
              label: 'VM Namespace',
              getter: (backup: VeleroBackup) => {
                const ns = getBackupNamespace(backup);
                return ns || '-';
              },
            },
            {
              label: 'VM',
              getter: (backup: VeleroBackup) => {
                const vmName = getVMName(backup);
                return vmName || 'All VMs';
              },
            },
            {
              label: 'Status',
              getter: (backup: VeleroBackup) => (
                <Chip
                  label={backup.status?.phase || 'New'}
                  size="small"
                  color={getStatusColor(backup.status?.phase || '')}
                />
              ),
            },
            {
              label: 'Started',
              getter: (backup: VeleroBackup) =>
                backup.status?.startTimestamp
                  ? new Date(backup.status.startTimestamp).toLocaleString()
                  : '-',
            },
            {
              label: 'Completed',
              getter: (backup: VeleroBackup) =>
                backup.status?.completionTimestamp
                  ? new Date(backup.status.completionTimestamp).toLocaleString()
                  : '-',
            },
            {
              label: 'Expires',
              getter: (backup: VeleroBackup) =>
                backup.status?.expiration
                  ? new Date(backup.status.expiration).toLocaleDateString()
                  : '-',
            },
            {
              label: 'Errors',
              getter: (backup: VeleroBackup) => {
                const errors = backup.status?.errors || 0;
                const warnings = backup.status?.warnings || 0;
                if (errors > 0 || warnings > 0) {
                  return (
                    <Box sx={{ display: 'flex', gap: 0.5 }}>
                      {errors > 0 && <Chip label={errors} size="small" color="error" />}
                      {warnings > 0 && <Chip label={warnings} size="small" color="warning" />}
                    </Box>
                  );
                }
                return '-';
              },
            },
            {
              label: 'Actions',
              getter: (backup: VeleroBackup) => (
                <Button
                  size="small"
                  color="error"
                  onClick={() => handleDeleteBackup(backup)}
                  startIcon={<Icon icon="mdi:delete" />}
                >
                  Delete
                </Button>
              ),
            },
          ]}
          data={backups}
          emptyMessage="No backups found"
        />
      </SectionBox>

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
