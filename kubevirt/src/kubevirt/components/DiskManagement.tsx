import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { Link, SectionBox } from '@kinvolk/headlamp-plugin/lib/components/common';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  Grid,
  IconButton,
  InputAdornment,
  InputLabel,
  LinearProgress,
  MenuItem,
  Paper,
  Radio,
  RadioGroup,
  Select,
  Switch,
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
import { SetStateAction, useEffect, useMemo, useState} from 'react';
import {useTranslation} from 'react-i18next';
import DataVolume from '../DataVolume/DataVolume';
import {formatBytes, parseK8sSize} from '../utils/kubeVirtCheck';
import VirtualMachine from '../VirtualMachines/VirtualMachine';
import VirtualMachineInstance from '../VirtualMachineInstance/VirtualMachineInstance';

interface StorageClass {
  metadata: {
    name: string;
    annotations?: Record<string, string>;
  };
  provisioner: string;
  volumeBindingMode: string;
  reclaimPolicy: string;
  allowVolumeExpansion?: boolean;
  parameters?: Record<string, string>;
}

interface DiskManagementProps {
  // Either VM or VMI must be provided
  vm?: VirtualMachine;
  vmi?: VirtualMachineInstance;
  namespace: string;
  isRunning: boolean;
  // Filesystem info from guest agent (only available for VMI)
  filesystemInfo?: any;
  // Whether to show storage recommendations (default true for VM, false for VMI)
  showRecommendations?: boolean;
}

// Parse size string to bytes (using shared parseK8sSize)
function parseSize(sizeStr: string): number {
  return parseK8sSize(sizeStr) || 0;
}

