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
  InputLabel,
  MenuItem,
  Paper,
  Select,
  TextField,
  Typography,
} from '@mui/material';
import { Icon } from '@iconify/react';
import { useSnackbar } from 'notistack';
import { useCallback, useEffect, useState } from 'react';

interface VeleroRestore {
  apiVersion: string;
  kind: string;
  metadata: {
    name: string;
    namespace: string;
    creationTimestamp: string;
    labels?: Record<string, string>;
  };
  spec: {
    backupName: string;
    includedNamespaces?: string[];
    excludedNamespaces?: string[];
    namespaceMapping?: Record<string, string>;
  };
  status?: {
    phase: string;
    startTimestamp?: string;
    completionTimestamp?: string;
    errors?: number;
    warnings?: number;
    failureReason?: string;
  };
}

interface VeleroBackup {
  metadata: {
    name: string;
    namespace: string;
    labels?: Record<string, string>;
  };
  spec: {
    includedNamespaces?: string[];
  };
  status?: {
    phase: string;
  };
}

export default function RestoreList() {
  const { enqueueSnackbar } = useSnackbar();
  const [restores, setRestores] = useState<VeleroRestore[]>([]);
  const [backups, setBackups] = useState<VeleroBackup[]>([]);
  const [loading, setLoading] = useState(true);
  const [veleroInstalled, setVeleroInstalled] = useState(true);
  const [restoreDialogOpen, setRestoreDialogOpen] = useState(false);

  // Form state
  const [selectedBackup, setSelectedBackup] = useState('');
  const [restoreNamespace, setRestoreNamespace] = useState('');

  // Fetch restores and backups
  const fetchData = useCallback(async () => {
    try {
      const [restoresResponse, backupsResponse] = await Promise.all([
        ApiProxy.request('/apis/velero.io/v1/restores') as Promise<{ items: VeleroRestore[] }>,
        ApiProxy.request('/apis/velero.io/v1/backups') as Promise<{ items: VeleroBackup[] }>,
      ]);

      // Sort restores by start timestamp or creation timestamp, latest first
      const sortedRestores = (restoresResponse.items || []).sort((a, b) => {
        const dateA = new Date(a.status?.startTimestamp || a.metadata.creationTimestamp);
        const dateB = new Date(b.status?.startTimestamp || b.metadata.creationTimestamp);
        return dateB.getTime() - dateA.getTime();
      });

      setRestores(sortedRestores);
      setBackups(backupsResponse.items || []);
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
    fetchData();
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, [fetchData]);

  // Create restore
  const handleCreateRestore = async () => {
    if (!selectedBackup) {
      enqueueSnackbar('Please select a backup', { variant: 'warning' });
      return;
    }

    const backup = backups.find(b => b.metadata.name === selectedBackup);
    const restoreName = `${selectedBackup}-restore-${Date.now()}`;

    const restore: any = {
      apiVersion: 'velero.io/v1',
      kind: 'Restore',
      metadata: {
        name: restoreName,
        namespace: 'velero',
      },
      spec: {
        backupName: selectedBackup,
      },
    };

    if (restoreNamespace && backup?.spec?.includedNamespaces?.[0]) {
      restore.spec.namespaceMapping = {
        [backup.spec.includedNamespaces[0]]: restoreNamespace,
      };
    }

    try {
      await ApiProxy.request('/apis/velero.io/v1/namespaces/velero/restores', {
        method: 'POST',
        body: JSON.stringify(restore),
        headers: { 'Content-Type': 'application/json' },
      });

      enqueueSnackbar('Restore initiated successfully', { variant: 'success' });
      setRestoreDialogOpen(false);
      resetForm();
      fetchData();
    } catch (error: any) {
      enqueueSnackbar(`Failed to create restore: ${error.message}`, { variant: 'error' });
    }
  };

  // Delete restore
  const handleDeleteRestore = async (restore: VeleroRestore) => {
    try {
      await ApiProxy.request(
        `/apis/velero.io/v1/namespaces/${restore.metadata.namespace}/restores/${restore.metadata.name}`,
        { method: 'DELETE' }
      );
      enqueueSnackbar('Restore deleted successfully', { variant: 'success' });
      fetchData();
    } catch (error: any) {
      enqueueSnackbar(`Failed to delete restore: ${error.message}`, { variant: 'error' });
    }
  };

  const resetForm = () => {
    setSelectedBackup('');
    setRestoreNamespace('');
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

  // Get completed backups for restore
  const completedBackups = backups.filter(b => b.status?.phase === 'Completed');

  // Format duration
  const formatDuration = (start?: string, end?: string): string => {
    if (!start) return '-';
    const startDate = new Date(start);
    const endDate = end ? new Date(end) : new Date();
    const diffMs = endDate.getTime() - startDate.getTime();
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHour = Math.floor(diffMin / 60);

    if (diffHour > 0) return `${diffHour}h ${diffMin % 60}m`;
    if (diffMin > 0) return `${diffMin}m ${diffSec % 60}s`;
    return `${diffSec}s`;
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
        <Typography variant="h4" gutterBottom>Restores</Typography>
        <Paper variant="outlined" sx={{ p: 4, textAlign: 'center' }}>
          <Icon icon="mdi:alert-circle" width={64} color="#ed6c02" />
          <Typography variant="h6" sx={{ mt: 2 }}>
            Velero Not Installed
          </Typography>
          <Typography variant="body1" color="text.secondary" sx={{ mt: 1 }}>
            Velero is required for restore functionality.
          </Typography>
        </Paper>
      </Box>
    );
  }

  return (
    <>
      <SectionBox
        title="Restores"
        headerProps={{
          actions: [
            <Button
              key="create"
              variant="contained"
              startIcon={<Icon icon="mdi:restore" />}
              onClick={() => setRestoreDialogOpen(true)}
              disabled={completedBackups.length === 0}
            >
              Create Restore
            </Button>,
          ],
        }}
      >
        <SimpleTable
          columns={[
            {
              label: 'Name',
              getter: (restore: VeleroRestore) => restore.metadata.name,
            },
            {
              label: 'Backup',
              getter: (restore: VeleroRestore) => (
                <Link
                  routeName="backup"
                  params={{
                    namespace: 'velero',
                    name: restore.spec.backupName,
                  }}
                >
                  {restore.spec.backupName}
                </Link>
              ),
            },
            {
              label: 'Status',
              getter: (restore: VeleroRestore) => (
                <Chip
                  label={restore.status?.phase || 'New'}
                  size="small"
                  color={getStatusColor(restore.status?.phase || '')}
                />
              ),
            },
            {
              label: 'Namespace Mapping',
              getter: (restore: VeleroRestore) => {
                const mapping = restore.spec?.namespaceMapping;
                if (!mapping || Object.keys(mapping).length === 0) {
                  return 'Same namespace';
                }
                return (
                  <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                    {Object.entries(mapping).map(([from, to]) => (
                      <Chip
                        key={from}
                        label={`${from} → ${to}`}
                        size="small"
                        variant="outlined"
                      />
                    ))}
                  </Box>
                );
              },
            },
            {
              label: 'Started',
              getter: (restore: VeleroRestore) =>
                restore.status?.startTimestamp
                  ? new Date(restore.status.startTimestamp).toLocaleString()
                  : '-',
            },
            {
              label: 'Duration',
              getter: (restore: VeleroRestore) =>
                formatDuration(restore.status?.startTimestamp, restore.status?.completionTimestamp),
            },
            {
              label: 'Errors',
              getter: (restore: VeleroRestore) => {
                const errors = restore.status?.errors || 0;
                const warnings = restore.status?.warnings || 0;
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
              getter: (restore: VeleroRestore) => (
                <Button
                  size="small"
                  color="error"
                  onClick={() => handleDeleteRestore(restore)}
                  startIcon={<Icon icon="mdi:delete" />}
                >
                  Delete
                </Button>
              ),
            },
          ]}
          data={restores}
          emptyMessage="No restores found"
        />
      </SectionBox>

      {/* Create Restore Dialog */}
      <Dialog
        open={restoreDialogOpen}
        onClose={() => setRestoreDialogOpen(false)}
        maxWidth={false}
        PaperProps={{
          sx: {
            width: '100%',
            maxWidth: { xs: '95%', sm: 500, md: 600 },
            m: { xs: 1, sm: 2 },
          }
        }}
      >
        <DialogTitle>Create Restore</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
            <FormControl fullWidth required>
              <InputLabel>Backup</InputLabel>
              <Select
                value={selectedBackup}
                label="Backup"
                onChange={(e) => setSelectedBackup(e.target.value)}
              >
                {completedBackups.map(backup => (
                  <MenuItem key={backup.metadata.name} value={backup.metadata.name}>
                    {backup.metadata.name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <TextField
              label="Target Namespace (optional)"
              value={restoreNamespace}
              onChange={(e) => setRestoreNamespace(e.target.value)}
              placeholder="Leave empty to restore to original namespace"
              fullWidth
              helperText="Specify a different namespace to restore to, or leave empty for original"
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setRestoreDialogOpen(false); resetForm(); }}>Cancel</Button>
          <Button onClick={handleCreateRestore} variant="contained">Create Restore</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
