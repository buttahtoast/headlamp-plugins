import { describe, expect, it } from 'vitest';
import {
  DAY,
  descendants,
  expiry,
  expiryOrder,
  expiryText,
  health,
  Item,
  needsAttention,
  portable,
  renewalComplete,
  renewalDue,
  renewalPatch,
  resourcePath,
} from './model';

const now = Date.parse('2026-11-01T00:00:00Z');
export function certificate(status: Item['status'] = {}): Item {
  return {
    apiVersion: 'cert-manager.io/v1',
    kind: 'Certificate',
    cluster: 'test',
    metadata: {
      name: 'example',
      namespace: 'apps',
      uid: 'cert-uid',
      resourceVersion: '42',
      generation: 2,
    },
    spec: { secretName: 'tls', dnsNames: ['example.com'] },
    status: {
      conditions: [{ type: 'Ready', status: 'True', observedGeneration: 2 }],
      revision: 4,
      ...status,
    },
  };
}

describe('expiry independently of readiness', () => {
  it.each([
    [-1, 'expired'],
    [0, 'expired'],
    [7, 'critical'],
    [7.01, 'warning'],
    [30, 'warning'],
    [30.01, 'healthy'],
  ])('classifies %s days remaining as %s', (days, expected) => {
    const item = certificate({ notAfter: new Date(now + Number(days) * DAY).toISOString() });
    expect(health(item)).toBe('ready');
    expect(expiry(item, 30, now)).toBe(expected);
    expect(needsAttention(item, 30, now)).toBe(expected !== 'healthy');
  });
  it('does not treat absent or malformed expiry as healthy', () => {
    for (const notAfter of [undefined, 'invalid']) {
      expect(expiry(certificate({ notAfter }), 30, now)).toBe('unknown');
      expect(needsAttention(certificate({ notAfter }), 30, now)).toBe(true);
    }
    expect(
      expiryText(certificate({ notAfter: new Date(now + 0.01 * DAY).toISOString() }), now)
    ).toBe('Expires in 1h');
  });
  it('sorts unknown and earliest expiry first', () => {
    const values = [
      certificate({ notAfter: '2027-01-01' }),
      certificate(),
      certificate({ notAfter: '2026-11-01' }),
    ];
    expect(values.sort(expiryOrder).map(item => item.status?.notAfter)).toEqual([
      undefined,
      '2026-11-01',
      '2027-01-01',
    ]);
  });
  it('supports a longer warning horizon and overdue renewal', () => {
    const item = certificate({
      notAfter: new Date(now + 50 * DAY).toISOString(),
      renewalTime: new Date(now - DAY).toISOString(),
    });
    expect(expiry(item, 60, now)).toBe('warning');
    expect(renewalDue(item, now)).toBe(true);
    item.status!.conditions!.push({ type: 'Issuing', status: 'True', observedGeneration: 2 });
    expect(renewalDue(item, now)).toBe(false);
  });
});

describe('conditions and renewal', () => {
  it('rejects readiness from an old generation and prioritizes issuance and denial', () => {
    expect(
      health(
        certificate({ conditions: [{ type: 'Ready', status: 'True', observedGeneration: 1 }] })
      )
    ).toBe('unknown');
    expect(health(certificate({ conditions: [{ type: 'Ready', status: 'True' }] }))).toBe('ready');
    expect(
      health(
        certificate({
          conditions: [
            { type: 'Ready', status: 'True' },
            { type: 'Issuing', status: 'True' },
          ],
        })
      )
    ).toBe('issuing');
    expect(
      health(
        certificate({
          conditions: [
            { type: 'Ready', status: 'True' },
            { type: 'Denied', status: 'True' },
          ],
        })
      )
    ).toBe('failed');
    expect(health({ ...certificate({ state: 'invalid' }), kind: 'Challenge' })).toBe('failed');
  });
  it('preserves conditions and guards object identity and concurrency', () => {
    const item = certificate();
    const patch = renewalPatch(item, new Date(now));
    expect(patch.slice(0, 2)).toEqual([
      { op: 'test', path: '/metadata/uid', value: 'cert-uid' },
      { op: 'test', path: '/metadata/resourceVersion', value: '42' },
    ]);
    expect(patch.at(-1)?.value).toEqual([
      item.status!.conditions![0],
      {
        type: 'Issuing',
        status: 'True',
        observedGeneration: 2,
        reason: 'ManuallyTriggered',
        message: 'Certificate re-issuance manually triggered',
        lastTransitionTime: new Date(now).toISOString(),
      },
    ]);
    expect(item.status!.conditions).toHaveLength(1);
    expect(() =>
      renewalPatch(certificate({ conditions: [{ type: 'Issuing', status: 'True' }] }))
    ).toThrow('already issuing');
    expect(() => renewalPatch({ ...item, metadata: { ...item.metadata, uid: undefined } })).toThrow(
      'UID'
    );
  });
  it('does not mistake submission or pre-existing readiness for successful renewal', () => {
    const before = certificate();
    expect(renewalComplete(before, certificate())).toBe(false);
    expect(
      renewalComplete(
        before,
        certificate({ revision: 5, conditions: [{ type: 'Issuing', status: 'True' }] })
      )
    ).toBe(false);
    expect(renewalComplete(before, certificate({ revision: 5 }))).toBe(true);
    expect(
      renewalComplete(before, {
        ...certificate({ revision: 5 }),
        metadata: { ...before.metadata, uid: 'replacement' },
      })
    ).toBe(false);
  });
  it('follows owner UIDs across requests and orders without name-based cross links', () => {
    const root = certificate();
    const request = {
      ...certificate(),
      kind: 'CertificateRequest',
      metadata: {
        name: 'request',
        namespace: 'apps',
        uid: 'request-uid',
        ownerReferences: [{ kind: 'Certificate', name: 'example', uid: 'cert-uid' }],
      },
    };
    const order = {
      ...certificate(),
      kind: 'Order',
      metadata: {
        name: 'order',
        namespace: 'apps',
        uid: 'order-uid',
        ownerReferences: [{ kind: 'CertificateRequest', name: 'request', uid: 'request-uid' }],
      },
    };
    const unrelated = { ...request, metadata: { ...request.metadata, namespace: 'other' } };
    expect(descendants(root, [order, request, unrelated])).toEqual([request, order]);
  });
  it('exports desired configuration without status or server identity', () => {
    const exported = portable(certificate());
    expect(exported).not.toHaveProperty('status');
    expect(exported.metadata).not.toHaveProperty('uid');
    expect(resourcePath('clusterissuers', 'apps', 'ca')).toBe(
      '/apis/cert-manager.io/v1/clusterissuers/ca'
    );
    expect(resourcePath('challenges', 'apps', 'domain')).toBe(
      '/apis/acme.cert-manager.io/v1/namespaces/apps/challenges/domain'
    );
  });
});
