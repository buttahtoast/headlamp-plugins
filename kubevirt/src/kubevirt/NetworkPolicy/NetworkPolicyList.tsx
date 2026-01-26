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
  DialogTitle,
  FormControl,
  Grid,
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
  Typography,
} from '@mui/material';
import { Icon } from '@iconify/react';
import { useSnackbar } from 'notistack';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import VirtualMachine from '../VirtualMachines/VirtualMachine';

interface NetworkPolicy {
  metadata: {
    name: string;
    namespace: string;
    creationTimestamp: string;
  };
  spec: {
    podSelector: {
      matchLabels?: Record<string, string>;
    };
    policyTypes?: string[];
    ingress?: any[];
    egress?: any[];
  };
}

// Quick policy templates
const POLICY_TEMPLATES = [
  {
    name: 'Isolate VM',
    description: 'Block all traffic to/from this VM',
    icon: 'mdi:shield-lock',
    color: 'error',
  },
  {
    name: 'Allow SSH Only',
    description: 'Allow only SSH (port 22) ingress',
    icon: 'mdi:console',
    color: 'warning',
  },
  {
    name: 'Allow HTTP/HTTPS',
    description: 'Allow HTTP (80) and HTTPS (443) ingress',
    icon: 'mdi:web',
    color: 'success',
  },
  {
    name: 'Allow All Ingress',
    description: 'Allow all incoming traffic',
    icon: 'mdi:arrow-down-bold',
    color: 'info',
  },
];

