import ApiProxy from '@kinvolk/headlamp-plugin/lib/ApiProxy';
import { Link, SectionBox } from '@kinvolk/headlamp-plugin/lib/components/common';
import {
  Box,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Grid,
  Paper,
  Typography,
} from '@mui/material';
import { Icon } from '@iconify/react';
import { useEffect, useMemo, useState } from 'react';
import { useKubeVirtInstalled, KubeVirtNotInstalled, KubeVirtCheckLoading, formatBytes } from '../utils/kubeVirtCheck';
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

// Format relative time
function formatRelativeTime(timestamp: string): string {
  if (!timestamp) return '';
  const now = new Date();
  const date = new Date(timestamp);
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffDay > 0) return `${diffDay}d ago`;
  if (diffHour > 0) return `${diffHour}h ago`;
  if (diffMin > 0) return `${diffMin}m ago`;
  return `${diffSec}s ago`;
}

// ============ HEALTH SUMMARY CARD ============
interface HealthSummaryCardProps {
  vms: VirtualMachine[] | null;
  loading: boolean;
}

function HealthSummaryCard({ vms, loading }: HealthSummaryCardProps) {
  const { t } = useTranslation('glossary');

  const stats = useMemo(() => {
    if (!vms) return { running: 0, stopped: 0, failed: 0, paused: 0, other: 0 };
    return {
      running: vms.filter(vm => vm.getStatus() === 'Running').length,
      stopped: vms.filter(vm => vm.getStatus() === 'Stopped').length,
      failed: vms.filter(vm => ['CrashLoopBackOff', 'ErrorUnschedulable', 'DataVolumeError', 'Failed'].includes(vm.getStatus())).length,
      paused: vms.filter(vm => vm.getStatus() === 'Paused').length,
      other: vms.filter(vm => !['Running', 'Stopped', 'CrashLoopBackOff', 'ErrorUnschedulable', 'DataVolumeError', 'Failed', 'Paused'].includes(vm.getStatus())).length,
    };
  }, [vms]);

  const healthItems = [
    { status: 'Running', count: stats.running, color: 'success.main', icon: 'mdi:play-circle', bgColor: 'success.lighter' },
    { status: 'Stopped', count: stats.stopped, color: 'text.secondary', icon: 'mdi:stop-circle', bgColor: 'grey.100' },
    { status: 'Failed', count: stats.failed, color: 'error.main', icon: 'mdi:alert-circle', bgColor: 'error.lighter' },
    { status: 'Paused', count: stats.paused, color: 'warning.main', icon: 'mdi:pause-circle', bgColor: 'warning.lighter' },
  ];

  return (
    <Card variant="outlined" sx={{ height: '100%' }}>
      <CardContent>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
          <Typography variant="subtitle1" fontWeight="bold">
            {t('VM Health Summary')}
          </Typography>
          <Chip
            label={`${vms?.length || 0} total`}
            size="small"
            color="primary"
            variant="outlined"
          />
        </Box>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
            <CircularProgress size={32} />
          </Box>
        ) : (
          <Grid container spacing={2}>
            {healthItems.map((item) => (
              <Grid item xs={6} sm={3} key={item.status}>
                <Link
                  routeName="virtualmachines"
                  style={{ textDecoration: 'none' }}
                >
                  <Paper
                    variant="outlined"
                    sx={{
                      p: 2,
                      textAlign: 'center',
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                      '&:hover': {
                        boxShadow: 2,
                        transform: 'translateY(-2px)',
                      },
                    }}
                  >
                    <Icon icon={item.icon} width={28} height={28} color={item.color.replace('.main', '')} />
                    <Typography variant="h4" sx={{ color: item.color, mt: 1 }}>
                      {item.count}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {item.status}
                    </Typography>
                  </Paper>
                </Link>
              </Grid>
            ))}
          </Grid>
        )}
      </CardContent>
    </Card>
  );
}

// ============ VM EVENTS PANEL ============
interface VMEvent {
  type: string;
  reason: string;
  message: string;
  lastTimestamp: string;
  involvedObject: {
    kind: string;
    name: string;
    namespace: string;
  };
}

