import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { Box, Button, CircularProgress, Paper, Typography } from '@mui/material';
import { Icon } from '@iconify/react';
import { useEffect, useState } from 'react';

// Hook to check if KubeVirt is installed
export function useKubeVirtInstalled() {
  const [installed, setInstalled] = useState<boolean | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const checkKubeVirt = async () => {
      try {
        // Check if the KubeVirt CRD exists
        await ApiProxy.request('/apis/kubevirt.io/v1');
        setInstalled(true);
      } catch (error: any) {
        // 404 means the API group doesn't exist (KubeVirt not installed)
        if (error?.status === 404 || error?.message?.includes('not found')) {
          setInstalled(false);
        } else {
          // Other errors (like RBAC) - assume installed but inaccessible
          setInstalled(true);
        }
      }
      setChecking(false);
    };

    checkKubeVirt();
  }, []);

  return { installed, checking };
}

// Component to show when KubeVirt is not installed
export function KubeVirtNotInstalled() {
  return (
    <Box sx={{ p: 3 }}>
      <Paper
        variant="outlined"
        sx={{
          p: 6,
          textAlign: 'center',
          maxWidth: 600,
          mx: 'auto',
          mt: 4,
        }}
      >
        <Icon icon="eos-icons:virtual-guest" width={80} color="#9e9e9e" />
        <Typography variant="h4" sx={{ mt: 3, mb: 2 }}>
          KubeVirt Not Installed
        </Typography>
        <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
          KubeVirt is required to run virtual machines on your Kubernetes cluster.
          This plugin provides a UI for managing KubeVirt resources.
        </Typography>
        <Box sx={{ bgcolor: 'action.hover', p: 2, borderRadius: 1, mb: 3 }}>
          <Typography variant="subtitle2" gutterBottom>
            Install KubeVirt using:
          </Typography>
          <Typography
            component="pre"
            sx={{
              fontSize: '0.85em',
              textAlign: 'left',
              fontFamily: 'monospace',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              m: 0,
              color: 'text.primary',
            }}
          >
{`# Install the KubeVirt operator
export VERSION=$(curl -s https://api.github.com/repos/kubevirt/kubevirt/releases/latest | grep tag_name | cut -d '"' -f 4)
kubectl apply -f https://github.com/kubevirt/kubevirt/releases/download/$VERSION/kubevirt-operator.yaml

# Install KubeVirt CR
kubectl apply -f https://github.com/kubevirt/kubevirt/releases/download/$VERSION/kubevirt-cr.yaml`}
          </Typography>
        </Box>
        <Button
          variant="contained"
          href="https://kubevirt.io/user-guide/cluster_admin/installation/"
          target="_blank"
          startIcon={<Icon icon="mdi:open-in-new" />}
        >
          View Installation Guide
        </Button>
      </Paper>
    </Box>
  );
}

// Loading component while checking KubeVirt installation
export function KubeVirtCheckLoading() {
  return (
    <Box sx={{ p: 3, display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 400 }}>
      <CircularProgress />
    </Box>
  );
}

// Standard size units using binary (IEC) notation
const SIZE_UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];

/**
 * Format bytes to human-readable string using IEC binary notation (KiB, MiB, GiB, etc.)
 * @param bytes - Number of bytes or a Kubernetes memory string (e.g., "4Gi", "512Mi")
 * @param decimals - Number of decimal places (default: 1)
 * @returns Formatted string like "4.0 GiB" or "512 MiB"
 */
export function formatBytes(bytes: number | string | undefined | null, decimals = 1): string {
  if (bytes === undefined || bytes === null) return '-';

  // If it's a string, try to parse Kubernetes format first
  if (typeof bytes === 'string') {
    const parsed = parseK8sSize(bytes);
    if (parsed !== null) {
      bytes = parsed;
    } else {
      const num = parseInt(bytes, 10);
      if (isNaN(num)) return bytes; // Return as-is if can't parse
      bytes = num;
    }
  }

  if (typeof bytes !== 'number' || isNaN(bytes)) return '-';
  if (bytes === 0) return '0 B';

  const k = 1024;
  const i = Math.floor(Math.log(Math.abs(bytes)) / Math.log(k));
  const unitIndex = Math.min(i, SIZE_UNITS.length - 1);
  const value = bytes / Math.pow(k, unitIndex);

  return `${value.toFixed(decimals)} ${SIZE_UNITS[unitIndex]}`;
}

/**
 * Parse Kubernetes size strings (e.g., "4Gi", "512Mi", "100M", "2T") to bytes
 * Supports both IEC (Ki, Mi, Gi) and SI (K, M, G) suffixes
 * @param sizeStr - Kubernetes size string
 * @returns Number of bytes or null if invalid
 */
export function parseK8sSize(sizeStr: string | undefined | null): number | null {
  if (!sizeStr) return null;

  const match = sizeStr.match(/^(\d+(?:\.\d+)?)\s*([KMGTPE]i?)?B?$/i);
  if (!match) return null;

  const value = parseFloat(match[1]);
  const unit = (match[2] || '').toUpperCase();

  // Binary (IEC) multipliers
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
    'P': 1000 * 1000 * 1000 * 1000 * 1000,
    'PI': 1024 * 1024 * 1024 * 1024 * 1024,
    'E': 1000 * 1000 * 1000 * 1000 * 1000 * 1000,
    'EI': 1024 * 1024 * 1024 * 1024 * 1024 * 1024,
  };

  return value * (multipliers[unit] || 1);
}
