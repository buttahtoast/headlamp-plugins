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

type SortDirection = 'asc' | 'desc';
type SortField = 'name' | 'namespace' | 'vm' | 'status' | 'started' | 'completed' | 'expires' | 'errors';

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
  { id: 'status', label: 'Status', minWidth: 100, sortable: true, filterable: true },
  { id: 'started', label: 'Started', minWidth: 150, sortable: true, filterable: false },
  { id: 'completed', label: 'Completed', minWidth: 150, sortable: true, filterable: false },
  { id: 'expires', label: 'Expires', minWidth: 100, sortable: true, filterable: false },
  { id: 'errors', label: 'Errors', minWidth: 80, sortable: true, filterable: false },
];

export default function BackupList() {
  const { enqueueSnackbar } = useSnackbar();
  const [backups, setBackups] = useState<VeleroBackup[]>([]);
  const [loading, setLoading] = useState(true);
  const [veleroInstalled, setVeleroInstalled] = useState(true);
  const [backupDialogOpen, setBackupDialogOpen] = useState(false);

  // Selection state
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Sort state
  const [sortField, setSortField] = useState<SortField>('started');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  // Filter state
  const [filters, setFilters] = useState<Record<string, string>>({
    name: '',
    namespace: '',
    vm: '',
    status: '',
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
      setBackups(response.items || []);
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
  const handleCreateBackup = async () => {
    if (!backupName || !selectedNamespace) {
      enqueueSnackbar('Please fill required fields', { variant: 'warning' });
      return;
    }

    const spec: any = {
      includedNamespaces: [selectedNamespace],
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

  // Delete selected backups
  const handleDeleteSelected = async () => {
    const selectedBackups = backups.filter(b => selected.has(b.metadata.name));
    let successCount = 0;
    let errorCount = 0;

    for (const backup of selectedBackups) {
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
        successCount++;
      } catch {
        errorCount++;
      }
    }

    if (successCount > 0) {
      enqueueSnackbar(`${successCount} backup(s) deletion requested`, { variant: 'success' });
    }
    if (errorCount > 0) {
      enqueueSnackbar(`Failed to delete ${errorCount} backup(s)`, { variant: 'error' });
    }

    setSelected(new Set());
    fetchBackups();
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

  // Sort and filter backups
  const processedBackups = useMemo(() => {
    let result = [...backups];

    // Apply global search
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(b => {
        const name = b.metadata.name.toLowerCase();
        const ns = getBackupNamespace(b).toLowerCase();
        const vm = (getVMName(b) || 'all vms').toLowerCase();
        const status = (b.status?.phase || 'new').toLowerCase();
        return name.includes(query) || ns.includes(query) || vm.includes(query) || status.includes(query);
      });
    }

    // Apply column filters
    if (filters.name) {
      result = result.filter(b => b.metadata.name.toLowerCase().includes(filters.name.toLowerCase()));
    }
    if (filters.namespace) {
      result = result.filter(b => getBackupNamespace(b).toLowerCase().includes(filters.namespace.toLowerCase()));
    }
    if (filters.vm) {
      result = result.filter(b => {
        const vmName = getVMName(b) || 'All VMs';
        return vmName.toLowerCase().includes(filters.vm.toLowerCase());
      });
    }
    if (filters.status) {
      result = result.filter(b => (b.status?.phase || 'New').toLowerCase().includes(filters.status.toLowerCase()));
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
          aVal = getBackupNamespace(a);
          bVal = getBackupNamespace(b);
          break;
        case 'vm':
          aVal = getVMName(a) || 'All VMs';
          bVal = getVMName(b) || 'All VMs';
          break;
        case 'status':
          aVal = a.status?.phase || 'New';
          bVal = b.status?.phase || 'New';
          break;
        case 'started':
          aVal = a.status?.startTimestamp ? new Date(a.status.startTimestamp).getTime() : 0;
          bVal = b.status?.startTimestamp ? new Date(b.status.startTimestamp).getTime() : 0;
          break;
        case 'completed':
          aVal = a.status?.completionTimestamp ? new Date(a.status.completionTimestamp).getTime() : 0;
          bVal = b.status?.completionTimestamp ? new Date(b.status.completionTimestamp).getTime() : 0;
          break;
        case 'expires':
          aVal = a.status?.expiration ? new Date(a.status.expiration).getTime() : 0;
          bVal = b.status?.expiration ? new Date(b.status.expiration).getTime() : 0;
          break;
        case 'errors':
          aVal = (a.status?.errors || 0) + (a.status?.warnings || 0);
          bVal = (b.status?.errors || 0) + (b.status?.warnings || 0);
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
  }, [backups, filters, sortField, sortDirection, searchQuery]);

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
      setSelected(new Set(processedBackups.map(b => b.metadata.name)));
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
    if (!dateStr) return '-';
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
            <IconButton
              onClick={(e) => setColumnMenuAnchor(e.currentTarget)}
            >
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
                    indeterminate={selected.size > 0 && selected.size < processedBackups.length}
                    checked={processedBackups.length > 0 && selected.size === processedBackups.length}
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
              {processedBackups.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={visibleColumnDefs.length + 1} align="center" sx={{ py: 4 }}>
                    <Typography color="text.secondary">No backups found</Typography>
                  </TableCell>
                </TableRow>
              ) : (
                processedBackups.map((backup) => (
                  <TableRow
                    key={backup.metadata.name}
                    hover
                    selected={selected.has(backup.metadata.name)}
                  >
                    <TableCell padding="checkbox">
                      <Checkbox
                        checked={selected.has(backup.metadata.name)}
                        onChange={() => handleSelectOne(backup.metadata.name)}
                      />
                    </TableCell>
                    {visibleColumns.has('name') && (
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
                    )}
                    {visibleColumns.has('namespace') && (
                      <TableCell>{getBackupNamespace(backup) || '-'}</TableCell>
                    )}
                    {visibleColumns.has('vm') && (
                      <TableCell>{getVMName(backup) || 'All VMs'}</TableCell>
                    )}
                    {visibleColumns.has('status') && (
                      <TableCell>
                        <Chip
                          label={backup.status?.phase || 'New'}
                          size="small"
                          color={getStatusColor(backup.status?.phase || '')}
                        />
                      </TableCell>
                    )}
                    {visibleColumns.has('started') && (
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>
                        {formatDateTime(backup.status?.startTimestamp)}
                      </TableCell>
                    )}
                    {visibleColumns.has('completed') && (
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>
                        {formatDateTime(backup.status?.completionTimestamp)}
                      </TableCell>
                    )}
                    {visibleColumns.has('expires') && (
                      <TableCell>
                        {backup.status?.expiration
                          ? new Date(backup.status.expiration).toLocaleDateString()
                          : '-'}
                      </TableCell>
                    )}
                    {visibleColumns.has('errors') && (
                      <TableCell>
                        {(backup.status?.errors || 0) > 0 || (backup.status?.warnings || 0) > 0 ? (
                          <Box sx={{ display: 'flex', gap: 0.5 }}>
                            {(backup.status?.errors || 0) > 0 && (
                              <Chip label={backup.status?.errors} size="small" color="error" />
                            )}
                            {(backup.status?.warnings || 0) > 0 && (
                              <Chip label={backup.status?.warnings} size="small" color="warning" />
                            )}
                          </Box>
                        ) : '-'}
                      </TableCell>
                    )}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
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
