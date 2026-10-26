import { Icon } from '@iconify/react';
import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { Link } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { useFilterFunc } from '@kinvolk/headlamp-plugin/lib/Utils';
import {
  Alert,
  Box,
  Button,
  Chip,
  LinearProgress,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { ReactNode, useState } from 'react';
import {
  conditionMessage,
  controllerReady,
  fluxState,
  jsonData,
  ResourceData,
  summarize,
} from '../common/health';
import { useNamespaces } from '../helpers';
import { store } from '../settings';
import { useFluxOverview } from './data';

function Panel({
  title,
  icon,
  children,
  action,
}: {
  title: string;
  icon: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2, minWidth: 0 }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
        <Icon icon={icon} width={20} />
        <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 600, flex: 1 }}>
          {title}
        </Typography>
        {action}
      </Stack>
      {children}
    </Paper>
  );
}

function IconBadge({
  icon,
  tone = 'primary',
  size = 44,
}: {
  icon: string;
  tone?: 'primary' | 'success' | 'error' | 'info' | 'warning';
  size?: number;
}) {
  return (
    <Box
      sx={theme => ({
        width: size,
        height: size,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        borderRadius: 2,
        color: theme.palette[tone].main,
        bgcolor: alpha(theme.palette[tone].main, 0.14),
      })}
    >
      <Icon icon={icon} width={size * 0.55} />
    </Box>
  );
}

