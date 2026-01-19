import React from 'react';
import { Box, TextField, FormControlLabel, Switch, Typography } from '@material-ui/core';

type SettingsData = {
  server?: string;
  caCert?: string;
  insecureSkipTLSVerify?: boolean;

  clusterName?: string;
  userName?: string;
  contextName?: string;
  namespace?: string;
};

export function PluginSettings(props: { data?: SettingsData; onDataChange: (data: SettingsData) => void }) {
  const { data, onDataChange } = props;

  const update = (patch: Partial<SettingsData>) => onDataChange({ ...(data || {}), ...patch });

  return (
    <Box width="80%" display="flex" flexDirection="column" gridGap={16}>
      <Typography variant="h6">Kubeconfig defaults</Typography>

      <TextField
        label="API Server endpoint"
        variant="outlined"
        fullWidth
        value={data?.server || ''}
        onChange={e => update({ server: e.target.value })}
        helperText='Example: https://my-cluster.example.com:6443'
      />

      <FormControlLabel
        control={
          <Switch
            checked={Boolean(data?.insecureSkipTLSVerify)}
            onChange={e => update({ insecureSkipTLSVerify: e.target.checked })}
            color="primary"
          />
        }
        label="Skip TLS verification (insecure-skip-tls-verify)"
      />

      <TextField
        label="API Server CA certificate (PEM or base64)"
        variant="outlined"
        fullWidth
        multiline
        minRows={4}
        value={data?.caCert || ''}
        onChange={e => update({ caCert: e.target.value })}
        helperText="If TLS verification is enabled, provide the CA cert for the API server."
      />

      <Typography variant="subtitle1">Naming (optional)</Typography>

      <TextField
        label="Cluster name"
        variant="outlined"
        fullWidth
        value={data?.clusterName || ''}
        onChange={e => update({ clusterName: e.target.value })}
        helperText="Used in kubeconfig 'clusters[].name'. Defaults to the currently selected Headlamp cluster."
      />

      <TextField
        label="User name"
        variant="outlined"
        fullWidth
        value={data?.userName || ''}
        onChange={e => update({ userName: e.target.value })}
        helperText="Used in kubeconfig 'users[].name'."
      />

      <TextField
        label="Context name"
        variant="outlined"
        fullWidth
        value={data?.contextName || ''}
        onChange={e => update({ contextName: e.target.value })}
        helperText="Used in kubeconfig 'contexts[].name' and current-context."
      />

      <TextField
        label="Default namespace"
        variant="outlined"
        fullWidth
        value={data?.namespace || ''}
        onChange={e => update({ namespace: e.target.value })}
        helperText="Optional. If empty, namespace is omitted."
      />
    </Box>
  );
}