function VMEventsPanel() {
  const { t } = useTranslation('glossary');
  const [events, setEvents] = useState<VMEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState<'all' | 'Warning' | 'Normal'>('all');

  useEffect(() => {
    const fetchEvents = async () => {
      try {
        // Fetch events for VirtualMachine and VirtualMachineInstance kinds
        const response = await ApiProxy.request('/api/v1/events?limit=100') as { items: VMEvent[] };
        const vmEvents = response.items?.filter((event: VMEvent) =>
          ['VirtualMachine', 'VirtualMachineInstance', 'VirtualMachineInstanceMigration'].includes(event.involvedObject?.kind || '')
        ) || [];

        // Sort by timestamp descending
        vmEvents.sort((a: VMEvent, b: VMEvent) => {
          const dateA = new Date(a.lastTimestamp || 0);
          const dateB = new Date(b.lastTimestamp || 0);
          return dateB.getTime() - dateA.getTime();
        });

        setEvents(vmEvents.slice(0, 20));
        setLoading(false);
      } catch (error) {
        console.error('Failed to fetch events:', error);
        setLoading(false);
      }
    };

    fetchEvents();
    const interval = setInterval(fetchEvents, 30000);
    return () => clearInterval(interval);
  }, []);

  const filteredEvents = useMemo(() => {
    if (filterType === 'all') return events;
    return events.filter(e => e.type === filterType);
  }, [events, filterType]);

  return (
    <Card variant="outlined" sx={{ height: '100%' }}>
      <CardContent>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
          <Typography variant="subtitle1" fontWeight="bold">
            {t('Recent VM Events')}
          </Typography>
          <Box sx={{ display: 'flex', gap: 0.5 }}>
            <Chip
              label="All"
              size="small"
              variant={filterType === 'all' ? 'filled' : 'outlined'}
              onClick={() => setFilterType('all')}
              sx={{ cursor: 'pointer' }}
            />
            <Chip
              label="Warning"
              size="small"
              color="warning"
              variant={filterType === 'Warning' ? 'filled' : 'outlined'}
              onClick={() => setFilterType('Warning')}
              sx={{ cursor: 'pointer' }}
            />
            <Chip
              label="Normal"
              size="small"
              color="success"
              variant={filterType === 'Normal' ? 'filled' : 'outlined'}
              onClick={() => setFilterType('Normal')}
              sx={{ cursor: 'pointer' }}
            />
          </Box>
        </Box>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
            <CircularProgress size={32} />
          </Box>
        ) : filteredEvents.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 3 }}>
            No VM events found
          </Typography>
        ) : (
          <Box sx={{ maxHeight: 300, overflow: 'auto' }}>
            {filteredEvents.slice(0, 10).map((event, idx) => (
              <Box
                key={idx}
                sx={{
                  display: 'flex',
                  gap: 1.5,
                  py: 1,
                  borderBottom: idx < filteredEvents.length - 1 ? '1px solid' : 'none',
                  borderColor: 'divider',
                }}
              >
                <Icon
                  icon={event.type === 'Warning' ? 'mdi:alert' : 'mdi:information'}
                  width={20}
                  color={event.type === 'Warning' ? '#ed6c02' : '#0288d1'}
                />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                    <Typography variant="body2" fontWeight="medium" noWrap>
                      {event.reason}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {formatRelativeTime(event.lastTimestamp)}
                    </Typography>
                  </Box>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }} noWrap>
                    {event.involvedObject?.name} ({event.involvedObject?.kind})
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }} noWrap>
                    {event.message}
                  </Typography>
                </Box>
              </Box>
            ))}
          </Box>
        )}
      </CardContent>
    </Card>
  );
}

// ============ MIGRATION TIMELINE ============
interface MigrationTimelineProps {
  migrations: VirtualMachineInstanceMigration[] | null;
  loading: boolean;
}

