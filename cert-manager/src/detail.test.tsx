import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { CertManagerPage } from './ui';

const { snapshot } = vi.hoisted(() => ({
  snapshot: {
    results: {} as Record<string, any>,
    loading: false,
    updatedAt: Date.now(),
    refresh: vi.fn(),
    native: undefined as any,
  },
}));
vi.mock('./hooks', () => ({
  useScope: () => ({
    scopes: [{ cluster: 'main', namespaces: ['apps'] }],
    namespaces: ['apps'],
    clusters: ['main'],
  }),
  useCertManager: () => snapshot,
}));
vi.mock('./resources', () => ({ resourceClasses: { certificates: {} } }));
vi.mock('@kinvolk/headlamp-plugin/lib/Utils', () => ({ useFilterFunc: () => () => true }));
vi.mock('@kinvolk/headlamp-plugin/lib/ApiProxy', () => ({ request: vi.fn() }));
vi.mock('react-router-dom', () => ({ useParams: () => ({ namespace: 'apps', name: 'example' }) }));
vi.mock('@kinvolk/headlamp-plugin/lib/CommonComponents', () => ({
  Link: ({ children, routeName, params }: any) => (
    <a href={`/${routeName}/${params?.name || ''}`}>{children}</a>
  ),
  Resource: {
    DetailsGrid: ({ children, actions, onResourceUpdate }: any) => (
      <main>
        {snapshot.native && (
          <button onClick={() => onResourceUpdate({ jsonData: snapshot.native, cluster: 'main' })}>
            Load native certificate
          </button>
        )}
        {actions}
        {children}
      </main>
    ),
    ConditionsTable: () => null,
  },
  SectionBox: ({ children }: any) => children,
  SimpleTable: () => null,
}));

const width = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
const height = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
const bbox = Object.getOwnPropertyDescriptor(SVGElement.prototype, 'getBBox');
beforeAll(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      callback: ResizeObserverCallback;
      targets = new Set<Element>();
      constructor(callback: ResizeObserverCallback) {
        this.callback = callback;
      }
      observe(target: Element) {
        this.targets.add(target);
        queueMicrotask(() => {
          if (this.targets.has(target))
            this.callback(
              [{ target, contentRect: target.getBoundingClientRect() } as ResizeObserverEntry],
              this as any
            );
        });
      }
      unobserve(target: Element) {
        this.targets.delete(target);
      }
      disconnect() {
        this.targets.clear();
      }
    }
  );
  vi.stubGlobal(
    'DOMMatrixReadOnly',
    class {
      m22 = 1;
    }
  );
  Object.defineProperty(SVGElement.prototype, 'getBBox', {
    configurable: true,
    value: () => ({ x: 0, y: 0, width: 100, height: 16 }),
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get() {
      return Number.parseFloat(this.style.width) || 1000;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get() {
      return Number.parseFloat(this.style.height) || 560;
    },
  });
});
afterEach(cleanup);
afterAll(() => {
  if (width) Object.defineProperty(HTMLElement.prototype, 'offsetWidth', width);
  else delete (HTMLElement.prototype as any).offsetWidth;
  if (height) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', height);
  else delete (HTMLElement.prototype as any).offsetHeight;
  if (bbox) Object.defineProperty(SVGElement.prototype, 'getBBox', bbox);
  else delete (SVGElement.prototype as any).getBBox;
  vi.unstubAllGlobals();
});

describe('certificate detail integration with React Flow', () => {
  it('mounts the actual graph inside the certificate detail route', async () => {
    const cert = {
      apiVersion: 'cert-manager.io/v1',
      kind: 'Certificate',
      cluster: 'main',
      metadata: { name: 'example', namespace: 'apps', uid: 'cert' },
      spec: { secretName: 'example-tls', issuerRef: { name: 'issuer' } },
      status: { revision: 1, conditions: [{ type: 'Ready', status: 'True' }] },
    };
    const issuer = {
      ...cert,
      kind: 'Issuer',
      metadata: { name: 'issuer', namespace: 'apps', uid: 'issuer' },
      spec: { selfSigned: {} },
    };
    snapshot.results = {
      certificates: { items: [cert] },
      issuers: { items: [issuer] },
      clusterissuers: { items: [] },
      certificaterequests: { items: [] },
      orders: { items: [] },
      challenges: { items: [] },
    };
    render(<CertManagerPage collection="certificates" detail />);
    expect(screen.getByRole('heading', { name: 'Certificate relationships' })).toBeTruthy();
    expect(
      screen.getByRole('region', { name: 'Certificate relationship diagram for example' })
    ).toBeTruthy();
    expect(await screen.findByRole('link', { name: 'example' })).toBeTruthy();
    expect(document.querySelector('.react-flow__viewport')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Relationships' }));
    const dialog = await screen.findByRole('dialog', {
      name: 'Certificate relationships · example',
    });
    expect(await within(dialog).findByRole('link', { name: 'example' })).toBeTruthy();
    const ids = [...document.querySelectorAll('.react-flow')].map(element => element.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });
  it('shows relationships for a certificate loaded by the native detail view even when listing Certificates is forbidden', async () => {
    const cert = {
      apiVersion: 'cert-manager.io/v1',
      kind: 'Certificate',
      metadata: { name: 'example', namespace: 'apps', uid: 'native-cert', resourceVersion: '3' },
      spec: { secretName: 'example-tls', issuerRef: { name: 'issuer' } },
      status: { conditions: [{ type: 'Ready', status: 'True' }] },
    };
    snapshot.native = cert;
    snapshot.results = {
      certificates: { items: [], error: 'Forbidden' },
      issuers: { items: [] },
      clusterissuers: { items: [] },
      certificaterequests: { items: [] },
      orders: { items: [] },
      challenges: { items: [] },
    };
    render(<CertManagerPage collection="certificates" detail />);
    expect(screen.queryByRole('heading', { name: 'Certificate relationships' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Load native certificate' }));
    expect(screen.getByRole('heading', { name: 'Certificate relationships' })).toBeTruthy();
    expect(await screen.findByRole('link', { name: 'example' })).toBeTruthy();
    snapshot.native = undefined;
  });
});
