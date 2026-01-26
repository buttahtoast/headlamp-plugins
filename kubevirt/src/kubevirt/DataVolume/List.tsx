import {
  Link,
  SimpleTableProps,
} from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Resource } from '@kinvolk/headlamp-plugin/lib/components/common';
import { ApiError } from '@kinvolk/headlamp-plugin/lib/lib/k8s/apiProxy';
import {
  Box,
  Chip,
  LinearProgress,
  Tooltip,
  Typography,
} from '@mui/material';
import { useKubeVirtInstalled, KubeVirtNotInstalled, KubeVirtCheckLoading, formatBytes } from '../utils/kubeVirtCheck';
import DataVolume from './DataVolume';

export interface DataVolumeListProps {
  items: DataVolume[] | null;
  error: ApiError | null;
  hideColumns?: ['namespace'];
  reflectTableInURL?: SimpleTableProps['reflectInURL'];
  noNamespaceFilter?: boolean;
}

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

export function DataVolumeListRenderer(props: DataVolumeListProps) {
  const { items, error, hideColumns = [], noNamespaceFilter } = props;

  return (
    <Resource.ResourceListView
      title={'Data Volumes'}
      headerProps={{
        noNamespaceFilter,
      }}
      hideColumns={hideColumns}
      errorMessage={error?.message || (error ? String(error) : '')}
      columns={[
        {
          id: 'name',
          label: 'Name',
          getValue: dv => dv.getName(),
          render: dv => (
            <Link
              routeName="datavolume"
              params={{ name: dv.getName(), namespace: dv.getNamespace() }}
            >
              {dv.getName()}
            </Link>
          ),
        },
        'namespace',
        'cluster',
        {
          id: 'phase',
          label: 'Phase',
          getValue: dv => dv.getPhase(),
          render: dv => {
            const phase = dv.getPhase();
            return (
              <Chip
                label={phase}
                size="small"
                color={getPhaseColor(phase)}
                variant="outlined"
              />
            );
          },
        },
        {
          id: 'progress',
          label: 'Progress',
          getValue: dv => dv.getProgress(),
          render: dv => {
            const progress = dv.getProgress();
            const phase = dv.getPhase();

            if (phase === 'Succeeded') {
              return (
                <Chip label="Complete" size="small" color="success" variant="outlined" />
              );
            }

            if (phase === 'Failed') {
              return (
                <Chip label="Failed" size="small" color="error" variant="outlined" />
              );
            }

            if (progress === '-' || progress === 'N/A') {
              return <Typography variant="caption" color="text.secondary">-</Typography>;
            }

            // Parse progress percentage
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
        },
        {
          id: 'source',
          label: 'Source',
          getValue: dv => dv.getSourceType(),
          render: dv => {
            const sourceType = dv.getSourceType();
            return (
              <Chip
                label={sourceType}
                size="small"
                color={getSourceColor(sourceType)}
                variant="outlined"
              />
            );
          },
        },
        {
          id: 'size',
          label: 'Size',
          getValue: dv => dv.getStorageSize(),
          render: dv => {
            const size = dv.getStorageSize();
            const formattedSize = formatBytes(size);
            return formattedSize && formattedSize !== '-' ? (
              <Chip label={formattedSize} size="small" variant="outlined" />
            ) : (
              <Typography variant="caption" color="text.secondary">-</Typography>
            );
          },
        },
        {
          id: 'storageClass',
          label: 'Storage Class',
          getValue: dv => dv.getStorageClass(),
          render: dv => {
            const sc = dv.getStorageClass();
            return sc && sc !== '-' ? (
              <Link routeName="storageClass" params={{ name: sc }}>
                {sc}
              </Link>
            ) : (
              <Typography variant="caption" color="text.secondary">-</Typography>
            );
          },
        },
        'age',
      ]}
      data={items}
      reflectInURL
      id="headlamp-datavolumes"
    />
  );
}

export default function DataVolumeList() {
  const { installed: kubeVirtInstalled, checking: checkingKubeVirt } = useKubeVirtInstalled();
  const { items, error } = DataVolume.useList({});

  if (checkingKubeVirt) {
    return <KubeVirtCheckLoading />;
  }

  if (kubeVirtInstalled === false) {
    return <KubeVirtNotInstalled />;
  }

  return (
    <DataVolumeListRenderer
      items={items}
      error={error}
      reflectTableInURL
      noNamespaceFilter={false}
    />
  );
}
