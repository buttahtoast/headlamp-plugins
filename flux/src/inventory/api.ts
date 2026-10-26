import { request } from '@kinvolk/headlamp-plugin/lib/ApiProxy';
import { parseAllDocuments } from 'yaml';
import { InventoryRecord, manifestReference, ObjectRef } from './model';

export async function resolveInventory(
  cluster: string,
  refs: ObjectRef[],
  onRecord: (record: InventoryRecord) => void,
  signal: AbortSignal
) {
  const discovery = new Map<string, Promise<any>>();
  let next = 0;
  async function worker() {
    while (next < refs.length && !signal.aborted) {
      const ref = refs[next++];
      let requestedObject = false;
      try {
        const base = ref.group ? `/apis/${ref.group}/${ref.version}` : `/api/${ref.version}`;
        if (!discovery.has(base))
          discovery.set(base, request(base, { cluster, signal, autoLogoutOnAuthError: false }));
        const api = await discovery.get(base);
        const resource = api.resources?.find(
          (item: any) => item.kind === ref.kind && !item.name.includes('/')
        );
        if (!resource)
          throw Object.assign(new Error('This kind or API version is not served.'), {
            status: 404,
          });
        const namespace = resource.namespaced ? ref.namespace : undefined;
        if (resource.namespaced && !namespace)
          throw new Error('Inventory entry is missing a namespace.');
        const path = `${base}${namespace ? `/namespaces/${encodeURIComponent(namespace)}` : ''}/${
          resource.name
        }/${encodeURIComponent(ref.name)}`;
        requestedObject = true;
        const object = await request(path, { cluster, signal, autoLogoutOnAuthError: false });
        if (!signal.aborted)
          onRecord({
            ...ref,
            namespace,
            id: ref.id,
            object,
            plural: resource.name,
            state: 'loaded',
          });
      } catch (error) {
        if (!signal.aborted)
          onRecord({
            ...ref,
            state:
              error.status === 404 && requestedObject
                ? 'missing'
                : error.status === 403 || error.status === 401
                ? 'forbidden'
                : 'error',
            message: error.message || String(error),
          });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(6, refs.length) }, worker));
}

export async function decodeHelmRelease(encoded: string) {
  if (encoded.length > 48 * 1024 * 1024)
    throw new Error('Helm release record exceeds the inspection limit.');
  const bytes = Uint8Array.from(atob(atob(encoded)), ch => ch.charCodeAt(0));
  const stream = new Blob([bytes]).stream();
  const source =
    bytes[0] === 0x1f && bytes[1] === 0x8b
      ? stream.pipeThrough(new DecompressionStream('gzip'))
      : stream;
  const reader = source.getReader();
  const parts: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.length;
      if (length > 64 * 1024 * 1024)
        throw new Error('Expanded Helm release exceeds the 64 MiB inspection limit.');
      parts.push(part.value);
    }
  } finally {
    await reader.cancel();
  }
  const all = new Uint8Array(length);
  let offset = 0;
  parts.forEach(part => {
    all.set(part, offset);
    offset += part.length;
  });
  const release = JSON.parse(new TextDecoder().decode(all));
  if (typeof release.manifest !== 'string')
    throw new Error('Helm release record has no rendered manifest.');
  return release;
}

export function helmManifestReferences(manifest: string, namespace: string): ObjectRef[] {
  const references = new Map<string, ObjectRef>();
  const add = (value: any) => {
    if (!value) return;
    if (value.kind === 'List' && Array.isArray(value.items)) {
      value.items.forEach(add);
      return;
    }
    const ref = manifestReference(value, namespace);
    references.set(ref.id, ref);
  };
  for (const doc of parseAllDocuments(manifest)) {
    if (doc.errors.length)
      throw new Error(`Invalid rendered Helm manifest: ${doc.errors[0].message}`);
    add(doc.toJS());
  }
  return [...references.values()];
}
