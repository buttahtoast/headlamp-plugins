import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DAY, Item } from './model';
import { CertificatesTable, CertManagerPage } from './ui';

const { snapshot } = vi.hoisted(() => ({
  snapshot: {
    results: {} as Record<string, any>,
    loading: false,
    updatedAt: Date.now(),
    refresh: vi.fn(),
  },
}));
vi.mock('./hooks', () => ({
  useScope: () => ({
    scopes: [{ cluster: 'main', namespaces: [] }],
    namespaces: [],
    clusters: ['main'],
  }),
  useCertManager: () => snapshot,
}));
vi.mock('@kinvolk/headlamp-plugin/lib/Utils', () => ({ useFilterFunc: () => () => true }));
vi.mock('./resources', () => ({ resourceClasses: {} }));
vi.mock('@kinvolk/headlamp-plugin/lib/ApiProxy', () => ({ request: vi.fn() }));
vi.mock('react-router-dom', () => ({ useParams: () => ({}) }));
vi.mock('@kinvolk/headlamp-plugin/lib/CommonComponents', () => ({
  Link: ({ children, routeName }: any) => <a href={`/${routeName}`}>{children}</a>,
  SectionBox: ({ title, children }: any) => <section aria-label={title}>{children}</section>,
  Resource: {},
  SimpleTable: ({ data, columns, emptyMessage }: any) => (
    <table>
      <tbody>
        {!data?.length ? (
          <tr>
            <td>{emptyMessage}</td>
          </tr>
        ) : (
          data.map((item: any, index: number) => (
            <tr key={index}>
              {columns.map((col: any, index: number) => (
                <td key={index}>{col.getter ? col.getter(item) : item[col.datum]}</td>
              ))}
            </tr>
          ))
        )}
      </tbody>
    </table>
  ),
}));
afterEach(cleanup);
const cert = (name: string, days?: number): Item => ({
  apiVersion: 'cert-manager.io/v1',
  kind: 'Certificate',
  cluster: 'main',
  metadata: { name, namespace: 'apps', uid: name },
  spec: { dnsNames: [`${name}.example.com`] },
  status: {
    notAfter: days === undefined ? undefined : new Date(Date.now() + days * DAY).toISOString(),
    conditions: [{ type: 'Ready', status: 'True' }],
  },
});

describe('certificate operations dashboard', () => {
  it('shows unknown expiry before an expiring but ready certificate, and disables renewal while issuing', () => {
    const issuing = cert('issuing', 60);
    issuing.status!.conditions!.push({ type: 'Issuing', status: 'True' });
    const onRenew = vi.fn();
    render(
      <CertificatesTable
        items={[issuing, cert('healthy', 80), cert('near-expiry', 3), cert('unknown')]}
        warningDays={30}
        now={Date.now()}
        onRenew={onRenew}
      />
    );
    const rows = screen.getAllByRole('row');
    expect(rows[0].textContent).toContain('unknown');
    expect(rows[1].textContent).toContain('near-expiry');
    expect(rows[1].textContent).toContain('Ready');
    fireEvent.click(within(rows[1]).getByRole('button', { name: 'Renew' }));
    expect(onRenew.mock.calls[0][0].metadata.name).toBe('near-expiry');
    expect(
      (within(rows[2]).getByRole('button', { name: 'Renew' }) as HTMLButtonElement).disabled
    ).toBe(true);
  });
  it('reports partial visibility and keeps loaded resources usable, with search affecting summary and tables', () => {
    snapshot.results = {
      certificates: { items: [cert('healthy', 80), cert('near-expiry', 3)] },
      clusterissuers: { items: [], error: 'Forbidden' },
    };
    render(<CertManagerPage />);
    expect(screen.getByRole('alert').textContent).toContain('Partial visibility');
    expect(screen.getByRole('heading', { name: 'Certificate expiry' })).toBeTruthy();
    expect(screen.getAllByText('near-expiry').length).toBeGreaterThan(0);
    fireEvent.change(screen.getByLabelText('Search certificates, DNS names, issuers'), {
      target: { value: 'healthy.example.com' },
    });
    expect(screen.queryByText('near-expiry')).toBeNull();
    expect(screen.getByText('healthy')).toBeTruthy();
  });
});
