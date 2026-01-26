import { Resource, SectionBox } from '@kinvolk/headlamp-plugin/lib/components/common';
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
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import VirtualMachineClusterInstancetype from './VirtualMachineClusterInstancetype';

export interface VirtualMachineClusterInstancetypeDetailsProps {
  name?: string;
}

export default function VirtualMachineClusterInstancetypeDetails(
  props: VirtualMachineClusterInstancetypeDetailsProps
) {
  const params = useParams<{ name: string }>();
  const { name = params.name } = props;
  const { t } = useTranslation('glossary');

  return (
    <Resource.DetailsGrid
      name={name}
      resourceType={VirtualMachineClusterInstancetype}
      withEvents
      extraInfo={item => {
        if (!item) return null;

        const cpu = item.getCPU();
        const memory = item.getMemory();

        return [
          {
            name: t('CPU'),
            value: `${cpu.guest} vCPUs`,
          },
          {
            name: t('CPU Model'),
            value: cpu.model || '-',
          },
          {
            name: t('Dedicated CPU'),
            value: cpu.dedicatedCPUPlacement ? 'Yes' : 'No',
          },
          {
            name: t('Memory'),
            value: memory.guest,
          },
          {
            name: t('Hugepages'),
            value: memory.hugepages ? memory.hugepages.pageSize : 'Disabled',
          },
          {
            name: t('IO Threads Policy'),
            value: item.getIOThreadsPolicy(),
          },
        ];
      }}
      extraSections={item => {
        if (!item) return null;

        const gpus = item.getGPUs();
        const hostDevices = item.getHostDevices();
        const launchSecurity = item.getLaunchSecurity();

        return [
          gpus.length > 0
            ? {
                id: 'gpus',
                section: (
                  <SectionBox title={t('GPU Devices')}>
                    <TableContainer component={Paper} variant="outlined">
                      <Table size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell>Name</TableCell>
                            <TableCell>Device Name</TableCell>
                            <TableCell>Tag</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {gpus.map((gpu: any, idx: number) => (
                            <TableRow key={idx}>
                              <TableCell>{gpu.name || '-'}</TableCell>
                              <TableCell>{gpu.deviceName || '-'}</TableCell>
                              <TableCell>{gpu.tag || '-'}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  </SectionBox>
                ),
              }
            : null,
          hostDevices.length > 0
            ? {
                id: 'host-devices',
                section: (
                  <SectionBox title={t('Host Devices')}>
                    <TableContainer component={Paper} variant="outlined">
                      <Table size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell>Name</TableCell>
                            <TableCell>Device Name</TableCell>
                            <TableCell>Tag</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {hostDevices.map((device: any, idx: number) => (
                            <TableRow key={idx}>
                              <TableCell>{device.name || '-'}</TableCell>
                              <TableCell>{device.deviceName || '-'}</TableCell>
                              <TableCell>{device.tag || '-'}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  </SectionBox>
                ),
              }
            : null,
          launchSecurity
            ? {
                id: 'launch-security',
                section: (
                  <SectionBox title={t('Launch Security')}>
                    <TableContainer component={Paper} variant="outlined">
                      <Table size="small">
                        <TableBody>
                          {launchSecurity.sev && (
                            <>
                              <TableRow>
                                <TableCell sx={{ fontWeight: 'bold', width: '30%' }}>
                                  SEV Enabled
                                </TableCell>
                                <TableCell>
                                  <Chip label="Yes" size="small" color="success" variant="outlined" />
                                </TableCell>
                              </TableRow>
                              {launchSecurity.sev.policy && (
                                <TableRow>
                                  <TableCell sx={{ fontWeight: 'bold' }}>SEV Policy</TableCell>
                                  <TableCell>{JSON.stringify(launchSecurity.sev.policy)}</TableCell>
                                </TableRow>
                              )}
                            </>
                          )}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  </SectionBox>
                ),
              }
            : null,
          {
            id: 'usage',
            section: (
              <SectionBox title={t('Usage')}>
                <Box sx={{ p: 2, bgcolor: 'background.default', borderRadius: 1 }}>
                  <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                    spec:
                    <br />
                    &nbsp;&nbsp;instancetype:
                    <br />
                    &nbsp;&nbsp;&nbsp;&nbsp;kind: VirtualMachineClusterInstancetype
                    <br />
                    &nbsp;&nbsp;&nbsp;&nbsp;name: {item.getName()}
                  </Typography>
                </Box>
              </SectionBox>
            ),
          },
        ].filter(Boolean);
      }}
    />
  );
}
