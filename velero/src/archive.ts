import { ArchivedObject, Manifest, objectId } from './model';

export const MAX_COMPRESSED = 128 * 1024 * 1024;
export const MAX_EXPANDED = 256 * 1024 * 1024;
const decoder = new TextDecoder();

export async function readBounded(
  stream: ReadableStream<Uint8Array>,
  limit: number,
  signal?: AbortSignal
): Promise<Uint8Array> {
  const reader = stream.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  const abort = () => {
    void reader.cancel();
  };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    while (true) {
      if (signal?.aborted) throw new Error('Download cancelled.');
      const result = await reader.read();
      if (signal?.aborted) throw new Error('Download cancelled.');
      if (result.done) break;
      size += result.value.length;
      if (size > limit)
        throw new Error(
          `Artifact exceeds the ${Math.round(
            limit / 1024 / 1024
          )} MiB limit. Use the Velero CLI for larger backups.`
        );
      parts.push(result.value);
    }
  } finally {
    signal?.removeEventListener('abort', abort);
    await reader.cancel();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return bytes;
}

export async function expand(bytes: Uint8Array): Promise<Uint8Array> {
  if (bytes.length > MAX_COMPRESSED)
    throw new Error('Artifact exceeds the 128 MiB compressed limit.');
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return bytes;
  const source = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return readBounded(source, MAX_EXPANDED);
}

function field(header: Uint8Array, start: number, length: number) {
  return decoder.decode(header.subarray(start, start + length)).split('\0')[0];
}

function paxFields(bytes: Uint8Array): Record<string, string> {
  const fields: Record<string, string> = {};
  let offset = 0;
  while (offset < bytes.length) {
    const space = bytes.indexOf(32, offset);
    const length = Number(decoder.decode(bytes.subarray(offset, space)));
    if (
      space < offset ||
      !Number.isSafeInteger(length) ||
      length <= space - offset + 1 ||
      offset + length > bytes.length
    )
      throw new Error('Invalid tar PAX header.');
    const entry = decoder.decode(bytes.subarray(space + 1, offset + length - 1));
    const equals = entry.indexOf('=');
    if (equals > 0) fields[entry.slice(0, equals)] = entry.slice(equals + 1);
    offset += length;
  }
  return fields;
}

export function parseTar(bytes: Uint8Array): ArchivedObject[] {
  if (bytes.length > MAX_EXPANDED) throw new Error('Archive exceeds the expanded size limit.');
  const objects = new Map<string, ArchivedObject>();
  let pendingPath = '';
  let offset = 0;
  let entries = 0;
  while (offset + 512 <= bytes.length) {
    const header = bytes.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) break;
    if (++entries > 100000) throw new Error('Archive contains too many entries.');
    const expected = parseInt(field(header, 148, 8).trim(), 8);
    const actual = header.reduce(
      (sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte),
      0
    );
    if (expected !== actual) throw new Error('Invalid tar header checksum.');
    const size = parseInt(field(header, 124, 12).trim(), 8);
    if (!Number.isSafeInteger(size) || size < 0 || offset + 512 + size > bytes.length)
      throw new Error('Truncated or invalid tar entry.');
    const prefix = field(header, 345, 155);
    const path = pendingPath || `${prefix ? `${prefix}/` : ''}${field(header, 0, 100)}`;
    const type = field(header, 156, 1);
    const content = bytes.subarray(offset + 512, offset + 512 + size);
    offset += 512 + Math.ceil(size / 512) * 512;
    if (type === 'x') {
      pendingPath = paxFields(content).path || '';
      continue;
    }
    if (type === 'L') {
      pendingPath = decoder.decode(content).replace(/\0.*$/, '');
      continue;
    }
    pendingPath = '';
    if (type !== '' && type !== '0') continue;
    // Velero archives can contain both legacy and preferred-version copies.
    // Use object identity to deduplicate, preferring the preferred API version
    // over other versioned copies and legacy entries regardless of tar order.
    const match = path.replace(/^\.\//, '').match(/^resources\/([^/]+)\/(.+)\.json$/);
    if (!match) continue;
    let value: Manifest;
    try {
      value = JSON.parse(decoder.decode(content));
    } catch {
      throw new Error(`Invalid JSON in ${path}.`);
    }
    if (!value.apiVersion || !value.kind || !value.metadata?.name)
      throw new Error(`Invalid Kubernetes object in ${path}.`);
    const id = objectId(value);
    const priority = (entryPath: string) =>
      /\/[^/]+-preferredversion\//.test(entryPath) ? 2 : /\/v[0-9][^/]*\//.test(entryPath) ? 1 : 0;
    if (!objects.has(id) || priority(path) > priority(objects.get(id)!.path))
      objects.set(id, { id, resource: match[1], path, manifest: value });
    if (objects.size > 50000) throw new Error('Archive contains more than 50,000 objects.');
  }
  if (!objects.size)
    throw new Error('No Kubernetes resource manifests found in this Velero archive.');
  return [...objects.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export async function readArchive(bytes: Uint8Array) {
  return parseTar(await expand(bytes));
}

export async function artifactText(bytes: Uint8Array) {
  return decoder.decode(await expand(bytes));
}
