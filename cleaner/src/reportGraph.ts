import type { Edge, Node } from '@xyflow/react';
import { ResourceInfo } from './model';
import { groupReportResources } from './reportTree';

export const GRAPH_PAGE_SIZE = 8;
export const GRAPH_ROW_HEIGHT = 116;
export type ReportNodeData = {
  label: string;
  category: string;
  icon: string;
  detail?: string;
  namespace?: string;
  apiVersion?: string;
  count?: string;
  source?: boolean;
  branch?: boolean;
  info?: ResourceInfo;
};
export type ReportNode = Node<ReportNodeData, 'reportResource'>;

/** A paged tree of report entries, not Kubernetes ownership or live health. */
export function buildReportGraph(reportName: string, items: ResourceInfo[], requestedPage = 0) {
  const summary = groupReportResources(items);
  const ordered = summary.branches.flatMap(scope =>
    scope.kinds.flatMap(kind =>
      kind.resources.map(resource => ({
        namespace: scope.label,
        kind: kind.kind,
        apiVersion: kind.apiVersion,
        ...resource,
      }))
    )
  );
  const pages = Math.max(1, Math.ceil(ordered.length / GRAPH_PAGE_SIZE));
  const page = Math.max(0, Math.min(requestedPage, pages - 1));
  const visible = ordered.slice(page * GRAPH_PAGE_SIZE, (page + 1) * GRAPH_PAGE_SIZE);
  const nodes: ReportNode[] = [];
  const edges: Edge[] = [];
  function add(id: string, x: number, y: number, width: number, data: ReportNodeData) {
    nodes.push({
      id,
      type: 'reportResource',
      position: { x, y },
      data,
      draggable: false,
      selectable: false,
      style: { width, height: 96, pointerEvents: 'all' },
    });
  }
  function connect(source: string, target: string) {
    edges.push({
      id: `${source}->${target}`,
      source,
      target,
      type: 'smoothstep',
      animated: true,
      style: { stroke: '#1976d2', strokeWidth: 1.6 },
    });
  }
  add('report', 0, (Math.max(0, visible.length - 1) / 2) * GRAPH_ROW_HEIGHT + 20, 270, {
    label: reportName,
    category: 'Report',
    icon: 'mdi:clipboard-text-outline',
    count: `${items.length}`,
    source: true,
    branch: visible.length > 0,
  });
  visible.forEach(({ namespace, kind, apiVersion, info, index }, row) => {
    const id = `resource-${index}`;
    add(id, 400, row * GRAPH_ROW_HEIGHT + 20, 320, {
      label: info.resource?.name || 'Unnamed resource',
      category: kind,
      namespace,
      apiVersion,
      icon: 'mdi:cube-outline',
      detail: info.fullResource ? 'Full YAML' : 'No snapshot captured',
      info,
    });
    connect('report', id);
  });
  return { nodes, edges, summary, page, pages, visible: visible.length };
}
