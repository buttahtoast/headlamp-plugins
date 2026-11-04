/**
 * Kind + Dex + Envoy Gateway OIDC in front of Headlamp, then the shell config.
 *
 * Proves an unauthenticated request is stopped by the SecurityPolicy, a Dex
 * login reaches Headlamp, and buttah-shell-config/config.json is the only
 * identity provider the plugin sees.
 */
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, rmSync, openSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const kubeconfig = process.env.KUBECONFIG || '/var/lib/kind-shell.kubeconfig';
const context = process.env.KUBE_CONTEXT || 'kind-shell';
const nodeName = process.env.KIND_NODE || 'shell-control-plane';
const origin = 'https://headlamp.local:8443';
const issuer = 'https://dex.dex.svc.cluster.local:5556/dex';
const password = process.env.ALICE_PASSWORD || 'alice-password';
const gatewaySecret = 'gateway-secret';
const ns = 'headlamp';
const work = path.join(tmpdir(), 'buttah-shell-e2e');

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], ...opts });
}
function kubectl(args, input) {
  return run('kubectl', ['--kubeconfig', kubeconfig, '--context', context, ...args], { input });
}
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
function step(name) {
  console.log(`\n== ${name}`);
}

mkdirSync(work, { recursive: true });
process.env.DOCKER_HOST = process.env.DOCKER_HOST || 'unix:///var/run/docker.sock';
run('sh', ['-c', "pkill -f '[k]ubectl.*port-forward.*8443:443' || true; pkill -f '[k]ubectl.*port-forward.*5556:5556' || true"]);

step('plugin bundle has no baked-in identity provider');
const bundle = readFileSync(path.join(root, 'dist/main.js'), 'utf8');
if (bundle.includes('auth.buttah.cloud') || bundle.includes('dashboard.svc.buttah.cloud')) {
  throw new Error('The bundle still contains a built-in Buttah identity provider or API server.');
}

step('wait for the kind node');
for (let i = 0; i < 40; i += 1) {
  const nodes = kubectl(['get', 'nodes', '--no-headers']);
  if (nodes.includes(' Ready')) break;
  if (i === 39) throw new Error(nodes);
  await sleep(3000);
}

step('Dex certificate and password');
run('openssl', [
  'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '30',
  '-keyout', path.join(work, 'dex.key'),
  '-out', path.join(work, 'dex.crt'),
  '-subj', '/CN=dex.dex.svc.cluster.local',
  '-addext', 'subjectAltName=DNS:dex.dex.svc.cluster.local,DNS:dex.dex.svc,IP:127.0.0.1',
]);
run('npm', ['install', '--prefix', work, 'bcryptjs@2.4.3'], { stdio: 'inherit' });
const hash = run(process.execPath, [
  '-e',
  `console.log(require(${JSON.stringify(path.join(work, 'node_modules/bcryptjs'))}).hashSync(${JSON.stringify(password)}, 12))`,
]).trim();

const dexConfig = `issuer: ${issuer}
storage:
  type: memory
web:
  https: 0.0.0.0:5556
  tlsCert: /etc/dex/tls/tls.crt
  tlsKey: /etc/dex/tls/tls.key
oauth2:
  skipApprovalScreen: true
  passwordConnector: local
staticClients:
  - id: headlamp-gateway
    name: Headlamp Gateway
    secret: ${gatewaySecret}
    redirectURIs:
      - ${origin}/oauth2/callback
  - id: buttah-shell
    public: true
    name: Shell
    redirectURIs:
      - ${origin}/buttah/shell-oidc
enablePasswordDB: true
staticPasswords:
  - email: alice@alpina.test
    hash: "${hash}"
    username: alice
    userID: alice
`;
writeFileSync(path.join(work, 'config.yaml'), dexConfig);

