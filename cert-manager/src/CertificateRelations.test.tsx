import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CertificateRelations } from './CertificateRelations';
import { Item } from './model';
import { RelationResults } from './relationships';

vi.mock('@xyflow/react', () => ({
  Background: () => null,
  BackgroundVariant: { Dots: 'dots' },
  Controls: () => null,
  MiniMap: () => null,
  Handle: () => null,
  Position: { Left: 'left', Right: 'right' },
  MarkerType: { ArrowClosed: 'arrow' },
  BaseEdge: () => null,
  ReactFlowProvider: ({ children }: any) => children,
  ReactFlow: ({ nodes, nodeTypes, children }: any) => (
    <div>
      {nodes.map((node: any) => {
        const Card = nodeTypes[node.type];
        return (
          <div key={node.id}>
            <Card data={node.data} />
          </div>
        );
      })}
      {children}
    </div>
  ),
}));
vi.mock('@kinvolk/headlamp-plugin/lib/CommonComponents', () => ({
  Link: ({ children, activeCluster, routeName, params }: any) => (
    <a
      href={`/c/${activeCluster}/${routeName}/${params.namespace || ''}/${
        params.name || params.crName
      }`}
    >
      {children}
    </a>
  ),
  SimpleTable: ({ data, columns }: any) => (
    <table>
      <tbody>
        {data.map((item: any) => (
          <tr key={item.id}>
            {columns.map((col: any) => (
              <td key={col.label}>{col.getter(item)}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  ),
}));
afterEach(cleanup);

function fixture() {
  const cert: Item = {
    apiVersion: 'cert-manager.io/v1',
    kind: 'Certificate',
    cluster: 'main',
    metadata: { name: 'example', namespace: 'apps', uid: 'cert' },
    spec: { secretName: 'example-tls', issuerRef: { name: 'issuer' } },
    status: { revision: 2, conditions: [{ type: 'Ready', status: 'True' }] },
  };
  const issuer: Item = {
    ...cert,
    kind: 'Issuer',
    metadata: { name: 'issuer', namespace: 'apps', uid: 'issuer' },
    spec: { selfSigned: {} },
  };
  const request: Item = {
    ...cert,
    kind: 'CertificateRequest',
    metadata: {
      name: 'request-2',
      namespace: 'apps',
      uid: 'request-2',
      annotations: { 'cert-manager.io/certificate-revision': '2' },
      ownerReferences: [{ kind: 'Certificate', name: 'example', uid: 'cert' }],
    },
    spec: { issuerRef: { name: 'issuer' } },
  };
  const old: Item = {
    ...request,
    metadata: {
      ...request.metadata,
      name: 'request-1',
      uid: 'request-1',
      annotations: { 'cert-manager.io/certificate-revision': '1' },
    },
  };
  const order: Item = {
    ...cert,
    apiVersion: 'acme.cert-manager.io/v1',
    kind: 'Order',
    metadata: {
      name: 'acme-order',
      namespace: 'apps',
      uid: 'order',
      ownerReferences: [{ kind: 'CertificateRequest', name: 'request-2', uid: 'request-2' }],
    },
    spec: {},
    status: { state: 'invalid', reason: 'Authorization failed' },
  };
  const results: RelationResults = {
    certificates: { items: [cert] },
    issuers: { items: [issuer] },
    clusterissuers: { items: [] },
    certificaterequests: { items: [request, old] },
    orders: { items: [order] },
    challenges: { items: [] },
  };
  return { cert, results };
}

describe('certificate relationship diagram', () => {
  it('renders navigable resource cards, failure status and explicit Secret references', () => {
    const { cert, results } = fixture();
    render(<CertificateRelations certificate={cert} results={results} />);
    const diagram = screen.getByRole('region', {
      name: 'Certificate relationship diagram for example',
    });
    expect(
      within(diagram).getByRole('link', { name: 'acme-order' }).getAttribute('href')
    ).toContain('/main/cert-manager-orders-detail/apps/acme-order');
    expect(within(diagram).getByText('Failed')).toBeTruthy();
    expect(
      within(diagram).getByRole('link', { name: 'example-tls' }).getAttribute('href')
    ).toContain('/main/secret/apps/example-tls');
    expect(within(diagram).getByText('Reference')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it('filters a retained CSR revision and keeps all of its declared resource links in the table view', () => {
    const { cert, results } = fixture();
    render(<CertificateRelations certificate={cert} results={results} />);
    fireEvent.mouseDown(screen.getByLabelText('CertificateRequest revision'));
    fireEvent.click(within(screen.getByRole('listbox')).getByText('Revision 1 · request-1'));
    expect(screen.queryByRole('link', { name: 'request-2' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'acme-order' })).toBeNull();
    expect(screen.getByRole('link', { name: 'request-1' })).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Resources' }));
    expect(screen.getByRole('table')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'example-tls' })).toBeTruthy();
    expect(screen.queryByRole('region')).toBeNull();
  });
});
