import { describe, expect, it } from 'vitest';
import { Collection, collections, Item } from './model';
import {
  certificateRelationships,
  MAX_DIAGRAM_NODES,
  NODE_HEIGHT,
  NODE_WIDTH,
  reference,
  referenceId,
  RelationResults,
  relationRoute,
} from './relationships';

export function object(kind: string, name: string, owner?: Item, extra: Partial<Item> = {}): Item {
  return {
    apiVersion: ['Order', 'Challenge'].includes(kind)
      ? 'acme.cert-manager.io/v1'
      : 'cert-manager.io/v1',
    kind,
    cluster: 'main',
    metadata: {
      name,
      namespace: kind === 'ClusterIssuer' ? undefined : 'apps',
      uid: `${kind}-${name}`,
      ...(owner
        ? {
            ownerReferences: [
              {
                kind: owner.kind,
                name: owner.metadata.name,
                uid: owner.metadata.uid!,
                apiVersion: owner.apiVersion,
              },
            ],
          }
        : {}),
    },
    status: { conditions: [{ type: 'Ready', status: 'True' }] },
    ...extra,
  };
}

function fixture() {
  const issuer = object('Issuer', 'letsencrypt', undefined, {
    spec: { acme: { privateKeySecretRef: { name: 'account-key' } } },
  });
  const cert = object('Certificate', 'example', undefined, {
    spec: { secretName: 'example-tls', issuerRef: { name: issuer.metadata.name } },
    status: { revision: 2, nextPrivateKeySecretName: 'next-key' },
  });
  const old = object('CertificateRequest', 'example-1', cert, {
    spec: { issuerRef: { name: issuer.metadata.name } },
  });
  old.metadata.annotations = { 'cert-manager.io/certificate-revision': '1' };
  const current = object('CertificateRequest', 'example-2', cert, {
    spec: { issuerRef: { name: issuer.metadata.name } },
  });
  current.metadata.annotations = { 'cert-manager.io/certificate-revision': '2' };
  const order = object('Order', 'order', current, {
    spec: { dnsNames: ['example.com'] },
    status: { state: 'pending' },
  });
  const challenge = object('Challenge', 'challenge', order, {
    spec: { type: 'DNS-01', dnsName: 'example.com' },
    status: { state: 'pending' },
  });
  const results: RelationResults = Object.fromEntries(
    (Object.keys(collections) as Collection[]).map(id => [id, { items: [] }])
  );
  results.certificates!.items = [cert];
  results.issuers!.items = [issuer];
  results.certificaterequests!.items = [old, current];
  results.orders!.items = [order];
  results.challenges!.items = [challenge];
  return { cert, issuer, old, current, order, challenge, results };
}
const nodeId = (item: Item) => referenceId(reference(item));