function MigrationTimeline({ migrations, loading }: MigrationTimelineProps) {
  const { t } = useTranslation('glossary');

  const recentMigrations = useMemo(() => {
    if (!migrations) return [];
    return [...migrations]
      .sort((a, b) => {
        const dateA = new Date(a.jsonData?.metadata?.creationTimestamp || 0);
        const dateB = new Date(b.jsonData?.metadata?.creationTimestamp || 0);
        return dateB.getTime() - dateA.getTime();
      })
      .slice(0, 8);
  }, [migrations]);

  const getStatusIcon = (migration: VirtualMachineInstanceMigration) => {
    if (migration.isCompleted()) return { icon: 'mdi:check-circle', color: '#2e7d32' };
    if (migration.isFailed()) return { icon: 'mdi:close-circle', color: '#d32f2f' };
    return { icon: 'mdi:progress-clock', color: '#ed6c02' };
  };

  return (
    <Card variant="outlined" sx={{ height: '100%' }}>
      <CardContent>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
          <Typography variant="subtitle1" fontWeight="bold">
            {t('Migration Activity')}
          </Typography>
          <Link routeName="virtualmachineinstancemigrations" style={{ textDecoration: 'none' }}>
            <Typography variant="caption" color="primary">
              View All
            </Typography>
          </Link>
        </Box>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
            <CircularProgress size={32} />
          </Box>
        ) : recentMigrations.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 3 }}>
            No migrations found
          </Typography>
        ) : (
          <Box sx={{ maxHeight: 300, overflow: 'auto' }}>
            {recentMigrations.map((migration, idx) => {
              const status = getStatusIcon(migration);
              const sourceNode = migration.jsonData?.status?.migrationState?.sourceNode || 'Unknown';
              const targetNode = migration.jsonData?.status?.migrationState?.targetNode || 'Pending';
              const startTime = migration.jsonData?.status?.migrationState?.startTimestamp;
              const endTime = migration.jsonData?.status?.migrationState?.endTimestamp;

              let duration = '';
              if (startTime && endTime) {
                const durationMs = new Date(endTime).getTime() - new Date(startTime).getTime();
                duration = `${Math.round(durationMs / 1000)}s`;
              }

              return (
                <Box
                  key={migration.getName()}
                  sx={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 2,
                    py: 1.5,
                    borderLeft: '2px solid',
                    borderColor: status.color,
                    pl: 2,
                    ml: 1,
                    mb: idx < recentMigrations.length - 1 ? 1 : 0,
                  }}
                >
                  <Icon icon={status.icon} width={20} color={status.color} />
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Link
                      routeName="virtualmachineinstancemigration"
                      params={{
                        name: migration.getName(),
                        namespace: migration.getNamespace(),
                      }}
                    >
                      <Typography variant="body2" fontWeight="medium" noWrap>
                        {migration.jsonData?.spec?.vmiName || migration.getName()}
                      </Typography>
                    </Link>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.5 }}>
                      <Typography variant="caption" color="text.secondary">
                        {sourceNode}
                      </Typography>
                      <Icon icon="mdi:arrow-right" width={14} />
                      <Typography variant="caption" color="text.secondary">
                        {targetNode}
                      </Typography>
                    </Box>
                    <Box sx={{ display: 'flex', gap: 1, mt: 0.5 }}>
                      <Chip label={migration.getPhase()} size="small" variant="outlined" sx={{ height: 20, fontSize: '0.7rem' }} />
                      {duration && (
                        <Typography variant="caption" color="text.secondary">
                          {duration}
                        </Typography>
                      )}
                    </Box>
                  </Box>
                  <Typography variant="caption" color="text.secondary">
                    {formatRelativeTime(migration.jsonData?.metadata?.creationTimestamp)}
                  </Typography>
                </Box>
              );
            })}
          </Box>
        )}
      </CardContent>
    </Card>
  );
}

