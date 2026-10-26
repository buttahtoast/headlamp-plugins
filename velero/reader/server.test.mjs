// @vitest-environment node
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';
import { createReader, validateDownload } from './server.mjs';

const allowedOrigins = new Set(['https://storage.example.test']);
const request = (url = 'https://storage.example.test/backup?signature=secret') => ({
  spec: { target: { kind: 'BackupContents', name: 'backup' } },
  status: {
    phase: 'Processed',
    downloadURL: url,
    expiration: new Date(Date.now() + 60000).toISOString(),
  },
});

test('accepts only processed, unexpired artifacts from exact configured origins', () => {
  assert.equal(validateDownload(request(), allowedOrigins).origin, 'https://storage.example.test');
  for (const url of [
    'http://169.254.169.254/latest/meta-data',
    'https://storage.example.test.evil.test/file',
    'file:///etc/passwd',
    'https://user:pass@storage.example.test/file',
    'http://storage.example.test/file',
  ])
    assert.throws(() => validateDownload(request(url), allowedOrigins));
  assert.throws(
    () =>
      validateDownload(
        { ...request(), status: { ...request().status, expiration: '2020-01-01' } },
        allowedOrigins
      ),
    /expired/
  );
  assert.throws(
    () => validateDownload({ ...request(), spec: { target: { kind: 'Unknown' } } }, allowedOrigins),
    /Unsupported/
  );
});

test('starts when executed through a symlink, as with a Kubernetes ConfigMap', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'velero-reader-test-'));
  try {
    const link = join(directory, 'server.mjs');
    await symlink(fileURLToPath(new URL('./server.mjs', import.meta.url)), link);
    const result = spawnSync(process.execPath, [link], {
      env: { ...process.env, ALLOWED_ORIGINS: '' },
      encoding: 'utf8',
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /ALLOWED_ORIGINS must list exact/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

async function withReader(options, callback) {
  const server = createReader({ getDownload: async () => request(), allowedOrigins, ...options });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    await callback(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}

test('relays only named DownloadRequests, streams bytes and forbids arbitrary URLs', async () => {
  await withReader(
    {
      fetchArtifact: async (_, options) => {
        assert.equal(options.redirect, 'manual');
        return new Response(new Uint8Array([1, 2, 3]));
      },
    },
    async base => {
      const response = await fetch(`${base}/download/headlamp-test`);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [1, 2, 3]);
      assert.equal((await fetch(`${base}/download/test?url=https://evil.test`)).status, 404);
      assert.equal((await fetch(`${base}/download/test`, { method: 'POST' })).status, 404);
    }
  );
});

test('does not follow redirects or expose signed URLs in errors', async () => {
  await withReader(
    {
      fetchArtifact: async () =>
        new Response(null, { status: 302, headers: { Location: 'http://169.254.169.254' } }),
    },
    async base => {
      const response = await fetch(`${base}/download/test`);
      assert.equal(response.status, 502);
      assert.equal(await response.text(), 'Object storage returned HTTP 302.');
    }
  );
  await withReader(
    {
      fetchArtifact: async () => {
        throw new Error('Failed https://storage.example.test?signature=secret');
      },
    },
    async base => {
      const response = await fetch(`${base}/download/test`);
      assert.equal(response.status, 502);
      assert.ok(!(await response.text()).includes('signature'));
    }
  );
});

test('rejects oversized artifacts before relaying their body', async () => {
  await withReader(
    {
      maxBytes: 5,
      fetchArtifact: async () => new Response('too large', { headers: { 'content-length': '9' } }),
    },
    async base => {
      assert.equal((await fetch(`${base}/download/test`)).status, 502);
    }
  );
});
