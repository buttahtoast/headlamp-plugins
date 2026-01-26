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
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import StorageProfile from './StorageProfile';

export interface StorageProfileDetailsProps {
  name?: string;
}

export default function StorageProfileDetails(props: StorageProfileDetailsProps) {
  const params = useParams<{ name: string }>();
  const { name = params.name } = props;
  const { t } = useTranslation('glossary');

  return (
    <Resource.DetailsGrid
      name={name}
      resourceType={StorageProfile}
      withEvents
      extraInfo={item => {
        if (!item) return null;

        return [
          {
            name: t('Storage Class'),
            value: (
              <Link routeName="storageClass" params={{ name: item.getStorageClass() }}>
                {item.getStorageClass()}
              </Link>
            ),
          },
          {
            name: t('Provisioner'),
            value: item.getProvisioner(),
          },
          {
            name: t('Clone Strategy'),
            value: item.getCloneStrategy() !== '-' ? (
              <Chip
                label={item.getCloneStrategy()}
                size="small"
                variant="outlined"
                color={item.getCloneStrategy() === 'snapshot' ? 'success' : 'info'}
              />
            ) : (
              '-'
            ),
          },
          {
            name: t('Snapshot Class'),
            value: item.getSnapshotClass(),
          },
          {
            name: t('Volume Snapshots'),
            value: item.supportsVolumeSnapshots() ? (
              <Chip label="Supported" size="small" color="success" variant="outlined" />
            ) : (
              <Chip label="Not Supported" size="small" variant="outlined" />
            ),
          },
          {
            name: t('Data Import Cron Source'),
            value: item.getDataImportCronSourceFormat(),
          },
        ];
      }}
      extraSections={item => {
        if (!item) return null;

        const claimPropertySets = item.getClaimPropertySets();

        return [
          claimPropertySets.length > 0
            ? {
                id: 'claim-properties',
                section: (
                  <SectionBox title={t('Claim Property Sets')}>
                    <TableContainer component={Paper} variant="outlined">
                      <Table size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell>Access Modes</TableCell>
                            <TableCell>Volume Mode</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {claimPropertySets.map((set: any, idx: number) => (
                            <TableRow key={idx}>
                              <TableCell>
                                <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                                  {(set.accessModes || []).map((mode: string, mIdx: number) => (
                                    <Chip
                                      key={mIdx}
                                      label={mode}
                                      size="small"
                                      variant="outlined"
                                      color="info"
                                    />
                                  ))}
                                </Box>
                              </TableCell>
                              <TableCell>
                                {set.volumeMode ? (
                                  <Chip label={set.volumeMode} size="small" variant="outlined" />
                                ) : (
                                  <Typography variant="caption" color="text.secondary">
                                    -
                                  </Typography>
                                )}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  </SectionBox>
                ),
              }
            : null,
          {
            id: 'capabilities',
            section: (
              <SectionBox title={t('Capabilities')}>
                <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                  <Paper
                    variant="outlined"
                    sx={{ p: 2, minWidth: 200, display: 'flex', flexDirection: 'column', gap: 1 }}
                  >
                    <Typography variant="subtitle2">Volume Snapshots</Typography>
                    {item.supportsVolumeSnapshots() ? (
                      <Chip label="Supported" size="small" color="success" variant="outlined" />
                    ) : (
                      <Chip label="Not Supported" size="small" variant="outlined" />
                    )}
                  </Paper>
                  <Paper
                    variant="outlined"
                    sx={{ p: 2, minWidth: 200, display: 'flex', flexDirection: 'column', gap: 1 }}
                  >
                    <Typography variant="subtitle2">Clone</Typography>
                    {item.supportsClone() ? (
                      <>
                        <Chip label="Supported" size="small" color="success" variant="outlined" />
                        <Typography variant="caption" color="text.secondary">
                          Strategy: {item.getCloneStrategy()}
                        </Typography>
                      </>
                    ) : (
                      <Chip label="Not Supported" size="small" variant="outlined" />
                    )}
                  </Paper>
                </Box>
              </SectionBox>
            ),
          },
        ].filter(Boolean);
      }}
    />
  );
}
