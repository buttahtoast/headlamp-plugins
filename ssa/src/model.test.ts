// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { buildSSAFieldLines, managerKey, mergeSSAFields, ownershipFields } from './shared/model';

describe('manager ownership model', () => {
  it('exposes any manager and keeps status separate from main-resource ownership', () => {
    const main = { manager: 'custom-operator', operation: 'Apply', fieldsV1: { 'f:spec': {} } };
    const status = {
      manager: 'custom-operator',
      operation: 'Update',
      subresource: 'status',
      fieldsV1: { 'f:status': {} },
    };
    const value = {
      metadata: {
        managedFields: [
          main,
          status,
          { ...main, fieldsV1: {} },
          { ...main, fieldsV1: null },
          { ...main, fieldsV1: [] },
        ],
      },
    };
    expect(ownershipFields(value)).toEqual([main]);
    expect(ownershipFields(value, true)).toEqual([main, status]);
    expect(managerKey(main)).not.toBe(managerKey({ ...main, subresource: 'status' }));
  });
  it('renders a union of managers while preserving unrelated fields and resource values', () => {
    const object = {
      metadata: { name: 'demo', managedFields: [{ manager: 'test' }] },
      data: { managedFields: 'user data', one: 'a', two: 'b', unowned: 'c' },
    };
    const fields = mergeSSAFields({ 'f:data': { 'f:one': {} } }, { 'f:data': { 'f:two': {} } });
    const lines = buildSSAFieldLines(object, fields);
    expect(lines.find(line => line.text.trim() === 'one: "a"')?.managed).toBe(true);
    expect(lines.find(line => line.text.trim() === 'two: "b"')?.managed).toBe(true);
    expect(lines.find(line => line.text.trim() === 'unowned: "c"')?.managed).toBe(false);
    expect(lines.some(line => /^  managedFields:/.test(line.text))).toBe(true);
    expect(object.metadata.managedFields).toHaveLength(1);
  });
  it('handles partial keyed-list membership and atomic nested values', () => {
    const object = {
      spec: {
        containers: [
          { name: 'app', image: 'new', extra: 'manual' },
          { name: 'sidecar', image: 'old' },
        ],
        atomic: { nested: true },
      },
    };
    const lines = buildSSAFieldLines(object, {
      'f:spec': {
        'f:containers': { 'k:{"name":"app"}': { '.': {}, 'f:image': {} } },
        'f:atomic': {},
      },
    });
    expect(lines.find(line => line.text.trim() === 'image: "new"')?.managed).toBe(true);
    expect(lines.find(line => line.text.trim() === 'extra: "manual"')?.managed).toBe(false);
    expect(lines.find(line => line.text.trim() === 'image: "old"')?.managed).toBe(false);
    expect(lines.find(line => line.text.trim() === 'nested: true')?.managed).toBe(true);
  });
});
