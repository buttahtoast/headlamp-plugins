import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { Link } from '@kinvolk/headlamp-plugin/lib/components/common';
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  LinearProgress,
  MenuItem,
  Select,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { Icon } from '@iconify/react';
import { useSnackbar } from 'notistack';
import { useEffect, useMemo, useState } from 'react';
import { ResourceList, ResourceListColumn } from '../components/ResourceList';
import { useKubeVirtInstalled, KubeVirtNotInstalled, KubeVirtCheckLoading, formatBytes } from '../utils/kubeVirtCheck';
import DataVolume from './DataVolume';

// Helper functions - defined before useMemo
function getPhaseColor(phase: string): 'success' | 'error' | 'warning' | 'info' | 'default' {
  switch (phase) {
    case 'Succeeded':
      return 'success';
    case 'Failed':
      return 'error';
    case 'ImportInProgress':
    case 'CloneInProgress':
    case 'UploadReady':
    case 'Pending':
    case 'WaitForFirstConsumer':
      return 'warning';
    case 'Paused':
      return 'info';
    default:
      return 'default';
  }
}

function getSourceColor(sourceType: string): 'primary' | 'success' | 'warning' | 'info' | 'default' {
  switch (sourceType) {
    case 'HTTP':
      return 'primary';
    case 'Registry':
      return 'info';
    case 'PVC Clone':
      return 'success';
    case 'Upload':
      return 'warning';
    case 'Blank':
    case 'S3':
    case 'GCS':
      return 'default';
    default:
      return 'default';
  }
}

// DataVolume Bulk Operations Toolbar
interface DVSelectionToolbarProps {
  selectedRows: DataVolume[];
  clearSelection: () => void;
}

function DVSelectionToolbar({
  selectedRows,
  clearSelection,
}: DVSelectionToolbarProps) {
  const { enqueueSnackbar } = useSnackbar();

  if (selectedRows.length === 0) return null;

  const handleBulkDelete = async () => {
    let successCount = 0;
    let errorCount = 0;

    for (const dv of selectedRows) {
      try {
        await ApiProxy.request(
          `/apis/cdi.kubevirt.io/v1beta1/namespaces/${dv.getNamespace()}/datavolumes/${dv.getName()}`,
          { method: 'DELETE' }
        );
        successCount++;
      } catch (error) {
        errorCount++;
        console.error(`Failed to delete DataVolume ${dv.getName()}:`, error);
      }
    }

    if (successCount > 0) {
      enqueueSnackbar(`${successCount} DataVolume(s) deleted`, { variant: 'success' });
    }
    if (errorCount > 0) {
      enqueueSnackbar(`Failed to delete ${errorCount} DataVolume(s)`, { variant: 'error' });
    }

    clearSelection();
  };

  return (
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
      <Typography variant="body2" color="text.secondary" sx={{ mr: 1 }}>
        {selectedRows.length} selected
      </Typography>

      <Button
        variant="contained"
        color="error"
        size="small"
        startIcon={<Icon icon="mdi:delete" />}
        onClick={handleBulkDelete}
      >
        Delete ({selectedRows.length})
      </Button>
    </Box>
  );
}

