import { describe, expect, it } from 'vitest';
import { ResourceInfo } from './model';
import { buildReportGraph, GRAPH_PAGE_SIZE } from './reportGraph';

describe('report relationship graph', () => {
  it('connects each reported entry directly and keeps namespace and API kind on the card', () => {
    const items: ResourceInfo[] = [
      { resource: { name: 'same', namespace: 'alpha', kind: 'Policy', apiVersion: 'one/v1' } },
      { resource: { name: 'same', namespace: 'alpha', kind: 'Policy', apiVersion: 'two/v1' } },
      { resource: { name: 'same', namespace: 'beta', kind: 'Policy', apiVersion: 'one/v1' } },
      {
        resource: { name: 'same', kind: 'ClusterRole', apiVersion: 'rbac.authorization.k8s.io/v1' },
      },
      { message: 'Unknown resource' },
    ];
    const graph = buildReportGraph('report', items);
    expect(graph.nodes).toHaveLength(items.length + 1);
    expect(new Set(graph.nodes.map(node => node.id)).size).toBe(graph.nodes.length);
    expect(graph.edges).toHaveLength(graph.nodes.length - 1);
    items.forEach((info, index) => {
      const node = graph.nodes.find(node => node.id === `resource-${index}`)!;
      expect(node.data.info).toBe(info);
      expect(node.data.category).toBe(info.resource?.kind || 'Unknown kind');
      expect(node.data.apiVersion).toBe(info.resource?.apiVersion || '');
      expect(node.data.namespace).toBe(
        info.resource ? info.resource.namespace || 'Cluster-scoped' : 'Unknown scope'
      );
      expect(graph.edges.find(edge => edge.target === node.id)?.source).toBe('report');
    });
    expect(graph.summary).toMatchObject({ total: 5, namespaces: 2, kinds: 4 });
  });

  it('centers parent nodes on their visible descendants, including a single match', () => {
    for (const length of [1, 3, GRAPH_PAGE_SIZE]) {
      const items = Array.from({ length }, (_, i) => ({
        resource: { name: `pod-${i}`, kind: 'Pod', namespace: 'batch' },
      }));
      const graph = buildReportGraph('report', items);
      const leaves = graph.nodes.filter(node => node.data.info);
      const center = (leaves[0].position.y + leaves[leaves.length - 1].position.y) / 2;
      graph.nodes
        .filter(node => !node.data.info)
        .forEach(node => expect(node.position.y).toBe(center));
    }
  });

  it('pages every entry once, retains duplicates, and clamps pages after a report shrinks', () => {
    const info = { resource: { name: 'duplicate', kind: 'Pod', namespace: 'batch' } };
    const items = Array.from({ length: 35 }, () => info);
    const ids: string[] = [];
    for (let page = 0; page < 5; page++) {
      const graph = buildReportGraph('report', items, page);
      expect(graph.summary.total).toBe(35);
      expect(graph.visible).toBeLessThanOrEqual(GRAPH_PAGE_SIZE);
      ids.push(...graph.nodes.filter(node => node.data.info).map(node => node.id));
      expect(graph.nodes.find(node => node.id === 'report')?.data.count).toBe('35');
    }
    expect(ids).toHaveLength(35);
    expect(new Set(ids).size).toBe(35);
    expect(buildReportGraph('report', [info], 4)).toMatchObject({ page: 0, pages: 1, visible: 1 });
    expect(buildReportGraph('report', [], 4)).toMatchObject({
      page: 0,
      pages: 1,
      visible: 0,
      edges: [],
    });
  });
});
