import { describe, expect, it } from 'vitest';
import {
  canRollback,
  cleanerFromEditor,
  dashboardConnectionIssue,
  dashboardPath,
  defaultSettings,
  effectiveAction,
  hasReporting,
  validateCleaner,
} from './model';
import { recipeObject, recipes } from './recipes';

describe('Cleaner action safety', () => {
  it('accepts the single-document array returned by Headlamp and rejects multiple documents', () => {
    const value = recipeObject();
    expect(cleanerFromEditor([value])).toBe(value);
    expect(cleanerFromEditor(value)).toBe(value);
    expect(() => cleanerFromEditor([value, value])).toThrow('single Cleaner');
    expect(() => cleanerFromEditor([])).toThrow('single Cleaner');
  });
  it('treats an omitted action as Delete, matching the CRD default', () => {
    expect(effectiveAction({})).toBe('Delete');
    expect(effectiveAction({ action: 'Scan' })).toBe('Scan');
  });
  it('requires an explicit action when creating or editing policies', () => {
    const value = recipeObject();
    delete value.spec.action;
    expect(() => validateCleaner(value)).toThrow('Set action explicitly');
  });
  it('rejects other resources, namespaces, renames and transforms without code', () => {
    expect(() => validateCleaner({ ...recipeObject(), kind: 'Pod' })).toThrow('single Cleaner');
    expect(() =>
      validateCleaner({ ...recipeObject(), metadata: { name: 'test', namespace: 'default' } })
    ).toThrow('cluster-scoped');
    expect(() => validateCleaner(recipeObject(), 'other')).toThrow('name cannot be changed');
    const value = recipeObject();
    expect(() =>
      validateCleaner({ ...value, spec: { ...value.spec, action: 'Transform' } })
    ).toThrow('Lua transform');
  });
  it('creates report-only recipes with a bounded namespace', () => {
    for (const recipe of recipes) {
      const value = recipeObject(recipe);
      expect(() => validateCleaner(value)).not.toThrow();
      expect(value.spec.action).toBe('Scan');
      expect(hasReporting(value.spec)).toBe(true);
      expect(value.spec.resourcePolicySet.resourceSelectors[0].namespace).toBe('default');
    }
  });
});

describe('reports and dashboard connection', () => {
  it('reports a proxy permission failure without suggesting dashboard installation', () => {
    const issue = dashboardConnectionIssue({ status: 403, message: 'services/proxy forbidden' });
    expect(issue.canConfigure).toBe(false);
    expect(issue.message).toContain('access is denied');
    expect(issue.message).toContain('get and create permission');
  });
  it('recognizes permission errors when the API wrapper provides only a message', () => {
    expect(dashboardConnectionIssue(new Error('User "alice" is forbidden')).canConfigure).toBe(
      false
    );
  });
  it('distinguishes expired authentication from a missing dashboard service', () => {
    expect(dashboardConnectionIssue({ status: 401, message: 'Unauthorized' }).message).toContain(
      'Sign in again'
    );
    const missing = dashboardConnectionIssue({ status: 404, message: 'Service not found' });
    expect(missing.canConfigure).toBe(true);
    expect(missing.message).toContain('Service not found');
  });
  it('only offers rollback for mutating reports with captured data', () => {
    expect(canRollback()).toBe(false);
    expect(canRollback({ action: 'Delete', resourceInfo: null })).toBe(false);
    expect(canRollback({ action: 'Transform', resourceInfo: [{}] })).toBe(false);
    expect(canRollback({ action: 'Scan', resourceInfo: [{ fullResource: 'e30=' }] })).toBe(false);
    expect(canRollback({ action: 'Delete', resourceInfo: [{ fullResource: 'e30=' }] })).toBe(true);
  });
  it('uses the authenticated Kubernetes service proxy route', () => {
    expect(dashboardPath(defaultSettings, 'config')).toBe(
      '/api/v1/namespaces/k8s-cleaner/services/http:k8s-cleaner-web:9080/proxy/api/v1/config'
    );
  });
  it.each([
    { ...defaultSettings, namespace: '../default' },
    { ...defaultSettings, service: 'https://example.org' },
    { ...defaultSettings, port: '0' },
    { ...defaultSettings, port: '65536' },
    { ...defaultSettings, port: '../config' },
  ])('rejects invalid proxy connection components: %j', settings => {
    expect(() => dashboardPath(settings, 'config')).toThrow('valid namespace');
  });
});