export default function DataVolumeList() {
  const { enqueueSnackbar } = useSnackbar();
  const { installed: kubeVirtInstalled, checking: checkingKubeVirt } = useKubeVirtInstalled();
  const { items, error } = DataVolume.useList({});

  // Dialog state
  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  // Create DataVolume form state
  const [dvName, setDvName] = useState('');
  const [dvNamespace, setDvNamespace] = useState('default');
  const [dvSize, setDvSize] = useState('10Gi');
  const [dvSource, setDvSource] = useState('blank');
  const [dvSourceUrl, setDvSourceUrl] = useState('');
  const [dvSourcePvc, setDvSourcePvc] = useState('');
  const [dvSourcePvcNs, setDvSourcePvcNs] = useState('');
  const [dvStorageClass, setDvStorageClass] = useState('');
  const [dvAccessMode, setDvAccessMode] = useState('ReadWriteOnce');

  // Fetch namespaces and storage classes
  const [namespaces, setNamespaces] = useState<string[]>(['default']);
  const [storageClasses, setStorageClasses] = useState<string[]>([]);

  useEffect(() => {
    const fetchResources = async () => {
      try {
        const [nsResponse, scResponse] = await Promise.all([
          ApiProxy.request('/api/v1/namespaces') as Promise<{ items: any[] }>,
          ApiProxy.request('/apis/storage.k8s.io/v1/storageclasses') as Promise<{ items: any[] }>,
        ]);
        const nsList = nsResponse.items?.map(ns => ns.metadata.name) || ['default'];
        const scList = scResponse.items?.map(sc => sc.metadata.name) || [];
        setNamespaces(nsList.sort());
        setStorageClasses(scList.sort());
      } catch (error) {
        console.error('Failed to fetch resources:', error);
      }
    };
    fetchResources();
  }, []);

  // Get unique phase options for filter
  const phaseOptions = useMemo(() => {
    const phases = new Set<string>();
    items?.forEach(dv => phases.add(dv.getPhase()));
    return Array.from(phases).sort();
  }, [items]);

  // Get unique source type options for filter
  const sourceOptions = useMemo(() => {
    const sources = new Set<string>();
    items?.forEach(dv => sources.add(dv.getSourceType()));
    return Array.from(sources).sort();
  }, [items]);

  // Column definitions
  const columns: ResourceListColumn<DataVolume>[] = useMemo(() => [
    {
      id: 'name',
      header: 'Name',
      accessorFn: (dv) => dv.getName(),
      Cell: ({ row }) => (
        <Link
          routeName="datavolume"
          params={{ name: row.original.getName(), namespace: row.original.getNamespace() }}
        >
          {row.original.getName()}
        </Link>
      ),
      gridTemplate: '1.5fr',
    },
    {
      id: 'namespace',
      header: 'Namespace',
      accessorFn: (dv) => dv.getNamespace(),
      Cell: ({ row }) => (
        <Link routeName="namespace" params={{ name: row.original.getNamespace() }}>
          {row.original.getNamespace()}
        </Link>
      ),
      filterVariant: 'select',
      filterSelectOptions: Array.from(new Set(items?.map(dv => dv.getNamespace()) || [])).sort(),
    },
    {
      id: 'phase',
      header: 'Phase',
      accessorFn: (dv) => dv.getPhase(),
      Cell: ({ row }) => {
        const phase = row.original.getPhase();
        return <Chip label={phase} size="small" color={getPhaseColor(phase)} variant="outlined" />;
      },
      filterVariant: 'select',
      filterSelectOptions: phaseOptions,
    },
    {
      id: 'progress',
      header: 'Progress',
      accessorFn: (dv) => dv.getProgress(),
      Cell: ({ row }) => {
        const progress = row.original.getProgress();
        const phase = row.original.getPhase();

        if (phase === 'Succeeded') {
          return <Chip label="Complete" size="small" color="success" variant="outlined" />;
        }

        if (phase === 'Failed') {
          return <Chip label="Failed" size="small" color="error" variant="outlined" />;
        }

        if (progress === '-' || progress === 'N/A') {
          return <Typography variant="caption" color="text.secondary">-</Typography>;
        }

        const match = progress.match(/(\d+(?:\.\d+)?)/);
        const percentage = match ? parseFloat(match[1]) : 0;

        return (
          <Tooltip title={progress}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 100 }}>
              <LinearProgress
                variant="determinate"
                value={percentage}
                color={percentage >= 100 ? 'success' : 'warning'}
                sx={{ flexGrow: 1, height: 6, borderRadius: 3 }}
              />
              <Typography variant="caption" sx={{ minWidth: 40 }}>
                {progress}
              </Typography>
            </Box>
          </Tooltip>
        );
      },
      enableColumnFilter: false,
    },
    {
      id: 'source',
      header: 'Source',
      accessorFn: (dv) => dv.getSourceType(),
      Cell: ({ row }) => {
        const sourceType = row.original.getSourceType();
        return <Chip label={sourceType} size="small" color={getSourceColor(sourceType)} variant="outlined" />;
      },
      filterVariant: 'select',
      filterSelectOptions: sourceOptions,
    },
    {
      id: 'size',
      header: 'Size',
      accessorFn: (dv) => dv.getStorageSize(),
      Cell: ({ row }) => {
        const size = row.original.getStorageSize();
        const formattedSize = formatBytes(size);
        return formattedSize && formattedSize !== '-' ? (
          <Chip label={formattedSize} size="small" variant="outlined" />
        ) : (
          <Typography variant="caption" color="text.secondary">-</Typography>
        );
      },
      enableColumnFilter: false,
    },
    {
      id: 'storageClass',
      header: 'Storage Class',
      accessorFn: (dv) => dv.getStorageClass(),
      Cell: ({ row }) => {
        const sc = row.original.getStorageClass();
        return sc && sc !== '-' ? (
          <Link routeName="storageClass" params={{ name: sc }}>
            {sc}
          </Link>
        ) : (
          <Typography variant="caption" color="text.secondary">-</Typography>
        );
      },
    },
    {
      id: 'age',
      header: 'Age',
      accessorFn: (dv) => new Date(dv.metadata?.creationTimestamp || 0).getTime(),
      Cell: ({ row }) => {
        const created = row.original.metadata?.creationTimestamp;
        if (!created) return '-';
        const date = new Date(created);
        const now = new Date();
        const diffMs = now.getTime() - date.getTime();
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        const diffHours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        if (diffDays > 0) return `${diffDays}d`;
        if (diffHours > 0) return `${diffHours}h`;
        const diffMins = Math.floor(diffMs / (1000 * 60));
        return `${diffMins}m`;
      },
      enableColumnFilter: false,
    },
  ], [items, phaseOptions, sourceOptions]);

  // Create DataVolume handler
  const handleCreateDataVolume = async () => {
    if (!dvName || !dvNamespace || !dvSize) {
      enqueueSnackbar('Please fill required fields', { variant: 'warning' });
      return;
    }

    if ((dvSource === 'http' || dvSource === 'registry') && !dvSourceUrl) {
      enqueueSnackbar('Please provide source URL', { variant: 'warning' });
      return;
    }

    if (dvSource === 'pvc' && (!dvSourcePvc || !dvSourcePvcNs)) {
      enqueueSnackbar('Please provide source PVC details', { variant: 'warning' });
      return;
    }

    // Build source configuration
    let source: any = {};
    switch (dvSource) {
      case 'blank':
        source = { blank: {} };
        break;
      case 'http':
        source = { http: { url: dvSourceUrl } };
        break;
      case 'registry':
        source = { registry: { url: dvSourceUrl } };
        break;
      case 'pvc':
        source = { pvc: { namespace: dvSourcePvcNs, name: dvSourcePvc } };
        break;
    }

    const dvSpec: any = {
      apiVersion: 'cdi.kubevirt.io/v1beta1',
      kind: 'DataVolume',
      metadata: {
        name: dvName,
        namespace: dvNamespace,
      },
      spec: {
        source,
        storage: {
          accessModes: [dvAccessMode],
          resources: {
            requests: {
              storage: dvSize,
            },
          },
        },
      },
    };

    if (dvStorageClass) {
      dvSpec.spec.storage.storageClassName = dvStorageClass;
    }

    try {
      await ApiProxy.request(
        `/apis/cdi.kubevirt.io/v1beta1/namespaces/${dvNamespace}/datavolumes`,
        {
          method: 'POST',
          body: JSON.stringify(dvSpec),
          headers: { 'Content-Type': 'application/json' },
        }
      );

      enqueueSnackbar('DataVolume created successfully', { variant: 'success' });
      setCreateDialogOpen(false);
      resetCreateForm();
    } catch (error: any) {
      enqueueSnackbar(`Failed to create DataVolume: ${error.message}`, { variant: 'error' });
    }
  };

  const resetCreateForm = () => {
    setDvName('');
    setDvNamespace('default');
    setDvSize('10Gi');
    setDvSource('blank');
    setDvSourceUrl('');
    setDvSourcePvc('');
    setDvSourcePvcNs('');
    setDvStorageClass('');
    setDvAccessMode('ReadWriteOnce');
  };

  if (checkingKubeVirt) {
    return <KubeVirtCheckLoading />;
  }

  if (kubeVirtInstalled === false) {
    return <KubeVirtNotInstalled />;
  }

  return (
    <>
      <ResourceList<DataVolume>
        title="Data Volumes"
        data={items}
        columns={columns}
        loading={!items}
        errorMessage={error?.message}
        showNamespaceFilter={true}
        namespaceGetter={(dv) => dv.getNamespace()}
        enableRowSelection={true}
        id="kubevirt-datavolumes"
        defaultSortingColumn={{ id: 'name', desc: false }}
        emptyMessage="No data volumes found"
        toolbarAction={
          <Button
            variant="contained"
            startIcon={<Icon icon="mdi:plus" />}
            onClick={() => setCreateDialogOpen(true)}
          >
            Create DataVolume
          </Button>
        }
        renderRowSelectionToolbar={({ selectedRows, clearSelection }) => (
          <DVSelectionToolbar
            selectedRows={selectedRows}
            clearSelection={clearSelection}
          />
        )}
      />

      {/* Create DataVolume Dialog */}
      <Dialog
        open={createDialogOpen}
        onClose={() => setCreateDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Create DataVolume</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
            <TextField
              label="Name"
              value={dvName}
              onChange={(e) => setDvName(e.target.value)}
              placeholder="my-datavolume"
              fullWidth
              required
            />

            <FormControl fullWidth required>
              <InputLabel>Namespace</InputLabel>
              <Select
                value={dvNamespace}
                label="Namespace"
                onChange={(e) => setDvNamespace(e.target.value)}
              >
                {namespaces.map(ns => (
                  <MenuItem key={ns} value={ns}>{ns}</MenuItem>
                ))}
              </Select>
            </FormControl>

            <FormControl fullWidth>
              <InputLabel>Source Type</InputLabel>
              <Select
                value={dvSource}
                label="Source Type"
                onChange={(e) => setDvSource(e.target.value)}
              >
                <MenuItem value="blank">Blank Disk</MenuItem>
                <MenuItem value="http">HTTP URL (ISO/QCOW2)</MenuItem>
                <MenuItem value="registry">Container Registry</MenuItem>
                <MenuItem value="pvc">Clone from PVC</MenuItem>
              </Select>
            </FormControl>

            {(dvSource === 'http' || dvSource === 'registry') && (
              <TextField
                label={dvSource === 'http' ? 'Image URL' : 'Container Image'}
                value={dvSourceUrl}
                onChange={(e) => setDvSourceUrl(e.target.value)}
                placeholder={dvSource === 'http'
                  ? 'https://example.com/image.qcow2'
                  : 'docker://quay.io/kubevirt/fedora-cloud-container-disk-demo'
                }
                fullWidth
                required
              />
            )}

            {dvSource === 'pvc' && (
              <>
                <FormControl fullWidth required>
                  <InputLabel>Source PVC Namespace</InputLabel>
                  <Select
                    value={dvSourcePvcNs}
                    label="Source PVC Namespace"
                    onChange={(e) => setDvSourcePvcNs(e.target.value)}
                  >
                    {namespaces.map(ns => (
                      <MenuItem key={ns} value={ns}>{ns}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <TextField
                  label="Source PVC Name"
                  value={dvSourcePvc}
                  onChange={(e) => setDvSourcePvc(e.target.value)}
                  placeholder="source-pvc"
                  fullWidth
                  required
                />
              </>
            )}

            <TextField
              label="Size"
              value={dvSize}
              onChange={(e) => setDvSize(e.target.value)}
              placeholder="10Gi"
              fullWidth
              required
            />

            <FormControl fullWidth>
              <InputLabel>Storage Class (optional)</InputLabel>
              <Select
                value={dvStorageClass}
                label="Storage Class (optional)"
                onChange={(e) => setDvStorageClass(e.target.value)}
              >
                <MenuItem value="">Default</MenuItem>
                {storageClasses.map(sc => (
                  <MenuItem key={sc} value={sc}>{sc}</MenuItem>
                ))}
              </Select>
            </FormControl>

            <FormControl fullWidth>
              <InputLabel>Access Mode</InputLabel>
              <Select
                value={dvAccessMode}
                label="Access Mode"
                onChange={(e) => setDvAccessMode(e.target.value)}
              >
                <MenuItem value="ReadWriteOnce">ReadWriteOnce (RWO)</MenuItem>
                <MenuItem value="ReadWriteMany">ReadWriteMany (RWX)</MenuItem>
                <MenuItem value="ReadOnlyMany">ReadOnlyMany (ROX)</MenuItem>
              </Select>
            </FormControl>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setCreateDialogOpen(false); resetCreateForm(); }}>
            Cancel
          </Button>
          <Button onClick={handleCreateDataVolume} variant="contained">
            Create DataVolume
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
