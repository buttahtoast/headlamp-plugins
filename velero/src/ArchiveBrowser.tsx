import { SimpleTable } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  LinearProgress,
  MenuItem,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import { useEffect, useRef, useState } from 'react';
import { createResource, discoverObjectPath, downloadArtifact, liveObject } from './api';
import { MAX_COMPRESSED, readArchive } from './archive';
import { JsonBlock } from './CreationDialog';
import {
  ArchivedObject,
  Difference,
  diffObjects,
  errorMessage,
  Manifest,
  normalize,
  recoveryManifest,
} from './model';

export function ArchiveBrowser({
  cluster,
  namespace,
  backup,
  backups,
  readerService,
  canDownload,
}: {
  cluster: string;
  namespace: string;
  backup: Manifest;
  backups: Manifest[];
  readerService: string;
  canDownload: boolean;
}) {
  const [objects, setObjects] = useState<ArchivedObject[]>();
  const [baseline, setBaseline] = useState<ArchivedObject[]>();
  const [baselineName, setBaselineName] = useState('');
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<ArchivedObject>();
  const [source, setSource] = useState('');
  const controller = useRef<AbortController>();
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => () => controller.current?.abort(), []);

  async function load(name: string, compare = false) {
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setError('');
    try {
      const bytes = await downloadArtifact(
        cluster,
        namespace,
        name,
        'BackupContents',
        readerService,
        abort.signal
      );
      const items = await readArchive(bytes);
      if (abort.signal.aborted) return;
      if (compare) {
        setBaseline(items);
        setBaselineName(name);
      } else {
        setObjects(items);
        setSource(`Velero backup ${name}`);
      }
    } catch (err) {
      if (!abort.signal.aborted) setError(errorMessage(err));
    } finally {
      if (!abort.signal.aborted) setBusy(false);
    }
  }
  const baselineMap = baseline ? new Map(baseline.map(x => [x.id, x])) : undefined;
  const currentMap = new Map(objects?.map(x => [x.id, x]));
  const all = [...(objects || []), ...(baseline?.filter(x => !currentMap.has(x.id)) || [])];
  const filtered = all.filter(x =>
    `${x.manifest.kind} ${x.manifest.metadata.namespace || ''} ${x.manifest.metadata.name} ${
      x.resource
    }`
      .toLowerCase()
      .includes(search.toLowerCase())
  );

  function comparison(item: ArchivedObject) {
    if (!baselineMap) return '—';
    if (!currentMap.has(item.id)) return 'Only in comparison';
    const previous = baselineMap.get(item.id);
    if (!previous) return 'Only in this backup';
    return diffObjects(normalize(previous.manifest), normalize(item.manifest), 1).length
      ? 'Changed'
      : 'Unchanged';
  }

  return (
    <Stack spacing={2}>
      <Typography color="text.secondary">
        Browse captured manifests, compare with the current cluster or another backup, and recover
        individual objects. Volume data is inspected through Velero’s volume records.
      </Typography>
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        <Button
          variant="contained"
          disabled={busy || !canDownload}
          onClick={() => load(backup.metadata.name)}
        >
          Load backup contents
        </Button>
        <Button variant="outlined" disabled={busy} onClick={() => fileInput.current?.click()}>
          Import backup .tar.gz
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept=".gz,.tar,.tgz"
          aria-label="Import Velero archive"
          hidden
          onChange={async e => {
            const file = e.target.files?.[0];
            if (!file) return;
            setBusy(true);
            setError('');
            try {
              if (file.size > MAX_COMPRESSED)
                throw new Error('Archive exceeds the 128 MiB file limit.');
              const items = await readArchive(new Uint8Array(await file.arrayBuffer()));
              setObjects(items);
              setBaseline(undefined);
              setBaselineName('');
              setSource(
                `Imported file: ${file.name} (association with this backup is not verified)`
              );
            } catch (err) {
              setError(errorMessage(err));
            } finally {
              setBusy(false);
              e.target.value = '';
            }
          }}
        />
        {busy && (
          <Button
            onClick={() => {
              controller.current?.abort();
              setBusy(false);
            }}
          >
            Cancel download
          </Button>
        )}
      </Stack>
      {!canDownload && (
        <Alert severity="info">
          Downloading requires permission to create Velero DownloadRequests. You can still import a
          local archive.
        </Alert>
      )}
      {busy && <LinearProgress aria-label="Loading backup contents" />}
      {error && <Alert severity="error">{error}</Alert>}
      {objects && (
        <>
          <Alert severity="success">
            {objects.length} unique Kubernetes objects parsed · {source}. Header checks and JSON
            parsing passed; this does not verify volume data or backup authenticity.
          </Alert>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              label="Filter objects"
              placeholder="Name, namespace or kind"
              size="small"
              value={search}
              onChange={e => setSearch(e.target.value)}
              fullWidth
            />
            <TextField
              select
              label="Compare with backup"
              size="small"
              value={baselineName}
              sx={{ minWidth: 260 }}
              disabled={busy || !canDownload}
              onChange={e => {
                if (!e.target.value) {
                  setBaseline(undefined);
                  setBaselineName('');
                } else void load(e.target.value, true);
              }}
            >
              <MenuItem value="">No comparison</MenuItem>
              {backups
                .filter(x => x.metadata.name !== backup.metadata.name)
                .map(x => (
                  <MenuItem key={x.metadata.name} value={x.metadata.name}>
                    {x.metadata.name}
                  </MenuItem>
                ))}
            </TextField>
          </Stack>
          {baseline && (
            <Typography variant="body2">
              Before: {baselineName} → After: {backup.metadata.name}.{' '}
              {all.filter(x => comparison(x) !== 'Unchanged').length} objects differ. Status, server
              metadata and Velero tracking labels are ignored.
            </Typography>
          )}
          <SimpleTable
            data={filtered}
            reflectInURL={false}
            emptyMessage="No objects match this filter."
            columns={[
              {
                label: 'Name',
                getter: (x: ArchivedObject) => x.manifest.metadata.name,
                sort: true,
              },
              { label: 'Kind', getter: (x: ArchivedObject) => x.manifest.kind, sort: true },
              {
                label: 'Namespace',
                getter: (x: ArchivedObject) => x.manifest.metadata.namespace || 'Cluster-scoped',
                sort: true,
              },
              { label: 'API version', getter: (x: ArchivedObject) => x.manifest.apiVersion },
              ...(baseline ? [{ label: 'Comparison', getter: comparison }] : []),
              {
                label: 'Inspect',
                getter: (x: ArchivedObject) => (
                  <Button size="small" onClick={() => setSelected(x)}>
                    Inspect / diff / recover
                  </Button>
                ),
              },
            ]}
          />
        </>
      )}
      {selected && (
        <ObjectDialog
          key={selected.id}
          item={selected}
          baseline={baselineMap?.get(selected.id)}
          cluster={cluster}
          recoverable={currentMap.has(selected.id)}
          backupName={backup.metadata.name}
          onClose={() => setSelected(undefined)}
        />
      )}
    </Stack>
  );
}