export function FluxOverview() {
  const { t } = useTranslation();
  const filter = useFilterFunc<ResourceData>();
  const namespaces = useNamespaces();
  const snapshot = useFluxOverview();
  const groups = snapshot.groups.map(group => ({
    ...group,
    items: group.items?.filter(item => filter(item)) ?? null,
  }));
  const { controllers: deployments, controllerError, loading, updatedAt, refresh } = snapshot;
  const controllers = deployments || [];
  const [show, setShow] = useState(store.get()?.overviewShowFilter || 'configured');
  const all = groups.flatMap(group => group.items || []);
  const stats = summarize(all);
  const failures = all.filter(item => fluxState(item) === 'failed');
  const reconciling = all.filter(item => fluxState(item) === 'reconciling');
  const controllerIssues = controllers.filter(item => !controllerReady(item));
  const unavailable = groups.filter(group => group.error && group.error.status !== 404);
  const issueCount = failures.length + controllerIssues.length;
  const partial = unavailable.length > 0 || !!controllerError;
  const initialLoading = loading && !updatedAt;
  const empty = !stats.total && !controllers.length;
  const tone = issueCount
    ? 'error'
    : loading || partial || stats.unknown || empty
    ? 'warning'
    : 'success';
  const health = initialLoading
    ? t('Loading health…')
    : issueCount
    ? t('{{count}} need attention', { count: issueCount })
    : partial
    ? t('Partial visibility')
    : stats.unknown
    ? t('Status incomplete')
    : empty
    ? t('No Flux resources in this scope')
    : t('Healthy');
  const controllerNamespaces = [...new Set(controllers.map(item => item.metadata.namespace))];
  const version = [
    ...new Set(
      controllers.map(item => item.metadata.labels?.['app.kubernetes.io/version']).filter(Boolean)
    ),
  ].join(', ');
  const categories = ['Reconciliations', 'Sources', 'Image automation', 'Notifications'];
  const namespaceRows = [...new Set(all.map(item => item.metadata.namespace).filter(Boolean))]
    .map(namespace => ({
      namespace,
      stats: summarize(all.filter(item => item.metadata.namespace === namespace)),
    }))
    .sort((a, b) => b.stats.failed - a.stats.failed || b.stats.total - a.stats.total);
  const twoColumns = {
    display: 'grid',
    gap: 2,
    gridTemplateColumns: { xs: 'minmax(0, 1fr)', lg: 'minmax(0, 3fr) minmax(0, 2fr)' },
  };

  return (
    <Box sx={{ display: 'grid', gap: 2, px: { xs: 1, md: 2 }, pt: 2, pb: 8 }}>
      <Paper
        variant="outlined"
        sx={theme => ({
          p: 2.5,
          borderRadius: 2,
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          flexWrap: 'wrap',
          background: `linear-gradient(135deg, ${alpha(
            theme.palette.primary.main,
            0.1
          )} 0%, transparent 60%)`,
        })}
      >
        <IconBadge icon="simple-icons:flux" size={56} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Stack direction="row" gap={1} alignItems="center">
            <Typography variant="h5" component="h1" sx={{ fontWeight: 700 }}>
              Flux
            </Typography>
            {version && <Chip size="small" label={version} color="primary" />}
          </Stack>
          <Typography variant="body2" color="text.secondary">
            {t('GitOps delivery and reconciliation')} ·{' '}
            {namespaces?.length ? namespaces.join(', ') : t('All visible namespaces')}
          </Typography>
        </Box>
        <Chip
          label={health}
          color={tone}
          variant="outlined"
          icon={
            <Icon icon={issueCount ? 'mdi:alert-circle' : 'mdi:check-circle-outline'} width={18} />
          }
        />
        <Button
          size="small"
          variant="outlined"
          onClick={refresh}
          disabled={loading}
          startIcon={<Icon icon="mdi:refresh" />}
        >
          {loading && updatedAt ? t('Refreshing…') : t('Refresh')}
        </Button>
        {updatedAt && (
          <Typography variant="caption" color="text.secondary">
            {t('Updated')} {new Date(updatedAt).toLocaleTimeString()}
          </Typography>
        )}
      </Paper>
      {initialLoading && <LinearProgress aria-label="Loading Flux dashboard" />}
      {!loading && !partial && empty && (
        <Alert severity="info">
          {t(
            'No Flux resources are visible in the current scope. Check the namespace or tenant filter and your cluster selection.'
          )}
        </Alert>
      )}
      {partial && (
        <Alert severity="warning">
          {t(
            'Some resource lists are unavailable. Counts and health cover only the resources visible to your user.'
          )}
          {unavailable
            .map(group => ` ${group.label}: ${group.error.message || group.error.status}.`)
            .join('')}
          {controllerError ? ` ${t('Controllers')}: ${controllerError.message}.` : ''}
        </Alert>
      )}
      <Box
        sx={{
          display: 'grid',
          gap: 2,
          gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
        }}
      >
        {controllers.map(controller => {
          const value = jsonData(controller);
          const desired = value.spec?.replicas ?? 1;
          const ready = value.status?.readyReplicas ?? 0;
          const color = !desired ? 'info' : controllerReady(value) ? 'success' : 'error';
          return (
            <Paper key={controller.metadata.uid} variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
              <Stack direction="row" spacing={1.5} alignItems="center">
                <IconBadge icon="mdi:cog-sync-outline" tone={color} size={40} />
                <Box sx={{ minWidth: 0 }}>
                  <Link
                    routeName="deployment"
                    params={{
                      name: controller.metadata.name,
                      namespace: controller.metadata.namespace,
                    }}
                    sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}
                  >
                    {controller.metadata.name.replace(/-controller$/, '')}
                  </Link>
                  <Typography variant="body2">
                    {!desired ? t('Scaled to zero') : `${ready}/${desired} ${t('ready')}`}
                  </Typography>
                </Box>
              </Stack>
              <LinearProgress
                variant="determinate"
                value={!desired ? 0 : Math.min(100, (ready / desired) * 100)}
                color={color}
                sx={{ my: 1.5, height: 6, borderRadius: 3 }}
              />
              <Typography variant="caption" color="text.secondary">
                {value.spec?.template?.spec?.containers?.[0]?.image?.split(':').pop()} ·{' '}
                {controller.metadata.namespace}
              </Typography>
            </Paper>
          );
        })}
      </Box>
      {!loading && !controllerError && !controllers.length && (
        <Alert severity="info">
          {t('No Flux controller deployments with the usual Flux labels are visible to your user.')}
        </Alert>
      )}
      <Box
        sx={{
          display: 'grid',
          gap: 2,
          gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
        }}
      >
        {[
          {
            label: t('Kustomizations'),
            value: groups[0].items?.length ?? '…',
            caption: `${summarize(groups[0].items || []).inventory} ${t('inventory objects')}`,
            icon: 'mdi:kubernetes',
            route: 'kustomizations',
          },
          {
            label: t('Helm releases'),
            value: groups[1].items?.length ?? '…',
            caption: `${summarize(groups[1].items || []).ready} ${t('ready')}`,
            icon: 'mdi:ferry',
            route: 'helmreleases',
          },
          {
            label: t('Sources'),
            value: groups
              .filter(x => x.category === 'Sources')
              .reduce((n, x) => n + (x.items?.length || 0), 0),
            caption: t('Git, OCI, charts and buckets'),
            icon: 'mdi:source-repository',
            route: 'sources',
          },
          {
            label: t('Suspended'),
            value: stats.suspended,
            caption: t('Reconciliation paused'),
            icon: 'mdi:pause-circle-outline',
          },
        ].map(stat => {
          const content = (
            <Paper
              variant="outlined"
              sx={{
                p: 2,
                borderRadius: 2,
                height: '100%',
                boxSizing: 'border-box',
                display: 'flex',
                alignItems: 'center',
                gap: 2,
              }}
            >
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Typography variant="body2" color="text.secondary">
                  {stat.label}
                </Typography>
                <Typography variant="h4" sx={{ fontWeight: 700 }}>
                  {stat.value}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {stat.caption}
                </Typography>
              </Box>
              <IconBadge icon={stat.icon} />
            </Paper>
          );
          return stat.route ? (
            <Link
              key={stat.label}
              routeName={stat.route}
              sx={{
                textDecoration: 'none',
                color: 'inherit',
                '&:hover': { textDecoration: 'none' },
              }}
            >
              {content}
            </Link>
          ) : (
            <Box key={stat.label}>{content}</Box>
          );
        })}
      </Box>
      <Box sx={twoColumns}>
        <Panel
          title={t('Needs attention')}
          icon="mdi:bell-alert-outline"
          action={issueCount > 0 && <Chip size="small" label={issueCount} color="error" />}
        >
          <Box sx={{ maxHeight: 380, overflow: 'auto' }}>
            {controllerIssues.map(item => (
              <Box key={item.metadata.uid} sx={{ py: 1.25 }}>
                <Link
                  routeName="deployment"
                  params={{ name: item.metadata.name, namespace: item.metadata.namespace }}
                >
                  {item.metadata.name}
                </Link>
                <Typography variant="body2" color="text.secondary">
                  {t('Controller replicas are not ready.')}
                </Typography>
              </Box>
            ))}
            {failures.map(item => (
              <Box
                key={item.metadata.uid}
                sx={{ py: 1.25, borderBottom: '1px solid', borderColor: 'divider' }}
              >
                <Stack direction="row" spacing={1} alignItems="center">
                  <Icon icon="mdi:alert-circle" color="#f44336" width={20} />
                  <FluxResourceLink item={item} />
                </Stack>
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ mt: 0.5, overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}
                >
                  {conditionMessage(item)}
                </Typography>
              </Box>
            ))}
            {!issueCount && (
              <Stack direction="row" spacing={1.5} alignItems="center" sx={{ py: 2 }}>
                <IconBadge
                  icon="mdi:check-circle-outline"
                  tone={loading || partial ? 'warning' : 'success'}
                />
                <Box>
                  <Typography variant="subtitle2">
                    {loading
                      ? t('Checking resources…')
                      : partial
                      ? t('Visibility is incomplete')
                      : t('Nothing needs attention')}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {t('Based on controller readiness and current Flux conditions.')}
                  </Typography>
                </Box>
              </Stack>
            )}
          </Box>
        </Panel>
        <Panel title={t('Namespace readiness')} icon="mdi:folder-check-outline">
          <Box sx={{ maxHeight: 380, overflow: 'auto' }}>
            {namespaceRows.map(row => (
              <Box key={row.namespace} sx={{ mb: 1.5 }}>
                <Stack direction="row" justifyContent="space-between">
                  <Link routeName="namespace" params={{ name: row.namespace }}>
                    {row.namespace}
                  </Link>
                  <Typography variant="body2">
                    {row.stats.ready}/{row.stats.total} {t('ready')}
                  </Typography>
                </Stack>
                <LinearProgress
                  variant="determinate"
                  value={row.stats.total ? (row.stats.ready / row.stats.total) * 100 : 0}
                  color={row.stats.failed ? 'error' : 'success'}
                  sx={{ mt: 0.75, height: 6, borderRadius: 3 }}
                />
                {row.stats.failed > 0 && (
                  <Typography variant="caption" color="error.main">
                    {row.stats.failed} {t('failed')}
                  </Typography>
                )}
              </Box>
            ))}
            {!namespaceRows.length && (
              <Typography color="text.secondary">{t('No visible resources.')}</Typography>
            )}
          </Box>
        </Panel>
      </Box>
      <Box sx={twoColumns}>
        <Panel title={t('Reconciliation activity')} icon="mdi:sync">
          <Stack direction="row" gap={1} flexWrap="wrap">
            <Chip label={`${stats.ready} ${t('Ready')}`} color="success" size="small" />
            <Chip
              label={`${stats.failed} ${t('Failed')}`}
              color={stats.failed ? 'error' : 'default'}
              size="small"
            />
            <Chip label={`${stats.reconciling} ${t('Reconciling')}`} color="info" size="small" />
            <Chip label={`${stats.suspended} ${t('Suspended')}`} color="warning" size="small" />
            {stats.unknown > 0 && <Chip label={`${stats.unknown} ${t('Unknown')}`} size="small" />}
          </Stack>
          {reconciling.slice(0, 5).map(item => (
            <Box key={item.metadata.uid} sx={{ mt: 1.5 }}>
              <FluxResourceLink item={item} />
              <Typography variant="caption" color="text.secondary" display="block">
                {conditionMessage(item)}
              </Typography>
            </Box>
          ))}
        </Panel>
        <Panel title={t('Installation')} icon="mdi:tune-variant">
          <Stack spacing={1}>
            <Typography variant="body2">
              {t('Controller namespaces')}: {controllerNamespaces.join(', ') || '—'}
            </Typography>
            <Typography variant="body2">
              {t('Visible resource types')}:{' '}
              {groups.filter(x => x.items && !x.error && !x.missing).length}
            </Typography>
            <Typography variant="body2">
              {t('Controllers')}:{' '}
              {controllers.filter(x => (jsonData(x).spec?.replicas ?? 1) > 0).length} {t('active')}{' '}
              · {controllers.filter(x => jsonData(x).spec?.replicas === 0).length}{' '}
              {t('scaled to zero')}
            </Typography>
          </Stack>
        </Panel>
      </Box>
      <Panel
        title={t('Resources')}
        icon="mdi:view-grid-outline"
        action={
          <TextField
            select
            size="small"
            label={t('Show')}
            value={show}
            onChange={event => {
              const value = event.target.value as 'configured' | 'all';
              setShow(value);
              store.set({ ...store.get(), overviewShowFilter: value });
            }}
            sx={{ minWidth: 160 }}
          >
            <MenuItem value="configured">{t('Configured')}</MenuItem>
            <MenuItem value="all">{t('All types')}</MenuItem>
          </TextField>
        }
      >
        <Box
          sx={{
            display: 'grid',
            gap: 2,
            gridTemplateColumns: {
              xs: 'minmax(0, 1fr)',
              md: 'repeat(2, minmax(0, 1fr))',
              xl: 'repeat(4, minmax(0, 1fr))',
            },
          }}
        >
          {categories.map(category => (
            <Box key={category}>
              <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
                {t(category)}
              </Typography>
              <Stack spacing={1}>
                {groups
                  .filter(
                    group =>
                      group.category === category &&
                      (show === 'all' ||
                        !group.items ||
                        group.items?.length ||
                        (group.error?.status !== 404 && group.error))
                  )
                  .map(group => {
                    const summary = summarize(group.items || []);
                    return (
                      <Link
                        key={group.id}
                        routeName={group.route}
                        sx={{
                          textDecoration: 'none',
                          color: 'inherit',
                          '&:hover': { textDecoration: 'none' },
                        }}
                      >
                        <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 1.5 }}>
                          <Stack direction="row" spacing={1} alignItems="center">
                            <Icon icon={group.icon} width={22} />
                            <Typography variant="body2" sx={{ flex: 1, fontWeight: 600 }}>
                              {t(group.label)}
                            </Typography>
                            <Typography variant="h6">
                              {group.items ? summary.total : group.error ? '—' : '…'}
                            </Typography>
                          </Stack>
                          <Typography
                            variant="caption"
                            color={summary.failed ? 'error.main' : 'text.secondary'}
                          >
                            {group.missing || group.error?.status === 404
                              ? t('API not installed')
                              : group.error
                              ? t('Unavailable')
                              : `${summary.ready} ${t('ready')} · ${summary.failed} ${t('failed')}${
                                  summary.suspended
                                    ? ` · ${summary.suspended} ${t('suspended')}`
                                    : ''
                                }`}
                          </Typography>
                        </Paper>
                      </Link>
                    );
                  })}
              </Stack>
            </Box>
          ))}
        </Box>
      </Panel>
    </Box>
  );
}

