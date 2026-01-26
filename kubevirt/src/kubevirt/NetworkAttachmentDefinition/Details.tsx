import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { Link, Resource, SectionBox } from '@kinvolk/headlamp-plugin/lib/components/common';
import {
  Box,
  Chip,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import NetworkAttachmentDefinition from './NetworkAttachmentDefinition';

export interface NetworkAttachmentDefinitionDetailsProps {
  name?: string;
  namespace?: string;
}

export default function NetworkAttachmentDefinitionDetails(
  props: NetworkAttachmentDefinitionDetailsProps
) {
  const params = useParams<{ namespace: string; name: string }>();
  const { name = params.name, namespace = params.namespace } = props;
  const { t } = useTranslation('glossary');
  const [usingVMs, setUsingVMs] = useState<any[]>([]);

  // Find VMs using this NAD
  useEffect(() => {
    if (!name || !namespace) return;

    const fetchUsingVMs = async () => {
      try {
        // Fetch VMs in the same namespace that might use this NAD
        const response = await ApiProxy.request(
          `/apis/kubevirt.io/v1/namespaces/${namespace}/virtualmachines`,
          { method: 'GET' }
        );
        const vms = (response as any)?.items || [];

        // Filter VMs that use this NAD
        const matchingVMs = vms.filter((vm: any) => {
          const networks = vm.spec?.template?.spec?.networks || [];
          return networks.some(
            (network: any) =>
              network.multus?.networkName === name ||
              network.multus?.networkName === `${namespace}/${name}`
          );
        });

        setUsingVMs(matchingVMs);
      } catch (error) {
        console.log('Failed to fetch VMs:', error);
        setUsingVMs([]);
      }
    };

    fetchUsingVMs();
  }, [name, namespace]);

  return (
    <Resource.DetailsGrid
      name={name}
      namespace={namespace}
      resourceType={NetworkAttachmentDefinition}
      withEvents
      extraInfo={item => {
        if (!item) return null;

        const config = item.getConfig();

        return [
          {
            name: t('Plugin Type'),
            value: (
              <Chip
                label={item.getPluginType()}
                size="small"
                variant="outlined"
                color="primary"
              />
            ),
          },
          {
            name: t('IPAM Type'),
            value: item.getIpamType() !== '-' ? (
              <Chip label={item.getIpamType()} size="small" variant="outlined" />
            ) : (
              '-'
            ),
          },
          {
            name: t('CNI Version'),
            value: config?.cniVersion || '-',
          },
          {
            name: t('Network Name'),
            value: config?.name || '-',
          },
          {
            name: t('VMs Using This Network'),
            value: usingVMs.length > 0 ? `${usingVMs.length} VM(s)` : 'None',
          },
        ];
      }}
      extraSections={item => {
        if (!item) return null;

        const config = item.getConfig();
        const rawConfig = item.spec?.config || '';

        return [
          {
            id: 'configuration',
            section: (
              <SectionBox title={t('Network Configuration')}>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {/* Plugin Configuration */}
                  {config && (
                    <Box>
                      <Typography variant="subtitle2" gutterBottom>
                        Plugin Details
                      </Typography>
                      <TableContainer component={Paper} variant="outlined">
                        <Table size="small">
                          <TableBody>
                            <TableRow>
                              <TableCell sx={{ fontWeight: 'bold', width: '30%' }}>
                                Type
                              </TableCell>
                              <TableCell>{config.type || '-'}</TableCell>
                            </TableRow>
                            {config.bridge && (
                              <TableRow>
                                <TableCell sx={{ fontWeight: 'bold' }}>Bridge</TableCell>
                                <TableCell>
                                  <code>{config.bridge}</code>
                                </TableCell>
                              </TableRow>
                            )}
                            {config.master && (
                              <TableRow>
                                <TableCell sx={{ fontWeight: 'bold' }}>
                                  Master Interface
                                </TableCell>
                                <TableCell>
                                  <code>{config.master}</code>
                                </TableCell>
                              </TableRow>
                            )}
                            {config.mode && (
                              <TableRow>
                                <TableCell sx={{ fontWeight: 'bold' }}>Mode</TableCell>
                                <TableCell>{config.mode}</TableCell>
                              </TableRow>
                            )}
                            {config.vlan !== undefined && (
                              <TableRow>
                                <TableCell sx={{ fontWeight: 'bold' }}>VLAN ID</TableCell>
                                <TableCell>{config.vlan}</TableCell>
                              </TableRow>
                            )}
                            {config.mtu && (
                              <TableRow>
                                <TableCell sx={{ fontWeight: 'bold' }}>MTU</TableCell>
                                <TableCell>{config.mtu}</TableCell>
                              </TableRow>
                            )}
                            {config.isGateway !== undefined && (
                              <TableRow>
                                <TableCell sx={{ fontWeight: 'bold' }}>Is Gateway</TableCell>
                                <TableCell>{config.isGateway ? 'Yes' : 'No'}</TableCell>
                              </TableRow>
                            )}
                            {config.ipMasq !== undefined && (
                              <TableRow>
                                <TableCell sx={{ fontWeight: 'bold' }}>IP Masquerade</TableCell>
                                <TableCell>{config.ipMasq ? 'Yes' : 'No'}</TableCell>
                              </TableRow>
                            )}
                            {config.promiscMode !== undefined && (
                              <TableRow>
                                <TableCell sx={{ fontWeight: 'bold' }}>
                                  Promiscuous Mode
                                </TableCell>
                                <TableCell>{config.promiscMode ? 'Yes' : 'No'}</TableCell>
                              </TableRow>
                            )}
                          </TableBody>
                        </Table>
                      </TableContainer>
                    </Box>
                  )}

                  {/* IPAM Configuration */}
                  {config?.ipam && (
                    <Box>
                      <Typography variant="subtitle2" gutterBottom>
                        IPAM Configuration
                      </Typography>
                      <TableContainer component={Paper} variant="outlined">
                        <Table size="small">
                          <TableBody>
                            <TableRow>
                              <TableCell sx={{ fontWeight: 'bold', width: '30%' }}>
                                Type
                              </TableCell>
                              <TableCell>{config.ipam.type || '-'}</TableCell>
                            </TableRow>
                            {config.ipam.subnet && (
                              <TableRow>
                                <TableCell sx={{ fontWeight: 'bold' }}>Subnet</TableCell>
                                <TableCell>
                                  <code>{config.ipam.subnet}</code>
                                </TableCell>
                              </TableRow>
                            )}
                            {config.ipam.rangeStart && (
                              <TableRow>
                                <TableCell sx={{ fontWeight: 'bold' }}>Range Start</TableCell>
                                <TableCell>
                                  <code>{config.ipam.rangeStart}</code>
                                </TableCell>
                              </TableRow>
                            )}
                            {config.ipam.rangeEnd && (
                              <TableRow>
                                <TableCell sx={{ fontWeight: 'bold' }}>Range End</TableCell>
                                <TableCell>
                                  <code>{config.ipam.rangeEnd}</code>
                                </TableCell>
                              </TableRow>
                            )}
                            {config.ipam.gateway && (
                              <TableRow>
                                <TableCell sx={{ fontWeight: 'bold' }}>Gateway</TableCell>
                                <TableCell>
                                  <code>{config.ipam.gateway}</code>
                                </TableCell>
                              </TableRow>
                            )}
                            {config.ipam.routes && config.ipam.routes.length > 0 && (
                              <TableRow>
                                <TableCell sx={{ fontWeight: 'bold' }}>Routes</TableCell>
                                <TableCell>
                                  {config.ipam.routes.map((route: any, idx: number) => (
                                    <Box key={idx}>
                                      <code>
                                        {route.dst}
                                        {route.gw ? ` via ${route.gw}` : ''}
                                      </code>
                                    </Box>
                                  ))}
                                </TableCell>
                              </TableRow>
                            )}
                          </TableBody>
                        </Table>
                      </TableContainer>
                    </Box>
                  )}

                  {/* Raw Config */}
                  <Box>
                    <Typography variant="subtitle2" gutterBottom>
                      Raw Configuration (JSON)
                    </Typography>
                    <Paper
                      variant="outlined"
                      sx={{
                        p: 2,
                        backgroundColor: 'grey.900',
                        maxHeight: 400,
                        overflow: 'auto',
                      }}
                    >
                      <pre
                        style={{
                          margin: 0,
                          fontSize: '0.85em',
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                          color: '#e0e0e0',
                        }}
                      >
                        {config
                          ? JSON.stringify(config, null, 2)
                          : rawConfig || 'No configuration'}
                      </pre>
                    </Paper>
                  </Box>
                </Box>
              </SectionBox>
            ),
          },
          // VMs using this NAD
          usingVMs.length > 0
            ? {
                id: 'using-vms',
                section: (
                  <SectionBox title={t('Virtual Machines Using This Network')}>
                    <TableContainer component={Paper} variant="outlined">
                      <Table size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell sx={{ fontWeight: 'bold' }}>Name</TableCell>
                            <TableCell sx={{ fontWeight: 'bold' }}>Namespace</TableCell>
                            <TableCell sx={{ fontWeight: 'bold' }}>Status</TableCell>
                            <TableCell sx={{ fontWeight: 'bold' }}>Interface</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {usingVMs.map((vm: any, idx: number) => {
                            const vmName = vm.metadata?.name;
                            const vmNamespace = vm.metadata?.namespace;
                            const status = vm.status?.printableStatus || 'Unknown';
                            const networks = vm.spec?.template?.spec?.networks || [];
                            const matchingNetwork = networks.find(
                              (n: any) =>
                                n.multus?.networkName === name ||
                                n.multus?.networkName === `${namespace}/${name}`
                            );
                            return (
                              <TableRow key={idx}>
                                <TableCell>
                                  <Link
                                    routeName="virtualmachine"
                                    params={{ name: vmName, namespace: vmNamespace }}
                                  >
                                    {vmName}
                                  </Link>
                                </TableCell>
                                <TableCell>{vmNamespace}</TableCell>
                                <TableCell>
                                  <Chip
                                    label={status}
                                    size="small"
                                    variant="outlined"
                                    color={status === 'Running' ? 'success' : 'default'}
                                  />
                                </TableCell>
                                <TableCell>{matchingNetwork?.name || '-'}</TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  </SectionBox>
                ),
              }
            : null,
        ].filter(Boolean);
      }}
    />
  );
}
