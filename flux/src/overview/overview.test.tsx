import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { state } = vi.hoisted(() => ({ state: { groups: [] as any[], controllers: [] as any[] } }));
vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  useTranslation: () => ({
    t: (value: string, args?: any) =>
      value.replace(/\{\{(\w+)\}\}/g, (_, key) => String(args?.[key] ?? key)),
  }),
  K8s: { ResourceClasses: { Deployment: { useList: () => [state.controllers, null] } } },
}));
vi.mock('@kinvolk/headlamp-plugin/lib/CommonComponents', () => ({
  Link: ({ children, routeName }: any) => <a href={`/${routeName}`}>{children}</a>,
}));
vi.mock('@kinvolk/headlamp-plugin/lib/Utils', () => ({
  useFilterFunc: () => (_item: any, search?: string) => {
    if (search !== undefined) throw new Error('Array index was passed as search text');
    return true;
  },
}));
vi.mock('../helpers', () => ({ useNamespaces: () => ['team'] }));
vi.mock('../settings', () => ({
  store: { get: () => ({ overviewShowFilter: 'all' }), set: vi.fn() },
}));
vi.mock('./data', () => ({
  useFluxOverview: () => ({
    groups: state.groups,
    controllers: state.controllers,
    controllerError: undefined,
    loading: false,
    refresh: () => {},
  }),
}));
import { FluxOverview } from './index';

beforeEach(() => {
  state.groups = [
    {
      id: 'kustomizations',
      label: 'Kustomizations',
      route: 'kustomizations',
      icon: 'mdi:kubernetes',
      category: 'Reconciliations',
      items: [
        {
          metadata: { uid: 'ks', name: 'app', namespace: 'team' },
          kind: 'Kustomization',
          status: {
            conditions: [{ type: 'Ready', status: 'True' }],
            inventory: { entries: [1, 2, 3] },
          },
        },
      ],
    },
    {
      id: 'helmreleases',
      label: 'Helm Releases',
      route: 'helmreleases',
      icon: 'mdi:ferry',
      category: 'Reconciliations',
      items: [],
    },
  ];
  state.controllers = [
    {
      metadata: {
        uid: 'controller',
        name: 'source-controller',
        namespace: 'flux-system',
        generation: 1,
      },
      spec: { replicas: 1 },
      status: { readyReplicas: 1, observedGeneration: 1 },
    },
  ];
});

describe('Flux dashboard composition', () => {
  it('renders the Cilium-style operational panels and active namespace scope', () => {
    const html = renderToStaticMarkup(<FluxOverview />);
    for (const text of [
      'GitOps delivery and reconciliation',
      'team',
      'Needs attention',
      'Namespace readiness',
      'Reconciliation activity',
      'Installation',
      'Resources',
      '3 inventory objects',
    ])
      expect(html).toContain(text);
    expect(html).toContain('Nothing needs attention');
  });
  it('makes permission failures explicit rather than reporting a healthy empty list', () => {
    state.groups[0] = {
      ...state.groups[0],
      items: null,
      error: { status: 403, message: 'Forbidden' },
    };
    const html = renderToStaticMarkup(<FluxOverview />);
    expect(html).toContain('Partial visibility');
    expect(html).toContain('Forbidden');
    expect(html).not.toContain('>Healthy<');
  });
});
