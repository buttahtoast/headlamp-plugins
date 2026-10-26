import { Icon } from '@iconify/react';
import { request } from '@kinvolk/headlamp-plugin/lib/ApiProxy';
import {
  Link,
  Resource,
  SectionBox,
  SectionHeader,
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
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  LinearProgress,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { allowed, dashboardRequest, saveCleaner } from './api';
import {
  API_ROOT,
  canRollback,
  cleanerFromEditor,
  dashboardConnectionIssue,
  dashboardPath,
  DashboardSettings,
  defaultSettings,
  effectiveAction,
  errorMessage,
  hasReporting,
  ResourceInfo,
} from './model';
import { recipeObject, recipes } from './recipes';
import { ReportResourceFlow } from './ReportResourceFlow';
import { ResourceActions } from './ResourceActions';
import { Cleaner, CleanerReport } from './resources';
import { applyRollback, prepareRollback } from './rollback';
import { decodeFullResource } from './snapshot';

type View = 'overview' | 'reports' | 'recipes' | 'policy' | 'report';
type Confirmation = {
  title: string;
  description: string;
  run: () => Promise<void>;
  destructive?: boolean;
  preview?: object;
};
type Notice = { severity: 'success' | 'error' | 'warning'; text: string };
const date = (value?: string) => (value ? new Date(value).toLocaleString() : 'Not scheduled');

export function CleanerPage({ view }: { view: View }) {
  const cluster = useCluster();
  return cluster ? (
    <Page key={cluster} cluster={cluster} view={view} />
  ) : (
    <Alert severity="info">Select a cluster to use Cleaner.</Alert>
  );
}

function Page({ cluster, view }: { cluster: string; view: View }) {
  const { name } = useParams<{ name: string }>();
  const usesDashboard = view === 'overview' || view === 'policy';
  const [cleaners, cleanerError] = Cleaner.useList({ cluster, refetchInterval: 5000 });
  const [reports, reportError] = CleanerReport.useList({ cluster, refetchInterval: 5000 });
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('All');
  const [notice, setNotice] = useState<Notice>();
  const [confirm, setConfirm] = useState<Confirmation>();
  const [busy, setBusy] = useState(false);
  const [editor, setEditor] = useState<{
    value: object;
    name?: string;
    readOnly?: boolean;
    title?: string;
  }>();
  const [editorError, setEditorError] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const storageKey = `headlamp.cleaner.dashboard.${cluster}`;
  const [settings, setSettings] = useState<DashboardSettings>(() => {
    try {
      return { ...defaultSettings, ...JSON.parse(localStorage.getItem(storageKey) || '{}') };
    } catch {
      return defaultSettings;
    }
  });
  const [draft, setDraft] = useState(settings);
  const [settingsError, setSettingsError] = useState('');
  const [connection, setConnection] = useState<{ readOnly: boolean; version: string }>();
  const [connectionError, setConnectionError] =
    useState<ReturnType<typeof dashboardConnectionIssue>>();
  const [permissions, setPermissions] = useState({
    create: false,
    update: false,
    delete: false,
    proxy: false,
    checked: false,
    listCleaners: false,
    listReports: false,
  });

  useEffect(() => {
    let active = true;
    setPermissions({
      create: false,
      update: false,
      delete: false,
      proxy: false,
      checked: false,
      listCleaners: false,
      listReports: false,
    });
    Promise.all([
      allowed(cluster, 'cleaners', 'create'),
      allowed(cluster, 'cleaners', 'update'),
      allowed(cluster, 'cleaners', 'delete'),
      allowed(cluster, 'cleaners', 'list'),
      allowed(cluster, 'reports', 'list'),
      !usesDashboard
        ? Promise.resolve(false)
        : allowed(
            cluster,
            'services/proxy',
            'create',
            settings.namespace,
            `http:${settings.service}:${settings.port}`
          ),
    ]).then(([create, update, remove, listCleaners, listReports, proxy]) => {
      if (active)
        setPermissions({
          create,
          update,
          delete: remove,
          proxy,
          checked: true,
          listCleaners,
          listReports,
        });
    });
    return () => {
      active = false;
    };
  }, [cluster, settings, usesDashboard]);

  useEffect(() => {
    let active = true;
    setConnection(undefined);
    setConnectionError(undefined);
    // Only manual policy runs use the dashboard service.
    if (!usesDashboard) return;
    async function check() {
      try {
        const config = await dashboardRequest(cluster, settings, 'config');
        if (typeof config.readOnly !== 'boolean')
          throw new Error('The service did not return a Cleaner dashboard configuration.');
        if (active) {
          setConnection(config);
          setConnectionError(undefined);
        }
      } catch (error) {
        if (active) {
          setConnection(undefined);
          setConnectionError(dashboardConnectionIssue(error));
        }
      }
    }
    check();
    const timer = setInterval(check, 30000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [cluster, settings, usesDashboard]);

  const writableDashboard = !!connection && !connection.readOnly && permissions.proxy;
  const policy = cleaners?.find(item => item.getName() === name);
  const report = reports?.find(item => item.getName() === name);
  const reportFor = (cleaner: Cleaner) =>
    reports?.find(item => item.getName() === cleaner.getName());
  const matching = (reports || []).reduce(
    (sum, item) => sum + (item.spec.resourceInfo?.length || 0),
    0
  );
  const failed = (cleaners || []).filter(item => item.status?.failureMessage).length;
  const openEditor = (value: object, existingName?: string, readOnly = false) => {
    setEditorError('');
    setEditor({ value, name: existingName, readOnly });
  };

  function showFullYaml(item: ResourceInfo) {
    try {
      const value = decodeFullResource(item.fullResource || '');
      const ref = item.resource;
      setNotice(undefined);
      setEditorError('');
      setEditor({
        value,
        readOnly: true,
        title: `Full YAML · ${ref?.kind || 'Resource'} ${
          ref?.namespace ? `${ref.namespace}/` : ''
        }${ref?.name || ''}`,
      });
    } catch (error) {
      setNotice({ severity: 'error', text: `Cannot show captured YAML: ${errorMessage(error)}` });
    }
  }

  async function postDashboard(suffix: string) {
    // Recheck read-only mode at execution time, not only when the page was opened.
    const config = await dashboardRequest(cluster, settings, 'config');
    if (config.readOnly !== false) throw new Error('The Cleaner dashboard is in read-only mode.');
    return dashboardRequest(cluster, settings, suffix, 'POST');
  }

  function runPolicies(items: Cleaner[]) {
    const destructive = items.some(item => effectiveAction(item.spec) !== 'Scan');
    setConfirm({
      title: items.length === 1 ? `Run ${items[0].getName()}?` : `Run ${items.length} policies?`,
      description: `${items
        .map(item => `${item.getName()} (${effectiveAction(item.spec)})`)
        .join(', ')}. Each policy will execute its configured action now. ${
        destructive
          ? 'Delete removes matching resources and Transform updates them.'
          : 'Scan reports matching resources without changing them.'
      }`,
      destructive,
      run: async () => {
        const results = await Promise.allSettled(
          items.map(async item => {
            const latest = await request(
              `${API_ROOT}/cleaners/${encodeURIComponent(item.getName())}`,
              { cluster }
            );
            if (
              latest.metadata.uid !== item.metadata.uid ||
              JSON.stringify(latest.spec) !== JSON.stringify(item.spec)
            ) {
              throw new Error(
                'Policy changed since confirmation. Review the current policy and try again.'
              );
            }
            return postDashboard(`cleaners/${encodeURIComponent(item.getName())}/trigger`);
          })
        );
        const failures = results.flatMap((result, i) =>
          result.status === 'rejected'
            ? [`${items[i].getName()}: ${errorMessage(result.reason)}`]
            : []
        );
        setNotice({
          severity: failures.length ? 'warning' : 'success',
          text: `${results.length - failures.length} of ${
            results.length
          } runs queued. Reports refresh automatically; execution may take a moment.${
            failures.length ? ` Failed: ${failures.join('; ')}` : ''
          }`,
        });
      },
    });
  }

  async function rollback(report: CleanerReport, resource: ResourceInfo) {
    setBusy(true);
    setNotice(undefined);
    try {
      const plan = await prepareRollback(cluster, report.getName(), resource);
      const label = `${plan.resource.kind} ${
        plan.resource.metadata.namespace ? `${plan.resource.metadata.namespace}/` : ''
      }${plan.resource.metadata.name}`;
      setConfirm({
        title: `Restore ${label}?`,
        destructive: true,
        description: `${
          plan.operation === 'create'
            ? 'Recreate this resource'
            : 'Replace the current resource configuration'
        } using the snapshot from ${report.getName()}. This uses your Kubernetes permissions. ${
          plan.operation === 'update' ? 'Changes made since the snapshot will be overwritten. ' : ''
        }The policy schedule remains active.`,
        preview: plan.resource,
        run: async () => {
          await applyRollback(plan);
          setNotice({ severity: 'success', text: `${label} restored from ${report.getName()}.` });
        },
      });
    } catch (error) {
      setNotice({ severity: 'error', text: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  function onSave(editorValue: unknown) {
    try {
      const value = cleanerFromEditor(editorValue, editor?.name);
      const existingName = editor?.name;
      const action = effectiveAction(value.spec);
      setConfirm({
        title: `${existingName ? 'Update' : 'Create'} ${value.metadata.name}?`,
        destructive: action !== 'Scan',
        description: `Action: ${action}. Schedule: ${value.spec.schedule}. ${
          action === 'Scan'
            ? 'This policy reports matches without modifying resources.'
            : 'This policy can modify matching resources as soon as its schedule runs.'
        } Review selectors and Lua before saving.`,
        run: async () => {
          await saveCleaner(cluster, value, existingName);
          setEditor(undefined);
          setNotice({
            severity: 'success',
            text: `Cleaner ${value.metadata.name} saved. The list will refresh automatically.`,
          });
        },
      });
    } catch (error) {
      setEditorError(errorMessage(error));
    }
  }

  async function execute() {
    if (!confirm || busy) return;
    setBusy(true);
    try {
      await confirm.run();
      setConfirm(undefined);
    } catch (error) {
      setNotice({ severity: 'error', text: errorMessage(error) });
      setConfirm(undefined);
    } finally {
      setBusy(false);
    }
  }

  const title =
    view === 'policy' || view === 'report'
      ? name
      : view === 'recipes'
      ? 'Cleaner recipes'
      : view === 'reports'
      ? 'Cleaner reports'
      : 'Cleaner';
  const filteredCleaners = (cleaners || [])
    .filter(
      item =>
        `${item.getName()} ${item.spec.resourcePolicySet.resourceSelectors
          .map(selector => selector.kind)
          .join(' ')}`
          .toLowerCase()
          .includes(search.toLowerCase()) &&
        (filter === 'All' || effectiveAction(item.spec) === filter)
    )
    .sort(
      (a, b) =>
        Number(!!b.status?.failureMessage) - Number(!!a.status?.failureMessage) ||
        (reportFor(b)?.spec.resourceInfo?.length || 0) -
          (reportFor(a)?.spec.resourceInfo?.length || 0) ||
        a.getName().localeCompare(b.getName())
    );

  const content = (
    <Stack spacing={2} sx={{ minWidth: 0 }}>
      {view !== 'policy' && view !== 'report' && (
        <Box>
          <SectionHeader
            title={title}
            actions={[
              usesDashboard && (
                <Button
                  startIcon={<Icon icon="mdi:cog-outline" />}
                  onClick={() => {
                    setDraft(settings);
                    setSettingsError('');
                    setSettingsOpen(true);
                  }}
                >
                  Connection
                </Button>
              ),
              <Button
                startIcon={<Icon icon="mdi:plus" />}
                disabled={!permissions.create}
                onClick={() => openEditor(recipeObject())}
              >
                Create Cleaner
              </Button>,
            ]}
          />
        </Box>
      )}
      {notice && (
        <Alert severity={notice.severity} onClose={() => setNotice(undefined)}>
          {notice.text}
        </Alert>
      )}
      {view !== 'recipes' &&
        permissions.checked &&
        (!permissions.listCleaners || !permissions.listReports) && (
          <Alert severity="warning">
            Read access to{' '}
            {!permissions.listCleaners && !permissions.listReports
              ? 'Cleaner policies and reports'
              : !permissions.listCleaners
              ? 'Cleaner policies'
              : 'Cleaner reports'}{' '}
            is unavailable for your account. An administrator can grant get, list, and watch on the
            cluster-scoped cleaners and reports in apps.projectsveltos.io.
          </Alert>
        )}
      {view !== 'recipes' && cleanerError && (
        <Alert severity="error">
          {cleanerError.status === 404
            ? 'k8s-cleaner CRDs are not installed on this cluster. Install k8s-cleaner to manage policies.'
            : `Cannot read Cleaner policies: ${cleanerError.message}`}
        </Alert>
      )}
      {view !== 'recipes' && reportError && (
        <Alert severity="warning">
          Cannot read reports: {reportError.message}. Report counts are unavailable.
        </Alert>
      )}
      {usesDashboard && connectionError && (
        <Alert
          severity="info"
          action={
            connectionError.canConfigure && (
              <Button
                color="inherit"
                size="small"
                onClick={() => {
                  setDraft(settings);
                  setSettingsOpen(true);
                }}
              >
                Configure
              </Button>
            )
          }
        >
          {connectionError.message}
        </Alert>
      )}
      {usesDashboard && connection?.readOnly && (
        <Alert severity="info">
          The Cleaner dashboard is read-only. Manual runs are disabled. Kubernetes policy edits
          still follow your Kubernetes permissions.
        </Alert>
      )}
      {usesDashboard && connection && !connection.readOnly && !permissions.proxy && (
        <Alert severity="info">
          Manual runs require create permission on the dashboard's services/proxy subresource.
        </Alert>
      )}
      {view !== 'recipes' &&
        !cleaners &&
        !cleanerError &&
        (!permissions.checked || permissions.listCleaners) && (
          <LinearProgress aria-label="Loading Cleaner policies" />
        )}

      {view === 'overview' && (
        <SectionBox title="Policies">
          <Stack direction="row" gap={1} flexWrap="wrap" sx={{ mb: 2 }}>
            <Chip
              size="small"
              variant="outlined"
              label={`Policies: ${permissions.listCleaners && cleaners ? cleaners.length : '—'}`}
            />
            <Chip
              size="small"
              variant="outlined"
              label={`Reported matches: ${permissions.listReports && reports ? matching : '—'}`}
            />
            <Chip
              size="small"
              variant="outlined"
              label={`Reports: ${permissions.listReports && reports ? reports.length : '—'}`}
            />
            {!!failed && <Chip size="small" color="error" label={`Failed policies: ${failed}`} />}
          </Stack>
          <Stack direction={{ xs: 'column', sm: 'row' }} gap={2} sx={{ mb: 2 }}>
            <TextField
              size="small"
              label="Search policies or resource kinds"
              value={search}
              onChange={event => setSearch(event.target.value)}
              sx={{ flex: 1 }}
            />
            <TextField
              select
              size="small"
              label="Action"
              value={filter}
              onChange={event => setFilter(event.target.value)}
              sx={{ minWidth: 150 }}
            >
              {['All', 'Scan', 'Delete', 'Transform'].map(action => (
                <MenuItem key={action} value={action}>
                  {action}
                </MenuItem>
              ))}
            </TextField>
            <Button
              startIcon={<Icon icon="mdi:play-outline" />}
              disabled={!writableDashboard || !cleaners?.length}
              onClick={() => runPolicies(cleaners!)}
            >
              Run all policies
            </Button>
          </Stack>
          <SimpleTable
            data={cleaners ? filteredCleaners : null}
            emptyMessage={
              cleaners?.length
                ? 'No policies match the current filters.'
                : 'No Cleaner policies yet. Start with a Scan recipe from Recipes.'
            }
            reflectInURL={false}
            columns={[
              {
                label: 'Name',
                getter: (item: Cleaner) => (
                  <Link routeName="cleaner-policy" params={{ name: item.getName() }}>
                    {item.getName()}
                  </Link>
                ),
                sort: (item: Cleaner) => item.getName(),
              },
              {
                label: 'Action',
                getter: (item: Cleaner) => <ActionChip action={effectiveAction(item.spec)} />,
              },
              {
                label: 'Resources',
                getter: (item: Cleaner) =>
                  item.spec.resourcePolicySet.resourceSelectors
                    .map(selector => selector.kind)
                    .join(', '),
              },
              { label: 'Schedule', getter: (item: Cleaner) => <code>{item.spec.schedule}</code> },
              {
                label: 'Last scheduled run',
                getter: (item: Cleaner) =>
                  item.status?.lastRunTime ? date(item.status.lastRunTime) : 'Never',
              },
              {
                label: 'Latest report',
                getter: (item: Cleaner) => {
                  const latest = reportFor(item);
                  return latest ? (
                    <Link routeName="cleaner-report" params={{ name: latest.getName() }}>
                      {latest.spec.resourceInfo?.length || 0} matches
                    </Link>
                  ) : reportError ? (
                    'Unavailable'
                  ) : hasReporting(item.spec) ? (
                    'Pending'
                  ) : (
                    'Not enabled'
                  );
                },
              },
              {
                label: 'Status',
                getter: (item: Cleaner) =>
                  item.status?.failureMessage ? (
                    <Typography variant="body2" color="error">
                      {item.status.failureMessage}
                    </Typography>
                  ) : item.status?.lastRunTime ? (
                    'Scheduled'
                  ) : (
                    'Pending'
                  ),
              },
              {
                label: 'Actions',
                getter: (item: Cleaner) => (
                  <Button
                    size="small"
                    disabled={!writableDashboard}
                    onClick={() => runPolicies([item])}
                  >
                    Run now
                  </Button>
                ),
              },
            ]}
          />
        </SectionBox>
      )}

      {view === 'reports' && (
        <SectionBox title="Latest reports">
          <Typography color="text.secondary" sx={{ mb: 2 }}>
            Each run replaces the policy's report. Counts reflect that snapshot, not current
            resource health.
          </Typography>
          <TextField
            size="small"
            fullWidth
            label="Filter reports by policy name"
            value={search}
            onChange={event => setSearch(event.target.value)}
            sx={{ mb: 2 }}
          />
          {!reports && !reportError && (!permissions.checked || permissions.listReports) && (
            <LinearProgress />
          )}
          <SimpleTable
            data={
              reports
                ? reports.filter(item =>
                    item.getName().toLowerCase().includes(search.toLowerCase())
                  )
                : null
            }
            reflectInURL={false}
            emptyMessage="No reports found. Enable a CleanerReport notification on a policy and wait for its next run."
            columns={[
              {
                label: 'Name',
                getter: (item: CleanerReport) => (
                  <Link routeName="cleaner-report" params={{ name: item.getName() }}>
                    {item.getName()}
                  </Link>
                ),
                sort: (item: CleanerReport) => item.getName(),
              },
              {
                label: 'Action',
                getter: (item: CleanerReport) => <ActionChip action={item.spec.action} />,
              },
              {
                label: 'Matches',
                getter: (item: CleanerReport) => item.spec.resourceInfo?.length || 0,
                sort: true,
              },
              {
                label: 'Last scheduled run',
                getter: (item: CleanerReport) => {
                  const time = cleaners?.find(cleaner => cleaner.getName() === item.getName())
                    ?.status?.lastRunTime;
                  return time ? date(time) : 'Unknown';
                },
              },
              {
                label: 'Captured resources',
                getter: (item: CleanerReport) =>
                  (item.spec.resourceInfo || []).filter(info => !!info.fullResource).length,
              },
            ]}
          />
        </SectionBox>
      )}

      {view === 'recipes' && (
        <SectionBox title="Recipes">
          <Alert severity="info" sx={{ mb: 2 }}>
            Starter recipes default to Scan, the default namespace, and a CleanerReport
            notification. Review the YAML and scope before creating a policy.
          </Alert>
          <Grid container spacing={2}>
            {recipes.map(recipe => (
              <Grid item xs={12} md={4} key={recipe.name}>
                <Card variant="outlined" sx={{ height: '100%' }}>
                  <CardContent>
                    <Stack spacing={2}>
                      <Chip size="small" label={recipe.category} sx={{ alignSelf: 'flex-start' }} />
                      <Typography component="h3" variant="subtitle1" fontWeight={600}>
                        {recipe.title}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {recipe.description}
                      </Typography>
                      <Typography variant="body2">
                        {recipe.selector.kind} · hourly · Scan
                      </Typography>
                      <Button
                        variant="outlined"
                        onClick={() =>
                          openEditor(recipeObject(recipe), undefined, !permissions.create)
                        }
                      >
                        Preview recipe
                      </Button>
                    </Stack>
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </Grid>
        </SectionBox>
      )}

      {view === 'policy' &&
        permissions.listCleaners &&
        cleaners &&
        !cleanerError &&
        (policy ? (
          <>
            <Stack direction="row" gap={1} flexWrap="wrap" sx={{ px: { sm: 2 } }}>
              <ActionChip action={effectiveAction(policy.spec)} />
              <Button
                variant="outlined"
                disabled={!writableDashboard}
                onClick={() => runPolicies([policy])}
              >
                Run now
              </Button>
              <Button
                onClick={() => openEditor(policy.jsonData, policy.getName(), !permissions.update)}
              >
                {permissions.update ? 'Edit YAML' : 'View YAML'}
              </Button>
              <Button
                color="error"
                disabled={!permissions.delete}
                onClick={() =>
                  setConfirm({
                    title: `Delete ${policy.getName()}?`,
                    destructive: true,
                    description:
                      'Remove this Cleaner policy and stop its future scheduled runs. This does not undo previous executions.',
                    run: async () => {
                      await request(
                        `${API_ROOT}/cleaners/${encodeURIComponent(policy.getName())}`,
                        {
                          cluster,
                          method: 'DELETE',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            apiVersion: 'v1',
                            kind: 'DeleteOptions',
                            preconditions: {
                              uid: policy.metadata.uid,
                              resourceVersion: policy.metadata.resourceVersion,
                            },
                          }),
                        }
                      );
                      setNotice({ severity: 'success', text: 'Cleaner policy deleted.' });
                    },
                  })
                }
              >
                Delete policy
              </Button>
            </Stack>
            {policy.status?.failureMessage && (
              <Alert severity="error">{policy.status.failureMessage}</Alert>
            )}
            {!hasReporting(policy.spec) && (
              <Alert severity="warning">
                This policy does not generate reports. Add a notification with type CleanerReport to
                its YAML.
              </Alert>
            )}
            <SectionBox title="Schedule and behavior">
              <Grid container spacing={2}>
                {[
                  ['Schedule', policy.spec.schedule],
                  [
                    'Last scheduled run',
                    policy.status?.lastRunTime ? date(policy.status.lastRunTime) : 'Never',
                  ],
                  ['Next run', date(policy.status?.nextScheduleTime)],
                  [
                    'Notifications',
                    policy.spec.notifications
                      ?.map(item => `${item.name} (${item.type})`)
                      .join(', ') || 'None',
                  ],
                ].map(([label, value]) => (
                  <Grid item xs={12} md={6} key={label}>
                    <Typography color="text.secondary" variant="body2">
                      {label}
                    </Typography>
                    <Typography sx={{ overflowWrap: 'anywhere' }}>{value}</Typography>
                  </Grid>
                ))}
              </Grid>
            </SectionBox>
            <SectionBox title="Resource selectors">
              <Stack spacing={2}>
                {policy.spec.resourcePolicySet.resourceSelectors.map((selector, index) => (
                  <Card variant="outlined" key={index}>
                    <CardContent>
                      <Typography variant="h6">
                        {selector.kind}{' '}
                        <Typography component="span" color="text.secondary">
                          {selector.group || 'core'}/{selector.version}
                        </Typography>
                      </Typography>
                      <Typography>
                        Namespace: {selector.namespace || 'All / cluster-scoped'}
                      </Typography>
                      {selector.namespaceSelector && (
                        <Typography>Namespace selector: {selector.namespaceSelector}</Typography>
                      )}
                      {selector.labelFilters?.map((label, i) => (
                        <Chip
                          key={i}
                          size="small"
                          sx={{ mr: 1, my: 1 }}
                          label={`${label.key} ${label.operation} ${label.value || ''}`}
                        />
                      ))}
                      {selector.evaluate && <LuaCode title="Evaluate" code={selector.evaluate} />}
                    </CardContent>
                  </Card>
                ))}
              </Stack>
            </SectionBox>
            {policy.spec.resourcePolicySet.aggregatedSelection && (
              <SectionBox title="Aggregated selection">
                <LuaCode
                  title="Aggregated selection"
                  code={policy.spec.resourcePolicySet.aggregatedSelection}
                />
              </SectionBox>
            )}
            {policy.spec.transform && (
              <SectionBox title="Transform">
                <LuaCode title="Transform" code={policy.spec.transform} />
              </SectionBox>
            )}
            {report && (
              <SectionBox title="Latest report">
                <Stack direction="row" spacing={2}>
                  <Typography>
                    {report.spec.resourceInfo?.length || 0} matches · {report.spec.action}
                  </Typography>
                  <Link routeName="cleaner-report" params={{ name }}>
                    Inspect resources
                  </Link>
                </Stack>
              </SectionBox>
            )}
          </>
        ) : (
          <Alert severity="info">Cleaner policy not found.</Alert>
        ))}

      {view === 'report' &&
        !reports &&
        !reportError &&
        (!permissions.checked || permissions.listReports) && (
          <LinearProgress aria-label="Loading reports" />
        )}
      {view === 'report' &&
        permissions.listReports &&
        reports &&
        !reportError &&
        (report ? (
          <>
            {policy && (
              <Box sx={{ px: { sm: 2 } }}>
                <Link routeName="cleaner-policy" params={{ name }}>
                  View policy
                </Link>
              </Box>
            )}

            <SectionBox
              title="Matching resources"
              subtitle="Latest report snapshot; resources may have changed since this run."
            >
              <ReportResourceFlow
                reportName={report.getName()}
                items={report.spec.resourceInfo || []}
                onFullYaml={showFullYaml}
              />
              <Box sx={{ mt: 3 }}>
                <Matches
                  items={report.spec.resourceInfo || []}
                  onFullYaml={showFullYaml}
                  onRestore={canRollback(report.spec) ? item => rollback(report, item) : undefined}
                  busy={busy}
                />
              </Box>
            </SectionBox>
          </>
        ) : (
          <Alert severity="info">
            No report exists for this policy yet. Enable a CleanerReport notification and wait for a
            run.
          </Alert>
        ))}
    </Stack>
  );

  return (
    <>
      {view === 'report' && report ? (
        <Resource.DetailsGrid
          resourceType={CleanerReport}
          name={report.getName()}
          cluster={cluster}
          noDefaultActions
          withEvents
          actions={[
            <ResourceActions
              label="Report actions"
              actions={[
                {
                  label: 'View YAML',
                  icon: 'mdi:file-code-outline',
                  run: () => openEditor(report.jsonData, undefined, true),
                },
              ]}
            />,
          ]}
          extraInfo={[
            { name: 'Action', value: <ActionChip action={report.spec.action} /> },
            { name: 'Matches', value: report.spec.resourceInfo?.length || 0 },
          ]}
        >
          <Box sx={{ minWidth: 0, width: '100%' }}>{content}</Box>
        </Resource.DetailsGrid>
      ) : view === 'policy' && policy ? (
        <Resource.DetailsGrid
          resourceType={Cleaner}
          name={policy.getName()}
          cluster={cluster}
          noDefaultActions
          withEvents
          extraInfo={[
            { name: 'Action', value: <ActionChip action={effectiveAction(policy.spec)} /> },
          ]}
        >
          <Box sx={{ minWidth: 0, width: '100%' }}>{content}</Box>
        </Resource.DetailsGrid>
      ) : (
        content
      )}

      {editor && (
        <Resource.EditorDialog
          open
          item={editor.value}
          title={
            editor.title ||
            (editor.readOnly ? 'View YAML' : editor.name ? `Edit ${editor.name}` : 'Create Cleaner')
          }
          allowToHideManagedFields={false}
          onClose={() => setEditor(undefined)}
          onSave={editor.readOnly ? null : onSave}
          saveLabel="Review and save"
          errorMessage={editorError}
          // Headlamp 0.45's tab panel has no definite height. Monaco's 100%
          // height then collapses to 5px; give it a bounded flex layout.
          sx={{
            '& .MuiDialog-paper:not(.MuiDialog-paperFullScreen)': {
              height: { xs: 'calc(100dvh - 16px)', sm: 'min(900px, calc(100dvh - 64px))' },
              maxHeight: { xs: 'calc(100dvh - 16px)', sm: 'calc(100dvh - 64px)' },
              width: { xs: 'calc(100% - 16px)', sm: 'calc(100% - 64px)' },
              m: { xs: 1, sm: 4 },
            },
            '& .MuiDialog-paperFullScreen': { height: '100dvh' },
            '& .MuiDialogContent-root': {
              flex: '1 1 0',
              height: 'auto',
              minHeight: 0,
              display: 'flex',
              flexDirection: 'column',
              px: { xs: 2, sm: 3 },
            },
            '& [role="tabpanel"]:not([hidden])': {
              display: 'flex',
              flexDirection: 'column',
              flex: '1 1 0',
              minHeight: 0,
            },
            '& [id^="editor-textarea-"]': {
              flex: '1 1 0',
              height: 'auto',
              minHeight: 0,
            },
            '& .MuiTabs-root': { flexShrink: 0 },
            '& .MuiDialogActions-root': {
              flexShrink: 0,
              flexWrap: 'wrap',
              gap: 1,
              '& > :not(style) ~ :not(style)': { ml: 0 },
              '& > div': { display: { xs: 'none', sm: 'block' } },
              '& button': { whiteSpace: 'nowrap' },
            },
            '& textarea[aria-label$=" Code"]': {
              height: '100%',
              minHeight: 0,
              boxSizing: 'border-box',
              resize: 'none',
            },
          }}
        />
      )}
      <Dialog
        open={!!confirm}
        onClose={() => !busy && setConfirm(undefined)}
        maxWidth={confirm?.preview ? 'md' : 'sm'}
        fullWidth
      >
        <DialogTitle>{confirm?.title}</DialogTitle>
        <DialogContent>
          <Typography sx={{ overflowWrap: 'anywhere' }}>{confirm?.description}</Typography>
          {confirm?.preview && (
            <Box
              component="pre"
              sx={{
                bgcolor: 'action.hover',
                p: 2,
                overflow: 'auto',
                maxHeight: '50vh',
                fontSize: 13,
              }}
            >
              <code>{JSON.stringify(confirm.preview, null, 2)}</code>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button disabled={busy} onClick={() => setConfirm(undefined)}>
            Cancel
          </Button>
          <Button
            variant="contained"
            color={confirm?.destructive ? 'error' : 'primary'}
            disabled={busy}
            onClick={execute}
          >
            {busy ? <CircularProgress size={20} /> : 'Confirm'}
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog open={settingsOpen} onClose={() => setSettingsOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Cleaner dashboard connection</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Typography>
              Used for manual runs through the Kubernetes service proxy. Rollback uses Kubernetes
              directly. Settings are saved in this browser for this cluster.
            </Typography>
            {(['namespace', 'service', 'port'] as const).map(field => (
              <TextField
                key={field}
                label={
                  field === 'namespace'
                    ? 'Namespace'
                    : field === 'service'
                    ? 'Service name'
                    : 'Service port'
                }
                value={draft[field]}
                onChange={event => setDraft({ ...draft, [field]: event.target.value })}
              />
            ))}
            {connection && (
              <Alert severity="success">
                Connected · {connection.version || 'version unknown'}
                {connection.readOnly ? ' · read-only' : ''}
              </Alert>
            )}
            {settingsError && <Alert severity="error">{settingsError}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSettingsOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={() => {
              try {
                dashboardPath(draft, 'config');
                localStorage.setItem(storageKey, JSON.stringify(draft));
                setSettings({ ...draft });
                setSettingsOpen(false);
              } catch (error) {
                setSettingsError(errorMessage(error));
              }
            }}
          >
            Save connection
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

function ActionChip({ action }: { action: string }) {
  return (
    <Chip
      size="small"
      label={action}
      color={action === 'Scan' ? 'info' : action === 'Delete' ? 'error' : 'warning'}
      variant="outlined"
    />
  );
}

function LuaCode({ title, code }: { title: string; code: string }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  return (
    <Box sx={{ mt: 2 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Typography variant="subtitle2">{title} · Lua</Typography>
        <Button
          size="small"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(code);
              setCopied(true);
              setError('');
            } catch {
              setError('Clipboard unavailable. Select and copy the code below.');
            }
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </Stack>
      {error && <Alert severity="info">{error}</Alert>}
      <Box
        component="pre"
        sx={{
          bgcolor: 'action.hover',
          p: 2,
          borderRadius: 1,
          overflow: 'auto',
          fontSize: 13,
          maxHeight: 420,
          m: 0,
        }}
      >
        <code>{code}</code>
      </Box>
    </Box>
  );
}

function Matches({
  items,
  onFullYaml,
  onRestore,
  busy = false,
}: {
  items: ResourceInfo[];
  onFullYaml: (item: ResourceInfo) => void;
  onRestore?: (item: ResourceInfo) => void;
  busy?: boolean;
}) {
  const [search, setSearch] = useState('');
  const filtered = items.filter(item =>
    `${item.resource?.kind || ''} ${item.resource?.namespace || ''} ${item.resource?.name || ''} ${
      item.message || ''
    }`
      .toLowerCase()
      .includes(search.toLowerCase())
  );
  return (
    <Stack spacing={2}>
      <TextField
        size="small"
        label="Filter by name, kind, namespace, or message"
        value={search}
        onChange={event => setSearch(event.target.value)}
      />
      <SimpleTable
        data={filtered}
        reflectInURL={false}
        emptyMessage={
          items.length ? 'No resources match this filter.' : 'No matching resources in this report.'
        }
        columns={[
          { label: 'Name', getter: (item: ResourceInfo) => item.resource?.name || '—', sort: true },
          { label: 'Kind', getter: (item: ResourceInfo) => item.resource?.kind || '—', sort: true },
          {
            label: 'Namespace',
            getter: (item: ResourceInfo) =>
              item.resource ? item.resource.namespace || 'Cluster-scoped' : 'Unknown scope',
            sort: true,
          },
          {
            label: 'Message',
            getter: (item: ResourceInfo) => (
              <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                {item.message || '—'}
              </Typography>
            ),
          },
          {
            label: 'Snapshot',
            getter: (item: ResourceInfo) => (item.fullResource ? 'Captured' : 'None'),
          },
          {
            label: 'Actions',
            getter: (item: ResourceInfo) => (
              <ResourceActions
                label={`Actions for ${item.resource?.kind || 'Resource'} ${
                  item.resource?.namespace ? `${item.resource.namespace}/` : ''
                }${item.resource?.name || 'unnamed resource'}`}
                actions={[
                  {
                    label: 'Full YAML',
                    icon: 'mdi:file-code-outline',
                    disabled: !item.fullResource,
                    run: () => onFullYaml(item),
                  },
                  ...(onRestore
                    ? [
                        {
                          label: 'Restore',
                          icon: 'mdi:backup-restore',
                          disabled: busy || !item.fullResource,
                          run: () => onRestore(item),
                        },
                      ]
                    : []),
                ]}
              />
            ),
          },
        ]}
      />
    </Stack>
  );
}
