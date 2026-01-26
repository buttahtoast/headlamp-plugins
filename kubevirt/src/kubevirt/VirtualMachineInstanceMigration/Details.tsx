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
  TableRow,
  Typography,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import VirtualMachineInstanceMigration from './VirtualMachineInstanceMigration';

export interface VirtualMachineInstanceMigrationDetailsProps {
  name?: string;
  namespace?: string;
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

function getPhaseProgress(phase: string): number {
  switch (phase) {
    case 'Pending':
      return 10;
    case 'Scheduling':
      return 20;
    case 'Scheduled':
      return 30;
    case 'PreparingTarget':
      return 50;
    case 'TargetReady':
      return 70;
    case 'Running':
      return 85;
    case 'Succeeded':
      return 100;
    case 'Failed':
      return 100;
    default:
      return 0;
  }
}

export default function VirtualMachineInstanceMigrationDetails(
  props: VirtualMachineInstanceMigrationDetailsProps
) {
  const params = useParams<{ namespace: string; name: string }>();
  const { name = params.name, namespace = params.namespace } = props;
  const { t } = useTranslation('glossary');

  return (
    <Resource.DetailsGrid
      name={name}
      namespace={namespace}
      resourceType={VirtualMachineInstanceMigration}
      withEvents
      extraInfo={item => {
        if (!item) return null;

        const phase = item.getPhase();

        return [
          {
            name: t('Phase'),
            value: (
              <Chip
                label={phase}
                size="small"
                color={getPhaseColor(phase)}
                variant="outlined"
              />
            ),
          },
          {
            name: t('VMI'),
            value: (
              <Link
                routeName="virtualmachineinstance"
                params={{ name: item.getVMIName(), namespace: item.getNamespace() }}
              >
                {item.getVMIName()}
              </Link>
            ),
          },
          {
            name: t('Source Node'),
            value: item.getSourceNode() !== '-' ? (
              <Link routeName="node" params={{ name: item.getSourceNode() }}>
                {item.getSourceNode()}
              </Link>
            ) : (
              '-'
            ),
          },
          {
            name: t('Target Node'),
            value: item.getTargetNode() !== '-' ? (
              <Link routeName="node" params={{ name: item.getTargetNode() }}>
                {item.getTargetNode()}
              </Link>
            ) : (
              '-'
            ),
          },
          {
            name: t('Target Pod'),
            value: item.getTargetPod(),
          },
          {
            name: t('Migration Mode'),
            value: item.getMigrationMode() !== '-' ? (
              <Chip label={item.getMigrationMode()} size="small" variant="outlined" />
            ) : (
              '-'
            ),
          },
          {
            name: t('Start Time'),
            value: item.getStartTimestamp() || '-',
          },
          {
            name: t('End Time'),
            value: item.getEndTimestamp() || '-',
          },
        ];
      }}
      extraSections={item => {
        if (!item) return null;

        const phase = item.getPhase();
        const progress = getPhaseProgress(phase);
        const isCompleted = item.isCompleted();
        const isFailed = item.isFailed();

        return [
          {
            id: 'progress',
            section: (
              <SectionBox title={t('Migration Progress')}>
                <Box sx={{ width: '100%', mb: 2 }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                    <Typography variant="body2" color="text.secondary">
                      {isCompleted
                        ? 'Migration completed successfully'
                        : isFailed
                        ? 'Migration failed'
                        : `Migration in progress: ${phase}`}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {progress}%
                    </Typography>
                  </Box>
                  <LinearProgress
                    variant="determinate"
                    value={progress}
                    color={isCompleted ? 'success' : isFailed ? 'error' : 'warning'}
                    sx={{ height: 10, borderRadius: 5 }}
                  />
                </Box>

                <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 2 }}>
                  {['Pending', 'Scheduling', 'Scheduled', 'PreparingTarget', 'TargetReady', 'Running', 'Succeeded'].map(
                    (p) => (
                      <Chip
                        key={p}
                        label={p}
                        size="small"
                        color={
                          phase === p
                            ? getPhaseColor(p)
                            : getPhaseProgress(phase) > getPhaseProgress(p)
                            ? 'success'
                            : 'default'
                        }
                        variant={phase === p ? 'filled' : 'outlined'}
                      />
                    )
                  )}
                </Box>
              </SectionBox>
            ),
          },
          {
            id: 'migration-state',
            section: (
              <SectionBox title={t('Migration State')}>
                <TableContainer component={Paper} variant="outlined">
                  <Table size="small">
                    <TableBody>
                      <TableRow>
                        <TableCell sx={{ fontWeight: 'bold', width: '30%' }}>Source Node</TableCell>
                        <TableCell>
                          {item.getSourceNode() !== '-' ? (
                            <Link routeName="node" params={{ name: item.getSourceNode() }}>
                              {item.getSourceNode()}
                            </Link>
                          ) : (
                            <Typography variant="caption" color="text.secondary">
                              Not assigned yet
                            </Typography>
                          )}
                        </TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell sx={{ fontWeight: 'bold' }}>Target Node</TableCell>
                        <TableCell>
                          {item.getTargetNode() !== '-' ? (
                            <Link routeName="node" params={{ name: item.getTargetNode() }}>
                              {item.getTargetNode()}
                            </Link>
                          ) : (
                            <Typography variant="caption" color="text.secondary">
                              Not assigned yet
                            </Typography>
                          )}
                        </TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell sx={{ fontWeight: 'bold' }}>Target Pod</TableCell>
                        <TableCell>
                          {item.getTargetPod() !== '-' ? (
                            item.getTargetPod()
                          ) : (
                            <Typography variant="caption" color="text.secondary">
                              Not created yet
                            </Typography>
                          )}
                        </TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell sx={{ fontWeight: 'bold' }}>Migration Mode</TableCell>
                        <TableCell>
                          {item.getMigrationMode() !== '-' ? (
                            <Chip label={item.getMigrationMode()} size="small" variant="outlined" />
                          ) : (
                            <Typography variant="caption" color="text.secondary">
                              -
                            </Typography>
                          )}
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </TableContainer>
              </SectionBox>
            ),
          },
          {
            id: 'conditions',
            section: <Resource.ConditionsSection resource={item?.jsonData} />,
          },
        ];
      }}
    />
  );
}
