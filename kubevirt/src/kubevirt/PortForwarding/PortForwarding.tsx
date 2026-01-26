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
  Tooltip,
  Typography,
} from "@mui/material";
import { Icon } from '@iconify/react';
import { useSnackbar } from "notistack";
import { SetStateAction, useEffect, useMemo, useState} from 'react';
import {useTranslation} from 'react-i18next';
import VirtualMachine from '../VirtualMachines/VirtualMachine';
import VirtualMachineInstance from '../VirtualMachineInstance/VirtualMachineInstance';

interface PortForward {
  serviceName: string;
  namespace: string;
  vmName: string;
  port: number;
  targetPort: number;
  protocol: string;
  type: string;
  nodePort?: number;
  loadBalancerIP?: string;
}

// Common port presets
const PORT_PRESETS = [
  {name: 'SSH', port: 22, protocol: 'TCP'},
  {name: 'RDP', port: 3389, protocol: 'TCP'},
  {name: 'HTTP', port: 80, protocol: 'TCP'},
  {name: 'HTTPS', port: 443, protocol: 'TCP'},
  {name: 'VNC', port: 5900, protocol: 'TCP'},
  {name: 'MySQL', port: 3306, protocol: 'TCP'},
  {name: 'PostgreSQL', port: 5432, protocol: 'TCP'},
  {name: 'Redis', port: 6379, protocol: 'TCP'},
];

