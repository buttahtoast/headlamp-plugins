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
  IconButton,
  InputAdornment,
  InputLabel,
  Menu,
  MenuItem,
  Paper,
  Select,
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

type SortDirection = 'asc' | 'desc';
type SortField = 'name' | 'backup' | 'status' | 'mapping' | 'started' | 'duration' | 'errors';

interface ColumnDef {
  id: SortField;
  label: string;
  minWidth: number;
  sortable: boolean;
  filterable: boolean;
}

const ALL_COLUMNS: ColumnDef[] = [
  { id: 'name', label: 'Name', minWidth: 280, sortable: true, filterable: true },
  { id: 'backup', label: 'Backup', minWidth: 200, sortable: true, filterable: true },
  { id: 'status', label: 'Status', minWidth: 100, sortable: true, filterable: true },
  { id: 'mapping', label: 'Namespace Mapping', minWidth: 180, sortable: false, filterable: false },
  { id: 'started', label: 'Started', minWidth: 150, sortable: true, filterable: false },
  { id: 'duration', label: 'Duration', minWidth: 100, sortable: true, filterable: false },
  { id: 'errors', label: 'Errors', minWidth: 80, sortable: true, filterable: false },
];

export default function RestoreList() {
  const { enqueueSnackbar } = useSnackbar();
  const [restores, setRestores] = useState<VeleroRestore[]>([]);
  const [backups, setBackups] = useState<VeleroBackup[]>([]);
  const [loading, setLoading] = useState(true);
  const [veleroInstalled, setVeleroInstalled] = useState(true);
  const [restoreDialogOpen, setRestoreDialogOpen] = useState(false);

  // Selection state
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Sort state
  const [sortField, setSortField] = useState<SortField>('started');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  // Filter state
  const [filters, setFilters] = useState<Record<string, string>>({
    name: '',
    backup: '',
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

  // Delete selected restores
  const handleDeleteSelected = async () => {
    const selectedRestores = restores.filter(r => selected.has(r.metadata.name));
    let successCount = 0;
    let errorCount = 0;

    for (const restore of selectedRestores) {
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

    setSelected(new Set());
    fetchData();
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

  // Get duration in ms for sorting
  const getDurationMs = (restore: VeleroRestore): number => {
    if (!restore.status?.startTimestamp) return 0;
    const start = new Date(restore.status.startTimestamp).getTime();
    const end = restore.status.completionTimestamp
      ? new Date(restore.status.completionTimestamp).getTime()
      : Date.now();
    return end - start;
  };

  // Sort and filter restores
  const processedRestores = useMemo(() => {
    let result = [...restores];

    // Apply global search
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(r => {
        const name = r.metadata.name.toLowerCase();
        const backup = r.spec.backupName.toLowerCase();
        const status = (r.status?.phase || 'new').toLowerCase();
        return name.includes(query) || backup.includes(query) || status.includes(query);
      });
    }

    // Apply column filters
    if (filters.name) {
      result = result.filter(r => r.metadata.name.toLowerCase().includes(filters.name.toLowerCase()));
    }
    if (filters.backup) {
      result = result.filter(r => r.spec.backupName.toLowerCase().includes(filters.backup.toLowerCase()));
    }
    if (filters.status) {
      result = result.filter(r => (r.status?.phase || 'New').toLowerCase().includes(filters.status.toLowerCase()));
    }

    // Apply sorting
    result.sort((a, b) => {
      let aVal: any, bVal: any;
      switch (sortField) {
        case 'name':
          aVal = a.metadata.name;
          bVal = b.metadata.name;
          break;
        case 'backup':
          aVal = a.spec.backupName;
          bVal = b.spec.backupName;
          break;
        case 'status':
          aVal = a.status?.phase || 'New';
          bVal = b.status?.phase || 'New';
          break;
        case 'started':
          aVal = a.status?.startTimestamp ? new Date(a.status.startTimestamp).getTime() : 0;
          bVal = b.status?.startTimestamp ? new Date(b.status.startTimestamp).getTime() : 0;
          break;
        case 'duration':
          aVal = getDurationMs(a);
          bVal = getDurationMs(b);
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
  }, [restores, filters, sortField, sortDirection, searchQuery]);

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
      setSelected(new Set(processedRestores.map(r => r.metadata.name)));
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
        {/* Controls Toolbar */}
        <Toolbar
          variant="dense"
          disableGutters
          sx={{ mb: 1, gap: 1, minHeight: 'auto', flexWrap: 'wrap' }}
        >
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

          {selected.size > 0 && (
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                bgcolor: 'action.selected',
                borderRadius: 1,
                px: 1.5,
                py: 0.5,
              }}
            >
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
              {/* Header row */}
              <TableRow>
                <TableCell padding="checkbox">
                  <Checkbox
                    indeterminate={selected.size > 0 && selected.size < processedRestores.length}
                    checked={processedRestores.length > 0 && selected.size === processedRestores.length}
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
              {/* Filter row - below header */}
              {showFilters && (
                <TableRow>
                  <TableCell padding="checkbox" />
                  {visibleColumnDefs.map((col) => (
                    <TableCell key={col.id} sx={{ minWidth: col.minWidth, pt: 0 }}>
                      {col.filterable ? (
                        <TextField
                          size="small"
                          placeholder={`Filter...`}
                          value={filters[col.id] || ''}
                          onChange={(e) => setFilters({ ...filters, [col.id]: e.target.value })}
                          fullWidth
                          variant="standard"
                        />
                      ) : null}
                    </TableCell>
                  ))}
                </TableRow>
              )}
            </TableHead>
            <TableBody>
              {processedRestores.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={visibleColumnDefs.length + 1} align="center" sx={{ py: 4 }}>
                    <Typography color="text.secondary">No restores found</Typography>
                  </TableCell>
                </TableRow>
              ) : (
                processedRestores.map((restore) => (
                  <TableRow
                    key={restore.metadata.name}
                    hover
                    selected={selected.has(restore.metadata.name)}
                  >
                    <TableCell padding="checkbox">
                      <Checkbox
                        checked={selected.has(restore.metadata.name)}
                        onChange={() => handleSelectOne(restore.metadata.name)}
                      />
                    </TableCell>
                    {visibleColumns.has('name') && (
                      <TableCell>
                        <Link
                          routeName="restore"
                          params={{ name: restore.metadata.name }}
                        >
                          {restore.metadata.name}
                        </Link>
                      </TableCell>
                    )}
                    {visibleColumns.has('backup') && (
                      <TableCell>
                        <Link
                          routeName="backup"
                          params={{
                            namespace: 'velero',
                            name: restore.spec.backupName,
                          }}
                        >
                          {restore.spec.backupName}
                        </Link>
                      </TableCell>
                    )}
                    {visibleColumns.has('status') && (
                      <TableCell>
                        <Chip
                          label={restore.status?.phase || 'New'}
                          size="small"
                          color={getStatusColor(restore.status?.phase || '')}
                        />
                      </TableCell>
                    )}
                    {visibleColumns.has('mapping') && (
                      <TableCell>
                        {(() => {
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
                        })()}
                      </TableCell>
                    )}
                    {visibleColumns.has('started') && (
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>
                        {formatDateTime(restore.status?.startTimestamp)}
                      </TableCell>
                    )}
                    {visibleColumns.has('duration') && (
                      <TableCell>
                        {formatDuration(restore.status?.startTimestamp, restore.status?.completionTimestamp)}
                      </TableCell>
                    )}
                    {visibleColumns.has('errors') && (
                      <TableCell>
                        {(restore.status?.errors || 0) > 0 || (restore.status?.warnings || 0) > 0 ? (
                          <Box sx={{ display: 'flex', gap: 0.5 }}>
                            {(restore.status?.errors || 0) > 0 && (
                              <Chip label={restore.status?.errors} size="small" color="error" />
                            )}
                            {(restore.status?.warnings || 0) > 0 && (
                              <Chip label={restore.status?.warnings} size="small" color="warning" />
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
