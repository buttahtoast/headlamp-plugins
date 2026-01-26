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
  Tooltip,
  Typography,
} from '@mui/material';
import { Icon } from '@iconify/react';
import { useSnackbar } from 'notistack';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ResourceList, ResourceListColumn, SelectionToolbar } from '../components/ResourceList';
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

// Helper functions - defined before useMemo hooks
const getVMName = (schedule: VeleroSchedule): string => {
  return schedule.metadata.labels?.['kubevirt.io/vm'] ||
         schedule.spec?.template?.labelSelector?.matchLabels?.['kubevirt.io/vm'] ||
         schedule.spec?.template?.labelSelector?.matchLabels?.['vm.kubevirt.io/name'] ||
         schedule.spec?.template?.orLabelSelectors?.[0]?.matchLabels?.['vm.kubevirt.io/name'] ||
         '';
};

const getScheduleNamespace = (schedule: VeleroSchedule): string => {
  return schedule.metadata.labels?.['kubevirt.io/vm-namespace'] ||
         schedule.spec?.template?.includedNamespaces?.[0] ||
         '';
};

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

const formatTTL = (ttlValue: string): string => {
  if (ttlValue === '168h') return '7 days';
  if (ttlValue === '720h') return '30 days';
  if (ttlValue === '2160h') return '90 days';
  if (ttlValue === '8760h') return '1 year';
  return ttlValue || '-';
};

const formatDateTime = (dateStr?: string): string => {
  if (!dateStr) return 'Never';
  const date = new Date(dateStr);
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

export default function ScheduleList() {
  const { enqueueSnackbar } = useSnackbar();
  const [schedules, setSchedules] = useState<VeleroSchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [veleroInstalled, setVeleroInstalled] = useState(true);
  const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false);
  const [selectedSchedules, setSelectedSchedules] = useState<VeleroSchedule[]>([]);

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
      setSchedules(response.items || []);
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

  // Column definitions
  const columns: ResourceListColumn<VeleroSchedule>[] = useMemo(() => [
    {
      id: 'name',
      header: 'Name',
      accessorFn: (schedule) => schedule.metadata.name,
      Cell: ({ row }) => (
        <Link
          routeName="schedule"
          params={{ name: row.original.metadata.name }}
        >
          {row.original.metadata.name}
        </Link>
      ),
      gridTemplate: '1.5fr',
    },
    {
      id: 'namespace',
      header: 'Namespace',
      accessorFn: (schedule) => getScheduleNamespace(schedule),
      Cell: ({ row }) => {
        const ns = getScheduleNamespace(row.original);
        return ns ? (
          <Link routeName="namespace" params={{ name: ns }}>
            {ns}
          </Link>
        ) : '-';
      },
      filterVariant: 'select',
      filterSelectOptions: Array.from(new Set(schedules.map(s => getScheduleNamespace(s)).filter(Boolean))),
    },
    {
      id: 'vm',
      header: 'VM',
      accessorFn: (schedule) => getVMName(schedule) || 'All VMs',
      Cell: ({ row }) => {
        const vmName = getVMName(row.original);
        const vmNamespace = getScheduleNamespace(row.original);
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
      id: 'schedule',
      header: 'Schedule',
      accessorFn: (schedule) => parseCronExpression(schedule.spec.schedule),
      Cell: ({ row }) => (
        <Tooltip title={row.original.spec.schedule}>
          <Chip
            icon={<Icon icon="mdi:clock-outline" />}
            label={parseCronExpression(row.original.spec.schedule)}
            size="small"
            variant="outlined"
          />
        </Tooltip>
      ),
    },
    {
      id: 'lastBackup',
      header: 'Last Backup',
      accessorFn: (schedule) => schedule.status?.lastBackup ? new Date(schedule.status.lastBackup).getTime() : 0,
      Cell: ({ row }) => formatDateTime(row.original.status?.lastBackup),
      enableColumnFilter: false,
    },
    {
      id: 'retention',
      header: 'Retention',
      accessorFn: (schedule) => schedule.spec.template?.ttl || '',
      Cell: ({ row }) => formatTTL(row.original.spec.template?.ttl || ''),
      enableColumnFilter: false,
      show: false,
    },
    {
      id: 'created',
      header: 'Created',
      accessorFn: (schedule) => new Date(schedule.metadata.creationTimestamp).getTime(),
      Cell: ({ row }) => formatDateTime(row.original.metadata.creationTimestamp),
      enableColumnFilter: false,
      show: false,
    },
  ], [schedules]);

  // Create schedule
  const handleCreateSchedule = async () => {
    if (!scheduleName || !selectedNamespace || !scheduleExpression) {
      enqueueSnackbar('Please fill required fields', { variant: 'warning' });
      return;
    }

    const template: any = {
      includedNamespaces: [selectedNamespace],
      resourcePolicies: {
        kind: 'configmap',
        name: 'velero-volume-policies',
      },
      itemOperationTimeout: '6h0m0s',
      ttl: ttl,
    };

    if (snapshotVolumes) {
      template.snapshotVolumes = true;
      if (snapshotMoveData) {
        template.snapshotMoveData = true;
      }
    } else {
      template.snapshotVolumes = false;
    }

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

  // Delete selected schedules
  const handleDeleteSelected = async (items: VeleroSchedule[]) => {
    let successCount = 0;
    let errorCount = 0;

    for (const schedule of items) {
      try {
        await ApiProxy.request(
          `/apis/velero.io/v1/namespaces/${schedule.metadata.namespace}/schedules/${schedule.metadata.name}`,
          { method: 'DELETE' }
        );
        successCount++;
      } catch {
        errorCount++;
      }
    }

    if (successCount > 0) {
      enqueueSnackbar(`${successCount} schedule(s) deleted`, { variant: 'success' });
    }
    if (errorCount > 0) {
      enqueueSnackbar(`Failed to delete ${errorCount} schedule(s)`, { variant: 'error' });
    }

    fetchSchedules();
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
      <ResourceList<VeleroSchedule>
        title="Backup Schedules"
        data={schedules}
        columns={columns}
        loading={loading}
        showNamespaceFilter={true}
        namespaceGetter={getScheduleNamespace}
        enableRowSelection={true}
        onSelectionChange={setSelectedSchedules}
        id="kubevirt-schedules"
        defaultSortingColumn={{ id: 'created', desc: true }}
        emptyMessage="No backup schedules found"
        toolbarAction={
          <Button
            variant="contained"
            startIcon={<Icon icon="mdi:plus" />}
            onClick={() => setScheduleDialogOpen(true)}
          >
            Create Schedule
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
