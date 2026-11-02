import type { Edge, Node } from '@xyflow/react';
import type { Result } from './api';
import {
  Collection,
  collections,
  descendants,
  health,
  healthLabels,
  Item,
  message,
  timestamp,
} from './model';

export interface ResourceReference {
  cluster: string;
  group: string;
  kind: string;
  name: string;
  namespace?: string;
  uid?: string;
}
export type Availability = 'loaded' | 'reference' | 'missing' | 'unavailable' | 'loading';
export type RelationRole =
  | 'certificate'
  | 'issuer'
  | 'request'
  | 'order'
  | 'challenge'
  | 'secret'
  | 'owner'
  | 'issuerSecret';
export interface RelationData extends Record<string, unknown> {
  ref: ResourceReference;
  item?: Item;
  role: RelationRole;
  availability: Availability;
  detail: string;
  status: string;
  color: 'default' | 'success' | 'warning' | 'error' | 'info';
}
export type RelationNode = Node<RelationData, 'certificateRelation'>;
export type RelationResults = Partial<Record<Collection, Result>>;
export const NODE_WIDTH = 300;
export const NODE_HEIGHT = 132;
const COLUMN_STEP = 430;
const ROW_STEP = 180;
export const MAX_DIAGRAM_NODES = 160;

const group = (apiVersion: string) => (apiVersion.includes('/') ? apiVersion.split('/')[0] : '');
export function reference(item: Item): ResourceReference {
  return {
    cluster: item.cluster,
    group: group(item.apiVersion),
    kind: item.kind,
    name: item.metadata.name,
    namespace: item.metadata.namespace,
    uid: item.metadata.uid,
  };
}
export const referenceId = (ref: ResourceReference) =>
  encodeURIComponent(
    JSON.stringify([ref.cluster, ref.group, ref.kind, ref.namespace || '', ref.name, ref.uid || ''])
  );
const collectionFor = (ref: ResourceReference) =>
  (Object.keys(collections) as Collection[]).find(
    id => collections[id].kind === ref.kind && collections[id].group === ref.group
  );
const matches = (item: Item, ref: ResourceReference) =>
  item.cluster === ref.cluster &&
  group(item.apiVersion) === ref.group &&
  item.kind === ref.kind &&
  item.metadata.namespace === ref.namespace &&
  item.metadata.name === ref.name &&
  (!ref.uid || item.metadata.uid === ref.uid);

export function relationRoute(
  ref: ResourceReference
): { name: string; params: Record<string, string> } | undefined {
  const collection = collectionFor(ref);
  const params = { name: ref.name, ...(ref.namespace ? { namespace: ref.namespace } : {}) };
  if (collection) return { name: `cert-manager-${collection}-detail`, params };
  if (ref.kind === 'Secret' && ref.group === '' && ref.namespace) return { name: 'secret', params };
  if (
    ref.kind === 'Ingress' &&
    ['networking.k8s.io', 'extensions'].includes(ref.group) &&
    ref.namespace
  )
    return { name: 'ingress', params };
  if (ref.kind === 'Gateway' && ref.group === 'gateway.networking.k8s.io' && ref.namespace)
    return {
      name: 'customresource',
      params: {
        crName: ref.name,
        namespace: ref.namespace,
        crd: 'gateways.gateway.networking.k8s.io',
      },
    };
  return undefined;
}

