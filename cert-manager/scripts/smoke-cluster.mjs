// Exercises the actual API/model code against an isolated self-signed certificate.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const context = process.env.HEADLAMP_CONTEXT;
if (!context) throw new Error('Set HEADLAMP_CONTEXT explicitly.');
const args = ['--context', context, '--request-timeout=15s'];
if (process.env.HEADLAMP_KUBECONFIG) args.push('--kubeconfig', process.env.HEADLAMP_KUBECONFIG);
const kubectl = (parameters, input) => execFileSync('kubectl', [...args, ...parameters], { input, encoding: 'utf8', timeout: 55000 });
const proxy = spawn('kubectl', [...args, 'proxy', '--port=0'], { stdio: ['ignore', 'pipe', 'pipe'] });
const namespace = `headlamp-cert-manager-smoke-${randomBytes(4).toString('hex')}`;
let created = false;
try {
  globalThis.__certManagerSmokeProxy = await new Promise((resolveProxy, reject) => {
    const timer = setTimeout(() => reject(new Error('kubectl proxy did not start.')), 15000);
    proxy.once('error', reject);
    proxy.stdout.on('data', data => {
      const match = String(data).match(/127\.0\.0\.1:(\d+)/);
      if (match) { clearTimeout(timer); resolveProxy(`http://127.0.0.1:${match[1]}`); }
    });
    proxy.stderr.on('data', data => process.stderr.write(data));
  });
  const bundle = await build({
    absWorkingDir: root, stdin: { contents: 'export * from "./src/api"; export * from "./src/model";', resolveDir: root }, bundle: true, write: false, platform: 'node', format: 'esm',
    plugins: [{ name: 'kubernetes-proxy', setup(builder) {
      builder.onResolve({filter: /^@kinvolk\/headlamp-plugin\/lib\/ApiProxy$/}, () => ({path:'request',namespace:'smoke'}));
      builder.onLoad({filter: /.*/,namespace:'smoke'}, () => ({contents: `
        export async function request(path, options = {}) {
          const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(options.timeout || 15000)]) : AbortSignal.timeout(options.timeout || 15000);
          const response = await fetch(globalThis.__certManagerSmokeProxy + path, { method: options.method, headers: options.headers, body: options.body, signal });
          const value = await response.json();
          if (!response.ok) throw Object.assign(new Error(value.message || response.statusText), {status:response.status});
          return value;
        }` }));
    } }],
  });
  const api = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
  const results = {};
  await api.collect([{cluster:context,namespaces:[]}],(id,result) => {results[id]=result;},new AbortController().signal);
  console.log('Live snapshot:', JSON.stringify(Object.fromEntries(Object.entries(results).map(([id,result]) => [id,{count:result.items.length,error:result.error,missing:result.missing}]))));
  assert.ok(results.certificates?.items.length, 'No live certificates found');
  const issuer = {apiVersion:'cert-manager.io/v1',kind:'Issuer',metadata:{name:'selfsigned',namespace},spec:{selfSigned:{}}};
  const certificate = {apiVersion:'cert-manager.io/v1',kind:'Certificate',metadata:{name:'smoke',namespace},spec:{secretName:'smoke-tls',dnsNames:['headlamp-smoke.invalid'],duration:'1h',renewBefore:'10m',issuerRef:{name:'selfsigned',kind:'Issuer'}}};
  kubectl(['create','-f','-'],JSON.stringify({apiVersion:'v1',kind:'Namespace',metadata:{name:namespace,labels:{'app.kubernetes.io/managed-by':'headlamp-cert-manager-smoke'}}}));
  created = true;
  kubectl(['create','-f','-'],JSON.stringify(issuer));
  assert.ok(await api.allowed(context,namespace,'certificates','create'));
  await api.createCertificate(context,certificate,true);
  await api.createCertificate(context,certificate,false);
  kubectl(['-n',namespace,'wait','--for=condition=Ready','certificate/smoke','--timeout=45s']);
  const before = await api.getResource(context,'certificates',namespace,'smoke');
  const prepared = await api.prepareRenewal({...before,cluster:context});
  await api.patchRenewal(context,prepared.live,prepared.patch,false);
  const deadline = Date.now()+45000;
  let after;
  do {
    after = await api.getResource(context,'certificates',namespace,'smoke');
    if (api.renewalComplete(before,after)) break;
    await new Promise(resolvePoll => setTimeout(resolvePoll,700));
  } while (Date.now()<deadline);
  assert.ok(api.renewalComplete(before,after),'Renewal did not complete with a new ready revision');
  assert.equal(api.expiry(after),'critical');
  // A stale review must fail instead of triggering another renewal.
  await assert.rejects(api.patchRenewal(context,prepared.live,prepared.patch,false));
  console.log(`PASS: create permission, dry-run, issuance, renewal dry-run, revision ${before.status.revision} → ${after.status.revision}, critical-expiry classification and stale-resource rejection.`);
} finally {
  if (created) {
    kubectl(['delete','namespace',namespace,'--wait=false']);
    kubectl(['wait','--for=delete',`namespace/${namespace}`,'--timeout=45s']);
    console.log(`Removed isolated smoke-test namespace ${namespace}.`);
  }
  proxy.kill('SIGTERM');
}
