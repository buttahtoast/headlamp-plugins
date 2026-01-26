import { Resource, SectionBox } from '@kinvolk/headlamp-plugin/lib/components/common';
import {
  Box,
  Chip,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableRow,
  Typography,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import VirtualMachineClusterPreference from './VirtualMachineClusterPreference';

export interface VirtualMachineClusterPreferenceDetailsProps {
  name?: string;
}

export default function VirtualMachineClusterPreferenceDetails(
  props: VirtualMachineClusterPreferenceDetailsProps
) {
  const params = useParams<{ name: string }>();
  const { name = params.name } = props;
  const { t } = useTranslation('glossary');

  return (
    <Resource.DetailsGrid
      name={name}
      resourceType={VirtualMachineClusterPreference}
      withEvents
      extraInfo={item => {
        if (!item) return null;

        return [
          {
            name: t('Machine Type'),
            value: item.getPreferredMachineType(),
          },
          {
            name: t('Preferred Disk Bus'),
            value: item.getPreferredDiskBus(),
          },
          {
            name: t('Preferred Interface Model'),
            value: item.getPreferredInterfaceModel(),
          },
          {
            name: t('Preferred CPU Topology'),
            value: item.getPreferredCPUTopology(),
          },
          {
            name: t('UEFI'),
            value: item.prefersUEFI() ? 'Yes' : 'No',
          },
          {
            name: t('Secure Boot'),
            value: item.prefersSecureBoot() ? 'Yes' : 'No',
          },
        ];
      }}
      extraSections={item => {
        if (!item) return null;

        const devices = item.getDevices();
        const features = item.getFeatures();
        const firmware = item.getFirmware();

        return [
          devices
            ? {
                id: 'devices',
                section: (
                  <SectionBox title={t('Device Preferences')}>
                    <TableContainer component={Paper} variant="outlined">
                      <Table size="small">
                        <TableBody>
                          {devices.preferredDiskBus && (
                            <TableRow>
                              <TableCell sx={{ fontWeight: 'bold', width: '40%' }}>
                                Preferred Disk Bus
                              </TableCell>
                              <TableCell>
                                <Chip
                                  label={devices.preferredDiskBus}
                                  size="small"
                                  variant="outlined"
                                />
                              </TableCell>
                            </TableRow>
                          )}
                          {devices.preferredInterfaceModel && (
                            <TableRow>
                              <TableCell sx={{ fontWeight: 'bold' }}>
                                Preferred Interface Model
                              </TableCell>
                              <TableCell>
                                <Chip
                                  label={devices.preferredInterfaceModel}
                                  size="small"
                                  variant="outlined"
                                />
                              </TableCell>
                            </TableRow>
                          )}
                          {devices.preferredInputBus && (
                            <TableRow>
                              <TableCell sx={{ fontWeight: 'bold' }}>Preferred Input Bus</TableCell>
                              <TableCell>
                                <Chip
                                  label={devices.preferredInputBus}
                                  size="small"
                                  variant="outlined"
                                />
                              </TableCell>
                            </TableRow>
                          )}
                          {devices.preferredInputType && (
                            <TableRow>
                              <TableCell sx={{ fontWeight: 'bold' }}>Preferred Input Type</TableCell>
                              <TableCell>
                                <Chip
                                  label={devices.preferredInputType}
                                  size="small"
                                  variant="outlined"
                                />
                              </TableCell>
                            </TableRow>
                          )}
                          {devices.preferredTPM && (
                            <TableRow>
                              <TableCell sx={{ fontWeight: 'bold' }}>TPM</TableCell>
                              <TableCell>
                                <Chip label="Enabled" size="small" color="success" variant="outlined" />
                              </TableCell>
                            </TableRow>
                          )}
                          {devices.preferredAutoattachGraphicsDevice !== undefined && (
                            <TableRow>
                              <TableCell sx={{ fontWeight: 'bold' }}>Graphics Device</TableCell>
                              <TableCell>
                                {devices.preferredAutoattachGraphicsDevice ? 'Auto-attach' : 'Manual'}
                              </TableCell>
                            </TableRow>
                          )}
                          {devices.preferredAutoattachSerialConsole !== undefined && (
                            <TableRow>
                              <TableCell sx={{ fontWeight: 'bold' }}>Serial Console</TableCell>
                              <TableCell>
                                {devices.preferredAutoattachSerialConsole ? 'Auto-attach' : 'Manual'}
                              </TableCell>
                            </TableRow>
                          )}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  </SectionBox>
                ),
              }
            : null,
          firmware
            ? {
                id: 'firmware',
                section: (
                  <SectionBox title={t('Firmware Preferences')}>
                    <TableContainer component={Paper} variant="outlined">
                      <Table size="small">
                        <TableBody>
                          <TableRow>
                            <TableCell sx={{ fontWeight: 'bold', width: '40%' }}>UEFI</TableCell>
                            <TableCell>
                              {firmware.preferredUseEfi ? (
                                <Chip label="Enabled" size="small" color="success" variant="outlined" />
                              ) : (
                                <Chip label="Disabled" size="small" variant="outlined" />
                              )}
                            </TableCell>
                          </TableRow>
                          <TableRow>
                            <TableCell sx={{ fontWeight: 'bold' }}>Secure Boot</TableCell>
                            <TableCell>
                              {firmware.preferredUseSecureBoot ? (
                                <Chip label="Enabled" size="small" color="success" variant="outlined" />
                              ) : (
                                <Chip label="Disabled" size="small" variant="outlined" />
                              )}
                            </TableCell>
                          </TableRow>
                          {firmware.preferredBootloader && (
                            <TableRow>
                              <TableCell sx={{ fontWeight: 'bold' }}>Bootloader</TableCell>
                              <TableCell>
                                {JSON.stringify(firmware.preferredBootloader)}
                              </TableCell>
                            </TableRow>
                          )}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  </SectionBox>
                ),
              }
            : null,
          features
            ? {
                id: 'features',
                section: (
                  <SectionBox title={t('Feature Preferences')}>
                    <TableContainer component={Paper} variant="outlined">
                      <Table size="small">
                        <TableBody>
                          {features.preferredAcpi && (
                            <TableRow>
                              <TableCell sx={{ fontWeight: 'bold', width: '40%' }}>ACPI</TableCell>
                              <TableCell>
                                <Chip label="Enabled" size="small" color="success" variant="outlined" />
                              </TableCell>
                            </TableRow>
                          )}
                          {features.preferredApic && (
                            <TableRow>
                              <TableCell sx={{ fontWeight: 'bold' }}>APIC</TableCell>
                              <TableCell>
                                <Chip label="Enabled" size="small" color="success" variant="outlined" />
                              </TableCell>
                            </TableRow>
                          )}
                          {features.preferredHyperv && (
                            <TableRow>
                              <TableCell sx={{ fontWeight: 'bold' }}>Hyper-V</TableCell>
                              <TableCell>
                                <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                                  {Object.keys(features.preferredHyperv).map(key => (
                                    <Chip
                                      key={key}
                                      label={key}
                                      size="small"
                                      variant="outlined"
                                      color="info"
                                    />
                                  ))}
                                </Box>
                              </TableCell>
                            </TableRow>
                          )}
                          {features.preferredSmm && (
                            <TableRow>
                              <TableCell sx={{ fontWeight: 'bold' }}>SMM</TableCell>
                              <TableCell>
                                <Chip label="Enabled" size="small" color="success" variant="outlined" />
                              </TableCell>
                            </TableRow>
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
                    &nbsp;&nbsp;preference:
                    <br />
                    &nbsp;&nbsp;&nbsp;&nbsp;kind: VirtualMachineClusterPreference
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