/** Only recorded ownership and declared references; never infer links from DNS names. */
export function certificateRelationships(
  certificate: Item,
  results: RelationResults,
  requestId = 'all'
) {
  const candidates = Object.values(results)
    .flatMap(result => result?.items || [])
    .filter(item => item.cluster === certificate.cluster);
  const requestCandidates = (results.certificaterequests?.items || [])
    .filter(item => {
      if (
        item.cluster !== certificate.cluster ||
        item.metadata.namespace !== certificate.metadata.namespace
      )
        return false;
      if (item.kind !== 'CertificateRequest' || group(item.apiVersion) !== 'cert-manager.io')
        return false;
      if (
        item.metadata.ownerReferences?.some(
          owner => owner.kind === 'Certificate' && owner.uid === certificate.metadata.uid
        )
      )
        return true;
      // Old requests without an owner may retain cert-manager's certificate-name annotation.
      // An owner with a different UID must never be associated with a replacement Certificate.
      return (
        !item.metadata.ownerReferences?.some(owner => owner.kind === 'Certificate') &&
        item.metadata.annotations?.['cert-manager.io/certificate-name'] ===
          certificate.metadata.name
      );
    })
    .sort(
      (a, b) =>
        Number(b.metadata.annotations?.['cert-manager.io/certificate-revision'] || 0) -
          Number(a.metadata.annotations?.['cert-manager.io/certificate-revision'] || 0) ||
        (timestamp(b.metadata.creationTimestamp) || 0) -
          (timestamp(a.metadata.creationTimestamp) || 0) ||
        a.metadata.name.localeCompare(b.metadata.name)
    );
  const requested = requestCandidates.filter(item => referenceId(reference(item)) === requestId);
  const selectedRequests = requestId === 'all' || !requested.length ? requestCandidates : requested;
  const related = selectedRequests
    .flatMap(item => [item, ...descendants(item, candidates)])
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.metadata.name.localeCompare(b.metadata.name));
  const nodes = new Map<string, RelationNode>();
  const edges = new Map<string, Edge>();
  const warnings = new Set<string>();

  function add(ref: ResourceReference, role: RelationRole, detail = '', referenceOnly = false) {
    const item = referenceOnly ? undefined : candidates.find(item => matches(item, ref));
    const resolved = item ? reference(item) : ref;
    const id = referenceId(resolved);
    if (nodes.has(id)) return id;
    const collection = collectionFor(ref);
    const result = collection ? results[collection] : undefined;
    const availability: Availability = item
      ? 'loaded'
      : referenceOnly || !collection
      ? 'reference'
      : !result
      ? 'loading'
      : result.error || result.missing
      ? 'unavailable'
      : 'missing';
    const state = item ? health(item) : undefined;
    const data: RelationData = {
      ref: resolved,
      item,
      role,
      availability,
      detail,
      status: state
        ? healthLabels[state]
        : {
            reference: 'Reference',
            missing: 'Not found',
            unavailable: 'Unavailable',
            loading: 'Loading',
            loaded: '',
          }[availability],
      color: state
        ? ({
            ready: 'success',
            failed: 'error',
            issuing: 'info',
            pending: 'warning',
            unknown: 'default',
          }[state] as RelationData['color'])
        : availability === 'missing' || availability === 'unavailable'
        ? 'warning'
        : 'default',
    };
    if (item && !detail) data.detail = message(item);
    if (availability === 'missing')
      warnings.add(`${ref.kind} ${ref.name} was not found in the loaded scope.`);
    nodes.set(id, {
      id,
      type: 'certificateRelation',
      position: { x: 0, y: 0 },
      data,
      draggable: false,
      selectable: false,
      style: { width: NODE_WIDTH, height: NODE_HEIGHT },
    });
    return id;
  }
  function connect(source: string, target: string, label: string, declared = false) {
    if (source === target) return;
    const id = encodeURIComponent(JSON.stringify([source, target, label]));
    edges.set(id, {
      id,
      source,
      target,
      label,
      type: 'smoothstep',
      data: { declared },
      style: { strokeWidth: 1.6, ...(declared ? { strokeDasharray: '6 4' } : {}) },
    });
  }
  const rootRef = reference(certificate);
  // The open object remains authoritative while list snapshots refresh.
  candidates.unshift(certificate);
  const root = add(rootRef, 'certificate', 'Certificate being inspected');

  function issuerFor(item: Item, target: string) {
    const issuer = item.spec?.issuerRef;
    if (!issuer?.name) return;
    const kind = issuer.kind || 'Issuer';
    const ref: ResourceReference = {
      cluster: item.cluster,
      group: issuer.group || 'cert-manager.io',
      kind,
      name: issuer.name,
      ...(kind === 'ClusterIssuer' ? {} : { namespace: item.metadata.namespace }),
    };
    const issuerId = add(ref, 'issuer');
    connect(issuerId, target, 'issuerRef', true);
    const loaded = nodes.get(issuerId)?.data.item;
    if (!loaded) return;
    const secretRefs = [
      { name: loaded.spec?.ca?.secretName, label: 'CA key pair' },
      { name: loaded.spec?.acme?.privateKeySecretRef?.name, label: 'ACME account key' },
    ].filter(value => value.name);
    for (const secret of secretRefs) {
      // ClusterIssuer Secret namespace is configured on the controller, not the object.
      // Keep it explicit and unresolved instead of guessing the "cert-manager" namespace.
      const secretId = add(
        {
          cluster: item.cluster,
          group: '',
          kind: 'Secret',
          name: secret.name,
          namespace: loaded.metadata.namespace,
        },
        'issuerSecret',
        loaded.metadata.namespace
          ? secret.label
          : `${secret.label} · controller resource namespace`,
        true
      );
      connect(secretId, issuerId, secret.label, true);
    }
  }
  issuerFor(certificate, root);
  for (const owner of certificate.metadata.ownerReferences || []) {
    const ownerId = add(
      {
        cluster: certificate.cluster,
        group: group(owner.apiVersion || ''),
        kind: owner.kind,
        name: owner.name,
        namespace: certificate.metadata.namespace,
        uid: owner.uid,
      },
      'owner',
      'Certificate owner reference',
      true
    );
    connect(ownerId, root, 'owns');
  }
  for (const item of selectedRequests) {
    const revision = item.metadata.annotations?.['cert-manager.io/certificate-revision'];
    const request = add(
      reference(item),
      'request',
      revision
        ? `Revision ${revision}${
            Number(revision) === certificate.status?.revision
              ? ' · current'
              : Number(revision) > (certificate.status?.revision || 0)
              ? ' · next issuance'
              : ' · retained'
          }`
        : 'Certificate signing request'
    );
    const owned = item.metadata.ownerReferences?.some(
      owner => owner.uid === certificate.metadata.uid
    );
    connect(root, request, owned ? 'creates request' : 'certificate-name annotation', !owned);
    issuerFor(item, request);
  }
  for (const kind of ['Order', 'Challenge'])
    for (const item of related) {
      if (item.kind !== kind || group(item.apiVersion) !== 'acme.cert-manager.io') continue;
      const parentKind = item.kind === 'Order' ? 'CertificateRequest' : 'Order';
      const parents = (item.metadata.ownerReferences || []).flatMap(owner => {
        const parent = related.find(
          candidate =>
            candidate.kind === parentKind &&
            candidate.metadata.uid === owner.uid &&
            candidate.metadata.namespace === item.metadata.namespace
        );
        const id = parent && referenceId(reference(parent));
        return id && nodes.has(id) ? [id] : [];
      });
      if (!parents.length) continue;
      const role = item.kind === 'Order' ? 'order' : 'challenge';
      const detail =
        item.kind === 'Challenge'
          ? [item.spec?.type, item.spec?.dnsName, item.spec?.wildcard ? 'wildcard' : '']
              .filter(Boolean)
              .join(' · ')
          : (item.spec?.dnsNames || []).join(', ');
      const id = add(reference(item), role, detail);
      for (const parent of parents)
        connect(parent, id, item.kind === 'Order' ? 'creates order' : 'validates domain');
    }
  for (const secret of [
    { name: certificate.spec?.secretName, label: 'TLS output' },
    { name: certificate.status?.nextPrivateKeySecretName, label: 'Next private key' },
  ]) {
    if (!secret.name) continue;
    const id = add(
      {
        cluster: certificate.cluster,
        group: '',
        kind: 'Secret',
        name: secret.name,
        namespace: certificate.metadata.namespace,
      },
      'secret',
      secret.label,
      true
    );
    connect(root, id, secret.label, true);
  }
  for (const id of [
    'certificaterequests',
    'orders',
    'challenges',
    'issuers',
    'clusterissuers',
  ] as Collection[]) {
    const result = results[id];
    if (!result) warnings.add(`${collections[id].label} are still loading.`);
    else if (result.error || result.missing)
      warnings.add(
        `${collections[id].label}: ${
          result.error || 'API unavailable'
        }. Relationships may be incomplete.`
      );
  }

  // Allocate each request's complete subtree its own vertical span.
  const columns = {
    issuerSecret: -1,
    issuer: 0,
    owner: 0,
    certificate: 1,
    request: 2,
    secret: 2,
    order: 3,
    challenge: 4,
  };
  const children = (id: string) =>
    [...edges.values()]
      .filter(
        edge =>
          edge.source === id && ['order', 'challenge'].includes(nodes.get(edge.target)!.data.role)
      )
      .map(edge => edge.target);
  const weight = (id: string): number =>
    Math.max(
      1,
      children(id).reduce((sum, child) => sum + weight(child), 0)
    );
  function place(id: string, top: number) {
    const node = nodes.get(id)!;
    node.position = {
      x: columns[node.data.role] * COLUMN_STEP,
      y: (top + (weight(id) - 1) / 2) * ROW_STEP,
    };
    let row = top;
    for (const child of children(id)) {
      place(child, row);
      row += weight(child);
    }
  }
  let row = 0;
  for (const item of selectedRequests) {
    const id = referenceId(reference(item));
    place(id, row);
    row += weight(id) + 1;
  }
  for (const node of nodes.values())
    if (node.data.role === 'secret') {
      node.position = { x: 2 * COLUMN_STEP, y: row * ROW_STEP };
      row++;
    }
  const center = (Math.max(0, row - 1) * ROW_STEP) / 2;
  nodes.get(root)!.position = { x: COLUMN_STEP, y: center };
  for (const column of [-1, 0]) {
    const values = [...nodes.values()].filter(node => columns[node.data.role] === column);
    values.forEach((node, index) => {
      node.position = {
        x: column * COLUMN_STEP,
        y: center + (index - (values.length - 1) / 2) * ROW_STEP,
      };
    });
  }
  const allNodes = [...nodes.values()];
  const minY = Math.min(...allNodes.map(node => node.position.y));
  let lane = 0;
  for (const edge of edges.values()) {
    const source = nodes.get(edge.source)!;
    const target = nodes.get(edge.target)!;
    if (target.position.x - source.position.x > COLUMN_STEP) {
      edge.type = 'routedRelation';
      edge.data = { ...edge.data, viaY: minY - 60 - lane++ * 26 };
    }
  }
  const displayed = allNodes.slice(0, MAX_DIAGRAM_NODES);
  const displayedIds = new Set(displayed.map(node => node.id));
  return {
    nodes: displayed,
    edges: [...edges.values()].filter(
      edge => displayedIds.has(edge.source) && displayedIds.has(edge.target)
    ),
    allNodes,
    allEdges: [...edges.values()],
    requests: requestCandidates,
    warnings: [...warnings],
    hidden: allNodes.length - displayed.length,
  };
}
