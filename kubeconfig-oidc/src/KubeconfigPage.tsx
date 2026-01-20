import React from 'react';
import { Box, Button, Divider, TextField, Typography } from '@material-ui/core';

import { ConfigStore } from '@kinvolk/headlamp-plugin/lib';
import { useCluster } from '@kinvolk/headlamp-plugin/lib/k8s';
import { getToken } from '@kinvolk/headlamp-plugin/lib/util/auth';

import { buildKubeconfigYAML } from './kubeconfig';
import { loadRuntimeDefaults, RuntimeDefaults } from './config';

const PLUGIN_ID = 'kubeconfig-oidc';

type SettingsData = RuntimeDefaults;

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
  // Optional: keep ConfigStore so a user can override runtime defaults.
  // If you want "env-only", remove ConfigStore usage and only use runtimeDefaults.
  const store = React.useMemo(() => new ConfigStore<SettingsData>(PLUGIN_ID), []);
  const userCfg = store.useConfig()() || {};

  const selectedCluster = useCluster();

  const [runtimeDefaults, setRuntimeDefaults] = React.useState<RuntimeDefaults | undefined>(undefined);
  const [runtimeMsg, setRuntimeMsg] = React.useState<string | undefined>(undefined);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await loadRuntimeDefaults(PLUGIN_ID);
      if (cancelled) return;
      setRuntimeDefaults(r);
      setRuntimeMsg(r ? 'Loaded runtime defaults (config.json).' : 'No runtime defaults found (config.json missing).');
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Merge: runtime defaults first, then user overrides (user wins)
  const cfg: SettingsData = { ...(runtimeDefaults || {}), ...(userCfg || {}) };

  const [token, setToken] = React.useState<string | undefined>(undefined);
  const [tokenError, setTokenError] = React.useState<string | undefined>(undefined);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      setTokenError(undefined);
      const t = await readTokenMaybeAsync(selectedCluster);
      if (cancelled) return;
      setToken(t);
      if (!t) setTokenError('No token found for the current session/cluster.');
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedCluster]);

  const server = cfg.server?.trim() || '';
  const clusterName = (cfg.clusterName?.trim() || selectedCluster || 'cluster').trim();
  const userName = (cfg.userName?.trim() || 'oidc-user').trim();
  const contextName = (cfg.contextName?.trim() || `${clusterName}-context`).trim();
  const namespace = cfg.namespace?.trim() || '';

  const insecureSkipTLSVerify = Boolean(cfg.insecureSkipTLSVerify);
  const caCert = cfg.caCert || '';

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
      <Typography variant="h5">Kubeconfig (OIDC token)</Typography>
      <Typography variant="body2">
        Generates a kubeconfig using your current Headlamp session token as a bearer token.
      </Typography>

      <Divider />

      <Box display="flex" flexDirection="column" gridGap={8}>
        <Typography variant="h6">Runtime configuration</Typography>
        <Typography variant="body2">{runtimeMsg || 'Loading runtime defaults…'}</Typography>
        <Typography variant="caption">
          The plugin looks for <b>/plugins/{PLUGIN_ID}/config.json</b> (or derives it from the loaded script URL).
        </Typography>
      </Box>

      <Divider />

      <Box display="flex" flexDirection="column" gridGap={12}>
        <Typography variant="h6">Status</Typography>
        <Typography variant="body2">
          Selected cluster: <b>{selectedCluster}</b>
        </Typography>

        {!server ? (
          <Typography variant="body2" color="error">
            Missing API Server endpoint. Provide it via env → config.json (recommended) or via plugin settings (if enabled).
          </Typography>
        ) : null}

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
          value={kubeconfig || ''}
          placeholder="Provide API server endpoint (via config.json) and ensure you are logged in via OIDC."
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

        <Typography variant="caption">
          Treat this kubeconfig as sensitive (it contains a token).
        </Typography>
      </Box>
    </Box>
  );
}
