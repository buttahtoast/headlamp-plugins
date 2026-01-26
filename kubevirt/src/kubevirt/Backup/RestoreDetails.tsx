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
  TableRow,
  Typography,
} from '@mui/material';
import { Icon } from '@iconify/react';
import { useSnackbar } from 'notistack';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';

interface VeleroRestore {
  metadata: {
    name: string;
    namespace: string;
    creationTimestamp: string;
    labels?: Record<string, string>;
    uid?: string;
  };
  spec: {
    backupName: string;
    includedNamespaces?: string[];
    excludedNamespaces?: string[];
    includedResources?: string[];
    excludedResources?: string[];
    namespaceMapping?: Record<string, string>;
    labelSelector?: {
      matchLabels?: Record<string, string>;
    };
    restorePVs?: boolean;
    preserveNodePorts?: boolean;
  };
  status?: {
    phase: string;
    startTimestamp?: string;
    completionTimestamp?: string;
    errors?: number;
    warnings?: number;
    failureReason?: string;
    validationErrors?: string[];
    progress?: {
      itemsRestored?: number;
      totalItems?: number;
    };
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

export default function RestoreDetails() {
  const { t } = useTranslation('glossary');
  const { enqueueSnackbar } = useSnackbar();
  const { name } = useParams<{ name: string }>();
  const [restore, setRestore] = useState<VeleroRestore | null>(null);
  const [sourceBackup, setSourceBackup] = useState<VeleroBackup | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  // Fetch restore details
  useEffect(() => {
    const fetchRestore = async () => {
      try {
        const restoreResponse = await ApiProxy.request(
          `/apis/velero.io/v1/namespaces/velero/restores/${name}`
        ) as VeleroRestore;
        setRestore(restoreResponse);

        // Fetch source backup
        if (restoreResponse.spec.backupName) {
          try {
            const backupResponse = await ApiProxy.request(
              `/apis/velero.io/v1/namespaces/velero/backups/${restoreResponse.spec.backupName}`
            ) as VeleroBackup;
            setSourceBackup(backupResponse);
          } catch {
            // Backup might have been deleted
            setSourceBackup(null);
          }
        }

        setLoading(false);
      } catch (error: any) {
        console.error('Failed to fetch restore:', error);
        enqueueSnackbar(`Failed to fetch restore: ${error.message}`, { variant: 'error' });
        setLoading(false);
      }
    };

    fetchRestore();
    const interval = setInterval(fetchRestore, 10000);
    return () => clearInterval(interval);
  }, [name]);

  // Delete restore
  const handleDeleteRestore = async () => {
    if (!restore) return;

    try {
      await ApiProxy.request(
        `/apis/velero.io/v1/namespaces/velero/restores/${restore.metadata.name}`,
        { method: 'DELETE' }
      );
      enqueueSnackbar('Restore deleted successfully', { variant: 'success' });
      setDeleteDialogOpen(false);
      window.history.back();
    } catch (error: any) {
      enqueueSnackbar(`Failed to delete restore: ${error.message}`, { variant: 'error' });
    }
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

  if (!restore) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography variant="h4" gutterBottom>Restore Not Found</Typography>
        <Paper variant="outlined" sx={{ p: 4, textAlign: 'center' }}>
          <Icon icon="mdi:alert-circle" width={64} color="#ed6c02" />
          <Typography variant="h6" sx={{ mt: 2 }}>
            Restore "{name}" not found
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

  const vmName = sourceBackup?.metadata.labels?.['kubevirt.io/vm'];
  const vmNamespace = sourceBackup?.spec?.includedNamespaces?.[0];

  return (
    <Box sx={{ p: 3 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 3 }}>
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Icon icon="mdi:restore" width={32} />
            <Typography variant="h4">{restore.metadata.name}</Typography>
            <Chip
              label={restore.status?.phase || 'Unknown'}
              color={getStatusColor(restore.status?.phase || '')}
              size="small"
            />
          </Box>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            Created {formatRelativeTime(restore.metadata.creationTimestamp)}
            {' from backup '}
            <Link
              routeName="backup"
              params={{ namespace: 'velero', name: restore.spec.backupName }}
            >
              {restore.spec.backupName}
            </Link>
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1 }}>
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
                label={restore.status?.phase || 'Unknown'}
                color={getStatusColor(restore.status?.phase || '')}
                sx={{ mt: 1 }}
              />
            </Paper>
          </Grid>
          <Grid item xs={12} md={3}>
            <Paper variant="outlined" sx={{ p: 2, textAlign: 'center' }}>
              <Typography variant="subtitle2" color="text.secondary">Duration</Typography>
              <Typography variant="h6" sx={{ mt: 1 }}>
                {formatDuration(restore.status?.startTimestamp, restore.status?.completionTimestamp)}
              </Typography>
            </Paper>
          </Grid>
          <Grid item xs={12} md={3}>
            <Paper variant="outlined" sx={{ p: 2, textAlign: 'center' }}>
              <Typography variant="subtitle2" color="text.secondary">Progress</Typography>
              <Typography variant="h6" sx={{ mt: 1 }}>
                {restore.status?.progress
                  ? `${restore.status.progress.itemsRestored || 0} / ${restore.status.progress.totalItems || 0}`
                  : '-'}
              </Typography>
            </Paper>
          </Grid>
          <Grid item xs={12} md={3}>
            <Paper variant="outlined" sx={{ p: 2, textAlign: 'center' }}>
              <Typography variant="subtitle2" color="text.secondary">Errors / Warnings</Typography>
              <Box sx={{ display: 'flex', justifyContent: 'center', gap: 1, mt: 1 }}>
                <Chip
                  icon={<Icon icon="mdi:alert-circle" />}
                  label={restore.status?.errors || 0}
                  color={restore.status?.errors ? 'error' : 'default'}
                  size="small"
                />
                <Chip
                  icon={<Icon icon="mdi:alert" />}
                  label={restore.status?.warnings || 0}
                  color={restore.status?.warnings ? 'warning' : 'default'}
                  size="small"
                />
              </Box>
            </Paper>
          </Grid>
        </Grid>

        {restore.status?.failureReason && (
          <Paper variant="outlined" sx={{ p: 2, mt: 2, bgcolor: 'error.lighter' }}>
            <Typography variant="subtitle2" color="error">Failure Reason:</Typography>
            <Typography variant="body2" sx={{ mt: 1 }}>{restore.status.failureReason}</Typography>
          </Paper>
        )}

        {restore.status?.validationErrors && restore.status.validationErrors.length > 0 && (
          <Paper variant="outlined" sx={{ p: 2, mt: 2, bgcolor: 'error.lighter' }}>
            <Typography variant="subtitle2" color="error">Validation Errors:</Typography>
            {restore.status.validationErrors.map((err, idx) => (
              <Typography key={idx} variant="body2" sx={{ mt: 1 }}>{err}</Typography>
            ))}
          </Paper>
        )}
      </SectionBox>

      {/* Restore Details */}
      <SectionBox title={t('Details')}>
        <Grid container spacing={2}>
          <Grid item xs={12} md={6}>
            <TableContainer component={Paper} variant="outlined">
              <Table size="small">
                <TableBody>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 'bold', width: 200 }}>Name</TableCell>
                    <TableCell>{restore.metadata.name}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 'bold' }}>Namespace</TableCell>
                    <TableCell>{restore.metadata.namespace}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 'bold' }}>UID</TableCell>
                    <TableCell>
                      <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>
                        {restore.metadata.uid}
                      </Typography>
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 'bold' }}>Created</TableCell>
                    <TableCell>
                      {restore.metadata.creationTimestamp
                        ? new Date(restore.metadata.creationTimestamp).toLocaleString()
                        : '-'}
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 'bold' }}>Started</TableCell>
                    <TableCell>
                      {restore.status?.startTimestamp
                        ? new Date(restore.status.startTimestamp).toLocaleString()
                        : '-'}
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 'bold' }}>Completed</TableCell>
                    <TableCell>
                      {restore.status?.completionTimestamp
                        ? new Date(restore.status.completionTimestamp).toLocaleString()
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
                    <TableCell sx={{ fontWeight: 'bold', width: 200 }}>Source Backup</TableCell>
                    <TableCell>
                      <Link
                        routeName="backup"
                        params={{ namespace: 'velero', name: restore.spec.backupName }}
                      >
                        {restore.spec.backupName}
                      </Link>
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 'bold' }}>Backup Status</TableCell>
                    <TableCell>
                      {sourceBackup ? (
                        <Chip
                          label={sourceBackup.status?.phase || 'Unknown'}
                          color={getStatusColor(sourceBackup.status?.phase || '')}
                          size="small"
                        />
                      ) : (
                        <Typography variant="body2" color="text.secondary">Backup not found</Typography>
                      )}
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 'bold' }}>Source VM</TableCell>
                    <TableCell>
                      {vmName ? (
                        <Link
                          routeName="virtualmachine"
                          params={{ name: vmName, namespace: vmNamespace || '' }}
                        >
                          {vmName}
                        </Link>
                      ) : (
                        <Typography variant="body2" color="text.secondary">-</Typography>
                      )}
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 'bold' }}>Restore PVs</TableCell>
                    <TableCell>
                      <Chip
                        label={restore.spec?.restorePVs !== false ? 'Yes' : 'No'}
                        size="small"
                        color={restore.spec?.restorePVs !== false ? 'success' : 'default'}
                        variant="outlined"
                      />
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 'bold' }}>Preserve Node Ports</TableCell>
                    <TableCell>
                      <Chip
                        label={restore.spec?.preserveNodePorts ? 'Yes' : 'No'}
                        size="small"
                        color={restore.spec?.preserveNodePorts ? 'success' : 'default'}
                        variant="outlined"
                      />
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </TableContainer>
          </Grid>
        </Grid>
      </SectionBox>

      {/* Namespace Mapping */}
      {restore.spec?.namespaceMapping && Object.keys(restore.spec.namespaceMapping).length > 0 && (
        <SectionBox title={t('Namespace Mapping')}>
          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableBody>
                {Object.entries(restore.spec.namespaceMapping).map(([from, to]) => (
                  <TableRow key={from}>
                    <TableCell sx={{ fontWeight: 'bold', width: 200 }}>
                      <Link routeName="namespace" params={{ name: from }}>{from}</Link>
                    </TableCell>
                    <TableCell>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Icon icon="mdi:arrow-right" />
                        <Link routeName="namespace" params={{ name: to }}>{to}</Link>
                      </Box>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </SectionBox>
      )}

      {/* Included/Excluded Namespaces */}
      {(restore.spec?.includedNamespaces || restore.spec?.excludedNamespaces) && (
        <SectionBox title={t('Namespace Filters')}>
          <Grid container spacing={2}>
            {restore.spec?.includedNamespaces && restore.spec.includedNamespaces.length > 0 && (
              <Grid item xs={12} md={6}>
                <Paper variant="outlined" sx={{ p: 2 }}>
                  <Typography variant="subtitle2" gutterBottom>Included Namespaces</Typography>
                  <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                    {restore.spec.includedNamespaces.map(ns => (
                      <Chip key={ns} label={ns} size="small" color="success" variant="outlined" />
                    ))}
                  </Box>
                </Paper>
              </Grid>
            )}
            {restore.spec?.excludedNamespaces && restore.spec.excludedNamespaces.length > 0 && (
              <Grid item xs={12} md={6}>
                <Paper variant="outlined" sx={{ p: 2 }}>
                  <Typography variant="subtitle2" gutterBottom>Excluded Namespaces</Typography>
                  <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                    {restore.spec.excludedNamespaces.map(ns => (
                      <Chip key={ns} label={ns} size="small" color="error" variant="outlined" />
                    ))}
                  </Box>
                </Paper>
              </Grid>
            )}
          </Grid>
        </SectionBox>
      )}

      {/* Labels */}
      {restore.metadata.labels && Object.keys(restore.metadata.labels).length > 0 && (
        <SectionBox title={t('Labels')}>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            {Object.entries(restore.metadata.labels).map(([key, value]) => (
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
        <DialogTitle>Delete Restore</DialogTitle>
        <DialogContent>
          <Typography>
            Are you sure you want to delete restore "{restore.metadata.name}"?
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            This will only delete the restore record. Any resources that were restored will remain.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleDeleteRestore} color="error" variant="contained">
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
