import {
  Link,
  SimpleTableProps,
} from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Resource } from '@kinvolk/headlamp-plugin/lib/components/common';
import { ApiError } from '@kinvolk/headlamp-plugin/lib/lib/k8s/apiProxy';
import { Chip, Typography } from '@mui/material';
import { useKubeVirtInstalled, KubeVirtNotInstalled, KubeVirtCheckLoading } from '../utils/kubeVirtCheck';
import NetworkAttachmentDefinition from './NetworkAttachmentDefinition';

export interface NetworkAttachmentDefinitionListProps {
  items: NetworkAttachmentDefinition[] | null;
  error: ApiError | null;
  hideColumns?: ['namespace'];
  reflectTableInURL?: SimpleTableProps['reflectInURL'];
  noNamespaceFilter?: boolean;
}

function getPluginColor(
  pluginType: string
): 'primary' | 'success' | 'warning' | 'info' | 'default' {
  switch (pluginType.toLowerCase()) {
    case 'bridge':
      return 'primary';
    case 'macvlan':
      return 'info';
    case 'ipvlan':
      return 'success';
    case 'sriov':
      return 'warning';
    case 'ovs':
      return 'info';
    default:
      return 'default';
  }
}

export function NetworkAttachmentDefinitionListRenderer(
  props: NetworkAttachmentDefinitionListProps
) {
  const { items, error, hideColumns = [], noNamespaceFilter } = props;

  return (
    <Resource.ResourceListView
      title={'Network Attachment Definitions'}
      headerProps={{
        noNamespaceFilter,
      }}
      hideColumns={hideColumns}
      errorMessage={error?.message || (error ? String(error) : '')}
      columns={[
        {
          id: 'name',
          label: 'Name',
          getValue: nad => nad.getName(),
          render: nad => (
            <Link
              routeName="networkattachmentdefinition"
              params={{ name: nad.getName(), namespace: nad.getNamespace() }}
            >
              {nad.getName()}
            </Link>
          ),
        },
        'namespace',
        'cluster',
        {
          id: 'type',
          label: 'Plugin Type',
          getValue: nad => nad.getPluginType(),
          render: nad => {
            const pluginType = nad.getPluginType();
            return (
              <Chip
                label={pluginType}
                size="small"
                variant="outlined"
                color={getPluginColor(pluginType)}
              />
            );
          },
        },
        {
          id: 'bridge',
          label: 'Bridge/Master',
          getValue: nad => nad.getBridge() || nad.getMaster() || '',
          render: nad => {
            const bridge = nad.getBridge();
            const master = nad.getMaster();
            const value = bridge || master;
            return value ? (
              <code style={{ fontSize: '0.85em' }}>{value}</code>
            ) : (
              <Typography variant="caption" color="text.secondary">-</Typography>
            );
          },
        },
        {
          id: 'vlan',
          label: 'VLAN',
          gridTemplate: '0.5fr',
          getValue: nad => nad.getVLAN() ?? '',
          render: nad => {
            const vlan = nad.getVLAN();
            return vlan !== null ? (
              <Chip label={vlan} size="small" variant="outlined" color="info" />
            ) : (
              <Typography variant="caption" color="text.secondary">-</Typography>
            );
          },
        },
        {
          id: 'mtu',
          label: 'MTU',
          gridTemplate: '0.5fr',
          getValue: nad => nad.getMTU() ?? '',
          render: nad => {
            const mtu = nad.getMTU();
            return mtu !== null ? (
              <Typography variant="body2">{mtu}</Typography>
            ) : (
              <Typography variant="caption" color="text.secondary">-</Typography>
            );
          },
        },
        {
          id: 'ipam',
          label: 'IPAM',
          getValue: nad => nad.getIpamType(),
          render: nad => {
            const ipamType = nad.getIpamType();
            return ipamType !== '-' ? (
              <Chip label={ipamType} size="small" variant="outlined" />
            ) : (
              <Typography variant="caption" color="text.secondary">-</Typography>
            );
          },
        },
        'age',
      ]}
      data={items}
      reflectInURL
      id="headlamp-networkattachmentdefinitions"
    />
  );
}

export default function NetworkAttachmentDefinitionList() {
  const { installed: kubeVirtInstalled, checking: checkingKubeVirt } = useKubeVirtInstalled();
  const { items, error } = NetworkAttachmentDefinition.useList({});

  if (checkingKubeVirt) {
    return <KubeVirtCheckLoading />;
  }

  if (kubeVirtInstalled === false) {
    return <KubeVirtNotInstalled />;
  }

  return (
    <NetworkAttachmentDefinitionListRenderer
      items={items}
      error={error}
      reflectTableInURL
      noNamespaceFilter={false}
    />
  );
}