step('install Dex');
kubectl(['create', 'namespace', 'dex', '--dry-run=client', '-o', 'yaml']);
kubectl(['apply', '-f', '-'], kubectl(['create', 'namespace', 'dex', '--dry-run=client', '-o', 'yaml']));
kubectl(['create', 'secret', 'tls', 'dex-tls', '-n', 'dex', `--cert=${path.join(work, 'dex.crt')}`, `--key=${path.join(work, 'dex.key')}`, '--dry-run=client', '-o', 'yaml']);
kubectl(['apply', '-f', '-'], kubectl([
  'create', 'secret', 'tls', 'dex-tls', '-n', 'dex',
  `--cert=${path.join(work, 'dex.crt')}`, `--key=${path.join(work, 'dex.key')}`,
  '--dry-run=client', '-o', 'yaml',
]));
kubectl(['create', 'configmap', 'dex', '-n', 'dex', `--from-file=config.yaml=${path.join(work, 'config.yaml')}`, '--dry-run=client', '-o', 'yaml']);
kubectl(['apply', '-f', '-'], kubectl([
  'create', 'configmap', 'dex', '-n', 'dex',
  `--from-file=config.yaml=${path.join(work, 'config.yaml')}`,
  '--dry-run=client', '-o', 'yaml',
]));
writeFileSync(path.join(work, 'dex.yaml'), `
apiVersion: apps/v1
kind: Deployment
metadata:
  name: dex
  namespace: dex
spec:
  replicas: 1
  selector:
    matchLabels:
      app: dex
  template:
    metadata:
      labels:
        app: dex
    spec:
      containers:
        - name: dex
          image: ghcr.io/dexidp/dex:v2.41.1
          args: ["dex", "serve", "/etc/dex/cfg/config.yaml"]
          ports:
            - name: https
              containerPort: 5556
          volumeMounts:
            - name: config
              mountPath: /etc/dex/cfg
            - name: tls
              mountPath: /etc/dex/tls
      volumes:
        - name: config
          configMap:
            name: dex
        - name: tls
          secret:
            secretName: dex-tls
---
apiVersion: v1
kind: Service
metadata:
  name: dex
  namespace: dex
spec:
  selector:
    app: dex
  ports:
    - name: https
      port: 5556
      targetPort: https
`);
kubectl(['apply', '-f', path.join(work, 'dex.yaml')]);
// The password hash and TLS certificate change on every run. A ConfigMap
// update does not restart Dex, so the pod would keep the previous hash.
kubectl(['rollout', 'restart', 'deploy/dex', '-n', 'dex']);
kubectl(['rollout', 'status', 'deploy/dex', '-n', 'dex', '--timeout=180s']);

step('Envoy Gateway');
run('helm', [
  '--kubeconfig', kubeconfig, '--kube-context', context,
  'upgrade', '--install', 'eg', 'oci://docker.io/envoyproxy/gateway-helm',
  '--version', 'v1.9.3', '-n', 'envoy-gateway-system', '--create-namespace',
  '--set', 'config.envoyGateway.extensionApis.enableBackend=true',
], { stdio: 'inherit' });
kubectl(['rollout', 'status', 'deploy/envoy-gateway', '-n', 'envoy-gateway-system', '--timeout=240s']);

