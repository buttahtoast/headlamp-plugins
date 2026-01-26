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
  Tooltip,
  Typography,
} from '@mui/material';
import { Icon } from '@iconify/react';
import { useSnackbar } from 'notistack';
import { useCallback, useEffect, useMemo, useState } from 'react';
import VirtualMachine from '../VirtualMachines/VirtualMachine';

interface VeleroSchedule {
  apiVersion: string;
  kind: string;
  metadata: {
    name: string;
    namespace: string;
    creationTimestamp: string;
    labels?: Record<string, string>;
  };
  spec: {
    schedule: string;
    template: {
      includedNamespaces?: string[];
      includedResources?: string[];
      labelSelector?: {
        matchLabels?: Record<string, string>;
      };
      orLabelSelectors?: Array<{ matchLabels?: Record<string, string> }>;
      snapshotVolumes?: boolean;
      snapshotMoveData?: boolean;
      defaultVolumesToFsBackup?: boolean;
      ttl?: string;
    };
  };
  status?: {
    phase?: string;
    lastBackup?: string;
  };
}

export default function ScheduleList() {
  const { enqueueSnackbar } = useSnackbar();
  const [schedules, setSchedules] = useState<VeleroSchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [veleroInstalled, setVeleroInstalled] = useState(true);
  const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false);

  // Form state
  const [scheduleName, setScheduleName] = useState('');
  const [selectedNamespace, setSelectedNamespace] = useState('');
  const [selectedVM, setSelectedVM] = useState('');
  const [scheduleExpression, setScheduleExpression] = useState('0 2 * * *');
  const [snapshotVolumes, setSnapshotVolumes] = useState(true);
  const [snapshotMoveData, setSnapshotMoveData] = useState(true);
  const [ttl, setTtl] = useState('720h');

  // Fetch VMs
  const { items: vms } = VirtualMachine.useList({});

  // Fetch schedules
  const fetchSchedules = useCallback(async () => {
    try {
      const response = await ApiProxy.request('/apis/velero.io/v1/schedules') as { items: VeleroSchedule[] };
      // Sort by creation timestamp, latest first
      const sorted = (response.items || []).sort((a, b) => {
        const dateA = new Date(a.metadata.creationTimestamp);
        const dateB = new Date(b.metadata.creationTimestamp);
        return dateB.getTime() - dateA.getTime();
      });
      setSchedules(sorted);
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
    fetchSchedules();
    const interval = setInterval(fetchSchedules, 10000);
    return () => clearInterval(interval);
  }, [fetchSchedules]);

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

  // Create schedule for KubeVirt VMs
  // The kubevirt-velero-plugin automatically includes associated DataVolumes/PVCs
  const handleCreateSchedule = async () => {
    if (!scheduleName || !selectedNamespace || !scheduleExpression) {
      enqueueSnackbar('Please fill required fields', { variant: 'warning' });
      return;
    }

    // Build template spec matching the velero CLI format that works with kubevirt-velero-plugin
    const template: any = {
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
      template.snapshotVolumes = true;
      if (snapshotMoveData) {
        template.snapshotMoveData = true;
      }
    } else {
      template.snapshotVolumes = false;
    }

    // When backing up a specific VM, use label selector with kubevirt.io/vm label
    if (selectedVM) {
      template.labelSelector = {
        matchLabels: {
          'kubevirt.io/vm': selectedVM,
        },
      };
    }

    const schedule = {
      apiVersion: 'velero.io/v1',
      kind: 'Schedule',
      metadata: {
        name: scheduleName,
        namespace: 'velero',
        labels: {
          'kubevirt.io/backup': 'true',
          'kubevirt.io/vm-namespace': selectedNamespace,
          ...(selectedVM && { 'kubevirt.io/vm': selectedVM }),
        },
      },
      spec: {
        schedule: scheduleExpression,
        template,
      },
    };

    try {
      await ApiProxy.request('/apis/velero.io/v1/namespaces/velero/schedules', {
        method: 'POST',
        body: JSON.stringify(schedule),
        headers: { 'Content-Type': 'application/json' },
      });

      enqueueSnackbar('Schedule created successfully', { variant: 'success' });
      setScheduleDialogOpen(false);
      resetForm();
      fetchSchedules();
    } catch (error: any) {
      enqueueSnackbar(`Failed to create schedule: ${error.message}`, { variant: 'error' });
    }
  };

  // Delete schedule
  const handleDeleteSchedule = async (schedule: VeleroSchedule) => {
    try {
      await ApiProxy.request(
        `/apis/velero.io/v1/namespaces/${schedule.metadata.namespace}/schedules/${schedule.metadata.name}`,
        { method: 'DELETE' }
      );
      enqueueSnackbar('Schedule deleted successfully', { variant: 'success' });
      fetchSchedules();
    } catch (error: any) {
      enqueueSnackbar(`Failed to delete schedule: ${error.message}`, { variant: 'error' });
    }
  };

  const resetForm = () => {
    setScheduleName('');
    setSelectedNamespace('');
    setSelectedVM('');
    setScheduleExpression('0 2 * * *');
    setSnapshotVolumes(true);
    setSnapshotMoveData(true);
    setTtl('720h');
  };

  // Get VM name from schedule
  const getVMName = (schedule: VeleroSchedule): string => {
    return schedule.metadata.labels?.['kubevirt.io/vm'] ||
           schedule.spec?.template?.labelSelector?.matchLabels?.['kubevirt.io/vm'] ||
           schedule.spec?.template?.labelSelector?.matchLabels?.['vm.kubevirt.io/name'] ||
           schedule.spec?.template?.orLabelSelectors?.[0]?.matchLabels?.['vm.kubevirt.io/name'] ||
           '';
  };

  // Get namespace from schedule
  const getScheduleNamespace = (schedule: VeleroSchedule): string => {
    return schedule.metadata.labels?.['kubevirt.io/vm-namespace'] ||
           schedule.spec?.template?.includedNamespaces?.[0] ||
           '';
  };

  // Parse cron expression to human readable
  const parseCronExpression = (cron: string): string => {
    const parts = cron.split(' ');
    if (parts.length !== 5) return cron;

    const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

    // Daily at specific time
    if (dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
      return `Daily at ${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`;
    }

    // Weekly
    if (dayOfMonth === '*' && month === '*' && dayOfWeek !== '*') {
      const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const day = days[parseInt(dayOfWeek)] || dayOfWeek;
      return `Weekly on ${day} at ${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`;
    }

    // Monthly
    if (dayOfMonth !== '*' && month === '*') {
      return `Monthly on day ${dayOfMonth} at ${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`;
    }

    return cron;
  };

  // Format TTL display
  const formatTTL = (ttlValue: string): string => {
    if (ttlValue === '168h') return '7 days';
    if (ttlValue === '720h') return '30 days';
    if (ttlValue === '2160h') return '90 days';
    if (ttlValue === '8760h') return '1 year';
    return ttlValue || '-';
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
        <Typography variant="h4" gutterBottom>Backup Schedules</Typography>
        <Paper variant="outlined" sx={{ p: 4, textAlign: 'center' }}>
          <Icon icon="mdi:alert-circle" width={64} color="#ed6c02" />
          <Typography variant="h6" sx={{ mt: 2 }}>
            Velero Not Installed
          </Typography>
          <Typography variant="body1" color="text.secondary" sx={{ mt: 1 }}>
            Velero is required for scheduled backups.
          </Typography>
        </Paper>
      </Box>
    );
  }

  return (
    <>
      <SectionBox
        title="Backup Schedules"
        headerProps={{
          actions: [
            <Button
              key="create"
              variant="contained"
              startIcon={<Icon icon="mdi:plus" />}
              onClick={() => setScheduleDialogOpen(true)}
            >
              Create Schedule
            </Button>,
          ],
        }}
      >
        <SimpleTable
          columns={[
            {
              label: 'Name',
              getter: (schedule: VeleroSchedule) => schedule.metadata.name,
            },
            {
              label: 'VM Namespace',
              getter: (schedule: VeleroSchedule) => {
                const ns = getScheduleNamespace(schedule);
                return ns ? (
                  <Link routeName="namespace" params={{ name: ns }}>
                    {ns}
                  </Link>
                ) : '-';
              },
            },
            {
              label: 'VM',
              getter: (schedule: VeleroSchedule) => {
                const vmName = getVMName(schedule);
                const vmNamespace = getScheduleNamespace(schedule);
                return vmName ? (
                  <Link
                    routeName="virtualmachine"
                    params={{ name: vmName, namespace: vmNamespace }}
                  >
                    {vmName}
                  </Link>
                ) : 'All VMs';
              },
            },
            {
              label: 'Schedule',
              getter: (schedule: VeleroSchedule) => (
                <Tooltip title={schedule.spec.schedule}>
                  <Chip
                    icon={<Icon icon="mdi:clock-outline" />}
                    label={parseCronExpression(schedule.spec.schedule)}
                    size="small"
                    variant="outlined"
                  />
                </Tooltip>
              ),
            },
            {
              label: 'Last Backup',
              getter: (schedule: VeleroSchedule) =>
                schedule.status?.lastBackup
                  ? new Date(schedule.status.lastBackup).toLocaleString()
                  : 'Never',
            },
            {
              label: 'Retention',
              getter: (schedule: VeleroSchedule) => formatTTL(schedule.spec.template?.ttl || ''),
            },
            {
              label: 'Created',
              getter: (schedule: VeleroSchedule) =>
                new Date(schedule.metadata.creationTimestamp).toLocaleDateString(),
            },
            {
              label: 'Actions',
              getter: (schedule: VeleroSchedule) => (
                <Button
                  size="small"
                  color="error"
                  onClick={() => handleDeleteSchedule(schedule)}
                  startIcon={<Icon icon="mdi:delete" />}
                >
                  Delete
                </Button>
              ),
            },
          ]}
          data={schedules}
          emptyMessage="No backup schedules found"
        />
      </SectionBox>

      {/* Create Schedule Dialog */}
      <Dialog
        open={scheduleDialogOpen}
        onClose={() => setScheduleDialogOpen(false)}
        maxWidth={false}
        PaperProps={{
          sx: {
            width: '100%',
            maxWidth: { xs: '95%', sm: 500, md: 600 },
            m: { xs: 1, sm: 2 },
          }
        }}
      >
        <DialogTitle>Create Backup Schedule</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
            <TextField
              label="Schedule Name"
              value={scheduleName}
              onChange={(e) => setScheduleName(e.target.value)}
              placeholder="daily-vm-backup"
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

            <TextField
              label="Schedule (Cron Expression)"
              value={scheduleExpression}
              onChange={(e) => setScheduleExpression(e.target.value)}
              fullWidth
              required
              helperText="e.g., '0 2 * * *' for daily at 2 AM, '0 3 * * 0' for weekly on Sunday"
            />

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
          <Button onClick={() => { setScheduleDialogOpen(false); resetForm(); }}>Cancel</Button>
          <Button onClick={handleCreateSchedule} variant="contained">Create Schedule</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
