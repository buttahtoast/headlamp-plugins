import { Link, SectionBox } from '@kinvolk/headlamp-plugin/lib/components/common';
import {
  Box,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  Grid,
  LinearProgress,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import DataVolume from '../DataVolume/DataVolume';
import NetworkAttachmentDefinition from '../NetworkAttachmentDefinition/NetworkAttachmentDefinition';
import VirtualMachineInstance from '../VirtualMachineInstance/VirtualMachineInstance';
import VirtualMachineInstanceMigration from '../VirtualMachineInstanceMigration/VirtualMachineInstanceMigration';
import VirtualMachine from '../VirtualMachines/VirtualMachine';
import VirtualMachineSnapshot from '../VirtualMachineSnapshot/VirtualMachineSnapshot';

interface StatCardProps {
  title: string;
  value: number | string;
  subtitle?: string;
  color?: 'primary' | 'success' | 'warning' | 'error' | 'info';
  loading?: boolean;
  link?: string;
  icon?: string;
}

function StatCard({ title, value, subtitle, color = 'primary', loading, link, icon }: StatCardProps) {
  const content = (
    <Card variant="outlined" sx={{ height: '100%' }}>
      <CardContent>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {icon && <Typography variant="h5">{icon}</Typography>}
          <Typography variant="subtitle2" color="text.secondary" gutterBottom sx={{ mb: 0 }}>
            {title}
          </Typography>
        </Box>
        {loading ? (
          <CircularProgress size={24} />
        ) : (
          <Typography variant="h4" color={`${color}.main`} sx={{ mt: 1 }}>
            {value}
          </Typography>
        )}
        {subtitle && (
          <Typography variant="caption" color="text.secondary">
            {subtitle}
          </Typography>
        )}
      </CardContent>
    </Card>
  );

  if (link) {
    return (
      <Link routeName={link} style={{ textDecoration: 'none' }}>
        {content}
      </Link>
    );
  }

  return content;
}

interface ResourceCardProps {
  title: string;
  items: { label: string; value: string | number; color?: 'primary' | 'success' | 'warning' | 'error' | 'info' }[];
  loading?: boolean;
}

function ResourceCard({ title, items, loading }: ResourceCardProps) {
  return (
    <Card variant="outlined" sx={{ height: '100%' }}>
      <CardContent>
        <Typography variant="subtitle2" color="text.secondary" gutterBottom>
          {title}
        </Typography>
        {loading ? (
          <CircularProgress size={24} />
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, mt: 1 }}>
            {items.map((item, idx) => (
              <Box key={idx} sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="body2" color="text.secondary">
                  {item.label}
                </Typography>
                <Typography variant="h6" color={item.color ? `${item.color}.main` : 'text.primary'}>
                  {item.value}
                </Typography>
              </Box>
            ))}
          </Box>
        )}
      </CardContent>
    </Card>
  );
}

interface StatusBreakdownProps {
  title: string;
  items: { label: string; count: number; color: 'success' | 'warning' | 'error' | 'info' | 'default' }[];
}

function StatusBreakdown({ title, items }: StatusBreakdownProps) {
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography variant="subtitle2" gutterBottom>
        {title}
      </Typography>
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        {items.map((item, idx) => (
          <Chip
            key={idx}
            label={`${item.label}: ${item.count}`}
            size="small"
            color={item.color}
            variant="outlined"
          />
        ))}
      </Box>
    </Paper>
  );
}

// Helper to parse memory string to bytes
function parseMemory(memStr: string): number {
  if (!memStr) return 0;
  const match = memStr.match(/^(\d+(?:\.\d+)?)\s*([KMGTPE]i?)?B?$/i);
  if (!match) return 0;

  const value = parseFloat(match[1]);
  const unit = (match[2] || '').toUpperCase();

  const multipliers: Record<string, number> = {
    '': 1,
    'K': 1000,
    'KI': 1024,
    'M': 1000 * 1000,
    'MI': 1024 * 1024,
    'G': 1000 * 1000 * 1000,
    'GI': 1024 * 1024 * 1024,
    'T': 1000 * 1000 * 1000 * 1000,
    'TI': 1024 * 1024 * 1024 * 1024,
  };

  return value * (multipliers[unit] || 1);
}