step('Headlamp and the shell config');
const shellConfig = {
  shell: {
    issuerUrl: issuer,
    clientId: 'buttah-shell',
    scopes: 'openid email profile groups offline_access',
    authorizationEndpoint: `${issuer}/auth`,
    tokenEndpoint: `${issuer}/token`,
    image: 'docker.io/alpine/kubectl:1.35.4',
    namespace: 'shop',
    idpCaPem: readFileSync(path.join(work, 'dex.crt'), 'utf8'),
  },
};
writeFileSync(path.join(work, 'config.json'), JSON.stringify(shellConfig, null, 2));
kubectl(['apply', '-f', '-'], `apiVersion: v1
kind: Namespace
metadata:
  name: ${ns}
---
apiVersion: v1
kind: Namespace
metadata:
  name: shop
`);
const pluginManifest = kubectl([
  'create', 'configmap', 'buttah-shell', '-n', ns,
  `--from-file=main.js=${path.join(root, 'dist/main.js')}`,
  `--from-file=package.json=${path.join(root, 'package.json')}`,
  '--dry-run=client', '-o', 'yaml',
]);
// apply copies the bundle into last-applied-configuration and exceeds the annotation limit.
try {
  kubectl(['create', '-f', '-'], pluginManifest);
} catch {
  kubectl(['replace', '--force', '-f', '-'], pluginManifest);
}
kubectl(['apply', '-f', '-'], kubectl([
  'create', 'configmap', 'buttah-shell-config', '-n', ns,
  `--from-file=config.json=${path.join(work, 'config.json')}`,
  '--dry-run=client', '-o', 'yaml',
]));
writeFileSync(path.join(work, 'headlamp.yaml'), `
apiVersion: v1
kind: ServiceAccount
metadata:
  name: headlamp
  namespace: ${ns}
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: headlamp-admin
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: cluster-admin
subjects:
  - kind: ServiceAccount
    name: headlamp
    namespace: ${ns}
---
apiVersion: v1
kind: Service
metadata:
  name: headlamp
  namespace: ${ns}
spec:
  selector:
    app: headlamp
  ports:
    - name: http
      port: 80
      targetPort: http
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: headlamp
  namespace: ${ns}
spec:
  replicas: 1
  selector:
    matchLabels:
      app: headlamp
  template:
    metadata:
      labels:
        app: headlamp
    spec:
      serviceAccountName: headlamp
      containers:
        - name: headlamp
          image: ghcr.io/headlamp-k8s/headlamp:v0.46.0
          args:
            - -in-cluster
            - -unsafe-use-service-account-token
            - -plugins-dir=/headlamp/plugins
          ports:
            - name: http
              containerPort: 4466
          volumeMounts:
            - name: buttah-shell
              mountPath: /headlamp/plugins/buttah-shell
              readOnly: true
            - name: buttah-shell-config
              mountPath: /headlamp/plugins/buttah-shell-config
              readOnly: true
      volumes:
        - name: buttah-shell
          configMap:
            name: buttah-shell
        - name: buttah-shell-config
          configMap:
            name: buttah-shell-config
`);
kubectl(['apply', '-f', path.join(work, 'headlamp.yaml')]);
kubectl(['rollout', 'status', 'deploy/headlamp', '-n', ns, '--timeout=240s']);

step('gateway certificate, Dex CA, and SecurityPolicy');
run('openssl', [
  'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '30',
  '-keyout', path.join(work, 'gw.key'),
  '-out', path.join(work, 'gw.crt'),
  '-subj', '/CN=headlamp.local',
  '-addext', 'subjectAltName=DNS:headlamp.local',
]);
kubectl(['apply', '-f', '-'], kubectl([
  'create', 'secret', 'tls', 'headlamp-gateway-tls', '-n', ns,
  `--cert=${path.join(work, 'gw.crt')}`, `--key=${path.join(work, 'gw.key')}`,
  '--dry-run=client', '-o', 'yaml',
]));
kubectl(['apply', '-f', '-'], kubectl([
  'create', 'secret', 'generic', 'headlamp-gateway-oidc', '-n', ns,
  `--from-literal=client-secret=${gatewaySecret}`,
  '--dry-run=client', '-o', 'yaml',
]));
kubectl(['apply', '-f', '-'], kubectl([
  'create', 'configmap', 'dex-ca', '-n', ns,
  `--from-file=ca.crt=${path.join(work, 'dex.crt')}`,
  '--dry-run=client', '-o', 'yaml',
]));
writeFileSync(path.join(work, 'gateway.yaml'), `
apiVersion: gateway.networking.k8s.io/v1
kind: GatewayClass
metadata:
  name: eg
spec:
  controllerName: gateway.envoyproxy.io/gatewayclass-controller
---
apiVersion: gateway.networking.k8s.io/v1
kind: Gateway
metadata:
  name: headlamp
  namespace: ${ns}
spec:
  gatewayClassName: eg
  listeners:
    - name: https
      protocol: HTTPS
      port: 443
      hostname: headlamp.local
      tls:
        mode: Terminate
        certificateRefs:
          - kind: Secret
            name: headlamp-gateway-tls
      allowedRoutes:
        namespaces:
          from: Same
---
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: headlamp
  namespace: ${ns}
spec:
  parentRefs:
    - name: headlamp
  hostnames:
    - headlamp.local
  rules:
    - matches:
        - path:
            type: PathPrefix
            value: /
      timeouts:
        request: 0s
        backendRequest: 0s
      backendRefs:
        - name: headlamp
          port: 80
---
apiVersion: gateway.envoyproxy.io/v1alpha1
kind: Backend
metadata:
  name: dex
  namespace: ${ns}
spec:
  endpoints:
    - fqdn:
        hostname: dex.dex.svc.cluster.local
        port: 5556
---
apiVersion: gateway.networking.k8s.io/v1
kind: BackendTLSPolicy
metadata:
  name: dex
  namespace: ${ns}
spec:
  targetRefs:
    - group: gateway.envoyproxy.io
      kind: Backend
      name: dex
  validation:
    hostname: dex.dex.svc.cluster.local
    caCertificateRefs:
      - group: ""
        kind: ConfigMap
        name: dex-ca
---
apiVersion: gateway.envoyproxy.io/v1alpha1
kind: SecurityPolicy
metadata:
  name: headlamp
  namespace: ${ns}
spec:
  targetRefs:
    - group: gateway.networking.k8s.io
      kind: HTTPRoute
      name: headlamp
  oidc:
    provider:
      issuer: ${issuer}
      authorizationEndpoint: ${issuer}/auth
      tokenEndpoint: ${issuer}/token
      backendRefs:
        - group: gateway.envoyproxy.io
          kind: Backend
          name: dex
          port: 5556
    clientID: headlamp-gateway
    clientSecret:
      name: headlamp-gateway-oidc
    redirectURL: ${origin}/oauth2/callback
    logoutPath: /oauth2/logout
    cookieConfig:
      sameSite: Lax
    passThroughAuthHeader: true
    denyRedirect:
      headers:
        - name: Accept
          type: Prefix
          value: application/json
    scopes: [openid, email, profile, groups]
  jwt:
    optional: true
    providers:
      - name: dex
        issuer: ${issuer}
        remoteJWKS:
          uri: ${issuer}/keys
          backendRefs:
            - group: gateway.envoyproxy.io
              kind: Backend
              name: dex
              port: 5556
`);
kubectl(['apply', '-f', path.join(work, 'gateway.yaml')]);