describe('certificate relationship model', () => {
  it('connects the complete issuer, certificate, CSR, order and challenge chain with output and account-key references', () => {
    const { cert, issuer, current, order, challenge, results } = fixture();
    const graph = certificateRelationships(cert, results);
    for (const [source, target] of [
      [issuer, cert],
      [issuer, current],
      [cert, current],
      [current, order],
      [order, challenge],
    ]) {
      expect(
        graph.edges.some(edge => edge.source === nodeId(source) && edge.target === nodeId(target))
      ).toBe(true);
    }
    expect(graph.allNodes.filter(node => node.data.role === 'issuer')).toHaveLength(1);
    expect(graph.allNodes.find(node => node.id === nodeId(current))!.data.detail).toBe(
      'Revision 2 · current'
    );
    const secrets = graph.allNodes.filter(node => node.data.ref.kind === 'Secret');
    expect(secrets.map(node => node.data.ref.name).sort()).toEqual([
      'account-key',
      'example-tls',
      'next-key',
    ]);
    expect(secrets.every(node => node.data.availability === 'reference' && !node.data.item)).toBe(
      true
    );
    expect(graph.warnings).toEqual([]);
    for (const node of graph.nodes) {
      expect(() => document.querySelector(`[data-id="flow-${node.id}-null-source"]`)).not.toThrow();
    }
  });
  it('does not cross namespace, cluster, group or replaced-certificate UID boundaries', () => {
    const { cert, current, results } = fixture();
    const wrongUid = object('CertificateRequest', 'replaced', {
      ...cert,
      metadata: { ...cert.metadata, uid: 'old-certificate-uid' },
    });
    wrongUid.metadata.annotations = { 'cert-manager.io/certificate-name': cert.metadata.name };
    results.certificaterequests!.items.push(
      { ...current, cluster: 'other' },
      { ...current, metadata: { ...current.metadata, namespace: 'other' } },
      {
        ...current,
        apiVersion: 'other.io/v1',
        metadata: { ...current.metadata, uid: 'other-group' },
      },
      wrongUid
    );
    const graph = certificateRelationships(cert, results);
    expect(graph.requests).toHaveLength(2);
    expect(graph.allNodes.every(node => node.data.ref.cluster === 'main')).toBe(true);
    expect(graph.allNodes.some(node => node.data.ref.name === 'replaced')).toBe(false);
  });
  it('uses annotation-only association explicitly and rejects a wrong owner even when annotated', () => {
    const { cert, results } = fixture();
    const orphan = object('CertificateRequest', 'orphan');
    orphan.metadata.annotations = { 'cert-manager.io/certificate-name': cert.metadata.name };
    results.certificaterequests!.items.push(orphan);
    const graph = certificateRelationships(cert, results);
    const edge = graph.edges.find(
      edge => edge.target === nodeId(orphan) && edge.source === nodeId(cert)
    );
    expect(edge?.label).toBe('certificate-name annotation');
    expect(edge?.data?.declared).toBe(true);
  });
  it('filters a retained revision with its own subtree and falls back to all when it is removed', () => {
    const { cert, old, results } = fixture();
    const graph = certificateRelationships(cert, results, nodeId(old));
    expect(graph.requests).toHaveLength(2);
    expect(graph.allNodes.some(node => ['Order', 'Challenge'].includes(node.data.ref.kind))).toBe(
      false
    );
    expect(graph.allNodes.some(node => node.data.ref.name === 'example-2')).toBe(false);
    expect(graph.allNodes.some(node => node.data.ref.name === 'example-tls')).toBe(true);
    expect(
      certificateRelationships(cert, results, 'removed-revision').allNodes.length
    ).toBeGreaterThan(graph.allNodes.length);
  });
  it('distinguishes forbidden, missing and loading issuers without declaring references healthy', () => {
    const { cert, results } = fixture();
    results.issuers = { items: [], error: 'Forbidden' };
    let graph = certificateRelationships(cert, results);
    expect(graph.allNodes.find(node => node.data.role === 'issuer')!.data.status).toBe(
      'Unavailable'
    );
    expect(graph.warnings.join(' ')).toContain('Forbidden');
    results.issuers = { items: [] };
    graph = certificateRelationships(cert, results);
    expect(graph.allNodes.find(node => node.data.role === 'issuer')!.data.status).toBe('Not found');
    delete results.issuers;
    graph = certificateRelationships(cert, results);
    expect(graph.allNodes.find(node => node.data.role === 'issuer')!.data.status).toBe('Loading');
  });
  it('resolves cluster issuers without borrowing a namespace or guessing their Secret namespace', () => {
    const { cert, results } = fixture();
    cert.spec!.issuerRef = { name: 'ca', kind: 'ClusterIssuer' };
    const issuer = object('ClusterIssuer', 'ca', undefined, {
      spec: { ca: { secretName: 'ca-key' } },
    });
    results.clusterissuers!.items = [issuer];
    const graph = certificateRelationships(cert, results);
    const node = graph.allNodes.find(node => node.data.ref.kind === 'ClusterIssuer')!;
    expect(node.data.availability).toBe('loaded');
    expect(node.data.ref.namespace).toBeUndefined();
    const secret = graph.allNodes.find(node => node.data.ref.name === 'ca-key')!;
    expect(secret.data.ref.namespace).toBeUndefined();
    expect(relationRoute(secret.data.ref)).toBeUndefined();
    expect(secret.data.detail).toContain('controller resource namespace');
  });
  it('includes owner references and external issuers without inventing resource plurals or readiness', () => {
    const { cert, results } = fixture();
    cert.metadata.ownerReferences = [
      { kind: 'Gateway', name: 'edge', uid: 'gateway', apiVersion: 'gateway.networking.k8s.io/v1' },
    ];
    cert.spec!.issuerRef = {
      name: 'external',
      kind: 'AWSPCAIssuer',
      group: 'awspca.cert-manager.io',
    };
    const graph = certificateRelationships(cert, results);
    const external = graph.allNodes.find(node => node.data.ref.name === 'external')!;
    expect(external.data.availability).toBe('reference');
    expect(relationRoute(external.data.ref)).toBeUndefined();
    const owner = graph.allNodes.find(node => node.data.role === 'owner')!;
    expect(relationRoute(owner.data.ref)?.params.crd).toBe('gateways.gateway.networking.k8s.io');
  });
  it('lays out branching challenges without overlaps and remains deterministic across list order changes', () => {
    const { cert, order, results } = fixture();
    results.challenges!.items.push(object('Challenge', 'second-domain', order));
    const first = certificateRelationships(cert, results);
    const reversed = Object.fromEntries(
      Object.entries(results).map(([key, result]) => [
        key,
        { ...result, items: [...result!.items].reverse() },
      ])
    );
    const second = certificateRelationships(cert, reversed);
    expect(first.allNodes.map(node => [node.id, node.position])).toEqual(
      second.allNodes.map(node => [node.id, node.position])
    );
    for (let a = 0; a < first.allNodes.length; a++)
      for (let b = a + 1; b < first.allNodes.length; b++) {
        const one = first.allNodes[a];
        const two = first.allNodes[b];
        const overlap =
          Math.abs(one.position.x - two.position.x) < NODE_WIDTH &&
          Math.abs(one.position.y - two.position.y) < NODE_HEIGHT;
        expect(overlap, `${one.data.ref.name} overlaps ${two.data.ref.name}`).toBe(false);
      }
  });
  it('bounds the diagram while retaining every resource and relation for the table', () => {
    const { cert, order, results } = fixture();
    results.challenges!.items = Array.from({ length: 200 }, (_, index) =>
      object('Challenge', `challenge-${index}`, order)
    );
    const graph = certificateRelationships(cert, results);
    expect(graph.nodes).toHaveLength(MAX_DIAGRAM_NODES);
    expect(graph.hidden).toBe(graph.allNodes.length - MAX_DIAGRAM_NODES);
    const visible = new Set(graph.nodes.map(node => node.id));
    expect(graph.edges.every(edge => visible.has(edge.source) && visible.has(edge.target))).toBe(
      true
    );
    expect(graph.allNodes.filter(node => node.data.ref.kind === 'Challenge')).toHaveLength(200);
  });
});
