import '@xyflow/react/dist/base.css';
import { Icon } from '@iconify/react';
import { K8s, useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { Link } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
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
import { alpha } from '@mui/material/styles';
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
} from '@xyflow/react';
import { useEffect, useMemo, useState } from 'react';
import { stringify } from 'yaml';
import { ResourceActions } from '../actions/ResourceActions';
import { jsonData, ResourceData } from '../common/health';
import Table from '../common/Table';
import { PluralName } from '../helpers/pluralName';
import { resolveInventory } from './api';
import { buildInventoryGraph, InventoryRecord, ObjectRef, objectStatus } from './model';
import { SSAApplyDiff } from './SSAApplyDiff';

const ICONS: Record<string, string> = {
  Namespace: 'mdi:folder-outline',
  Deployment: 'mdi:rocket-launch',
  StatefulSet: 'mdi:database-sync',
  DaemonSet: 'mdi:server-network',
  Service: 'mdi:lan-connect',
  ConfigMap: 'mdi:file-cog',
  Secret: 'mdi:key-variant',
  PersistentVolumeClaim: 'mdi:database',
  Kustomization: 'mdi:kubernetes',
  HelmRelease: 'mdi:ferry',
  GitRepository: 'mdi:git',
  HelmRepository: 'mdi:archive-outline',
  OCIRepository: 'mdi:package-variant',
  CustomResourceDefinition: 'mdi:code-braces',
};

export function InventoryLink({
  record,
}: {
  record: ObjectRef & { object?: ResourceData; plural?: string };
}) {
  const fluxKind = { Kustomization: 'kustomize', HelmRelease: 'helm' }[record.kind];
  const sourceKind = [
    'GitRepository',
    'HelmRepository',
    'HelmChart',
    'OCIRepository',
    'Bucket',
    'ExternalArtifact',
  ].includes(record.kind);
  if (fluxKind || sourceKind)
    return (
      <Link
        routeName={fluxKind || 'source'}
        params={{
          name: record.name,
          namespace: record.namespace,
          pluralName: PluralName(record.kind),
        }}
      >
        {record.name}
      </Link>
    );
  if (record.kind === 'Namespace')
    return (
      <Link routeName="namespace" params={{ name: record.name }}>
        {record.name}
      </Link>
    );
  if (!record.object) return <>{record.name}</>;
  const builtin = K8s.ResourceClasses[record.kind];
  const apiVersions = builtin ? [builtin.apiVersion].flat() : [];
  const matches = apiVersions.some(
    (api: string) => (api.includes('/') ? api.split('/')[0] : '') === record.group
  );
  if (builtin && matches) return <Link kubeObject={new builtin(record.object)}>{record.name}</Link>;
  return (
    <Link
      routeName="customresource"
      params={{
        crName: record.name,
        crd: `${record.plural || PluralName(record.kind)}.${record.group}`,
        namespace: record.namespace || '-',
      }}
    >
      {record.name}
    </Link>
  );
}

