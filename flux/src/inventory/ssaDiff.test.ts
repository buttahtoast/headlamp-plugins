// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { buildSSAFieldLines, mergeSSAFields, selectFluxManagedFields } from './ssaDiff';

describe('Flux SSA ownership', () => {
  it('selects Flux Apply records and excludes status, unrelated managers and Helm Update records', () => {
    const fields = [
      { manager: 'kustomize-controller', operation: 'Apply', fieldsV1: { 'f:spec': {} } },
      {
        manager: 'kustomize-controller',
        operation: 'Update',
        subresource: 'status',
        fieldsV1: { 'f:status': {} },
      },
      { manager: 'kubectl', operation: 'Apply', fieldsV1: { 'f:data': {} } },
      { manager: 'helm', operation: 'Update', fieldsV1: { 'f:spec': {} } },
      { manager: 'helm-controller', operation: 'Apply', fieldsV1: { 'f:spec': {} } },
    ];
    expect(selectFluxManagedFields(fields, 'Kustomization')).toEqual([fields[0]]);
    expect(selectFluxManagedFields(fields, 'HelmRelease')).toEqual([fields[4]]);
    expect(selectFluxManagedFields([fields[3]], 'HelmRelease')).toEqual([]);
  });
  it('highlights managed fields within live context and removes only metadata.managedFields', () => {
    const object = {
      metadata: {
        name: 'settings',
        labels: { flux: 'yes', manual: 'keep' },
        managedFields: [{ manager: 'kustomize-controller' }],
      },
      data: { managedFields: 'legitimate data', enabled: 'true' },
      status: { phase: 'Active' },
    };
    const tree = mergeSSAFields(
      { 'f:metadata': { 'f:labels': { 'f:flux': {} } } },
      { 'f:data': { 'f:enabled': {} } }
    );
    const lines = buildSSAFieldLines(object, tree);
    expect(lines.find(line => line.text.trim() === 'flux: "yes"')?.managed).toBe(true);
    expect(lines.find(line => line.text.trim() === 'manual: "keep"')?.managed).toBe(false);
    expect(lines.find(line => line.text.trim() === 'enabled: "true"')?.managed).toBe(true);
    expect(lines.find(line => line.text.trim() === 'phase: "Active"')?.managed).toBe(false);
    expect(lines.filter(line => line.text.includes('managedFields'))).toEqual([
      { text: '  managedFields: "legitimate data"', managed: false },
    ]);
    expect(object.metadata.managedFields).toHaveLength(1);
  });
  it('handles keyed list membership without claiming every field on the item', () => {
    const lines = buildSSAFieldLines(
      {
        spec: {
          containers: [
            { name: 'app', image: 'app:v2', resources: { cpu: '100m' } },
            { name: 'sidecar', image: 'side:v1' },
          ],
        },
      },
      {
        'f:spec': {
          'f:containers': { 'k:{"name":"app"}': { '.': {}, 'f:name': {}, 'f:image': {} } },
        },
      }
    );
    expect(lines.find(line => line.text.trim() === 'image: "app:v2"')?.managed).toBe(true);
    expect(lines.find(line => line.text.trim() === 'cpu: "100m"')?.managed).toBe(false);
    expect(lines.find(line => line.text.trim() === 'image: "side:v1"')?.managed).toBe(false);
  });
  it('supports set values, positional arrays and atomic fields', () => {
    const value = {
      spec: { access: ['read', 'write'], ordered: ['a', 'b'], atomic: { nested: { value: 1 } } },
    };
    const tree = {
      'f:spec': { 'f:access': { 'v:"read"': {} }, 'f:ordered': { 'i:1': {} }, 'f:atomic': {} },
    };
    const lines = buildSSAFieldLines(value, tree);
    expect(lines.find(line => line.text.trim() === '- "read"')?.managed).toBe(true);
    expect(lines.find(line => line.text.trim() === '- "write"')?.managed).toBe(false);
    expect(lines.find(line => line.text.trim() === '- "a"')?.managed).toBe(false);
    expect(lines.find(line => line.text.trim() === '- "b"')?.managed).toBe(true);
    expect(lines.find(line => line.text.trim() === 'value: 1')?.managed).toBe(true);
  });
  it('does not infer ownership from an empty or malformed field set', () => {
    expect(buildSSAFieldLines({ spec: { replicas: 3 } }, {}).every(line => !line.managed)).toBe(
      true
    );
    expect(
      buildSSAFieldLines({ values: ['x'] }, { 'f:values': { 'k:not-json': {} } }).find(line =>
        line.text.includes('"x"')
      )?.managed
    ).toBe(false);
  });
});
