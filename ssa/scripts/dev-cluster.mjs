import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
const context = process.env.HEADLAMP_CONTEXT;
if (!context) throw new Error('Set HEADLAMP_CONTEXT explicitly to select the Kubernetes context.');
const namespace = process.env.HEADLAMP_NAMESPACE || 'capsule-system';
const deployment = process.env.HEADLAMP_DEPLOYMENT || 'headlamp';
const container = process.env.HEADLAMP_CONTAINER || 'headlamp';
const directory = process.env.HEADLAMP_PLUGINS_DIR || '/build/plugins';
if (!/^\/[a-zA-Z0-9/_-]+$/.test(directory)) throw new Error('Invalid plugin directory.');
const args = ['--context', context, '--request-timeout=20s', '-n', namespace];
if (process.env.HEADLAMP_KUBECONFIG) args.push('--kubeconfig', process.env.HEADLAMP_KUBECONFIG);
const fingerprints = new Map();
function command(parameters, input) {
  return new Promise((resolveCommand, reject) => {
    const child = spawn('kubectl', [...args, ...parameters], {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 30000,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', part => {
      stdout += part;
    });
    child.stderr.on('data', part => {
      stderr += part;
    });
    child.on('error', reject);
    child.on('close', code =>
      code === 0 ? resolveCommand(stdout) : reject(new Error(stderr || `kubectl exited ${code}`))
    );
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}
// A successful exec stream can still lose stdin; verify bytes before publishing each file.
async function writeVerified(exec, name, content) {
  const target = `${directory}/ssa-inspector/${name}`;
  const digest = createHash('sha256').update(content).digest('hex');
  let failure;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await command(
        [
          ...exec,
          `cat > ${target}.tmp && printf '%s  %s\n' '${digest}' '${target}.tmp' | sha256sum -c - && mv ${target}.tmp ${target}`,
        ],
        content
      );
      return;
    } catch (error) {
      failure = error;
    }
  }
  throw new Error(`Could not verify ${name}: ${failure?.message || failure}`);
}
let syncing = false;
async function sync() {
  if (syncing) return;
  syncing = true;
  try {
    const workload = JSON.parse(await command(['get', 'deployment', deployment, '-o', 'json']));
    const headlamp = workload.spec.template.spec.containers.find(x => x.name === container);
    if (!headlamp?.args?.some(arg => /^--?watch-plugins-changes(=true)?$/.test(arg)))
      throw new Error('Headlamp must enable -watch-plugins-changes.');
    const selector = Object.entries(workload.spec.selector.matchLabels)
      .map(([k, v]) => `${k}=${v}`)
      .join(',');
    const pods = JSON.parse(
      await command(['get', 'pods', '-l', selector, '-o', 'json'])
    ).items.filter(
      x =>
        !x.metadata.deletionTimestamp &&
        x.status.containerStatuses?.some(c => c.name === container && c.ready)
    );
    if (!pods.length) throw new Error('No ready Headlamp pods.');
    const bundle = await readFile(join(root, 'dist/main.js'));
    const metadata = await readFile(join(root, 'package.json'));
    const license = await readFile(join(root, 'LICENSE'));
    const notice = await readFile(join(root, 'NOTICE'));
    const hash = createHash('sha256')
      .update(bundle)
      .update(metadata)
      .update(license)
      .update(notice)
      .digest('hex');
    for (const pod of pods) {
      const exec = ['exec', '-i', pod.metadata.name, '-c', container, '--', 'sh', '-c'];
      if (fingerprints.get(pod.metadata.uid) === hash) {
        const present = await command([
          ...exec,
          `if test -s ${directory}/ssa-inspector/main.js && test -s ${directory}/ssa-inspector/package.json; then printf present; fi`,
        ]);
        if (present === 'present') continue;
      }
      await command([...exec, `mkdir -p ${directory}/ssa-inspector`]);
      await writeVerified(exec, 'package.json', metadata);
      await writeVerified(exec, 'LICENSE', license);
      await writeVerified(exec, 'NOTICE', notice);
      await writeVerified(exec, 'main.js', bundle);
      fingerprints.set(pod.metadata.uid, hash);
      console.log(
        `[ssa-inspector] Synced ${bundle.length} bytes to ${context} ${namespace}/${pod.metadata.name}`
      );
    }
  } finally {
    syncing = false;
  }
}
const configFile = join(root, 'node_modules/@kinvolk/headlamp-plugin/config/vite.config.mjs');
if (process.argv.includes('--once')) {
  await build({ configFile });
  await sync();
} else {
  let ready = false;
  const watcher = await build({ configFile, build: { watch: {} } });
  const attempt = () => {
    if (ready) sync().catch(error => console.error(`[ssa-inspector] ${error.message}`));
  };
  watcher.on('event', event => {
    if (event.code === 'START' || event.code === 'ERROR') ready = false;
    if (event.code === 'ERROR') console.error(event.error);
    if (event.code === 'END') {
      ready = true;
      attempt();
    }
  });
  const timer = setInterval(attempt, 5000);
  const stop = async () => {
    clearInterval(timer);
    await watcher.close();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  console.log(
    `[ssa-inspector] Watching source and syncing all ready replicas of ${context} ${namespace}/${deployment}.`
  );
}