// Helper to format bytes to human readable
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'Ki', 'Mi', 'Gi', 'Ti', 'Pi'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// Helper to get OS icon
function getOSIcon(osName: string): string {
  const lowerName = osName.toLowerCase();
  if (lowerName.includes('windows')) return '🪟';
  if (lowerName.includes('ubuntu')) return '🟠';
  if (lowerName.includes('debian')) return '🔴';
  if (lowerName.includes('fedora')) return '🔵';
  if (lowerName.includes('centos') || lowerName.includes('rhel') || lowerName.includes('red hat')) return '🎩';
  if (lowerName.includes('suse') || lowerName.includes('sles')) return '🦎';
  if (lowerName.includes('arch')) return '🔷';
  if (lowerName.includes('alpine')) return '🏔️';
  if (lowerName.includes('linux')) return '🐧';
  return '💻';
}

export default function Dashboard() {
  const { t } = useTranslation('glossary');

  // Fetch all resources
  const { items: vms, error: vmError } = VirtualMachine.useList({});
  const { items: vmis, error: vmiError } = VirtualMachineInstance.useList({});
  const { items: dataVolumes, error: dvError } = DataVolume.useList({});
  const { items: snapshots, error: snapshotError } = VirtualMachineSnapshot.useList({});
  const { items: migrations, error: migrationError } = VirtualMachineInstanceMigration.useList({});
  const { items: nads, error: nadError } = NetworkAttachmentDefinition.useList({});

  // Calculate VM stats
  const vmStats = {
    total: vms?.length || 0,
    running: vms?.filter(vm => vm.getStatus() === 'Running').length || 0,
    stopped: vms?.filter(vm => vm.getStatus() === 'Stopped').length || 0,
    starting: vms?.filter(vm => ['Starting', 'Provisioning', 'Scheduling'].includes(vm.getStatus())).length || 0,
    error: vms?.filter(vm => ['CrashLoopBackOff', 'ErrorUnschedulable', 'DataVolumeError'].includes(vm.getStatus())).length || 0,
  };

  // Calculate VMI stats
  const vmiStats = {
    total: vmis?.length || 0,
    running: vmis?.filter(vmi => vmi.jsonData?.status?.phase === 'Running').length || 0,
    pending: vmis?.filter(vmi => vmi.jsonData?.status?.phase === 'Pending').length || 0,
    scheduling: vmis?.filter(vmi => vmi.jsonData?.status?.phase === 'Scheduling').length || 0,
    failed: vmis?.filter(vmi => vmi.jsonData?.status?.phase === 'Failed').length || 0,
  };

  // Calculate DataVolume stats
  const dvStats = {
    total: dataVolumes?.length || 0,
    succeeded: dataVolumes?.filter(dv => dv.getPhase() === 'Succeeded').length || 0,
    inProgress: dataVolumes?.filter(dv => ['ImportInProgress', 'CloneInProgress', 'UploadReady'].includes(dv.getPhase())).length || 0,
    pending: dataVolumes?.filter(dv => dv.getPhase() === 'Pending').length || 0,
    failed: dataVolumes?.filter(dv => dv.getPhase() === 'Failed').length || 0,
  };

  // Calculate Snapshot stats
  const snapshotStats = {
    total: snapshots?.length || 0,
    ready: snapshots?.filter(s => s.isReady()).length || 0,
    inProgress: snapshots?.filter(s => !s.isReady() && s.getPhase() !== 'Failed').length || 0,
    failed: snapshots?.filter(s => s.getPhase() === 'Failed').length || 0,
  };

  // Calculate Migration stats
  const migrationStats = {
    total: migrations?.length || 0,
    running: migrations?.filter(m => ['Running', 'Scheduling', 'Scheduled', 'PreparingTarget', 'TargetReady'].includes(m.getPhase())).length || 0,
    succeeded: migrations?.filter(m => m.isCompleted()).length || 0,
    failed: migrations?.filter(m => m.isFailed()).length || 0,
  };

  // Calculate resource allocation from VMs
  const resourceAllocation = useMemo(() => {
    let totalCPU = 0;
    let totalMemoryBytes = 0;

    if (vms) {
      for (const vm of vms) {
        const domain = vm.jsonData?.spec?.template?.spec?.domain;
        if (domain) {
          // CPU calculation
          const cores = domain.cpu?.cores || 1;
          const sockets = domain.cpu?.sockets || 1;
          const threads = domain.cpu?.threads || 1;
          totalCPU += cores * sockets * threads;

          // Memory calculation
          const memStr = domain.resources?.requests?.memory || domain.memory?.guest || '';
          totalMemoryBytes += parseMemory(memStr);
        }
      }
    }

    return {
      totalCPU,
      totalMemory: formatBytes(totalMemoryBytes),
      totalMemoryBytes,
    };
  }, [vms]);

  // Calculate total disk allocation from DataVolumes
  const diskAllocation = useMemo(() => {
    let totalBytes = 0;

    if (dataVolumes) {
      for (const dv of dataVolumes) {
        const sizeStr = dv.getStorageSize();
        if (sizeStr && sizeStr !== '-') {
          totalBytes += parseMemory(sizeStr);
        }
      }
    }

    return {
      totalDisk: formatBytes(totalBytes),
      totalDiskBytes: totalBytes,
    };
  }, [dataVolumes]);

  // Calculate OS distribution from VMIs (guest agent info)
  const osDistribution = useMemo(() => {
    const osMap = new Map<string, { count: number; versions: Map<string, number> }>();

    if (vmis) {
      for (const vmi of vmis) {
        const guestOS = vmi.jsonData?.status?.guestOSInfo;
        if (guestOS) {
          const osName = guestOS.prettyName || guestOS.name || guestOS.id || 'Unknown';
          const version = guestOS.version || guestOS.versionId || '';

          // Normalize OS name for grouping
          let normalizedOS = osName;
          const lowerName = osName.toLowerCase();
          if (lowerName.includes('ubuntu')) normalizedOS = 'Ubuntu';
          else if (lowerName.includes('debian')) normalizedOS = 'Debian';
          else if (lowerName.includes('fedora')) normalizedOS = 'Fedora';
          else if (lowerName.includes('centos')) normalizedOS = 'CentOS';
          else if (lowerName.includes('rhel') || lowerName.includes('red hat')) normalizedOS = 'RHEL';
          else if (lowerName.includes('windows')) normalizedOS = 'Windows';
          else if (lowerName.includes('suse') || lowerName.includes('sles')) normalizedOS = 'SUSE';
          else if (lowerName.includes('arch')) normalizedOS = 'Arch Linux';
          else if (lowerName.includes('alpine')) normalizedOS = 'Alpine';

          if (!osMap.has(normalizedOS)) {
            osMap.set(normalizedOS, { count: 0, versions: new Map() });
          }
          const osData = osMap.get(normalizedOS)!;
          osData.count++;

          if (version) {
            const versionKey = version.split('.').slice(0, 2).join('.');
            osData.versions.set(versionKey, (osData.versions.get(versionKey) || 0) + 1);
          }
        }
      }
    }

    // Convert to array and sort by count
    return Array.from(osMap.entries())
      .map(([os, data]) => ({
        os,
        count: data.count,
        versions: Array.from(data.versions.entries())
          .sort((a, b) => b[1] - a[1])
          .map(([v, c]) => ({ version: v, count: c })),
      }))
      .sort((a, b) => b.count - a.count);
  }, [vmis]);

  // Calculate namespace distribution
  const namespaceStats = useMemo(() => {
    const nsMap = new Map<string, number>();

    if (vms) {
      for (const vm of vms) {
        const ns = vm.getNamespace();
        nsMap.set(ns, (nsMap.get(ns) || 0) + 1);
      }
    }

    return Array.from(nsMap.entries())
      .map(([ns, count]) => ({ namespace: ns, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }, [vms]);

  // Calculate node distribution (nodes running VMs)
  const nodeStats = useMemo(() => {
    const nodeMap = new Map<string, number>();

    if (vmis) {
      for (const vmi of vmis) {
        const node = vmi.jsonData?.status?.nodeName;
        if (node) {
          nodeMap.set(node, (nodeMap.get(node) || 0) + 1);
        }
      }
    }

    return {
      totalNodes: nodeMap.size,
      distribution: Array.from(nodeMap.entries())
        .map(([node, count]) => ({ node, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5),
    };
  }, [vmis]);

  // NAD stats by plugin type
  const nadStats = useMemo(() => {
    const typeMap = new Map<string, number>();

    if (nads) {
      for (const nad of nads) {
        const pluginType = nad.getPluginType();
        typeMap.set(pluginType, (typeMap.get(pluginType) || 0) + 1);
      }
    }

    return {
      total: nads?.length || 0,
      byType: Array.from(typeMap.entries())
        .map(([type, count]) => ({ type, count }))
        .sort((a, b) => b.count - a.count),
    };
  }, [nads]);

  const loading = !vms && !vmError;

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h4" gutterBottom>
        KubeVirt Dashboard
      </Typography>

      {/* Resource Overview */}
      <SectionBox title={t('Resource Overview')}>
        <Grid container spacing={2}>
          <Grid item xs={12} sm={6} md={2}>
            <StatCard
              title="Virtual Machines"
              value={vmStats.total}
              subtitle={`${vmStats.running} running`}
              color="primary"
              loading={loading}
              link="virtualmachines"
              icon="🖥️"
            />
          </Grid>
          <Grid item xs={12} sm={6} md={2}>
            <StatCard
              title="VM Instances"
              value={vmiStats.total}
              subtitle={`${vmiStats.running} active`}
              color="info"
              loading={!vmis && !vmiError}
              link="virtualmachineinstances"
              icon="⚡"
            />
          </Grid>
          <Grid item xs={12} sm={6} md={2}>
            <StatCard
              title="Data Volumes"
              value={dvStats.total}
              subtitle={`${dvStats.succeeded} ready`}
              color="success"
              loading={!dataVolumes && !dvError}
              link="datavolumes"
              icon="💾"
            />
          </Grid>
          <Grid item xs={12} sm={6} md={2}>
            <StatCard
              title="Snapshots"
              value={snapshotStats.total}
              subtitle={`${snapshotStats.ready} ready`}
              color="warning"
              loading={!snapshots && !snapshotError}
              link="virtualmachinesnapshots"
              icon="📸"
            />
          </Grid>
          <Grid item xs={12} sm={6} md={2}>
            <StatCard
              title="Migrations"
              value={migrationStats.total}
              subtitle={`${migrationStats.running} active`}
              color={migrationStats.running > 0 ? 'warning' : 'success'}
              loading={!migrations && !migrationError}
              link="virtualmachineinstancemigrations"
              icon="↔️"
            />
          </Grid>
          <Grid item xs={12} sm={6} md={2}>
            <StatCard
              title="Networks (NADs)"
              value={nadStats.total}
              subtitle={nadStats.byType.length > 0 ? `${nadStats.byType[0].type}: ${nadStats.byType[0].count}` : 'No networks'}
              color="info"
              loading={!nads && !nadError}
              link="networkattachmentdefinitions"
              icon="🌐"
            />
          </Grid>
        </Grid>
      </SectionBox>

      {/* Resource Allocation */}
      <SectionBox title={t('Resource Allocation')}>
        <Grid container spacing={2}>
          <Grid item xs={12} md={4}>
            <ResourceCard
              title="Compute Resources (All VMs)"
              loading={loading}
              items={[
                { label: 'Total vCPUs', value: resourceAllocation.totalCPU, color: 'primary' },
                { label: 'Total Memory', value: resourceAllocation.totalMemory, color: 'info' },
                { label: 'VMs Defined', value: vmStats.total },
              ]}
            />
          </Grid>
          <Grid item xs={12} md={4}>
            <ResourceCard
              title="Storage Resources"
              loading={!dataVolumes && !dvError}
              items={[
                { label: 'Total Disk', value: diskAllocation.totalDisk, color: 'success' },
                { label: 'Data Volumes', value: dvStats.total },
                { label: 'Snapshots', value: snapshotStats.total },
              ]}
            />
          </Grid>
          <Grid item xs={12} md={4}>
            <ResourceCard
              title="Infrastructure"
              loading={!vmis && !vmiError}
              items={[
                { label: 'Nodes Running VMs', value: nodeStats.totalNodes, color: 'warning' },
                { label: 'Namespaces with VMs', value: namespaceStats.length },
                { label: 'Network Attachments', value: nadStats.total },
              ]}
            />
          </Grid>
        </Grid>
      </SectionBox>

      {/* Operating System Distribution */}
      <SectionBox title={t('Operating System Distribution')}>
        <Grid container spacing={2}>
          <Grid item xs={12} md={6}>
            <Paper variant="outlined" sx={{ p: 2 }}>
              <Typography variant="subtitle2" gutterBottom>
                VMs by Operating System
              </Typography>
              {osDistribution.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  No guest OS information available (guest agent may not be installed)
                </Typography>
              ) : (
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Operating System</TableCell>
                      <TableCell align="center">Count</TableCell>
                      <TableCell>Versions</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {osDistribution.map(os => (
                      <TableRow key={os.os}>
                        <TableCell>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <span>{getOSIcon(os.os)}</span>
                            <Typography variant="body2">{os.os}</Typography>
                          </Box>
                        </TableCell>
                        <TableCell align="center">
                          <Chip label={os.count} size="small" color="primary" />
                        </TableCell>
                        <TableCell>
                          <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                            {os.versions.slice(0, 3).map(v => (
                              <Tooltip key={v.version} title={`${v.count} VM(s)`}>
                                <Chip
                                  label={v.version}
                                  size="small"
                                  variant="outlined"
                                  sx={{ fontSize: '0.7rem' }}
                                />
                              </Tooltip>
                            ))}
                            {os.versions.length > 3 && (
                              <Chip
                                label={`+${os.versions.length - 3}`}
                                size="small"
                                variant="outlined"
                                sx={{ fontSize: '0.7rem' }}
                              />
                            )}
                          </Box>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Paper>
          </Grid>
          <Grid item xs={12} md={6}>
            <Paper variant="outlined" sx={{ p: 2 }}>
              <Typography variant="subtitle2" gutterBottom>
                OS Distribution Chart
              </Typography>
              {osDistribution.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  No data available
                </Typography>
              ) : (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, mt: 2 }}>
                  {osDistribution.slice(0, 6).map(os => {
                    const percentage = vmiStats.total > 0 ? (os.count / vmiStats.total) * 100 : 0;
                    return (
                      <Box key={os.os}>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                          <Typography variant="body2">
                            {getOSIcon(os.os)} {os.os}
                          </Typography>
                          <Typography variant="body2" color="text.secondary">
                            {os.count} ({percentage.toFixed(0)}%)
                          </Typography>
                        </Box>
                        <LinearProgress
                          variant="determinate"
                          value={percentage}
                          sx={{ height: 8, borderRadius: 4 }}
                        />
                      </Box>
                    );
                  })}
                </Box>
              )}
            </Paper>
          </Grid>
        </Grid>
      </SectionBox>

      {/* Status Breakdown */}
      <SectionBox title={t('Status Breakdown')}>
        <Grid container spacing={2}>
          <Grid item xs={12} md={6}>
            <StatusBreakdown
              title="Virtual Machines"
              items={[
                { label: 'Running', count: vmStats.running, color: 'success' },
                { label: 'Stopped', count: vmStats.stopped, color: 'default' },
                { label: 'Starting', count: vmStats.starting, color: 'warning' },
                { label: 'Error', count: vmStats.error, color: 'error' },
              ]}
            />
          </Grid>
          <Grid item xs={12} md={6}>
            <StatusBreakdown
              title="VM Instances"
              items={[
                { label: 'Running', count: vmiStats.running, color: 'success' },
                { label: 'Pending', count: vmiStats.pending, color: 'info' },
                { label: 'Scheduling', count: vmiStats.scheduling, color: 'warning' },
                { label: 'Failed', count: vmiStats.failed, color: 'error' },
              ]}
            />
          </Grid>
          <Grid item xs={12} md={6}>
            <StatusBreakdown
              title="Data Volumes"
              items={[
                { label: 'Succeeded', count: dvStats.succeeded, color: 'success' },
                { label: 'In Progress', count: dvStats.inProgress, color: 'warning' },
                { label: 'Pending', count: dvStats.pending, color: 'info' },
                { label: 'Failed', count: dvStats.failed, color: 'error' },
              ]}
            />
          </Grid>
          <Grid item xs={12} md={6}>
            <StatusBreakdown
              title="Migrations"
              items={[
                { label: 'Running', count: migrationStats.running, color: 'warning' },
                { label: 'Succeeded', count: migrationStats.succeeded, color: 'success' },
                { label: 'Failed', count: migrationStats.failed, color: 'error' },
              ]}
            />
          </Grid>
        </Grid>
      </SectionBox>

      {/* Distribution & Topology */}
      <SectionBox title={t('Distribution & Topology')}>
        <Grid container spacing={2}>
          {/* Top Namespaces */}
          <Grid item xs={12} md={4}>
            <Paper variant="outlined" sx={{ p: 2, height: '100%' }}>
              <Typography variant="subtitle2" gutterBottom>
                Top Namespaces by VM Count
              </Typography>
              {namespaceStats.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  No VMs found
                </Typography>
              ) : (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  {namespaceStats.map(ns => (
                    <Box
                      key={ns.namespace}
                      sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                    >
                      <Link routeName="namespace" params={{ name: ns.namespace }}>
                        {ns.namespace}
                      </Link>
                      <Chip label={ns.count} size="small" variant="outlined" />
                    </Box>
                  ))}
                </Box>
              )}
            </Paper>
          </Grid>

          {/* Node Distribution */}
          <Grid item xs={12} md={4}>
            <Paper variant="outlined" sx={{ p: 2, height: '100%' }}>
              <Typography variant="subtitle2" gutterBottom>
                VMs per Node
              </Typography>
              {nodeStats.distribution.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  No running VMs
                </Typography>
              ) : (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  {nodeStats.distribution.map(n => (
                    <Box
                      key={n.node}
                      sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                    >
                      <Link routeName="node" params={{ name: n.node }}>
                        <Typography
                          variant="body2"
                          sx={{
                            maxWidth: 180,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {n.node}
                        </Typography>
                      </Link>
                      <Chip label={n.count} size="small" color="info" variant="outlined" />
                    </Box>
                  ))}
                </Box>
              )}
            </Paper>
          </Grid>

          {/* Network Types */}
          <Grid item xs={12} md={4}>
            <Paper variant="outlined" sx={{ p: 2, height: '100%' }}>
              <Typography variant="subtitle2" gutterBottom>
                Network Attachment Types
              </Typography>
              {nadStats.byType.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  No NADs found
                </Typography>
              ) : (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  {nadStats.byType.map(t => (
                    <Box
                      key={t.type}
                      sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                    >
                      <Typography variant="body2">{t.type}</Typography>
                      <Chip
                        label={t.count}
                        size="small"
                        color={
                          t.type === 'bridge' ? 'primary' :
                          t.type === 'sriov' ? 'warning' :
                          t.type === 'macvlan' ? 'info' : 'default'
                        }
                        variant="outlined"
                      />
                    </Box>
                  ))}
                </Box>
              )}
            </Paper>
          </Grid>
        </Grid>
      </SectionBox>

      {/* Recent Activity */}
      <SectionBox title={t('Recent Activity')}>
        <Grid container spacing={2}>
          {/* Active Migrations */}
          <Grid item xs={12} md={6}>
            <Paper variant="outlined" sx={{ p: 2 }}>
              <Typography variant="subtitle2" gutterBottom>
                Active Migrations
              </Typography>
              {migrations?.filter(m => !m.isCompleted() && !m.isFailed()).length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  No active migrations
                </Typography>
              ) : (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  {migrations
                    ?.filter(m => !m.isCompleted() && !m.isFailed())
                    .slice(0, 5)
                    .map(m => (
                      <Box
                        key={m.getName()}
                        sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                      >
                        <Link
                          routeName="virtualmachineinstancemigration"
                          params={{ name: m.getName(), namespace: m.getNamespace() }}
                        >
                          {m.getName()}
                        </Link>
                        <Chip label={m.getPhase()} size="small" color="warning" variant="outlined" />
                      </Box>
                    ))}
                </Box>
              )}
            </Paper>
          </Grid>

          {/* VMs in Error State */}
          <Grid item xs={12} md={6}>
            <Paper variant="outlined" sx={{ p: 2 }}>
              <Typography variant="subtitle2" gutterBottom>
                VMs Requiring Attention
              </Typography>
              {vms?.filter(vm =>
                ['CrashLoopBackOff', 'ErrorUnschedulable', 'DataVolumeError', 'Failed'].includes(
                  vm.getStatus()
                )
              ).length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  All VMs healthy
                </Typography>
              ) : (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  {vms
                    ?.filter(vm =>
                      ['CrashLoopBackOff', 'ErrorUnschedulable', 'DataVolumeError', 'Failed'].includes(
                        vm.getStatus()
                      )
                    )
                    .slice(0, 5)
                    .map(vm => (
                      <Box
                        key={vm.getName()}
                        sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                      >
                        <Link
                          routeName="virtualmachine"
                          params={{ name: vm.getName(), namespace: vm.getNamespace() }}
                        >
                          {vm.getName()}
                        </Link>
                        <Chip label={vm.getStatus()} size="small" color="error" variant="outlined" />
                      </Box>
                    ))}
                </Box>
              )}
            </Paper>
          </Grid>

          {/* In-Progress Snapshots */}
          <Grid item xs={12} md={6}>
            <Paper variant="outlined" sx={{ p: 2 }}>
              <Typography variant="subtitle2" gutterBottom>
                In-Progress Snapshots
              </Typography>
              {snapshots?.filter(s => !s.isReady() && s.getPhase() !== 'Failed').length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  No snapshots in progress
                </Typography>
              ) : (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  {snapshots
                    ?.filter(s => !s.isReady() && s.getPhase() !== 'Failed')
                    .slice(0, 5)
                    .map(s => (
                      <Box
                        key={s.getName()}
                        sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                      >
                        <Link
                          routeName="virtualmachinesnapshot"
                          params={{ name: s.getName(), namespace: s.getNamespace() }}
                        >
                          {s.getName()}
                        </Link>
                        <Chip label={s.getPhase()} size="small" color="warning" variant="outlined" />
                      </Box>
                    ))}
                </Box>
              )}
            </Paper>
          </Grid>

          {/* Data Volumes Importing */}
          <Grid item xs={12} md={6}>
            <Paper variant="outlined" sx={{ p: 2 }}>
              <Typography variant="subtitle2" gutterBottom>
                Data Volumes Importing
              </Typography>
              {dataVolumes?.filter(dv =>
                ['ImportInProgress', 'CloneInProgress', 'UploadReady', 'Pending'].includes(dv.getPhase())
              ).length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  No imports in progress
                </Typography>
              ) : (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  {dataVolumes
                    ?.filter(dv =>
                      ['ImportInProgress', 'CloneInProgress', 'UploadReady', 'Pending'].includes(
                        dv.getPhase()
                      )
                    )
                    .slice(0, 5)
                    .map(dv => (
                      <Box
                        key={dv.getName()}
                        sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                      >
                        <Link
                          routeName="datavolume"
                          params={{ name: dv.getName(), namespace: dv.getNamespace() }}
                        >
                          {dv.getName()}
                        </Link>
                        <Chip
                          label={`${dv.getPhase()} ${dv.getProgress()}`}
                          size="small"
                          color="warning"
                          variant="outlined"
                        />
                      </Box>
                    ))}
                </Box>
              )}
            </Paper>
          </Grid>
        </Grid>
      </SectionBox>
    </Box>
  );
}
