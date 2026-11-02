import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  LinearProgress,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useEffect, useState } from 'react';
import { stringify } from 'yaml';
import { allowed, createCertificate, getResource, patchRenewal, prepareRenewal } from './api';
import {
  condition,
  errorMessage,
  Item,
  Manifest,
  portable,
  renewalComplete,
  renewalPatch,
} from './model';

export function exportYaml(item: Manifest) {
  const url = URL.createObjectURL(
    new Blob([stringify(portable(item))], { type: 'application/yaml' })
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = `${item.metadata.name}.yaml`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function RenewDialog({
  item,
  onClose,
  onRefresh,
}: {
  item: Item;
  onClose: () => void;
  onRefresh: () => void;
}) {
  const [prepared, setPrepared] = useState<{
    live: Manifest;
    patch: ReturnType<typeof renewalPatch>;
  }>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<'checking' | 'review' | 'submitted' | 'complete' | 'timeout'>(
    'checking'
  );
  const [progress, setProgress] = useState('');
  useEffect(() => {
    let active = true;
    prepareRenewal(item)
      .then(value => {
        if (active) {
          setPrepared(value);
          setPhase('review');
        }
      })
      .catch(error => {
        if (active) setError(errorMessage(error));
      });
    return () => {
      active = false;
    };
  }, [item]);
  useEffect(() => {
    if (phase !== 'submitted' || !prepared) return;
    const abort = new AbortController();
    const deadline = Date.now() + 5 * 60000;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const live = await getResource(
          item.cluster,
          'certificates',
          item.metadata.namespace,
          item.metadata.name,
          abort.signal
        );
        if (abort.signal.aborted) return;
        if (live.metadata.uid !== prepared!.live.metadata.uid) {
          setError(
            'Certificate was replaced while monitoring. Refresh to inspect the replacement.'
          );
          setPhase('timeout');
          return;
        }
        if (renewalComplete(prepared!.live, live)) {
          setPhase('complete');
          onRefresh();
          return;
        }
        setProgress(
          condition(live, 'Issuing')?.message ||
            condition(live, 'Ready')?.message ||
            'Waiting for cert-manager to issue the next revision.'
        );
        setError('');
      } catch (error) {
        if (!abort.signal.aborted) setError(`Monitoring: ${errorMessage(error)}`);
      }
      if (abort.signal.aborted) return;
      if (Date.now() >= deadline) setPhase('timeout');
      else timer = setTimeout(poll, 3000);
    }
    void poll();
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [phase, prepared, item, onRefresh]);
  async function submit() {
    if (!prepared) return;
    setBusy(true);
    setError('');
    try {
      await patchRenewal(item.cluster, prepared.live, prepared.patch, false);
      setPhase('submitted');
      onRefresh();
    } catch (error) {
      setPrepared(undefined);
      setError(`${errorMessage(error)} Reopen this dialog to refresh the target and retry.`);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open onClose={busy ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>Renew {item.metadata.name}</DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          <Typography variant="body2">
            {item.cluster} / {item.metadata.namespace}
          </Typography>
          {phase === 'checking' && !error && (
            <LinearProgress aria-label="Checking renewal permissions" />
          )}
          {error && <Alert severity="error">{error}</Alert>}
          {phase === 'review' && (
            <>
              <Typography>
                Request a new certificate now. The existing TLS Secret stays available while
                cert-manager issues the next revision. Your certificate's private-key rotation
                policy applies.
              </Typography>
              <Alert severity="info">
                Kubernetes permissions and server dry-run passed. This requests issuance; completion
                depends on the issuer and may be subject to CA rate limits.
              </Alert>
              <Typography variant="caption">CLI equivalent</Typography>
              <Box
                component="pre"
                sx={{
                  m: 0,
                  p: 1.5,
                  bgcolor: 'action.hover',
                  whiteSpace: 'pre-wrap',
                  overflowWrap: 'anywhere',
                }}
              >
                cmctl renew {item.metadata.name} --namespace {item.metadata.namespace}
              </Box>
            </>
          )}
          {phase === 'submitted' && (
            <>
              <Alert severity="info">Renewal requested. Waiting for a new ready revision.</Alert>
              <LinearProgress aria-label="Monitoring certificate renewal" />
              <Typography variant="body2">{progress}</Typography>
            </>
          )}
          {phase === 'complete' && (
            <Alert severity="success">
              Renewal completed. The certificate has a new ready revision.
            </Alert>
          )}
          {phase === 'timeout' && (
            <Alert severity="warning">
              Monitoring stopped after five minutes or the certificate was replaced. The accepted
              issuance request continues in the cluster. Inspect its conditions and related requests
              for progress.
            </Alert>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button disabled={busy} onClick={onClose}>
          {phase === 'submitted' ? 'Close monitoring' : 'Close'}
        </Button>
        {phase === 'review' && (
          <Button variant="contained" disabled={busy || !prepared} onClick={submit}>
            {busy ? 'Requesting…' : 'Renew now'}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}

export function CreateDialog({
  clusters,
  namespaces,
  onClose,
  onCreated,
}: {
  clusters: string[];
  namespaces: string[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [cluster, setCluster] = useState(clusters[0] || '');
  const [namespace, setNamespace] = useState(namespaces[0] || '');
  const [name, setName] = useState('');
  const [dns, setDns] = useState('');
  const [secret, setSecret] = useState('');
  const [issuer, setIssuer] = useState('');
  const [kind, setKind] = useState('ClusterIssuer');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState<Manifest>();
  async function submit() {
    setBusy(true);
    setError('');
    try {
      if (review) {
        await createCertificate(cluster, review, false);
        onCreated();
        onClose();
        return;
      }
      if (!(await allowed(cluster, namespace, 'certificates', 'create')))
        throw new Error('Your Kubernetes user cannot create Certificates in this namespace.');
      const item: Manifest = {
        apiVersion: 'cert-manager.io/v1',
        kind: 'Certificate',
        metadata: { name: name.trim(), namespace: namespace.trim() },
        spec: {
          secretName: secret.trim() || `${name.trim()}-tls`,
          dnsNames: dns.split(/[\s,]+/).filter(Boolean),
          issuerRef: { name: issuer.trim(), kind, group: 'cert-manager.io' },
        },
      };
      await createCertificate(cluster, item, true);
      setReview(item);
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open onClose={busy ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>Create certificate</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          {review ? (
            <>
              <Alert severity="info">
                Permissions and server dry-run passed. Review the certificate before creating it.
              </Alert>
              <Box
                component="pre"
                sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 13 }}
              >
                {stringify(review)}
              </Box>
            </>
          ) : (
            <>
              <TextField
                select
                label="Cluster"
                value={cluster}
                onChange={e => setCluster(e.target.value)}
              >
                {clusters.map(value => (
                  <MenuItem key={value} value={value}>
                    {value}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                required
                label="Namespace"
                value={namespace}
                onChange={e => setNamespace(e.target.value)}
              />
              <TextField
                required
                label="Certificate name"
                value={name}
                onChange={e => setName(e.target.value)}
              />
              <TextField
                label="TLS Secret name"
                value={secret}
                onChange={e => setSecret(e.target.value)}
                placeholder={name ? `${name}-tls` : ''}
                helperText="Defaults to <certificate name>-tls"
              />
              <TextField
                required
                label="DNS names"
                multiline
                value={dns}
                onChange={e => setDns(e.target.value)}
                helperText="Separate names with commas or new lines. Wildcards are supported by DNS-01 issuers."
              />
              <TextField
                select
                label="Issuer kind"
                value={kind}
                onChange={e => setKind(e.target.value)}
              >
                {['ClusterIssuer', 'Issuer'].map(value => (
                  <MenuItem key={value} value={value}>
                    {value}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                required
                label="Issuer name"
                value={issuer}
                onChange={e => setIssuer(e.target.value)}
              />
              <Typography variant="body2" color="text.secondary">
                Uses cert-manager's default duration and renewal policy. Advanced settings are
                available through Edit on the certificate details.
              </Typography>
            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button disabled={busy} onClick={onClose}>
          Cancel
        </Button>
        {review && (
          <Button disabled={busy} onClick={() => setReview(undefined)}>
            Back
          </Button>
        )}
        <Button
          variant="contained"
          disabled={
            busy || !cluster || !namespace.trim() || !name.trim() || !dns.trim() || !issuer.trim()
          }
          onClick={submit}
        >
          {busy ? 'Checking…' : review ? 'Create certificate' : 'Review'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
