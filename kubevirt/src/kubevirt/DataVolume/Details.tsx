import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { Link, Resource, SectionBox } from '@kinvolk/headlamp-plugin/lib/components/common';
import {
  Box,
  Chip,
  LinearProgress,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import DataVolume from './DataVolume';

export interface DataVolumeDetailsProps {
  name?: string;
  namespace?: string;
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

export default function DataVolumeDetails(props: DataVolumeDetailsProps) {
  const params = useParams<{ namespace: string; name: string }>();
  const { name = params.name, namespace = params.namespace } = props;
  const { t } = useTranslation('glossary');
  const [usingVMs, setUsingVMs] = useState<any[]>([]);
  const [pvcInfo, setPvcInfo] = useState<any>(null);

  // Find VMs using this DataVolume
  useEffect(() => {
    if (!name || !namespace) return;

    const fetchUsingVMs = async () => {
      try {
        const response = await ApiProxy.request(
          `/apis/kubevirt.io/v1/namespaces/${namespace}/virtualmachines`,
          { method: 'GET' }
        );
        const vms = (response as any)?.items || [];

        // Filter VMs that use this DataVolume
        const matchingVMs = vms.filter((vm: any) => {
          const volumes = vm.spec?.template?.spec?.volumes || [];
          return volumes.some(
            (vol: any) =>
              vol.dataVolume?.name === name ||
              vol.persistentVolumeClaim?.claimName === name
          );
        });

        setUsingVMs(matchingVMs);
      } catch (error) {
        console.log('Failed to fetch VMs:', error);
        setUsingVMs([]);
      }
    };

    // Fetch PVC info (DataVolume creates a PVC with the same name)
    const fetchPVC = async () => {
      try {
        const response = await ApiProxy.request(
          `/api/v1/namespaces/${namespace}/persistentvolumeclaims/${name}`,
          { method: 'GET' }
        );
        setPvcInfo(response);
      } catch (error) {
        console.log('PVC not found:', error);
        setPvcInfo(null);
      }
    };

    fetchUsingVMs();
    fetchPVC();
  }, [name, namespace]);

  return (
    <Resource.DetailsGrid
      name={name}
      namespace={namespace}
      resourceType={DataVolume}
      withEvents
      extraInfo={item => {
        if (!item) return null;

        const phase = item.getPhase();
        const progress = item.getProgress();

        return [
          {
            name: t('Phase'),
            value: (
              <Chip
                label={phase}
                size="small"
                variant="outlined"
                color={getPhaseColor(phase)}
              />
            ),
          },
          {
            name: t('Progress'),
            value: (() => {
              if (phase === 'Succeeded') {
                return <Chip label="Complete" size="small" color="success" variant="outlined" />;
              }
              if (progress === '-' || progress === 'N/A') {
                return '-';
              }
              const match = progress.match(/(\d+(?:\.\d+)?)/);
              const percentage = match ? parseFloat(match[1]) : 0;
              return (
                <Tooltip title={progress}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 150 }}>
                    <LinearProgress
                      variant="determinate"
                      value={percentage}
                      sx={{ flexGrow: 1, height: 8, borderRadius: 4 }}
                    />
                    <Typography variant="body2">{progress}</Typography>
                  </Box>
                </Tooltip>
              );
            })(),
          },
          {
            name: t('Source Type'),
            value: (
              <Chip label={item.getSourceType()} size="small" variant="outlined" color="primary" />
            ),
          },
          {
            name: t('Source'),
            value: (
              <Typography
                variant="body2"
                sx={{
                  maxWidth: 300,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {item.getSourceReference()}
              </Typography>
            ),
          },
          {
            name: t('Storage Size'),
            value: item.getStorageSize(),
          },
          {
            name: t('Storage Class'),
            value: item.getStorageClass(),
          },
          {
            name: t('Access Modes'),
            value: item.getAccessModes().join(', ') || '-',
          },
          {
            name: t('PVC'),
            value: pvcInfo ? (
              <Link
                routeName="persistentVolumeClaim"
                params={{ name: name, namespace: namespace }}
              >
                {name}
              </Link>
            ) : (
              <Typography variant="caption" color="text.secondary">
                Not created yet
              </Typography>
            ),
          },
          {
            name: t('VMs Using This Volume'),
            value: usingVMs.length > 0 ? `${usingVMs.length} VM(s)` : 'None',
          },
        ];
      }}
      extraSections={item => {
        if (!item) return null;

        const source = item.spec?.source;
        const storage = item.spec?.storage || item.spec?.pvc;

        return [
          {
            id: 'source-config',
            section: (
              <SectionBox title={t('Source Configuration')}>
                <TableContainer component={Paper} variant="outlined">
                  <Table size="small">
                    <TableBody>
                      <TableRow>
                        <TableCell sx={{ fontWeight: 'bold', width: '30%' }}>Type</TableCell>
                        <TableCell>{item.getSourceType()}</TableCell>
                      </TableRow>
                      {source?.http && (
                        <>
                          <TableRow>
                            <TableCell sx={{ fontWeight: 'bold' }}>URL</TableCell>
                            <TableCell>
                              <code style={{ fontSize: '0.85em', wordBreak: 'break-all' }}>
                                {source.http.url}
                              </code>
                            </TableCell>
                          </TableRow>
                          {source.http.secretRef && (
                            <TableRow>
                              <TableCell sx={{ fontWeight: 'bold' }}>Secret</TableCell>
                              <TableCell>{source.http.secretRef}</TableCell>
                            </TableRow>
                          )}
                          {source.http.certConfigMap && (
                            <TableRow>
                              <TableCell sx={{ fontWeight: 'bold' }}>Cert ConfigMap</TableCell>
                              <TableCell>{source.http.certConfigMap}</TableCell>
                            </TableRow>
                          )}
                        </>
                      )}
                      {source?.registry && (
                        <>
                          <TableRow>
                            <TableCell sx={{ fontWeight: 'bold' }}>Image URL</TableCell>
                            <TableCell>
                              <code style={{ fontSize: '0.85em' }}>{source.registry.url}</code>
                            </TableCell>
                          </TableRow>
                          {source.registry.secretRef && (
                            <TableRow>
                              <TableCell sx={{ fontWeight: 'bold' }}>Pull Secret</TableCell>
                              <TableCell>{source.registry.secretRef}</TableCell>
                            </TableRow>
                          )}
                        </>
                      )}
                      {source?.pvc && (
                        <>
                          <TableRow>
                            <TableCell sx={{ fontWeight: 'bold' }}>Source PVC</TableCell>
                            <TableCell>
                              <Link
                                routeName="persistentVolumeClaim"
                                params={{
                                  name: source.pvc.name,
                                  namespace: source.pvc.namespace || namespace,
                                }}
                              >
                                {source.pvc.namespace
                                  ? `${source.pvc.namespace}/${source.pvc.name}`
                                  : source.pvc.name}
                              </Link>
                            </TableCell>
                          </TableRow>
                        </>
                      )}
                      {source?.blank && (
                        <TableRow>
                          <TableCell sx={{ fontWeight: 'bold' }}>Description</TableCell>
                          <TableCell>Creates an empty/blank disk</TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </TableContainer>
              </SectionBox>
            ),
          },
          {
            id: 'storage-config',
            section: (
              <SectionBox title={t('Storage Configuration')}>
                <TableContainer component={Paper} variant="outlined">
                  <Table size="small">
                    <TableBody>
                      <TableRow>
                        <TableCell sx={{ fontWeight: 'bold', width: '30%' }}>Size</TableCell>
                        <TableCell>{item.getStorageSize()}</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell sx={{ fontWeight: 'bold' }}>Storage Class</TableCell>
                        <TableCell>{item.getStorageClass()}</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell sx={{ fontWeight: 'bold' }}>Access Modes</TableCell>
                        <TableCell>{item.getAccessModes().join(', ') || '-'}</TableCell>
                      </TableRow>
                      {storage?.volumeMode && (
                        <TableRow>
                          <TableCell sx={{ fontWeight: 'bold' }}>Volume Mode</TableCell>
                          <TableCell>{storage.volumeMode}</TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </TableContainer>
              </SectionBox>
            ),
          },
          // VMs using this DataVolume
          usingVMs.length > 0
            ? {
                id: 'using-vms',
                section: (
                  <SectionBox title={t('Virtual Machines Using This Volume')}>
                    <TableContainer component={Paper} variant="outlined">
                      <Table size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell sx={{ fontWeight: 'bold' }}>Name</TableCell>
                            <TableCell sx={{ fontWeight: 'bold' }}>Namespace</TableCell>
                            <TableCell sx={{ fontWeight: 'bold' }}>Status</TableCell>
                            <TableCell sx={{ fontWeight: 'bold' }}>Disk Name</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {usingVMs.map((vm: any, idx: number) => {
                            const vmName = vm.metadata?.name;
                            const vmNamespace = vm.metadata?.namespace;
                            const status = vm.status?.printableStatus || 'Unknown';
                            const volumes = vm.spec?.template?.spec?.volumes || [];
                            const matchingVolume = volumes.find(
                              (v: any) =>
                                v.dataVolume?.name === name ||
                                v.persistentVolumeClaim?.claimName === name
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
                                <TableCell>{matchingVolume?.name || '-'}</TableCell>
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
          {
            id: 'conditions',
            section: <Resource.ConditionsSection resource={item?.jsonData} />,
          },
        ].filter(Boolean);
      }}
    />
  );
}