function nodeInternalIP() {
  const ip = kubectl([
    'get', 'node', nodeName, '-o',
    'jsonpath={.status.addresses[?(@.type=="InternalIP")].address}',
  ]).trim();
  if (!ip) {
    throw new Error(`Node ${nodeName} has no InternalIP.`);
  }
  return ip;
}

function programClusterIPs() {
  // This kernel rejects kube-proxy's statistic and nft numgen matches, so
  // ClusterIP packets never land. Plain DNAT, including UDP/53, is enough
  // for CoreDNS, Dex, and the Envoy xDS service.
  const script = run(process.execPath, [
    '-e',
    `const {execFileSync}=require('child_process');
const kube=${JSON.stringify(kubeconfig)};
const ctx=${JSON.stringify(context)};
const k=(a)=>execFileSync('kubectl',['--kubeconfig',kube,'--context',ctx,...a],{encoding:'utf8'});
const eps=JSON.parse(k(['get','endpoints','-A','-o','json']));
const svcs=JSON.parse(k(['get','svc','-A','-o','json']));
const lines=['iptables -t nat -N BUTTAH-SVC 2>/dev/null || true','iptables -t nat -F BUTTAH-SVC','iptables -t nat -C PREROUTING -j BUTTAH-SVC 2>/dev/null || iptables -t nat -I PREROUTING 1 -j BUTTAH-SVC','iptables -t nat -C OUTPUT -j BUTTAH-SVC 2>/dev/null || iptables -t nat -I OUTPUT 1 -j BUTTAH-SVC'];
for (const svc of svcs.items) {
  const ns=svc.metadata.namespace, name=svc.metadata.name, cip=svc.spec.clusterIP;
  if (!cip || cip==='None') continue;
  const ep=eps.items.find(e=>e.metadata.namespace===ns && e.metadata.name===name);
  if (!ep) continue;
  for (const p of svc.spec.ports||[]) {
    let chosen=null;
    for (const subset of ep.subsets||[]) {
      const ips=(subset.addresses||[]).map(a=>a.ip);
      for (const epport of subset.ports||[]) {
        if ((epport.name&&epport.name===p.name) || epport.port===p.port) {
          if (ips.length) chosen=[ips[0], epport.port, (epport.protocol||p.protocol||'TCP').toLowerCase()];
        }
      }
    }
    if (!chosen) continue;
    lines.push('iptables -t nat -A BUTTAH-SVC -d '+cip+'/32 -p '+chosen[2]+' --dport '+p.port+' -j DNAT --to-destination '+chosen[0]+':'+chosen[1]);
    if ((p.name==='dns' || p.port===53) && chosen[2]==='tcp') {
      lines.push('iptables -t nat -A BUTTAH-SVC -d '+cip+'/32 -p udp --dport 53 -j DNAT --to-destination '+chosen[0]+':53');
    }
  }
}
process.stdout.write(lines.join('\\n')+'\\n');`,
  ]);
  writeFileSync(path.join(work, 'svc.sh'), script);
  run('docker', ['cp', path.join(work, 'svc.sh'), `${nodeName}:/buttah-svc.sh`]);
  run('docker', ['exec', nodeName, 'sh', '/buttah-svc.sh']);
}

