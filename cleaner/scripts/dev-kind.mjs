import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

// Use the explicitly selected kubeconfig, or obtain one from the named kind
// cluster. Never silently fall back to the shell's active Kubernetes context.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
const cluster = process.env.KIND_CLUSTER || 'capsule';
const namespace = process.env.HEADLAMP_NAMESPACE || 'capsule-system';
const deployment = process.env.HEADLAMP_DEPLOYMENT || 'headlamp';
const container = process.env.HEADLAMP_CONTAINER || 'headlamp';
const temporary = await mkdtemp(join(tmpdir(), 'headlamp-cleaner-'));
await chmod(temporary, 0o700);
const explicitKubeconfig = process.env.HEADLAMP_KUBECONFIG;
const kubeconfig = explicitKubeconfig ? resolve(explicitKubeconfig) : join(temporary, 'kubeconfig');
let target = `kind/${cluster}`;

function command(binary, args, input) {
  return new Promise((resolveCommand, reject) => {
    const child = spawn(binary, args, { stdio: ['pipe', 'pipe', 'pipe'], timeout: 25000 });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', data => { stdout += data; });
    child.stderr.on('data', data => { stderr += data; });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolveCommand(stdout) : reject(new Error(`${binary} exited ${code}: ${stderr}`)));
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

const kubectl = (args, input) => command('kubectl', ['--kubeconfig', kubeconfig, '--request-timeout=15s', '-n', namespace, ...args], input);
let watcher;
let interval;
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  clearInterval(interval);
  await watcher?.close();
  await rm(temporary, { recursive: true, force: true });
}
process.on('SIGINT', () => stop().then(() => process.exit(0)));
process.on('SIGTERM', () => stop().then(() => process.exit(0)));

try {
  if (explicitKubeconfig) {
    const context = await command('kubectl', ['--kubeconfig', kubeconfig, 'config', 'current-context']);
    target = `${context.trim()} (${kubeconfig})`;
  } else {
    await writeFile(kubeconfig, await command('kind', ['get', 'kubeconfig', '--name', cluster]), { mode: 0o600 });
  }
  let selector;
  let built = false;
  let syncing = false;
  let synced = '';
  async function sync() {
    if (!built || syncing || stopping) return;
    syncing = true;
    try {
      if (!selector) {
        const workload = JSON.parse(await kubectl(['get', 'deployment', deployment, '-o', 'json']));
        const headlamp = workload.spec.template.spec.containers.find(item => item.name === container);
        if (!headlamp?.args?.some(arg => /^--?watch-plugins-changes(=true)?$/.test(arg))) {
          throw new Error('Headlamp must enable -watch-plugins-changes. See cleaner/README.md.');
        }
        selector = Object.entries(workload.spec.selector.matchLabels).map(([key, value]) => `${key}=${value}`).join(',');
      }
      const pods = JSON.parse(await kubectl(['get', 'pods', '-l', selector, '-o', 'json']));
      const pod = pods.items.find(item => !item.metadata.deletionTimestamp && item.status.containerStatuses?.some(status => status.name === container && status.ready));
      if (!pod) throw new Error('Waiting for a ready Headlamp pod.');
      const bundle = await readFile(join(root, 'dist/main.js'));
      const metadata = await readFile(join(root, 'package.json'));
      const fingerprint = `${pod.metadata.uid}:${createHash('sha256').update(bundle).update(metadata).digest('hex')}`;
      const exec = ['exec', '-i', pod.metadata.name, '-c', container, '--', 'sh', '-c'];
      // The plugin installer can clear the shared directory after pod startup.
      // A matching local hash does not guarantee the synced files still exist.
      if (fingerprint === synced) {
        const present = await kubectl([...exec, 'if test -s /build/plugins/cleaner/main.js && test -s /build/plugins/cleaner/package.json; then printf present; fi']);
        if (present === 'present') return;
      }
      await kubectl([...exec, 'mkdir -p /build/plugins/cleaner && cat > /build/plugins/cleaner/package.json'], metadata);
      await kubectl([...exec, 'cat > /build/plugins/cleaner/main.js.tmp && mv /build/plugins/cleaner/main.js.tmp /build/plugins/cleaner/main.js'], bundle);
      synced = fingerprint;
      console.log(`[cleaner] Synced ${bundle.length} bytes to ${target}, ${namespace}/${pod.metadata.name}. Headlamp will reload on its next API request.`);
    } catch (error) {
      console.error(`[cleaner] Sync failed; retrying in 5 seconds: ${error.message}`);
    } finally { syncing = false; }
  }
  console.log(`[cleaner] Watching source; target ${target}, deployment ${namespace}/${deployment}. Ctrl+C stops syncing.`);
  watcher = await build({ configFile: join(root, 'node_modules/@kinvolk/headlamp-plugin/config/vite.config.mjs'), build: { watch: {} } });
  watcher.on('event', event => {
    if (event.code === 'START') built = false;
    if (event.code === 'ERROR') { built = false; console.error(event.error); }
    if (event.code === 'END') { built = true; sync(); }
  });
  interval = setInterval(sync, 5000);
} catch (error) {
  console.error(error.message);
  await stop();
  process.exitCode = 1;
}