export default function DiskManagement({
                                         vm,
                                         vmi,
                                         namespace,
                                         isRunning,
                                         filesystemInfo,
                                         showRecommendations = true,
                                       }: DiskManagementProps) {
  const {t} = useTranslation('glossary');
  const {enqueueSnackbar} = useSnackbar();

  // Determine if we're in VM mode (can hot-plug) or VMI mode (read-only)
  const isVMMode = !!vm;
  const item = vm || vmi;

  // State
  const [storageClasses, setStorageClasses] = useState<StorageClass[]>([]);
  const [hotPlugDialogOpen, setHotPlugDialogOpen] = useState(false);
  const [ejectDialogOpen, setEjectDialogOpen] = useState(false);
  const [resizeDialogOpen, setResizeDialogOpen] = useState(false);
  const [selectedDisk, setSelectedDisk] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  // Hot-plug form state
  const [volumeName, setVolumeName] = useState('');
  const [sourceType, setSourceType] = useState<'dataVolume' | 'pvc'>('dataVolume');
  const [sourceName, setSourceName] = useState('');
  const [busType, setBusType] = useState('scsi');

  // Resize form state
  const [newSize, setNewSize] = useState('');
  const [sizeUnit, setSizeUnit] = useState('Gi');

  // Migration form state
  const [migrateDialogOpen, setMigrateDialogOpen] = useState(false);
  const [targetStorageClass, setTargetStorageClass] = useState('');
  const [cloneStrategy, setCloneStrategy] = useState<'csi-clone' | 'snapshot' | 'copy'>('csi-clone');
  const [migrationName, setMigrationName] = useState('');
  const [migrationInProgress, setMigrationInProgress] = useState(false);
  const [autoSwitchDisk, setAutoSwitchDisk] = useState(true);
  const [activeMigrations, setActiveMigrations] = useState<Record<string, {
    dvName: string;
    status: string;
    progress?: number;
    diskName: string;
    sourceDvName?: string;
    autoSwitch: boolean;
  }>>({});

  // Fetch DataVolumes
  const {items: dataVolumes} = DataVolume.useList({namespace});

  // PVCs state for looking up storage class of PVC-backed disks
  const [pvcs, setPvcs] = useState<any[]>([]);

  // Get the spec source (VM uses spec.template.spec, VMI uses spec directly)
  const getSpec = () => {
    if (vm) {
      return vm.jsonData?.spec?.template?.spec;
    }
    if (vmi) {
      return vmi.spec;
    }
    return null;
  };

  // Get available DataVolumes (not already attached) - only for VM mode
  const availableDataVolumes = useMemo(() => {
    if (!dataVolumes || !isVMMode) return [];
    const spec = getSpec();
    const attachedNames = new Set(
        spec?.volumes
            ?.filter((v: any) => v.dataVolume)
            ?.map((v: any) => v.dataVolume.name) || []
    );
    return dataVolumes.filter(dv =>
        dv.getPhase() === 'Succeeded' && !attachedNames.has(dv.getName())
    );
  }, [dataVolumes, vm, isVMMode]);

  // Fetch storage classes and PVCs
  useEffect(() => {
    const fetchStorageClasses = async () => {
      try {
        const response = await ApiProxy.request('/apis/storage.k8s.io/v1/storageclasses') as { items: StorageClass[] };
        setStorageClasses(response.items || []);
      } catch (error) {
        console.error('Failed to fetch storage classes:', error);
      }
    };
    const fetchPVCs = async () => {
      try {
        const response = await ApiProxy.request(`/api/v1/namespaces/${namespace}/persistentvolumeclaims`) as {
          items: any[]
        };
        setPvcs(response.items || []);
      } catch (error) {
        console.error('Failed to fetch PVCs:', error);
      }
    };
    fetchStorageClasses();
    fetchPVCs();

    // Refresh PVCs periodically to catch newly created ones
    const interval = setInterval(fetchPVCs, 5000);
    return () => clearInterval(interval);
  }, [namespace]);

  // Get disks from VM/VMI
  const disks = useMemo(() => {
    const spec = getSpec();
    if (!spec) return [];

    const diskList = spec.domain?.devices?.disks || [];
    const volumes = spec.volumes || [];
    const filesystems = filesystemInfo?.items || [];

    return diskList.map((disk: any) => {
      const volume = volumes.find((v: any) => v.name === disk.name);
      const isHotpluggable = volume?.dataVolume?.hotpluggable || volume?.persistentVolumeClaim?.hotpluggable;

      // Get storage info
      let storageClassName: string | null = null;
      let storageSize: string | null = null;
      let allowExpansion = false;
      let pvcName: string | null = null;

      // DataVolume-backed disk
      if (volume?.dataVolume?.name) {
        const dvName = volume.dataVolume.name;
        const dv = dataVolumes?.find(d => d.getName() === dvName);

        // First try to get storage class from DataVolume spec
        storageClassName = dv?.jsonData?.spec?.pvc?.storageClassName;
        storageSize = dv?.getStorageSize();

        // DataVolume creates a PVC with the same name - check PVC for storage class if not found in DV
        pvcName = dvName;
        if (!storageClassName) {
          const pvc = pvcs.find(p => p.metadata?.name === dvName);
          if (pvc) {
            storageClassName = pvc.spec?.storageClassName ||
                pvc.metadata?.annotations?.['volume.beta.kubernetes.io/storage-class'] ||
                pvc.metadata?.annotations?.['volume.kubernetes.io/storage-class'];
            if (!storageSize) {
              storageSize = pvc.status?.capacity?.storage || pvc.spec?.resources?.requests?.storage;
            }
          }
        }
      }

      // PVC-backed disk (direct PVC, not via DataVolume)
      if (volume?.persistentVolumeClaim?.claimName) {
        pvcName = volume.persistentVolumeClaim.claimName;
        const pvc = pvcs.find(p => p.metadata?.name === pvcName);
        if (pvc) {
          // Storage class can be in spec, annotation (old style), or determined from PV
          storageClassName = pvc.spec?.storageClassName ||
              pvc.metadata?.annotations?.['volume.beta.kubernetes.io/storage-class'] ||
              pvc.metadata?.annotations?.['volume.kubernetes.io/storage-class'];
          storageSize = pvc.status?.capacity?.storage || pvc.spec?.resources?.requests?.storage;

          // If still no storage class, try to get it from the bound PV
          if (!storageClassName && pvc.spec?.volumeName) {
            // We could fetch PV here, but for now just leave it empty
            // The storage class might be the cluster default
          }
        }
      }

      // Check storage class for expansion capability
      if (storageClassName) {
        const sc = storageClasses.find(s => s.metadata.name === storageClassName);
        allowExpansion = sc?.allowVolumeExpansion === true;
      }

      // Get filesystem info for this disk (if available from guest agent)
      let fsInfo = null;
      if (filesystems.length > 0) {
        fsInfo = filesystems.find((fs: any) =>
            fs.diskName === disk.name ||
            (disk.name === 'rootdisk' && fs.mountPoint === '/')
        );
      }

      return {
        ...disk,
        volume,
        isHotpluggable,
        storageClassName,
        storageSize,
        allowExpansion,
        pvcName,
        bootOrder: disk.bootOrder,
        filesystem: fsInfo,
      };
    });
  }, [vm, vmi, dataVolumes, storageClasses, pvcs, filesystemInfo]);

  // Get hotpluggable disks
  const hotpluggableDisks = useMemo(() => {
    return disks.filter((d: { isHotpluggable: any; }) => d.isHotpluggable);
  }, [disks]);

  // Handle hot-plug disk (VM mode only)
  const handleHotPlugDisk = async () => {
    if (!vm || !volumeName || !sourceName) {
      enqueueSnackbar('Please fill all required fields', {variant: 'warning'});
      return;
    }

    setLoading(true);
    try {
      await vm.addVolume(volumeName, sourceType === 'dataVolume' ? 'dataVolume' : 'persistentVolumeClaim', sourceName, busType);
      enqueueSnackbar(`Disk "${volumeName}" attached successfully`, {variant: 'success'});
      setHotPlugDialogOpen(false);
      resetHotPlugForm();
    } catch (error: any) {
      enqueueSnackbar(`Failed to attach disk: ${error.message}`, {variant: 'error'});
    }
    setLoading(false);
  };

  // Handle eject disk (works for both VM and VMI)
  const handleEjectDisk = async () => {
    if (!selectedDisk) return;

    setLoading(true);
    try {
      if (vm) {
        // Use VM's removeVolume method
        await vm.removeVolume(selectedDisk.name);
      } else if (vmi) {
        // Call VMI's removevolume API directly
        const request = {name: selectedDisk.name};
        await ApiProxy.request(
            `/apis/subresources.kubevirt.io/v1/namespaces/${namespace}/virtualmachineinstances/${vmi.getName()}/removevolume`,
            {
              method: 'PUT',
              body: JSON.stringify(request),
              headers: {'Content-Type': 'application/json'},
            }
        );
      } else {
        throw new Error('No VM or VMI available');
      }
      enqueueSnackbar(`Disk "${selectedDisk.name}" ejected successfully`, {variant: 'success'});
      setEjectDialogOpen(false);
      setSelectedDisk(null);
    } catch (error: any) {
      enqueueSnackbar(`Failed to eject disk: ${error.message}`, {variant: 'error'});
    }
    setLoading(false);
  };

  // Handle resize disk
  const handleResizeDisk = async () => {
    if (!selectedDisk || !newSize) return;

    const dvName = selectedDisk.volume?.dataVolume?.name;
    const pvcName = selectedDisk.volume?.persistentVolumeClaim?.claimName;

    if (!dvName && !pvcName) {
      enqueueSnackbar('Can only resize DataVolume or PVC-backed disks', {variant: 'error'});
      return;
    }

    const newSizeStr = `${newSize}${sizeUnit}`;
    const newSizeBytes = parseSize(newSizeStr);
    const currentSizeBytes = parseSize(selectedDisk.storageSize || '0');

    if (newSizeBytes <= currentSizeBytes) {
      enqueueSnackbar('New size must be larger than current size', {variant: 'warning'});
      return;
    }

    setLoading(true);
    try {
      if (dvName) {
        // Patch the DataVolume's PVC size
        await ApiProxy.request(
            `/apis/cdi.kubevirt.io/v1beta1/namespaces/${namespace}/datavolumes/${dvName}`,
            {
              method: 'PATCH',
              body: JSON.stringify([
                {
                  op: 'replace',
                  path: '/spec/pvc/resources/requests/storage',
                  value: newSizeStr,
                },
              ]),
              headers: {'Content-Type': 'application/json-patch+json'},
            }
        );
      } else if (pvcName) {
        // Patch the PVC directly
        await ApiProxy.request(
            `/api/v1/namespaces/${namespace}/persistentvolumeclaims/${pvcName}`,
            {
              method: 'PATCH',
              body: JSON.stringify([
                {
                  op: 'replace',
                  path: '/spec/resources/requests/storage',
                  value: newSizeStr,
                },
              ]),
              headers: {'Content-Type': 'application/json-patch+json'},
            }
        );
      }
      enqueueSnackbar(`Disk resize initiated to ${newSizeStr}`, {variant: 'success'});
      setResizeDialogOpen(false);
      setSelectedDisk(null);
      setNewSize('');
    } catch (error: any) {
      enqueueSnackbar(`Failed to resize disk: ${error.message}`, {variant: 'error'});
    }
    setLoading(false);
  };

  const resetHotPlugForm = () => {
    setVolumeName('');
    setSourceType('dataVolume');
    setSourceName('');
    setBusType('scsi');
  };

  const resetMigrationForm = () => {
    setTargetStorageClass('');
    setCloneStrategy('csi-clone');
    setMigrationName('');
    setAutoSwitchDisk(true);
  };

  // Handle storage migration - creates a new DataVolume by cloning from source
  const handleMigrateDisk = async () => {
    if (!selectedDisk || !targetStorageClass || !migrationName) {
      enqueueSnackbar('Please fill all required fields', { variant: 'warning' });
      return;
    }

    const sourceDvName = selectedDisk.volume?.dataVolume?.name;
    const sourcePvcName = selectedDisk.volume?.persistentVolumeClaim?.claimName || sourceDvName;

    if (!sourcePvcName) {
      enqueueSnackbar('Can only migrate DataVolume or PVC-backed disks', { variant: 'error' });
      return;
    }

    // Check if target storage class is same as source
    if (selectedDisk.storageClassName === targetStorageClass) {
      enqueueSnackbar('Target storage class is same as source', { variant: 'warning' });
      return;
    }

    setMigrationInProgress(true);
    try {
      // Create a new DataVolume that clones from the source PVC
      const newDataVolume: any = {
        apiVersion: 'cdi.kubevirt.io/v1beta1',
        kind: 'DataVolume',
        metadata: {
          name: migrationName,
          namespace: namespace,
          labels: {
            'kubevirt.io/storage-migration': 'true',
            'kubevirt.io/source-pvc': sourcePvcName,
            'kubevirt.io/vm': vm?.getName() || vmi?.getName() || '',
          },
          annotations: {
            'cdi.kubevirt.io/storage.bind.immediate.requested': 'true',
          },
        },
        spec: {
          pvc: {
            storageClassName: targetStorageClass,
            accessModes: ['ReadWriteOnce'],
            resources: {
              requests: {
                storage: selectedDisk.storageSize || '10Gi',
              },
            },
          },
          source: {},
        },
      };

      // Set clone source based on strategy
      if (cloneStrategy === 'csi-clone') {
        newDataVolume.spec.source = {
          pvc: {
            namespace: namespace,
            name: sourcePvcName,
          },
        };
        // CSI clone uses volume cloning
        newDataVolume.metadata.annotations['cdi.kubevirt.io/cloneType'] = 'csi-clone';
      } else if (cloneStrategy === 'snapshot') {
        newDataVolume.spec.source = {
          pvc: {
            namespace: namespace,
            name: sourcePvcName,
          },
        };
        // Snapshot-based clone
        newDataVolume.metadata.annotations['cdi.kubevirt.io/cloneType'] = 'snapshot';
      } else {
        // Host-assisted copy (slowest but most compatible)
        newDataVolume.spec.source = {
          pvc: {
            namespace: namespace,
            name: sourcePvcName,
          },
        };
        newDataVolume.metadata.annotations['cdi.kubevirt.io/cloneType'] = 'copy';
      }

      // Create the DataVolume
      await ApiProxy.request(`/apis/cdi.kubevirt.io/v1beta1/namespaces/${namespace}/datavolumes`, {
        method: 'POST',
        body: JSON.stringify(newDataVolume),
        headers: { 'Content-Type': 'application/json' },
      });

      // Track the migration
      setActiveMigrations(prev => ({
        ...prev,
        [selectedDisk.name]: {
          dvName: migrationName,
          status: 'CloneInProgress',
          progress: 0,
          diskName: selectedDisk.name,
          sourceDvName: sourceDvName,
          autoSwitch: autoSwitchDisk && !isRunning,
        },
      }));

      const autoSwitchMsg = autoSwitchDisk && !isRunning
        ? ' The VM will be automatically updated to use the new disk when complete.'
        : ' Once complete, you can update the VM to use the new disk.';

      enqueueSnackbar(
        `Storage migration started. New DataVolume "${migrationName}" is being created.${autoSwitchMsg}`,
        { variant: 'success' }
      );

      setMigrateDialogOpen(false);
      setSelectedDisk(null);
      resetMigrationForm();
    } catch (error: any) {
      enqueueSnackbar(`Failed to start migration: ${error.message}`, { variant: 'error' });
    }
    setMigrationInProgress(false);
  };

  // Auto-switch VM disk to new DataVolume after migration
  const switchVMDisk = async (diskName: string, newDvName: string) => {
    if (!vm) return false;

    try {
      // Get current VM spec
      const vmData = vm.jsonData;
      const volumes = vmData?.spec?.template?.spec?.volumes || [];

      // Find the volume index for this disk
      const volumeIndex = volumes.findIndex((v: any) => v.name === diskName);
      if (volumeIndex === -1) {
        console.error(`Volume ${diskName} not found in VM spec`);
        return false;
      }

      // Create patch to update the volume to use the new DataVolume
      const patch = [
        {
          op: 'replace',
          path: `/spec/template/spec/volumes/${volumeIndex}/dataVolume/name`,
          value: newDvName,
        },
      ];

      await ApiProxy.request(
        `/apis/kubevirt.io/v1/namespaces/${namespace}/virtualmachines/${vm.getName()}`,
        {
          method: 'PATCH',
          body: JSON.stringify(patch),
          headers: { 'Content-Type': 'application/json-patch+json' },
        }
      );

      return true;
    } catch (error) {
      console.error('Failed to switch VM disk:', error);
      return false;
    }
  };

  // Poll for migration status
  useEffect(() => {
    if (Object.keys(activeMigrations).length === 0) return;

    const pollMigrationStatus = async () => {
      const updatedMigrations: typeof activeMigrations = {};

      for (const [diskName, migration] of Object.entries(activeMigrations)) {
        try {
          const dv = await ApiProxy.request(
            `/apis/cdi.kubevirt.io/v1beta1/namespaces/${namespace}/datavolumes/${migration.dvName}`
          ) as any;

          const phase = dv.status?.phase || 'Unknown';
          const progress = dv.status?.progress ? parseInt(dv.status.progress.replace('%', '')) : 0;

          if (phase === 'Succeeded') {
            // Try to auto-switch if enabled
            if (migration.autoSwitch && vm && !isRunning) {
              const switched = await switchVMDisk(migration.diskName, migration.dvName);
              if (switched) {
                enqueueSnackbar(
                  `Migration complete! VM has been updated to use "${migration.dvName}". ` +
                  `You can delete the old DataVolume "${migration.sourceDvName || 'N/A'}" when ready.`,
                  { variant: 'success' }
                );
              } else {
                enqueueSnackbar(
                  `Migration complete! DataVolume "${migration.dvName}" is ready, but auto-switch failed. ` +
                  `Please manually update the VM to use the new disk.`,
                  { variant: 'warning' }
                );
              }
            } else {
              enqueueSnackbar(
                `Migration complete! DataVolume "${migration.dvName}" is ready. ` +
                `You can now update the VM to use the new disk.`,
                { variant: 'success' }
              );
            }
            // Remove from active migrations (don't add to updatedMigrations)
          } else if (phase === 'Failed') {
            enqueueSnackbar(
              `Migration failed for "${migration.dvName}". Check DataVolume status for details.`,
              { variant: 'error' }
            );
            // Remove from active migrations
          } else {
            // Still in progress
            updatedMigrations[diskName] = {
              ...migration,
              status: phase,
              progress,
            };
          }
        } catch (error) {
          console.error(`Failed to check migration status for ${migration.dvName}:`, error);
          updatedMigrations[diskName] = migration;
        }
      }

      setActiveMigrations(updatedMigrations);
    };

    const interval = setInterval(pollMigrationStatus, 5000);
    return () => clearInterval(interval);
  }, [activeMigrations, namespace, enqueueSnackbar, vm, isRunning]);

  // Check if a storage class is marked as default
  const isDefaultStorageClass = (sc: StorageClass): boolean => {
    return sc.metadata.annotations?.['storageclass.kubernetes.io/is-default-class'] === 'true' ||
           sc.metadata.annotations?.['storageclass.beta.kubernetes.io/is-default-class'] === 'true';
  };

  // Get storage class recommendation - prioritize default storage class and Ceph RBD for VMs
  const getStorageRecommendation = (sc: StorageClass): { score: number; reasons: string[]; isDefault: boolean } => {
    const reasons: string[] = [];
    let score = 0;
    const provisioner = sc.provisioner.toLowerCase();
    const params = sc.parameters || {};
    const isDefault = isDefaultStorageClass(sc);

    // Default storage class gets highest priority
    if (isDefault) {
      score += 150;
      reasons.push('Default storage class');
    }

    // Check for Ceph replication settings
    const replicaSize = params.replication_size || params.replicaSize || params['pool.replication_size'] || '';
    const hasReplication2 = replicaSize === '2' || params.pool?.includes('replicated') ||
        sc.metadata.name.toLowerCase().includes('replica') ||
        sc.metadata.name.toLowerCase().includes('2-rep');

    // Ceph RBD with 2 replication - highest priority for VMs (best balance of performance and reliability)
    if ((provisioner.includes('rbd') || (provisioner.includes('ceph') && !provisioner.includes('cephfs'))) && hasReplication2) {
      score += 120;
      reasons.push('Ceph RBD with 2x replication (Recommended for VMs)');
    }
    // Ceph RBD without specific replication - still very good
    else if (provisioner.includes('rbd') || (provisioner.includes('ceph') && !provisioner.includes('cephfs'))) {
      score += 100;
      reasons.push('High-performance Ceph RBD block storage');
    }
    // Pure Storage
    else if (provisioner.includes('pure') || provisioner.includes('purestorage')) {
      score += 95;
      reasons.push('High-performance Pure Storage');
    }
    // LVM/TopoLVM - fast local storage
    else if (provisioner.includes('lvm') || provisioner.includes('topolvm')) {
      score += 85;
      reasons.push('Fast local LVM storage');
    }
    // SAN block storage
    else if (provisioner.includes('iscsi') || provisioner.includes('fc') || provisioner.includes('fibre')) {
      score += 80;
      reasons.push('Fast SAN block storage');
    }
    // Cloud block storage
    else if (provisioner.includes('ebs') || provisioner.includes('aws')) {
      score += 75;
      reasons.push('AWS EBS block storage');
    } else if (provisioner.includes('disk') && (provisioner.includes('azure') || provisioner.includes('gce') || provisioner.includes('google'))) {
      score += 75;
      reasons.push('Cloud block storage');
    }
    // Longhorn
    else if (provisioner.includes('longhorn')) {
      score += 70;
      reasons.push('Longhorn distributed block storage');
    }
    // OpenEBS
    else if (provisioner.includes('openebs') && !provisioner.includes('nfs')) {
      score += 65;
      reasons.push('OpenEBS block storage');
    }
    // CephFS (filesystem) - moderate performance
    else if (provisioner.includes('cephfs')) {
      score += 40;
      reasons.push('CephFS shared filesystem');
    }
    // NFS - lowest performance for VM workloads
    else if (provisioner.includes('nfs')) {
      score += 10;
      reasons.push('NFS (slower for VM workloads)');
    }
    // Other provisioners
    else {
      score += 20;
      reasons.push('Compatible provisioner');
    }

    // Prefer volume expansion
    if (sc.allowVolumeExpansion) {
      score += 15;
      reasons.push('Supports volume expansion');
    }

    // Prefer Immediate binding for VMs
    if (sc.volumeBindingMode === 'Immediate') {
      score += 10;
      reasons.push('Immediate volume binding');
    }

    // Prefer Retain policy for data safety
    if (sc.reclaimPolicy === 'Retain') {
      score += 5;
      reasons.push('Retains data on delete');
    }

    return {score, reasons, isDefault};
  };

  // Sort storage classes by recommendation score
  const recommendedStorageClasses = useMemo(() => {
    return [...storageClasses]
        .map(sc => ({...sc, recommendation: getStorageRecommendation(sc)}))
        .sort((a, b) => b.recommendation.score - a.recommendation.score);
  }, [storageClasses]);

  if (!item) return null;

  return (
      <>
        <SectionBox title={t('Disk Management')}>
          <Box sx={{display: 'flex', flexDirection: 'column', gap: 3}}>
            {/* Actions - only show for VM mode */}
            {isVMMode && (
                <Box sx={{display: 'flex', gap: 2}}>
                  <Button
                      variant="contained"
                      startIcon={<Icon icon="mdi:harddisk-plus"/>}
                      onClick={() => setHotPlugDialogOpen(true)}
                      disabled={!isRunning}
                  >
                    Hot-Plug Disk
                  </Button>
                  {!isRunning && (
                      <Typography variant="caption" color="text.secondary" sx={{alignSelf: 'center'}}>
                        Hot-plug requires VM to be running
                      </Typography>
                  )}
                </Box>
            )}

            {/* Current Disks */}
            <Box>
              <Typography variant="subtitle2" gutterBottom>
                Attached Disks ({disks.length})
              </Typography>
              <TableContainer component={Paper} variant="outlined">
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{fontWeight: 'bold'}}>Name</TableCell>
                      <TableCell sx={{fontWeight: 'bold'}}>Type</TableCell>
                      <TableCell sx={{fontWeight: 'bold'}}>Bus</TableCell>
                      <TableCell sx={{fontWeight: 'bold'}}>Boot</TableCell>
                      <TableCell sx={{fontWeight: 'bold'}}>Source</TableCell>
                      <TableCell sx={{fontWeight: 'bold'}}>Size</TableCell>
                      <TableCell sx={{fontWeight: 'bold'}}>Storage Class</TableCell>
                      <TableCell sx={{fontWeight: 'bold'}}>Actions</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {disks.map((disk: any, idx: number) => (
                        <TableRow key={idx}>
                          <TableCell>
                            <Box sx={{display: 'flex', alignItems: 'center', gap: 0.5}}>
                              {disk.name}
                              {disk.isHotpluggable && (
                                  <Chip label="hotplug" size="small" color="warning" variant="outlined" sx={{ml: 1}}/>
                              )}
                            </Box>
                          </TableCell>
                          <TableCell>
                            <Chip
                                label={disk.disk ? 'disk' : disk.cdrom ? 'cdrom' : 'unknown'}
                                size="small"
                                variant="outlined"
                                color={disk.cdrom ? 'secondary' : 'primary'}
                            />
                          </TableCell>
                          <TableCell>{disk.disk?.bus || disk.cdrom?.bus || 'virtio'}</TableCell>
                          <TableCell>
                            {disk.bootOrder ? (
                                <Chip label={disk.bootOrder} size="small" color="primary" variant="outlined"/>
                            ) : (
                                <Typography variant="caption" color="text.secondary">-</Typography>
                            )}
                          </TableCell>
                          <TableCell>
                            {disk.volume?.dataVolume?.name ? (
                                <Box sx={{display: 'flex', flexDirection: 'column', gap: 0.5}}>
                                  <Link
                                      routeName="datavolume"
                                      params={{name: disk.volume.dataVolume.name, namespace}}
                                  >
                                    {disk.volume.dataVolume.name}
                                  </Link>
                                  {disk.volume.dataVolume.hotpluggable && (
                                      <Chip label="hotpluggable" size="small" variant="outlined" color="warning"/>
                                  )}
                                </Box>
                            ) : disk.volume?.persistentVolumeClaim?.claimName ? (
                                <Link
                                    routeName="persistentVolumeClaim"
                                    params={{name: disk.volume.persistentVolumeClaim.claimName, namespace}}
                                >
                                  {disk.volume.persistentVolumeClaim.claimName}
                                </Link>
                            ) : disk.volume?.containerDisk?.image ? (
                                <Tooltip title={disk.volume.containerDisk.image}>
                                  <Typography variant="body2"
                                              sx={{maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis'}}>
                                    {disk.volume.containerDisk.image}
                                  </Typography>
                                </Tooltip>
                            ) : disk.volume?.cloudInitConfigDrive ? (
                                <Box sx={{display: 'flex', flexDirection: 'column', gap: 0.5}}>
                                  <Chip label="cloud-init (ConfigDrive)" size="small" variant="outlined" color="info"/>
                                  {disk.volume.cloudInitConfigDrive.secretRef?.name && (
                                      <Box sx={{display: 'flex', alignItems: 'center', gap: 0.5}}>
                                        <Typography variant="caption" color="text.secondary">Secret:</Typography>
                                        <Link
                                            routeName="secret"
                                            params={{name: disk.volume.cloudInitConfigDrive.secretRef.name, namespace}}
                                        >
                                          {disk.volume.cloudInitConfigDrive.secretRef.name}
                                        </Link>
                                      </Box>
                                  )}
                                  {disk.volume.cloudInitConfigDrive.networkDataSecretRef?.name && (
                                      <Box sx={{display: 'flex', alignItems: 'center', gap: 0.5}}>
                                        <Typography variant="caption" color="text.secondary">Network:</Typography>
                                        <Link
                                            routeName="secret"
                                            params={{
                                              name: disk.volume.cloudInitConfigDrive.networkDataSecretRef.name,
                                              namespace
                                            }}
                                        >
                                          {disk.volume.cloudInitConfigDrive.networkDataSecretRef.name}
                                        </Link>
                                      </Box>
                                  )}
                                </Box>
                            ) : disk.volume?.cloudInitNoCloud ? (
                                <Box sx={{display: 'flex', flexDirection: 'column', gap: 0.5}}>
                                  <Chip label="cloud-init (NoCloud)" size="small" variant="outlined" color="info"/>
                                  {disk.volume.cloudInitNoCloud.secretRef?.name && (
                                      <Box sx={{display: 'flex', alignItems: 'center', gap: 0.5}}>
                                        <Typography variant="caption" color="text.secondary">Secret:</Typography>
                                        <Link
                                            routeName="secret"
                                            params={{name: disk.volume.cloudInitNoCloud.secretRef.name, namespace}}
                                        >
                                          {disk.volume.cloudInitNoCloud.secretRef.name}
                                        </Link>
                                      </Box>
                                  )}
                                  {disk.volume.cloudInitNoCloud.networkDataSecretRef?.name && (
                                      <Box sx={{display: 'flex', alignItems: 'center', gap: 0.5}}>
                                        <Typography variant="caption" color="text.secondary">Network:</Typography>
                                        <Link
                                            routeName="secret"
                                            params={{
                                              name: disk.volume.cloudInitNoCloud.networkDataSecretRef.name,
                                              namespace
                                            }}
                                        >
                                          {disk.volume.cloudInitNoCloud.networkDataSecretRef.name}
                                        </Link>
                                      </Box>
                                  )}
                                </Box>
                            ) : disk.volume?.configMap?.name ? (
                                <Box sx={{display: 'flex', alignItems: 'center', gap: 0.5}}>
                                  <Chip label="ConfigMap" size="small" variant="outlined"/>
                                  <Link
                                      routeName="configmap"
                                      params={{name: disk.volume.configMap.name, namespace}}
                                  >
                                    {disk.volume.configMap.name}
                                  </Link>
                                </Box>
                            ) : disk.volume?.secret?.secretName ? (
                                <Box sx={{display: 'flex', alignItems: 'center', gap: 0.5}}>
                                  <Chip label="Secret" size="small" variant="outlined"/>
                                  <Link
                                      routeName="secret"
                                      params={{name: disk.volume.secret.secretName, namespace}}
                                  >
                                    {disk.volume.secret.secretName}
                                  </Link>
                                </Box>
                            ) : disk.volume?.serviceAccount?.serviceAccountName ? (
                                <Box sx={{display: 'flex', alignItems: 'center', gap: 0.5}}>
                                  <Chip label="ServiceAccount" size="small" variant="outlined"/>
                                  <Link
                                      routeName="serviceaccount"
                                      params={{name: disk.volume.serviceAccount.serviceAccountName, namespace}}
                                  >
                                    {disk.volume.serviceAccount.serviceAccountName}
                                  </Link>
                                </Box>
                            ) : disk.volume?.downwardAPI ? (
                                <Chip label="DownwardAPI" size="small" variant="outlined"/>
                            ) : disk.volume?.emptyDisk ? (
                                <Chip label={`EmptyDisk (${disk.volume.emptyDisk.capacity || 'auto'})`} size="small"
                                      variant="outlined"/>
                            ) : (
                                '-'
                            )}
                          </TableCell>
                          <TableCell>{formatBytes(disk.storageSize)}</TableCell>
                          <TableCell>
                            {disk.storageClassName ? (
                                <Box sx={{display: 'flex', alignItems: 'center', gap: 0.5}}>
                                  {disk.storageClassName}
                                  {disk.allowExpansion && (
                                      <Tooltip title="Supports expansion">
                                        <Icon icon="mdi:resize" width={16} color="#2e7d32"/>
                                      </Tooltip>
                                  )}
                                </Box>
                            ) : (
                                <Typography variant="caption" color="text.secondary">-</Typography>
                            )}
                          </TableCell>
                          <TableCell>
                            <Box sx={{display: 'flex', gap: 0.5}}>
                              {(disk.volume?.dataVolume?.name || disk.volume?.persistentVolumeClaim?.claimName) && disk.allowExpansion && (
                                  <Tooltip title="Resize disk">
                                    <IconButton
                                        size="small"
                                        color="primary"
                                        onClick={() => {
                                          setSelectedDisk(disk);
                                          setNewSize('');
                                          setResizeDialogOpen(true);
                                        }}
                                    >
                                      <Icon icon="mdi:resize"/>
                                    </IconButton>
                                  </Tooltip>
                              )}
                              {(disk.volume?.dataVolume?.name || disk.volume?.persistentVolumeClaim?.claimName) && isVMMode && (
                                  <Tooltip title="Migrate to different storage class">
                                    <IconButton
                                        size="small"
                                        color="primary"
                                        onClick={() => {
                                          setSelectedDisk(disk);
                                          setMigrationName(`${disk.volume?.dataVolume?.name || disk.volume?.persistentVolumeClaim?.claimName}-migrated`);
                                          setMigrateDialogOpen(true);
                                        }}
                                    >
                                      <Icon icon="mdi:swap-horizontal-bold"/>
                                    </IconButton>
                                  </Tooltip>
                              )}
                              {activeMigrations[disk.name] && (
                                  <Tooltip title={`Migration: ${activeMigrations[disk.name].status} (${activeMigrations[disk.name].progress || 0}%)`}>
                                    <Chip
                                        icon={<Icon icon="mdi:sync" />}
                                        label={`${activeMigrations[disk.name].progress || 0}%`}
                                        size="small"
                                        color="info"
                                        variant="outlined"
                                    />
                                  </Tooltip>
                              )}
                              {disk.isHotpluggable && isRunning && (
                                  <Tooltip title="Eject disk">
                                    <IconButton
                                        size="small"
                                        color="error"
                                        onClick={() => {
                                          setSelectedDisk(disk);
                                          setEjectDialogOpen(true);
                                        }}
                                    >
                                      <Icon icon="mdi:eject"/>
                                    </IconButton>
                                  </Tooltip>
                              )}
                            </Box>
                          </TableCell>
                        </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </Box>

            {/* Filesystem Usage - show when filesystem info is available */}
            {filesystemInfo?.items?.length > 0 && (
                <Box>
                  <Typography variant="subtitle2" gutterBottom>
                    Filesystem Usage (Guest Agent)
                  </Typography>
                  <TableContainer component={Paper} variant="outlined">
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell sx={{fontWeight: 'bold'}}>Mount Point</TableCell>
                          <TableCell sx={{fontWeight: 'bold'}}>Filesystem</TableCell>
                          <TableCell sx={{fontWeight: 'bold'}}>Total</TableCell>
                          <TableCell sx={{fontWeight: 'bold'}}>Used</TableCell>
                          <TableCell sx={{fontWeight: 'bold'}}>Available</TableCell>
                          <TableCell sx={{fontWeight: 'bold', minWidth: 150}}>Usage</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {filesystemInfo.items.map((fs: any, idx: number) => {
                          const totalBytes = fs.totalBytes || 0;
                          const usedBytes = fs.usedBytes || 0;
                          const availableBytes = totalBytes - usedBytes;
                          const percentage = totalBytes > 0 ? Math.min((usedBytes / totalBytes) * 100, 100) : 0;
                          const color = percentage > 90 ? 'error' : percentage > 70 ? 'warning' : 'primary';
                          return (
                              <TableRow key={idx}>
                                <TableCell>
                                  <code style={{fontSize: '0.85em'}}>{fs.mountPoint || '-'}</code>
                                </TableCell>
                                <TableCell>{fs.fileSystemType || '-'}</TableCell>
                                <TableCell>{formatBytes(totalBytes)}</TableCell>
                                <TableCell>{formatBytes(usedBytes)}</TableCell>
                                <TableCell>{formatBytes(availableBytes)}</TableCell>
                                <TableCell>
                                  <Box sx={{display: 'flex', alignItems: 'center', gap: 1, minWidth: 120}}>
                                    <LinearProgress
                                        variant="determinate"
                                        value={percentage}
                                        color={color}
                                        sx={{flexGrow: 1, height: 8, borderRadius: 4}}
                                    />
                                    <Typography variant="caption" sx={{minWidth: 45}}>
                                      {percentage.toFixed(0)}%
                                    </Typography>
                                  </Box>
                                </TableCell>
                              </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </Box>
            )}

            {/* Storage Class Recommendations - show if enabled */}
            {showRecommendations && (
                <Box>
                  <Typography variant="subtitle2" gutterBottom>
                    Storage Class Recommendations
                  </Typography>
                  {recommendedStorageClasses.length === 0 ? (
                      <Typography variant="body2" color="text.secondary">
                        No storage classes available
                      </Typography>
                  ) : (
                      <Grid container spacing={2}>
                        {recommendedStorageClasses.slice(0, 4).map((sc, idx) => (
                            <Grid item xs={12} sm={6} md={3} key={sc.metadata.name}>
                              <Card
                                  variant="outlined"
                                  sx={{
                                    borderColor: idx === 0 ? 'success.main' : 'divider',
                                    bgcolor: idx === 0 ? 'success.lighter' : 'background.paper',
                                  }}
                              >
                                <CardContent>
                                  <Box sx={{display: 'flex', alignItems: 'center', gap: 1, mb: 1}}>
                                    {idx === 0 && <Icon icon="mdi:star" color="#2e7d32"/>}
                                    <Typography variant="subtitle2" fontWeight="bold">
                                      {sc.metadata.name}
                                    </Typography>
                                    {sc.recommendation.isDefault && (
                                        <Chip label="Default" size="small" color="primary" />
                                    )}
                                  </Box>
                                  <Typography variant="caption" color="text.secondary" display="block">
                                    {sc.provisioner}
                                  </Typography>
                                  <Box sx={{mt: 1, display: 'flex', gap: 0.5, flexWrap: 'wrap'}}>
                                    {sc.allowVolumeExpansion && (
                                        <Chip label="Expandable" size="small" color="success" variant="outlined"/>
                                    )}
                                    <Chip label={sc.volumeBindingMode} size="small" variant="outlined"/>
                                    <Chip label={sc.reclaimPolicy} size="small" variant="outlined"/>
                                  </Box>
                                  {idx === 0 && (
                                      <Typography variant="caption" color="success.main" sx={{mt: 1, display: 'block'}}>
                                        Recommended for VMs
                                      </Typography>
                                  )}
                                </CardContent>
                              </Card>
                            </Grid>
                        ))}
                      </Grid>
                  )}
                </Box>
            )}
          </Box>
        </SectionBox>

        {/* Hot-Plug Dialog - VM mode only */}
        {isVMMode && (
            <Dialog
                open={hotPlugDialogOpen}
                onClose={() => setHotPlugDialogOpen(false)}
                maxWidth={false}
                PaperProps={{
                  sx: {
                    width: '100%',
                    maxWidth: {xs: '95%', sm: 500, md: 600},
                    m: {xs: 1, sm: 2},
                  }
                }}
            >
              <DialogTitle>Hot-Plug Disk</DialogTitle>
              <DialogContent>
                <Box sx={{display: 'flex', flexDirection: 'column', gap: 2, mt: 1}}>
                  <Alert severity="info">
                    Hot-plugged disks are attached to the running VM and can be ejected without restart.
                  </Alert>

                  <TextField
                      label="Volume Name"
                      value={volumeName}
                      onChange={(e: { target: { value: SetStateAction<string>; }; }) => setVolumeName(e.target.value)}
                placeholder="e.g., data-disk-1"
                fullWidth
                required
              />

              <FormControl component="fieldset">
                <Typography variant="caption" color="text.secondary" gutterBottom>
                  Source Type
                </Typography>
                <RadioGroup
                  row
                  value={sourceType}
                  onChange={(e: { target: { value: string; }; }) => setSourceType(e.target.value as 'dataVolume' | 'pvc')}
                >
                  <FormControlLabel value="dataVolume" control={<Radio />} label="DataVolume" />
                  <FormControlLabel value="pvc" control={<Radio />} label="PVC" />
                </RadioGroup>
              </FormControl>

              {sourceType === 'dataVolume' ? (
                <FormControl fullWidth>
                  <InputLabel>DataVolume</InputLabel>
                  <Select
                    value={sourceName}
                    label="DataVolume"
                    onChange={(e: { target: { value: SetStateAction<string>; }; }) => setSourceName(e.target.value)}
                  >
                    {availableDataVolumes.map(dv => (
                      <MenuItem key={dv.getName()} value={dv.getName()}>
                        {dv.getName()} ({formatBytes(dv.getStorageSize())})
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              ) : (
                <TextField
                  label="PVC Name"
                  value={sourceName}
                  onChange={(e: { target: { value: SetStateAction<string>; }; }) => setSourceName(e.target.value)}
                  placeholder="existing-pvc-name"
                  fullWidth
                />
              )}

              <FormControl fullWidth>
                <InputLabel>Bus Type</InputLabel>
                <Select
                  value={busType}
                  label="Bus Type"
                  onChange={(e: { target: { value: SetStateAction<string>; }; }) => setBusType(e.target.value)}
                >
                  <MenuItem value="scsi">SCSI (Recommended for hot-plug)</MenuItem>
                  <MenuItem value="virtio">VirtIO</MenuItem>
                  <MenuItem value="sata">SATA</MenuItem>
                </Select>
              </FormControl>
            </Box>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => { setHotPlugDialogOpen(false); resetHotPlugForm(); }} disabled={loading}>
              Cancel
            </Button>
            <Button onClick={handleHotPlugDisk} variant="contained" disabled={loading}>
              {loading ? 'Attaching...' : 'Attach Disk'}
            </Button>
          </DialogActions>
        </Dialog>
      )}

      {/* Eject Dialog */}
      <Dialog
        open={ejectDialogOpen}
        onClose={() => setEjectDialogOpen(false)}
        maxWidth={false}
        PaperProps={{
          sx: {
            width: '100%',
            maxWidth: { xs: '95%', sm: 450, md: 500 },
            m: { xs: 1, sm: 2 },
          }
        }}
      >
        <DialogTitle>Eject Disk</DialogTitle>
        <DialogContent>
          <Typography>
            Are you sure you want to eject disk "{selectedDisk?.name}"?
          </Typography>
          <Alert severity="warning" sx={{ mt: 2 }}>
            The disk will be detached from the running virtual machine. Make sure no processes are using it.
          </Alert>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEjectDialogOpen(false)} disabled={loading}>Cancel</Button>
          <Button onClick={handleEjectDisk} color="error" variant="contained" disabled={loading}>
            {loading ? 'Ejecting...' : 'Eject'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Resize Dialog */}
      <Dialog
        open={resizeDialogOpen}
        onClose={() => setResizeDialogOpen(false)}
        maxWidth={false}
        PaperProps={{
          sx: {
            width: '100%',
            maxWidth: { xs: '95%', sm: 450, md: 500 },
            m: { xs: 1, sm: 2 },
          }
        }}
      >
        <DialogTitle>Resize Disk</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
            <Typography>
              Resize disk "{selectedDisk?.name}"
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Current size: {formatBytes(selectedDisk?.storageSize)}
            </Typography>
            <Box sx={{ display: 'flex', gap: 1 }}>
              <TextField
                label="New Size"
                type="number"
                value={newSize}
                onChange={(e: { target: { value: SetStateAction<string>; }; }) => setNewSize(e.target.value)}
                sx={{ flex: 1 }}
                InputProps={{
                  endAdornment: (
                    <InputAdornment position="end">
                      <Select
                        value={sizeUnit}
                        onChange={(e: { target: { value: SetStateAction<string>; }; }) => setSizeUnit(e.target.value)}
                        variant="standard"
                        sx={{ minWidth: 60 }}
                      >
                        <MenuItem value="Gi">Gi</MenuItem>
                        <MenuItem value="Ti">Ti</MenuItem>
                        <MenuItem value="Mi">Mi</MenuItem>
                      </Select>
                    </InputAdornment>
                  ),
                }}
              />
            </Box>
            <Alert severity="info">
              Volume expansion is supported by this storage class. The new size must be larger than the current size.
            </Alert>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setResizeDialogOpen(false)} disabled={loading}>Cancel</Button>
          <Button onClick={handleResizeDisk} variant="contained" disabled={loading || !newSize}>
            {loading ? 'Resizing...' : 'Resize'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Storage Migration Dialog */}
      <Dialog
        open={migrateDialogOpen}
        onClose={() => { setMigrateDialogOpen(false); resetMigrationForm(); }}
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
            <Icon icon="mdi:database-arrow-right" />
            Migrate Storage
          </Box>
        </DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
            <Alert severity="info">
              Storage migration creates a copy of your disk on a different storage class.
              The original disk is preserved until you manually switch the VM to use the new disk.
            </Alert>

            {/* Source Info */}
            <Paper variant="outlined" sx={{ p: 2 }}>
              <Typography variant="subtitle2" gutterBottom>Source Disk</Typography>
              <Grid container spacing={2}>
                <Grid item xs={6}>
                  <Typography variant="caption" color="text.secondary">Name</Typography>
                  <Typography variant="body2">{selectedDisk?.name}</Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="caption" color="text.secondary">Size</Typography>
                  <Typography variant="body2">{formatBytes(selectedDisk?.storageSize)}</Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="caption" color="text.secondary">Current Storage Class</Typography>
                  <Typography variant="body2">{selectedDisk?.storageClassName || 'Unknown'}</Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="caption" color="text.secondary">Source PVC</Typography>
                  <Typography variant="body2">
                    {selectedDisk?.volume?.dataVolume?.name || selectedDisk?.volume?.persistentVolumeClaim?.claimName || '-'}
                  </Typography>
                </Grid>
              </Grid>
            </Paper>

            {/* Target Configuration */}
            <TextField
              label="New DataVolume Name"
              value={migrationName}
              onChange={(e) => setMigrationName(e.target.value)}
              fullWidth
              required
              helperText="Name for the new DataVolume that will be created"
            />

            <FormControl fullWidth required>
              <InputLabel>Target Storage Class</InputLabel>
              <Select
                value={targetStorageClass}
                label="Target Storage Class"
                onChange={(e) => setTargetStorageClass(e.target.value)}
              >
                {recommendedStorageClasses
                  .filter(sc => sc.metadata.name !== selectedDisk?.storageClassName)
                  .map(sc => (
                    <MenuItem key={sc.metadata.name} value={sc.metadata.name}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
                        <Typography>{sc.metadata.name}</Typography>
                        {sc.recommendation.isDefault && (
                          <Chip label="Default" size="small" color="primary" />
                        )}
                        {sc.allowVolumeExpansion && (
                          <Chip label="Expandable" size="small" color="success" variant="outlined" />
                        )}
                        <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>
                          {sc.provisioner.split('/').pop()}
                        </Typography>
                      </Box>
                    </MenuItem>
                  ))}
              </Select>
            </FormControl>

            <FormControl component="fieldset">
              <Typography variant="subtitle2" gutterBottom>Clone Strategy</Typography>
              <RadioGroup
                value={cloneStrategy}
                onChange={(e) => setCloneStrategy(e.target.value as 'csi-clone' | 'snapshot' | 'copy')}
              >
                <FormControlLabel
                  value="csi-clone"
                  control={<Radio />}
                  label={
                    <Box>
                      <Typography variant="body2">CSI Clone (Recommended)</Typography>
                      <Typography variant="caption" color="text.secondary">
                        Fast, storage-level cloning using CSI driver capabilities
                      </Typography>
                    </Box>
                  }
                />
                <FormControlLabel
                  value="snapshot"
                  control={<Radio />}
                  label={
                    <Box>
                      <Typography variant="body2">Snapshot Clone</Typography>
                      <Typography variant="caption" color="text.secondary">
                        Creates a snapshot first, then restores to new storage class
                      </Typography>
                    </Box>
                  }
                />
                <FormControlLabel
                  value="copy"
                  control={<Radio />}
                  label={
                    <Box>
                      <Typography variant="body2">Host-Assisted Copy</Typography>
                      <Typography variant="caption" color="text.secondary">
                        Slower but most compatible, copies data through a temporary pod
                      </Typography>
                    </Box>
                  }
                />
              </RadioGroup>
            </FormControl>

            {/* Auto-switch option */}
            <FormControlLabel
              control={
                <Switch
                  checked={autoSwitchDisk}
                  onChange={(e) => setAutoSwitchDisk(e.target.checked)}
                  disabled={isRunning}
                />
              }
              label={
                <Box>
                  <Typography variant="body2">
                    Automatically update VM to use new disk after migration
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {isRunning
                      ? 'Not available while VM is running'
                      : 'The VM configuration will be updated to point to the new DataVolume'}
                  </Typography>
                </Box>
              }
            />

            {isRunning && (
              <Alert severity="warning">
                The VM is currently running. Stop the VM to enable automatic disk switching
                and ensure data consistency during migration.
              </Alert>
            )}

            {autoSwitchDisk && !isRunning ? (
              <Alert severity="success" icon={<Icon icon="mdi:check-circle-outline" />}>
                <Typography variant="body2" gutterBottom><strong>After migration completes:</strong></Typography>
                <ol style={{ margin: 0, paddingLeft: 20 }}>
                  <li>VM will be automatically updated to use the new disk</li>
                  <li>Start the VM and verify it works correctly</li>
                  <li>Delete the old DataVolume/PVC when no longer needed</li>
                </ol>
              </Alert>
            ) : (
              <Alert severity="info" icon={<Icon icon="mdi:information-outline" />}>
                <Typography variant="body2" gutterBottom><strong>After migration completes:</strong></Typography>
                <ol style={{ margin: 0, paddingLeft: 20 }}>
                  <li>Stop the VM if running</li>
                  <li>Edit the VM to replace the disk source with the new DataVolume</li>
                  <li>Start the VM and verify it works correctly</li>
                  <li>Delete the old DataVolume/PVC when no longer needed</li>
                </ol>
              </Alert>
            )}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => { setMigrateDialogOpen(false); resetMigrationForm(); }}
            disabled={migrationInProgress}
          >
            Cancel
          </Button>
          <Button
            onClick={handleMigrateDisk}
            variant="contained"
            disabled={migrationInProgress || !targetStorageClass || !migrationName}
            startIcon={migrationInProgress ? <Icon icon="mdi:loading" className="spin" /> : <Icon icon="mdi:database-arrow-right" />}
          >
            {migrationInProgress ? 'Starting Migration...' : 'Start Migration'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