step('assign the Gateway address and program ClusterIP DNAT');
const nodeIP = nodeInternalIP();
kubectl([
  'patch', 'gateway', 'headlamp', '-n', ns, '--type', 'merge', '-p',
  JSON.stringify({ spec: { addresses: [{ type: 'IPAddress', value: nodeIP }] } }),
]);
programClusterIPs();
// Envoy resolves xDS with STRICT_DNS when the process starts. Restart it after
// UDP/53 DNAT exists, or the proxy stays 1/2 with an empty host list.
kubectl([
  'delete', 'pod', '-A', '-l', 'gateway.envoyproxy.io/owning-gateway-name=headlamp',
  '--wait=true',
  '--timeout=180s',
]);

function envoyReady() {
  const accepted = kubectl([
    'get', 'securitypolicy', 'headlamp', '-n', ns,
    '-o', 'jsonpath={.status.ancestors[0].conditions[?(@.type=="Accepted")].status}',
  ]).trim();
  const programmed = kubectl([
    'get', 'gateway', 'headlamp', '-n', ns,
    '-o', 'jsonpath={.status.conditions[?(@.type=="Programmed")].status}',
  ]).trim();
  const pods = JSON.parse(kubectl([
    'get', 'pods', '-A', '-l', 'gateway.envoyproxy.io/owning-gateway-name=headlamp', '-o', 'json',
  ]));
  const readyPod = pods.items.some(pod => {
    const statuses = pod.status?.containerStatuses ?? [];
    return pod.status?.phase === 'Running' && statuses.length >= 2 && statuses.every(item => item.ready);
  });
  return accepted === 'True' && programmed === 'True' && readyPod;
}

step('wait until Envoy is programmed and the SecurityPolicy is accepted');
let ready = false;
for (let i = 0; i < 72; i += 1) {
  try {
    if (envoyReady()) {
      ready = true;
      break;
    }
  } catch (error) {
    console.log(String(error).split('\n')[0]);
  }
  await sleep(5000);
}
if (!ready) {
  console.log(kubectl(['describe', 'securitypolicy', 'headlamp', '-n', ns]));
  console.log(kubectl(['describe', 'gateway', 'headlamp', '-n', ns]));
  console.log(kubectl(['get', 'pods', '-A', '-l', 'gateway.envoyproxy.io/owning-gateway-name=headlamp', '-o', 'wide']));
  throw new Error('Envoy did not become ready behind the SecurityPolicy.');
}
programClusterIPs();

step('publish the gateway and Dex on the host');
const hosts = readFileSync('/etc/hosts', 'utf8');
if (!hosts.includes('headlamp.local')) {
  writeFileSync('/etc/hosts', `${hosts.trim()}\n127.0.0.1 headlamp.local dex.dex.svc.cluster.local\n`);
}
const svc = JSON.parse(kubectl([
  'get', 'svc', '-A', '-l', 'gateway.envoyproxy.io/owning-gateway-name=headlamp', '-o', 'json',
]));
const envoy = svc.items[0];
const envoyNs = envoy.metadata.namespace;
const envoyName = envoy.metadata.name;
const forwardLogs = ['pf-gw.log', 'pf-dex.log'].map(name => openSync(path.join(work, name), 'w'));
const forwards = [
  spawn('kubectl', ['--kubeconfig', kubeconfig, '--context', context, '-n', envoyNs, 'port-forward', '--address', '127.0.0.1', `svc/${envoyName}`, '8443:443'], { stdio: ['ignore', forwardLogs[0], forwardLogs[0]] }),
  spawn('kubectl', ['--kubeconfig', kubeconfig, '--context', context, '-n', 'dex', 'port-forward', '--address', '127.0.0.1', 'svc/dex', '5556:5556'], { stdio: ['ignore', forwardLogs[1], forwardLogs[1]] }),
];
const stop = () => forwards.forEach(child => child.kill('SIGTERM'));
process.on('exit', stop);

