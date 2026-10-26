import { describe, expect, it } from 'vitest';
import { ResourceInfo } from './model';
import { groupReportResources } from './reportTree';
import { decodeFullResource } from './snapshot';

describe('report resource summary', () => {
  it('groups every match by namespace and kind with stable ordering and counts', () => {
    const items: ResourceInfo[] = [
      {
        resource: {
          namespace: 'production',
          kind: 'Deployment',
          apiVersion: 'apps/v1',
          name: 'web',
        },
      },
      {
        resource: {
          namespace: 'development',
          kind: 'ConfigMap',
          apiVersion: 'v1',
          name: 'z-settings',
        },
      },
      {
        resource: {
          namespace: 'development',
          kind: 'ConfigMap',
          apiVersion: 'v1',
          name: 'a-settings',
        },
      },
      { resource: { namespace: 'development', kind: 'Service', apiVersion: 'v1', name: 'web' } },
    ];
    const tree = groupReportResources(items);
    expect(tree).toMatchObject({ total: 4, namespaces: 2, kinds: 3 });
    expect(tree.branches.map(scope => [scope.label, scope.count])).toEqual([
      ['development', 3],
      ['production', 1],
    ]);
    expect(tree.branches[0].kinds.map(kind => kind.kind)).toEqual(['ConfigMap', 'Service']);
    expect(tree.branches[0].kinds[0].resources.map(item => item.index)).toEqual([2, 1]);
    expect(tree.branches[0].kinds[0].resources[0].info).toBe(items[2]);
    expect(items[1].resource?.name).toBe('z-settings');
  });
  it('separates cluster-scoped and unknown entries from namespaces and disambiguates API kinds', () => {
    const tree = groupReportResources([
      { resource: { kind: 'Policy', apiVersion: 'first.example/v1', name: 'a' } },
      { resource: { kind: 'Policy', apiVersion: 'second.example/v1', name: 'b' } },
      { message: 'No resource reference' },
    ]);
    expect(tree).toMatchObject({ total: 3, namespaces: 0, kinds: 3 });
    expect(tree.branches.map(scope => scope.label)).toEqual(['Cluster-scoped', 'Unknown scope']);
    expect(tree.branches[0].kinds).toHaveLength(2);
  });
  it('handles empty reports and retains duplicate report entries without hiding matches', () => {
    expect(groupReportResources([])).toEqual({ branches: [], total: 0, namespaces: 0, kinds: 0 });
    const info = { resource: { kind: 'Pod', name: 'same', namespace: 'example' } };
    const tree = groupReportResources([info, info]);
    expect(tree.total).toBe(2);
    expect(tree.branches[0].kinds[0].resources.map(resource => resource.index)).toEqual([0, 1]);
  });
});

describe('full resource inspection', () => {
  it('preserves UTF-8 content, captured metadata and status without rollback normalization', () => {
    const saved = {
      apiVersion: 'v1',
      kind: 'ConfigMap',
      metadata: {
        name: 'settings',
        uid: 'saved-uid',
        resourceVersion: '42',
        managedFields: [{ manager: 'original-controller' }],
      },
      data: { greeting: 'Grüezi 🌍', literal: 'false' },
      status: { phase: 'Captured' },
    };
    expect(decodeFullResource(Buffer.from(JSON.stringify(saved)).toString('base64'))).toEqual(
      saved
    );
  });
  it('rejects invalid base64, invalid UTF-8, malformed JSON and non-object snapshots', () => {
    for (const encoded of ['!!!', Buffer.from([0xff]).toString('base64'), btoa('{bad')]) {
      expect(() => decodeFullResource(encoded)).toThrow('base64-encoded JSON');
    }
    for (const value of [null, [], 'text', 1]) {
      expect(() => decodeFullResource(btoa(JSON.stringify(value)))).toThrow('JSON object');
    }
  });
});