function FluxResourceLink({ item }: { item: any }) {
  const value = jsonData(item);
  const kind = value.kind;
  const params = { name: value.metadata.name, namespace: value.metadata.namespace, pluralName: '' };
  const route =
    kind === 'Kustomization'
      ? 'kustomize'
      : kind === 'HelmRelease'
      ? 'helm'
      : ['Alert', 'Provider', 'Receiver'].includes(kind)
      ? 'notification'
      : ['ImageRepository', 'ImagePolicy', 'ImageUpdateAutomation'].includes(kind)
      ? 'image'
      : 'source';
  params.pluralName =
    (
      {
        GitRepository: 'gitrepositories',
        OCIRepository: 'ocirepositories',
        HelmRepository: 'helmrepositories',
        HelmChart: 'helmcharts',
        Bucket: 'buckets',
        ExternalArtifact: 'externalartifacts',
        ImageRepository: 'imagerepositories',
        ImagePolicy: 'imagepolicies',
        ImageUpdateAutomation: 'imageupdateautomations',
        Alert: 'alerts',
        Provider: 'providers',
        Receiver: 'receivers',
      } as Record<string, string>
    )[kind] || '';
  return (
    <Link routeName={route} params={params} activeCluster={value.cluster}>
      {value.metadata.namespace}/{value.metadata.name}
      <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
        {kind}
      </Typography>
    </Link>
  );
}