function curl(args) {
  return run('curl', ['-k', '-sS', '--max-time', '20', ...args]);
}
let gatewayCode = '';
for (let i = 0; i < 30; i += 1) {
  try {
    gatewayCode = curl(['-o', '/dev/null', '-D', '-', '-H', 'Accept: application/json', `${origin}/`]);
    if (gatewayCode.includes('401')) break;
  } catch {
    gatewayCode = '';
  }
  await sleep(2000);
}
if (!gatewayCode.includes('401')) {
  throw new Error(`Expected 401 from the SecurityPolicy for an API client, got:\n${gatewayCode}`);
}
const browserRedirect = curl(['-o', '/dev/null', '-D', '-', `${origin}/`]);
if (!browserRedirect.includes('302') || !browserRedirect.toLowerCase().includes('dex')) {
  throw new Error(`Expected a Dex login redirect, got:\n${browserRedirect}`);
}
console.log('SecurityPolicy rejects anonymous API clients and redirects browsers to Dex.');
let dexCode = '';
for (let i = 0; i < 20; i += 1) {
  try {
    dexCode = curl(['-o', '/dev/null', '-D', '-', 'https://dex.dex.svc.cluster.local:5556/dex/.well-known/openid-configuration']);
    if (dexCode.includes('200')) break;
  } catch (error) {
    dexCode = String(error);
  }
  await sleep(1000);
}
if (!dexCode.includes('200')) {
  console.log(readFileSync(path.join(work, 'pf-dex.log'), 'utf8'));
  throw new Error(`Dex is not reachable on the host port-forward:\n${dexCode}`);
}

step('browser login and the served shell config');
const playwrightDir = '/tmp/buttah-bookmarks-playwright';
const { chromium } = createRequire(import.meta.url)(path.join(playwrightDir, 'node_modules/playwright'));
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } });
let navigationError = null;
for (let i = 0; i < 5; i += 1) {
  try {
    await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    navigationError = null;
    break;
  } catch (error) {
    navigationError = error;
    await sleep(2000);
  }
}
if (navigationError) {
  console.log(readFileSync(path.join(work, 'pf-gw.log'), 'utf8'));
  console.log(readFileSync(path.join(work, 'pf-dex.log'), 'utf8'));
  throw navigationError;
}
await page.locator('input[name="login"]').fill('alice@alpina.test');
await page.locator('input[name="password"]').fill(password);
await page.locator('button[type="submit"]').click();
await page.waitForURL(/headlamp\.local:8443/, { timeout: 60000 });
const configText = await page.evaluate(async () => {
  const response = await fetch('/plugins/buttah-shell-config/config.json', { cache: 'no-store' });
  if (!response.ok) throw new Error(`config status ${response.status}`);
  return response.text();
});
const config = JSON.parse(configText);
if (config.shell?.issuerUrl !== issuer || config.shell?.clientId !== 'buttah-shell') {
  throw new Error(`Served config is not the Dex client:\n${configText}`);
}
if (configText.includes('auth.buttah.cloud') || configText.includes('dashboard.svc.buttah.cloud')) {
  throw new Error('Served config still contains a built-in default.');
}
await page.goto(`${origin}/settings/plugins/buttah-shell`, { waitUntil: 'domcontentloaded' });
await page.locator('#buttah-settings-issuer').waitFor({ timeout: 20000 });
const issuerValue = await page.locator('#buttah-settings-issuer').inputValue();
const clientValue = await page.locator('#buttah-settings-client').inputValue();
if (issuerValue !== issuer || clientValue !== 'buttah-shell') {
  throw new Error(`Settings showed issuer=${issuerValue} client=${clientValue}`);
}
const originAttr = await page.locator('#buttah-settings-cluster-config').getAttribute('data-origin');
if (originAttr !== 'file') {
  throw new Error(`Settings origin is ${originAttr}, expected the served file.`);
}
mkdirSync(path.join(root, 'demo'), { recursive: true });
await page.screenshot({ path: path.join(root, 'demo/oidc-settings.png') });
await browser.close();
stop();
rmSync(work, { recursive: true, force: true });
console.log('OIDC gateway and buttah-shell-config passed.');
