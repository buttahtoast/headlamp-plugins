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
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useEffect, useRef, useState } from 'react';
import { actionClient, Progress } from './client';
import { ActionOptions, capability, cliCommand, referenceKey, Step } from './model';
import { ActionSession, updateSession } from './session';

export function MutationDialog({
  session,
  open,
  editOptions,
  onBack,
}: {
  session: ActionSession;
  open: boolean;
  editOptions?: ActionOptions;
  onBack?: () => void;
}) {
  const [options, setOptions] = useState<ActionOptions>({
    wait: true,
    timeoutMs: 300000,
    ...session.action.options,
    ...editOptions,
  });
  const [targets, setTargets] = useState(session.targets);
  const [steps, setSteps] = useState<Step[]>();
  const [progress, setProgress] = useState<Record<string, Progress>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const controller = useRef<AbortController>();
  const operation = session.action.operation;
  const cap = Object.fromEntries(
    ['source', 'reset', 'force'].map(key => [
      key,
      targets.every(target => capability(target.object)?.[key]),
    ])
  ) as { source: boolean; reset: boolean; force: boolean };
  useEffect(
    () => () => {
      controller.current?.abort();
      updateSession({ busy: false });
    },
    []
  );
  const change = (value: Partial<ActionOptions>) => {
    setOptions(previous => ({ ...previous, ...value }));
    setSteps(undefined);
    setError('');
  };
  const destructive =
    operation === 'delete' || options.force || (operation === 'force-apply' && options.forceApply);
  const expectedConfirmation =
    targets.length === 1 ? targets[0].ref.name : `DELETE ${targets.length}`;

  async function prepare() {
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    updateSession({ busy: true });
    setError('');
    setFinished(false);
    setProgress({});
    try {
      const plan = await actionClient.prepare(
        targets.map(target => target.ref),
        operation,
        options,
        abort.signal
      );
      if (!abort.signal.aborted) setSteps(plan);
    } catch (error) {
      setError(error.message || String(error));
    } finally {
      setBusy(false);
      updateSession({ busy: false });
    }
  }

  async function run() {
    if (!steps) return;
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setRunning(true);
    updateSession({ busy: true });
    setError('');
    setProgress(
      Object.fromEntries(
        steps.map(step => [step.id, { id: step.id, state: 'pending', message: 'Pending' }])
      )
    );
    try {
      await actionClient.execute(
        steps,
        value => setProgress(previous => ({ ...previous, [value.id]: value })),
        abort.signal
      );
    } catch (error) {
      setError(error.message || String(error));
    } finally {
      setBusy(false);
      setRunning(false);
      setFinished(true);
      updateSession({ busy: false });
    }
  }

  function retryFailed() {
    const failed = new Set(
      (steps || [])
        .filter(step => ['failed', 'skipped', 'stopped'].includes(progress[step.id]?.state))
        .map(step => referenceKey(step.ref))
    );
    setTargets(previous => previous.filter(target => failed.has(referenceKey(target.ref))));
    setSteps(undefined);
    setProgress({});
    setFinished(false);
    setError('');
    setConfirmation('');
  }

  const failedRoots = targets.some(target =>
    steps?.some(
      step =>
        referenceKey(step.ref) === referenceKey(target.ref) &&
        ['failed', 'skipped', 'stopped'].includes(progress[step.id]?.state)
    )
  );
  return (
    <Dialog
      open={open}
      onClose={() => !busy && updateSession({ session: undefined, open: false })}
      fullWidth
      maxWidth="md"
    >
      <DialogTitle>
        {session.action.label} · {targets.length} {targets.length === 1 ? 'resource' : 'resources'}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          <Typography variant="body2" color="text.secondary">
            {[...new Set(targets.map(target => target.ref.cluster))].join(', ')} ·{' '}
            {targets.map(target => `${target.ref.namespace}/${target.ref.name}`).join(', ')}
          </Typography>
          {operation === 'delete' && (
            <Alert severity="error">
              Deleting a Kustomization can prune managed objects according to its deletion policy.
              Deleting a HelmRelease can uninstall its chart. GitOps may recreate a deleted
              definition from its source.
            </Alert>
          )}
          {options.force && (
            <Alert severity="warning">
              A forced Helm install or upgrade may replace resources and restart workloads. This is
              a one-off request, equivalent to flux reconcile helmrelease --force.
            </Alert>
          )}
          {operation === 'force-apply' && (
            <Alert severity="warning">
              Kustomization force apply is a persistent setting. It allows recreation of resources
              when immutable fields change.
            </Alert>
          )}
          {options.reset && (
            <Alert severity="info">
              Reset the Helm release failure counters and retry reconciliation using the current
              desired configuration.
            </Alert>
          )}
          {targets.some(
            target => target.object.metadata?.labels?.['kustomize.toolkit.fluxcd.io/name']
          ) &&
            ['suspend', 'resume', 'force-apply', 'edit'].includes(operation) && (
              <Alert severity="info">
                These definitions are managed by GitOps. A later source reconciliation can revert
                direct changes.
              </Alert>
            )}
          {!finished && !running && (
            <>
              {operation === 'reconcile' && (
                <Stack direction="row" flexWrap="wrap" gap={1}>
                  {cap.source && (
                    <FormControlLabel
                      control={
                        <Checkbox
                          disabled={busy}
                          checked={!!options.withSource}
                          onChange={event => change({ withSource: event.target.checked })}
                        />
                      }
                      label="Reconcile source first"
                    />
                  )}
                  {cap.reset && (
                    <FormControlLabel
                      control={
                        <Checkbox
                          disabled={busy}
                          checked={!!options.reset}
                          onChange={event => change({ reset: event.target.checked })}
                        />
                      }
                      label="Reset failure counters"
                    />
                  )}
                  {cap.force && (
                    <FormControlLabel
                      control={
                        <Checkbox
                          disabled={busy}
                          checked={!!options.force}
                          onChange={event => change({ force: event.target.checked })}
                        />
                      }
                      label="Force install / upgrade"
                    />
                  )}
                </Stack>
              )}
              {operation === 'force-apply' && (
                <FormControlLabel
                  control={
                    <Checkbox
                      disabled={busy}
                      checked={!!options.forceApply}
                      onChange={event => change({ forceApply: event.target.checked })}
                    />
                  }
                  label="Enable persistent force apply"
                />
              )}
              {['reconcile', 'resume'].includes(operation) && (
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems="center">
                  <FormControlLabel
                    control={
                      <Checkbox
                        disabled={busy}
                        checked={options.wait !== false}
                        onChange={event => change({ wait: event.target.checked })}
                      />
                    }
                    label="Wait for controller completion"
                  />
                  <TextField
                    size="small"
                    label="Timeout per resource (seconds)"
                    type="number"
                    disabled={busy}
                    value={options.timeoutMs / 1000}
                    inputProps={{ min: 5, max: 3600 }}
                    onChange={event =>
                      change({
                        timeoutMs:
                          Math.max(5, Math.min(3600, Number(event.target.value) || 300)) * 1000,
                      })
                    }
                  />
                </Stack>
              )}
              {options.withSource && (
                <Typography variant="body2">
                  Sources always complete before their dependent reconciliation is requested. Shared
                  sources are reconciled once per run.
                </Typography>
              )}
            </>
          )}
          {busy && (
            <LinearProgress
              aria-label={running ? 'Executing Flux action' : 'Reviewing Flux action'}
            />
          )}
          {error && <Alert severity="error">{error}</Alert>}
          {steps && (
            <>
              {!finished && !running && (
                <Alert severity="success">
                  Permissions and Kubernetes dry-runs passed. Review the exact targets and patches
                  before running this action.
                </Alert>
              )}
              <SimpleTable
                data={steps}
                reflectInURL={false}
                columns={[
                  {
                    label: 'Target',
                    getter: (step: Step) => (
                      <Box>
                        <Typography variant="body2">
                          {step.ref.kind} · {step.ref.namespace}/{step.ref.name}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {step.ref.cluster}
                        </Typography>
                      </Box>
                    ),
                  },
                  {
                    label: 'Operation',
                    getter: (step: Step) =>
                      step.operation === 'reconcile'
                        ? `Reconcile${step.options.reset ? ' + reset' : ''}${
                            step.options.force ? ' + force' : ''
                          }`
                        : step.operation,
                  },
                  {
                    label: 'State',
                    getter: (step: Step) => (
                      <Chip
                        size="small"
                        label={progress[step.id]?.state || 'reviewed'}
                        color={
                          progress[step.id]?.state === 'failed'
                            ? 'error'
                            : progress[step.id]?.state === 'completed'
                            ? 'success'
                            : progress[step.id]?.state === 'running'
                            ? 'info'
                            : 'default'
                        }
                      />
                    ),
                  },
                  {
                    label: 'Result',
                    getter: (step: Step) =>
                      progress[step.id]?.message ||
                      `${step.ref.apiVersion} · ${
                        step.dependencies.length ? 'after source' : 'direct'
                      }`,
                  },
                ]}
              />
              {!running && !finished && (
                <details>
                  <summary>CLI equivalents and patch preview</summary>
                  {steps.map(step => (
                    <Box key={step.id} sx={{ mt: 2 }}>
                      <Box
                        component="pre"
                        sx={{ overflow: 'auto', bgcolor: 'action.hover', p: 1.5, fontSize: 12 }}
                      >
                        {cliCommand(step.snapshot, step.operation, step.options)}
                      </Box>
                      <Box
                        component="pre"
                        sx={{
                          maxHeight: 220,
                          overflow: 'auto',
                          bgcolor: 'action.hover',
                          p: 1.5,
                          fontSize: 12,
                        }}
                      >
                        {JSON.stringify(
                          step.operation === 'delete'
                            ? {
                                delete: `${step.ref.kind} ${step.ref.namespace}/${step.ref.name}`,
                                preconditionUID: step.ref.uid,
                              }
                            : step.preview,
                          null,
                          2
                        )}
                      </Box>
                    </Box>
                  ))}
                </details>
              )}
              {operation === 'delete' && !finished && (
                <TextField
                  label={`Type ${expectedConfirmation} to confirm deletion`}
                  value={confirmation}
                  onChange={event => setConfirmation(event.target.value)}
                  disabled={busy}
                  fullWidth
                />
              )}
            </>
          )}
          {finished && (
            <Alert
              severity={
                Object.values(progress).some(value => value.state === 'failed') ? 'warning' : 'info'
              }
            >
              Run finished. Submitted requests may continue in the controllers; completed
              reconciliations were checked against controller status.
            </Alert>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        {busy ? (
          <>
            <Button onClick={() => updateSession({ open: false })}>Run in background</Button>
            <Button color="warning" onClick={() => controller.current?.abort()}>
              Stop pending work / waiting
            </Button>
          </>
        ) : (
          <>
            <Button onClick={() => updateSession({ session: undefined, open: false })}>
              Close
            </Button>
            {onBack && !finished && <Button onClick={onBack}>Back to editor</Button>}
            {finished && failedRoots && (
              <Button variant="outlined" onClick={retryFailed}>
                Retry failed targets
              </Button>
            )}
            {!finished && (
              <Button
                variant="contained"
                color={destructive ? 'error' : 'primary'}
                disabled={
                  operation === 'delete' && !!steps && confirmation !== expectedConfirmation
                }
                onClick={steps ? run : prepare}
              >
                {steps ? 'Run action' : 'Review action'}
              </Button>
            )}
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}
