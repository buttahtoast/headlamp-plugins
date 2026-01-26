import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { Link, SectionBox } from '@kinvolk/headlamp-plugin/lib/components/common';
import {
  Autocomplete,
  Box,
  Chip,
  CircularProgress,
  FormControl,
  Grid,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  TextField,
  Typography,
} from '@mui/material';
import { Icon } from '@iconify/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useKubeVirtInstalled, KubeVirtNotInstalled, KubeVirtCheckLoading } from '../utils/kubeVirtCheck';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import VirtualMachine from '../VirtualMachines/VirtualMachine';
import VirtualMachineInstance from '../VirtualMachineInstance/VirtualMachineInstance';

interface MetricData {
  timestamp: number;
  value: number;
}

interface VMMetricSeries {
  vmName: string;
  namespace: string;
  data: MetricData[];
}

interface PrometheusEndpoint {
  namespace: string;
  name: string;
  port: string;
  type: 'services' | 'pods';
}

// Time range options
const TIME_RANGES = [
  { label: '1 Hour', value: '1h', step: '1m' },
  { label: '6 Hours', value: '6h', step: '5m' },
  { label: '24 Hours', value: '24h', step: '15m' },
  { label: '7 Days', value: '7d', step: '1h' },
];

// Color palette for multiple VMs
const COLORS = ['#2196f3', '#4caf50', '#ff9800', '#f44336', '#9c27b0', '#00bcd4', '#795548', '#607d8b'];

// Labels to search for Prometheus installations
const PROMETHEUS_LABELS = [
  'headlamp-prometheus=true',
  'app.kubernetes.io/name=prometheus',
  'app=prometheus',
  'app=kube-prometheus-stack-prometheus',
  'app.kubernetes.io/component=prometheus',
];

