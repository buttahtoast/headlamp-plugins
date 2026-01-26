import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { Link, SectionBox } from '@kinvolk/headlamp-plugin/lib/components/common';
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
  MenuItem,
  Paper,
  Select,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { Icon } from '@iconify/react';
import { useSnackbar } from 'notistack';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  createRestore,
  filterBackupsForVM,
  getVeleroStatusColor,
  getVMNameFromBackup,
} from '../utils/velero';

export interface BackupSectionProps {
  vmName: string;
  namespace: string;
}

export default function BackupSection({ vmName, namespace }: BackupSectionProps) {
  const { t } = useTranslation('glossary');
  const { enqueueSnackbar } = useSnackbar();
  const [backups, setBackups] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [veleroInstalled, setVeleroInstalled] = useState(true);
  const [backupDialogOpen, setBackupDialogOpen] = useState(false);
  const [restoreDialogOpen, setRestoreDialogOpen] = useState(false);
  const [selectedBackup, setSelectedBackup] = useState<any>(null);
  const [backupName, setBackupName] = useState('');
  const [snapshotVolumes, setSnapshotVolumes] = useState(true);
  const [snapshotMoveData, setSnapshotMoveData] = useState(true);
  const [ttl, setTtl] = useState('720h');
  const [restoreNamespace, setRestoreNamespace] = useState('');
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(5);

  // Fetch and sort backups
  const fetchAndSetBackups = async () => {
    try {
      const response = await ApiProxy.request('/apis/velero.io/v1/backups') as { items: any[] };
      const vmBackups = filterBackupsForVM(response.items || [], vmName, namespace);
      vmBackups.sort((a, b) => {
        const dateA = new Date(a.metadata?.creationTimestamp || 0).getTime();
        const dateB = new Date(b.metadata?.creationTimestamp || 0).getTime();
        return dateB - dateA;
      });
      setBackups(vmBackups);
      setVeleroInstalled(true);
      setLoading(false);
    } catch (error: any) {
      if (error.status === 404 || error.message?.includes('not found')) {
        setVeleroInstalled(false);
      }
      setLoading(false);
    }
  };

  // Fetch backups for this VM
  useEffect(() => {
    fetchAndSetBackups();
    const interval = setInterval(fetchAndSetBackups, 15000);
    return () => clearInterval(interval);
  }, [vmName, namespace]);

  // Paginated backups
  const paginatedBackups = useMemo(() => {
    const start = page * rowsPerPage;
    return backups.slice(start, start + rowsPerPage);
  }, [backups, page, rowsPerPage]);

  const handleCreateBackup = async () => {
    if (!backupName) {
      enqueueSnackbar('Please provide a backup name', { variant: 'warning' });
      return;
    }

    const spec: any = {
      includedNamespaces: [namespace],
      labelSelector: {
        matchLabels: {
          'kubevirt.io/vm': vmName,
        },
      },
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

    const backup = {
      apiVersion: 'velero.io/v1',
      kind: 'Backup',
      metadata: {
        name: backupName,
        namespace: 'velero',
        labels: {
          'kubevirt.io/backup': 'true',
          'kubevirt.io/vm': vmName,
          'kubevirt.io/vm-namespace': namespace,
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
      setBackupName('');
      setPage(0);
      fetchAndSetBackups();
    } catch (error: any) {
      enqueueSnackbar(`Failed to create backup: ${error.message}`, { variant: 'error' });
    }
  };

  const handleRestore = async () => {
    if (!selectedBackup) return;

    try {
      await createRestore({
        backup: selectedBackup,
        vmName,
        targetNamespace: restoreNamespace || undefined,
      });

      enqueueSnackbar('Restore initiated successfully', { variant: 'success' });
      setRestoreDialogOpen(false);
      setSelectedBackup(null);
      setRestoreNamespace('');
    } catch (error: any) {
      enqueueSnackbar(`Failed to restore: ${error.message}`, { variant: 'error' });
    }
  };

  const handleDeleteBackup = async (backup: any) => {
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

      enqueueSnackbar('Backup deletion requested', { variant: 'success' });
      setBackups(backups.filter(b => b.metadata.name !== backup.metadata.name));
    } catch (error: any) {
      enqueueSnackbar(`Failed to delete: ${error.message}`, { variant: 'error' });
    }
  };

  if (!veleroInstalled) {
    return (
      <SectionBox title={t('Backups')}>
        <Paper variant="outlined" sx={{ p: 2, textAlign: 'center' }}>
          <Icon icon="mdi:alert-circle" width={32} color="#ed6c02" />
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            Velero is not installed. Install Velero to enable VM backups.
          </Typography>
        </Paper>
      </SectionBox>
    );
  }

  return (
    <SectionBox title={t('Backups')}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="body2" color="text.secondary">
          Velero backups for this VM
        </Typography>
        <Button
          variant="outlined"
          size="small"
          startIcon={<Icon icon="mdi:backup-restore" />}
          onClick={() => {
            setBackupName(`${vmName}-backup-${Date.now()}`);
            setBackupDialogOpen(true);
          }}
        >
          Create Backup
        </Button>
      </Box>

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
          <CircularProgress size={24} />
        </Box>
      ) : backups.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 2, textAlign: 'center' }}>
          <Typography variant="body2" color="text.secondary">
            No backups found for this VM
          </Typography>
        </Paper>
      ) : (
        <Paper variant="outlined">
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Name</TableCell>
                  <TableCell>Type</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Created</TableCell>
                  <TableCell>Expires</TableCell>
                  <TableCell>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {paginatedBackups.map(backup => {
                  const backupVMName = getVMNameFromBackup(backup);
                  const isVMSpecific = backupVMName === vmName;
                  return (
                    <TableRow key={backup.metadata.name}>
                      <TableCell>
                        <Link
                          routeName="backup"
                          params={{
                            namespace: backup.metadata.namespace,
                            name: backup.metadata.name,
                          }}
                        >
                          {backup.metadata.name}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={isVMSpecific ? 'VM' : 'Namespace'}
                          size="small"
                          variant="outlined"
                          color={isVMSpecific ? 'primary' : 'default'}
                        />
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={backup.status?.phase || 'Pending'}
                          size="small"
                          color={getVeleroStatusColor(backup.status?.phase || '')}
                        />
                      </TableCell>
                      <TableCell>
                        {backup.metadata.creationTimestamp ?
                          new Date(backup.metadata.creationTimestamp).toLocaleString() : '-'}
                      </TableCell>
                      <TableCell>
                        {backup.status?.expiration ?
                          new Date(backup.status.expiration).toLocaleDateString() : '-'}
                      </TableCell>
                      <TableCell>
                        <Box sx={{ display: 'flex', gap: 0.5 }}>
                          <Tooltip title="Restore from backup">
                            <IconButton
                              size="small"
                              color="primary"
                              onClick={() => {
                                setSelectedBackup(backup);
                                setRestoreDialogOpen(true);
                              }}
                              disabled={backup.status?.phase !== 'Completed'}
                            >
                              <Icon icon="mdi:restore" />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title="Delete backup">
                            <IconButton
                              size="small"
                              color="error"
                              onClick={() => handleDeleteBackup(backup)}
                            >
                              <Icon icon="mdi:delete" />
                            </IconButton>
                          </Tooltip>
                        </Box>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
          {backups.length > 5 && (
            <TablePagination
              component="div"
              count={backups.length}
              page={page}
              onPageChange={(_, newPage) => setPage(newPage)}
              rowsPerPage={rowsPerPage}
              onRowsPerPageChange={(e) => {
                setRowsPerPage(parseInt(e.target.value, 10));
                setPage(0);
              }}
              rowsPerPageOptions={[5, 10, 25]}
            />
          )}
        </Paper>
      )}

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
            <Typography variant="body2" color="text.secondary">
              Create a Velero backup of VM "{vmName}"
            </Typography>
            <TextField
              label="Backup Name"
              value={backupName}
              onChange={(e) => setBackupName(e.target.value)}
              fullWidth
              required
            />
            <FormControlLabel
              control={
                <Switch
                  checked={snapshotVolumes}
                  onChange={(e) => setSnapshotVolumes(e.target.checked)}
                />
              }
              label="Snapshot Volumes"
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
              <Select value={ttl} label="Retention (TTL)" onChange={(e) => setTtl(e.target.value)}>
                <MenuItem value="168h">7 days</MenuItem>
                <MenuItem value="720h">30 days</MenuItem>
                <MenuItem value="2160h">90 days</MenuItem>
                <MenuItem value="8760h">1 year</MenuItem>
              </Select>
            </FormControl>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setBackupDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleCreateBackup} variant="contained">Create Backup</Button>
        </DialogActions>
      </Dialog>

      {/* Restore Dialog */}
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
        <DialogTitle>Restore from Backup</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
            <Typography variant="body2">
              Restoring from backup: <strong>{selectedBackup?.metadata.name}</strong>
            </Typography>
            <TextField
              label="Target Namespace (optional)"
              value={restoreNamespace}
              onChange={(e) => setRestoreNamespace(e.target.value)}
              placeholder="Leave empty to restore to original namespace"
              fullWidth
              helperText="Optionally restore to a different namespace"
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setRestoreDialogOpen(false); setSelectedBackup(null); }}>Cancel</Button>
          <Button onClick={handleRestore} variant="contained" color="warning">Restore</Button>
        </DialogActions>
      </Dialog>
    </SectionBox>
  );
}