function InventoryNode({ data }: { data: any }) {
  const context = data.role === 'source' || data.role === 'dependency';
  const ref = {
    ...data,
    group:
      data.role === 'source'
        ? 'source.toolkit.fluxcd.io'
        : data.kind === 'HelmRelease'
        ? 'helm.toolkit.fluxcd.io'
        : 'kustomize.toolkit.fluxcd.io',
    version: 'v1',
    id: data.name,
  };
  return (
    <Box
      sx={theme => ({
        display: 'flex',
        alignItems: 'center',
        gap: 1.25,
        width: '100%',
        height: '100%',
        boxSizing: 'border-box',
        px: 1.5,
        py: 1,
        borderRadius: 1.5,
        border: '1px solid',
        borderColor: data.selected ? 'primary.main' : 'divider',
        background: theme.palette.background.paper,
        color: theme.palette.text.primary,
        boxShadow: `0 0 0 2px ${alpha(theme.palette.primary.main, data.selected ? 0.2 : 0.04)}`,
      })}
    >
      <Icon icon={ICONS[data.kind] || 'mdi:cube-outline'} width={28} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="caption" display="block" sx={{ opacity: 0.75 }}>
          {data.subtitle || data.kind}
        </Typography>
        <Typography
          component="div"
          variant="body2"
          noWrap
          title={data.name}
          sx={{ fontWeight: 650, '& a': { color: 'inherit' } }}
        >
          {data.role === 'source' || data.role === 'dependency' ? (
            <InventoryLink record={ref} />
          ) : (
            data.name
          )}
        </Typography>
        {data.namespace && (
          <Typography variant="caption" noWrap display="block" sx={{ opacity: 0.75 }}>
            {data.namespace}
          </Typography>
        )}
      </Box>
      {data.status && (
        <Chip
          size="small"
          label={data.status.label}
          color={data.status.color}
          sx={{ height: 23, fontSize: 10, maxWidth: 104 }}
        />
      )}
      {context && (
        <Handle type="source" position={Position.Right} style={{ width: 8, height: 8 }} />
      )}
    </Box>
  );
}
function NamespaceNode({ data }: { data: any }) {
  return (
    <Box
      sx={theme => ({
        height: '100%',
        width: '100%',
        boxSizing: 'border-box',
        border: '1px solid',
        borderColor: 'primary.light',
        borderRadius: 2,
        background: alpha(theme.palette.primary.main, 0.035),
      })}
    >
      <Handle
        type="target"
        position={Position.Left}
        style={{ top: data.contentCenter, width: 8, height: 8 }}
      />
      <Stack direction="row" alignItems="center" spacing={1} sx={{ px: 2, py: 1.5 }}>
        <Icon icon={data.namespace ? 'mdi:folder-outline' : 'mdi:earth'} width={22} />
        <Typography variant="subtitle2" sx={{ flex: 1 }}>
          {data.name}
        </Typography>
        <Chip size="small" label={`${data.count} resources`} />
      </Stack>
    </Box>
  );
}
const nodeTypes = { inventory: InventoryNode, namespace: NamespaceNode };

