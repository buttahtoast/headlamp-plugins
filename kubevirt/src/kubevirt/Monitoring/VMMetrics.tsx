import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { Link, SectionBox } from '@kinvolk/headlamp-plugin/lib/components/common';
import {
  Box,
  Card,
  CardContent,
  CircularProgress,
  FormControl,
  Grid,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Typography,
} from '@mui/material';
import { Icon } from '@iconify/react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useKubeVirtInstalled, KubeVirtNotInstalled, KubeVirtCheckLoading } from '../utils/kubeVirtCheck';
import {
  LineChart,
  Line,
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

// Time range options
const TIME_RANGES = [
  { label: '1 Hour', value: '1h', step: '1m' },
  { label: '6 Hours', value: '6h', step: '5m' },
  { label: '24 Hours', value: '24h', step: '15m' },
  { label: '7 Days', value: '7d', step: '1h' },
];

// Color palette for multiple VMs
const COLORS = ['#2196f3', '#4caf50', '#ff9800', '#f44336', '#9c27b0', '#00bcd4', '#795548', '#607d8b'];

export default function VMMetrics() {
  const { t } = useTranslation('glossary');
  const { installed: kubeVirtInstalled, checking: checkingKubeVirt } = useKubeVirtInstalled();
  const [timeRange, setTimeRange] = useState('1h');
  const [selectedNamespace, setSelectedNamespace] = useState('');
  const [selectedVM, setSelectedVM] = useState('');
  const [loading, setLoading] = useState(false);
  const [prometheusAvailable, setPrometheusAvailable] = useState(true);

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

  // Get running VMs in selected namespace
  const runningVMs = useMemo(() => {
    if (!vms) return [];
    let filtered = vms.filter(vm => vm.getStatus() === 'Running');
    if (selectedNamespace) {
      filtered = filtered.filter(vm => vm.getNamespace() === selectedNamespace);
    }
    return filtered;
  }, [vms, selectedNamespace]);

  // Query Prometheus
  const queryPrometheus = async (query: string): Promise<any> => {
    try {
      const response = await ApiProxy.request(
        `/api/prometheus/api/v1/query?query=${encodeURIComponent(query)}`
      );
      return response;
    } catch (error) {
      console.error('Prometheus query failed:', error);
      throw error;
    }
  };

  // Query Prometheus range
  const queryPrometheusRange = async (query: string, range: string, step: string): Promise<any> => {
    const now = Math.floor(Date.now() / 1000);
    let start = now;

    switch (range) {
      case '1h': start = now - 3600; break;
      case '6h': start = now - 6 * 3600; break;
      case '24h': start = now - 24 * 3600; break;
      case '7d': start = now - 7 * 24 * 3600; break;
    }

    try {
      const response = await ApiProxy.request(
        `/api/prometheus/api/v1/query_range?query=${encodeURIComponent(query)}&start=${start}&end=${now}&step=${step}`
      );
      return response;
    } catch (error) {
      console.error('Prometheus range query failed:', error);
      throw error;
    }
  };

  // Fetch metrics
  useEffect(() => {
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

        setPrometheusAvailable(true);
      } catch (error) {
        console.error('Failed to fetch metrics:', error);
        setPrometheusAvailable(false);
      }

      setLoading(false);
    };

    fetchMetrics();
    const interval = setInterval(fetchMetrics, 30000);
    return () => clearInterval(interval);
  }, [timeRange, selectedNamespace, selectedVM]);

  // Format timestamp for chart
  const formatTimestamp = (ts: number): string => {
    const date = new Date(ts);
    if (timeRange === '7d') {
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  };

  // Merge time series data for multi-VM charts
  const mergeSeriesData = (series: VMMetricSeries[]): any[] => {
    if (series.length === 0) return [];

    const dataMap = new Map<number, any>();

    series.forEach((s, idx) => {
      s.data.forEach(d => {
        const key = Math.floor(d.timestamp / 60000) * 60000; // Round to minute
        if (!dataMap.has(key)) {
          dataMap.set(key, { timestamp: key });
        }
        dataMap.get(key)![`${s.vmName}`] = d.value;
      });
    });

    return Array.from(dataMap.values()).sort((a, b) => a.timestamp - b.timestamp);
  };

  // Render metric chart
  const renderChart = (series: VMMetricSeries[], title: string, unit: string, color: string = '#2196f3') => {
    const data = mergeSeriesData(series);
    const vmNames = series.map(s => s.vmName);

    return (
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="subtitle2" gutterBottom>
          {title}
        </Typography>
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
                formatter={(value: number) => [`${value.toFixed(2)} ${unit}`, '']}
              />
              <Legend />
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

  if (!prometheusAvailable) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography variant="h4" gutterBottom>VM Metrics</Typography>
        <Paper variant="outlined" sx={{ p: 4, textAlign: 'center' }}>
          <Icon icon="mdi:chart-line-variant" width={64} color="#9e9e9e" />
          <Typography variant="h6" sx={{ mt: 2 }}>
            Prometheus Not Available
          </Typography>
          <Typography variant="body1" color="text.secondary" sx={{ mt: 1 }}>
            Prometheus metrics are required for VM monitoring.
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
            Ensure Prometheus is installed and accessible via the Headlamp proxy at:
          </Typography>
          <Box
            sx={{
              mt: 1,
              p: 1,
              bgcolor: 'action.hover',
              borderRadius: 1,
              fontFamily: 'monospace',
              fontSize: '0.9em',
            }}
          >
            <Typography component="code" sx={{ fontFamily: 'monospace', color: 'text.primary' }}>
              /api/prometheus/api/v1/query
            </Typography>
          </Box>
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
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
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

          <FormControl sx={{ minWidth: 150 }} size="small">
            <InputLabel>Namespace</InputLabel>
            <Select
              value={selectedNamespace}
              label="Namespace"
              onChange={(e) => {
                setSelectedNamespace(e.target.value);
                setSelectedVM('');
              }}
            >
              <MenuItem value="">All Namespaces</MenuItem>
              {namespaces.map(ns => (
                <MenuItem key={ns} value={ns}>{ns}</MenuItem>
              ))}
            </Select>
          </FormControl>

          <FormControl sx={{ minWidth: 200 }} size="small">
            <InputLabel>Virtual Machine</InputLabel>
            <Select
              value={selectedVM}
              label="Virtual Machine"
              onChange={(e) => setSelectedVM(e.target.value)}
            >
              <MenuItem value="">All VMs</MenuItem>
              {runningVMs.map(vm => (
                <MenuItem key={`${vm.getNamespace()}/${vm.getName()}`} value={vm.getName()}>
                  {vm.getName()} ({vm.getNamespace()})
                </MenuItem>
              ))}
            </Select>
          </FormControl>
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

      <SectionBox title={t('Running VMs')}>
        <Grid container spacing={2}>
          {runningVMs.slice(0, 8).map((vm, idx) => {
            const vmi = vmis?.find(
              v => v.getName() === vm.getName() && v.getNamespace() === vm.getNamespace()
            );
            return (
              <Grid item xs={12} sm={6} md={3} key={`${vm.getNamespace()}/${vm.getName()}`}>
                <Card variant="outlined">
                  <CardContent>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                      <Box
                        sx={{
                          width: 12,
                          height: 12,
                          borderRadius: '50%',
                          bgcolor: COLORS[idx % COLORS.length],
                        }}
                      />
                      <Link
                        routeName="virtualmachine"
                        params={{ name: vm.getName(), namespace: vm.getNamespace() }}
                      >
                        <Typography variant="subtitle2" noWrap>
                          {vm.getName()}
                        </Typography>
                      </Link>
                    </Box>
                    <Typography variant="caption" color="text.secondary" display="block">
                      {vm.getNamespace()}
                    </Typography>
                    {vmi?.jsonData?.status?.nodeName && (
                      <Typography variant="caption" color="text.secondary">
                        Node: {vmi.jsonData.status.nodeName}
                      </Typography>
                    )}
                  </CardContent>
                </Card>
              </Grid>
            );
          })}
        </Grid>
      </SectionBox>
    </Box>
  );
}
