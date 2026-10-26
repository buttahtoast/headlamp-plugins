import { Icon } from '@iconify/react';
import { K8s } from '@kinvolk/headlamp-plugin/lib';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  LinearProgress,
  Stack,
  Tab,
  Tabs,
  Tooltip,
  Typography,
} from '@mui/material';
import { useEffect, useState } from 'react';
import { stringify } from 'yaml';
import { identityKey, reader, ResourceIdentity, resourceIdentity, ResourceObject } from './api';
import { ManagerDiff } from './shared/ManagerDiff';

export function SSAResourceDialog({
  identity,
  onClose,
}: {
  identity: ResourceIdentity;
  onClose: () => void;
}) {
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{ key?: string; object?: ResourceObject; error?: string }>({});
  const [view, setView] = useState('diff');
  const [reveal, setReveal] = useState(false);
  const key = identityKey(identity);
  useEffect(() => {
    setReveal(false);
    setView('diff');
  }, [key]);
  useEffect(() => {
    const abort = new AbortController();
    setState({});
    reader
      .load(identity, abort.signal)
      .then(object => !abort.signal.aborted && setState({ key, object }))
      .catch(
        error => !abort.signal.aborted && setState({ key, error: error.message || String(error) })
      );
    return () => abort.abort();
  }, [key, revision]);
  const current = state.key === key ? state : {};
  const secret = identity.kind === 'Secret' || current.object?.kind === 'Secret';
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="lg" aria-labelledby="ssa-inspector-title">
      <DialogTitle id="ssa-inspector-title">
        SSA Inspector · {identity.kind} · {identity.name}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          <Typography variant="body2" color="text.secondary">
            {identity.cluster} · {identity.namespace || 'Cluster-scoped'} ·{' '}
            {current.object?.apiVersion || identity.apiVersion}
          </Typography>
          {!current.object && !current.error && (
            <LinearProgress aria-label="Loading field ownership" />
          )}
          {current.error && <Alert severity="error">{current.error}</Alert>}
          {current.object && (
            <>
              <Tabs value={view} onChange={(_, value) => setView(value)}>
                <Tab value="diff" label="SSA / field ownership" />
                <Tab value="yaml" label="Live YAML" />
              </Tabs>
              {secret && (
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={reveal}
                      onChange={event => setReveal(event.target.checked)}
                    />
                  }
                  label="Reveal Secret values in diff / YAML"
                />
              )}
              {secret && !reveal ? (
                <Alert severity="info">Secret contents are hidden.</Alert>
              ) : view === 'diff' ? (
                <ManagerDiff key={`${key}/${revision}`} object={current.object} />
              ) : (
                <Box
                  component="pre"
                  aria-label="Live resource YAML"
                  sx={{
                    m: 0,
                    p: 2,
                    bgcolor: 'action.hover',
                    maxHeight: '65vh',
                    overflow: 'auto',
                    fontSize: 12,
                  }}
                >
                  <code>{stringify(current.object)}</code>
                </Box>
              )}
            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button
          onClick={() => setRevision(previous => previous + 1)}
          disabled={!current.object && !current.error}
        >
          Refresh object
        </Button>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}

export function SSAAction({ resource }: { resource: any }) {
  const cluster = K8s.useCluster();
  const identity = resourceIdentity(resource, cluster);
  const [open, setOpen] = useState(false);
  if (!identity) return null;
  return (
    <>
      <Tooltip title="Inspect server-side apply and field-manager ownership" describeChild>
        <Button
          size="small"
          variant="outlined"
          aria-label="SSA Inspector"
          startIcon={<Icon icon="mdi:file-compare" width={18} />}
          onClick={() => setOpen(true)}
        >
          SSA
        </Button>
      </Tooltip>
      {open && (
        <SSAResourceDialog
          key={identityKey(identity)}
          identity={identity}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
