import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { Link, SectionBox } from '@kinvolk/headlamp-plugin/lib/components/common';
import {
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  IconButton,
  InputAdornment,
  InputLabel,
  Menu,
  MenuItem,
  Paper,
  Select,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TableSortLabel,
  TextField,
  Toolbar,
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

type SortDirection = 'asc' | 'desc';
type SortField = 'name' | 'namespace' | 'vm' | 'schedule' | 'lastBackup' | 'retention' | 'created';

interface ColumnDef {
  id: SortField;
  label: string;
  minWidth: number;
  sortable: boolean;
  filterable: boolean;
}

const ALL_COLUMNS: ColumnDef[] = [
  { id: 'name', label: 'Name', minWidth: 280, sortable: true, filterable: true },
  { id: 'namespace', label: 'VM Namespace', minWidth: 120, sortable: true, filterable: true },
  { id: 'vm', label: 'VM', minWidth: 120, sortable: true, filterable: true },
  { id: 'schedule', label: 'Schedule', minWidth: 180, sortable: true, filterable: true },
  { id: 'lastBackup', label: 'Last Backup', minWidth: 150, sortable: true, filterable: false },
  { id: 'retention', label: 'Retention', minWidth: 100, sortable: true, filterable: false },
  { id: 'created', label: 'Created', minWidth: 150, sortable: true, filterable: false },
];

export default function ScheduleList() {
  const { enqueueSnackbar } = useSnackbar();
  const [schedules, setSchedules] = useState<VeleroSchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [veleroInstalled, setVeleroInstalled] = useState(true);
  const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false);

  // Selection state
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Sort state
  const [sortField, setSortField] = useState<SortField>('created');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  // Filter state
  const [filters, setFilters] = useState<Record<string, string>>({
    name: '',
    namespace: '',
    vm: '',
    schedule: '',
  });

  // Search and display state
  const [showSearch, setShowSearch] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [visibleColumns, setVisibleColumns] = useState<Set<SortField>>(
    new Set(ALL_COLUMNS.map(c => c.id))
  );
  const [columnMenuAnchor, setColumnMenuAnchor] = useState<null | HTMLElement>(null);

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
  const handleDeleteSelected = async () => {
    const selectedSchedules = schedules.filter(s => selected.has(s.metadata.name));
    let successCount = 0;
    let errorCount = 0;

    for (const schedule of selectedSchedules) {
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

    setSelected(new Set());
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
  const formatTTL = (ttlValue: string): string => {
    if (ttlValue === '168h') return '7 days';
    if (ttlValue === '720h') return '30 days';
    if (ttlValue === '2160h') return '90 days';
    if (ttlValue === '8760h') return '1 year';
    return ttlValue || '-';
  };

  // Sort and filter schedules
  const processedSchedules = useMemo(() => {
    let result = [...schedules];

    // Apply global search
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(s => {
        const name = s.metadata.name.toLowerCase();
        const ns = getScheduleNamespace(s).toLowerCase();
        const vm = (getVMName(s) || 'all vms').toLowerCase();
        const sched = parseCronExpression(s.spec.schedule).toLowerCase();
        return name.includes(query) || ns.includes(query) || vm.includes(query) || sched.includes(query);
      });
    }

    // Apply column filters
    if (filters.name) {
      result = result.filter(s => s.metadata.name.toLowerCase().includes(filters.name.toLowerCase()));
    }
    if (filters.namespace) {
      result = result.filter(s => getScheduleNamespace(s).toLowerCase().includes(filters.namespace.toLowerCase()));
    }
    if (filters.vm) {
      result = result.filter(s => {
        const vmName = getVMName(s) || 'All VMs';
        return vmName.toLowerCase().includes(filters.vm.toLowerCase());
      });
    }
    if (filters.schedule) {
      result = result.filter(s => {
        const readable = parseCronExpression(s.spec.schedule);
        return readable.toLowerCase().includes(filters.schedule.toLowerCase()) ||
               s.spec.schedule.toLowerCase().includes(filters.schedule.toLowerCase());
      });
    }

    // Apply sorting
    result.sort((a, b) => {
      let aVal: any, bVal: any;
      switch (sortField) {
        case 'name':
          aVal = a.metadata.name;
          bVal = b.metadata.name;
          break;
        case 'namespace':
          aVal = getScheduleNamespace(a);
          bVal = getScheduleNamespace(b);
          break;
        case 'vm':
          aVal = getVMName(a) || 'All VMs';
          bVal = getVMName(b) || 'All VMs';
          break;
        case 'schedule':
          aVal = a.spec.schedule;
          bVal = b.spec.schedule;
          break;
        case 'lastBackup':
          aVal = a.status?.lastBackup ? new Date(a.status.lastBackup).getTime() : 0;
          bVal = b.status?.lastBackup ? new Date(b.status.lastBackup).getTime() : 0;
          break;
        case 'retention':
          aVal = a.spec.template?.ttl || '';
          bVal = b.spec.template?.ttl || '';
          break;
        case 'created':
          aVal = new Date(a.metadata.creationTimestamp).getTime();
          bVal = new Date(b.metadata.creationTimestamp).getTime();
          break;
        default:
          aVal = a.metadata.name;
          bVal = b.metadata.name;
      }

      if (typeof aVal === 'string') {
        return sortDirection === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }
      return sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
    });

    return result;
  }, [schedules, filters, sortField, sortDirection, searchQuery]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const handleSelectAll = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.checked) {
      setSelected(new Set(processedSchedules.map(s => s.metadata.name)));
    } else {
      setSelected(new Set());
    }
  };

  const handleSelectOne = (name: string) => {
    const newSelected = new Set(selected);
    if (newSelected.has(name)) {
      newSelected.delete(name);
    } else {
      newSelected.add(name);
    }
    setSelected(newSelected);
  };

  const handleToggleColumn = (columnId: SortField) => {
    const newVisible = new Set(visibleColumns);
    if (newVisible.has(columnId)) {
      newVisible.delete(columnId);
    } else {
      newVisible.add(columnId);
    }
    setVisibleColumns(newVisible);
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

  const visibleColumnDefs = ALL_COLUMNS.filter(c => visibleColumns.has(c.id));

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
        {/* Controls Toolbar */}
        <Toolbar
          variant="dense"
          disableGutters
          sx={{ mb: 1, gap: 1, minHeight: 'auto', flexWrap: 'wrap' }}
        >
          {selected.size > 0 && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography variant="body2" color="text.secondary">
                {selected.size} selected
              </Typography>
              <Button
                variant="contained"
                color="error"
                size="small"
                startIcon={<Icon icon="mdi:delete" />}
                onClick={handleDeleteSelected}
                sx={{ whiteSpace: 'nowrap' }}
              >
                Delete Selected
              </Button>
            </Box>
          )}

          <Box sx={{ flexGrow: 1 }} />

          {showSearch && (
            <TextField
              size="small"
              placeholder="Search all columns..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              sx={{ minWidth: 250 }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <Icon icon="mdi:magnify" width={18} />
                  </InputAdornment>
                ),
                endAdornment: searchQuery && (
                  <InputAdornment position="end">
                    <IconButton size="small" onClick={() => setSearchQuery('')}>
                      <Icon icon="mdi:close" width={16} />
                    </IconButton>
                  </InputAdornment>
                ),
              }}
            />
          )}

          <Tooltip title={showSearch ? 'Hide search' : 'Show search'}>
            <IconButton
              onClick={() => setShowSearch(!showSearch)}
              color={showSearch ? 'primary' : 'default'}
            >
              <Icon icon="mdi:magnify" width={24} />
            </IconButton>
          </Tooltip>
          <Tooltip title={showFilters ? 'Hide filters' : 'Show filters'}>
            <IconButton
              onClick={() => setShowFilters(!showFilters)}
              color={showFilters ? 'primary' : 'default'}
            >
              <Icon icon="mdi:filter-variant" width={24} />
            </IconButton>
          </Tooltip>
          <Tooltip title="Manage columns">
            <IconButton onClick={(e) => setColumnMenuAnchor(e.currentTarget)}>
              <Icon icon="mdi:view-column" width={24} />
            </IconButton>
          </Tooltip>
        </Toolbar>

        {/* Column Menu */}
        <Menu
          anchorEl={columnMenuAnchor}
          open={Boolean(columnMenuAnchor)}
          onClose={() => setColumnMenuAnchor(null)}
        >
          <MenuItem disabled>
            <Typography variant="subtitle2">Show/Hide Columns</Typography>
          </MenuItem>
          {ALL_COLUMNS.map((col) => (
            <MenuItem key={col.id} onClick={() => handleToggleColumn(col.id)}>
              <Checkbox checked={visibleColumns.has(col.id)} size="small" />
              <Typography variant="body2">{col.label}</Typography>
            </MenuItem>
          ))}
        </Menu>

        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              {/* Filter row */}
              {showFilters && (
                <TableRow>
                  <TableCell padding="checkbox" />
                  {visibleColumnDefs.map((col) => (
                    <TableCell key={col.id} sx={{ minWidth: col.minWidth }}>
                      {col.filterable ? (
                        <TextField
                          size="small"
                          placeholder={`Filter ${col.label.toLowerCase()}...`}
                          value={filters[col.id] || ''}
                          onChange={(e) => setFilters({ ...filters, [col.id]: e.target.value })}
                          fullWidth
                        />
                      ) : null}
                    </TableCell>
                  ))}
                </TableRow>
              )}
              {/* Header row */}
              <TableRow>
                <TableCell padding="checkbox">
                  <Checkbox
                    indeterminate={selected.size > 0 && selected.size < processedSchedules.length}
                    checked={processedSchedules.length > 0 && selected.size === processedSchedules.length}
                    onChange={handleSelectAll}
                  />
                </TableCell>
                {visibleColumnDefs.map((col) => (
                  <TableCell
                    key={col.id}
                    sx={{ minWidth: col.minWidth, fontWeight: 'bold', whiteSpace: 'nowrap' }}
                  >
                    {col.sortable ? (
                      <TableSortLabel
                        active={sortField === col.id}
                        direction={sortField === col.id ? sortDirection : 'asc'}
                        onClick={() => handleSort(col.id)}
                      >
                        {col.label}
                      </TableSortLabel>
                    ) : (
                      col.label
                    )}
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {processedSchedules.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={visibleColumnDefs.length + 1} align="center" sx={{ py: 4 }}>
                    <Typography color="text.secondary">No backup schedules found</Typography>
                  </TableCell>
                </TableRow>
              ) : (
                processedSchedules.map((schedule) => (
                  <TableRow
                    key={schedule.metadata.name}
                    hover
                    selected={selected.has(schedule.metadata.name)}
                  >
                    <TableCell padding="checkbox">
                      <Checkbox
                        checked={selected.has(schedule.metadata.name)}
                        onChange={() => handleSelectOne(schedule.metadata.name)}
                      />
                    </TableCell>
                    {visibleColumns.has('name') && (
                      <TableCell>
                        <Link
                          routeName="schedule"
                          params={{ name: schedule.metadata.name }}
                        >
                          {schedule.metadata.name}
                        </Link>
                      </TableCell>
                    )}
                    {visibleColumns.has('namespace') && (
                      <TableCell>
                        {(() => {
                          const ns = getScheduleNamespace(schedule);
                          return ns ? (
                            <Link routeName="namespace" params={{ name: ns }}>
                              {ns}
                            </Link>
                          ) : '-';
                        })()}
                      </TableCell>
                    )}
                    {visibleColumns.has('vm') && (
                      <TableCell>
                        {(() => {
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
                        })()}
                      </TableCell>
                    )}
                    {visibleColumns.has('schedule') && (
                      <TableCell>
                        <Tooltip title={schedule.spec.schedule}>
                          <Chip
                            icon={<Icon icon="mdi:clock-outline" />}
                            label={parseCronExpression(schedule.spec.schedule)}
                            size="small"
                            variant="outlined"
                          />
                        </Tooltip>
                      </TableCell>
                    )}
                    {visibleColumns.has('lastBackup') && (
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>
                        {formatDateTime(schedule.status?.lastBackup)}
                      </TableCell>
                    )}
                    {visibleColumns.has('retention') && (
                      <TableCell>{formatTTL(schedule.spec.template?.ttl || '')}</TableCell>
                    )}
                    {visibleColumns.has('created') && (
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>
                        {formatDateTime(schedule.metadata.creationTimestamp)}
                      </TableCell>
                    )}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
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
