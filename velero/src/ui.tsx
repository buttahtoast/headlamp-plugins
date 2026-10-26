import {
  Link,
  Resource,
  SectionBox,
  SimpleTable,
} from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { useCluster } from '@kinvolk/headlamp-plugin/lib/k8s';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  LinearProgress,
  MenuItem,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { downloadArtifact, toggleSchedule } from './api';
import { artifactText } from './archive';
import { ArchiveBrowser } from './ArchiveBrowser';
import { Creation, CreationDialog, JsonBlock } from './CreationDialog';
import { formatNextScheduledRun, parseScheduleAnchor } from './cron';
import { usePermissions, useVelero } from './hooks';
import { Collection, Data, errorMessage, Manifest, phaseColor } from './model';
import { Backup, Restore, Schedule } from './resources';

export type View =
  | 'overview'
  | 'backups'
  | 'schedules'
  | 'restores'
  | 'storage'
  | 'activity'
  | 'backup'
  | 'schedule'
  | 'restore';
const date = (value?: string) => (value ? new Date(value).toLocaleString() : '—');
const scope = (value?: string[]) => (value?.length ? value.join(', ') : 'All');
const canRestore = (value: Manifest) =>
  ['Completed', 'PartiallyFailed'].includes(value.status?.phase);

function nextRun(schedule: Manifest) {
  if (schedule.spec?.paused) return 'Paused';
  if (schedule.status?.phase !== 'Enabled') return 'Unavailable';
  const anchor = [
    schedule.status?.lastBackup,
    schedule.status?.lastSkipped,
    schedule.metadata.creationTimestamp,
  ]
    .filter(Boolean)
    .sort()
    .pop();
  return formatNextScheduledRun(schedule.spec?.schedule, new Date(), parseScheduleAnchor(anchor));
}

export function Phase({ value }: { value?: string }) {
  return (
    <Chip size="small" variant="outlined" color={phaseColor(value)} label={value || 'Unknown'} />
  );
}

function ResourceLink({ item, type }: { item: Manifest; type: 'backup' | 'schedule' | 'restore' }) {
  return (
    <Link
      routeName={`velero-${type}`}
      params={{ namespace: item.metadata.namespace!, name: item.metadata.name }}
    >
      {item.metadata.name}
    </Link>
  );
}

export function VeleroPage({ view }: { view: View }) {
  const cluster = useCluster();
  return cluster ? (
    <Page key={cluster} cluster={cluster} view={view} />
  ) : (
    <Alert severity="info">Select a cluster to use Velero.</Alert>
  );
}

