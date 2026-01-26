import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { Link, SectionBox } from '@kinvolk/headlamp-plugin/lib/components/common';
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Grid,
  LinearProgress,
  Paper,
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
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatBytes } from '../utils/kubeVirtCheck';
import VirtualMachine from '../VirtualMachines/VirtualMachine';
import VirtualMachineInstance from '../VirtualMachineInstance/VirtualMachineInstance';
import VirtualMachineInstanceMigration from '../VirtualMachineInstanceMigration/VirtualMachineInstanceMigration';

interface K8sNode {
  metadata: {
    name: string;
    labels: Record<string, string>;
    creationTimestamp: string;
  };
  spec: {
    unschedulable?: boolean;
    taints?: { key: string; value?: string; effect: string }[];
  };
  status: {
    conditions: { type: string; status: string }[];
    nodeInfo: {
      kubeletVersion: string;
      operatingSystem: string;
      architecture: string;
    };
    allocatable: {
      cpu: string;
      memory: string;
    };
  };
}

interface MaintenanceState {
  nodeToMaintain: K8sNode | null;
  migrating: boolean;
  migratedCount: number;
  totalToMigrate: number;
  completed: boolean;
}

export default function NodeMaintenanceList() {
  const { t } = useTranslation('glossary');
  const { enqueueSnackbar } = useSnackbar();
  const [nodes, setNodes] = useState<K8sNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [maintenanceState, setMaintenanceState] = useState<MaintenanceState>({
    nodeToMaintain: null,
    migrating: false,
    migratedCount: 0,
    totalToMigrate: 0,
    completed: false,
  });
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    node: K8sNode | null;
    action: 'enter' | 'exit';
  }>({ open: false, node: null, action: 'enter' });

  // Fetch VMs and VMIs
  const { items: vms } = VirtualMachine.useList({});
  const { items: vmis } = VirtualMachineInstance.useList({});
  const { items: migrations } = VirtualMachineInstanceMigration.useList({});

  // Fetch nodes
  useEffect(() => {
    const fetchNodes = async () => {
      try {
        const response = await ApiProxy.request('/api/v1/nodes') as { items: K8sNode[] };
        setNodes(response.items || []);
        setLoading(false);
      } catch (error) {
        console.error('Failed to fetch nodes:', error);
        setLoading(false);
      }
    };

    fetchNodes();
    const interval = setInterval(fetchNodes, 10000);
    return () => clearInterval(interval);
  }, []);

  // Count VMs per node
  const vmCountByNode = useMemo(() => {
    const counts: Map<string, { total: number; running: number; vms: any[] }> = new Map();

    vmis?.forEach(vmi => {
      const nodeName = vmi.jsonData?.status?.nodeName;
      if (nodeName) {
        if (!counts.has(nodeName)) {
          counts.set(nodeName, { total: 0, running: 0, vms: [] });
        }
        const nodeData = counts.get(nodeName)!;
        nodeData.total++;
        if (vmi.jsonData?.status?.phase === 'Running') {
          nodeData.running++;
        }
        nodeData.vms.push({
          name: vmi.getName(),
          namespace: vmi.getNamespace(),
          phase: vmi.jsonData?.status?.phase,
        });
      }
    });

    return counts;
  }, [vmis]);

  // Check if node is in maintenance mode
  const isInMaintenance = (node: K8sNode): boolean => {
    return node.spec?.unschedulable === true ||
           node.spec?.taints?.some(t => t.key === 'node.kubernetes.io/unschedulable') ||
           false;
  };

  // Check if node is ready
  const isNodeReady = (node: K8sNode): boolean => {
    return node.status?.conditions?.some(c => c.type === 'Ready' && c.status === 'True') || false;
  };

  // Enter maintenance mode
  const handleEnterMaintenance = async () => {
    const node = confirmDialog.node;
    if (!node) return;

    const nodeName = node.metadata.name;
    const nodeVMs = vmCountByNode.get(nodeName)?.vms || [];
    const runningVMs = nodeVMs.filter(vm => vm.phase === 'Running');

    setConfirmDialog({ open: false, node: null, action: 'enter' });
    setMaintenanceState({
      nodeToMaintain: node,
      migrating: true,
      migratedCount: 0,
      totalToMigrate: runningVMs.length,
      completed: false,
    });

    // Migrate all running VMs
    let migratedCount = 0;
    for (const vm of runningVMs) {
      try {
        const migrationName = `${vm.name}-maintenance-${Date.now()}`;
        const migration = {
          apiVersion: 'kubevirt.io/v1',
          kind: 'VirtualMachineInstanceMigration',
          metadata: {
            name: migrationName,
            namespace: vm.namespace,
          },
          spec: {
            vmiName: vm.name,
          },
        };

        await ApiProxy.request(
          `/apis/kubevirt.io/v1/namespaces/${vm.namespace}/virtualmachineinstancemigrations`,
          {
            method: 'POST',
            body: JSON.stringify(migration),
            headers: { 'Content-Type': 'application/json' },
          }
        );

        migratedCount++;
        setMaintenanceState(prev => ({
          ...prev,
          migratedCount,
        }));
      } catch (error) {
        console.error(`Failed to migrate VM ${vm.name}:`, error);
      }
    }

    // Cordon the node
    try {
      await ApiProxy.request(`/api/v1/nodes/${nodeName}`, {
        method: 'PATCH',
        body: JSON.stringify({
          spec: { unschedulable: true },
        }),
        headers: { 'Content-Type': 'application/strategic-merge-patch+json' },
      });

      enqueueSnackbar(`Node ${nodeName} is now in maintenance mode`, { variant: 'success' });

      // Refresh nodes
      const response = await ApiProxy.request('/api/v1/nodes') as { items: K8sNode[] };
      setNodes(response.items || []);
    } catch (error: any) {
      enqueueSnackbar(`Failed to cordon node: ${error.message}`, { variant: 'error' });
    }

    setMaintenanceState(prev => ({
      ...prev,
      migrating: false,
      completed: true,
    }));
  };

  // Exit maintenance mode
  const handleExitMaintenance = async () => {
    const node = confirmDialog.node;
    if (!node) return;

    const nodeName = node.metadata.name;
    setConfirmDialog({ open: false, node: null, action: 'exit' });

    try {
      // Uncordon the node
      await ApiProxy.request(`/api/v1/nodes/${nodeName}`, {
        method: 'PATCH',
        body: JSON.stringify({
          spec: { unschedulable: false },
        }),
        headers: { 'Content-Type': 'application/strategic-merge-patch+json' },
      });

      enqueueSnackbar(`Node ${nodeName} is now available for scheduling`, { variant: 'success' });

      // Refresh nodes
      const response = await ApiProxy.request('/api/v1/nodes') as { items: K8sNode[] };
      setNodes(response.items || []);
    } catch (error: any) {
      enqueueSnackbar(`Failed to uncordon node: ${error.message}`, { variant: 'error' });
    }
  };

  // Get active migrations for a node
  const getActiveMigrations = (nodeName: string) => {
    return migrations?.filter(m => {
      const sourceNode = m.jsonData?.status?.migrationState?.sourceNode;
      return sourceNode === nodeName && !m.isCompleted() && !m.isFailed();
    }) || [];
  };

  if (loading) {
    return (
      <Box sx={{ p: 3, display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 400 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h4" gutterBottom>
        Node Maintenance
      </Typography>

      {/* Migration Progress */}
      {maintenanceState.migrating && (
        <Paper variant="outlined" sx={{ p: 3, mb: 3, bgcolor: 'warning.lighter' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
            <CircularProgress size={24} />
            <Typography variant="subtitle1" fontWeight="bold">
              Migrating VMs from {maintenanceState.nodeToMaintain?.metadata.name}...
            </Typography>
          </Box>
          <LinearProgress
            variant="determinate"
            value={(maintenanceState.migratedCount / maintenanceState.totalToMigrate) * 100}
            sx={{ mb: 1 }}
          />
          <Typography variant="body2" color="text.secondary">
            {maintenanceState.migratedCount} of {maintenanceState.totalToMigrate} VMs migrated
          </Typography>
        </Paper>
      )}

      <SectionBox title={t('Cluster Nodes')}>
        <TableContainer component={Paper} variant="outlined">
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Node</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>VMs Running</TableCell>
                <TableCell>Active Migrations</TableCell>
                <TableCell>Kubernetes Version</TableCell>
                <TableCell>Resources</TableCell>
                <TableCell>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {nodes.map(node => {
                const nodeName = node.metadata.name;
                const vmData = vmCountByNode.get(nodeName) || { total: 0, running: 0, vms: [] };
                const inMaintenance = isInMaintenance(node);
                const nodeReady = isNodeReady(node);
                const activeMigrations = getActiveMigrations(nodeName);

                return (
                  <TableRow key={nodeName}>
                    <TableCell>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Icon
                          icon={inMaintenance ? 'mdi:wrench' : 'mdi:server'}
                          width={20}
                          color={inMaintenance ? '#ed6c02' : '#2e7d32'}
                        />
                        <Link routeName="node" params={{ name: nodeName }}>
                          {nodeName}
                        </Link>
                      </Box>
                    </TableCell>
                    <TableCell>
                      <Box sx={{ display: 'flex', gap: 0.5 }}>
                        <Chip
                          label={nodeReady ? 'Ready' : 'Not Ready'}
                          size="small"
                          color={nodeReady ? 'success' : 'error'}
                        />
                        {inMaintenance && (
                          <Chip label="Maintenance" size="small" color="warning" />
                        )}
                      </Box>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">
                        {vmData.running} / {vmData.total}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      {activeMigrations.length > 0 ? (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <CircularProgress size={16} />
                          <Typography variant="body2">{activeMigrations.length}</Typography>
                        </Box>
                      ) : (
                        <Typography variant="body2" color="text.secondary">-</Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption">
                        {node.status?.nodeInfo?.kubeletVersion}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption">
                        CPU: {node.status?.allocatable?.cpu}, Memory: {formatBytes(node.status?.allocatable?.memory)}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      {inMaintenance ? (
                        <Button
                          size="small"
                          variant="outlined"
                          color="success"
                          startIcon={<Icon icon="mdi:check" />}
                          onClick={() => setConfirmDialog({
                            open: true,
                            node,
                            action: 'exit',
                          })}
                          disabled={activeMigrations.length > 0}
                        >
                          Exit Maintenance
                        </Button>
                      ) : (
                        <Button
                          size="small"
                          variant="outlined"
                          color="warning"
                          startIcon={<Icon icon="mdi:wrench" />}
                          onClick={() => setConfirmDialog({
                            open: true,
                            node,
                            action: 'enter',
                          })}
                          disabled={!nodeReady || vmData.running === 0}
                        >
                          Enter Maintenance
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      </SectionBox>

      <SectionBox title={t('Node VM Distribution')}>
        <Grid container spacing={2}>
          {nodes.map(node => {
            const nodeName = node.metadata.name;
            const vmData = vmCountByNode.get(nodeName) || { total: 0, running: 0, vms: [] };
            const inMaintenance = isInMaintenance(node);

            return (
              <Grid item xs={12} sm={6} md={4} key={nodeName}>
                <Card
                  variant="outlined"
                  sx={{
                    bgcolor: inMaintenance ? 'warning.lighter' : 'background.paper',
                    borderColor: inMaintenance ? 'warning.main' : 'divider',
                  }}
                >
                  <CardContent>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                      <Icon
                        icon={inMaintenance ? 'mdi:wrench' : 'mdi:server'}
                        width={24}
                      />
                      <Typography variant="subtitle1" fontWeight="bold">
                        {nodeName}
                      </Typography>
                    </Box>
                    <Typography variant="h4" color={vmData.running > 0 ? 'success.main' : 'text.secondary'}>
                      {vmData.running}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      running VMs ({vmData.total} total)
                    </Typography>
                    {vmData.vms.length > 0 && (
                      <Box sx={{ mt: 2, maxHeight: 150, overflow: 'auto' }}>
                        {vmData.vms.slice(0, 5).map((vm: any) => (
                          <Box
                            key={`${vm.namespace}/${vm.name}`}
                            sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.5 }}
                          >
                            <Icon
                              icon="codicon:vm"
                              width={16}
                              color={vm.phase === 'Running' ? '#2e7d32' : '#9e9e9e'}
                            />
                            <Link
                              routeName="virtualmachine"
                              params={{ name: vm.name, namespace: vm.namespace }}
                            >
                              <Typography variant="caption" noWrap sx={{ maxWidth: 150 }}>
                                {vm.name}
                              </Typography>
                            </Link>
                          </Box>
                        ))}
                        {vmData.vms.length > 5 && (
                          <Typography variant="caption" color="text.secondary">
                            +{vmData.vms.length - 5} more
                          </Typography>
                        )}
                      </Box>
                    )}
                  </CardContent>
                </Card>
              </Grid>
            );
          })}
        </Grid>
      </SectionBox>

      {/* Confirmation Dialog */}
      <Dialog
        open={confirmDialog.open}
        onClose={() => setConfirmDialog({ open: false, node: null, action: 'enter' })}
        maxWidth={false}
        PaperProps={{
          sx: {
            width: '100%',
            maxWidth: { xs: '95%', sm: 500, md: 550 },
            m: { xs: 1, sm: 2 },
          }
        }}
      >
        <DialogTitle>
          {confirmDialog.action === 'enter' ? 'Enter Maintenance Mode' : 'Exit Maintenance Mode'}
        </DialogTitle>
        <DialogContent>
          <DialogContentText>
            {confirmDialog.action === 'enter' ? (
              <>
                Are you sure you want to put node "{confirmDialog.node?.metadata.name}" into maintenance mode?
                <br /><br />
                This will:
                <ul>
                  <li>Live migrate all {vmCountByNode.get(confirmDialog.node?.metadata.name || '')?.running || 0} running VMs to other nodes</li>
                  <li>Cordon the node to prevent new workloads</li>
                </ul>
              </>
            ) : (
              <>
                Are you sure you want to exit maintenance mode for node "{confirmDialog.node?.metadata.name}"?
                <br /><br />
                This will uncordon the node, allowing new VMs to be scheduled on it.
              </>
            )}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDialog({ open: false, node: null, action: 'enter' })}>
            Cancel
          </Button>
          <Button
            onClick={confirmDialog.action === 'enter' ? handleEnterMaintenance : handleExitMaintenance}
            color={confirmDialog.action === 'enter' ? 'warning' : 'success'}
            variant="contained"
          >
            {confirmDialog.action === 'enter' ? 'Enter Maintenance' : 'Exit Maintenance'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
