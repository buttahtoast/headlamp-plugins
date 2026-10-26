import '@xyflow/react/dist/base.css';
import { Icon } from '@iconify/react';
import { Box, Button, Chip, Stack, Typography, useTheme } from '@mui/material';
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  NodeProps,
  Position,
  ReactFlow,
  ReactFlowProvider,
} from '@xyflow/react';
import { createContext, useContext, useMemo, useState } from 'react';
import { ResourceInfo } from './model';
import { buildReportGraph, GRAPH_PAGE_SIZE, GRAPH_ROW_HEIGHT, ReportNode } from './reportGraph';

const SnapshotContext = createContext<(item: ResourceInfo) => void>(() => {});

function ResourceNode({ data }: NodeProps<ReportNode>) {
  const showYaml = useContext(SnapshotContext);
  const captured = !!data.info?.fullResource;
  return (
    <Box
      sx={theme => ({
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        width: '100%',
        height: '100%',
        boxSizing: 'border-box',
        px: 1.5,
        py: 1,
        border: data.source ? 0 : '1px solid',
        borderColor: 'divider',
        borderRadius: data.source ? 2 : 1.5,
        bgcolor: 'background.paper',
        background: data.source ? 'linear-gradient(135deg, #1976d2, #0d47a1)' : undefined,
        color: data.source ? '#fff' : 'text.primary',
        boxShadow: theme.shadows[data.source ? 3 : 1],
      })}
    >
      {!data.source && (
        <Handle
          type="target"
          position={Position.Left}
          style={{ background: '#1976d2', width: 8, height: 8 }}
        />
      )}
      <Icon icon={data.icon} width={data.source ? 30 : 24} aria-hidden style={{ flexShrink: 0 }} />
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography
          variant="caption"
          title={data.apiVersion ? `${data.category} · ${data.apiVersion}` : data.category}
          sx={{ color: data.source ? 'inherit' : 'text.secondary', opacity: data.source ? 0.8 : 1 }}
        >
          {data.category}
        </Typography>
        <Typography variant="body2" noWrap title={data.label} fontWeight={650}>
          {data.label}
        </Typography>
        {data.namespace && (
          <Typography
            variant="caption"
            color="text.secondary"
            noWrap
            title={data.namespace}
            sx={{ display: 'block' }}
          >
            {data.info?.resource?.namespace ? `Namespace: ${data.namespace}` : data.namespace}
          </Typography>
        )}
        {captured ? (
          <Button
            className="nodrag nopan"
            size="small"
            onClick={() => showYaml(data.info!)}
            aria-label={`Full YAML for ${data.category} ${
              data.info?.resource?.namespace ? `${data.info.resource.namespace}/` : ''
            }${data.label}`}
            sx={{ p: 0, minWidth: 0, fontSize: '0.75rem', lineHeight: 1.5 }}
          >
            Full YAML
          </Button>
        ) : (
          data.detail && (
            <Typography
              variant="caption"
              color="text.secondary"
              noWrap
              title={data.detail}
              sx={{ display: 'block' }}
            >
              {data.detail}
            </Typography>
          )
        )}
      </Box>
      {data.count && (
        <Chip
          size="small"
          label={data.count}
          sx={data.source ? { bgcolor: 'rgba(255,255,255,0.2)', color: '#fff' } : undefined}
        />
      )}
      {data.branch && (
        <Handle
          type="source"
          position={Position.Right}
          style={{ background: data.source ? '#fff' : '#1976d2', width: 8, height: 8 }}
        />
      )}
    </Box>
  );
}

const nodeTypes = { reportResource: ResourceNode };

export function ReportResourceFlow({
  reportName,
  items,
  onFullYaml,
}: {
  reportName: string;
  items: ResourceInfo[];
  onFullYaml: (item: ResourceInfo) => void;
}) {
  const [page, setPage] = useState(0);
  const theme = useTheme();
  const graph = useMemo(() => buildReportGraph(reportName, items, page), [reportName, items, page]);
  return (
    <Stack spacing={2}>
      <Stack direction="row" gap={1} flexWrap="wrap" alignItems="center">
        <Chip size="small" variant="outlined" label={`Matches: ${graph.summary.total}`} />
        <Chip size="small" variant="outlined" label={`Namespaces: ${graph.summary.namespaces}`} />
        <Chip size="small" variant="outlined" label={`Kinds: ${graph.summary.kinds}`} />
      </Stack>
      <Typography variant="body2" color="text.secondary">
        Report → matching resources. Each card shows its kind and namespace. Open Full YAML to
        inspect a captured snapshot.
      </Typography>
      {graph.summary.total ? (
        <Box
          role="region"
          aria-label="Report resource diagram"
          sx={{
            bgcolor: 'background.default',
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: 2,
            height: Math.min(560, Math.max(300, graph.visible * GRAPH_ROW_HEIGHT + 60)),
            overflow: 'hidden',
            '& .react-flow__controls-button': {
              bgcolor: 'background.paper',
              color: 'text.primary',
              borderColor: 'divider',
              '&:hover': { bgcolor: 'action.hover' },
              '& svg': { fill: 'currentColor' },
            },
            '@media (prefers-reduced-motion: reduce)': {
              '& .react-flow__edge-path': { animation: 'none' },
            },
          }}
        >
          <SnapshotContext.Provider value={onFullYaml}>
            <ReactFlowProvider>
              <ReactFlow
                key={graph.nodes.map(node => node.id).join('|')}
                nodes={graph.nodes}
                edges={graph.edges}
                nodeTypes={nodeTypes}
                nodesDraggable={false}
                nodesConnectable={false}
                elementsSelectable={false}
                fitView
                fitViewOptions={{ maxZoom: 1, padding: 0.15 }}
                minZoom={0.15}
                maxZoom={1.6}
                colorMode={theme.palette.mode}
                preventScrolling={false}
              >
                <Background variant={BackgroundVariant.Dots} size={2} />
                <Controls showInteractive={false} />
              </ReactFlow>
            </ReactFlowProvider>
          </SnapshotContext.Provider>
        </Box>
      ) : (
        <Typography color="text.secondary">No matching resources in this report.</Typography>
      )}
      {graph.pages > 1 && (
        <Stack
          direction="row"
          gap={1}
          alignItems="center"
          justifyContent="flex-end"
          flexWrap="wrap"
        >
          <Typography variant="body2" color="text.secondary">
            Matches {graph.page * GRAPH_PAGE_SIZE + 1}–
            {graph.page * GRAPH_PAGE_SIZE + graph.visible} of {items.length}.
          </Typography>
          <Button size="small" disabled={graph.page === 0} onClick={() => setPage(graph.page - 1)}>
            Previous resources
          </Button>
          <Button
            size="small"
            disabled={graph.page === graph.pages - 1}
            onClick={() => setPage(graph.page + 1)}
          >
            Next resources
          </Button>
        </Stack>
      )}
    </Stack>
  );
}
