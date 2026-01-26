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
  Typography,
} from '@mui/material';
import { Icon } from '@iconify/react';
import { useSnackbar } from 'notistack';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';

interface VeleroSchedule {
  metadata: {
    name: string;
    namespace: string;
    creationTimestamp: string;
    labels?: Record<string, string>;
    uid?: string;
  };
  spec: {
    schedule: string;
    template: {
      includedNamespaces?: string[];
      excludedNamespaces?: string[];
      includedResources?: string[];
      excludedResources?: string[];
      labelSelector?: {
        matchLabels?: Record<string, string>;
      };
      orLabelSelectors?: Array<{ matchLabels?: Record<string, string> }>;
      storageLocation?: string;
      volumeSnapshotLocations?: string[];
      ttl?: string;
      snapshotVolumes?: boolean;
      snapshotMoveData?: boolean;
      defaultVolumesToFsBackup?: boolean;
    };
    useOwnerReferencesInBackup?: boolean;
    paused?: boolean;
  };
  status?: {
    phase?: string;
    lastBackup?: string;
    lastSkipped?: string;
  };
}

interface VeleroBackup {
  metadata: {
    name: string;
    namespace: string;
    creationTimestamp: string;
    labels?: Record<string, string>;
    ownerReferences?: Array<{
      name: string;
      kind: string;
    }>;
  };
  spec: {
    includedNamespaces?: string[];
  };
  status?: {
    phase: string;
    startTimestamp?: string;
    completionTimestamp?: string;
    errors?: number;
    warnings?: number;
  };
}

