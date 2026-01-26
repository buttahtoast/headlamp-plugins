import { Link, SimpleTableProps } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Resource } from '@kinvolk/headlamp-plugin/lib/components/common';
import { ApiError } from '@kinvolk/headlamp-plugin/lib/lib/k8s/apiProxy';
import { Box, Chip, Typography } from '@mui/material';
import { useKubeVirtInstalled, KubeVirtNotInstalled, KubeVirtCheckLoading } from '../utils/kubeVirtCheck';
import StorageProfile from './StorageProfile';

export interface StorageProfileListProps {
  items: StorageProfile[] | null;
  error: ApiError | null;
  reflectTableInURL?: SimpleTableProps['reflectInURL'];
}

export function StorageProfileListRenderer(props: StorageProfileListProps) {
  const { items, error } = props;

  return (
    <Resource.ResourceListView
      title={'Storage Profiles'}
      headerProps={{
        noNamespaceFilter: true,
      }}
      errorMessage={error?.message || (error ? String(error) : '')}
      columns={[
        {
          id: 'name',
          label: 'Name',
          getValue: item => item.getName(),
          render: item => (
            <Link routeName="storageprofile" params={{ name: item.getName() }}>
              {item.getName()}
            </Link>
          ),
        },
        'cluster',
        {
          id: 'storageClass',
          label: 'Storage Class',
          getValue: item => item.getStorageClass(),
          render: item => {
            const sc = item.getStorageClass();
            return sc !== '-' ? (
              <Link routeName="storageClass" params={{ name: sc }}>
                {sc}
              </Link>
            ) : (
              <Typography variant="caption" color="text.secondary">-</Typography>
            );
          },
        },
        {
          id: 'provisioner',
          label: 'Provisioner',
          getValue: item => item.getProvisioner(),
          render: item => {
            const provisioner = item.getProvisioner();
            if (provisioner === '-') {
              return <Typography variant="caption" color="text.secondary">-</Typography>;
            }
            // Shorten long provisioner names
            const shortName = provisioner.split('/').pop() || provisioner;
            return (
              <Typography variant="body2" title={provisioner}>
                {shortName}
              </Typography>
            );
          },
        },
        {
          id: 'cloneStrategy',
          label: 'Clone Strategy',
          gridTemplate: '0.6fr',
          getValue: item => item.getCloneStrategy(),
          render: item => {
            const strategy = item.getCloneStrategy();
            if (strategy === '-') {
              return <Typography variant="caption" color="text.secondary">-</Typography>;
            }
            return (
              <Chip
                label={strategy}
                size="small"
                variant="outlined"
                color={strategy === 'snapshot' ? 'success' : 'info'}
              />
            );
          },
        },
        {
          id: 'features',
          label: 'Features',
          getValue: item => {
            const features = [];
            if (item.supportsVolumeSnapshots()) features.push('Snapshots');
            if (item.supportsClone()) features.push('Clone');
            return features.join(', ');
          },
          render: item => {
            const features = [];
            if (item.supportsVolumeSnapshots()) features.push({ label: 'Snapshots', color: 'success' as const });
            if (item.supportsClone()) features.push({ label: 'Clone', color: 'info' as const });

            if (features.length === 0) {
              return <Typography variant="caption" color="text.secondary">-</Typography>;
            }

            return (
              <Box sx={{ display: 'flex', gap: 0.5 }}>
                {features.map((f, idx) => (
                  <Chip key={idx} label={f.label} size="small" variant="outlined" color={f.color} />
                ))}
              </Box>
            );
          },
        },
        {
          id: 'snapshotClass',
          label: 'Snapshot Class',
          getValue: item => item.getSnapshotClass(),
          render: item => {
            const sc = item.getSnapshotClass();
            return sc !== '-' ? (
              <Typography variant="body2">{sc}</Typography>
            ) : (
              <Typography variant="caption" color="text.secondary">-</Typography>
            );
          },
        },
        'age',
      ]}
      data={items}
      reflectInURL
      id="headlamp-storageprofiles"
    />
  );
}

export default function StorageProfileList() {
  const { installed: kubeVirtInstalled, checking: checkingKubeVirt } = useKubeVirtInstalled();
  const { items, error } = StorageProfile.useList({});

  if (checkingKubeVirt) {
    return <KubeVirtCheckLoading />;
  }

  if (kubeVirtInstalled === false) {
    return <KubeVirtNotInstalled />;
  }

  return <StorageProfileListRenderer items={items} error={error} reflectTableInURL />;
}