export default function VMMetrics() {
  const { t } = useTranslation('glossary');
  const location = useLocation();
  const { installed: kubeVirtInstalled, checking: checkingKubeVirt } = useKubeVirtInstalled();

  // Parse URL params
  const urlParams = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return {
      namespace: params.get('namespace') || '',
      vm: params.get('vm') || '',
    };
  }, [location.search]);

  // Initialize from URL params
  const [timeRange, setTimeRange] = useState('1h');
  const [selectedNamespace, setSelectedNamespace] = useState(urlParams.namespace);
  const [selectedVM, setSelectedVM] = useState(urlParams.vm);
  const [loading, setLoading] = useState(false);
  const [prometheusAvailable, setPrometheusAvailable] = useState<boolean | null>(null);
  const [prometheusEndpoint, setPrometheusEndpoint] = useState<PrometheusEndpoint | null>(null);
  const [checkingPrometheus, setCheckingPrometheus] = useState(true);

  // Update state when URL params change
  useEffect(() => {
    if (urlParams.namespace) setSelectedNamespace(urlParams.namespace);
    if (urlParams.vm) setSelectedVM(urlParams.vm);
  }, [urlParams.namespace, urlParams.vm]);

  // Metric state
  const [cpuMetrics, setCpuMetrics] = useState<VMMetricSeries[]>([]);
  const [memoryMetrics, setMemoryMetrics] = useState<VMMetricSeries[]>([]);
  const [networkRxMetrics, setNetworkRxMetrics] = useState<VMMetricSeries[]>([]);
  const [networkTxMetrics, setNetworkTxMetrics] = useState<VMMetricSeries[]>([]);
  const [storageReadMetrics, setStorageReadMetrics] = useState<VMMetricSeries[]>([]);
  const [storageWriteMetrics, setStorageWriteMetrics] = useState<VMMetricSeries[]>([]);

  // Fetch VMs
  const { items: vms } = VirtualMachine.useList({});
  const { items: vmis } = VirtualMachineInstance.useList({});

  // Get unique namespaces
  const namespaces = useMemo(() => {
    const nsSet = new Set<string>();
    vms?.forEach(vm => nsSet.add(vm.getNamespace()));
    return Array.from(nsSet).sort();
  }, [vms]);

  // Get VMs filtered by namespace
  const filteredVMs = useMemo(() => {
    if (!vms) return [];
    if (selectedNamespace) {
      return vms.filter(vm => vm.getNamespace() === selectedNamespace);
    }
    return vms;
  }, [vms, selectedNamespace]);

  // Get running VMs count
  const runningVMs = useMemo(() => {
    return filteredVMs.filter(vm => vm.getStatus() === 'Running');
  }, [filteredVMs]);

  // VM status counts
  const vmStatusCounts = useMemo(() => {
    const counts = { running: 0, stopped: 0, paused: 0, other: 0, total: 0 };
    filteredVMs.forEach(vm => {
      counts.total++;
      const status = vm.getStatus();
      if (status === 'Running') counts.running++;
      else if (status === 'Stopped') counts.stopped++;
      else if (status === 'Paused') counts.paused++;
      else counts.other++;
    });
    return counts;
  }, [filteredVMs]);

  // VM options for autocomplete (limit to running VMs for metrics)
  const vmOptions = useMemo(() => {
    return runningVMs.map(vm => ({
      label: vm.getName(),
      namespace: vm.getNamespace(),
      id: `${vm.getNamespace()}/${vm.getName()}`,
    }));
  }, [runningVMs]);

  // Build Prometheus proxy URL
  const getPrometheusUrl = useCallback((endpoint: PrometheusEndpoint, path: string) => {
    return `/api/v1/namespaces/${endpoint.namespace}/${endpoint.type}/${endpoint.name}:${endpoint.port}/proxy${path}`;
  }, []);

  // Test if Prometheus endpoint is reachable
  const testPrometheusEndpoint = useCallback(async (endpoint: PrometheusEndpoint): Promise<boolean> => {
    try {
      const url = getPrometheusUrl(endpoint, '/api/v1/query?query=up');
      const response = await ApiProxy.request(url);
      return response?.status === 'success';
    } catch {
      return false;
    }
  }, [getPrometheusUrl]);

  // Auto-detect Prometheus installation
  const detectPrometheus = useCallback(async (): Promise<PrometheusEndpoint | null> => {
    // Search for Prometheus services first (more reliable)
    for (const labelSelector of PROMETHEUS_LABELS) {
      try {
        const response = await ApiProxy.request(
          `/api/v1/services?labelSelector=${encodeURIComponent(labelSelector)}`
        ) as { items?: any[] };

        if (response?.items?.length) {
          for (const svc of response.items) {
            const port = svc.spec?.ports?.[0]?.port || '9090';
            const endpoint: PrometheusEndpoint = {
              namespace: svc.metadata.namespace,
              name: svc.metadata.name,
              port: String(port),
              type: 'services',
            };

            if (await testPrometheusEndpoint(endpoint)) {
              console.log('Found Prometheus service:', endpoint);
              return endpoint;
            }
          }
        }
      } catch (err) {
        // Continue to next label
      }
    }

    // Fallback: Search for Prometheus pods
    for (const labelSelector of PROMETHEUS_LABELS) {
      try {
        const response = await ApiProxy.request(
          `/api/v1/pods?labelSelector=${encodeURIComponent(labelSelector)}`
        ) as { items?: any[] };

        if (response?.items?.length) {
          for (const pod of response.items) {
            if (pod.status?.phase !== 'Running') continue;

            const container = pod.spec?.containers?.[0];
            const port = container?.ports?.[0]?.containerPort || '9090';
            const endpoint: PrometheusEndpoint = {
              namespace: pod.metadata.namespace,
              name: pod.metadata.name,
              port: String(port),
              type: 'pods',
            };

            if (await testPrometheusEndpoint(endpoint)) {
              console.log('Found Prometheus pod:', endpoint);
              return endpoint;
            }
          }
        }
      } catch (err) {
        // Continue to next label
      }
    }

    return null;
  }, [testPrometheusEndpoint]);

  // Detect Prometheus on mount
  useEffect(() => {
    const detect = async () => {
      setCheckingPrometheus(true);
      const endpoint = await detectPrometheus();
      setPrometheusEndpoint(endpoint);
      setPrometheusAvailable(endpoint !== null);
      setCheckingPrometheus(false);
    };
    detect();
  }, [detectPrometheus]);

  // Query Prometheus range using auto-detected endpoint
  const queryPrometheusRange = useCallback(async (query: string, range: string, step: string): Promise<any> => {
    if (!prometheusEndpoint) {
      throw new Error('Prometheus endpoint not available');
    }

    const now = Math.floor(Date.now() / 1000);
    let start = now;

    switch (range) {
      case '1h': start = now - 3600; break;
      case '6h': start = now - 6 * 3600; break;
      case '24h': start = now - 24 * 3600; break;
      case '7d': start = now - 7 * 24 * 3600; break;
    }

    try {
      const url = getPrometheusUrl(
        prometheusEndpoint,
        `/api/v1/query_range?query=${encodeURIComponent(query)}&start=${start}&end=${now}&step=${step}`
      );
      const response = await ApiProxy.request(url);
      return response;
    } catch (error) {
      console.error('Prometheus range query failed:', error);
      throw error;
    }
  }, [prometheusEndpoint, getPrometheusUrl]);

  // Fetch metrics
  useEffect(() => {
    if (!prometheusEndpoint) return;

    const fetchMetrics = async () => {
      setLoading(true);

      const currentRange = TIME_RANGES.find(r => r.value === timeRange);
      if (!currentRange) return;

      try {
        // Build namespace and VM filters
        let nsFilter = selectedNamespace ? `namespace="${selectedNamespace}"` : '';
        let vmFilter = selectedVM ? `name="${selectedVM}"` : '';
        let filters = [nsFilter, vmFilter].filter(Boolean).join(',');
        if (filters) filters = '{' + filters + '}';

        // CPU Usage
        const cpuQuery = `rate(kubevirt_vmi_cpu_usage_seconds_total${filters || ''}[5m])`;
        const cpuResponse = await queryPrometheusRange(cpuQuery, currentRange.value, currentRange.step);
        if (cpuResponse?.data?.result) {
          const series = cpuResponse.data.result.map((r: any) => ({
            vmName: r.metric.name || 'unknown',
            namespace: r.metric.namespace || 'unknown',
            data: r.values.map(([ts, val]: [number, string]) => ({
              timestamp: ts * 1000,
              value: parseFloat(val) * 100, // Convert to percentage
            })),
          }));
          setCpuMetrics(series);
        }

        // Memory Usage
        const memQuery = `kubevirt_vmi_memory_available_bytes${filters || ''}`;
        const memResponse = await queryPrometheusRange(memQuery, currentRange.value, currentRange.step);
        if (memResponse?.data?.result) {
          const series = memResponse.data.result.map((r: any) => ({
            vmName: r.metric.name || 'unknown',
            namespace: r.metric.namespace || 'unknown',
            data: r.values.map(([ts, val]: [number, string]) => ({
              timestamp: ts * 1000,
              value: parseFloat(val) / (1024 * 1024 * 1024), // Convert to GiB
            })),
          }));
          setMemoryMetrics(series);
        }

        // Network RX
        const netRxQuery = `rate(kubevirt_vmi_network_receive_bytes_total${filters || ''}[5m])`;
        const netRxResponse = await queryPrometheusRange(netRxQuery, currentRange.value, currentRange.step);
        if (netRxResponse?.data?.result) {
          const series = netRxResponse.data.result.map((r: any) => ({
            vmName: r.metric.name || 'unknown',
            namespace: r.metric.namespace || 'unknown',
            data: r.values.map(([ts, val]: [number, string]) => ({
              timestamp: ts * 1000,
              value: parseFloat(val) / (1024 * 1024), // Convert to MiB/s
            })),
          }));
          setNetworkRxMetrics(series);
        }

        // Network TX
        const netTxQuery = `rate(kubevirt_vmi_network_transmit_bytes_total${filters || ''}[5m])`;
        const netTxResponse = await queryPrometheusRange(netTxQuery, currentRange.value, currentRange.step);
        if (netTxResponse?.data?.result) {
          const series = netTxResponse.data.result.map((r: any) => ({
            vmName: r.metric.name || 'unknown',
            namespace: r.metric.namespace || 'unknown',
            data: r.values.map(([ts, val]: [number, string]) => ({
              timestamp: ts * 1000,
              value: parseFloat(val) / (1024 * 1024), // Convert to MiB/s
            })),
          }));
          setNetworkTxMetrics(series);
        }

        // Storage Read
        const storageReadQuery = `rate(kubevirt_vmi_storage_read_traffic_bytes_total${filters || ''}[5m])`;
        const storageReadResponse = await queryPrometheusRange(storageReadQuery, currentRange.value, currentRange.step);
        if (storageReadResponse?.data?.result) {
          const series = storageReadResponse.data.result.map((r: any) => ({
            vmName: r.metric.name || 'unknown',
            namespace: r.metric.namespace || 'unknown',
            data: r.values.map(([ts, val]: [number, string]) => ({
              timestamp: ts * 1000,
              value: parseFloat(val) / (1024 * 1024), // Convert to MiB/s
            })),
          }));
          setStorageReadMetrics(series);
        }

        // Storage Write
        const storageWriteQuery = `rate(kubevirt_vmi_storage_write_traffic_bytes_total${filters || ''}[5m])`;
        const storageWriteResponse = await queryPrometheusRange(storageWriteQuery, currentRange.value, currentRange.step);
        if (storageWriteResponse?.data?.result) {
          const series = storageWriteResponse.data.result.map((r: any) => ({
            vmName: r.metric.name || 'unknown',
            namespace: r.metric.namespace || 'unknown',
            data: r.values.map(([ts, val]: [number, string]) => ({
              timestamp: ts * 1000,
              value: parseFloat(val) / (1024 * 1024), // Convert to MiB/s
            })),
          }));
          setStorageWriteMetrics(series);
        }
      } catch (error) {
        console.error('Failed to fetch metrics:', error);
      }

      setLoading(false);
    };

    fetchMetrics();
    const interval = setInterval(fetchMetrics, 30000);
    return () => clearInterval(interval);
  }, [timeRange, selectedNamespace, selectedVM, prometheusEndpoint, queryPrometheusRange]);

  // Format timestamp for chart
  const formatTimestamp = (ts: number): string => {
    const date = new Date(ts);
    if (timeRange === '7d') {
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  };

  // Maximum VMs to show on chart
  const MAX_CHART_VMS = 10;

  // Get top VMs by average metric value
  const getTopVMs = (series: VMMetricSeries[], limit: number): VMMetricSeries[] => {
    if (series.length <= limit) return series;

    // Calculate average value for each VM
    const withAvg = series.map(s => {
      const sum = s.data.reduce((acc, d) => acc + d.value, 0);
      const avg = s.data.length > 0 ? sum / s.data.length : 0;
      return { series: s, avg };
    });

    // Sort by average descending and take top N
    withAvg.sort((a, b) => b.avg - a.avg);
    return withAvg.slice(0, limit).map(w => w.series);
  };

  // Calculate aggregated totals for all VMs
  const getAggregatedData = (series: VMMetricSeries[]): MetricData[] => {
    if (series.length === 0) return [];

    const dataMap = new Map<number, number>();

    series.forEach(s => {
      s.data.forEach(d => {
        const key = Math.floor(d.timestamp / 60000) * 60000;
        dataMap.set(key, (dataMap.get(key) || 0) + d.value);
      });
    });

    return Array.from(dataMap.entries())
      .map(([timestamp, value]) => ({ timestamp, value }))
      .sort((a, b) => a.timestamp - b.timestamp);
  };

  // Merge time series data for multi-VM charts
  const mergeSeriesData = (series: VMMetricSeries[], includeTotal: boolean = false): any[] => {
    if (series.length === 0) return [];

    const dataMap = new Map<number, any>();

    series.forEach((s) => {
      s.data.forEach(d => {
        const key = Math.floor(d.timestamp / 60000) * 60000; // Round to minute
        if (!dataMap.has(key)) {
          dataMap.set(key, { timestamp: key });
        }
        dataMap.get(key)![`${s.vmName}`] = d.value;
      });
    });

    // Add total if requested
    if (includeTotal && series.length > 1) {
      dataMap.forEach((entry, key) => {
        let total = 0;
        series.forEach(s => {
          if (entry[s.vmName] !== undefined) {
            total += entry[s.vmName];
          }
        });
        entry['_total'] = total;
      });
    }

    return Array.from(dataMap.values()).sort((a, b) => a.timestamp - b.timestamp);
  };

  // Render metric chart with VM limiting
  const renderChart = (series: VMMetricSeries[], title: string, unit: string, color: string = '#2196f3') => {
    const totalVMs = series.length;
    const limitedSeries = getTopVMs(series, MAX_CHART_VMS);
    const showingLimited = totalVMs > MAX_CHART_VMS;
    const data = mergeSeriesData(limitedSeries, showingLimited);
    const vmNames = limitedSeries.map(s => s.vmName);

    return (
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
          <Typography variant="subtitle2">
            {title}
          </Typography>
          {showingLimited && (
            <Chip
              size="small"
              label={`Top ${MAX_CHART_VMS} of ${totalVMs} VMs`}
              color="info"
              variant="outlined"
            />
          )}
        </Box>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 200 }}>
            <CircularProgress size={32} />
          </Box>
        ) : data.length === 0 ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 200 }}>
            <Typography variant="body2" color="text.secondary">No data available</Typography>
          </Box>
        ) : (
          <ResponsiveContainer width="100%" height={250}>
            <AreaChart data={data}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis
                dataKey="timestamp"
                tickFormatter={formatTimestamp}
                fontSize={12}
              />
              <YAxis
                fontSize={12}
                tickFormatter={(v) => `${v.toFixed(1)}${unit}`}
              />
              <Tooltip
                labelFormatter={(ts) => new Date(ts).toLocaleString()}
                formatter={(value: number, name: string) => [
                  `${value.toFixed(2)} ${unit}`,
                  name === '_total' ? 'Total (all VMs)' : name
                ]}
              />
              <Legend
                wrapperStyle={{ fontSize: '12px' }}
                formatter={(value) => value === '_total' ? 'Total (all VMs)' : value}
              />
              {showingLimited && (
                <Area
                  key="_total"
                  type="monotone"
                  dataKey="_total"
                  stroke="#666"
                  fill="#666"
                  fillOpacity={0.1}
                  strokeWidth={2}
                  strokeDasharray="5 5"
                />
              )}
              {vmNames.map((vmName, idx) => (
                <Area
                  key={vmName}
                  type="monotone"
                  dataKey={vmName}
                  stroke={COLORS[idx % COLORS.length]}
                  fill={COLORS[idx % COLORS.length]}
                  fillOpacity={0.3}
                  strokeWidth={2}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        )}
      </Paper>
    );
  };

  // Show loading while checking KubeVirt installation
  if (checkingKubeVirt) {
    return <KubeVirtCheckLoading />;
  }

  // Show installation message if KubeVirt is not installed
  if (kubeVirtInstalled === false) {
    return <KubeVirtNotInstalled />;
  }

  // Show loading while detecting Prometheus
  if (checkingPrometheus) {
    return (
      <Box sx={{ p: 3, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 400 }}>
        <CircularProgress />
        <Typography sx={{ mt: 2 }}>Detecting Prometheus...</Typography>
      </Box>
    );
  }

  if (!prometheusAvailable) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography variant="h4" gutterBottom>VM Metrics</Typography>
        <Paper variant="outlined" sx={{ p: 4, textAlign: 'center' }}>
          <Icon icon="mdi:chart-line-variant" width={64} color="#9e9e9e" />
          <Typography variant="h6" sx={{ mt: 2 }}>
            Prometheus Not Found
          </Typography>
          <Typography variant="body1" color="text.secondary" sx={{ mt: 1 }}>
            Could not auto-detect a Prometheus installation in your cluster.
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
            Ensure Prometheus is installed with one of these labels:
          </Typography>
          <Box
            sx={{
              mt: 1,
              p: 2,
              bgcolor: 'action.hover',
              borderRadius: 1,
              textAlign: 'left',
            }}
          >
            {PROMETHEUS_LABELS.map(label => (
              <Typography key={label} component="code" sx={{ fontFamily: 'monospace', display: 'block', fontSize: '0.85rem' }}>
                {label}
              </Typography>
            ))}
          </Box>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
            Or add the label <code>headlamp-prometheus=true</code> to your Prometheus service.
          </Typography>
        </Paper>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h4" gutterBottom>
        VM Metrics
      </Typography>

      <SectionBox title={t('Filters')}>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
          <FormControl sx={{ minWidth: 150 }} size="small">
            <InputLabel>Time Range</InputLabel>
            <Select
              value={timeRange}
              label="Time Range"
              onChange={(e) => setTimeRange(e.target.value)}
            >
              {TIME_RANGES.map(r => (
                <MenuItem key={r.value} value={r.value}>{r.label}</MenuItem>
              ))}
            </Select>
          </FormControl>

          <Autocomplete
            size="small"
            sx={{ minWidth: 200 }}
            options={namespaces}
            value={selectedNamespace || null}
            onChange={(_, newValue) => {
              setSelectedNamespace(newValue || '');
              setSelectedVM('');
            }}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Namespace"
                placeholder={`Search ${namespaces.length} namespaces...`}
              />
            )}
            noOptionsText="No namespaces found"
          />

          <Autocomplete
            size="small"
            sx={{ minWidth: 280 }}
            options={vmOptions}
            value={vmOptions.find(opt => opt.label === selectedVM) || null}
            onChange={(_, newValue) => setSelectedVM(newValue?.label || '')}
            getOptionLabel={(option) => option.label}
            renderOption={(props, option) => (
              <li {...props} key={option.id}>
                <Box>
                  <Typography variant="body2">{option.label}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {option.namespace}
                  </Typography>
                </Box>
              </li>
            )}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Virtual Machine"
                placeholder={`Search ${runningVMs.length} running VMs...`}
              />
            )}
            isOptionEqualToValue={(option, value) => option.id === value.id}
            noOptionsText="No running VMs found"
          />

          <Box sx={{ flex: 1 }} />

          {prometheusEndpoint && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: 'success.main' }} />
              <Typography variant="caption" color="text.secondary">
                Prometheus: {prometheusEndpoint.name}.{prometheusEndpoint.namespace}
              </Typography>
            </Box>
          )}
        </Box>
      </SectionBox>

      <SectionBox title={t('Resource Usage')}>
        <Grid container spacing={2}>
          <Grid item xs={12} md={6}>
            {renderChart(cpuMetrics, 'CPU Usage', '%', '#2196f3')}
          </Grid>
          <Grid item xs={12} md={6}>
            {renderChart(memoryMetrics, 'Memory Available', ' GiB', '#4caf50')}
          </Grid>
        </Grid>
      </SectionBox>

      <SectionBox title={t('Network I/O')}>
        <Grid container spacing={2}>
          <Grid item xs={12} md={6}>
            {renderChart(networkRxMetrics, 'Network Receive', ' MiB/s', '#00bcd4')}
          </Grid>
          <Grid item xs={12} md={6}>
            {renderChart(networkTxMetrics, 'Network Transmit', ' MiB/s', '#ff9800')}
          </Grid>
        </Grid>
      </SectionBox>

      <SectionBox title={t('Storage I/O')}>
        <Grid container spacing={2}>
          <Grid item xs={12} md={6}>
            {renderChart(storageReadMetrics, 'Storage Read', ' MiB/s', '#9c27b0')}
          </Grid>
          <Grid item xs={12} md={6}>
            {renderChart(storageWriteMetrics, 'Storage Write', ' MiB/s', '#f44336')}
          </Grid>
        </Grid>
      </SectionBox>

      <SectionBox title={t('VM Summary')}>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
          <Chip
            icon={<Icon icon="mdi:play-circle" />}
            label={`${vmStatusCounts.running} Running`}
            color="success"
            variant="outlined"
          />
          <Chip
            icon={<Icon icon="mdi:stop-circle" />}
            label={`${vmStatusCounts.stopped} Stopped`}
            color="default"
            variant="outlined"
          />
          {vmStatusCounts.paused > 0 && (
            <Chip
              icon={<Icon icon="mdi:pause-circle" />}
              label={`${vmStatusCounts.paused} Paused`}
              color="warning"
              variant="outlined"
            />
          )}
          {vmStatusCounts.other > 0 && (
            <Chip
              icon={<Icon icon="mdi:help-circle" />}
              label={`${vmStatusCounts.other} Other`}
              color="info"
              variant="outlined"
            />
          )}
          <Box sx={{ flex: 1 }} />
          <Typography variant="body2" color="text.secondary">
            Total: {vmStatusCounts.total} VMs
            {selectedNamespace && ` in ${selectedNamespace}`}
          </Typography>
          <Link routeName="virtualmachines">
            <Chip
              icon={<Icon icon="mdi:open-in-new" />}
              label="View All VMs"
              clickable
              color="primary"
              variant="outlined"
            />
          </Link>
        </Box>
      </SectionBox>
    </Box>
  );
}