export default function PortForwarding() {
  const {t} = useTranslation('glossary');
  const {enqueueSnackbar} = useSnackbar();
  const [services, setServices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; service: any }>({open: false, service: null});

  // Form state
  const [selectedVM, setSelectedVM] = useState<string>('');
  const [selectedNamespace, setSelectedNamespace] = useState<string>('');
  const [portName, setPortName] = useState<string>('');
  const [targetPort, setTargetPort] = useState<number>(22);
  const [serviceType, setServiceType] = useState<string>('LoadBalancer');
  const [protocol, setProtocol] = useState<string>('TCP');

  // Fetch VMs and VMIs
  const {items: vms} = VirtualMachine.useList({});
  const {items: vmis} = VirtualMachineInstance.useList({});

  // Get unique namespaces
  const namespaces = useMemo(() => {
    const nsSet = new Set<string>();
    vms?.forEach(vm => nsSet.add(vm.getNamespace()));
    return Array.from(nsSet).sort();
  }, [vms]);

  // Fetch existing services
  useEffect(() => {
    const fetchServices = async () => {
      try {
        const response = await ApiProxy.request('/api/v1/services') as { items: any[] };
        // Filter services that belong to VMs (have kubevirt labels)
        const vmServices = response.items?.filter(svc =>
            svc.spec?.selector?.['vm.kubevirt.io/name'] ||
            svc.metadata?.labels?.['kubevirt.io/vm']
        ) || [];
        setServices(vmServices);
        setLoading(false);
      } catch (error) {
        console.error('Failed to fetch services:', error);
        setLoading(false);
      }
    };

    fetchServices();
    const interval = setInterval(fetchServices, 10000);
    return () => clearInterval(interval);
  }, []);

  // Get running VMs in selected namespace
  const runningVMs = useMemo(() => {
    if (!vms || !selectedNamespace) return [];
    return vms.filter(
        vm => vm.getNamespace() === selectedNamespace && vm.getStatus() === 'Running'
    );
  }, [vms, selectedNamespace]);

  // Build port forward list
  const portForwards = useMemo(() => {
    const forwards: PortForward[] = [];

    services.forEach(svc => {
      const vmName = svc.spec?.selector?.['vm.kubevirt.io/name'] ||
          svc.metadata?.labels?.['kubevirt.io/vm'] || 'Unknown';

      svc.spec?.ports?.forEach((port: any) => {
        forwards.push({
          serviceName: svc.metadata.name,
          namespace: svc.metadata.namespace,
          vmName,
          port: port.port,
          targetPort: port.targetPort,
          protocol: port.protocol || 'TCP',
          type: svc.spec.type,
          nodePort: port.nodePort,
          loadBalancerIP: svc.status?.loadBalancer?.ingress?.[0]?.ip,
        });
      });
    });

    return forwards;
  }, [services]);

  // Create port forward (Service)
  const handleCreatePortForward = async () => {
    if (!selectedVM || !selectedNamespace || !portName || !targetPort) {
      enqueueSnackbar('Please fill all required fields', {variant: 'warning'});
      return;
    }

    const serviceName = `${selectedVM}-${portName.toLowerCase()}-${targetPort}`;

    const service = {
      apiVersion: 'v1',
      kind: 'Service',
      metadata: {
        name: serviceName,
        namespace: selectedNamespace,
        labels: {
          'kubevirt.io/vm': selectedVM,
          'app': `vm-${selectedVM}`,
        },
      },
      spec: {
        type: serviceType,
        selector: {
          'vm.kubevirt.io/name': selectedVM,
        },
        ports: [
          {
            name: portName.toLowerCase(),
            protocol: protocol,
            port: targetPort,
            targetPort: targetPort,
          },
        ],
      },
    };

    try {
      await ApiProxy.request(`/api/v1/namespaces/${selectedNamespace}/services`, {
        method: 'POST',
        body: JSON.stringify(service),
        headers: {'Content-Type': 'application/json'},
      });

      enqueueSnackbar('Port forward created successfully', {variant: 'success'});
      setDialogOpen(false);
      resetForm();

      // Refresh services
      const response = await ApiProxy.request('/api/v1/services') as { items: any[] };
      const vmServices = response.items?.filter(svc =>
          svc.spec?.selector?.['vm.kubevirt.io/name'] ||
          svc.metadata?.labels?.['kubevirt.io/vm']
      ) || [];
      setServices(vmServices);
    } catch (error: any) {
      enqueueSnackbar(`Failed to create port forward: ${error.message}`, {variant: 'error'});
    }
  };

  // Delete port forward
  const handleDeletePortForward = async () => {
    if (!deleteDialog.service) return;

    const {name, namespace} = deleteDialog.service.metadata;

    try {
      await ApiProxy.request(`/api/v1/namespaces/${namespace}/services/${name}`, {
        method: 'DELETE',
      });

      enqueueSnackbar('Port forward deleted successfully', {variant: 'success'});
      setDeleteDialog({open: false, service: null});

      // Refresh services
      const response = await ApiProxy.request('/api/v1/services') as { items: any[] };
      const vmServices = response.items?.filter(svc =>
          svc.spec?.selector?.['vm.kubevirt.io/name'] ||
          svc.metadata?.labels?.['kubevirt.io/vm']
      ) || [];
      setServices(vmServices);
    } catch (error: any) {
      enqueueSnackbar(`Failed to delete port forward: ${error.message}`, {variant: 'error'});
    }
  };

  const resetForm = () => {
    setSelectedNamespace('');
    setSelectedVM('');
    setPortName('');
    setTargetPort(22);
    setServiceType('LoadBalancer');
    setProtocol('TCP');
  };

  // Generate connection command
  const getConnectionCommand = (pf: PortForward): string => {
    const host = pf.loadBalancerIP || '<node-ip>';
    const port = pf.nodePort || pf.port;

    if (pf.targetPort === 22) {
      return `ssh user@${host} -p ${port}`;
    } else if (pf.targetPort === 3389) {
      return `xfreerdp /v:${host}:${port}`;
    } else if (pf.targetPort === 5900) {
      return `vncviewer ${host}:${port}`;
    }
    return `${host}:${port}`;
  };

  if (loading) {
    return (
        <Box sx={{p: 3, display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 400}}>
          <CircularProgress/>
        </Box>
    );
  }

  return (
      <Box sx={{p: 3}}>
        <Box sx={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3}}>
          <Typography variant="h4">Port Forwarding</Typography>
          <Button
              variant="contained"
              startIcon={<Icon icon="mdi:plus"/>}
              onClick={() => setDialogOpen(true)}
          >
            Create Port Forward
          </Button>
        </Box>

        <SectionBox title={t('Active Port Forwards')}>
          {portForwards.length === 0 ? (
              <Paper variant="outlined" sx={{p: 3, textAlign: 'center'}}>
                <Icon icon="mdi:lan-disconnect" width={48} color="#9e9e9e"/>
                <Typography variant="body1" color="text.secondary" sx={{mt: 1}}>
                  No port forwards configured
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Create a port forward to expose VM services
                </Typography>
              </Paper>
          ) : (
              <TableContainer component={Paper} variant="outlined">
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableCell>VM</TableCell>
                      <TableCell>Service</TableCell>
                      <TableCell>Type</TableCell>
                      <TableCell>Port</TableCell>
                      <TableCell>Target Port</TableCell>
                      <TableCell>Node Port</TableCell>
                      <TableCell>Connection</TableCell>
                      <TableCell>Actions</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {portForwards.map((pf, idx) => (
                        <TableRow key={idx}>
                          <TableCell>
                            <Link
                                routeName="virtualmachine"
                                params={{name: pf.vmName, namespace: pf.namespace}}
                            >
                              {pf.vmName}
                            </Link>
                          </TableCell>
                          <TableCell>{pf.serviceName}</TableCell>
                          <TableCell>
                            <Chip
                                label={pf.type}
                                size="small"
                                color={pf.type === 'LoadBalancer' ? 'success' : 'primary'}
                                variant="outlined"
                            />
                          </TableCell>
                          <TableCell>{pf.port}</TableCell>
                          <TableCell>{pf.targetPort}</TableCell>
                          <TableCell>{pf.nodePort || '-'}</TableCell>
                          <TableCell>
                            <Tooltip title="Click to copy">
                              <code
                                  style={{
                                    fontSize: '0.8em',
                                    cursor: 'pointer',
                                    background: '#f5f5f5',
                                    padding: '2px 6px',
                                    borderRadius: 4,
                                  }}
                                  onClick={() => {
                                    navigator.clipboard.writeText(getConnectionCommand(pf));
                                    enqueueSnackbar('Copied to clipboard', {variant: 'success'});
                                  }}
                              >
                                {getConnectionCommand(pf)}
                              </code>
                            </Tooltip>
                          </TableCell>
                          <TableCell>
                            <IconButton
                                size="small"
                                color="error"
                                onClick={() => setDeleteDialog({
                                  open: true,
                                  service: services.find(s => s.metadata.name === pf.serviceName),
                                })}
                            >
                              <Icon icon="mdi:delete"/>
                            </IconButton>
                          </TableCell>
                        </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
          )}
        </SectionBox>

        <SectionBox title={t('Quick Reference')}>
          <Grid container spacing={2}>
            {PORT_PRESETS.map(preset => (
                <Grid item xs={6} sm={4} md={3} key={preset.name}>
                  <Paper variant="outlined" sx={{p: 2, textAlign: 'center'}}>
                    <Typography variant="subtitle2">{preset.name}</Typography>
                    <Typography variant="h5" color="primary">
                      {preset.port}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {preset.protocol}
                    </Typography>
                  </Paper>
                </Grid>
            ))}
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
          <DialogTitle>Create Port Forward</DialogTitle>
          <DialogContent>
            <Box sx={{display: 'flex', flexDirection: 'column', gap: 2, mt: 1}}>
              <FormControl fullWidth>
                <InputLabel>Namespace</InputLabel>
                <Select
                    value={selectedNamespace}
                    label="Namespace"
                    onChange={(e: { target: { value: SetStateAction<string>; }; }) => {
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
                onChange={(e: { target: { value: SetStateAction<string>; }; }) => setSelectedVM(e.target.value)}
                disabled={!selectedNamespace}
              >
                {runningVMs.map(vm => (
                  <MenuItem key={vm.getName()} value={vm.getName()}>
                    {vm.getName()} ({vm.getStatus()})
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              <Typography variant="caption" color="text.secondary" sx={{ width: '100%' }}>
                Quick presets:
              </Typography>
              {PORT_PRESETS.slice(0, 5).map(preset => (
                <Chip
                  key={preset.name}
                  label={`${preset.name} (${preset.port})`}
                  size="small"
                  onClick={() => {
                    setPortName(preset.name);
                    setTargetPort(preset.port);
                    setProtocol(preset.protocol);
                  }}
                  sx={{ cursor: 'pointer' }}
                />
              ))}
            </Box>

            <TextField
              label="Port Name"
              value={portName}
              onChange={(e: { target: { value: SetStateAction<string>; }; }) => setPortName(e.target.value)}
              placeholder="e.g., ssh, http, custom"
              fullWidth
            />

            <TextField
              label="Target Port"
              type="number"
              value={targetPort}
              onChange={(e: { target: { value: string; }; }) => setTargetPort(parseInt(e.target.value) || 0)}
              fullWidth
            />

            <FormControl fullWidth>
              <InputLabel>Service Type</InputLabel>
              <Select
                value={serviceType}
                label="Service Type"
                onChange={(e: { target: { value: SetStateAction<string>; }; }) => setServiceType(e.target.value)}
              >
                <MenuItem value="LoadBalancer">LoadBalancer (Recommended)</MenuItem>
                <MenuItem value="NodePort">NodePort</MenuItem>
                <MenuItem value="ClusterIP">ClusterIP (internal only)</MenuItem>
              </Select>
            </FormControl>

            <FormControl fullWidth>
              <InputLabel>Protocol</InputLabel>
              <Select
                value={protocol}
                label="Protocol"
                onChange={(e: { target: { value: SetStateAction<string>; }; }) => setProtocol(e.target.value)}
              >
                <MenuItem value="TCP">TCP</MenuItem>
                <MenuItem value="UDP">UDP</MenuItem>
              </Select>
            </FormControl>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setDialogOpen(false); resetForm(); }}>Cancel</Button>
          <Button onClick={handleCreatePortForward} variant="contained">Create</Button>
        </DialogActions>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={deleteDialog.open}
        onClose={() => setDeleteDialog({ open: false, service: null })}
        maxWidth={false}
        PaperProps={{
          sx: {
            width: '100%',
            maxWidth: { xs: '95%', sm: 400, md: 450 },
            m: { xs: 1, sm: 2 },
          }
        }}
      >
        <DialogTitle>Delete Port Forward</DialogTitle>
        <DialogContent>
          <Typography>
            Are you sure you want to delete the port forward "{deleteDialog.service?.metadata?.name}"?
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialog({ open: false, service: null })}>Cancel</Button>
          <Button onClick={handleDeletePortForward} color="error" variant="contained">Delete</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
