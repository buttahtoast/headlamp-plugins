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
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useState } from 'react';
import { createResource } from './api';
import {
  buildBackup,
  buildRestore,
  errorMessage,
  Manifest,
  resourcePath,
  splitList,
  uniqueName,
} from './model';

export type Creation = { type: 'backup' | 'schedule' | 'restore' | 'run'; source?: Manifest };

export function JsonBlock({ value }: { value: unknown }) {
  return (
    <Box
      component="pre"
      sx={{
        p: 2,
        m: 0,
        bgcolor: 'action.hover',
        borderRadius: 1,
        overflow: 'auto',
        maxHeight: 440,
        fontSize: 12,
        whiteSpace: 'pre-wrap',
        overflowWrap: 'anywhere',
      }}
    >
      <code>{typeof value === 'string' ? value : JSON.stringify(value, null, 2)}</code>
    </Box>
  );
}

export function CreationDialog({
  creation,
  cluster,
  namespace,
  locations,
  onClose,
  onSaved,
}: {
  creation: Creation;
  cluster: string;
  namespace: string;
  locations: Manifest[];
  onClose: () => void;
  onSaved: (text: string) => void;
}) {
  const { type, source } = creation;
  const [name, setName] = useState(
    uniqueName(type === 'run' ? source!.metadata.name : `manual-${type}`)
  );
  const [namespaces, setNamespaces] = useState(
    type === 'restore' ? (source?.spec?.includedNamespaces || []).join(', ') : ''
  );
  const [resources, setResources] = useState('');
  const [excluded, setExcluded] = useState('events, events.events.k8s.io');
  const [ttl, setTtl] = useState('168h');
  const [storage, setStorage] = useState(
    locations.find(x => x.spec?.default)?.metadata.name || locations[0]?.metadata.name || ''
  );
  const [cron, setCron] = useState('0 2 * * *');
  const [snapshot, setSnapshot] = useState(false);
  const [clusterResources, setClusterResources] = useState(false);
  const [targetNamespace, setTargetNamespace] = useState('');
  const [advanced, setAdvanced] = useState(type === 'run');
  const [specText, setSpecText] = useState(JSON.stringify(source?.spec?.template || {}, null, 2));
  const [review, setReview] = useState<Manifest>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const collection =
    type === 'schedule' ? 'schedules' : type === 'restore' ? 'restores' : 'backups';
  const title = type === 'run' ? `Back up now from ${source!.metadata.name}` : `Create ${type}`;

  function structuredSpec() {
    if (type === 'restore')
      return buildRestore(source!, name, namespaces, resources, targetNamespace, snapshot).spec!;
    const template = {
      includedNamespaces: splitList(namespaces).length ? splitList(namespaces) : ['*'],
      ...(splitList(resources).length ? { includedResources: splitList(resources) } : {}),
      excludedResources: splitList(excluded),
      includeClusterResources: clusterResources,
      snapshotVolumes: snapshot,
      defaultVolumesToFsBackup: false,
      ttl,
      ...(storage ? { storageLocation: storage } : {}),
    };
    return type === 'schedule' ? { schedule: cron, paused: false, template } : template;
  }

  async function submit() {
    setBusy(true);
    setError('');
    try {
      if (review) {
        await createResource(cluster, resourcePath(namespace, collection), review);
        onSaved(`${review.kind} ${review.metadata.name} created.`);
        onClose();
      } else {
        const spec = advanced ? JSON.parse(specText) : structuredSpec();
        if (!spec || Array.isArray(spec) || typeof spec !== 'object')
          throw new Error('Spec must be a JSON object.');
        const value = buildBackup(namespace, name, spec, type === 'run' ? source : undefined);
        value.kind = type === 'schedule' ? 'Schedule' : type === 'restore' ? 'Restore' : 'Backup';
        await createResource(cluster, resourcePath(namespace, collection), value, true);
        setReview(value);
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onClose={() => !busy && onClose()} fullWidth maxWidth="md">
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Typography color="text.secondary">
            Cluster: {cluster} · Velero namespace: {namespace}
          </Typography>
          {type === 'run' && (
            <Alert severity="info">
              Copies the complete schedule template, including filters, volume settings, policies
              and hooks. The schedule stays {source?.spec?.paused ? 'paused' : 'enabled'}.
            </Alert>
          )}
          {type === 'restore' && (
            <Alert severity="warning">
              Velero restores the selected scope from {source?.metadata.name}. Existing resources
              use the skip policy (Velero may merge ServiceAccounts). Volume recovery is off by
              default. Review filters before creating the restore.
            </Alert>
          )}
          {review ? (
            <>
              <Alert severity="success">
                Kubernetes dry-run passed. Review the exact request before creating it.
              </Alert>
              <JsonBlock value={review} />
            </>
          ) : (
            <>
              <TextField
                label="Name"
                value={name}
                onChange={e => setName(e.target.value)}
                fullWidth
              />
              {!advanced && (
                <>
                  <TextField
                    label={type === 'restore' ? 'Source namespaces' : 'Included namespaces'}
                    helperText="Comma-separated; empty means all namespaces."
                    value={namespaces}
                    onChange={e => setNamespaces(e.target.value)}
                    fullWidth
                  />
                  <TextField
                    label="Included resource types"
                    helperText="For example: configmaps, deployments.apps. Empty means all resource types."
                    value={resources}
                    onChange={e => setResources(e.target.value)}
                    fullWidth
                  />
                  {type === 'restore' ? (
                    <TextField
                      label="Target namespace (optional)"
                      helperText="Map exactly one source namespace to a different target namespace."
                      value={targetNamespace}
                      onChange={e => setTargetNamespace(e.target.value)}
                      fullWidth
                    />
                  ) : (
                    <>
                      <TextField
                        label="Excluded resource types"
                        value={excluded}
                        onChange={e => setExcluded(e.target.value)}
                        fullWidth
                      />
                      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                        <TextField
                          label="Retention (Velero duration)"
                          value={ttl}
                          onChange={e => setTtl(e.target.value)}
                          fullWidth
                        />
                        <TextField
                          select
                          label="Storage location"
                          value={storage}
                          onChange={e => setStorage(e.target.value)}
                          fullWidth
                        >
                          <MenuItem value="">Velero default</MenuItem>
                          {locations.map(x => (
                            <MenuItem key={x.metadata.name} value={x.metadata.name}>
                              {x.metadata.name} ({x.status?.phase || 'Unknown'})
                            </MenuItem>
                          ))}
                        </TextField>
                      </Stack>
                      {type === 'schedule' && (
                        <TextField
                          label="Cron expression"
                          helperText="Evaluated by the Velero server; use CRON_TZ=Europe/Zurich for an explicit timezone."
                          value={cron}
                          onChange={e => setCron(e.target.value)}
                          fullWidth
                        />
                      )}
                      <FormControlLabel
                        control={
                          <Checkbox
                            checked={clusterResources}
                            onChange={e => setClusterResources(e.target.checked)}
                          />
                        }
                        label="Include cluster-scoped resources"
                      />
                    </>
                  )}
                  <FormControlLabel
                    control={
                      <Checkbox checked={snapshot} onChange={e => setSnapshot(e.target.checked)} />
                    }
                    label={
                      type === 'restore'
                        ? 'Restore persistent volumes through Velero'
                        : 'Snapshot persistent volumes'
                    }
                  />
                </>
              )}
              {advanced && (
                <TextField
                  multiline
                  minRows={12}
                  maxRows={24}
                  label="Velero spec (JSON)"
                  value={specText}
                  onChange={e => setSpecText(e.target.value)}
                  inputProps={{ style: { fontFamily: 'monospace', fontSize: 13 } }}
                  fullWidth
                />
              )}
              {!advanced && (
                <Button
                  onClick={() => {
                    try {
                      setSpecText(JSON.stringify(structuredSpec(), null, 2));
                      setAdvanced(true);
                      setError('');
                    } catch (err) {
                      setError(errorMessage(err));
                    }
                  }}
                >
                  Edit advanced spec, selectors and hooks
                </Button>
              )}
            </>
          )}
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button disabled={busy} onClick={onClose}>
          Cancel
        </Button>
        {review && (
          <Button disabled={busy} onClick={() => setReview(undefined)}>
            Back to edit
          </Button>
        )}
        <Button variant="contained" disabled={busy} onClick={submit}>
          {busy ? 'Working…' : review ? `Create ${review.kind}` : 'Validate and review'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
