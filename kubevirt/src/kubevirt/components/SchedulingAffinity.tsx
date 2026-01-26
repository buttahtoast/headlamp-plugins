import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { SectionBox } from '@kinvolk/headlamp-plugin/lib/components/common';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { Icon } from '@iconify/react';
import { useSnackbar } from 'notistack';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import VirtualMachine from '../VirtualMachines/VirtualMachine';
import VirtualMachineInstance from '../VirtualMachineInstance/VirtualMachineInstance';

interface Node {
  metadata: {
    name: string;
    labels?: Record<string, string>;
  };
}

interface SchedulingAffinityProps {
  vm?: VirtualMachine;
  vmi?: VirtualMachineInstance;
  namespace: string;
}

interface Toleration {
  key?: string;
  operator?: string;
  value?: string;
  effect?: string;
  tolerationSeconds?: number;
}

interface NodeSelectorTerm {
  matchExpressions?: Array<{
    key: string;
    operator: string;
    values?: string[];
  }>;
  matchFields?: Array<{
    key: string;
    operator: string;
    values?: string[];
  }>;
}

export default function SchedulingAffinity({
  vm,
  vmi,
  namespace,
}: SchedulingAffinityProps) {
  const { t } = useTranslation('glossary');
  const { enqueueSnackbar } = useSnackbar();
  const isVMMode = !!vm;

  // Get spec from VM or VMI
  const getSpec = () => {
    if (vm) {
      return vm.jsonData?.spec?.template?.spec;
    }
    if (vmi) {
      return vmi.spec;
    }
    return null;
  };

  const spec = getSpec();
  const affinity = spec?.affinity;
  const tolerations: Toleration[] = spec?.tolerations || [];
  const nodeSelector: Record<string, string> = spec?.nodeSelector || {};

  const hasAffinity = affinity?.nodeAffinity || affinity?.podAffinity || affinity?.podAntiAffinity;
  const hasTolerations = tolerations.length > 0;
  const hasNodeSelector = Object.keys(nodeSelector).length > 0;
  const hasAnyRules = hasAffinity || hasTolerations || hasNodeSelector;

  // Dialog states
  const [nodeSelectorDialogOpen, setNodeSelectorDialogOpen] = useState(false);
  const [tolerationDialogOpen, setTolerationDialogOpen] = useState(false);
  const [nodeAffinityDialogOpen, setNodeAffinityDialogOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  // Node selector form state
  const [nodeSelectorEntries, setNodeSelectorEntries] = useState<Array<{ key: string; value: string }>>([]);

  // Toleration form state
  const [tolerationEntries, setTolerationEntries] = useState<Toleration[]>([]);

  // Node affinity form state
  const [nodeAffinityRequired, setNodeAffinityRequired] = useState<NodeSelectorTerm[]>([]);
  const [nodeAffinityPreferred, setNodeAffinityPreferred] = useState<Array<{ weight: number; preference: NodeSelectorTerm }>>([]);

  // Fetch nodes for label suggestions
  const [nodes, setNodes] = useState<Node[]>([]);
  const [nodeLabels, setNodeLabels] = useState<string[]>([]);

  useEffect(() => {
    const fetchNodes = async () => {
      try {
        const response = await ApiProxy.request('/api/v1/nodes') as { items: Node[] };
        setNodes(response.items || []);

        // Extract unique label keys
        const labelSet = new Set<string>();
        response.items?.forEach(node => {
          Object.keys(node.metadata?.labels || {}).forEach(key => labelSet.add(key));
        });
        setNodeLabels(Array.from(labelSet).sort());
      } catch (error) {
        console.error('Failed to fetch nodes:', error);
      }
    };
    fetchNodes();
  }, []);

  // Get unique values for a label key
  const getLabelValues = (key: string): string[] => {
    const values = new Set<string>();
    nodes.forEach(node => {
      const val = node.metadata?.labels?.[key];
      if (val) values.add(val);
    });
    return Array.from(values).sort();
  };

  // Initialize form when opening dialogs
  const openNodeSelectorDialog = () => {
    setNodeSelectorEntries(
      Object.entries(nodeSelector).map(([key, value]) => ({ key, value }))
    );
    if (Object.keys(nodeSelector).length === 0) {
      setNodeSelectorEntries([{ key: '', value: '' }]);
    }
    setNodeSelectorDialogOpen(true);
  };

  const openTolerationDialog = () => {
    setTolerationEntries(tolerations.length > 0 ? [...tolerations] : [{ key: '', operator: 'Equal', value: '', effect: 'NoSchedule' }]);
    setTolerationDialogOpen(true);
  };

  const openNodeAffinityDialog = () => {
    const required = affinity?.nodeAffinity?.requiredDuringSchedulingIgnoredDuringExecution?.nodeSelectorTerms || [];
    const preferred = affinity?.nodeAffinity?.preferredDuringSchedulingIgnoredDuringExecution || [];
    setNodeAffinityRequired(required.length > 0 ? [...required] : []);
    setNodeAffinityPreferred(preferred.length > 0 ? [...preferred] : []);
    setNodeAffinityDialogOpen(true);
  };

  // Save node selector
  const handleSaveNodeSelector = async () => {
    if (!vm) return;

    setLoading(true);
    try {
      const newNodeSelector: Record<string, string> = {};
      nodeSelectorEntries.forEach(entry => {
        if (entry.key && entry.value) {
          newNodeSelector[entry.key] = entry.value;
        }
      });

      const patch = Object.keys(newNodeSelector).length > 0
        ? [{ op: 'add', path: '/spec/template/spec/nodeSelector', value: newNodeSelector }]
        : [{ op: 'remove', path: '/spec/template/spec/nodeSelector' }];

      await ApiProxy.request(
        `/apis/kubevirt.io/v1/namespaces/${namespace}/virtualmachines/${vm.getName()}`,
        {
          method: 'PATCH',
          body: JSON.stringify(patch),
          headers: { 'Content-Type': 'application/json-patch+json' },
        }
      );

      enqueueSnackbar('Node selector updated successfully', { variant: 'success' });
      setNodeSelectorDialogOpen(false);
    } catch (error: any) {
      enqueueSnackbar(`Failed to update node selector: ${error.message}`, { variant: 'error' });
    }
    setLoading(false);
  };

  // Save tolerations
  const handleSaveTolerations = async () => {
    if (!vm) return;

    setLoading(true);
    try {
      const validTolerations = tolerationEntries.filter(t => t.key || t.operator === 'Exists');

      const patch = validTolerations.length > 0
        ? [{ op: 'add', path: '/spec/template/spec/tolerations', value: validTolerations }]
        : [{ op: 'remove', path: '/spec/template/spec/tolerations' }];

      await ApiProxy.request(
        `/apis/kubevirt.io/v1/namespaces/${namespace}/virtualmachines/${vm.getName()}`,
        {
          method: 'PATCH',
          body: JSON.stringify(patch),
          headers: { 'Content-Type': 'application/json-patch+json' },
        }
      );

      enqueueSnackbar('Tolerations updated successfully', { variant: 'success' });
      setTolerationDialogOpen(false);
    } catch (error: any) {
      enqueueSnackbar(`Failed to update tolerations: ${error.message}`, { variant: 'error' });
    }
    setLoading(false);
  };

  // Save node affinity
  const handleSaveNodeAffinity = async () => {
    if (!vm) return;

    setLoading(true);
    try {
      const nodeAffinity: any = {};

      if (nodeAffinityRequired.length > 0) {
        nodeAffinity.requiredDuringSchedulingIgnoredDuringExecution = {
          nodeSelectorTerms: nodeAffinityRequired,
        };
      }

      if (nodeAffinityPreferred.length > 0) {
        nodeAffinity.preferredDuringSchedulingIgnoredDuringExecution = nodeAffinityPreferred;
      }

      let patch: Array<{ op: string; path: string; value?: any }> | null = null;
      if (Object.keys(nodeAffinity).length > 0) {
        // Ensure affinity object exists
        const currentAffinity = vm.jsonData?.spec?.template?.spec?.affinity || {};
        patch = [{
          op: currentAffinity ? 'replace' : 'add',
          path: '/spec/template/spec/affinity',
          value: { ...currentAffinity, nodeAffinity },
        }];
      } else {
        // Remove node affinity but keep other affinity rules
        const currentAffinity = vm.jsonData?.spec?.template?.spec?.affinity;
        if (currentAffinity?.nodeAffinity) {
          const { nodeAffinity: _, ...restAffinity } = currentAffinity;
          if (Object.keys(restAffinity).length > 0) {
            patch = [{ op: 'replace', path: '/spec/template/spec/affinity', value: restAffinity }];
          } else {
            patch = [{ op: 'remove', path: '/spec/template/spec/affinity' }];
          }
        }
        // If no nodeAffinity exists, nothing to do - patch remains null
      }

      if (patch) {
        await ApiProxy.request(
          `/apis/kubevirt.io/v1/namespaces/${namespace}/virtualmachines/${vm.getName()}`,
          {
            method: 'PATCH',
            body: JSON.stringify(patch),
            headers: { 'Content-Type': 'application/json-patch+json' },
          }
        );
      }

      enqueueSnackbar('Node affinity updated successfully', { variant: 'success' });
      setNodeAffinityDialogOpen(false);
    } catch (error: any) {
      enqueueSnackbar(`Failed to update node affinity: ${error.message}`, { variant: 'error' });
    }
    setLoading(false);
  };

  // Delete a specific rule
  const handleDeleteNodeSelector = async () => {
    if (!vm) return;

    // Check if nodeSelector exists before trying to remove
    const currentNodeSelector = vm.jsonData?.spec?.template?.spec?.nodeSelector;
    if (!currentNodeSelector || Object.keys(currentNodeSelector).length === 0) {
      enqueueSnackbar('No node selector to remove', { variant: 'info' });
      return;
    }

    setLoading(true);
    try {
      await ApiProxy.request(
        `/apis/kubevirt.io/v1/namespaces/${namespace}/virtualmachines/${vm.getName()}`,
        {
          method: 'PATCH',
          body: JSON.stringify([{ op: 'remove', path: '/spec/template/spec/nodeSelector' }]),
          headers: { 'Content-Type': 'application/json-patch+json' },
        }
      );
      enqueueSnackbar('Node selector removed', { variant: 'success' });
    } catch (error: any) {
      enqueueSnackbar(`Failed to remove node selector: ${error.message}`, { variant: 'error' });
    }
    setLoading(false);
  };

  const handleDeleteTolerations = async () => {
    if (!vm) return;

    // Check if tolerations exist before trying to remove
    const currentTolerations = vm.jsonData?.spec?.template?.spec?.tolerations;
    if (!currentTolerations || currentTolerations.length === 0) {
      enqueueSnackbar('No tolerations to remove', { variant: 'info' });
      return;
    }

    setLoading(true);
    try {
      await ApiProxy.request(
        `/apis/kubevirt.io/v1/namespaces/${namespace}/virtualmachines/${vm.getName()}`,
        {
          method: 'PATCH',
          body: JSON.stringify([{ op: 'remove', path: '/spec/template/spec/tolerations' }]),
          headers: { 'Content-Type': 'application/json-patch+json' },
        }
      );
      enqueueSnackbar('Tolerations removed', { variant: 'success' });
    } catch (error: any) {
      enqueueSnackbar(`Failed to remove tolerations: ${error.message}`, { variant: 'error' });
    }
    setLoading(false);
  };

  // Render expression for node affinity
  const renderExpression = (expr: { key: string; operator: string; values?: string[] }) => {
    if (expr.operator === 'Exists') {
      return `${expr.key} exists`;
    }
    if (expr.operator === 'DoesNotExist') {
      return `${expr.key} does not exist`;
    }
    const op = expr.operator === 'In' ? 'in' : expr.operator === 'NotIn' ? 'not in' : expr.operator;
    return `${expr.key} ${op} [${expr.values?.join(', ') || ''}]`;
  };

  return (
    <>
      <SectionBox title={t('Scheduling & Affinity Rules')}>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {/* Action buttons for VM mode */}
          {isVMMode && (
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              <Button
                variant="outlined"
                size="small"
                startIcon={<Icon icon="mdi:server" />}
                onClick={openNodeSelectorDialog}
              >
                {hasNodeSelector ? 'Edit' : 'Add'} Node Selector
              </Button>
              <Button
                variant="outlined"
                size="small"
                startIcon={<Icon icon="mdi:shield-check" />}
                onClick={openTolerationDialog}
              >
                {hasTolerations ? 'Edit' : 'Add'} Tolerations
              </Button>
              <Button
                variant="outlined"
                size="small"
                startIcon={<Icon icon="mdi:tune" />}
                onClick={openNodeAffinityDialog}
              >
                {affinity?.nodeAffinity ? 'Edit' : 'Add'} Node Affinity
              </Button>
            </Box>
          )}

          {!hasAnyRules && (
            <Paper variant="outlined" sx={{ p: 2, textAlign: 'center' }}>
              <Icon icon="mdi:calendar-clock" width={32} color="#9e9e9e" />
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                No scheduling constraints configured
              </Typography>
              {isVMMode && (
                <Typography variant="caption" color="text.secondary">
                  Use the buttons above to add scheduling rules
                </Typography>
              )}
            </Paper>
          )}

          {/* Node Selector */}
          {hasNodeSelector && (
            <Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                <Typography variant="subtitle2">Node Selector</Typography>
                {isVMMode && (
                  <Tooltip title="Remove node selector">
                    <IconButton size="small" onClick={handleDeleteNodeSelector} disabled={loading}>
                      <Icon icon="mdi:delete" width={16} />
                    </IconButton>
                  </Tooltip>
                )}
              </Box>
              <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                {Object.entries(nodeSelector).map(([key, value]) => (
                  <Chip
                    key={key}
                    label={`${key}: ${value}`}
                    size="small"
                    variant="outlined"
                    color="primary"
                  />
                ))}
              </Box>
            </Box>
          )}

          {/* Node Affinity */}
          {affinity?.nodeAffinity && (
            <Box>
              <Typography variant="subtitle2" gutterBottom>
                Node Affinity
              </Typography>
              <TableContainer component={Paper} variant="outlined">
                <Table size="small">
                  <TableBody>
                    {affinity.nodeAffinity.requiredDuringSchedulingIgnoredDuringExecution && (
                      <TableRow>
                        <TableCell sx={{ fontWeight: 'bold', width: '20%', verticalAlign: 'top' }}>
                          <Chip label="Required" size="small" color="error" variant="outlined" />
                        </TableCell>
                        <TableCell>
                          {affinity.nodeAffinity.requiredDuringSchedulingIgnoredDuringExecution.nodeSelectorTerms?.map((term: NodeSelectorTerm, idx: number) => (
                            <Box key={idx} sx={{ mb: 1 }}>
                              {term.matchExpressions?.map((expr, exprIdx) => (
                                <Chip
                                  key={exprIdx}
                                  label={renderExpression(expr)}
                                  size="small"
                                  variant="outlined"
                                  sx={{ mr: 0.5, mb: 0.5 }}
                                />
                              ))}
                            </Box>
                          ))}
                        </TableCell>
                      </TableRow>
                    )}
                    {affinity.nodeAffinity.preferredDuringSchedulingIgnoredDuringExecution && (
                      <TableRow>
                        <TableCell sx={{ fontWeight: 'bold', width: '20%', verticalAlign: 'top' }}>
                          <Chip label="Preferred" size="small" color="warning" variant="outlined" />
                        </TableCell>
                        <TableCell>
                          {affinity.nodeAffinity.preferredDuringSchedulingIgnoredDuringExecution.map((pref: any, idx: number) => (
                            <Box key={idx} sx={{ mb: 1 }}>
                              <Typography variant="caption" color="text.secondary">
                                Weight: {pref.weight}
                              </Typography>
                              <Box>
                                {pref.preference?.matchExpressions?.map((expr: any, exprIdx: number) => (
                                  <Chip
                                    key={exprIdx}
                                    label={renderExpression(expr)}
                                    size="small"
                                    variant="outlined"
                                    sx={{ mr: 0.5, mb: 0.5 }}
                                  />
                                ))}
                              </Box>
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

          {/* Pod Affinity */}
          {affinity?.podAffinity && (
            <Box>
              <Typography variant="subtitle2" gutterBottom>
                Pod Affinity
              </Typography>
              <Chip
                label="Pod affinity rules configured"
                size="small"
                variant="outlined"
                color="success"
              />
              <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                (Edit via YAML for complex rules)
              </Typography>
            </Box>
          )}

          {/* Pod Anti-Affinity */}
          {affinity?.podAntiAffinity && (
            <Box>
              <Typography variant="subtitle2" gutterBottom>
                Pod Anti-Affinity
              </Typography>
              <Chip
                label="Pod anti-affinity rules configured"
                size="small"
                variant="outlined"
                color="warning"
              />
              <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                (Edit via YAML for complex rules)
              </Typography>
            </Box>
          )}

          {/* Tolerations */}
          {hasTolerations && (
            <Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                <Typography variant="subtitle2">Tolerations ({tolerations.length})</Typography>
                {isVMMode && (
                  <Tooltip title="Remove all tolerations">
                    <IconButton size="small" onClick={handleDeleteTolerations} disabled={loading}>
                      <Icon icon="mdi:delete" width={16} />
                    </IconButton>
                  </Tooltip>
                )}
              </Box>
              <TableContainer component={Paper} variant="outlined">
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 'bold' }}>Key</TableCell>
                      <TableCell sx={{ fontWeight: 'bold' }}>Operator</TableCell>
                      <TableCell sx={{ fontWeight: 'bold' }}>Value</TableCell>
                      <TableCell sx={{ fontWeight: 'bold' }}>Effect</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {tolerations.map((tol, idx) => (
                      <TableRow key={idx}>
                        <TableCell>{tol.key || '*'}</TableCell>
                        <TableCell>{tol.operator || 'Equal'}</TableCell>
                        <TableCell>{tol.value || '-'}</TableCell>
                        <TableCell>
                          <Chip
                            label={tol.effect || 'All'}
                            size="small"
                            variant="outlined"
                            color={tol.effect === 'NoSchedule' ? 'error' : tol.effect === 'PreferNoSchedule' ? 'warning' : 'default'}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </Box>
          )}

          {!isVMMode && hasAnyRules && (
            <Alert severity="info" sx={{ mt: 1 }}>
              Scheduling rules cannot be modified on a running VMI. Edit the parent VM to change these settings.
            </Alert>
          )}
        </Box>
      </SectionBox>

      {/* Node Selector Dialog */}
      <Dialog
        open={nodeSelectorDialogOpen}
        onClose={() => setNodeSelectorDialogOpen(false)}
        maxWidth={false}
        PaperProps={{
          sx: {
            width: '100%',
            maxWidth: { xs: '95%', sm: 700, md: 800 },
            m: { xs: 1, sm: 2 },
          }
        }}
      >
        <DialogTitle>Configure Node Selector</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
            <Alert severity="info">
              Node selector ensures the VM runs only on nodes with matching labels.
            </Alert>
            {nodeSelectorEntries.map((entry, idx) => (
              <Box key={idx} sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                <Autocomplete
                  freeSolo
                  options={nodeLabels}
                  value={entry.key}
                  onChange={(_: any, newValue: string) => {
                    const newEntries = [...nodeSelectorEntries];
                    newEntries[idx].key = newValue || '';
                    setNodeSelectorEntries(newEntries);
                  }}
                  onInputChange={(_: any, newValue: string) => {
                    const newEntries = [...nodeSelectorEntries];
                    newEntries[idx].key = newValue;
                    setNodeSelectorEntries(newEntries);
                  }}
                  renderInput={(params: any) => (
                    <TextField {...params} label="Label Key" size="small" sx={{ minWidth: 400 }} />
                  )}
                />
                <Autocomplete
                  freeSolo
                  options={entry.key ? getLabelValues(entry.key) : []}
                  value={entry.value}
                  onChange={(_: any, newValue: string) => {
                    const newEntries = [...nodeSelectorEntries];
                    newEntries[idx].value = newValue || '';
                    setNodeSelectorEntries(newEntries);
                  }}
                  onInputChange={(_: any, newValue: string) => {
                    const newEntries = [...nodeSelectorEntries];
                    newEntries[idx].value = newValue;
                    setNodeSelectorEntries(newEntries);
                  }}
                  renderInput={(params: any) => (
                    <TextField {...params} label="Value" size="small" sx={{ minWidth: 300 }} />
                  )}
                />
                <IconButton
                  size="small"
                  onClick={() => {
                    const newEntries = nodeSelectorEntries.filter((_, i) => i !== idx);
                    setNodeSelectorEntries(newEntries.length > 0 ? newEntries : [{ key: '', value: '' }]);
                  }}
                >
                  <Icon icon="mdi:delete" />
                </IconButton>
              </Box>
            ))}
            <Button
              variant="outlined"
              size="small"
              startIcon={<Icon icon="mdi:plus" />}
              onClick={() => setNodeSelectorEntries([...nodeSelectorEntries, { key: '', value: '' }])}
              sx={{ alignSelf: 'flex-start' }}
            >
              Add Label
            </Button>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setNodeSelectorDialogOpen(false)} disabled={loading}>Cancel</Button>
          <Button onClick={handleSaveNodeSelector} variant="contained" disabled={loading}>
            {loading ? 'Saving...' : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Tolerations Dialog */}
      <Dialog
        open={tolerationDialogOpen}
        onClose={() => setTolerationDialogOpen(false)}
        maxWidth={false}
        PaperProps={{
          sx: {
            width: '100%',
            maxWidth: { xs: '95%', sm: '90%', md: 1000, lg: 1100 },
            m: { xs: 1, sm: 2 },
          }
        }}
      >
        <DialogTitle>Configure Tolerations</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
            <Alert severity="info">
              Tolerations allow the VM to be scheduled on nodes with matching taints.
            </Alert>
            {tolerationEntries.map((tol, idx) => (
              <Paper key={idx} variant="outlined" sx={{ p: 2 }}>
                <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                  <TextField
                    label="Key"
                    size="small"
                    value={tol.key || ''}
                    onChange={(e: { target: { value: string; }; }) => {
                      const newEntries = [...tolerationEntries];
                      newEntries[idx].key = e.target.value;
                      setTolerationEntries(newEntries);
                    }}
                    sx={{ minWidth: 400 }}
                  />
                  <FormControl size="small" sx={{ minWidth: 120 }}>
                    <InputLabel>Operator</InputLabel>
                    <Select
                      value={tol.operator || 'Equal'}
                      label="Operator"
                      onChange={(e: { target: { value: string; }; }) => {
                        const newEntries = [...tolerationEntries];
                        newEntries[idx].operator = e.target.value;
                        if (e.target.value === 'Exists') {
                          newEntries[idx].value = '';
                        }
                        setTolerationEntries(newEntries);
                      }}
                    >
                      <MenuItem value="Equal">Equal</MenuItem>
                      <MenuItem value="Exists">Exists</MenuItem>
                    </Select>
                  </FormControl>
                  {tol.operator !== 'Exists' && (
                    <TextField
                      label="Value"
                      size="small"
                      value={tol.value || ''}
                      onChange={(e: { target: { value: string; }; }) => {
                        const newEntries = [...tolerationEntries];
                        newEntries[idx].value = e.target.value;
                        setTolerationEntries(newEntries);
                      }}
                      sx={{ minWidth: 250 }}
                    />
                  )}
                  <FormControl size="small" sx={{ minWidth: 150 }}>
                    <InputLabel>Effect</InputLabel>
                    <Select
                      value={tol.effect || ''}
                      label="Effect"
                      onChange={(e: { target: { value: string; }; }) => {
                        const newEntries = [...tolerationEntries];
                        newEntries[idx].effect = e.target.value;
                        setTolerationEntries(newEntries);
                      }}
                    >
                      <MenuItem value="">All Effects</MenuItem>
                      <MenuItem value="NoSchedule">NoSchedule</MenuItem>
                      <MenuItem value="PreferNoSchedule">PreferNoSchedule</MenuItem>
                      <MenuItem value="NoExecute">NoExecute</MenuItem>
                    </Select>
                  </FormControl>
                  <IconButton
                    size="small"
                    onClick={() => {
                      const newEntries = tolerationEntries.filter((_, i) => i !== idx);
                      setTolerationEntries(newEntries.length > 0 ? newEntries : [{ key: '', operator: 'Equal', value: '', effect: 'NoSchedule' }]);
                    }}
                  >
                    <Icon icon="mdi:delete" />
                  </IconButton>
                </Box>
              </Paper>
            ))}
            <Button
              variant="outlined"
              size="small"
              startIcon={<Icon icon="mdi:plus" />}
              onClick={() => setTolerationEntries([...tolerationEntries, { key: '', operator: 'Equal', value: '', effect: 'NoSchedule' }])}
              sx={{ alignSelf: 'flex-start' }}
            >
              Add Toleration
            </Button>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setTolerationDialogOpen(false)} disabled={loading}>Cancel</Button>
          <Button onClick={handleSaveTolerations} variant="contained" disabled={loading}>
            {loading ? 'Saving...' : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Node Affinity Dialog */}
      <Dialog
        open={nodeAffinityDialogOpen}
        onClose={() => setNodeAffinityDialogOpen(false)}
        maxWidth={false}
        PaperProps={{
          sx: {
            width: '100%',
            maxWidth: { xs: '95%', sm: '90%', md: 900, lg: 1000 },
            m: { xs: 1, sm: 2 },
          }
        }}
      >
        <DialogTitle>Configure Node Affinity</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, mt: 1 }}>
            <Alert severity="info">
              Node affinity provides more flexible scheduling rules than node selector.
            </Alert>

            {/* Required Rules */}
            <Box>
              <Typography variant="subtitle2" gutterBottom>
                Required Rules (must be satisfied)
              </Typography>
              {nodeAffinityRequired.map((term, termIdx) => (
                <Paper key={termIdx} variant="outlined" sx={{ p: 2, mb: 1 }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                    <Typography variant="caption" color="text.secondary">Term {termIdx + 1}</Typography>
                    <IconButton
                      size="small"
                      onClick={() => setNodeAffinityRequired(nodeAffinityRequired.filter((_, i) => i !== termIdx))}
                    >
                      <Icon icon="mdi:delete" />
                    </IconButton>
                  </Box>
                  {(term.matchExpressions || []).map((expr, exprIdx) => (
                    <Box key={exprIdx} sx={{ display: 'flex', gap: 1, alignItems: 'center', mb: 1 }}>
                      <Autocomplete
                        freeSolo
                        options={nodeLabels}
                        value={expr.key}
                        onChange={(_: any, newValue: string) => {
                          const newRequired = [...nodeAffinityRequired];
                          newRequired[termIdx].matchExpressions![exprIdx].key = newValue || '';
                          setNodeAffinityRequired(newRequired);
                        }}
                        onInputChange={(_: any, newValue: string) => {
                          const newRequired = [...nodeAffinityRequired];
                          newRequired[termIdx].matchExpressions![exprIdx].key = newValue;
                          setNodeAffinityRequired(newRequired);
                        }}
                        renderInput={(params: any) => (
                          <TextField {...params} label="Key" size="small" sx={{ minWidth: 400 }} />
                        )}
                      />
                      <FormControl size="small" sx={{ minWidth: 100 }}>
                        <InputLabel>Operator</InputLabel>
                        <Select
                          value={expr.operator}
                          label="Operator"
                          onChange={(e: { target: { value: string; }; }) => {
                            const newRequired = [...nodeAffinityRequired];
                            newRequired[termIdx].matchExpressions![exprIdx].operator = e.target.value;
                            setNodeAffinityRequired(newRequired);
                          }}
                        >
                          <MenuItem value="In">In</MenuItem>
                          <MenuItem value="NotIn">NotIn</MenuItem>
                          <MenuItem value="Exists">Exists</MenuItem>
                          <MenuItem value="DoesNotExist">DoesNotExist</MenuItem>
                        </Select>
                      </FormControl>
                      {!['Exists', 'DoesNotExist'].includes(expr.operator) && (
                        <TextField
                          label="Values (comma-separated)"
                          size="small"
                          value={expr.values?.join(', ') || ''}
                          onChange={(e: { target: { value: string; }; }) => {
                            const newRequired = [...nodeAffinityRequired];
                            newRequired[termIdx].matchExpressions![exprIdx].values = e.target.value.split(',').map(v => v.trim()).filter(v => v);
                            setNodeAffinityRequired(newRequired);
                          }}
                          sx={{ minWidth: 300 }}
                        />
                      )}
                      <IconButton
                        size="small"
                        onClick={() => {
                          const newRequired = [...nodeAffinityRequired];
                          newRequired[termIdx].matchExpressions = newRequired[termIdx].matchExpressions!.filter((_, i) => i !== exprIdx);
                          setNodeAffinityRequired(newRequired);
                        }}
                      >
                        <Icon icon="mdi:close" />
                      </IconButton>
                    </Box>
                  ))}
                  <Button
                    size="small"
                    startIcon={<Icon icon="mdi:plus" />}
                    onClick={() => {
                      const newRequired = [...nodeAffinityRequired];
                      if (!newRequired[termIdx].matchExpressions) {
                        newRequired[termIdx].matchExpressions = [];
                      }
                      newRequired[termIdx].matchExpressions!.push({ key: '', operator: 'In', values: [] });
                      setNodeAffinityRequired(newRequired);
                    }}
                  >
                    Add Expression
                  </Button>
                </Paper>
              ))}
              <Button
                variant="outlined"
                size="small"
                startIcon={<Icon icon="mdi:plus" />}
                onClick={() => setNodeAffinityRequired([...nodeAffinityRequired, { matchExpressions: [{ key: '', operator: 'In', values: [] }] }])}
              >
                Add Required Term
              </Button>
            </Box>

            {/* Preferred Rules */}
            <Box>
              <Typography variant="subtitle2" gutterBottom>
                Preferred Rules (soft constraints with weights)
              </Typography>
              {nodeAffinityPreferred.map((pref, prefIdx) => (
                <Paper key={prefIdx} variant="outlined" sx={{ p: 2, mb: 1 }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                    <TextField
                      label="Weight"
                      type="number"
                      size="small"
                      value={pref.weight}
                      onChange={(e: { target: { value: string; }; }) => {
                        const newPreferred = [...nodeAffinityPreferred];
                        newPreferred[prefIdx].weight = parseInt(e.target.value) || 1;
                        setNodeAffinityPreferred(newPreferred);
                      }}
                      inputProps={{ min: 1, max: 100 }}
                      sx={{ width: 100 }}
                    />
                    <IconButton
                      size="small"
                      onClick={() => setNodeAffinityPreferred(nodeAffinityPreferred.filter((_, i) => i !== prefIdx))}
                    >
                      <Icon icon="mdi:delete" />
                    </IconButton>
                  </Box>
                  {(pref.preference?.matchExpressions || []).map((expr, exprIdx) => (
                    <Box key={exprIdx} sx={{ display: 'flex', gap: 1, alignItems: 'center', mb: 1 }}>
                      <Autocomplete
                        freeSolo
                        options={nodeLabels}
                        value={expr.key}
                        onChange={(_: any, newValue: string) => {
                          const newPreferred = [...nodeAffinityPreferred];
                          newPreferred[prefIdx].preference.matchExpressions![exprIdx].key = newValue || '';
                          setNodeAffinityPreferred(newPreferred);
                        }}
                        onInputChange={(_: any, newValue: string) => {
                          const newPreferred = [...nodeAffinityPreferred];
                          newPreferred[prefIdx].preference.matchExpressions![exprIdx].key = newValue;
                          setNodeAffinityPreferred(newPreferred);
                        }}
                        renderInput={(params: any) => (
                          <TextField {...params} label="Key" size="small" sx={{ minWidth: 400 }} />
                        )}
                      />
                      <FormControl size="small" sx={{ minWidth: 100 }}>
                        <InputLabel>Operator</InputLabel>
                        <Select
                          value={expr.operator}
                          label="Operator"
                          onChange={(e: { target: { value: string; }; }) => {
                            const newPreferred = [...nodeAffinityPreferred];
                            newPreferred[prefIdx].preference.matchExpressions![exprIdx].operator = e.target.value;
                            setNodeAffinityPreferred(newPreferred);
                          }}
                        >
                          <MenuItem value="In">In</MenuItem>
                          <MenuItem value="NotIn">NotIn</MenuItem>
                          <MenuItem value="Exists">Exists</MenuItem>
                          <MenuItem value="DoesNotExist">DoesNotExist</MenuItem>
                        </Select>
                      </FormControl>
                      {!['Exists', 'DoesNotExist'].includes(expr.operator) && (
                        <TextField
                          label="Values (comma-separated)"
                          size="small"
                          value={expr.values?.join(', ') || ''}
                          onChange={(e: { target: { value: string; }; }) => {
                            const newPreferred = [...nodeAffinityPreferred];
                            newPreferred[prefIdx].preference.matchExpressions![exprIdx].values = e.target.value.split(',').map(v => v.trim()).filter(v => v);
                            setNodeAffinityPreferred(newPreferred);
                          }}
                          sx={{ minWidth: 300 }}
                        />
                      )}
                      <IconButton
                        size="small"
                        onClick={() => {
                          const newPreferred = [...nodeAffinityPreferred];
                          newPreferred[prefIdx].preference.matchExpressions = newPreferred[prefIdx].preference.matchExpressions!.filter((_, i) => i !== exprIdx);
                          setNodeAffinityPreferred(newPreferred);
                        }}
                      >
                        <Icon icon="mdi:close" />
                      </IconButton>
                    </Box>
                  ))}
                  <Button
                    size="small"
                    startIcon={<Icon icon="mdi:plus" />}
                    onClick={() => {
                      const newPreferred = [...nodeAffinityPreferred];
                      if (!newPreferred[prefIdx].preference.matchExpressions) {
                        newPreferred[prefIdx].preference.matchExpressions = [];
                      }
                      newPreferred[prefIdx].preference.matchExpressions!.push({ key: '', operator: 'In', values: [] });
                      setNodeAffinityPreferred(newPreferred);
                    }}
                  >
                    Add Expression
                  </Button>
                </Paper>
              ))}
              <Button
                variant="outlined"
                size="small"
                startIcon={<Icon icon="mdi:plus" />}
                onClick={() => setNodeAffinityPreferred([...nodeAffinityPreferred, { weight: 1, preference: { matchExpressions: [{ key: '', operator: 'In', values: [] }] } }])}
              >
                Add Preferred Term
              </Button>
            </Box>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setNodeAffinityDialogOpen(false)} disabled={loading}>Cancel</Button>
          <Button onClick={handleSaveNodeAffinity} variant="contained" disabled={loading}>
            {loading ? 'Saving...' : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