function Page({ cluster, view }: { cluster: string; view: View }) {
  const { namespace: routeNamespace, name } = useParams<{ namespace?: string; name?: string }>();
  const storageKey = `headlamp-velero:${cluster}`;
  const [settings, setSettings] = useState(() => {
    try {
      return {
        namespace: 'velero-system',
        readerService: 'headlamp-velero-reader',
        ...JSON.parse(localStorage.getItem(storageKey) || '{}'),
      };
    } catch {
      return { namespace: 'velero-system', readerService: 'headlamp-velero-reader' };
    }
  });
  const namespace = routeNamespace || settings.namespace;
  const { data, errors, loaded, refresh } = useVelero(cluster, namespace);
  const permissions = usePermissions(cluster, namespace);
  const [creation, setCreation] = useState<Creation>();
  const [inspect, setInspect] = useState<Manifest>();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draft, setDraft] = useState(settings);
  const [notice, setNotice] = useState('');
  const [actionError, setActionError] = useState('');
  const [pauseTarget, setPauseTarget] = useState<Manifest>();
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState('context');
  const [search, setSearch] = useState('');
  const plural =
    view === 'backup'
      ? 'backups'
      : view === 'schedule'
      ? 'schedules'
      : view === 'restore'
      ? 'restores'
      : undefined;
  const selected = plural ? data[plural]?.find(x => x.metadata.name === name) : undefined;
  const backups = data.backups || [];
  const schedules = data.schedules || [];
  const restores = data.restores || [];
  const locations = data.backupstoragelocations || [];
  useEffect(() => {
    setTab('context');
    setNotice('');
    setActionError('');
    setCreation(undefined);
    setPauseTarget(undefined);
    setSearch('');
  }, [cluster, namespace, view, name]);

  function saved(text: string) {
    setNotice(text);
    refresh();
  }
  function matches(value: Manifest) {
    return `${value.metadata.name} ${value.status?.phase || ''} ${
      value.metadata.labels?.['velero.io/schedule-name'] || ''
    }`
      .toLowerCase()
      .includes(search.toLowerCase());
  }
  const failedStorage = locations.filter(x => x.status?.phase !== 'Available');
  const title = plural
    ? `${selected?.kind || view} · ${name}`
    : view === 'overview'
    ? 'Velero'
    : `Velero ${view}`;

  function collectionError(resource: Collection) {
    return errors[resource] ? (
      <Alert severity="error">
        Unable to load {resource} in {namespace}: {errors[resource]}. Check the namespace, Velero
        installation and your Kubernetes permissions.
      </Alert>
    ) : null;
  }

  const content = (
    <Stack spacing={2} sx={{ p: { xs: 1, sm: 2 }, minWidth: 0 }}>
      {!plural && (
        <Stack direction="row" alignItems="center" justifyContent="space-between" gap={2}>
          <Box>
            <Typography variant="h4">{title}</Typography>
            <Typography variant="body2" color="text.secondary">
              {cluster} / {namespace} · Refreshes every 15 seconds
            </Typography>
          </Box>
          <Stack direction="row" spacing={1}>
            <Button onClick={refresh}>Refresh</Button>
            <Button
              variant="outlined"
              onClick={() => {
                setDraft(settings);
                setSettingsOpen(true);
              }}
            >
              Connection
            </Button>
          </Stack>
        </Stack>
      )}
      {plural && (
        <Stack direction="row" spacing={1}>
          <Button onClick={refresh}>Refresh</Button>
          <Typography sx={{ alignSelf: 'center' }} variant="body2" color="text.secondary">
            {cluster} / {namespace}
          </Typography>
        </Stack>
      )}
      {!loaded && <LinearProgress aria-label="Loading Velero resources" />}
      {notice && (
        <Alert severity="success" onClose={() => setNotice('')}>
          {notice}
        </Alert>
      )}
      {actionError && (
        <Alert severity="error" onClose={() => setActionError('')}>
          {actionError}
        </Alert>
      )}
      {failedStorage.map(x => (
        <Alert key={x.metadata.name} severity="warning">
          Storage {x.metadata.name}: {x.status?.phase || 'Unknown'}.{' '}
          {x.status?.message || 'No successful validation is reported.'}
        </Alert>
      ))}
      {['overview', 'backups', 'schedules'].includes(view) && (
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          <Button
            variant="contained"
            disabled={!permissions['create:backups']}
            onClick={() => setCreation({ type: 'backup' })}
          >
            Create backup
          </Button>
          <Button
            variant="outlined"
            disabled={!permissions['create:schedules']}
            onClick={() => setCreation({ type: 'schedule' })}
          >
            Create schedule
          </Button>
        </Stack>
      )}

      {view === 'overview' && (
        <>
          <Grid container spacing={2}>
            {[
              ['Backups', data.backups?.length],
              [
                'Completed backups',
                data.backups?.filter(x => x.status?.phase === 'Completed').length,
              ],
              [
                'Active schedules',
                data.schedules?.filter(x => !x.spec?.paused && x.status?.phase === 'Enabled')
                  .length,
              ],
              [
                'Healthy storage locations',
                data.backupstoragelocations?.filter(x => x.status?.phase === 'Available').length,
              ],
            ].map(([label, count]) => (
              <Grid item xs={6} md={3} key={label}>
                <Card variant="outlined">
                  <CardContent>
                    <Typography color="text.secondary" variant="body2">
                      {label}
                    </Typography>
                    <Typography variant="h3">{count ?? '—'}</Typography>
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </Grid>
          {collectionError('backups')}
          {collectionError('schedules')}
          {collectionError('backupstoragelocations')}
          {loaded && !backups.length && !errors.backups && (
            <Alert severity="info">
              No backups in this Velero namespace. Create a backup or run an existing schedule to
              capture resources. A paused schedule will not run automatically.
            </Alert>
          )}
          <SectionBox title="Recent backups">
            <BackupsTable values={backups.slice(0, 10)} />
          </SectionBox>
          <SectionBox title="Schedules">
            <SchedulesTable
              values={schedules}
              backups={backups}
              onRun={x => setCreation({ type: 'run', source: x })}
              onPause={setPauseTarget}
              canRun={!!permissions['create:backups']}
              canPause={!!permissions['patch:schedules']}
            />
          </SectionBox>
        </>
      )}
      {['backups', 'schedules', 'restores'].includes(view) && (
        <>
          {collectionError(view as Collection)}
          <TextField
            label={`Filter ${view} by name or status`}
            size="small"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {view === 'backups' && <BackupsTable values={backups.filter(matches)} />}
          {view === 'schedules' && (
            <SchedulesTable
              values={schedules.filter(matches)}
              backups={backups}
              onRun={x => setCreation({ type: 'run', source: x })}
              onPause={setPauseTarget}
              canRun={!!permissions['create:backups']}
              canPause={!!permissions['patch:schedules']}
            />
          )}
          {view === 'restores' && <RestoresTable values={restores.filter(matches)} />}
        </>
      )}
      {view === 'storage' && (
        <>
          {collectionError('backupstoragelocations')}
          <SectionBox title="Backup storage locations">
            <SimpleTable
              data={locations}
              reflectInURL={false}
              emptyMessage="No backup storage locations."
              columns={[
                {
                  label: 'Name',
                  getter: (x: Manifest) => (
                    <Button onClick={() => setInspect(x)}>
                      {x.metadata.name}
                      {x.spec?.default ? ' (default)' : ''}
                    </Button>
                  ),
                },
                { label: 'Status', getter: (x: Manifest) => <Phase value={x.status?.phase} /> },
                { label: 'Provider', getter: (x: Manifest) => x.spec?.provider || '—' },
                {
                  label: 'Bucket / prefix',
                  getter: (x: Manifest) =>
                    `${x.spec?.objectStorage?.bucket || '—'} / ${
                      x.spec?.objectStorage?.prefix || ''
                    }`,
                },
                { label: 'Access', getter: (x: Manifest) => x.spec?.accessMode || 'ReadWrite' },
                {
                  label: 'Last validation',
                  getter: (x: Manifest) => date(x.status?.lastValidationTime),
                },
                { label: 'Last sync', getter: (x: Manifest) => date(x.status?.lastSyncedTime) },
              ]}
            />
          </SectionBox>
          {(['volumesnapshotlocations', 'backuprepositories'] as Collection[]).map(resource => (
            <SectionBox
              key={resource}
              title={
                resource === 'volumesnapshotlocations'
                  ? 'Volume snapshot locations'
                  : 'Backup repositories'
              }
            >
              {collectionError(resource)}
              <GenericTable values={data[resource] || []} onInspect={setInspect} />
            </SectionBox>
          ))}
        </>
      )}
      {view === 'activity' && <VolumeActivity data={data} errors={errors} onInspect={setInspect} />}
      {plural && collectionError(plural)}
      {plural && loaded && !selected && !errors[plural] && (
        <Alert severity="info">
          This {view} was not found in {namespace}.
        </Alert>
      )}
      {selected && (
        <>
          <Stack direction="row" gap={1} flexWrap="wrap" alignItems="center">
            <Phase
              value={
                view === 'schedule' && selected.spec?.paused ? 'Paused' : selected.status?.phase
              }
            />
            {view === 'backup' && (
              <Button
                variant="contained"
                disabled={!permissions['create:restores'] || !canRestore(selected)}
                onClick={() => setCreation({ type: 'restore', source: selected })}
              >
                Restore from backup
              </Button>
            )}
            {view === 'schedule' && (
              <>
                <Button
                  variant="contained"
                  disabled={!permissions['create:backups']}
                  onClick={() => setCreation({ type: 'run', source: selected })}
                >
                  Back up now
                </Button>
                <Button
                  variant="outlined"
                  disabled={!permissions['patch:schedules']}
                  onClick={() => setPauseTarget(selected)}
                >
                  {selected.spec?.paused ? 'Resume schedule' : 'Pause schedule'}
                </Button>
              </>
            )}
          </Stack>
          {!!selected.status?.validationErrors?.length && (
            <Alert severity="error">{selected.status.validationErrors.join('\n')}</Alert>
          )}
          {selected.status?.failureReason && (
            <Alert severity="error">{selected.status.failureReason}</Alert>
          )}
          <Tabs value={tab} onChange={(_, value) => setTab(value)} variant="scrollable">
            <Tab value="context" label="Context" />
            {view === 'backup' && <Tab value="contents" label="Contents & diff" />}
            {view !== 'schedule' && <Tab value="artifacts" label="Logs & results" />}
            <Tab value="manifest" label="Full manifest" />
          </Tabs>
          {tab === 'context' && (
            <>
              <Context item={selected} />
              {view === 'schedule' && (
                <SectionBox title="Backup history">
                  <BackupsTable
                    values={backups.filter(
                      x => x.metadata.labels?.['velero.io/schedule-name'] === selected.metadata.name
                    )}
                  />
                  {collectionError('backups')}
                </SectionBox>
              )}
              {view === 'backup' && (
                <>
                  {selected.metadata.labels?.['velero.io/schedule-name'] && (
                    <Link
                      routeName="velero-schedule"
                      params={{
                        namespace,
                        name: selected.metadata.labels['velero.io/schedule-name'],
                      }}
                    >
                      View source schedule: {selected.metadata.labels['velero.io/schedule-name']}
                    </Link>
                  )}
                  <SectionBox title="Related restores">
                    <RestoresTable
                      values={restores.filter(x => x.spec?.backupName === selected.metadata.name)}
                    />
                    {collectionError('restores')}
                  </SectionBox>
                  <VolumeActivity
                    data={data}
                    errors={errors}
                    onInspect={setInspect}
                    backupName={selected.metadata.name}
                  />
                </>
              )}
              {view === 'restore' && (
                <>
                  {selected.spec?.backupName && (
                    <Link
                      routeName="velero-backup"
                      params={{ namespace, name: selected.spec.backupName }}
                    >
                      View source backup: {selected.spec.backupName}
                    </Link>
                  )}
                  {selected.spec?.scheduleName && (
                    <Link
                      routeName="velero-schedule"
                      params={{ namespace, name: selected.spec.scheduleName }}
                    >
                      View source schedule: {selected.spec.scheduleName}
                    </Link>
                  )}
                  <VolumeActivity
                    data={data}
                    errors={errors}
                    onInspect={setInspect}
                    restoreName={selected.metadata.name}
                  />
                </>
              )}
            </>
          )}
          {tab === 'contents' && (
            <ArchiveBrowser
              key={`${cluster}/${namespace}/${selected.metadata.name}`}
              cluster={cluster}
              namespace={namespace}
              backup={selected}
              backups={backups}
              readerService={settings.readerService}
              canDownload={!!permissions['create:downloadrequests']}
            />
          )}
          {tab === 'artifacts' && (
            <Artifacts
              key={`${cluster}/${namespace}/${selected.metadata.name}`}
              cluster={cluster}
              namespace={namespace}
              item={selected}
              readerService={settings.readerService}
              canDownload={!!permissions['create:downloadrequests']}
            />
          )}
          {tab === 'manifest' && <JsonBlock value={selected} />}
        </>
      )}
    </Stack>
  );

  return (
    <>
      {selected && plural ? (
        <Resource.DetailsGrid
          resourceType={view === 'backup' ? Backup : view === 'schedule' ? Schedule : Restore}
          name={selected.metadata.name}
          namespace={namespace}
          cluster={cluster}
          withEvents
          noDefaultActions
        >
          {content}
        </Resource.DetailsGrid>
      ) : (
        content
      )}
      {creation && (
        <CreationDialog
          key={`${cluster}/${namespace}/${creation.type}/${creation.source?.metadata.name || ''}`}
          creation={creation}
          cluster={cluster}
          namespace={namespace}
          locations={locations}
          onClose={() => setCreation(undefined)}
          onSaved={saved}
        />
      )}
      {inspect && (
        <Dialog open onClose={() => setInspect(undefined)} maxWidth="md" fullWidth>
          <DialogTitle>
            {inspect.kind} · {inspect.metadata.name}
          </DialogTitle>
          <DialogContent>
            <JsonBlock value={inspect} />
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setInspect(undefined)}>Close</Button>
          </DialogActions>
        </Dialog>
      )}
      <Dialog
        open={!!pauseTarget}
        onClose={() => !busy && setPauseTarget(undefined)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          {pauseTarget?.spec?.paused ? 'Resume' : 'Pause'} {pauseTarget?.metadata.name}?
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2}>
            <Typography>
              Cluster: {cluster} · Namespace: {namespace}
            </Typography>
            <Typography>
              {pauseTarget?.spec?.paused
                ? 'Velero may create a backup immediately after resuming, according to the schedule configuration.'
                : 'Future scheduled runs stop. Existing backups are retained.'}
            </Typography>
            {actionError && <Alert severity="error">{actionError}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button disabled={busy} onClick={() => setPauseTarget(undefined)}>
            Cancel
          </Button>
          <Button
            variant="contained"
            disabled={busy}
            onClick={async () => {
              if (!pauseTarget) return;
              setBusy(true);
              setActionError('');
              try {
                await toggleSchedule(cluster, pauseTarget);
                saved(
                  `Schedule ${pauseTarget.metadata.name} ${
                    pauseTarget.spec?.paused ? 'resumed' : 'paused'
                  }.`
                );
                setPauseTarget(undefined);
              } catch (err) {
                setActionError(errorMessage(err));
              } finally {
                setBusy(false);
              }
            }}
          >
            Confirm
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog open={settingsOpen} onClose={() => setSettingsOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>Velero connection</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Typography>Saved in this browser for cluster {cluster}.</Typography>
            <TextField
              label="Velero namespace"
              disabled={!!routeNamespace}
              value={draft.namespace}
              onChange={e => setDraft({ ...draft, namespace: e.target.value })}
            />
            <TextField
              label="Artifact reader service"
              helperText="Same namespace, port 8080. Leave empty to download directly from object storage (requires browser connectivity and CORS)."
              value={draft.readerService}
              onChange={e => setDraft({ ...draft, readerService: e.target.value })}
            />
            <Typography variant="body2">
              The reader relays Velero artifacts through the authenticated Kubernetes service proxy.
              It does not require object storage credentials in your browser. Install it with the
              manifests in velero/reader.
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSettingsOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            disabled={!/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(draft.namespace)}
            onClick={() => {
              localStorage.setItem(storageKey, JSON.stringify(draft));
              setSettings(draft);
              setSettingsOpen(false);
            }}
          >
            Save
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

function BackupsTable({ values }: { values: Manifest[] }) {
  return (
    <SimpleTable
      data={values}
      reflectInURL={false}
      emptyMessage="No backups."
      columns={[
        {
          label: 'Name',
          getter: (x: Manifest) => <ResourceLink item={x} type="backup" />,
          sort: (a: Manifest, b: Manifest) => a.metadata.name.localeCompare(b.metadata.name),
        },
        { label: 'Status', getter: (x: Manifest) => <Phase value={x.status?.phase} /> },
        {
          label: 'Schedule',
          getter: (x: Manifest) => x.metadata.labels?.['velero.io/schedule-name'] || 'Manual',
        },
        { label: 'Namespaces', getter: (x: Manifest) => scope(x.spec?.includedNamespaces) },
        {
          label: 'Objects',
          getter: (x: Manifest) =>
            x.status?.progress
              ? `${x.status.progress.itemsBackedUp ?? 0} / ${x.status.progress.totalItems ?? '?'}`
              : '—',
        },
        {
          label: 'Errors / warnings',
          getter: (x: Manifest) => `${x.status?.errors ?? 0} / ${x.status?.warnings ?? 0}`,
        },
        { label: 'Storage', getter: (x: Manifest) => x.spec?.storageLocation || 'Default' },
        {
          label: 'Started',
          getter: (x: Manifest) => date(x.status?.startTimestamp),
          sort: (a: Manifest, b: Manifest) =>
            (a.status?.startTimestamp || '').localeCompare(b.status?.startTimestamp || ''),
        },
        { label: 'Expires', getter: (x: Manifest) => date(x.status?.expiration) },
      ]}
    />
  );
}

function SchedulesTable({
  values,
  backups,
  onRun,
  onPause,
  canRun,
  canPause,
}: {
  values: Manifest[];
  backups: Manifest[];
  onRun: (x: Manifest) => void;
  onPause: (x: Manifest) => void;
  canRun: boolean;
  canPause: boolean;
}) {
  return (
    <SimpleTable
      data={values}
      reflectInURL={false}
      emptyMessage="No schedules."
      columns={[
        { label: 'Name', getter: (x: Manifest) => <ResourceLink item={x} type="schedule" /> },
        {
          label: 'Status',
          getter: (x: Manifest) => <Phase value={x.spec?.paused ? 'Paused' : x.status?.phase} />,
        },
        { label: 'Cron', getter: (x: Manifest) => x.spec?.schedule || '—' },
        { label: 'Next run (estimated)', getter: nextRun },
        {
          label: 'Namespaces',
          getter: (x: Manifest) => scope(x.spec?.template?.includedNamespaces),
        },
        {
          label: 'Last backup',
          getter: (x: Manifest) => {
            const last = backups.find(
              b => b.metadata.labels?.['velero.io/schedule-name'] === x.metadata.name
            );
            return last ? <ResourceLink item={last} type="backup" /> : date(x.status?.lastBackup);
          },
        },
        { label: 'Retention', getter: (x: Manifest) => x.spec?.template?.ttl || 'Server default' },
        {
          label: 'Actions',
          getter: (x: Manifest) => (
            <Stack direction="row" spacing={1}>
              <Button size="small" disabled={!canRun} onClick={() => onRun(x)}>
                Back up now
              </Button>
              <Button size="small" disabled={!canPause} onClick={() => onPause(x)}>
                {x.spec?.paused ? 'Resume' : 'Pause'}
              </Button>
            </Stack>
          ),
        },
      ]}
    />
  );
}

function RestoresTable({ values }: { values: Manifest[] }) {
  return (
    <SimpleTable
      data={values}
      reflectInURL={false}
      emptyMessage="No restores."
      columns={[
        { label: 'Name', getter: (x: Manifest) => <ResourceLink item={x} type="restore" /> },
        { label: 'Status', getter: (x: Manifest) => <Phase value={x.status?.phase} /> },
        {
          label: 'Source',
          getter: (x: Manifest) => x.spec?.backupName || x.spec?.scheduleName || '—',
        },
        { label: 'Namespaces', getter: (x: Manifest) => scope(x.spec?.includedNamespaces) },
        {
          label: 'Objects',
          getter: (x: Manifest) =>
            x.status?.progress
              ? `${x.status.progress.itemsRestored ?? 0} / ${x.status.progress.totalItems ?? '?'}`
              : '—',
        },
        {
          label: 'Errors / warnings',
          getter: (x: Manifest) => `${x.status?.errors ?? 0} / ${x.status?.warnings ?? 0}`,
        },
        { label: 'Started', getter: (x: Manifest) => date(x.status?.startTimestamp) },
      ]}
    />
  );
}

function Context({ item }: { item: Manifest }) {
  const spec = item.kind === 'Schedule' ? item.spec?.template : item.spec;
  const status = item.status || {};
  return (
    <>
      <SectionBox title="Scope and behavior">
        {item.kind === 'Schedule' && (
          <Alert severity="info" sx={{ mb: 2 }}>
            Schedule: {item.spec?.schedule || '—'} · Next run (estimated): {nextRun(item)} · Last
            backup: {date(item.status?.lastBackup)}. Times are shown in your browser’s timezone; the
            Velero server evaluates the schedule.
          </Alert>
        )}
        <Grid container spacing={2}>
          {[
            ['Included namespaces', scope(spec?.includedNamespaces)],
            ['Excluded namespaces', scope(spec?.excludedNamespaces || ['None'])],
            ['Included resource types', scope(spec?.includedResources)],
            ['Excluded resource types', scope(spec?.excludedResources || ['None'])],
            ['Storage location', spec?.storageLocation || 'Server default'],
            ['Retention', spec?.ttl || 'Server default'],
            [
              'Cluster resources',
              spec?.includeClusterResources === undefined
                ? 'Automatic'
                : String(spec.includeClusterResources),
            ],
            [
              'Volume snapshots',
              spec?.snapshotVolumes === undefined ? 'Automatic' : String(spec.snapshotVolumes),
            ],
            ['Filesystem backup by default', String(spec?.defaultVolumesToFsBackup ?? false)],
            ['Snapshot data movement', String(spec?.snapshotMoveData ?? false)],
            ['Started', date(status.startTimestamp)],
            ['Completed', date(status.completionTimestamp)],
            ['Expires', date(status.expiration)],
            ['Errors / warnings', `${status.errors ?? 0} / ${status.warnings ?? 0}`],
            [
              'Volume snapshots completed / attempted',
              `${status.volumeSnapshotsCompleted ?? '—'} / ${
                status.volumeSnapshotsAttempted ?? '—'
              }`,
            ],
            [
              'Item operations completed / attempted',
              `${
                status.backupItemOperationsCompleted ?? status.restoreItemOperationsCompleted ?? '—'
              } / ${
                status.backupItemOperationsAttempted ?? status.restoreItemOperationsAttempted ?? '—'
              }`,
            ],
          ].map(([label, value]) => (
            <Grid key={label} item xs={12} md={6}>
              <Typography variant="body2" color="text.secondary">
                {label}
              </Typography>
              <Typography sx={{ overflowWrap: 'anywhere' }}>{value}</Typography>
            </Grid>
          ))}
        </Grid>
      </SectionBox>
      <SectionBox
        title={item.kind === 'Schedule' ? 'Complete schedule and backup template' : 'Complete spec'}
      >
        <JsonBlock value={item.spec || {}} />
      </SectionBox>
      <SectionBox title="Controller status">
        <JsonBlock value={status} />
      </SectionBox>
    </>
  );
}

function GenericTable({
  values,
  onInspect,
}: {
  values: Manifest[];
  onInspect: (x: Manifest) => void;
}) {
  return (
    <SimpleTable
      data={values}
      reflectInURL={false}
      emptyMessage="No records."
      columns={[
        {
          label: 'Name',
          getter: (x: Manifest) => (
            <Button size="small" onClick={() => onInspect(x)}>
              {x.metadata.name}
            </Button>
          ),
        },
        { label: 'Kind', getter: (x: Manifest) => x.kind },
        { label: 'Phase', getter: (x: Manifest) => <Phase value={x.status?.phase} /> },
        {
          label: 'Related backup / restore',
          getter: (x: Manifest) =>
            x.metadata.labels?.['velero.io/backup-name'] ||
            x.metadata.labels?.['velero.io/restore-name'] ||
            '—',
        },
        {
          label: 'Progress',
          getter: (x: Manifest) =>
            x.status?.progress
              ? `${x.status.progress.bytesDone ?? 0} / ${x.status.progress.totalBytes ?? '?'} bytes`
              : '—',
        },
        {
          label: 'Message',
          getter: (x: Manifest) => x.status?.message || x.status?.failureReason || '—',
        },
      ]}
    />
  );
}

function VolumeActivity({
  data,
  errors,
  onInspect,
  backupName,
  restoreName,
}: {
  data: Partial<Data>;
  errors: Partial<Record<Collection, string>>;
  onInspect: (x: Manifest) => void;
  backupName?: string;
  restoreName?: string;
}) {
  const resources: Collection[] = backupName
    ? ['podvolumebackups', 'datauploads']
    : restoreName
    ? ['podvolumerestores', 'datadownloads']
    : ['podvolumebackups', 'podvolumerestores', 'datauploads', 'datadownloads'];
  const values = resources
    .flatMap(resource => data[resource] || [])
    .filter(x =>
      backupName
        ? x.metadata.labels?.['velero.io/backup-name'] === backupName
        : restoreName
        ? x.metadata.labels?.['velero.io/restore-name'] === restoreName
        : true
    );
  return (
    <SectionBox title="Volume transfers">
      {resources
        .filter(x => errors[x])
        .map(x => (
          <Alert key={x} severity="info" sx={{ mb: 1 }}>
            {x}: {errors[x]}
          </Alert>
        ))}
      <GenericTable values={values} onInspect={onInspect} />
    </SectionBox>
  );
}

function Artifacts({
  cluster,
  namespace,
  item,
  readerService,
  canDownload,
}: {
  cluster: string;
  namespace: string;
  item: Manifest;
  readerService: string;
  canDownload: boolean;
}) {
  const kinds =
    item.kind === 'Backup'
      ? [
          'BackupLog',
          'BackupResults',
          'BackupResourceList',
          'BackupVolumeSnapshots',
          'BackupVolumeInfos',
          'BackupItemOperations',
          'CSIBackupVolumeSnapshots',
          'CSIBackupVolumeSnapshotContents',
        ]
      : [
          'RestoreLog',
          'RestoreResults',
          'RestoreResourceList',
          'RestoreItemOperations',
          'RestoreVolumeInfo',
        ];
  const [kind, setKind] = useState(kinds[0]);
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const controller = useRef<AbortController>();
  useEffect(() => () => controller.current?.abort(), []);
  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={1}>
        <TextField
          select
          label="Artifact"
          size="small"
          value={kind}
          sx={{ minWidth: 240 }}
          disabled={busy}
          onChange={e => {
            setKind(e.target.value);
            setValue('');
            setError('');
          }}
        >
          {kinds.map(x => (
            <MenuItem key={x} value={x}>
              {x}
            </MenuItem>
          ))}
        </TextField>
        <Button
          variant="outlined"
          disabled={busy || !canDownload}
          onClick={async () => {
            const abort = new AbortController();
            controller.current = abort;
            setBusy(true);
            setError('');
            setValue('');
            try {
              const bytes = await downloadArtifact(
                cluster,
                namespace,
                item.metadata.name,
                kind,
                readerService,
                abort.signal
              );
              const text = await artifactText(bytes);
              if (!abort.signal.aborted) {
                try {
                  setValue(JSON.stringify(JSON.parse(text), null, 2));
                } catch {
                  setValue(text);
                }
              }
            } catch (err) {
              if (!abort.signal.aborted) setError(errorMessage(err));
            } finally {
              if (!abort.signal.aborted) setBusy(false);
            }
          }}
        >
          Load artifact
        </Button>
        {busy && (
          <Button
            onClick={() => {
              controller.current?.abort();
              setBusy(false);
            }}
          >
            Cancel
          </Button>
        )}
      </Stack>
      {busy && <LinearProgress />}
      {!canDownload && (
        <Alert severity="info">Permission to create DownloadRequests is required.</Alert>
      )}
      {error && <Alert severity="error">{error}</Alert>}
      {value && <JsonBlock value={value} />}
      <Typography variant="body2" color="text.secondary">
        Available artifacts depend on the Velero version, backup phase and volume backup method.
      </Typography>
    </Stack>
  );
}
