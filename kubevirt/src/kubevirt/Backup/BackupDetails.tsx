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
  Grid,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { Icon } from '@iconify/react';
import { useSnackbar } from 'notistack';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import {
  VeleroBackup,
  VeleroRestore,
  createRestore,
  getVeleroStatusColor,
  formatVeleroDuration,
} from '../utils/velero';

export default function BackupDetails() {
  const { t } = useTranslation('glossary');
  const { enqueueSnackbar } = useSnackbar();
  const { namespace, name } = useParams<{ namespace: string; name: string }>();
  const [backup, setBackup] = useState<VeleroBackup | null>(null);
  const [relatedRestores, setRelatedRestores] = useState<VeleroRestore[]>([]);
  const [loading, setLoading] = useState(true);
  const [restoreDialogOpen, setRestoreDialogOpen] = useState(false);
  const [restoreNamespace, setRestoreNamespace] = useState('');
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  // Fetch backup details
  useEffect(() => {
    const fetchBackup = async () => {
      try {
        const backupResponse = await ApiProxy.request(
          `/apis/velero.io/v1/namespaces/${namespace}/backups/${name}`
        ) as VeleroBackup;
        setBackup(backupResponse);

        // Fetch related restores
        const restoresResponse = await ApiProxy.request('/apis/velero.io/v1/restores') as { items: VeleroRestore[] };
        const related = restoresResponse.items?.filter(r => r.spec.backupName === name) || [];
        setRelatedRestores(related);

        setLoading(false);
      } catch (error: any) {
        console.error('Failed to fetch backup:', error);
        enqueueSnackbar(`Failed to fetch backup: ${error.message}`, { variant: 'error' });
        setLoading(false);
      }
    };

    fetchBackup();
    const interval = setInterval(fetchBackup, 10000);
    return () => clearInterval(interval);
  }, [namespace, name]);

  // Create restore from this backup
  const handleCreateRestore = async () => {
    if (!backup) return;

    try {
      await createRestore({
        backup,
        targetNamespace: restoreNamespace || undefined,
      });

      enqueueSnackbar('Restore initiated successfully', { variant: 'success' });
      setRestoreDialogOpen(false);
      setRestoreNamespace('');

      // Refresh restores
      const response = await ApiProxy.request('/apis/velero.io/v1/restores') as { items: VeleroRestore[] };
      const related = response.items?.filter(r => r.spec.backupName === name) || [];
      setRelatedRestores(related);
    } catch (error: any) {
      enqueueSnackbar(`Failed to create restore: ${error.message}`, { variant: 'error' });
    }
  };

  // Delete backup
  const handleDeleteBackup = async () => {
    if (!backup) return;

    try {
      await ApiProxy.request(
        `/apis/velero.io/v1/namespaces/${backup.metadata.namespace}/backups/${backup.metadata.name}`,
        { method: 'DELETE' }
      );
      enqueueSnackbar('Backup deleted successfully', { variant: 'success' });
      setDeleteDialogOpen(false);
      // Navigate back to backup list
      window.history.back();
    } catch (error: any) {
      enqueueSnackbar(`Failed to delete backup: ${error.message}`, { variant: 'error' });
    }
  };


  // Format relative time
  const formatRelativeTime = (timestamp?: string): string => {
    if (!timestamp) return '-';
    const now = new Date();
    const date = new Date(timestamp);
    const diffMs = now.getTime() - date.getTime();
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHour = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHour / 24);

    if (diffDay > 0) return `${diffDay} days ago`;
    if (diffHour > 0) return `${diffHour} hours ago`;
    if (diffMin > 0) return `${diffMin} minutes ago`;
    return `${diffSec} seconds ago`;
  };

  if (loading) {
    return (
      <Box sx={{ p: 3, display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 400 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!backup) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography variant="h4" gutterBottom>Backup Not Found</Typography>
        <Paper variant="outlined" sx={{ p: 4, textAlign: 'center' }}>
          <Icon icon="mdi:alert-circle" width={64} color="#ed6c02" />
          <Typography variant="h6" sx={{ mt: 2 }}>
            Backup "{name}" not found
          </Typography>
          <Button
            variant="outlined"
            sx={{ mt: 2 }}
            onClick={() => window.history.back()}
          >
            Go Back
          </Button>
        </Paper>
      </Box>
    );
  }

  const vmName = backup.metadata.labels?.['kubevirt.io/vm'] || backup.spec?.labelSelector?.matchLabels?.['kubevirt.io/vm'];
  const vmNamespace = backup.spec?.includedNamespaces?.[0];

  return (
    <Box sx={{ p: 3 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 3 }}>
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Icon icon="mdi:backup-restore" width={32} />
            <Typography variant="h4">{backup.metadata.name}</Typography>
            <Chip
              label={backup.status?.phase || 'Unknown'}
              color={getVeleroStatusColor(backup.status?.phase || '')}
              size="small"
            />
          </Box>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            Created {formatRelativeTime(backup.metadata.creationTimestamp)}
            {vmName && (
              <> for VM <Link
                routeName="virtualmachine"
                params={{ name: vmName, namespace: vmNamespace || '' }}
              >
                {vmName}
              </Link></>
            )}
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button
            variant="contained"
            startIcon={<Icon icon="mdi:restore" />}
            onClick={() => setRestoreDialogOpen(true)}
            disabled={backup.status?.phase !== 'Completed'}
          >
            Restore
          </Button>
          <Button
            variant="contained"
            color="error"
            startIcon={<Icon icon="mdi:delete" />}
            onClick={() => setDeleteDialogOpen(true)}
            sx={{ whiteSpace: 'nowrap' }}
          >
            Delete
          </Button>
        </Box>
      </Box>

      {/* Status Summary */}
      <SectionBox title={t('Status')}>
        <Grid container spacing={2}>
          <Grid item xs={12} md={3}>
            <Paper variant="outlined" sx={{ p: 2, textAlign: 'center' }}>
              <Typography variant="subtitle2" color="text.secondary">Phase</Typography>
              <Chip
                label={backup.status?.phase || 'Unknown'}
                color={getVeleroStatusColor(backup.status?.phase || '')}
                sx={{ mt: 1 }}
              />
            </Paper>
          </Grid>
          <Grid item xs={12} md={3}>
            <Paper variant="outlined" sx={{ p: 2, textAlign: 'center' }}>
              <Typography variant="subtitle2" color="text.secondary">Duration</Typography>
              <Typography variant="h6" sx={{ mt: 1 }}>
                {formatVeleroDuration(backup.status?.startTimestamp, backup.status?.completionTimestamp)}
              </Typography>
            </Paper>
          </Grid>
          <Grid item xs={12} md={3}>
            <Paper variant="outlined" sx={{ p: 2, textAlign: 'center' }}>
              <Typography variant="subtitle2" color="text.secondary">Errors / Warnings</Typography>
              <Box sx={{ display: 'flex', justifyContent: 'center', gap: 1, mt: 1 }}>
                <Chip
                  icon={<Icon icon="mdi:alert-circle" />}
                  label={backup.status?.errors || 0}
                  color={backup.status?.errors ? 'error' : 'default'}
                  size="small"
                />
                <Chip
                  icon={<Icon icon="mdi:alert" />}
                  label={backup.status?.warnings || 0}
                  color={backup.status?.warnings ? 'warning' : 'default'}
                  size="small"
                />
              </Box>
            </Paper>
          </Grid>
          <Grid item xs={12} md={3}>
            <Paper variant="outlined" sx={{ p: 2, textAlign: 'center' }}>
              <Typography variant="subtitle2" color="text.secondary">Volume Snapshots</Typography>
              <Typography variant="h6" sx={{ mt: 1 }}>
                {backup.status?.volumeSnapshotsCompleted || 0} / {backup.status?.volumeSnapshotsAttempted || 0}
              </Typography>
            </Paper>
          </Grid>
        </Grid>

        {backup.status?.failureReason && (
          <Paper variant="outlined" sx={{ p: 2, mt: 2, bgcolor: 'error.lighter' }}>
            <Typography variant="subtitle2" color="error">Failure Reason:</Typography>
            <Typography variant="body2" sx={{ mt: 1 }}>{backup.status.failureReason}</Typography>
          </Paper>
        )}

        {backup.status?.validationErrors && backup.status.validationErrors.length > 0 && (
          <Paper variant="outlined" sx={{ p: 2, mt: 2, bgcolor: 'error.lighter' }}>
            <Typography variant="subtitle2" color="error">Validation Errors:</Typography>
            {backup.status.validationErrors.map((err, idx) => (
              <Typography key={idx} variant="body2" sx={{ mt: 1 }}>{err}</Typography>
            ))}
          </Paper>
        )}
      </SectionBox>

      {/* Backup Details */}
      <SectionBox title={t('Details')}>
        <Grid container spacing={2}>
          <Grid item xs={12} md={6}>
            <TableContainer component={Paper} variant="outlined">
              <Table size="small">
                <TableBody>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 'bold', width: 200 }}>Name</TableCell>
                    <TableCell>{backup.metadata.name}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 'bold' }}>Namespace</TableCell>
                    <TableCell>{backup.metadata.namespace}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 'bold' }}>UID</TableCell>
                    <TableCell>
                      <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>
                        {backup.metadata.uid}
                      </Typography>
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 'bold' }}>Created</TableCell>
                    <TableCell>
                      {backup.metadata.creationTimestamp
                        ? new Date(backup.metadata.creationTimestamp).toLocaleString()
                        : '-'}
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 'bold' }}>Started</TableCell>
                    <TableCell>
                      {backup.status?.startTimestamp
                        ? new Date(backup.status.startTimestamp).toLocaleString()
                        : '-'}
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 'bold' }}>Completed</TableCell>
                    <TableCell>
                      {backup.status?.completionTimestamp
                        ? new Date(backup.status.completionTimestamp).toLocaleString()
                        : '-'}
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 'bold' }}>Expires</TableCell>
                    <TableCell>
                      {backup.status?.expiration
                        ? new Date(backup.status.expiration).toLocaleString()
                        : '-'}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </TableContainer>
          </Grid>
          <Grid item xs={12} md={6}>
            <TableContainer component={Paper} variant="outlined">
              <Table size="small">
                <TableBody>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 'bold', width: 200 }}>Storage Location</TableCell>
                    <TableCell>{backup.spec?.storageLocation || 'default'}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 'bold' }}>TTL</TableCell>
                    <TableCell>{backup.spec?.ttl || 'default'}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 'bold' }}>Snapshot Volumes</TableCell>
                    <TableCell>
                      <Chip
                        label={backup.spec?.snapshotVolumes !== false ? 'Yes' : 'No'}
                        size="small"
                        color={backup.spec?.snapshotVolumes !== false ? 'success' : 'default'}
                        variant="outlined"
                      />
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 'bold' }}>Included Namespaces</TableCell>
                    <TableCell>
                      <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                        {backup.spec?.includedNamespaces?.map(ns => (
                          <Chip key={ns} label={ns} size="small" variant="outlined" />
                        )) || <Typography variant="body2" color="text.secondary">All</Typography>}
                      </Box>
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 'bold' }}>VM Label Selector</TableCell>
                    <TableCell>
                      {vmName ? (
                        <Link
                          routeName="virtualmachine"
                          params={{ name: vmName, namespace: vmNamespace || '' }}
                        >
                          {vmName}
                        </Link>
                      ) : (
                        <Typography variant="body2" color="text.secondary">None</Typography>
                      )}
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 'bold' }}>Items Progress</TableCell>
                    <TableCell>
                      {backup.status?.progress ? (
                        `${backup.status.progress.itemsBackedUp || 0} / ${backup.status.progress.totalItems || 0}`
                      ) : '-'}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </TableContainer>
          </Grid>
        </Grid>
      </SectionBox>

      {/* Labels */}
      {backup.metadata.labels && Object.keys(backup.metadata.labels).length > 0 && (
        <SectionBox title={t('Labels')}>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            {Object.entries(backup.metadata.labels).map(([key, value]) => (
              <Chip
                key={key}
                label={`${key}: ${value}`}
                size="small"
                variant="outlined"
              />
            ))}
          </Box>
        </SectionBox>
      )}

      {/* Related Restores */}
      <SectionBox title={t('Restores from this Backup')}>
        {relatedRestores.length === 0 ? (
          <Paper variant="outlined" sx={{ p: 3, textAlign: 'center' }}>
            <Typography variant="body2" color="text.secondary">
              No restores have been created from this backup
            </Typography>
            <Button
              variant="outlined"
              startIcon={<Icon icon="mdi:restore" />}
              sx={{ mt: 2 }}
              onClick={() => setRestoreDialogOpen(true)}
              disabled={backup.status?.phase !== 'Completed'}
            >
              Create Restore
            </Button>
          </Paper>
        ) : (
          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 'bold' }}>Name</TableCell>
                  <TableCell sx={{ fontWeight: 'bold' }}>Status</TableCell>
                  <TableCell sx={{ fontWeight: 'bold' }}>Created</TableCell>
                  <TableCell sx={{ fontWeight: 'bold' }}>Completed</TableCell>
                  <TableCell sx={{ fontWeight: 'bold' }}>Namespace Mapping</TableCell>
                  <TableCell sx={{ fontWeight: 'bold' }}>Errors/Warnings</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {relatedRestores.map(restore => (
                  <TableRow key={restore.metadata.name}>
                    <TableCell>{restore.metadata.name}</TableCell>
                    <TableCell>
                      <Chip
                        label={restore.status?.phase || 'Unknown'}
                        color={getVeleroStatusColor(restore.status?.phase || '')}
                        size="small"
                      />
                    </TableCell>
                    <TableCell>
                      {restore.metadata.creationTimestamp
                        ? new Date(restore.metadata.creationTimestamp).toLocaleString()
                        : '-'}
                    </TableCell>
                    <TableCell>
                      {restore.status?.completionTimestamp
                        ? new Date(restore.status.completionTimestamp).toLocaleString()
                        : '-'}
                    </TableCell>
                    <TableCell>
                      {restore.spec?.namespaceMapping ? (
                        Object.entries(restore.spec.namespaceMapping).map(([from, to]) => (
                          <Chip key={from} label={`${from} → ${to}`} size="small" variant="outlined" />
                        ))
                      ) : (
                        <Typography variant="body2" color="text.secondary">Same</Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      <Box sx={{ display: 'flex', gap: 0.5 }}>
                        <Chip
                          label={restore.status?.errors || 0}
                          size="small"
                          color={restore.status?.errors ? 'error' : 'default'}
                        />
                        <Chip
                          label={restore.status?.warnings || 0}
                          size="small"
                          color={restore.status?.warnings ? 'warning' : 'default'}
                        />
                      </Box>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </SectionBox>

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
        <DialogTitle>Create Restore from Backup</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
            <Typography variant="body2" color="text.secondary">
              Create a restore from backup "{backup.metadata.name}"
            </Typography>
            <TextField
              label="Target Namespace (optional)"
              value={restoreNamespace}
              onChange={(e) => setRestoreNamespace(e.target.value)}
              placeholder={backup.spec?.includedNamespaces?.[0] || 'Same as backup'}
              helperText="Leave empty to restore to the original namespace"
              fullWidth
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRestoreDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleCreateRestore} variant="contained">
            Create Restore
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete Dialog */}
      <Dialog
        open={deleteDialogOpen}
        onClose={() => setDeleteDialogOpen(false)}
        maxWidth={false}
        PaperProps={{
          sx: {
            width: '100%',
            maxWidth: { xs: '95%', sm: 400, md: 450 },
            m: { xs: 1, sm: 2 },
          }
        }}
      >
        <DialogTitle>Delete Backup</DialogTitle>
        <DialogContent>
          <Typography>
            Are you sure you want to delete backup "{backup.metadata.name}"?
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            This action cannot be undone.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleDeleteBackup} color="error" variant="contained">
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
