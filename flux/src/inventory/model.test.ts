import { describe, expect, it } from 'vitest';
import {
  buildInventoryGraph,
  InventoryRecord,
  objectStatus,
  parseInventoryEntry,
  releaseIdentity,
} from './model';

describe('Flux inventory references', () => {
  it('reads cluster-scoped and core API IDs in their actual Flux order', () => {
    expect(
      parseInventoryEntry({
        id: '_widgets.example.io_apiextensions.k8s.io_CustomResourceDefinition',
        v: 'v1',
      })
    ).toMatchObject({
      namespace: undefined,
      name: 'widgets.example.io',
      group: 'apiextensions.k8s.io',
      kind: 'CustomResourceDefinition',
    });
    expect(parseInventoryEntry({ id: 'app_settings__ConfigMap', v: 'v1' })).toMatchObject({
      namespace: 'app',
      name: 'settings',
      group: '',
      kind: 'ConfigMap',
    });
    expect(parseInventoryEntry({ id: '_app__Namespace', v: 'v1' })).toMatchObject({
      namespace: undefined,
      name: 'app',
      group: '',
      kind: 'Namespace',
    });
  });
  it('preserves underscores inside resource names', () => {
    expect(
      parseInventoryEntry({
        id: 'app_secret__reader__auth_rbac.authorization.k8s.io_Role',
        v: 'v1',
      }).name
    ).toBe('secret__reader__auth');
    expect(() => parseInventoryEntry({ id: 'broken', v: 'v1' })).toThrow('Invalid');
  });
  it('uses the installed Helm release identity and storage namespace', () => {
    expect(
      releaseIdentity({
        metadata: { name: 'operator', namespace: 'flux-system' },
        spec: { targetNamespace: 'app' },
        status: {
          storageNamespace: 'helm-storage',
          history: [{ name: 'real-release', version: 9 }],
        },
      })
    ).toEqual({ name: 'real-release', namespace: 'helm-storage', targetNamespace: 'app' });
  });
});

const record = (id: string, namespace?: string): InventoryRecord => ({
  id,
  namespace,
  name: id,
  group: '',
  kind: 'ConfigMap',
  version: 'v1',
  state: 'loaded',
  object: { apiVersion: 'v1', kind: 'ConfigMap', metadata: { name: id, namespace } },
});

describe('inventory diagrams and live readiness', () => {
  it('summarizes large inventories without dropping objects from the kind counts', () => {
    const graph = buildInventoryGraph(
      { metadata: { name: 'app' } },
      Array.from({ length: 200 }, (_, i) => ({
        ...record(`item-${i}`, 'app'),
        kind: i < 180 ? 'ConfigMap' : 'Secret',
      })),
      true
    );
    const groups = graph.nodes.filter(node => node.data.role === 'kind');
    expect(groups).toHaveLength(2);
    expect(groups.reduce((count, node) => count + node.data.count, 0)).toBe(200);
    expect(graph.nodes.filter(node => node.data.role === 'resource')).toHaveLength(0);
  });
  it('represents every input record with unique nodes and valid edges', () => {
    const records = [
      record('one', 'a'),
      record('two', 'a'),
      record('three', 'b'),
      record('cluster'),
    ];
    const graph = buildInventoryGraph(
      {
        kind: 'Kustomization',
        metadata: { name: 'app', namespace: 'flux-system' },
        spec: { sourceRef: { kind: 'GitRepository', name: 'repo' }, dependsOn: [{ name: 'base' }] },
      },
      records
    );
    const ids = new Set(graph.nodes.map(node => node.id));
    expect(ids.size).toBe(graph.nodes.length);
    expect(graph.nodes.filter(node => node.data.role === 'resource')).toHaveLength(records.length);
    expect(graph.nodes.filter(node => node.data.role === 'namespace')).toHaveLength(3);
    for (const edge of graph.edges) {
      expect(ids.has(edge.source)).toBe(true);
      expect(ids.has(edge.target)).toBe(true);
    }
    expect(graph.nodes.some(node => node.id === 'owner')).toBe(false);
    const objectNodes = graph.nodes.filter(node => node.data.role === 'resource');
    const global = (node: (typeof objectNodes)[number]) => {
      const parent = graph.nodes.find(parent => parent.id === node.parentId);
      expect(parent?.data.role).toBe('namespace');
      expect(node.position.x + node.width).toBeLessThanOrEqual(parent.width);
      expect(node.position.y + node.height).toBeLessThanOrEqual(parent.height);
      expect(node.style).toEqual({ width: node.width, height: node.height });
      return {
        ...node,
        position: {
          x: node.position.x + parent.position.x,
          y: node.position.y + parent.position.y,
        },
      };
    };
    for (let i = 0; i < objectNodes.length; i++)
      for (let j = i + 1; j < objectNodes.length; j++) {
        const a = global(objectNodes[i]);
        const b = global(objectNodes[j]);
        expect(
          a.position.x + a.width <= b.position.x ||
            b.position.x + b.width <= a.position.x ||
            a.position.y + a.height <= b.position.y ||
            b.position.y + b.height <= a.position.y
        ).toBe(true);
      }
  });
  it('keeps no-access and missing objects distinct from not-ready objects', () => {
    expect(objectStatus({ ...record('x'), state: 'forbidden' }).label).toBe('No access');
    expect(objectStatus({ ...record('x'), state: 'missing' }).label).toBe('Missing');
    expect(objectStatus(record('x')).label).toBe('Present');
    expect(
      objectStatus({
        ...record('x'),
        object: { kind: 'Custom', status: { conditions: [{ type: 'Ready', status: 'False' }] } },
      })
    ).toEqual({ label: 'Not ready', color: 'error' });
  });
  it('aligns namespace grids and source handles, regardless of inventory order', () => {
    const owner = {
      kind: 'Kustomization',
      metadata: { name: 'app', namespace: 'flux-system' },
      spec: { sourceRef: { kind: 'GitRepository', name: 'repo' } },
    };
    const records = [record('z', 'b'), record('a', 'a'), record('y', 'b'), record('x', 'a')];
    const graph = buildInventoryGraph(owner, records);
    expect(buildInventoryGraph(owner, [...records].reverse())).toEqual(graph);
    const groups = graph.nodes.filter(node => node.data.role === 'namespace');
    expect(new Set(groups.map(node => node.position.x)).size).toBe(1);
    expect(new Set(groups.map(node => node.width)).size).toBe(1);
    const starts = groups.map(group => graph.nodes.find(node => node.parentId === group.id));
    expect(new Set(starts.map(node => node.position.x)).size).toBe(1);
    expect(new Set(starts.map(node => node.position.y)).size).toBe(1);
    const single = buildInventoryGraph(owner, [record('single', 'app')]);
    const source = single.nodes.find(node => node.id === 'source');
    const namespace = single.nodes.find(node => node.data.role === 'namespace');
    const resource = single.nodes.find(node => node.data.role === 'resource');
    expect(source.position.y + source.height / 2).toBe(
      namespace.position.y + namespace.data.contentCenter
    );
    expect(source.position.y + source.height / 2).toBe(
      namespace.position.y + resource.position.y + resource.height / 2
    );
    expect(single.nodes.some(node => node.id === 'owner')).toBe(false);
  });
});
