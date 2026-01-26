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
  InputLabel,
  MenuItem,
  Paper,
  Select,
  TextField,
  Typography,
} from '@mui/material';
import { Icon } from '@iconify/react';
import { useSnackbar } from 'notistack';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ResourceList, ResourceListColumn, SelectionToolbar } from '../components/ResourceList';
import {
  VeleroBackup,
  VeleroRestore,
  createRestore,
  getVeleroStatusColor,
  formatVeleroDateTime,
  formatVeleroDuration,
} from '../utils/velero';

const getDurationMs = (restore: VeleroRestore): number => {
  if (!restore.status?.startTimestamp) return 0;
  const start = new Date(restore.status.startTimestamp).getTime();
  const end = restore.status.completionTimestamp
    ? new Date(restore.status.completionTimestamp).getTime()
    : Date.now();
  return end - start;
};

export default function RestoreList() {
  const { enqueueSnackbar } = useSnackbar();
  const [restores, setRestores] = useState<VeleroRestore[]>([]);
  const [backups, setBackups] = useState<VeleroBackup[]>([]);
  const [loading, setLoading] = useState(true);
  const [veleroInstalled, setVeleroInstalled] = useState(true);
  const [restoreDialogOpen, setRestoreDialogOpen] = useState(false);
  const [selectedRestores, setSelectedRestores] = useState<VeleroRestore[]>([]);

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

      setRestores(restoresResponse.items || []);
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

  // Get completed backups for restore
  const completedBackups = backups.filter(b => b.status?.phase === 'Completed');

  // Get unique statuses for filter
  const statusOptions = useMemo(() => {
    const statuses = new Set<string>();
    restores.forEach(r => statuses.add(r.status?.phase || 'New'));
    return Array.from(statuses).sort();
  }, [restores]);

  // Column definitions
  const columns: ResourceListColumn<VeleroRestore>[] = useMemo(() => [
    {
      id: 'name',
      header: 'Name',
      accessorFn: (restore) => restore.metadata.name,
      Cell: ({ row }) => (
        <Link
          routeName="restore"
          params={{ name: row.original.metadata.name }}
        >
          {row.original.metadata.name}
        </Link>
      ),
      gridTemplate: '1.5fr',
    },
    {
      id: 'backup',
      header: 'Backup',
      accessorFn: (restore) => restore.spec.backupName,
      Cell: ({ row }) => (
        <Link
          routeName="backup"
          params={{
            namespace: 'velero',
            name: row.original.spec.backupName,
          }}
        >
          {row.original.spec.backupName}
        </Link>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      accessorFn: (restore) => restore.status?.phase || 'New',
      Cell: ({ row }) => {
        const phase = row.original.status?.phase || 'New';
        return <Chip label={phase} size="small" color={getVeleroStatusColor(phase)} />;
      },
      filterVariant: 'select',
      filterSelectOptions: statusOptions,
    },
    {
      id: 'mapping',
      header: 'Namespace Mapping',
      accessorFn: (restore) => {
        const mapping = restore.spec?.namespaceMapping;
        if (!mapping || Object.keys(mapping).length === 0) return 'Same namespace';
        return Object.entries(mapping).map(([from, to]) => `${from} → ${to}`).join(', ');
      },
      Cell: ({ row }) => {
        const mapping = row.original.spec?.namespaceMapping;
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
      enableColumnFilter: false,
      enableSorting: false,
    },
    {
      id: 'started',
      header: 'Started',
      accessorFn: (restore) => restore.status?.startTimestamp ? new Date(restore.status.startTimestamp).getTime() : 0,
      Cell: ({ row }) => formatVeleroDateTime(row.original.status?.startTimestamp),
      enableColumnFilter: false,
    },
    {
      id: 'duration',
      header: 'Duration',
      accessorFn: (restore) => getDurationMs(restore),
      Cell: ({ row }) => formatVeleroDuration(row.original.status?.startTimestamp, row.original.status?.completionTimestamp),
      enableColumnFilter: false,
      show: false,
    },
    {
      id: 'errors',
      header: 'Errors',
      accessorFn: (restore) => (restore.status?.errors || 0) + (restore.status?.warnings || 0),
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
  ], [statusOptions]);

  // Create restore
  const handleCreateRestore = async () => {
    if (!selectedBackup) {
      enqueueSnackbar('Please select a backup', { variant: 'warning' });
      return;
    }

    const backup = backups.find(b => b.metadata.name === selectedBackup);
    if (!backup) {
      enqueueSnackbar('Backup not found', { variant: 'error' });
      return;
    }

    try {
      await createRestore({
        backup,
        targetNamespace: restoreNamespace || undefined,
      });

      enqueueSnackbar('Restore initiated successfully', { variant: 'success' });
      setRestoreDialogOpen(false);
      resetForm();
      fetchData();
    } catch (error: any) {
      enqueueSnackbar(`Failed to create restore: ${error.message}`, { variant: 'error' });
    }
  };

  // Delete selected restores
  const handleDeleteSelected = async (items: VeleroRestore[]) => {
    let successCount = 0;
    let errorCount = 0;

    for (const restore of items) {
      try {
        await ApiProxy.request(
          `/apis/velero.io/v1/namespaces/${restore.metadata.namespace}/restores/${restore.metadata.name}`,
          { method: 'DELETE' }
        );
        successCount++;
      } catch {
        errorCount++;
      }
    }

    if (successCount > 0) {
      enqueueSnackbar(`${successCount} restore(s) deleted`, { variant: 'success' });
    }
    if (errorCount > 0) {
      enqueueSnackbar(`Failed to delete ${errorCount} restore(s)`, { variant: 'error' });
    }

    fetchData();
  };

  const resetForm = () => {
    setSelectedBackup('');
    setRestoreNamespace('');
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
      <ResourceList<VeleroRestore>
        title="Restores"
        data={restores}
        columns={columns}
        loading={loading}
        enableRowSelection={true}
        onSelectionChange={setSelectedRestores}
        id="kubevirt-restores"
        defaultSortingColumn={{ id: 'started', desc: true }}
        emptyMessage="No restores found"
        toolbarAction={
          <Button
            variant="contained"
            startIcon={<Icon icon="mdi:restore" />}
            onClick={() => setRestoreDialogOpen(true)}
            disabled={completedBackups.length === 0}
          >
            Create Restore
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
