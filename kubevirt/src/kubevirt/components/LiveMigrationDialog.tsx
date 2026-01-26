import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle, FormControl,
  FormControlLabel,
  Paper,
  Radio,
  RadioGroup,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { Icon } from '@iconify/react';
import { useSnackbar } from 'notistack';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatBytes } from '../utils/kubeVirtCheck';

interface Node {
  metadata: {
    name: string;
    labels?: Record<string, string>;
  };
  status?: {
    conditions?: Array<{
      type: string;
      status: string;
    }>;
    allocatable?: {
      cpu?: string;
      memory?: string;
    };
    capacity?: {
      cpu?: string;
      memory?: string;
    };
  };
  spec?: {
    unschedulable?: boolean;
    taints?: Array<{
      key: string;
      effect: string;
    }>;
  };
}

interface LiveMigrationDialogProps {
  open: boolean;
  onClose: () => void;
  vmName: string;
  vmiName: string;
  namespace: string;
  currentNode?: string;
}

export default function LiveMigrationDialog({
  open,
  onClose,
  vmName,
  vmiName,
  namespace,
  currentNode,
}: LiveMigrationDialogProps) {
  const { enqueueSnackbar } = useSnackbar();
  const [nodes, setNodes] = useState<Node[]>([]);
  const [loading, setLoading] = useState(true);
  const [migrating, setMigrating] = useState(false);
  const [migrationType, setMigrationType] = useState<'auto' | 'specific'>('auto');
  const [selectedNode, setSelectedNode] = useState('');

  // Fetch nodes
  const fetchNodes = useCallback(async () => {
    try {
      const response = await ApiProxy.request('/api/v1/nodes') as { items: Node[] };
      setNodes(response.items || []);
      setLoading(false);
    } catch (error) {
      console.error('Failed to fetch nodes:', error);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      setLoading(true);
      setMigrationType('auto');
      setSelectedNode('');
      fetchNodes();
    }
  }, [open, fetchNodes]);

  // Filter eligible nodes (not current node, schedulable, Ready) and sort alphabetically
  const eligibleNodes = useMemo(() => {
    return nodes
      .filter(node => {
        const nodeName = node.metadata.name;

        // Exclude current node
        if (nodeName === currentNode) return false;

        // Check if node is schedulable
        if (node.spec?.unschedulable) return false;

        // Check for NoSchedule taints (simplified check)
        const hasNoScheduleTaint = node.spec?.taints?.some(
          taint => taint.effect === 'NoSchedule' && taint.key !== 'node-role.kubernetes.io/control-plane'
        );
        if (hasNoScheduleTaint) return false;

        // Check if node is Ready
        const readyCondition = node.status?.conditions?.find(c => c.type === 'Ready');
        return !(!readyCondition || readyCondition.status !== 'True');
      })
      .sort((a, b) => a.metadata.name.localeCompare(b.metadata.name));
  }, [nodes, currentNode]);

  const handleMigrate = async () => {
    setMigrating(true);

    try {
      const migrationName = `${vmiName}-migration-${Date.now()}`;
      const migration: any = {
        apiVersion: 'kubevirt.io/v1',
        kind: 'VirtualMachineInstanceMigration',
        metadata: {
          name: migrationName,
          namespace: namespace,
        },
        spec: {
          vmiName: vmiName,
        },
      };

      // Add target node selector if specific node selected
      // Uses addedNodeSelector with kubernetes.io/hostname to target specific node
      if (migrationType === 'specific' && selectedNode) {
        migration.spec.addedNodeSelector = {
          'kubernetes.io/hostname': selectedNode,
        };
      }

      await ApiProxy.request(
        `/apis/kubevirt.io/v1/namespaces/${namespace}/virtualmachineinstancemigrations`,
        {
          method: 'POST',
          body: JSON.stringify(migration),
          headers: { 'Content-Type': 'application/json' },
        }
      );

      const targetMsg = migrationType === 'specific' && selectedNode
        ? ` to node ${selectedNode}`
        : '';
      enqueueSnackbar(`Live migration initiated for ${vmName || vmiName}${targetMsg}`, { variant: 'success' });
      onClose();
    } catch (error: any) {
      enqueueSnackbar(`Failed to initiate migration: ${error.message}`, { variant: 'error' });
    } finally {
      setMigrating(false);
    }
  };

  const getNodeStatus = (node: Node): { label: string; color: 'success' | 'warning' | 'error' | 'default' } => {
    const readyCondition = node.status?.conditions?.find(c => c.type === 'Ready');
    if (!readyCondition || readyCondition.status !== 'True') {
      return { label: 'NotReady', color: 'error' };
    }
    if (node.spec?.unschedulable) {
      return { label: 'SchedulingDisabled', color: 'warning' };
    }
    return { label: 'Ready', color: 'success' };
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth={false}
      PaperProps={{
        sx: {
          width: '100%',
          maxWidth: { xs: '95%', sm: 550, md: 650 },
          m: { xs: 1, sm: 2 },
        }
      }}
    >
      <DialogTitle>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Icon icon="mdi:swap-horizontal" />
          Live Migrate {vmName || vmiName}
        </Box>
      </DialogTitle>
      <DialogContent>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress />
          </Box>
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
            {currentNode && (
              <Typography variant="body2" color="text.secondary">
                Currently running on: <strong>{currentNode}</strong>
              </Typography>
            )}

            <FormControl component="fieldset">
              <RadioGroup
                value={migrationType}
                onChange={(e) => setMigrationType(e.target.value as 'auto' | 'specific')}
              >
                <FormControlLabel
                  value="auto"
                  control={<Radio />}
                  label={
                    <Box>
                      <Typography variant="body1">Auto-select target node</Typography>
                      <Typography variant="caption" color="text.secondary">
                        KubeVirt will choose the best available node
                      </Typography>
                    </Box>
                  }
                />
                <FormControlLabel
                  value="specific"
                  control={<Radio />}
                  label={
                    <Box>
                      <Typography variant="body1">Select specific target node</Typography>
                      <Typography variant="caption" color="text.secondary">
                        Choose from {eligibleNodes.length} eligible node(s)
                      </Typography>
                    </Box>
                  }
                />
              </RadioGroup>
            </FormControl>

            {migrationType === 'specific' && (
              <Box>
                <Typography variant="subtitle2" gutterBottom>
                  Select Target Node
                </Typography>
                {eligibleNodes.length === 0 ? (
                  <Typography variant="body2" color="text.secondary">
                    No eligible nodes available
                  </Typography>
                ) : (
                  <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 300 }}>
                    <Table size="small" stickyHeader>
                      <TableHead>
                        <TableRow>
                          <TableCell padding="checkbox" sx={{ fontWeight: 'bold' }}></TableCell>
                          <TableCell sx={{ fontWeight: 'bold' }}>Node Name</TableCell>
                          <TableCell sx={{ fontWeight: 'bold' }}>Status</TableCell>
                          <TableCell sx={{ fontWeight: 'bold' }}>CPU</TableCell>
                          <TableCell sx={{ fontWeight: 'bold' }}>Memory</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {eligibleNodes.map(node => {
                          const status = getNodeStatus(node);
                          const cpu = node.status?.allocatable?.cpu || node.status?.capacity?.cpu || '-';
                          const memory = node.status?.allocatable?.memory || node.status?.capacity?.memory;
                          const formattedMemory = formatBytes(memory);
                          const isSelected = selectedNode === node.metadata.name;
                          return (
                            <TableRow
                              key={node.metadata.name}
                              hover
                              selected={isSelected}
                              onClick={() => setSelectedNode(node.metadata.name)}
                              sx={{ cursor: 'pointer' }}
                            >
                              <TableCell padding="checkbox">
                                <Radio
                                  checked={isSelected}
                                  onChange={() => setSelectedNode(node.metadata.name)}
                                  size="small"
                                />
                              </TableCell>
                              <TableCell>
                                <Typography variant="body2" fontWeight={isSelected ? 'bold' : 'normal'}>
                                  {node.metadata.name}
                                </Typography>
                              </TableCell>
                              <TableCell>
                                <Chip label={status.label} size="small" color={status.color} />
                              </TableCell>
                              <TableCell>{cpu}</TableCell>
                              <TableCell>{formattedMemory}</TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </TableContainer>
                )}
              </Box>
            )}

            {migrationType === 'specific' && eligibleNodes.length === 0 && (
              <Typography variant="body2" color="warning.main">
                No eligible nodes available for migration. All other nodes may be unschedulable or not ready.
              </Typography>
            )}

            {migrationType === 'specific' && selectedNode && (
              <Typography variant="caption" color="text.secondary">
                Note: Migration to a specific node requires compatible CPU features between source and target nodes.
                If CPU models don't match, the migration may fail.
              </Typography>
            )}
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={migrating}>
          Cancel
        </Button>
        <Button
          onClick={handleMigrate}
          variant="contained"
          disabled={migrating || loading || (migrationType === 'specific' && !selectedNode)}
          startIcon={migrating ? <CircularProgress size={16} /> : <Icon icon="mdi:swap-horizontal" />}
        >
          {migrating ? 'Migrating...' : 'Start Migration'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
