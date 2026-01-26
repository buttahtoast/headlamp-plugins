import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { ActionButton, Link, Resource, SectionBox } from '@kinvolk/headlamp-plugin/lib/components/common';
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableRow,
  Typography,
} from '@mui/material';
import { useSnackbar } from 'notistack';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import VirtualMachineSnapshot from './VirtualMachineSnapshot';

export interface VirtualMachineSnapshotDetailsProps {
  name?: string;
  namespace?: string;
}

function getPhaseColor(phase: string, isReady: boolean): 'success' | 'error' | 'warning' | 'default' {
  if (isReady) return 'success';
  switch (phase) {
    case 'Succeeded':
      return 'success';
    case 'Failed':
      return 'error';
    case 'InProgress':
      return 'warning';
    default:
      return 'default';
  }
}

export default function VirtualMachineSnapshotDetails(props: VirtualMachineSnapshotDetailsProps) {
  const params = useParams<{ namespace: string; name: string }>();
  const { name = params.name, namespace = params.namespace } = props;
  const { t } = useTranslation('glossary');
  const { enqueueSnackbar } = useSnackbar();
  const [restoreDialog, setRestoreDialog] = useState(false);

  const handleRestore = async (snapshot: VirtualMachineSnapshot) => {
    try {
      const restore = {
        apiVersion: 'snapshot.kubevirt.io/v1beta1',
        kind: 'VirtualMachineRestore',
        metadata: {
          name: `restore-${snapshot.getName()}-${Date.now()}`,
          namespace: snapshot.getNamespace(),
        },
        spec: {
          target: {
            apiGroup: 'kubevirt.io',
            kind: 'VirtualMachine',
            name: snapshot.getSourceVMName(),
          },
          virtualMachineSnapshotName: snapshot.getName(),
        },
      };

      await ApiProxy.request(
        `/apis/snapshot.kubevirt.io/v1beta1/namespaces/${snapshot.getNamespace()}/virtualmachinerestores`,
        {
          method: 'POST',
          body: JSON.stringify(restore),
          headers: { 'Content-Type': 'application/json' },
        }
      );

      enqueueSnackbar('Restore initiated successfully', { variant: 'success' });
      setRestoreDialog(false);
    } catch (err: any) {
      enqueueSnackbar(`Failed to restore: ${err.message}`, { variant: 'error' });
    }
  };

  return (
    <Resource.DetailsGrid
      name={name}
      namespace={namespace}
      resourceType={VirtualMachineSnapshot}
      withEvents
      extraInfo={item => {
        if (!item) return null;

        const phase = item.getPhase();
        const isReady = item.isReady();
        const error = item.getError();

        return [
          {
            name: t('Status'),
            value: (
              <Chip
                label={isReady ? 'Ready' : phase}
                size="small"
                color={getPhaseColor(phase, isReady)}
                variant="outlined"
              />
            ),
          },
          {
            name: t('Ready to Use'),
            value: isReady ? 'Yes' : 'No',
          },
          {
            name: t('Source VM'),
            value: (
              <Link
                routeName="virtualmachine"
                params={{ name: item.getSourceVMName(), namespace: item.getNamespace() }}
              >
                {item.getSourceVMName()}
              </Link>
            ),
          },
          {
            name: t('Snapshot Content'),
            value: item.getSnapshotContentName(),
          },
          {
            name: t('Creation Time'),
            value: item.getSnapshotCreationTime() || '-',
          },
          ...(error
            ? [
                {
                  name: t('Error'),
                  value: (
                    <Typography color="error" variant="body2">
                      {error}
                    </Typography>
                  ),
                },
              ]
            : []),
        ];
      }}
      extraSections={item => {
        if (!item) return null;

        const indications = item.getIndications();

        return [
          indications.length > 0
            ? {
                id: 'indications',
                section: (
                  <SectionBox title={t('Indications')}>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                      {indications.map((indication, idx) => (
                        <Chip
                          key={idx}
                          label={indication}
                          color="warning"
                          variant="outlined"
                          sx={{ width: 'fit-content' }}
                        />
                      ))}
                    </Box>
                  </SectionBox>
                ),
              }
            : null,
          {
            id: 'source-spec',
            section: (
              <SectionBox title={t('Source Specification')}>
                <TableContainer component={Paper} variant="outlined">
                  <Table size="small">
                    <TableBody>
                      <TableRow>
                        <TableCell sx={{ fontWeight: 'bold', width: '30%' }}>API Group</TableCell>
                        <TableCell>{item.spec?.source?.apiGroup || 'kubevirt.io'}</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell sx={{ fontWeight: 'bold' }}>Kind</TableCell>
                        <TableCell>{item.spec?.source?.kind || 'VirtualMachine'}</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell sx={{ fontWeight: 'bold' }}>Name</TableCell>
                        <TableCell>{item.spec?.source?.name}</TableCell>
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
        ].filter(Boolean);
      }}
      actions={item => {
        if (!item) return [];

        return [
          {
            id: 'restore',
            action: (
              <>
                <ActionButton
                  description={t('Restore VM')}
                  icon="mdi:restore"
                  onClick={() => setRestoreDialog(true)}
                />
                <Dialog
                  open={restoreDialog}
                  onClose={() => setRestoreDialog(false)}
                  maxWidth={false}
                  PaperProps={{
                    sx: {
                      width: '100%',
                      maxWidth: { xs: '95%', sm: 450, md: 500 },
                      m: { xs: 1, sm: 2 },
                    }
                  }}
                >
                  <DialogTitle>Restore Virtual Machine</DialogTitle>
                  <DialogContent>
                    <DialogContentText>
                      Are you sure you want to restore VM "{item.getSourceVMName()}" from this snapshot? This will
                      revert the VM to its state at the time of the snapshot.
                    </DialogContentText>
                  </DialogContent>
                  <DialogActions>
                    <Button onClick={() => setRestoreDialog(false)}>Cancel</Button>
                    <Button onClick={() => handleRestore(item)} color="primary" variant="contained">
                      Restore
                    </Button>
                  </DialogActions>
                </Dialog>
              </>
            ),
          },
        ];
      }}
    />
  );
}
