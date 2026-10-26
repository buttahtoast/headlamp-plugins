// @vitest-environment node
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { artifactText, parseTar, readArchive, readBounded } from './archive';

const encoder = new TextEncoder();
function entry(path: string, content: string, type = '0') {
  const bytes = encoder.encode(content);
  const header = new Uint8Array(512);
  const put = (start: number, value: string) => header.set(encoder.encode(value), start);
  put(0, path);
  put(100, '0000644\0');
  put(124, `${bytes.length.toString(8).padStart(11, '0')}\0`);
  put(148, '        ');
  put(156, type);
  put(257, 'ustar\0');
  const sum = header.reduce((a, b) => a + b, 0);
  put(148, `${sum.toString(8).padStart(6, '0')}\0 `);
  return Buffer.concat([header, bytes, new Uint8Array((512 - (bytes.length % 512)) % 512)]);
}
const object = (name: string, data = 'value') =>
  JSON.stringify({
    apiVersion: 'v1',
    kind: 'ConfigMap',
    metadata: { name, namespace: 'app' },
    data: { key: data },
  });
const tar = (...entries: Uint8Array[]) => Buffer.concat([...entries, new Uint8Array(1024)]);

describe('Velero archive inspection', () => {
  it('reads gzip archives and excludes non-resource metadata files', async () => {
    const archive = gzipSync(
      tar(
        entry('metadata/version', '1.1.0'),
        entry('resources/configmaps/namespaces/app/settings.json', object('settings'))
      )
    );
    const result = await readArchive(archive);
    expect(result).toHaveLength(1);
    expect(result[0].manifest.metadata.name).toBe('settings');
    expect(result[0].resource).toBe('configmaps');
  });
  it('deduplicates versioned objects and prefers versioned entries', () => {
    const result = parseTar(
      tar(
        entry('resources/configmaps/namespaces/app/settings.json', object('settings', 'legacy')),
        entry(
          'resources/configmaps/v1-preferredversion/namespaces/app/settings.json',
          object('settings', 'preferred')
        ),
        entry(
          'resources/configmaps/v1beta1/namespaces/app/settings.json',
          object('settings', 'other')
        )
      )
    );
    expect(result).toHaveLength(1);
    expect(result[0].manifest.data.key).toBe('preferred');
  });
  it('reads long paths via PAX and GNU extensions', () => {
    const path = `resources/configmaps/namespaces/app/${'long'.repeat(40)}.json`;
    const body = `path=${path}\n`;
    let length = encoder.encode(body).length + 3;
    while (`${length} ${body}`.length !== length) length = `${length} ${body}`.length;
    const result = parseTar(
      tar(
        entry('PaxHeader', `${length} ${body}`, 'x'),
        entry('truncated', object('pax')),
        entry('LongLink', `${path}\0`, 'L'),
        entry('truncated', object('gnu'))
      )
    );
    expect(result.map(x => x.manifest.metadata.name).sort()).toEqual(['gnu', 'pax']);
    expect(result[0].path).toBe(path);
  });
  it('rejects corrupted, truncated and invalid JSON archives', () => {
    const corrupted = tar(entry('resources/configmaps/cluster/test.json', object('test')));
    corrupted[0] ^= 1;
    expect(() => parseTar(corrupted)).toThrow('checksum');
    expect(() =>
      parseTar(entry('resources/configmaps/cluster/test.json', object('test')).subarray(0, 520))
    ).toThrow('Truncated');
    expect(() => parseTar(tar(entry('resources/configmaps/cluster/test.json', '{')))).toThrow(
      'Invalid JSON'
    );
    expect(() => parseTar(tar(entry('not-an-object', '{}')))).toThrow('No Kubernetes');
  });
  it('decodes gzip logs as text', async () => {
    expect(await artifactText(gzipSync('level=info msg="Backup completed"'))).toBe(
      'level=info msg="Backup completed"'
    );
  });
  it('enforces byte limits during streaming and handles cancellation', async () => {
    const stream = () =>
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(6));
          controller.enqueue(new Uint8Array(6));
          controller.close();
        },
      });
    await expect(readBounded(stream(), 10)).rejects.toThrow('limit');
    const controller = new AbortController();
    controller.abort();
    await expect(readBounded(stream(), 100, controller.signal)).rejects.toThrow('cancelled');
  });
});
