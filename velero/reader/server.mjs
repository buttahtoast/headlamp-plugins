import { createServer } from 'node:http';
import https from 'node:https';
import { readFileSync, realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const MAX_BYTES = 128 * 1024 * 1024;
const artifactKinds = new Set([
  'BackupLog',
  'BackupContents',
  'BackupVolumeSnapshots',
  'BackupItemOperations',
  'BackupResourceList',
  'BackupResults',
  'RestoreLog',
  'RestoreResults',
  'RestoreResourceList',
  'RestoreItemOperations',
  'CSIBackupVolumeSnapshots',
  'CSIBackupVolumeSnapshotContents',
  'BackupVolumeInfos',
  'RestoreVolumeInfo',
]);

export function validateDownload(dr, allowedOrigins) {
  if (dr.status?.phase !== 'Processed' || !dr.status?.downloadURL)
    throw new Error('DownloadRequest is not ready.');
  if (!artifactKinds.has(dr.spec?.target?.kind)) throw new Error('Unsupported artifact kind.');
  if (
    !dr.status.expiration ||
    Date.parse(dr.status.expiration) <= Date.now() ||
    !Number.isFinite(Date.parse(dr.status.expiration))
  )
    throw new Error('DownloadRequest is expired.');
  const url = new URL(dr.status.downloadURL);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    !allowedOrigins.has(url.origin)
  )
    throw new Error('Artifact origin is not allowed. Configure ALLOWED_ORIGINS on the reader.');
  return url;
}

export function kubernetesReader(namespace) {
  const directory = '/var/run/secrets/kubernetes.io/serviceaccount';
  const agent = new https.Agent({ ca: readFileSync(`${directory}/ca.crt`) });
  const host = process.env.KUBERNETES_SERVICE_HOST;
  const port = process.env.KUBERNETES_SERVICE_PORT_HTTPS || '443';
  return name =>
    new Promise((resolve, reject) => {
      const req = https.get(
        {
          hostname: host,
          port,
          agent,
          path: `/apis/velero.io/v1/namespaces/${encodeURIComponent(
            namespace
          )}/downloadrequests/${encodeURIComponent(name)}`,
          headers: { Authorization: `Bearer ${readFileSync(`${directory}/token`, 'utf8').trim()}` },
          timeout: 10000,
        },
        response => {
          if (response.statusCode !== 200) {
            response.resume();
            reject(new Error(`Kubernetes returned HTTP ${response.statusCode}.`));
            return;
          }
          let value = '';
          response.on('data', part => {
            value += part;
            if (value.length > 1024 * 1024)
              response.destroy(new Error('DownloadRequest too large.'));
          });
          response.on('error', reject);
          response.on('end', () => {
            try {
              resolve(JSON.parse(value));
            } catch {
              reject(new Error('Invalid DownloadRequest.'));
            }
          });
        }
      );
      req.on('timeout', () => req.destroy(new Error('Kubernetes request timed out.')));
      req.on('error', reject);
    });
}

// The Kubernetes API server authorizes services/proxy access before relaying a
// request here. Scope that permission carefully: it grants artifact access to
// this Velero namespace. The service account can only GET DownloadRequests.
export function createReader({
  getDownload,
  allowedOrigins,
  fetchArtifact = fetch,
  maxBytes = MAX_BYTES,
}) {
  let active = 0;
  return createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.method === 'GET' && req.url === '/healthz') {
      res.end('ok');
      return;
    }
    const match = req.url?.match(/^\/download\/([a-z0-9][a-z0-9-]{0,61}[a-z0-9]|[a-z0-9])$/);
    if (req.method !== 'GET' || !match) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    if (active >= 4) {
      res.writeHead(429);
      res.end('Too many concurrent downloads.');
      return;
    }
    active++;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);
    res.on('close', () => controller.abort());
    try {
      const dr = await getDownload(match[1]);
      const url = validateDownload(dr, allowedOrigins);
      const upstream = await fetchArtifact(url, {
        redirect: 'manual',
        signal: controller.signal,
        headers: { 'Accept-Encoding': 'identity' },
      });
      if (!upstream.ok) throw new Error(`Object storage returned HTTP ${upstream.status}.`);
      if (!upstream.body) throw new Error('Empty artifact response.');
      if (Number(upstream.headers.get('content-length')) > maxBytes)
        throw new Error('Artifact exceeds the 128 MiB reader limit.');
      res.setHeader('Content-Type', 'application/octet-stream');
      const reader = upstream.body.getReader();
      let size = 0;
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.length;
          if (size > maxBytes) throw new Error('Artifact exceeds the 128 MiB reader limit.');
          if (!res.write(part.value))
            await new Promise((resolve, reject) => {
              const cleanup = () => {
                res.off('drain', drain);
                res.off('close', close);
              };
              const drain = () => {
                cleanup();
                resolve();
              };
              const close = () => {
                cleanup();
                reject(new Error('Client disconnected.'));
              };
              res.once('drain', drain);
              res.once('close', close);
            });
        }
      } finally {
        await reader.cancel();
      }
      res.end();
    } catch (error) {
      // Never return or log a signed URL or credential-bearing upstream body.
      if (res.headersSent) res.destroy();
      else {
        res.writeHead(502, { 'Content-Type': 'text/plain' });
        res.end(
          error.message?.startsWith('Object storage returned HTTP') ||
            error.message?.includes('origin is not allowed')
            ? error.message
            : 'Artifact could not be read. Check DownloadRequest status, expiration and storage connectivity.'
        );
      }
    } finally {
      clearTimeout(timeout);
      controller.abort();
      active--;
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const namespace = process.env.VELERO_NAMESPACE || 'velero-system';
  const origins = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map(x => x.trim())
    .filter(Boolean);
  if (!origins.length)
    throw new Error(
      'ALLOWED_ORIGINS must list exact object storage origins, e.g. https://s3.eu-central-1.amazonaws.com'
    );
  const allowedOrigins = new Set(origins.map(x => new URL(x).origin));
  createReader({ getDownload: kubernetesReader(namespace), allowedOrigins }).listen(
    8080,
    '0.0.0.0',
    () => console.log(`Velero artifact reader listening on :8080 for namespace ${namespace}`)
  );
}
