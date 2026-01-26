import {
  Link,
  SimpleTableProps,
} from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Resource } from '@kinvolk/headlamp-plugin/lib/components/common';
import { ApiError } from '@kinvolk/headlamp-plugin/lib/lib/k8s/apiProxy';
import { Box, Chip, Typography } from '@mui/material';
import VirtualMachineInstanceMigration from './VirtualMachineInstanceMigration';

export interface VirtualMachineInstanceMigrationListProps {
  items: VirtualMachineInstanceMigration[] | null;
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
    case 'Running':
    case 'Scheduling':
    case 'Scheduled':
    case 'PreparingTarget':
    case 'TargetReady':
      return 'warning';
    case 'Pending':
      return 'info';
    default:
      return 'default';
  }
}

export function VirtualMachineInstanceMigrationListRenderer(
  props: VirtualMachineInstanceMigrationListProps
) {
  const { items, error, hideColumns = [], noNamespaceFilter } = props;

  return (
    <Resource.ResourceListView
      title={'VM Instance Migrations'}
      headerProps={{
        noNamespaceFilter,
      }}
      hideColumns={hideColumns}
      errorMessage={error?.message || (error ? String(error) : '')}
      columns={[
        {
          id: 'name',
          label: 'Name',
          getValue: migration => migration.getName(),
          render: migration => (
            <Link
              routeName="virtualmachineinstancemigration"
              params={{ name: migration.getName(), namespace: migration.getNamespace() }}
            >
              {migration.getName()}
            </Link>
          ),
        },
        'namespace',
        'cluster',
        {
          id: 'vmi',
          label: 'VMI',
          getValue: migration => migration.getVMIName(),
          render: migration => {
            const vmiName = migration.getVMIName();
            return vmiName !== '-' ? (
              <Link
                routeName="virtualmachineinstance"
                params={{ name: vmiName, namespace: migration.getNamespace() }}
              >
                {vmiName}
              </Link>
            ) : (
              <Typography variant="caption" color="text.secondary">-</Typography>
            );
          },
        },
        {
          id: 'phase',
          label: 'Phase',
          getValue: migration => migration.getPhase(),
          render: migration => {
            const phase = migration.getPhase();
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
          id: 'source',
          label: 'Source Node',
          getValue: migration => migration.getSourceNode(),
          render: migration => {
            const node = migration.getSourceNode();
            return node !== '-' ? (
              <Link routeName="node" params={{ name: node }}>
                {node}
              </Link>
            ) : (
              <Typography variant="caption" color="text.secondary">-</Typography>
            );
          },
        },
        {
          id: 'target',
          label: 'Target Node',
          getValue: migration => migration.getTargetNode(),
          render: migration => {
            const node = migration.getTargetNode();
            return node !== '-' ? (
              <Link routeName="node" params={{ name: node }}>
                {node}
              </Link>
            ) : (
              <Typography variant="caption" color="text.secondary">-</Typography>
            );
          },
        },
        {
          id: 'mode',
          label: 'Mode',
          gridTemplate: '0.5fr',
          getValue: migration => migration.getMigrationMode(),
          render: migration => {
            const mode = migration.getMigrationMode();
            return mode !== '-' ? (
              <Chip label={mode} size="small" variant="outlined" />
            ) : (
              <Typography variant="caption" color="text.secondary">-</Typography>
            );
          },
        },
        {
          id: 'progress',
          label: 'Progress',
          getValue: migration => {
            if (migration.isCompleted()) return 'Completed';
            if (migration.isFailed()) return 'Failed';
            return migration.getPhase();
          },
          render: migration => {
            if (migration.isCompleted()) {
              return (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Chip label="Completed" size="small" color="success" variant="outlined" />
                </Box>
              );
            }
            if (migration.isFailed()) {
              return <Chip label="Failed" size="small" color="error" variant="outlined" />;
            }
            return (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Chip label="In Progress" size="small" color="warning" variant="outlined" />
              </Box>
            );
          },
        },
        'age',
      ]}
      data={items}
      reflectInURL
      id="headlamp-virtualmachineinstancemigrations"
    />
  );
}

export default function VirtualMachineInstanceMigrationList() {
  const { items, error } = VirtualMachineInstanceMigration.useList({});

  return (
    <VirtualMachineInstanceMigrationListRenderer
      items={items}
      error={error}
      reflectTableInURL
      noNamespaceFilter={false}
    />
  );
}