export default function ScheduleDetails() {
  const { t } = useTranslation('glossary');
  const { enqueueSnackbar } = useSnackbar();
  const { name } = useParams<{ name: string }>();
  const [schedule, setSchedule] = useState<VeleroSchedule | null>(null);
  const [relatedBackups, setRelatedBackups] = useState<VeleroBackup[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [pauseDialogOpen, setPauseDialogOpen] = useState(false);

  // Fetch schedule details
  useEffect(() => {
    const fetchSchedule = async () => {
      try {
        const scheduleResponse = await ApiProxy.request(
          `/apis/velero.io/v1/namespaces/velero/schedules/${name}`
        ) as VeleroSchedule;
        setSchedule(scheduleResponse);

        // Fetch related backups (backups created by this schedule)
        const backupsResponse = await ApiProxy.request('/apis/velero.io/v1/backups') as { items: VeleroBackup[] };
        const related = backupsResponse.items?.filter(b =>
          b.metadata.labels?.['velero.io/schedule-name'] === name ||
          b.metadata.ownerReferences?.some(ref => ref.name === name && ref.kind === 'Schedule')
        ) || [];
        // Sort by creation time, most recent first
        related.sort((a, b) =>
          new Date(b.metadata.creationTimestamp).getTime() - new Date(a.metadata.creationTimestamp).getTime()
        );
        setRelatedBackups(related);

        setLoading(false);
      } catch (error: any) {
        console.error('Failed to fetch schedule:', error);
        enqueueSnackbar(`Failed to fetch schedule: ${error.message}`, { variant: 'error' });
        setLoading(false);
      }
    };

    fetchSchedule();
    const interval = setInterval(fetchSchedule, 10000);
    return () => clearInterval(interval);
  }, [name]);

  // Toggle pause state
  const handleTogglePause = async () => {
    if (!schedule) return;

    const newPausedState = !schedule.spec.paused;
    try {
      await ApiProxy.request(
        `/apis/velero.io/v1/namespaces/velero/schedules/${schedule.metadata.name}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ spec: { paused: newPausedState } }),
          headers: { 'Content-Type': 'application/merge-patch+json' },
        }
      );
      enqueueSnackbar(`Schedule ${newPausedState ? 'paused' : 'resumed'} successfully`, { variant: 'success' });
      setPauseDialogOpen(false);
      // Update local state
      setSchedule({ ...schedule, spec: { ...schedule.spec, paused: newPausedState } });
    } catch (error: any) {
      enqueueSnackbar(`Failed to ${newPausedState ? 'pause' : 'resume'} schedule: ${error.message}`, { variant: 'error' });
    }
  };

  // Trigger manual backup
  const handleTriggerBackup = async () => {
    if (!schedule) return;

    const backupName = `${schedule.metadata.name}-manual-${Date.now()}`;
    const backup: any = {
      apiVersion: 'velero.io/v1',
      kind: 'Backup',
      metadata: {
        name: backupName,
        namespace: 'velero',
        labels: {
          'velero.io/schedule-name': schedule.metadata.name,
          ...(schedule.metadata.labels || {}),
        },
      },
      spec: {
        ...schedule.spec.template,
      },
    };

    try {
      await ApiProxy.request('/apis/velero.io/v1/namespaces/velero/backups', {
        method: 'POST',
        body: JSON.stringify(backup),
        headers: { 'Content-Type': 'application/json' },
      });
      enqueueSnackbar('Backup triggered successfully', { variant: 'success' });
    } catch (error: any) {
      enqueueSnackbar(`Failed to trigger backup: ${error.message}`, { variant: 'error' });
    }
  };

  // Delete schedule
  const handleDeleteSchedule = async () => {
    if (!schedule) return;

    try {
      await ApiProxy.request(
        `/apis/velero.io/v1/namespaces/velero/schedules/${schedule.metadata.name}`,
        { method: 'DELETE' }
      );
      enqueueSnackbar('Schedule deleted successfully', { variant: 'success' });
      setDeleteDialogOpen(false);
      window.history.back();
    } catch (error: any) {
      enqueueSnackbar(`Failed to delete schedule: ${error.message}`, { variant: 'error' });
    }
  };

  // Get status color
  const getStatusColor = (phase: string): 'success' | 'error' | 'warning' | 'default' => {
    switch (phase) {
      case 'Completed': return 'success';
      case 'Failed': return 'error';
      case 'FailedValidation': return 'error';
      case 'InProgress': return 'warning';
      case 'PartiallyFailed': return 'warning';
      case 'New': return 'default';
      default: return 'default';
    }
  };

  // Parse cron expression to human readable
  const parseCronExpression = (cron: string): string => {
    const parts = cron.split(' ');
    if (parts.length !== 5) return cron;

    const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

    if (dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
      return `Daily at ${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`;
    }

    if (dayOfMonth === '*' && month === '*' && dayOfWeek !== '*') {
      const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const day = days[parseInt(dayOfWeek)] || dayOfWeek;
      return `Weekly on ${day} at ${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`;
    }

    if (dayOfMonth !== '*' && month === '*') {
      return `Monthly on day ${dayOfMonth} at ${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`;
    }

    return cron;
  };

  // Format TTL display
  const formatTTL = (ttlValue?: string): string => {
    if (!ttlValue) return '-';
    if (ttlValue === '168h') return '7 days';
    if (ttlValue === '720h') return '30 days';
    if (ttlValue === '2160h') return '90 days';
    if (ttlValue === '8760h') return '1 year';
    return ttlValue;
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

  if (!schedule) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography variant="h4" gutterBottom>Schedule Not Found</Typography>
        <Paper variant="outlined" sx={{ p: 4, textAlign: 'center' }}>
          <Icon icon="mdi:alert-circle" width={64} color="#ed6c02" />
          <Typography variant="h6" sx={{ mt: 2 }}>
            Schedule "{name}" not found
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

  const vmName = schedule.metadata.labels?.['kubevirt.io/vm'] ||
                 schedule.spec?.template?.labelSelector?.matchLabels?.['kubevirt.io/vm'];
  const vmNamespace = schedule.metadata.labels?.['kubevirt.io/vm-namespace'] ||
                      schedule.spec?.template?.includedNamespaces?.[0];

  return (
    <Box sx={{ p: 3 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 3 }}>
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Icon icon="mdi:calendar-clock" width={32} />
            <Typography variant="h4">{schedule.metadata.name}</Typography>
            {schedule.spec.paused && (
              <Chip label="Paused" color="warning" size="small" />
            )}
          </Box>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            Created {formatRelativeTime(schedule.metadata.creationTimestamp)}
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
            variant="outlined"
            startIcon={<Icon icon="mdi:backup-restore" />}
            onClick={handleTriggerBackup}
            disabled={schedule.spec.paused}
          >
            Run Now
          </Button>
          <Button
            variant="outlined"
            color={schedule.spec.paused ? 'success' : 'warning'}
            startIcon={<Icon icon={schedule.spec.paused ? 'mdi:play' : 'mdi:pause'} />}
            onClick={() => setPauseDialogOpen(true)}
          >
            {schedule.spec.paused ? 'Resume' : 'Pause'}
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

      {/* Schedule Info */}
      <SectionBox title={t('Schedule')}>
        <Grid container spacing={2}>
          <Grid item xs={12} md={4}>
            <Paper variant="outlined" sx={{ p: 2, textAlign: 'center' }}>
              <Typography variant="subtitle2" color="text.secondary">Schedule</Typography>
              <Box sx={{ mt: 1 }}>
                <Chip
                  icon={<Icon icon="mdi:clock-outline" />}
                  label={parseCronExpression(schedule.spec.schedule)}
                  variant="outlined"
                />
              </Box>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                {schedule.spec.schedule}
              </Typography>
            </Paper>
          </Grid>
          <Grid item xs={12} md={4}>
            <Paper variant="outlined" sx={{ p: 2, textAlign: 'center' }}>
              <Typography variant="subtitle2" color="text.secondary">Last Backup</Typography>
              <Typography variant="h6" sx={{ mt: 1 }}>
                {schedule.status?.lastBackup
                  ? formatRelativeTime(schedule.status.lastBackup)
                  : 'Never'}
              </Typography>
            </Paper>
          </Grid>
          <Grid item xs={12} md={4}>
            <Paper variant="outlined" sx={{ p: 2, textAlign: 'center' }}>
              <Typography variant="subtitle2" color="text.secondary">Retention</Typography>
              <Typography variant="h6" sx={{ mt: 1 }}>
                {formatTTL(schedule.spec.template?.ttl)}
              </Typography>
            </Paper>
          </Grid>
        </Grid>
      </SectionBox>

      {/* Template Details */}
      <SectionBox title={t('Backup Template')}>
        <Grid container spacing={2}>
          <Grid item xs={12} md={6}>
            <TableContainer component={Paper} variant="outlined">
              <Table size="small">
                <TableBody>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 'bold', width: 200 }}>Included Namespaces</TableCell>
                    <TableCell>
                      <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                        {schedule.spec.template?.includedNamespaces?.map(ns => (
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
                        <Typography variant="body2" color="text.secondary">All VMs in namespace</Typography>
                      )}
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 'bold' }}>Storage Location</TableCell>
                    <TableCell>{schedule.spec.template?.storageLocation || 'default'}</TableCell>
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
                    <TableCell sx={{ fontWeight: 'bold', width: 200 }}>Snapshot Volumes</TableCell>
                    <TableCell>
                      <Chip
                        label={schedule.spec.template?.snapshotVolumes !== false ? 'Yes' : 'No'}
                        size="small"
                        color={schedule.spec.template?.snapshotVolumes !== false ? 'success' : 'default'}
                        variant="outlined"
                      />
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 'bold' }}>Snapshot Move Data</TableCell>
                    <TableCell>
                      <Chip
                        label={schedule.spec.template?.snapshotMoveData ? 'Yes' : 'No'}
                        size="small"
                        color={schedule.spec.template?.snapshotMoveData ? 'success' : 'default'}
                        variant="outlined"
                      />
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 'bold' }}>TTL</TableCell>
                    <TableCell>{formatTTL(schedule.spec.template?.ttl)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </TableContainer>
          </Grid>
        </Grid>
      </SectionBox>

      {/* Metadata */}
      <SectionBox title={t('Metadata')}>
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableBody>
              <TableRow>
                <TableCell sx={{ fontWeight: 'bold', width: 200 }}>Name</TableCell>
                <TableCell>{schedule.metadata.name}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell sx={{ fontWeight: 'bold' }}>Namespace</TableCell>
                <TableCell>{schedule.metadata.namespace}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell sx={{ fontWeight: 'bold' }}>UID</TableCell>
                <TableCell>
                  <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>
                    {schedule.metadata.uid}
                  </Typography>
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell sx={{ fontWeight: 'bold' }}>Created</TableCell>
                <TableCell>
                  {schedule.metadata.creationTimestamp
                    ? new Date(schedule.metadata.creationTimestamp).toLocaleString()
                    : '-'}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </TableContainer>
      </SectionBox>

      {/* Labels */}
      {schedule.metadata.labels && Object.keys(schedule.metadata.labels).length > 0 && (
        <SectionBox title={t('Labels')}>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            {Object.entries(schedule.metadata.labels).map(([key, value]) => (
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

      {/* Related Backups */}
      <SectionBox title={t('Backups from this Schedule')}>
        {relatedBackups.length === 0 ? (
          <Paper variant="outlined" sx={{ p: 3, textAlign: 'center' }}>
            <Typography variant="body2" color="text.secondary">
              No backups have been created from this schedule yet
            </Typography>
            <Button
              variant="outlined"
              startIcon={<Icon icon="mdi:backup-restore" />}
              sx={{ mt: 2 }}
              onClick={handleTriggerBackup}
              disabled={schedule.spec.paused}
            >
              Run Backup Now
            </Button>
          </Paper>
        ) : (
          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 'bold' }}>Name</TableCell>
                  <TableCell sx={{ fontWeight: 'bold' }}>Status</TableCell>
                  <TableCell sx={{ fontWeight: 'bold' }}>Started</TableCell>
                  <TableCell sx={{ fontWeight: 'bold' }}>Duration</TableCell>
                  <TableCell sx={{ fontWeight: 'bold' }}>Errors/Warnings</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {relatedBackups.slice(0, 10).map(backup => (
                  <TableRow key={backup.metadata.name} hover>
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
                        label={backup.status?.phase || 'Unknown'}
                        color={getStatusColor(backup.status?.phase || '')}
                        size="small"
                      />
                    </TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>
                      {backup.status?.startTimestamp
                        ? new Date(backup.status.startTimestamp).toLocaleString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        : '-'}
                    </TableCell>
                    <TableCell>
                      {formatDuration(backup.status?.startTimestamp, backup.status?.completionTimestamp)}
                    </TableCell>
                    <TableCell>
                      <Box sx={{ display: 'flex', gap: 0.5 }}>
                        <Chip
                          label={backup.status?.errors || 0}
                          size="small"
                          color={backup.status?.errors ? 'error' : 'default'}
                        />
                        <Chip
                          label={backup.status?.warnings || 0}
                          size="small"
                          color={backup.status?.warnings ? 'warning' : 'default'}
                        />
                      </Box>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
        {relatedBackups.length > 10 && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1, textAlign: 'center' }}>
            Showing 10 of {relatedBackups.length} backups
          </Typography>
        )}
      </SectionBox>

      {/* Pause/Resume Dialog */}
      <Dialog
        open={pauseDialogOpen}
        onClose={() => setPauseDialogOpen(false)}
        maxWidth={false}
        PaperProps={{
          sx: {
            width: '100%',
            maxWidth: { xs: '95%', sm: 400, md: 450 },
            m: { xs: 1, sm: 2 },
          }
        }}
      >
        <DialogTitle>{schedule.spec.paused ? 'Resume' : 'Pause'} Schedule</DialogTitle>
        <DialogContent>
          <Typography>
            Are you sure you want to {schedule.spec.paused ? 'resume' : 'pause'} schedule "{schedule.metadata.name}"?
          </Typography>
          {!schedule.spec.paused && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              Pausing will prevent new backups from being created automatically.
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPauseDialogOpen(false)}>Cancel</Button>
          <Button
            onClick={handleTogglePause}
            variant="contained"
            color={schedule.spec.paused ? 'success' : 'warning'}
          >
            {schedule.spec.paused ? 'Resume' : 'Pause'}
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
        <DialogTitle>Delete Schedule</DialogTitle>
        <DialogContent>
          <Typography>
            Are you sure you want to delete schedule "{schedule.metadata.name}"?
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            This will not delete existing backups created by this schedule.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleDeleteSchedule} color="error" variant="contained">
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
