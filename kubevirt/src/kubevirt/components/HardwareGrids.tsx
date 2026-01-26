import {
  Box,
  LinearProgress,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material';
import { formatBytes } from '../utils/kubeVirtCheck';

/**
 * Usage bar component for displaying percentage-based metrics
 */
export function UsageBar({ used, total, label }: { used: number; total: number; label?: string }) {
  const percentage = total > 0 ? Math.min((used / total) * 100, 100) : 0;
  const color = percentage > 90 ? 'error' : percentage > 70 ? 'warning' : 'primary';

  return (
    <Tooltip title={label || `${percentage.toFixed(1)}% used`}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 120 }}>
        <LinearProgress
          variant="determinate"
          value={percentage}
          color={color}
          sx={{ flexGrow: 1, height: 8, borderRadius: 4 }}
        />
        <Typography variant="caption" sx={{ minWidth: 45 }}>
          {percentage.toFixed(0)}%
        </Typography>
      </Box>
    </Tooltip>
  );
}

export interface CPUInfo {
  cores: number;
  sockets: number;
  threads: number;
  total: number;
  model: string;
}

export interface CPUConfigurationGridProps {
  cpu: CPUInfo;
}

/**
 * Shared component for displaying CPU configuration in a table grid.
 * Used in both VM Details and VMI Details pages.
 */
export function CPUConfigurationGrid({ cpu }: CPUConfigurationGridProps) {
  return (
    <Box>
      <Typography variant="subtitle1" sx={{ fontWeight: 'bold' }} gutterBottom>
        CPU Configuration
      </Typography>
      <TableContainer component={Paper} variant="outlined">
        <Table size="medium">
          <TableBody>
            <TableRow>
              <TableCell sx={{ fontWeight: 'bold', width: '30%', fontSize: '1rem' }}>Allocated vCPUs</TableCell>
              <TableCell sx={{ fontSize: '1rem' }}>{cpu.total}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell sx={{ fontWeight: 'bold', fontSize: '1rem' }}>Topology</TableCell>
              <TableCell sx={{ fontSize: '1rem' }}>
                {cpu.sockets} socket(s) × {cpu.cores} core(s) × {cpu.threads} thread(s)
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell sx={{ fontWeight: 'bold', fontSize: '1rem' }}>Model</TableCell>
              <TableCell sx={{ fontSize: '1rem' }}>{cpu.model}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </TableContainer>
      <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
        Note: Real-time CPU usage requires metrics-server or Prometheus integration
      </Typography>
    </Box>
  );
}

export interface MemoryInfo {
  allocated: string | number;
  totalBytes?: number;
  usedBytes?: number;
  availableBytes?: number;
}

export interface MemoryGridProps {
  memory: MemoryInfo;
}

/**
 * Shared component for displaying memory configuration in a table grid.
 * Used in both VM Details and VMI Details pages.
 */
export function MemoryGrid({ memory }: MemoryGridProps) {
  return (
    <Box>
      <Typography variant="subtitle1" sx={{ fontWeight: 'bold' }} gutterBottom>
        Memory
      </Typography>
      <TableContainer component={Paper} variant="outlined">
        <Table size="medium">
          <TableBody>
            <TableRow>
              <TableCell sx={{ fontWeight: 'bold', width: '30%', fontSize: '1rem' }}>Allocated</TableCell>
              <TableCell sx={{ fontSize: '1rem' }}>{formatBytes(memory.allocated)}</TableCell>
            </TableRow>
            {memory.totalBytes && (
              <TableRow>
                <TableCell sx={{ fontWeight: 'bold', fontSize: '1rem' }}>Total (Guest)</TableCell>
                <TableCell sx={{ fontSize: '1rem' }}>{formatBytes(memory.totalBytes)}</TableCell>
              </TableRow>
            )}
            {memory.usedBytes !== undefined && memory.totalBytes && (
              <TableRow>
                <TableCell sx={{ fontWeight: 'bold', fontSize: '1rem' }}>Used</TableCell>
                <TableCell sx={{ fontSize: '1rem' }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <span>{formatBytes(memory.usedBytes)}</span>
                    <UsageBar
                      used={memory.usedBytes}
                      total={memory.totalBytes}
                      label={`${formatBytes(memory.usedBytes)} used of ${formatBytes(memory.totalBytes)}`}
                    />
                  </Box>
                </TableCell>
              </TableRow>
            )}
            {memory.availableBytes !== undefined && (
              <TableRow>
                <TableCell sx={{ fontWeight: 'bold', fontSize: '1rem' }}>Available</TableCell>
                <TableCell sx={{ fontSize: '1rem' }}>{formatBytes(memory.availableBytes)}</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
      {!memory.totalBytes && (
        <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
          Memory usage requires qemu-guest-agent running in the VM
        </Typography>
      )}
    </Box>
  );
}
