import { ResourceInfo } from './model';

export interface KindBranch {
  key: string;
  kind: string;
  apiVersion: string;
  resources: { info: ResourceInfo; index: number }[];
}

export interface NamespaceBranch {
  key: string;
  label: string;
  count: number;
  kinds: KindBranch[];
}

/** The tree contains report entries, grouped without interpreting owner references. */
export function groupReportResources(items: ResourceInfo[]) {
  const scopes = new Map<string, NamespaceBranch>();
  const kinds = new Set<string>();
  const namespaces = new Set<string>();
  items.forEach((info, index) => {
    const ref = info.resource;
    const scopeKey = ref ? ref.namespace || '' : '\0unknown';
    if (ref?.namespace) namespaces.add(ref.namespace);
    let scope = scopes.get(scopeKey);
    if (!scope) {
      scope = {
        key: scopeKey,
        label: ref ? ref.namespace || 'Cluster-scoped' : 'Unknown scope',
        count: 0,
        kinds: [],
      };
      scopes.set(scopeKey, scope);
    }
    const kind = ref?.kind || 'Unknown kind';
    const apiVersion = ref?.apiVersion || '';
    const key = JSON.stringify([apiVersion, kind]);
    kinds.add(key);
    let branch = scope.kinds.find(item => item.key === key);
    if (!branch) {
      branch = { key, kind, apiVersion, resources: [] };
      scope.kinds.push(branch);
    }
    scope.count++;
    branch.resources.push({ info, index });
  });
  const branches = [...scopes.values()].sort((a, b) => a.label.localeCompare(b.label));
  branches.forEach(scope => {
    scope.kinds.sort(
      (a, b) => a.kind.localeCompare(b.kind) || a.apiVersion.localeCompare(b.apiVersion)
    );
    scope.kinds.forEach(kind =>
      kind.resources.sort(
        (a, b) =>
          (a.info.resource?.name || '').localeCompare(b.info.resource?.name || '') ||
          a.index - b.index
      )
    );
  });
  return { branches, total: items.length, kinds: kinds.size, namespaces: namespaces.size };
}
