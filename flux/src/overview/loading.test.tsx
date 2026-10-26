import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const { request, state } = vi.hoisted(() => ({
  request: vi.fn(),
  state: {
    cluster: 'cluster-a',
    clusters: ['cluster-a'],
    namespaces: undefined as string[] | undefined,
    hung: false,
  },
}));
vi.mock('@kinvolk/headlamp-plugin/lib/ApiProxy', () => ({ request }));
vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  K8s: {
    cluster: {
      KubeObject: class {
        static useList() {
          throw new Error('Overview must not wait for SDK list/watch hooks.');
        }
      },
    },
    useCluster: () => state.cluster,
    useSelectedClusters: () => [...state.clusters],
  },
  useTranslation: () => ({
    t: (text: string, values?: any) =>
      text.replace(/\{\{(\w+)\}\}/g, (_, key) => String(values?.[key] ?? key)),
  }),
}));
vi.mock('@kinvolk/headlamp-plugin/lib/CommonComponents', () => ({
  Link: ({ children, routeName }: any) => <a href={`/${routeName}`}>{children}</a>,
}));
vi.mock('@kinvolk/headlamp-plugin/lib/Utils', () => ({
  useFilterFunc: () => (item: any) =>
    !state.namespaces?.length || state.namespaces.includes(item.metadata.namespace),
}));
vi.mock('../helpers', () => ({ useNamespaces: () => state.namespaces }));
vi.mock('../settings', () => ({
  store: { get: () => ({ overviewShowFilter: 'all' }), set: vi.fn() },
}));
vi.mock('./client', async importOriginal => {
  const original = await importOriginal<any>();
  return { ...original, overviewClient: original.createOverviewClient(request, 80, 120) };
});
import { FluxOverview } from './index';

function item(kind: string, name: string, namespace = 'team') {
  return {
    kind,
    metadata: { uid: name, name, namespace, generation: 1 },
    spec: {},
    status: { observedGeneration: 1, conditions: [{ type: 'Ready', status: 'True' }] },
  };
}
beforeEach(() => {
  state.cluster = 'cluster-a';
  state.clusters = ['cluster-a'];
  state.namespaces = undefined;
  state.hung = false;
  localStorage.clear();
  request.mockReset();
  request.mockImplementation(async path => {
    const url = new URL(path, 'http://cluster');
    if (url.pathname.includes('artifactgenerators')) {
      if (state.hung) return new Promise(() => {});
      throw Object.assign(new Error('API not installed'), { status: 404 });
    }
    if (url.pathname.endsWith('/kustomizations'))
      return { items: [item('Kustomization', 'sample-config')] };
    if (url.pathname.endsWith('/helmreleases'))
      return {
        items: [
          item('HelmRelease', 'sample-release-one'),
          item('HelmRelease', 'sample-release-two'),
        ],
      };
    if (url.pathname.endsWith('/namespaces/team/deployments')) return { items: [] };
    if (url.pathname.endsWith('/deployments'))
      return {
        items: [
          {
            ...item('Deployment', 'source-controller', 'flux-system'),
            spec: { replicas: 1 },
            status: { readyReplicas: 1, observedGeneration: 1 },
          },
        ],
      };
    return { items: [] };
  });
});
afterEach(cleanup);