function ObjectDialog({
  item,
  baseline,
  cluster,
  recoverable,
  backupName,
  onClose,
}: {
  item: ArchivedObject;
  baseline?: ArchivedObject;
  cluster: string;
  recoverable: boolean;
  backupName: string;
  onClose: () => void;
}) {
  const [tab, setTab] = useState('manifest');
  const [reveal, setReveal] = useState(false);
  const [live, setLive] = useState<Manifest>();
  const [liveState, setLiveState] = useState('Not loaded');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [target, setTarget] = useState(item.manifest.metadata.namespace || '');
  const [review, setReview] = useState<{ value: Manifest; path: string }>();
  const [notice, setNotice] = useState('');
  const sensitive = item.manifest.kind === 'Secret' && !reveal;
  const before = baseline?.manifest;

  async function getLive() {
    setBusy(true);
    setError('');
    try {
      const value = await liveObject(cluster, item.manifest);
      setLive(value);
      setLiveState(value ? 'Loaded' : 'Missing from the cluster');
    } catch (err) {
      setLiveState('Unavailable');
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  async function recover() {
    setBusy(true);
    setError('');
    try {
      if (review) {
        await createResource(cluster, review.path, review.value);
        setNotice(
          `${review.value.kind} ${review.value.metadata.name} created in ${
            review.value.metadata.namespace || 'cluster scope'
          }.`
        );
        setReview(undefined);
      } else {
        const value = recoveryManifest(item.manifest, target);
        value.metadata.annotations = {
          ...value.metadata.annotations,
          'headlamp.dev/recovered-from-backup': backupName,
        };
        const path = await discoverObjectPath(cluster, value);
        await createResource(cluster, path, value, true);
        setReview({ value, path });
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onClose={() => !busy && onClose()} fullWidth maxWidth="lg">
      <DialogTitle>
        {item.manifest.kind} · {item.manifest.metadata.name}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          <Typography variant="body2" color="text.secondary">
            {item.path}
          </Typography>
          {item.manifest.kind === 'Secret' && (
            <FormControlLabel
              control={<Checkbox checked={reveal} onChange={e => setReveal(e.target.checked)} />}
              label="Reveal secret data in this dialog"
            />
          )}
          <Tabs
            value={tab}
            onChange={(_, value) => {
              setTab(value);
              setReview(undefined);
              setError('');
            }}
            variant="scrollable"
          >
            <Tab value="manifest" label="Captured manifest" />
            <Tab value="live" label="Diff against live" />
            <Tab value="backup" label="Diff against backup" disabled={!baseline} />
            <Tab value="recover" label="Recover object" disabled={!recoverable} />
          </Tabs>
          {sensitive ? (
            <Alert severity="info">
              Reveal secret data to inspect, compare or recover this Secret.
            </Alert>
          ) : (
            <>
              {tab === 'manifest' && <JsonBlock value={item.manifest} />}
              {tab === 'live' && (
                <>
                  <Stack direction="row" spacing={2} alignItems="center">
                    <Button variant="outlined" disabled={busy} onClick={getLive}>
                      Fetch live object
                    </Button>
                    <Chip size="small" label={liveState} />
                  </Stack>
                  <Typography variant="body2">
                    Before: backup → After: live cluster. Status, server metadata and Velero
                    tracking labels are ignored.
                  </Typography>
                  {live && (
                    <Differences values={diffObjects(normalize(item.manifest), normalize(live))} />
                  )}
                </>
              )}
              {tab === 'backup' && before && (
                <>
                  <Typography variant="body2">
                    Before: comparison backup → After: selected backup.
                  </Typography>
                  <Differences values={diffObjects(normalize(before), normalize(item.manifest))} />
                </>
              )}
              {tab === 'recover' && (
                <>
                  <Alert severity="warning">
                    Creates exactly this manifest through Kubernetes. Existing objects are rejected.
                    Server metadata, status, owner references and finalizers are removed.
                    Controllers may recreate dependent objects. This does not restore volume data or
                    execute Velero restore hooks; use a Velero restore for pods and volumes.
                  </Alert>
                  <Typography variant="body2">Target cluster: {cluster}</Typography>
                  {item.manifest.metadata.namespace && !review && (
                    <TextField
                      label="Target namespace"
                      value={target}
                      onChange={e => setTarget(e.target.value)}
                      helperText="The target namespace must already exist."
                    />
                  )}
                  {review && (
                    <>
                      <Alert severity="success">
                        Kubernetes dry-run passed. Review the exact object before creating it.
                      </Alert>
                      <JsonBlock value={review.value} />
                    </>
                  )}
                  <Stack direction="row" spacing={1}>
                    {review && (
                      <Button disabled={busy} onClick={() => setReview(undefined)}>
                        Back to edit
                      </Button>
                    )}
                    <Button
                      variant="contained"
                      disabled={
                        busy || !!notice || (!!item.manifest.metadata.namespace && !target.trim())
                      }
                      onClick={recover}
                    >
                      {busy ? 'Working…' : review ? 'Create recovered object' : 'Validate recovery'}
                    </Button>
                  </Stack>
                </>
              )}
            </>
          )}
          {notice && <Alert severity="success">{notice}</Alert>}
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button disabled={busy} onClick={onClose}>
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function Differences({ values }: { values: Difference[] }) {
  return (
    <Box>
      {!values.length ? (
        <Alert severity="success">No differences in the compared fields.</Alert>
      ) : (
        <>
          <Typography variant="body2" sx={{ mb: 1 }}>
            {values.length >= 1000 ? 'First 1,000 differences' : `${values.length} differences`}
          </Typography>
          <SimpleTable
            data={values}
            reflectInURL={false}
            columns={[
              {
                label: 'JSON path',
                getter: (x: Difference) => (
                  <Typography component="code" variant="body2">
                    {x.path}
                  </Typography>
                ),
              },
              {
                label: 'Before',
                getter: (x: Difference) => (
                  <JsonBlock value={x.before === undefined ? '(absent)' : x.before} />
                ),
              },
              {
                label: 'After',
                getter: (x: Difference) => (
                  <JsonBlock value={x.after === undefined ? '(absent)' : x.after} />
                ),
              },
            ]}
          />
        </>
      )}
    </Box>
  );
}
