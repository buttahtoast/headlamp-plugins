import { Icon } from '@iconify/react';
import {
  Link,
  Resource,
  SectionBox,
  SimpleTable,
} from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { useFilterFunc } from '@kinvolk/headlamp-plugin/lib/Utils';
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
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { ReactNode, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CreateDialog, exportYaml, RenewDialog } from './actions';
import { CertificateRelations } from './CertificateRelations';
import { useCertManager, useScope } from './hooks';
import {
  Collection,
  collections,
  condition,
  descendants,
  expiry,
  expiryColors,
  expiryOrder,
  expiryText,
  health,
  healthColors,
  healthLabels,
  issuerText,
  Item,
  message,
  needsAttention,
  renewalDue,
  timestamp,
} from './model';
import { resourceClasses } from './resources';

const date = (value?: string) =>
  timestamp(value) === undefined ? '—' : new Date(value!).toLocaleString();
const key = (item: Item) =>
  `${item.cluster}/${
    item.metadata.uid || `${item.kind}/${item.metadata.namespace}/${item.metadata.name}`
  }`;

export function Panel({
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

function Badge({
  icon,
  tone = 'primary',
  size = 44,
}: {
  icon: string;
  tone?: 'primary' | 'success' | 'warning' | 'error' | 'info';
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

export function HealthChip({ item }: { item: Item }) {
  const value = health(item);
  return (
    <Tooltip title={message(item)}>
      <Chip
        size="small"
        variant="outlined"
        label={healthLabels[value]}
        color={healthColors[value]}
      />
    </Tooltip>
  );
}

export function ExpiryChip({
  item,
  warningDays = 30,
  now,
}: {
  item: Item;
  warningDays?: number;
  now?: number;
}) {
  return (
    <Tooltip title={`Not after: ${date(item.status?.notAfter)}`}>
      <Chip
        size="small"
        label={expiryText(item, now)}
        color={expiryColors[expiry(item, warningDays, now)]}
        variant="outlined"
      />
    </Tooltip>
  );
}

function ItemLink({ item, collection }: { item: Item; collection: Collection }) {
  return (
    <Link
      routeName={`cert-manager-${collection}-detail`}
      params={{
        name: item.metadata.name,
        ...(item.metadata.namespace ? { namespace: item.metadata.namespace } : {}),
      }}
      activeCluster={item.cluster}
      sx={{ overflowWrap: 'anywhere' }}
    >
      {item.metadata.name}
    </Link>
  );
}

function IssuerLink({ item }: { item: Item }) {
  const ref = item.spec?.issuerRef;
  if (
    !ref ||
    (ref.group && ref.group !== 'cert-manager.io') ||
    (ref.kind && !['Issuer', 'ClusterIssuer'].includes(ref.kind))
  )
    return <>{issuerText(item)}</>;
  const collection = ref.kind === 'ClusterIssuer' ? 'clusterissuers' : 'issuers';
  return (
    <Link
      routeName={`cert-manager-${collection}-detail`}
      params={{
        name: ref.name,
        ...(collection === 'issuers' ? { namespace: item.metadata.namespace! } : {}),
      }}
      activeCluster={item.cluster}
    >
      {issuerText(item)}
    </Link>
  );
}

export function CertificatesTable({
  items,
  warningDays,
  now,
  onRenew,
  onRelationships,
}: {
  items: Item[];
  warningDays: number;
  now: number;
  onRenew: (item: Item) => void;
  onRelationships?: (item: Item) => void;
}) {
  return (
    <SimpleTable
      data={[...items].sort(expiryOrder)}
      emptyMessage="No certificates match this scope and filter."
      rowsPerPage={[10, 25, 50, 100]}
      defaultSortingColumn={3}
      columns={[
        {
          label: 'Certificate',
          getter: (item: Item) => <ItemLink item={item} collection="certificates" />,
          sort: (item: Item) => item.metadata.name,
        },
        {
          label: 'Namespace / cluster',
          getter: (item: Item) => (
            <>
              <Typography variant="body2">{item.metadata.namespace}</Typography>
              <Typography variant="caption" color="text.secondary">
                {item.cluster}
              </Typography>
            </>
          ),
        },
        { label: 'Status', getter: (item: Item) => <HealthChip item={item} /> },
        {
          label: 'Expiry',
          getter: (item: Item) => (
            <Stack spacing={0.5} alignItems="flex-start">
              <ExpiryChip item={item} warningDays={warningDays} now={now} />
              <Typography variant="caption" color="text.secondary">
                {date(item.status?.notAfter)}
              </Typography>
            </Stack>
          ),
          sort: (item: Item) => timestamp(item.status?.notAfter) ?? 0,
        },
        {
          label: 'Renewal',
          getter: (item: Item) => (
            <Stack spacing={0.5} alignItems="flex-start">
              <Typography variant="body2">{date(item.status?.renewalTime)}</Typography>
              {renewalDue(item, now) && (
                <Chip size="small" color="warning" label="Renewal overdue" />
              )}
            </Stack>
          ),
        },
        { label: 'Issuer', getter: (item: Item) => <IssuerLink item={item} /> },
        {
          label: 'Actions',
          getter: (item: Item) => (
            <Stack direction="row" gap={0.5} flexWrap="wrap">
              {onRelationships && (
                <Button
                  size="small"
                  onClick={() => onRelationships(item)}
                  startIcon={<Icon icon="mdi:graph-outline" />}
                >
                  Relationships
                </Button>
              )}
              <Button
                size="small"
                disabled={condition(item, 'Issuing')?.status === 'True'}
                onClick={() => onRenew(item)}
                startIcon={<Icon icon="mdi:autorenew" />}
              >
                Renew
              </Button>
            </Stack>
          ),
        },
      ]}
    />
  );
}

function ObjectsTable({ items, collection }: { items: Item[]; collection: Collection }) {
  const issuer = collection === 'issuers' || collection === 'clusterissuers';
  return (
    <SimpleTable
      data={items}
      emptyMessage={`No ${collections[collection].label.toLowerCase()} are visible in this scope.`}
      rowsPerPage={[10, 25, 50]}
      columns={[
        {
          label: 'Name',
          getter: (item: Item) => <ItemLink item={item} collection={collection} />,
          sort: (item: Item) => item.metadata.name,
        },
        {
          label: 'Namespace / cluster',
          getter: (item: Item) => (
            <>
              <Typography variant="body2">{item.metadata.namespace || 'Cluster-scoped'}</Typography>
              <Typography variant="caption" color="text.secondary">
                {item.cluster}
              </Typography>
            </>
          ),
        },
        { label: 'Status', getter: (item: Item) => <HealthChip item={item} /> },
        {
          label: issuer ? 'Type' : 'Issuer / DNS name',
          getter: (item: Item) =>
            issuer
              ? ['acme', 'ca', 'selfSigned', 'vault', 'venafi']
                  .filter(type => item.spec?.[type])
                  .join(', ') || 'External'
              : item.spec?.dnsName || <IssuerLink item={item} />,
        },
        {
          label: 'Details',
          getter: (item: Item) => (
            <Typography variant="body2" sx={{ maxWidth: 520, overflowWrap: 'anywhere' }}>
              {message(item)}
            </Typography>
          ),
        },
      ]}
    />
  );
}

function Summary({
  certificates,
  issuers,
  warningDays,
  now,
  loaded,
}: {
  certificates: Item[];
  issuers: Item[];
  warningDays: number;
  now: number;
  loaded: boolean;
}) {
  const expiryCount = (value: string) =>
    certificates.filter(item => expiry(item, warningDays, now) === value).length;
  const ready = certificates.filter(item => health(item) === 'ready').length;
  const issuing = certificates.filter(item => health(item) === 'issuing').length;
  const expired = expiryCount('expired');
  const critical = expiryCount('critical');
  const warning = expiryCount('warning');
  const healthyIssuers = issuers.filter(item => health(item) === 'ready').length;
  const cards = [
    {
      label: 'Certificates',
      total: certificates.length,
      ready,
      all: certificates.length,
      chips: [
        { label: `${ready} ready`, color: 'success', value: ready },
        { label: `${issuing} issuing`, color: 'info', value: issuing },
        {
          label: `${certificates.length - ready - issuing} need attention`,
          color: 'warning',
          value: certificates.length - ready - issuing,
        },
      ],
      footer: 'Current certificate readiness',
    },
    {
      label: 'Expiry risk',
      total: expired + critical + warning,
      ready: certificates.filter(item => expiry(item, warningDays, now) === 'healthy').length,
      all: certificates.length,
      chips: [
        { label: `${expired} expired`, color: 'error', value: expired },
        { label: `${critical} within 7d`, color: 'error', value: critical },
        { label: `${warning} within ${warningDays}d`, color: 'warning', value: warning },
      ],
      footer: `${expiryCount('unknown')} with unknown expiry`,
    },
    {
      label: 'Renewals',
      total: issuing,
      ready: 0,
      all: 0,
      chips: [
        { label: `${issuing} in progress`, color: 'info', value: issuing },
        {
          label: `${certificates.filter(item => renewalDue(item, now)).length} overdue`,
          color: 'warning',
          value: certificates.filter(item => renewalDue(item, now)).length,
        },
      ],
      footer: 'From cert-manager renewalTime',
    },
    {
      label: 'Issuers',
      total: issuers.length,
      ready: healthyIssuers,
      all: issuers.length,
      chips: [
        { label: `${healthyIssuers} ready`, color: 'success', value: healthyIssuers },
        {
          label: `${issuers.length - healthyIssuers} need attention`,
          color: 'warning',
          value: issuers.length - healthyIssuers,
        },
      ],
      footer: 'Namespaced and cluster issuers',
    },
  ];
  return (
    <Box
      sx={{
        display: 'grid',
        gap: 2,
        gridTemplateColumns: {
          xs: '1fr',
          sm: 'repeat(2,minmax(0,1fr))',
          lg: 'repeat(4,minmax(0,1fr))',
        },
      }}
    >
      {cards.map(card => (
        <Paper
          key={card.label}
          variant="outlined"
          sx={{ p: 2.5, textAlign: 'center', borderRadius: 2 }}
        >
          <Typography variant="caption" color="text.secondary">
            {card.label}
          </Typography>
          <Typography variant="h4" sx={{ my: 1 }}>
            {loaded ? card.total : '—'}
          </Typography>
          <Box sx={{ display: 'flex', justifyContent: 'center', my: 1 }}>
            <Box
              role="img"
              aria-label={`${card.ready} of ${card.all} healthy`}
              sx={theme => ({
                height: 52,
                width: 52,
                borderRadius: '50%',
                background: card.all
                  ? `conic-gradient(${theme.palette.success.main} ${
                      (360 * card.ready) / card.all
                    }deg, ${theme.palette.warning.main} 0deg)`
                  : theme.palette.action.hover,
                display: 'grid',
                placeItems: 'center',
              })}
            >
              <Box
                sx={{ height: 36, width: 36, borderRadius: '50%', bgcolor: 'background.paper' }}
              />
            </Box>
          </Box>
          <Stack
            direction="row"
            gap={0.5}
            justifyContent="center"
            flexWrap="wrap"
            sx={{ minHeight: 32 }}
          >
            {card.chips
              .filter(chip => chip.value)
              .map(chip => (
                <Chip
                  key={chip.label}
                  size="small"
                  color={chip.color as 'success' | 'warning' | 'error' | 'info'}
                  label={chip.label}
                />
              ))}
          </Stack>
          <Typography variant="caption" color="text.secondary">
            {card.footer}
          </Typography>
        </Paper>
      ))}
    </Box>
  );
}

export function CertManagerPage({
  collection,
  detail = false,
}: {
  collection?: Collection;
  detail?: boolean;
}) {
  const { namespace } = useParams<{ namespace?: string }>();
  const { scopes, namespaces, clusters } = useScope(detail, detail ? namespace : undefined);
  return clusters.length ? (
    <Page
      key={JSON.stringify(scopes)}
      scopes={scopes}
      namespaces={namespaces}
      clusters={clusters}
      collection={collection}
      detail={detail}
    />
  ) : (
    <Alert severity="info">Select a cluster to use cert-manager.</Alert>
  );
}

function Page({
  scopes,
  namespaces,
  clusters,
  collection,
  detail,
}: ReturnType<typeof useScope> & { collection?: Collection; detail: boolean }) {
  const { results, loading, updatedAt, refresh } = useCertManager(scopes);
  const { namespace, name } = useParams<{ namespace?: string; name?: string }>();
  const filter = useFilterFunc<Item>();
  const [search, setSearch] = useState('');
  const [show, setShow] = useState('all');
  const [warningDays, setWarningDays] = useState(30);
  const [renew, setRenew] = useState<Item>();
  const [relationships, setRelationships] = useState<Item>();
  const [detailResource, setDetailResource] = useState<{ key: string; item: Item }>();
  const [create, setCreate] = useState(false);
  const [notice, setNotice] = useState('');
  const now = Date.now();
  const matches = (item: Item) =>
    filter(item) &&
    `${item.metadata.name} ${item.metadata.namespace || ''} ${item.cluster} ${(
      item.spec?.dnsNames || []
    ).join(' ')} ${item.spec?.dnsName || ''} ${item.spec?.secretName || ''} ${issuerText(
      item
    )} ${message(item)}`
      .toLowerCase()
      .includes(search.toLowerCase());
  const visible = (id: Collection) => (results[id]?.items || []).filter(matches);
  const certificates = visible('certificates');
  const issuers = [...visible('issuers'), ...visible('clusterissuers')];
  const attention = certificates.filter(item => needsAttention(item, warningDays, now));
  const failures = attention.filter(
    item => health(item) === 'failed' || expiry(item, warningDays, now) === 'expired'
  );
  const errors = Object.entries(results).filter(([, result]) => result?.error || result?.missing);
  const issuerIssues = issuers.filter(item => health(item) !== 'ready');
  const issues = failures.length + issuerIssues.length;
  const empty = !certificates.length && !issuers.length;
  const healthLabel = !updatedAt
    ? 'Loading health…'
    : errors.length
    ? 'Partial visibility'
    : issues
    ? `${issues} need attention`
    : empty
    ? 'No resources in this scope'
    : attention.length
    ? `${attention.length} certificates to watch`
    : 'Healthy';
  const tone = issues
    ? 'error'
    : errors.length || attention.length || empty || !updatedAt
    ? 'warning'
    : 'success';
  const filteredCertificates = certificates.filter(
    item =>
      show === 'all' ||
      (show === 'attention' && needsAttention(item, warningDays, now)) ||
      (show === 'issuing' && health(item) === 'issuing') ||
      (show === 'expiring' &&
        ['expired', 'critical', 'warning'].includes(expiry(item, warningDays, now))) ||
      (show === 'unknown' && expiry(item, warningDays, now) === 'unknown')
  );
  const namespacesSummary = [
    ...new Set(certificates.map(item => `${item.cluster}/${item.metadata.namespace}`)),
  ]
    .map(scope => {
      const items = certificates.filter(
        item => `${item.cluster}/${item.metadata.namespace}` === scope
      );
      return {
        scope,
        total: items.length,
        ready: items.filter(item => health(item) === 'ready').length,
        attention: items.filter(item => needsAttention(item, warningDays, now)).length,
      };
    })
    .sort((a, b) => b.attention - a.attention || b.total - a.total);
  const detailKey = `${clusters[0]}/${collection}/${namespace}/${name}`;
  const listed =
    collection && detail
      ? results[collection]?.items.find(
          item => item.metadata.name === name && item.metadata.namespace === namespace
        )
      : undefined;
  const current = detailResource?.key === detailKey ? detailResource.item : listed;
  const relationshipResource =
    relationships &&
    ([current, ...(results.certificates?.items || [])].find(
      item =>
        item?.cluster === relationships.cluster && item.metadata.uid === relationships.metadata.uid
    ) ||
      relationships);
  const related = current
    ? descendants(
        current,
        Object.values(results)
          .flatMap(result => result?.items || [])
          .filter(item => item.cluster === current.cluster)
      )
    : [];
  const twoColumns = {
    display: 'grid',
    gap: 2,
    gridTemplateColumns: { xs: 'minmax(0,1fr)', lg: 'minmax(0,3fr) minmax(0,2fr)' },
  };
  const list = collection ? (
    <SectionBox title={collections[collection].label}>
      {collection === 'certificates' ? (
        <CertificatesTable
          items={filteredCertificates}
          warningDays={warningDays}
          now={now}
          onRenew={setRenew}
          onRelationships={setRelationships}
        />
      ) : (
        <ObjectsTable collection={collection} items={visible(collection)} />
      )}
    </SectionBox>
  ) : null;

  const content = (
    <Box sx={{ display: 'grid', gap: 2, px: { xs: 1, md: 2 }, pt: 2, pb: 8, minWidth: 0 }}>
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
        <Badge icon="mdi:certificate-outline" size={56} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="h5" component="h1" sx={{ fontWeight: 700 }}>
            cert-manager{collection && !detail ? ` · ${collections[collection].label}` : ''}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Certificate operations and expiry visibility ·{' '}
            {namespaces.length ? namespaces.join(', ') : 'All visible namespaces'}
          </Typography>
        </Box>
        <Chip label={healthLabel} color={tone} variant="outlined" />
        <Button
          variant="outlined"
          size="small"
          onClick={refresh}
          disabled={loading}
          startIcon={<Icon icon="mdi:refresh" />}
        >
          {loading && updatedAt ? 'Refreshing…' : 'Refresh'}
        </Button>
        {updatedAt && (
          <Typography variant="caption" color="text.secondary">
            Updated {new Date(updatedAt).toLocaleTimeString()} · every 30s
          </Typography>
        )}
      </Paper>
      {loading && !updatedAt && <LinearProgress aria-label="Loading cert-manager resources" />}
      {notice && (
        <Alert severity="success" onClose={() => setNotice('')}>
          {notice}
        </Alert>
      )}
      {errors.length > 0 && (
        <Alert severity="warning">
          Partial visibility. Counts cover only resources successfully loaded.{' '}
          {errors
            .map(
              ([id, result]) =>
                `${id}: ${result?.error || 'API unavailable in one or more clusters'}`
            )
            .join(' · ')}
        </Alert>
      )}
      {!loading && !errors.length && empty && (
        <Alert severity="info">
          No cert-manager resources match this scope. Check the namespace or tenant filter, cluster
          selection, search and cert-manager installation.
        </Alert>
      )}
      {!detail && (
        <>
          <Stack direction="row" gap={1.5} flexWrap="wrap" alignItems="center">
            <TextField
              size="small"
              label="Search certificates, DNS names, issuers"
              value={search}
              onChange={e => setSearch(e.target.value)}
              sx={{ minWidth: 280, flex: 1 }}
            />
            <TextField
              size="small"
              select
              label="Warning horizon"
              value={warningDays}
              onChange={e => setWarningDays(Number(e.target.value))}
            >
              {[14, 30, 60, 90].map(value => (
                <MenuItem key={value} value={value}>
                  {value} days
                </MenuItem>
              ))}
            </TextField>
            {(!collection || collection === 'certificates') && (
              <>
                <TextField
                  size="small"
                  select
                  label="Show certificates"
                  value={show}
                  onChange={e => setShow(e.target.value)}
                  sx={{ minWidth: 180 }}
                >
                  {[
                    ['all', 'All certificates'],
                    ['attention', 'Needs attention'],
                    ['expiring', 'Expiring / expired'],
                    ['issuing', 'Issuing'],
                    ['unknown', 'Unknown expiry'],
                  ].map(([value, label]) => (
                    <MenuItem key={value} value={value}>
                      {label}
                    </MenuItem>
                  ))}
                </TextField>
                <Button
                  variant="contained"
                  onClick={() => setCreate(true)}
                  startIcon={<Icon icon="mdi:plus" />}
                >
                  Create certificate
                </Button>
              </>
            )}
          </Stack>
          <Summary
            certificates={certificates}
            issuers={issuers}
            warningDays={warningDays}
            now={now}
            loaded={!!updatedAt || !!results.certificates}
          />
        </>
      )}
      {!collection && (
        <>
          <Panel title="Certificate expiry" icon="mdi:calendar-clock">
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Unknown expiry first, then earliest expiry. Critical: within 7 days. Warning: within{' '}
              {warningDays} days. Dates come from Certificate status; endpoint TLS and unmanaged
              Secrets are outside this view.
            </Typography>
            <CertificatesTable
              items={filteredCertificates}
              warningDays={warningDays}
              now={now}
              onRenew={setRenew}
              onRelationships={setRelationships}
            />
          </Panel>
          <Box sx={twoColumns}>
            <Panel
              title="Certificates needing attention"
              icon="mdi:alert-circle-outline"
              action={
                <Chip
                  size="small"
                  label={attention.length}
                  color={attention.length ? 'warning' : 'default'}
                />
              }
            >
              {!attention.length ? (
                <Typography color="text.secondary">
                  {loading ? 'Checking certificates…' : 'No certificate issues in this scope.'}
                </Typography>
              ) : (
                <Stack spacing={1.5}>
                  {attention
                    .slice(0, 8)
                    .sort(expiryOrder)
                    .map(item => (
                      <Box key={key(item)}>
                        <Stack direction="row" gap={1} alignItems="center" flexWrap="wrap">
                          <ItemLink item={item} collection="certificates" />
                          <HealthChip item={item} />
                          <ExpiryChip item={item} warningDays={warningDays} now={now} />
                          {renewalDue(item, now) && (
                            <Chip size="small" color="warning" label="Renewal overdue" />
                          )}
                        </Stack>
                        <Typography
                          variant="body2"
                          color="text.secondary"
                          sx={{ mt: 0.5, overflowWrap: 'anywhere' }}
                        >
                          {item.metadata.namespace} · {message(item)}
                        </Typography>
                      </Box>
                    ))}
                  {attention.length > 8 && (
                    <Typography variant="caption">
                      {attention.length - 8} more. Use the Needs attention filter.
                    </Typography>
                  )}
                </Stack>
              )}
            </Panel>
            <Panel title="Issuer health" icon="mdi:shield-key-outline">
              <Stack spacing={1.5}>
                {issuers.map(item => (
                  <Stack
                    key={key(item)}
                    direction="row"
                    justifyContent="space-between"
                    gap={1}
                    alignItems="center"
                  >
                    <Box>
                      <ItemLink
                        item={item}
                        collection={item.kind === 'ClusterIssuer' ? 'clusterissuers' : 'issuers'}
                      />
                      <Typography variant="caption" display="block" color="text.secondary">
                        {item.metadata.namespace || 'Cluster-scoped'} · {item.cluster}
                      </Typography>
                    </Box>
                    <HealthChip item={item} />
                  </Stack>
                ))}
                {!issuers.length && (
                  <Typography color="text.secondary">No visible issuers.</Typography>
                )}
              </Stack>
            </Panel>
          </Box>
          <Box sx={twoColumns}>
            <Panel title="Namespace readiness" icon="mdi:folder-outline">
              <SimpleTable
                data={namespacesSummary}
                columns={[
                  { label: 'Namespace / cluster', datum: 'scope' },
                  { label: 'Certificates', datum: 'total' },
                  { label: 'Ready', datum: 'ready' },
                  { label: 'Need attention', datum: 'attention' },
                ]}
              />
            </Panel>
            <Panel title="Resources" icon="mdi:view-grid-outline">
              <Stack spacing={1.5}>
                {(Object.keys(collections) as Collection[]).map(id => (
                  <Stack
                    key={id}
                    direction="row"
                    alignItems="center"
                    justifyContent="space-between"
                  >
                    <Link routeName={`cert-manager-${id}`}>
                      <Stack direction="row" alignItems="center" gap={1}>
                        <Icon icon={collections[id].icon} />
                        {collections[id].label}
                      </Stack>
                    </Link>
                    <Chip size="small" label={results[id] ? visible(id).length : '—'} />
                  </Stack>
                ))}
              </Stack>
            </Panel>
          </Box>
        </>
      )}
      {collection && !detail && list}
      {detail &&
        collection &&
        (current ? (
          <>
            <Stack direction="row" gap={1}>
              <Button onClick={() => exportYaml(current)} startIcon={<Icon icon="mdi:download" />}>
                Export YAML
              </Button>
              {collection === 'certificates' && (
                <Button
                  variant="contained"
                  disabled={condition(current, 'Issuing')?.status === 'True'}
                  onClick={() => setRenew(current)}
                  startIcon={<Icon icon="mdi:autorenew" />}
                >
                  Renew now
                </Button>
              )}
            </Stack>
            {collection === 'certificates' && (
              <Panel title="Certificate relationships" icon="mdi:graph-outline">
                <CertificateRelations certificate={current} results={results} />
              </Panel>
            )}
            {collection === 'certificates' && (
              <Panel title="Certificate lifecycle" icon="mdi:certificate-outline">
                <Stack spacing={2}>
                  <Stack direction="row" gap={1}>
                    <HealthChip item={current} />
                    <ExpiryChip item={current} warningDays={warningDays} now={now} />
                  </Stack>
                  <SimpleTable
                    data={[
                      {
                        field: 'DNS names',
                        value: (current.spec?.dnsNames || []).join(', ') || '—',
                      },
                      { field: 'Common name', value: current.spec?.commonName || '—' },
                      { field: 'Issuer', value: <IssuerLink item={current} /> },
                      {
                        field: 'TLS Secret',
                        value: (
                          <Link
                            routeName="secret"
                            activeCluster={current.cluster}
                            params={{
                              namespace: current.metadata.namespace!,
                              name: current.spec?.secretName,
                            }}
                          >
                            {current.spec?.secretName}
                          </Link>
                        ),
                      },
                      { field: 'Valid from', value: date(current.status?.notBefore) },
                      { field: 'Expires', value: date(current.status?.notAfter) },
                      { field: 'Scheduled renewal', value: date(current.status?.renewalTime) },
                      { field: 'Revision', value: current.status?.revision ?? '—' },
                      {
                        field: 'Failed issuance attempts',
                        value: current.status?.failedIssuanceAttempts ?? 0,
                      },
                      { field: 'Last failure', value: date(current.status?.lastFailureTime) },
                      {
                        field: 'Private key',
                        value: `${
                          current.spec?.privateKey?.algorithm || 'Default algorithm'
                        } · rotation ${
                          current.spec?.privateKey?.rotationPolicy || 'controller default'
                        }`,
                      },
                    ]}
                    columns={[
                      { label: 'Field', datum: 'field' },
                      { label: 'Value', datum: 'value' },
                    ]}
                  />
                </Stack>
              </Panel>
            )}
            <Panel title="Conditions" icon="mdi:information-outline">
              <Resource.ConditionsTable resource={current as any} />
            </Panel>
            {related.length > 0 && (
              <Panel title="Related requests, orders and challenges" icon="mdi:source-branch">
                <Stack spacing={2}>
                  {(Object.keys(collections) as Collection[])
                    .filter(id => related.some(item => item.kind === collections[id].kind))
                    .map(id => (
                      <Box key={id}>
                        <Typography variant="subtitle2" sx={{ mb: 1 }}>
                          {collections[id].label}
                        </Typography>
                        <ObjectsTable
                          items={related.filter(item => item.kind === collections[id].kind)}
                          collection={id}
                        />
                      </Box>
                    ))}
                </Stack>
              </Panel>
            )}
          </>
        ) : (
          !loading && (
            <Alert severity="warning">
              The resource is unavailable in the selected scope. Check the list errors, namespace
              filter and Kubernetes permissions.
            </Alert>
          )
        ))}
      {renew && (
        <RenewDialog
          key={key(renew)}
          item={renew}
          onClose={() => setRenew(undefined)}
          onRefresh={refresh}
        />
      )}
      {relationshipResource && (
        <Dialog
          open
          fullWidth
          maxWidth="xl"
          onClose={() => setRelationships(undefined)}
          aria-labelledby="certificate-relationships-dialog-title"
        >
          <DialogTitle id="certificate-relationships-dialog-title">
            Certificate relationships · {relationshipResource.metadata.name}
          </DialogTitle>
          <DialogContent>
            <CertificateRelations certificate={relationshipResource} results={results} />
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setRelationships(undefined)}>Close</Button>
          </DialogActions>
        </Dialog>
      )}
      {create && (
        <CreateDialog
          clusters={clusters}
          namespaces={namespaces}
          onClose={() => setCreate(false)}
          onCreated={() => {
            setNotice('Certificate created. cert-manager will begin issuance.');
            refresh();
          }}
        />
      )}
    </Box>
  );
  return detail && collection && name ? (
    <Resource.DetailsGrid
      resourceType={resourceClasses[collection]}
      cluster={current?.cluster || clusters[0]}
      namespace={namespace}
      name={name}
      withEvents
      onResourceUpdate={resource => {
        if (!resource) return;
        const item = { ...resource.jsonData, cluster: resource.cluster || clusters[0] } as Item;
        setDetailResource(previous =>
          previous?.key === detailKey &&
          previous.item.metadata.uid === item.metadata.uid &&
          previous.item.metadata.resourceVersion === item.metadata.resourceVersion
            ? previous
            : { key: detailKey, item }
        );
      }}
      actions={
        collection === 'certificates'
          ? [
              <Button
                key="relationships"
                variant="outlined"
                disabled={!current}
                onClick={() => current && setRelationships(current)}
                startIcon={<Icon icon="mdi:graph-outline" />}
              >
                Relationships
              </Button>,
            ]
          : undefined
      }
    >
      {content}
    </Resource.DetailsGrid>
  ) : (
    content
  );
}
