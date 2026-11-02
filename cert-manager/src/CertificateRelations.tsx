import '@xyflow/react/dist/base.css';
import { Icon } from '@iconify/react';
import { Link, SimpleTable } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import {
  Alert,
  Box,
  Chip,
  MenuItem,
  Stack,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import {
  Background,
  BackgroundVariant,
  BaseEdge,
  Controls,
  EdgeProps,
  Handle,
  MarkerType,
  MiniMap,
  NodeProps,
  Position,
  ReactFlow,
  ReactFlowProvider,
} from '@xyflow/react';
import { useId, useMemo, useState } from 'react';
import { Item } from './model';
import {
  certificateRelationships,
  reference,
  referenceId,
  RelationData,
  RelationNode,
  RelationResults,
  relationRoute,
} from './relationships';

const icons: Record<string, string> = {
  Certificate: 'mdi:certificate-outline',
  Issuer: 'mdi:account-key-outline',
  ClusterIssuer: 'mdi:shield-key-outline',
  CertificateRequest: 'mdi:file-sign',
  Order: 'mdi:clipboard-list-outline',
  Challenge: 'mdi:shield-check-outline',
  Secret: 'mdi:key-variant',
  Ingress: 'mdi:transit-connection-variant',
  Gateway: 'mdi:gate',
};

function ResourceLink({ data }: { data: RelationData }) {
  const route = relationRoute(data.ref);
  return route ? (
    <Link routeName={route.name} params={route.params} activeCluster={data.ref.cluster}>
      {data.ref.name}
    </Link>
  ) : (
    <>{data.ref.name}</>
  );
}

function RelationCard({ data }: NodeProps<RelationNode>) {
  return (
    <Box
      sx={theme => ({
        height: '100%',
        width: '100%',
        boxSizing: 'border-box',
        px: 1.5,
        py: 1.25,
        border: '1px solid',
        borderColor: data.role === 'certificate' ? 'primary.main' : 'divider',
        borderRadius: 1.5,
        bgcolor: 'background.paper',
        color: 'text.primary',
        boxShadow: theme.shadows[data.role === 'certificate' ? 3 : 1],
        ...(data.availability !== 'loaded' ? { borderStyle: 'dashed' } : {}),
      })}
    >
      <Handle type="target" position={Position.Left} />
      <Stack direction="row" gap={1} alignItems="center" sx={{ mb: 0.5 }}>
        <Icon icon={icons[data.ref.kind] || 'mdi:cube-outline'} width={22} />
        <Typography variant="caption" sx={{ flex: 1 }}>
          {data.ref.kind === 'CertificateRequest' ? 'CertificateRequest · CSR' : data.ref.kind}
        </Typography>
        <Tooltip
          title={
            data.item
              ? data.item.status?.reason ||
                data.item.status?.conditions
                  ?.map(value => value.message)
                  .filter(Boolean)
                  .join(' · ') ||
                data.status
              : data.availability === 'reference'
              ? 'Declared reference; existence and health are not checked.'
              : data.status
          }
        >
          <Chip
            size="small"
            label={data.status}
            color={data.color}
            sx={{ height: 22, fontSize: 10 }}
          />
        </Tooltip>
      </Stack>
      <Typography
        component="div"
        variant="body2"
        fontWeight={600}
        noWrap
        title={data.ref.name}
        className="nodrag"
      >
        <ResourceLink data={data} />
      </Typography>
      <Typography
        variant="caption"
        color="text.secondary"
        display="block"
        noWrap
        title={
          data.ref.namespace ||
          (data.ref.kind === 'Secret'
            ? 'Controller resource namespace (not resolved)'
            : 'Cluster-scoped')
        }
      >
        {data.ref.namespace ||
          (data.ref.kind === 'Secret' ? 'Controller resource namespace' : 'Cluster-scoped')}
      </Typography>
      <Typography
        variant="caption"
        color="text.secondary"
        display="block"
        noWrap
        title={data.detail}
      >
        {data.detail || data.ref.group || 'Kubernetes core'}
      </Typography>
      <Handle type="source" position={Position.Right} />
    </Box>
  );
}

// References that skip a column take a lane above the cards instead of crossing them.
function RoutedRelation({
  sourceX,
  sourceY,
  targetX,
  targetY,
  data,
  label,
  markerEnd,
  style,
}: EdgeProps) {
  const viaY = typeof data?.viaY === 'number' ? data.viaY : Math.min(sourceY, targetY) - 80;
  const x1 = sourceX + 25;
  const x2 = targetX - 25;
  const path = `M ${sourceX} ${sourceY} L ${x1} ${sourceY} L ${x1} ${viaY} L ${x2} ${viaY} L ${x2} ${targetY} L ${targetX} ${targetY}`;
  return (
    <BaseEdge
      path={path}
      markerEnd={markerEnd}
      style={style}
      label={label}
      labelX={(x1 + x2) / 2}
      labelY={viaY}
      labelStyle={{ fill: style?.stroke }}
    />
  );
}
const nodeTypes = { certificateRelation: RelationCard };
const edgeTypes = { routedRelation: RoutedRelation };

export function CertificateRelations({
  certificate,
  results,
}: {
  certificate: Item;
  results: RelationResults;
}) {
  const theme = useTheme();
  const flowId = `certificate-relations-${useId().replace(/:/g, '')}`;
  const [revision, setRevision] = useState('all');
  const [view, setView] = useState('diagram');
  const graph = useMemo(
    () => certificateRelationships(certificate, results, revision),
    [certificate, results, revision]
  );
  const edges = useMemo(
    () =>
      graph.edges.map(edge => ({
        ...edge,
        markerEnd: { type: MarkerType.ArrowClosed, color: theme.palette.text.secondary },
        style: { ...edge.style, stroke: theme.palette.text.secondary },
        labelStyle: { fill: theme.palette.text.primary, fontSize: 11 },
        labelBgStyle: { fill: theme.palette.background.paper, fillOpacity: 0.95 },
      })),
    [graph.edges, theme]
  );
  const key = graph.nodes.map(node => node.id).join('|');
  const referenceCount = graph.allNodes.filter(
    node => node.data.availability === 'reference'
  ).length;
  return (
    <Stack spacing={2}>
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        gap={2}
        flexWrap="wrap"
      >
        <Stack direction="row" gap={1} flexWrap="wrap">
          <Chip size="small" variant="outlined" label={`${graph.allNodes.length} resources`} />
          <Chip size="small" variant="outlined" label={`${graph.allEdges.length} relations`} />
          {referenceCount > 0 && (
            <Chip size="small" variant="outlined" label={`${referenceCount} references`} />
          )}
        </Stack>
        <TextField
          select
          size="small"
          label="CertificateRequest revision"
          value={
            graph.requests.some(item => referenceId(reference(item)) === revision)
              ? revision
              : 'all'
          }
          onChange={event => setRevision(event.target.value)}
          sx={{ minWidth: 270, maxWidth: '100%' }}
        >
          <MenuItem value="all">All retained revisions</MenuItem>
          {graph.requests.map(item => (
            <MenuItem key={referenceId(reference(item))} value={referenceId(reference(item))}>
              Revision {item.metadata.annotations?.['cert-manager.io/certificate-revision'] || '?'}{' '}
              · {item.metadata.name}
            </MenuItem>
          ))}
        </TextField>
      </Stack>
      <Typography variant="body2" color="text.secondary">
        Issuer → Certificate → CertificateRequest (CSR) → Order → Challenge. Orders and Challenges
        appear for ACME issuance when retained. Dashed arrows are declared references or annotation
        associations; solid arrows follow ownership. Secret cards are references; their contents are
        not read.
      </Typography>
      {graph.warnings.length > 0 && <Alert severity="warning">{graph.warnings.join(' ')}</Alert>}
      {graph.hidden > 0 && (
        <Alert severity="info">
          The diagram shows {graph.nodes.length} of {graph.allNodes.length} resources. Choose a
          revision for a smaller diagram, or use the Resources tab to inspect every relation.
        </Alert>
      )}
      {!graph.requests.length && (
        <Typography variant="body2" color="text.secondary">
          No CertificateRequests are visible in the loaded scope. Old requests, orders and
          challenges may have been removed by cert-manager.
        </Typography>
      )}
      <Tabs
        value={view}
        onChange={(_, value) => setView(value)}
        aria-label="Certificate relationship views"
      >
        <Tab value="diagram" label="Diagram" />
        <Tab value="resources" label="Resources" />
      </Tabs>
      {view === 'diagram' ? (
        <Box
          role="region"
          aria-label={`Certificate relationship diagram for ${certificate.metadata.name}`}
          sx={{
            height: 560,
            minWidth: 0,
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: 2,
            overflow: 'hidden',
            bgcolor: 'background.default',
            '& .react-flow__controls-button': {
              bgcolor: 'background.paper',
              color: 'text.primary',
              borderColor: 'divider',
              '&:hover': { bgcolor: 'action.hover' },
              '& svg': { fill: 'currentColor' },
            },
            '& .react-flow__minimap': { bgcolor: 'background.paper' },
          }}
        >
          <ReactFlowProvider>
            <ReactFlow
              id={flowId}
              key={key}
              nodes={graph.nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              nodesDraggable={false}
              nodesConnectable={false}
              elementsSelectable={false}
              fitView
              fitViewOptions={{ padding: 0.15, maxZoom: 1 }}
              minZoom={0.08}
              maxZoom={1.8}
              colorMode={theme.palette.mode}
              preventScrolling={false}
              onlyRenderVisibleElements
              aria-label="Certificate relationships"
            >
              <Background variant={BackgroundVariant.Dots} size={1.5} />
              <MiniMap
                pannable
                zoomable
                nodeColor={node =>
                  node.data.role === 'certificate'
                    ? theme.palette.primary.main
                    : theme.palette.action.disabled
                }
              />
              <Controls showInteractive={false} />
            </ReactFlow>
          </ReactFlowProvider>
        </Box>
      ) : (
        <SimpleTable
          data={graph.allNodes}
          rowsPerPage={[10, 25, 50, 100]}
          columns={[
            {
              label: 'Resource',
              getter: (node: RelationNode) => <ResourceLink data={node.data} />,
            },
            { label: 'Kind', getter: (node: RelationNode) => node.data.ref.kind },
            {
              label: 'Namespace',
              getter: (node: RelationNode) =>
                node.data.ref.namespace ||
                (node.data.ref.kind === 'Secret'
                  ? 'Controller resource namespace'
                  : 'Cluster-scoped'),
            },
            {
              label: 'Status',
              getter: (node: RelationNode) => (
                <Chip size="small" label={node.data.status} color={node.data.color} />
              ),
            },
            { label: 'Details', getter: (node: RelationNode) => node.data.detail },
            {
              label: 'Relations',
              getter: (node: RelationNode) =>
                graph.allEdges
                  .filter(edge => edge.source === node.id || edge.target === node.id)
                  .map(
                    edge =>
                      `${graph.allNodes.find(value => value.id === edge.source)!.data.ref.name} → ${
                        graph.allNodes.find(value => value.id === edge.target)!.data.ref.name
                      } (${edge.label})`
                  )
                  .join('; '),
            },
          ]}
        />
      )}
    </Stack>
  );
}