export default function NetworkPolicyList() {
  const { t } = useTranslation('glossary');
  const { enqueueSnackbar } = useSnackbar();
  const [policies, setPolicies] = useState<NetworkPolicy[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; policy: NetworkPolicy | null }>({
    open: false,
    policy: null,
  });

  // Form state
  const [selectedVM, setSelectedVM] = useState<string>('');
  const [selectedNamespace, setSelectedNamespace] = useState<string>('');
  const [selectedTemplate, setSelectedTemplate] = useState<string>('');
  const [customPolicyName, setCustomPolicyName] = useState<string>('');

  // Fetch VMs
  const { items: vms } = VirtualMachine.useList({});

  // Get unique namespaces
  const namespaces = useMemo(() => {
    const nsSet = new Set<string>();
    vms?.forEach(vm => nsSet.add(vm.getNamespace()));
    return Array.from(nsSet).sort();
  }, [vms]);

  // Get VMs in selected namespace
  const filteredVMs = useMemo(() => {
    if (!vms || !selectedNamespace) return [];
    return vms.filter(vm => vm.getNamespace() === selectedNamespace);
  }, [vms, selectedNamespace]);

  // Fetch network policies
  useEffect(() => {
    const fetchPolicies = async () => {
      try {
        const response = await ApiProxy.request('/apis/networking.k8s.io/v1/networkpolicies') as { items: NetworkPolicy[] };
        setPolicies(response.items || []);
        setLoading(false);
      } catch (error) {
        console.error('Failed to fetch network policies:', error);
        setLoading(false);
      }
    };

    fetchPolicies();
    const interval = setInterval(fetchPolicies, 10000);
    return () => clearInterval(interval);
  }, []);

  // Find policies affecting VMs
  const vmPolicies = useMemo(() => {
    const vmPolicyMap: Map<string, NetworkPolicy[]> = new Map();

    policies.forEach(policy => {
      const selector = policy.spec?.podSelector?.matchLabels || {};
      const vmName = selector['vm.kubevirt.io/name'];

      if (vmName) {
        const key = `${policy.metadata.namespace}/${vmName}`;
        if (!vmPolicyMap.has(key)) {
          vmPolicyMap.set(key, []);
        }
        vmPolicyMap.get(key)!.push(policy);
      }
    });

    return vmPolicyMap;
  }, [policies]);

  // Create policy from template
  const handleCreatePolicy = async () => {
    if (!selectedVM || !selectedNamespace || !selectedTemplate) {
      enqueueSnackbar('Please select a VM and policy template', { variant: 'warning' });
      return;
    }

    const policyName = customPolicyName || `${selectedVM}-${selectedTemplate.toLowerCase().replace(/\s+/g, '-')}`;
    let policySpec: any = {
      podSelector: {
        matchLabels: {
          'vm.kubevirt.io/name': selectedVM,
        },
      },
      policyTypes: ['Ingress', 'Egress'],
    };

    switch (selectedTemplate) {
      case 'Isolate VM':
        // Empty ingress/egress = deny all
        policySpec.ingress = [];
        policySpec.egress = [];
        break;

      case 'Allow SSH Only':
        policySpec.ingress = [
          {
            ports: [{ protocol: 'TCP', port: 22 }],
          },
        ];
        policySpec.policyTypes = ['Ingress'];
        break;

      case 'Allow HTTP/HTTPS':
        policySpec.ingress = [
          {
            ports: [
              { protocol: 'TCP', port: 80 },
              { protocol: 'TCP', port: 443 },
            ],
          },
        ];
        policySpec.policyTypes = ['Ingress'];
        break;

      case 'Allow All Ingress':
        policySpec.ingress = [{}]; // Empty rule = allow all
        policySpec.policyTypes = ['Ingress'];
        break;
    }

    const policy = {
      apiVersion: 'networking.k8s.io/v1',
      kind: 'NetworkPolicy',
      metadata: {
        name: policyName,
        namespace: selectedNamespace,
        labels: {
          'kubevirt.io/vm': selectedVM,
        },
      },
      spec: policySpec,
    };

    try {
      await ApiProxy.request(
        `/apis/networking.k8s.io/v1/namespaces/${selectedNamespace}/networkpolicies`,
        {
          method: 'POST',
          body: JSON.stringify(policy),
          headers: { 'Content-Type': 'application/json' },
        }
      );

      enqueueSnackbar('Network policy created successfully', { variant: 'success' });
      setDialogOpen(false);
      resetForm();

      // Refresh policies
      const response = await ApiProxy.request('/apis/networking.k8s.io/v1/networkpolicies') as { items: NetworkPolicy[] };
      setPolicies(response.items || []);
    } catch (error: any) {
      enqueueSnackbar(`Failed to create policy: ${error.message}`, { variant: 'error' });
    }
  };

  // Delete policy
  const handleDeletePolicy = async () => {
    if (!deleteDialog.policy) return;

    const { name, namespace } = deleteDialog.policy.metadata;

    try {
      await ApiProxy.request(
        `/apis/networking.k8s.io/v1/namespaces/${namespace}/networkpolicies/${name}`,
        { method: 'DELETE' }
      );

      enqueueSnackbar('Network policy deleted successfully', { variant: 'success' });
      setDeleteDialog({ open: false, policy: null });

      // Refresh policies
      const response = await ApiProxy.request('/apis/networking.k8s.io/v1/networkpolicies') as { items: NetworkPolicy[] };
      setPolicies(response.items || []);
    } catch (error: any) {
      enqueueSnackbar(`Failed to delete policy: ${error.message}`, { variant: 'error' });
    }
  };

  const resetForm = () => {
    setSelectedVM('');
    setSelectedTemplate('');
    setCustomPolicyName('');
  };

  // Get policy type description
  const getPolicyDescription = (policy: NetworkPolicy): string => {
    const types = policy.spec?.policyTypes || [];
    const hasIngress = types.includes('Ingress');
    const hasEgress = types.includes('Egress');

    if (hasIngress && hasEgress) {
      const ingressRules = policy.spec?.ingress?.length || 0;
      const egressRules = policy.spec?.egress?.length || 0;
      if (ingressRules === 0 && egressRules === 0) return 'Deny All';
      return `${ingressRules} ingress, ${egressRules} egress rules`;
    } else if (hasIngress) {
      const rules = policy.spec?.ingress?.length || 0;
      if (rules === 0) return 'Deny All Ingress';
      return `${rules} ingress rule(s)`;
    } else if (hasEgress) {
      const rules = policy.spec?.egress?.length || 0;
      if (rules === 0) return 'Deny All Egress';
      return `${rules} egress rule(s)`;
    }
    return 'No rules defined';
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
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4">Network Policies</Typography>
        <Button
          variant="contained"
          startIcon={<Icon icon="mdi:shield-plus" />}
          onClick={() => setDialogOpen(true)}
        >
          Create Policy
        </Button>
      </Box>

      <SectionBox title={t('Policy Templates')}>
        <Grid container spacing={2}>
          {POLICY_TEMPLATES.map(template => (
            <Grid item xs={12} sm={6} md={3} key={template.name}>
              <Card
                variant="outlined"
                sx={{
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  '&:hover': {
                    boxShadow: 2,
                    transform: 'translateY(-2px)',
                  },
                }}
                onClick={() => {
                  setSelectedTemplate(template.name);
                  setDialogOpen(true);
                }}
              >
                <CardContent sx={{ textAlign: 'center' }}>
                  <Icon
                    icon={template.icon}
                    width={36}
                    color={
                      template.color === 'error' ? '#d32f2f' :
                      template.color === 'warning' ? '#ed6c02' :
                      template.color === 'success' ? '#2e7d32' : '#0288d1'
                    }
                  />
                  <Typography variant="subtitle1" fontWeight="bold" sx={{ mt: 1 }}>
                    {template.name}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {template.description}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>
      </SectionBox>

      <SectionBox title={t('Active Policies')}>
        {policies.length === 0 ? (
          <Paper variant="outlined" sx={{ p: 3, textAlign: 'center' }}>
            <Icon icon="mdi:shield-off" width={48} color="#9e9e9e" />
            <Typography variant="body1" color="text.secondary" sx={{ mt: 1 }}>
              No network policies found
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Create a policy to control VM network traffic
            </Typography>
          </Paper>
        ) : (
          <TableContainer component={Paper} variant="outlined">
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Name</TableCell>
                  <TableCell>Namespace</TableCell>
                  <TableCell>Target VM</TableCell>
                  <TableCell>Policy Types</TableCell>
                  <TableCell>Description</TableCell>
                  <TableCell>Created</TableCell>
                  <TableCell>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {policies.map(policy => {
                  const vmName = policy.spec?.podSelector?.matchLabels?.['vm.kubevirt.io/name'];
                  return (
                    <TableRow key={`${policy.metadata.namespace}/${policy.metadata.name}`}>
                      <TableCell>{policy.metadata.name}</TableCell>
                      <TableCell>{policy.metadata.namespace}</TableCell>
                      <TableCell>
                        {vmName ? (
                          <Link
                            routeName="virtualmachine"
                            params={{ name: vmName, namespace: policy.metadata.namespace }}
                          >
                            {vmName}
                          </Link>
                        ) : (
                          <Chip label="All Pods" size="small" variant="outlined" />
                        )}
                      </TableCell>
                      <TableCell>
                        <Box sx={{ display: 'flex', gap: 0.5 }}>
                          {policy.spec?.policyTypes?.map(type => (
                            <Chip
                              key={type}
                              label={type}
                              size="small"
                              color={type === 'Ingress' ? 'primary' : 'secondary'}
                              variant="outlined"
                            />
                          ))}
                        </Box>
                      </TableCell>
                      <TableCell>{getPolicyDescription(policy)}</TableCell>
                      <TableCell>
                        {new Date(policy.metadata.creationTimestamp).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        <IconButton
                          size="small"
                          color="error"
                          onClick={() => setDeleteDialog({ open: true, policy })}
                        >
                          <Icon icon="mdi:delete" />
                        </IconButton>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </SectionBox>

      <SectionBox title={t('VMs with Network Policies')}>
        <Grid container spacing={2}>
          {vms?.filter(vm => vmPolicies.has(`${vm.getNamespace()}/${vm.getName()}`)).map(vm => {
            const vmKey = `${vm.getNamespace()}/${vm.getName()}`;
            const vmPoliciesList = vmPolicies.get(vmKey) || [];
            return (
              <Grid item xs={12} sm={6} md={4} key={vmKey}>
                <Paper variant="outlined" sx={{ p: 2 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                    <Icon icon="mdi:shield-check" color="#2e7d32" />
                    <Link
                      routeName="virtualmachine"
                      params={{ name: vm.getName(), namespace: vm.getNamespace() }}
                    >
                      <Typography variant="subtitle2">{vm.getName()}</Typography>
                    </Link>
                  </Box>
                  <Typography variant="caption" color="text.secondary" display="block">
                    {vm.getNamespace()}
                  </Typography>
                  <Box sx={{ display: 'flex', gap: 0.5, mt: 1, flexWrap: 'wrap' }}>
                    {vmPoliciesList.map(p => (
                      <Chip
                        key={p.metadata.name}
                        label={p.metadata.name}
                        size="small"
                        variant="outlined"
                        color="primary"
                      />
                    ))}
                  </Box>
                </Paper>
              </Grid>
            );
          })}
        </Grid>
      </SectionBox>

      {/* Create Dialog */}
      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        maxWidth={false}
        PaperProps={{
          sx: {
            width: '100%',
            maxWidth: { xs: '95%', sm: 500, md: 600 },
            m: { xs: 1, sm: 2 },
          }
        }}
      >
        <DialogTitle>Create Network Policy</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
            <FormControl fullWidth>
              <InputLabel>Namespace</InputLabel>
              <Select
                value={selectedNamespace}
                label="Namespace"
                onChange={(e) => {
                  setSelectedNamespace(e.target.value);
                  setSelectedVM('');
                }}
              >
                {namespaces.map(ns => (
                  <MenuItem key={ns} value={ns}>{ns}</MenuItem>
                ))}
              </Select>
            </FormControl>

            <FormControl fullWidth>
              <InputLabel>Virtual Machine</InputLabel>
              <Select
                value={selectedVM}
                label="Virtual Machine"
                onChange={(e) => setSelectedVM(e.target.value)}
                disabled={!selectedNamespace}
              >
                {filteredVMs.map(vm => (
                  <MenuItem key={vm.getName()} value={vm.getName()}>
                    {vm.getName()} ({vm.getStatus()})
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <FormControl fullWidth>
              <InputLabel>Policy Template</InputLabel>
              <Select
                value={selectedTemplate}
                label="Policy Template"
                onChange={(e) => setSelectedTemplate(e.target.value)}
              >
                {POLICY_TEMPLATES.map(template => (
                  <MenuItem key={template.name} value={template.name}>
                    {template.name} - {template.description}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <TextField
              label="Custom Policy Name (optional)"
              value={customPolicyName}
              onChange={(e) => setCustomPolicyName(e.target.value)}
              placeholder={selectedVM && selectedTemplate ?
                `${selectedVM}-${selectedTemplate.toLowerCase().replace(/\s+/g, '-')}` :
                'Auto-generated'
              }
              fullWidth
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setDialogOpen(false); resetForm(); }}>Cancel</Button>
          <Button onClick={handleCreatePolicy} variant="contained">Create</Button>
        </DialogActions>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={deleteDialog.open}
        onClose={() => setDeleteDialog({ open: false, policy: null })}
        maxWidth={false}
        PaperProps={{
          sx: {
            width: '100%',
            maxWidth: { xs: '95%', sm: 400, md: 450 },
            m: { xs: 1, sm: 2 },
          }
        }}
      >
        <DialogTitle>Delete Network Policy</DialogTitle>
        <DialogContent>
          <Typography>
            Are you sure you want to delete the policy "{deleteDialog.policy?.metadata?.name}"?
            This may affect network connectivity to the associated VM.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialog({ open: false, policy: null })}>Cancel</Button>
          <Button onClick={handleDeletePolicy} color="error" variant="contained">Delete</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