describe('mounted overview loading', () => {
  it.skipIf(!process.env.HEADLAMP_FLUX_OVERVIEW_FIXTURES)(
    'renders the counts and controllers from captured live Kubernetes responses',
    async () => {
      const fixture = JSON.parse(
        readFileSync(process.env.HEADLAMP_FLUX_OVERVIEW_FIXTURES!, 'utf8')
      );
      request.mockImplementation(async path => {
        const response = fixture.responses[new URL(path, 'http://cluster').pathname];
        if (!response) throw new Error(`No live response for ${path}`);
        if (response.error) throw Object.assign(new Error(response.error.message), response.error);
        return response;
      });
      render(<FluxOverview />);
      await waitFor(() => expect(screen.queryByLabelText('Loading Flux dashboard')).toBeNull());
      expect(
        screen.getAllByText('Kustomizations')[0].parentElement?.querySelector('h4')?.textContent
      ).toBe(String(fixture.counts.kustomizations));
      expect(
        screen.getByText('Helm releases').parentElement?.querySelector('h4')?.textContent
      ).toBe(String(fixture.counts.helmreleases));
      const controllers = fixture.responses['/apis/apps/v1/deployments'].items;
      expect(controllers).toHaveLength(fixture.counts.controllers);
      for (const controller of controllers)
        expect(
          screen.getByRole('link', { name: controller.metadata.name.replace(/-controller$/, '') })
        ).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Refresh' }).getAttribute('disabled')).toBeNull();
      expect(screen.queryByText('Partial visibility')).toBeNull();
      expect(request).toHaveBeenCalledTimes(16);
    }
  );
  it('renders actual loader results and finishes when an optional API is absent', async () => {
    render(<FluxOverview />);
    await waitFor(() => expect(screen.queryByLabelText('Loading Flux dashboard')).toBeNull());
    expect(screen.getByText('Helm Releases')).toBeTruthy();
    expect(screen.getAllByText('Kustomizations').length).toBeGreaterThan(0);
    expect(screen.getByText('source')).toBeTruthy();
    expect(screen.getByText('Healthy')).toBeTruthy();
    expect(screen.getByText('API not installed')).toBeTruthy();
    const calls = request.mock.calls.length;
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(request.mock.calls.length).toBe(calls);
    expect(calls).toBe(16);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(request.mock.calls.length).toBeGreaterThan(calls));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Refresh' }).getAttribute('disabled')).toBeNull()
    );
  });
  it('keeps completed data visible while a stalled collection times out and stops the initial progress indicator', async () => {
    state.hung = true;
    render(<FluxOverview />);
    await screen.findByText('Helm Releases');
    await waitFor(() => expect(screen.queryByLabelText('Loading Flux dashboard')).toBeNull());
    expect(screen.getByText('Partial visibility')).toBeTruthy();
    expect(screen.getByText(/Artifact Generators: Request timed out/)).toBeTruthy();
    expect(screen.getByText('source')).toBeTruthy();
  });
  it('does not reload repeatedly on rerender and cancels the old cluster scope', async () => {
    const result = render(<FluxOverview />);
    await waitFor(() => expect(screen.queryByLabelText('Loading Flux dashboard')).toBeNull());
    const calls = request.mock.calls.length;
    result.rerender(<FluxOverview />);
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(request.mock.calls).toHaveLength(calls);
    state.cluster = 'cluster-b';
    state.clusters = ['cluster-b'];
    result.rerender(<FluxOverview />);
    await waitFor(() =>
      expect(
        request.mock.calls.slice(calls).every(call => call[1].cluster === 'cluster-b') &&
          request.mock.calls.length > calls
      ).toBe(true)
    );
    await waitFor(() => expect(screen.queryByLabelText('Loading Flux dashboard')).toBeNull());
  });
  it('keeps namespace-scoped reads narrow and does not broaden an excluded allowed-namespace selection', async () => {
    state.namespaces = ['team'];
    localStorage.setItem(
      'cluster_settings.cluster-a',
      JSON.stringify({ allowedNamespaces: ['team', 'flux-system'] })
    );
    const result = render(<FluxOverview />);
    await waitFor(() => expect(screen.queryByLabelText('Loading Flux dashboard')).toBeNull());
    expect(
      request.mock.calls
        .filter(call => !call[0].includes('deployments'))
        .every(call => call[0].includes('/namespaces/team/'))
    ).toBe(true);
    expect(
      request.mock.calls.some(call => call[0].includes('/namespaces/flux-system/deployments'))
    ).toBe(true);
    const calls = request.mock.calls.length;
    state.namespaces = ['unrelated'];
    result.rerender(<FluxOverview />);
    await screen.findByText('No Flux resources in this scope');
    expect(request.mock.calls).toHaveLength(calls);
  });
});
