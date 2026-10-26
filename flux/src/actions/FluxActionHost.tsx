import { EditorDialog } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import {
  Alert,
  Box,
  Button,
  Chip,
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
import { parse, stringify } from 'yaml';
import { ResourceData } from '../common/health';
import { actionClient } from './client';
import { commandsFor, inspectResource } from './inspection';
import { buildEditPatch, exportResource } from './model';
import { MutationDialog } from './MutationDialog';
import { ActionSession, updateSession, useActionSession } from './session';

const close = () => updateSession({ session: undefined, open: false });

function EditAction({ session, open }: { session: ActionSession; open: boolean }) {
  const [original, setOriginal] = useState<ResourceData>();
  const [edited, setEdited] = useState<ResourceData>();
  const [review, setReview] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const abort = new AbortController();
    actionClient
      .get(session.targets[0].ref, abort.signal)
      .then(value => !abort.signal.aborted && setOriginal(exportResource(value)))
      .catch(error => !abort.signal.aborted && setError(error.message));
    return () => abort.abort();
  }, [session.id]);
  if (review)
    return (
      <MutationDialog
        session={session}
        open={open}
        editOptions={{ original, edited }}
        onBack={() => setReview(false)}
      />
    );
  return (
    <EditorDialog
      open={open}
      cluster={session.targets[0].ref.cluster}
      item={edited || original || null}
      title={`Edit ${session.targets[0].ref.kind} · ${session.targets[0].ref.name}`}
      errorMessage={error}
      saveLabel="Review changes"
      onClose={close}
      onSave={value => {
        try {
          let result = typeof value === 'string' ? parse(value) : value;
          if (Array.isArray(result)) {
            if (result.length !== 1) throw new Error('Edit exactly one resource.');
            result = result[0];
          }
          buildEditPatch(original, result, original);
          setEdited(result);
          setReview(true);
          setError('');
        } catch (error) {
          setError(error.message || String(error));
        }
      }}
    />
  );
}

function InspectionDialog({ session, open }: { session: ActionSession; open: boolean }) {
  const [content, setContent] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  const [selected, setSelected] = useState(0);
  const [namespace, setNamespace] = useState('flux-system');
  const [refresh, setRefresh] = useState(0);
  const [copied, setCopied] = useState(false);
  const view = session.action.id;
  useEffect(() => {
    const abort = new AbortController();
    setBusy(true);
    setError('');
    setContent('');
    const targets = ['events', 'logs'].includes(view)
      ? [session.targets[selected]]
      : session.targets;
    Promise.all(
      targets.map(async target => {
        const value = await inspectResource(target.ref, view, namespace, abort.signal);
        if (view === 'commands') return commandsFor(value as ResourceData);
        if (view === 'status') {
          const object = value as ResourceData;
          return stringify({
            kind: object.kind,
            metadata: {
              name: object.metadata.name,
              namespace: object.metadata.namespace,
              generation: object.metadata.generation,
            },
            spec: { suspend: object.spec?.suspend },
            status: object.status || {},
          });
        }
        if (view === 'logs') return value as string;
        return stringify(view === 'export' ? exportResource(value as ResourceData) : value);
      })
    )
      .then(values => !abort.signal.aborted && setContent(values.join('\n---\n')))
      .catch(error => !abort.signal.aborted && setError(error.message || String(error)))
      .finally(() => !abort.signal.aborted && setBusy(false));
    return () => abort.abort();
  }, [session.id, selected, namespace, refresh]);
  function download() {
    const url = URL.createObjectURL(new Blob([content], { type: 'text/yaml' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `flux-${
      session.targets.length === 1 ? session.targets[0].ref.name : 'resources'
    }-${view}.yaml`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <Dialog open={open} onClose={close} fullWidth maxWidth="lg">
      <DialogTitle>{session.action.label}</DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          <Typography color="text.secondary" variant="body2">
            {session.targets[0].ref.cluster} · {session.targets.length}{' '}
            {session.targets.length === 1 ? 'resource' : 'resources'}
          </Typography>
          {['events', 'logs'].includes(view) && session.targets.length > 1 && (
            <TextField
              select
              label="Resource"
              value={selected}
              onChange={event => setSelected(Number(event.target.value))}
            >
              {session.targets.map((target, index) => (
                <MenuItem key={index} value={index}>
                  {target.ref.kind} · {target.ref.namespace}/{target.ref.name}
                </MenuItem>
              ))}
            </TextField>
          )}
          {view === 'logs' && (
            <TextField
              label="Controller namespace"
              size="small"
              value={namespace}
              onChange={event => setNamespace(event.target.value)}
            />
          )}
          {view === 'commands' && (
            <Alert severity="info">
              The UI executes cluster API operations. Build and diff commands run in your terminal
              with a local Git checkout. Choose your kubeconfig context before running these
              commands.
            </Alert>
          )}
          {view === 'export' && (
            <Alert severity="info">
              Portable resource definitions contain metadata and desired spec. Review referenced
              credentials before sharing exports.
            </Alert>
          )}
          {busy && <LinearProgress />}
          {error && <Alert severity="error">{error}</Alert>}
          <Box
            component="pre"
            sx={{
              whiteSpace: 'pre-wrap',
              overflowWrap: 'anywhere',
              bgcolor: 'action.hover',
              p: 2,
              fontSize: 12,
              maxHeight: '65vh',
              overflow: 'auto',
            }}
          >
            {content}
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={() => setRefresh(value => value + 1)} disabled={busy}>
          Refresh
        </Button>
        <Button
          disabled={!content}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(content);
              setCopied(true);
            } catch {
              setError('Clipboard unavailable. Select and copy the text instead.');
            }
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </Button>
        <Button disabled={!content} onClick={download}>
          Download
        </Button>
        <Button onClick={close}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}

export function FluxActionHost() {
  const { session, busy, open } = useActionSession();
  if (!session) return null;
  return (
    <>
      {!open && (
        <Chip
          label={busy ? 'Flux action running…' : 'Flux action results'}
          color="primary"
          onClick={() => updateSession({ open: true })}
        />
      )}
      {session.action.id === 'edit' ? (
        <EditAction key={session.id} session={session} open={open} />
      ) : session.action.operation ? (
        <MutationDialog key={session.id} session={session} open={open} />
      ) : (
        <InspectionDialog key={session.id} session={session} open={open} />
      )}
    </>
  );
}
