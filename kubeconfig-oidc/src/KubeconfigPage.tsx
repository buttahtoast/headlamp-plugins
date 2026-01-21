import React from 'react';
import { Box, Button, Divider, TextField, Typography } from '@material-ui/core';

import { useCluster } from '@kinvolk/headlamp-plugin/lib/k8s';
import { getToken } from '@kinvolk/headlamp-plugin/lib/util/auth';

import { PLUGIN_ID } from './index';
import { loadRuntimeDefaults, RuntimeDefaults } from './runtimeConfig';
import { buildKubeconfigYAML } from './kubeconfig';

function downloadTextFile(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/yaml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function readTokenMaybeAsync(cluster: string): Promise<string | undefined> {
  try {
    const t: any = getToken(cluster);
    if (!t) return undefined;
    if (typeof t === 'string') return t;
    if (typeof t?.then === 'function') return await t;
    if (typeof t?.token === 'string') return t.token;
    if (typeof t?.id_token === 'string') return t.id_token;
    if (typeof t?.access_token === 'string') return t.access_token;
    return String(t);
  } catch {
    return undefined;
  }
}

export function KubeconfigPage() {
  const selectedCluster = useCluster();

  const [cfg, setCfg] = React.useState<RuntimeDefaults | null>(null);
  const [cfgError, setCfgError] = React.useState<string | null>(null);

  const [token, setToken] = React.useState<string | undefined>(undefined);
  const [tokenError, setTokenError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const c = await loadRuntimeDefaults(PLUGIN_ID);
        if (cancelled) return;
        setCfg(c);
        setCfgError(null);
      } catch (e: any) {
        if (cancelled) return;
        setCfg(null);
        setCfgError(e?.message || 'Failed to load config.json');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const t = await readTokenMaybeAsync(selectedCluster);
      if (cancelled) return;
      setToken(t);
      setTokenError(t ? null : 'No token found for the current session/cluster.');
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedCluster]);

  const server = cfg?.server?.trim() || '';
  const clusterName = (cfg?.clusterName?.trim() || selectedCluster || 'cluster').trim();
  const userName = (cfg?.userName?.trim() || 'oidc-user').trim();
  const contextName = (cfg?.contextName?.trim() || `${clusterName}-context`).trim();
  const namespace = cfg?.namespace?.trim() || '';

  const insecureSkipTLSVerify = Boolean(cfg?.insecureSkipTLSVerify);
  const caCert = cfg?.caCert || '';

  const kubeconfig =
    server && token
      ? buildKubeconfigYAML({
          clusterName,
          userName,
          contextName,
          namespace,
          server,
          insecureSkipTLSVerify,
          caCert,
          token,
        })
      : '';

  const canGenerate = Boolean(server && token);

  return (
    <Box p={2} display="flex" flexDirection="column" gridGap={16}>
      <Typography variant="h5">Kubeconfig (OIDC)</Typography>

      <Divider />

      <Box display="flex" flexDirection="column" gridGap={8}>
        <Typography variant="h6">Runtime config</Typography>

        {cfgError ? (
          <Typography variant="body2" color="error">
            {cfgError}
          </Typography>
        ) : cfg ? (
          <Typography variant="body2">
            Loaded config.json. API server: <b>{server || '(missing)'}</b>
          </Typography>
        ) : (
          <Typography variant="body2">Loading config.json…</Typography>
        )}
      </Box>

      <Divider />

      <Box display="flex" flexDirection="column" gridGap={8}>
        <Typography variant="h6">Session</Typography>
        <Typography variant="body2">
          Selected cluster: <b>{selectedCluster}</b>
        </Typography>
        {tokenError ? (
          <Typography variant="body2" color="error">
            {tokenError}
          </Typography>
        ) : (
          <Typography variant="body2">Token: {token ? 'available' : 'loading…'}</Typography>
        )}
      </Box>

      <Divider />

      <Box display="flex" flexDirection="column" gridGap={12}>
        <Typography variant="h6">Generated kubeconfig</Typography>

        <TextField
          variant="outlined"
          fullWidth
          multiline
          minRows={14}
          value={kubeconfig}
          placeholder="Ensure config.json has server and you are logged in via OIDC."
          InputProps={{ readOnly: true }}
        />

        <Box display="flex" gridGap={12}>
          <Button
            variant="contained"
            color="primary"
            disabled={!canGenerate}
            onClick={async () => kubeconfig && navigator.clipboard.writeText(kubeconfig)}
          >
            Copy
          </Button>

          <Button
            variant="outlined"
            disabled={!canGenerate}
            onClick={() => kubeconfig && downloadTextFile(`${clusterName}-kubeconfig.yaml`, kubeconfig)}
          >
            Download
          </Button>
        </Box>
      </Box>
    </Box>
  );
}