export function InventoryPanel({
  owner,
  references,
  error: sourceError,
  loading: sourceLoading = false,
}: {
  owner: ResourceData;
  references: ObjectRef[];
  error?: string;
  loading?: boolean;
}) {
  const cluster = K8s.useCluster();
  const { t } = useTranslation();
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ key: string; records: InventoryRecord[] }>({
    key: '',
    records: [],
  });
  const [view, setView] = useState('graph');
  const [search, setSearch] = useState('');
  const [namespace, setNamespace] = useState('*');
  const [kind, setKind] = useState('*');
  const [expanded, setExpanded] = useState(false);
  const [selected, setSelected] = useState<string>();
  const ownerData = jsonData(owner);
  const ownerKey = `${cluster}/${ownerData.kind}/${ownerData.metadata?.namespace}/${ownerData.metadata?.name}`;
  useEffect(() => {
    setNamespace('*');
    setKind('*');
    setSearch('');
    setExpanded(false);
    setSelected(undefined);
  }, [ownerKey]);
  const key = `${cluster}/${references.map(ref => `${ref.id}@${ref.version}`).join('|')}`;
  useEffect(() => {
    const controller = new AbortController();
    const records: InventoryRecord[] = references.map(ref => ({ ...ref, state: 'loading' }));
    setResult({ key, records });
    if (cluster)
      void resolveInventory(
        cluster,
        references,
        record =>
          setResult(previous =>
            previous.key !== key
              ? previous
              : {
                  key,
                  records: previous.records.map(item => (item.id === record.id ? record : item)),
                }
          ),
        controller.signal
      );
    return () => controller.abort();
    // The identity string prevents refetching when only a parent's conditions change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cluster, key, revision]);
  const records =
    result.key === key
      ? result.records
      : references.map(ref => ({ ...ref, state: 'loading' } as InventoryRecord));
  const filtered = records.filter(
    record =>
      (namespace === '*' || (record.namespace || '') === namespace) &&
      (kind === '*' || record.kind === kind) &&
      `${record.kind} ${record.name} ${record.namespace || ''}`
        .toLowerCase()
        .includes(search.toLowerCase())
  );
  const compact = !expanded && filtered.length > 48;
  const graphRecords = compact ? filtered : filtered.slice(0, 160);
  const graph = useMemo(
    () => buildInventoryGraph(owner, graphRecords, compact),
    [owner, graphRecords, compact]
  );
  const selectedRecord = records.find(record => record.id === selected);
  const loaded = records.filter(record => record.state === 'loaded').length;
  const missing = records.filter(record => record.state === 'missing').length;
  const inaccessible = records.filter(record =>
    ['forbidden', 'error'].includes(record.state)
  ).length;
  const pending = sourceLoading || records.some(record => record.state === 'loading');
  return (
    <Stack spacing={2}>
      {sourceError && <Alert severity="warning">{sourceError}</Alert>}
      <Stack direction="row" gap={1} flexWrap="wrap" alignItems="center">
        <Chip size="small" label={`${records.length} ${t('inventory objects')}`} />
        <Chip size="small" color="success" variant="outlined" label={`${loaded} ${t('loaded')}`} />
        {missing > 0 && <Chip size="small" color="error" label={`${missing} ${t('missing')}`} />}
        {inaccessible > 0 && (
          <Chip size="small" color="warning" label={`${inaccessible} ${t('unavailable')}`} />
        )}
        <Button
          size="small"
          onClick={() => setRevision(v => v + 1)}
          disabled={pending || !records.length}
        >
          {t('Refresh status')}
        </Button>
      </Stack>
      {pending && <LinearProgress aria-label="Loading inventory objects" />}
      {!sourceLoading && !sourceError && !references.length && (
        <Alert severity="info">
          {t('No inventory objects have been recorded for this reconciliation.')}
        </Alert>
      )}
      {!!references.length && (
        <>
          <Stack direction={{ xs: 'column', sm: 'row' }} gap={2}>
            <TextField
              size="small"
              label={t('Filter inventory')}
              placeholder={t('Name, kind or namespace')}
              value={search}
              onChange={event => setSearch(event.target.value)}
              fullWidth
            />
            <TextField
              select
              label={t('Namespace')}
              size="small"
              value={namespace}
              onChange={event => setNamespace(event.target.value)}
              sx={{ minWidth: 220 }}
            >
              <MenuItem value="*">{t('All scopes')}</MenuItem>
              {[...new Set(records.map(record => record.namespace || ''))].sort().map(ns => (
                <MenuItem key={ns} value={ns}>
                  {ns || t('Cluster-scoped')}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              label={t('Kind')}
              size="small"
              value={kind}
              onChange={event => setKind(event.target.value)}
              sx={{ minWidth: 190 }}
            >
              <MenuItem value="*">{t('All kinds')}</MenuItem>
              {[...new Set(records.map(record => record.kind))].sort().map(value => (
                <MenuItem key={value} value={value}>
                  {value}
                </MenuItem>
              ))}
            </TextField>
          </Stack>
          {filtered.length > 48 && view === 'graph' && (
            <FormControlLabel
              control={
                <Checkbox
                  checked={expanded}
                  onChange={event => setExpanded(event.target.checked)}
                />
              }
              label={t('Show individual objects instead of kind groups')}
            />
          )}
          <Tabs value={view} onChange={(_, value) => setView(value)}>
            <Tab value="graph" label={t('Relationship diagram')} />
            <Tab value="table" label={t('Inventory table')} />
          </Tabs>
          {view === 'graph' && (
            <>
              {filtered.length > graphRecords.length && (
                <Alert severity="info">
                  {t(
                    'The diagram shows the first 160 matching objects. Filter to focus on a namespace or kind; the table contains every matching object.'
                  )}
                </Alert>
              )}
              <Box
                sx={{
                  height: 520,
                  minHeight: 350,
                  border: '1px solid',
                  borderColor: 'divider',
                  borderRadius: 2,
                  overflow: 'hidden',
                  bgcolor: 'background.default',
                }}
              >
                <ReactFlowProvider>
                  <ReactFlow
                    key={`${search}/${namespace}/${kind}/${compact}`}
                    nodes={
                      graph.nodes.map(node => ({
                        ...node,
                        data: { ...node.data, selected: node.data.record?.id === selected },
                      })) as any
                    }
                    edges={graph.edges.map(edge => ({
                      ...edge,
                      type: 'smoothstep',
                      markerEnd: { type: MarkerType.ArrowClosed },
                      style: { strokeWidth: 1.5 },
                    }))}
                    nodeTypes={nodeTypes}
                    fitView
                    minZoom={0.12}
                    maxZoom={1.8}
                    fitViewOptions={{ padding: 0.15, maxZoom: 1 }}
                    nodesDraggable={false}
                    nodesConnectable={false}
                    onNodeClick={(_, node) => {
                      const data = node.data as any;
                      if (data.record) setSelected(data.record.id);
                      else if (data.role === 'namespace')
                        setNamespace(data.name === 'Cluster-scoped' ? '' : data.name);
                      else if (data.role === 'kind') {
                        setNamespace(data.namespace || '');
                        setKind(data.kind);
                        setExpanded(true);
                      }
                    }}
                    proOptions={{ hideAttribution: true }}
                  >
                    <Background gap={20} size={1} />
                    <Controls showInteractive={false} />
                    <MiniMap
                      nodeColor={node => (node.type === 'namespace' ? '#d5e7f7' : '#90caf9')}
                      pannable
                      zoomable
                    />
                  </ReactFlow>
                </ReactFlowProvider>
              </Box>
              <Typography variant="caption" color="text.secondary">
                {t(
                  'Resources are grouped by namespace. Select a resource to inspect its Flux SSA apply diff. Select a kind group to expand it. Use Refresh status for current values. Stateless objects show Present.'
                )}
              </Typography>
            </>
          )}
          {view === 'table' && (
            <Table
              data={filtered}
              columns={[
                {
                  header: t('Name'),
                  accessorFn: (record: InventoryRecord) => record.name,
                  Cell: ({ row }) => (
                    <InventoryLink record={{ ...row.original, object: row.original.object }} />
                  ),
                },
                { header: t('Kind'), accessorKey: 'kind' },
                {
                  header: t('Namespace'),
                  accessorFn: (record: InventoryRecord) => record.namespace || t('Cluster-scoped'),
                },
                {
                  header: t('Status'),
                  accessorFn: (record: InventoryRecord) => objectStatus(record).label,
                  Cell: ({ row }) => (
                    <Chip
                      size="small"
                      label={objectStatus(row.original).label}
                      color={objectStatus(row.original).color}
                    />
                  ),
                },
                {
                  header: t('Inspect'),
                  Cell: ({ row }) => (
                    <Button size="small" onClick={() => setSelected(row.original.id)}>
                      {t('Inspect')}
                    </Button>
                  ),
                },
              ]}
            />
          )}
        </>
      )}
      {selectedRecord && (
        <ObjectInspector
          key={selectedRecord.id}
          record={selectedRecord}
          cluster={cluster}
          ownerKind={ownerData.kind}
          onClose={() => setSelected(undefined)}
        />
      )}
    </Stack>
  );
}

export function ObjectInspector({
  record,
  cluster,
  ownerKind,
  onClose,
}: {
  record: InventoryRecord;
  cluster: string;
  ownerKind: string;
  onClose: () => void;
}) {
  const [reveal, setReveal] = useState(false);
  const [view, setView] = useState('diff');
  const [revision, setRevision] = useState(0);
  const [current, setCurrent] = useState<InventoryRecord>();
  useEffect(() => {
    const controller = new AbortController();
    setCurrent(undefined);
    void resolveInventory(cluster, [record], value => setCurrent(value), controller.signal);
    return () => controller.abort();
  }, [cluster, record.id, record.version, revision]);
  const value = current?.object;
  const secret = record.kind === 'Secret';
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="lg">
      <DialogTitle>
        {record.kind} · {record.name}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          <Typography variant="body2">
            {record.namespace || 'Cluster-scoped'} · {record.group ? `${record.group}/` : ''}
            {record.version}
          </Typography>
          <Chip
            size="small"
            label={objectStatus(current || { ...record, state: 'loading' }).label}
            color={objectStatus(current || { ...record, state: 'loading' }).color}
          />
          {!current && <LinearProgress aria-label="Loading object field ownership" />}
          {current?.message && <Alert severity="warning">{current.message}</Alert>}
          {value && (
            <>
              <InventoryLink record={{ ...record, object: value }} />
              <ResourceActions resource={{ ...value, cluster }} />
              <Tabs value={view} onChange={(_, value) => setView(value)}>
                <Tab value="diff" label="SSA apply diff" />
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
                <SSAApplyDiff object={value} ownerKind={ownerKind} />
              ) : (
                <Box
                  component="pre"
                  sx={{
                    p: 2,
                    bgcolor: 'action.hover',
                    overflow: 'auto',
                    maxHeight: 500,
                    fontSize: 12,
                  }}
                >
                  <code>{stringify(value)}</code>
                </Box>
              )}
            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={() => setRevision(previous => previous + 1)} disabled={!current}>
          Refresh object
        </Button>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