export default function Dashboard() {
  const { t } = useTranslation('glossary');

  // Check if KubeVirt is installed
  const { installed: kubeVirtInstalled, checking: checkingKubeVirt } = useKubeVirtInstalled();

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

  // OS distribution stats from VMIs (guest agent data)
  const osStats = useMemo(() => {
    const osMap = new Map<string, { count: number; icon: string }>();

    if (vmis) {
      for (const vmi of vmis) {
        const guestOS = vmi.jsonData?.status?.guestOSInfo;
        if (guestOS) {
          const osName = guestOS.prettyName || guestOS.name || guestOS.id || 'Unknown';
          // Normalize OS names for grouping
          let normalizedName = osName;
          let icon = 'mdi:linux';

          const lowerName = osName.toLowerCase();
          if (lowerName.includes('windows')) {
            normalizedName = 'Windows';
            icon = 'mdi:microsoft-windows';
          } else if (lowerName.includes('ubuntu')) {
            normalizedName = 'Ubuntu';
            icon = 'mdi:ubuntu';
          } else if (lowerName.includes('debian')) {
            normalizedName = 'Debian';
            icon = 'mdi:debian';
          } else if (lowerName.includes('centos')) {
            normalizedName = 'CentOS';
            icon = 'mdi:centos';
          } else if (lowerName.includes('red hat') || lowerName.includes('rhel')) {
            normalizedName = 'RHEL';
            icon = 'mdi:redhat';
          } else if (lowerName.includes('fedora')) {
            normalizedName = 'Fedora';
            icon = 'mdi:fedora';
          } else if (lowerName.includes('suse') || lowerName.includes('sles')) {
            normalizedName = 'SUSE';
            icon = 'simple-icons:suse';
          } else if (lowerName.includes('alpine')) {
            normalizedName = 'Alpine';
            icon = 'simple-icons:alpinelinux';
          } else if (lowerName.includes('arch')) {
            normalizedName = 'Arch Linux';
            icon = 'simple-icons:archlinux';
          } else if (lowerName.includes('freebsd')) {
            normalizedName = 'FreeBSD';
            icon = 'simple-icons:freebsd';
          }

          const existing = osMap.get(normalizedName);
          if (existing) {
            existing.count++;
          } else {
            osMap.set(normalizedName, { count: 1, icon });
          }
        }
      }
    }

    return {
      total: vmis?.filter(vmi => vmi.jsonData?.status?.guestOSInfo).length || 0,
      byOS: Array.from(osMap.entries())
        .map(([os, data]) => ({ os, count: data.count, icon: data.icon }))
        .sort((a, b) => b.count - a.count),
    };
  }, [vmis]);

  const loading = !vms && !vmError;

  // Show loading while checking KubeVirt installation
  if (checkingKubeVirt) {
    return <KubeVirtCheckLoading />;
  }

  // Show installation message if KubeVirt is not installed
  if (kubeVirtInstalled === false) {
    return <KubeVirtNotInstalled />;
  }

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h4" gutterBottom>
        KubeVirt Dashboard
      </Typography>

      {/* Health Summary & Resources Row */}
      <SectionBox title={t('Overview')}>
        <Grid container spacing={2}>
          <Grid item xs={12} md={8}>
            <HealthSummaryCard vms={vms} loading={loading} />
          </Grid>
          <Grid item xs={12} md={4}>
            <ResourceCard
              title="Resource Totals"
              loading={loading}
              items={[
                { label: 'Total vCPUs', value: resourceAllocation.totalCPU, color: 'primary' },
                { label: 'Total Memory', value: resourceAllocation.totalMemory, color: 'info' },
                { label: 'Total Disk', value: diskAllocation.totalDisk, color: 'success' },
                { label: 'Nodes Running VMs', value: nodeStats.totalNodes, color: 'warning' },
              ]}
            />
          </Grid>
        </Grid>
      </SectionBox>

      {/* NEW: Events & Migration Timeline Row */}
      <SectionBox title={t('Activity')}>
        <Grid container spacing={2}>
          <Grid item xs={12} md={6}>
            <VMEventsPanel />
          </Grid>
          <Grid item xs={12} md={6}>
            <MigrationTimeline migrations={migrations} loading={!migrations && !migrationError} />
          </Grid>
        </Grid>
      </SectionBox>

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

      {/* Distribution */}
      <SectionBox title={t('Distribution & Topology')}>
        <Grid container spacing={2}>
          {/* Top Namespaces */}
          <Grid item xs={12} md={3}>
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
          <Grid item xs={12} md={3}>
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
          <Grid item xs={12} md={3}>
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

          {/* OS Distribution */}
          <Grid item xs={12} md={3}>
            <Paper variant="outlined" sx={{ p: 2, height: '100%' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                <Typography variant="subtitle2">
                  Guest OS Distribution
                </Typography>
                <Chip
                  label={`${osStats.total} detected`}
                  size="small"
                  variant="outlined"
                  color="info"
                />
              </Box>
              {osStats.byOS.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  No guest agent data available
                </Typography>
              ) : (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  {osStats.byOS.slice(0, 5).map(item => (
                    <Box
                      key={item.os}
                      sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                    >
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Icon icon={item.icon} width={18} />
                        <Typography variant="body2">{item.os}</Typography>
                      </Box>
                      <Chip
                        label={item.count}
                        size="small"
                        color="primary"
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
