/**
 * A kubeconfig whose user entry is the ID token from the shell's PKCE sign-in.
 * The file is built in memory for download and copy. It is not stored.
 */
import type { KubeconfigSettings } from './clusterConfig';

export type TokenIdentity = {
  userName: string;
  expiresAt: Date;
};

export type KubeconfigFile = {
  fileName: string;
  contextName: string;
  yaml: string;
  identity: TokenIdentity;
};

function padBase64(value: string): string {
  const text = value.replace(/-/g, '+').replace(/_/g, '/');
  const remainder = text.length % 4;
  return remainder === 0 ? text : text + '='.repeat(4 - remainder);
}

export function decodeJwtPayload(token: string): Record<string, unknown> {
  const part = token.split('.')[1];
  if (!part || token.split('.').length < 3) {
    throw new Error('The ID token was not a JWT.');
  }
  let json = '';
  try {
    json = atob(padBase64(part));
  } catch {
    throw new Error('The ID token was not a JWT.');
  }
  try {
    const payload = JSON.parse(json) as unknown;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error('The ID token was not a JWT.');
    }
    return payload as Record<string, unknown>;
  } catch (error) {
    if (error instanceof Error && error.message === 'The ID token was not a JWT.') {
      throw error;
    }
    throw new Error('The ID token was not a JWT.');
  }
}

export function tokenIdentity(token: string): TokenIdentity {
  const payload = decodeJwtPayload(token);
  const exp = payload.exp;
  if (typeof exp !== 'number' || !Number.isFinite(exp)) {
    throw new Error('The ID token has no expiry.');
  }
  const email = typeof payload.email === 'string' ? payload.email.trim() : '';
  const sub = typeof payload.sub === 'string' ? payload.sub.trim() : '';
  const userName = email || sub;
  if (!userName) {
    throw new Error('The ID token has no email or subject.');
  }
  return { userName, expiresAt: new Date(exp * 1000) };
}

export function pemFromAdminCa(value: string): string {
  const trimmed = value.replace(/\r\n/g, '\n').trim();
  if (!trimmed) {
    throw new Error('The cluster CA is empty.');
  }
  if (trimmed.includes('-----BEGIN CERTIFICATE-----')) {
    return trimmed.endsWith('\n') ? trimmed : `${trimmed}\n`;
  }
  let decoded = '';
  try {
    decoded = atob(trimmed.replace(/\s/g, ''));
  } catch {
    throw new Error('kubeconfig.certificateAuthorityData is not a certificate.');
  }
  if (!decoded.includes('-----BEGIN CERTIFICATE-----')) {
    throw new Error('kubeconfig.certificateAuthorityData is not a certificate.');
  }
  return decoded.endsWith('\n') ? decoded : `${decoded}\n`;
}

export function idTokenFromExchangeOutput(text: string): string {
  const match = text.match(/BUTTAH_ID_TOKEN\s+(\S+)/);
  if (match?.[1]) {
    return match[1];
  }
  if (text.includes('BUTTAH_TOKEN_FAILED')) {
    const detail = text.split('BUTTAH_TOKEN_FAILED').pop()?.trim() ?? '';
    throw new Error(
      detail
        ? `The sign-in could not be completed. ${detail}`
        : 'The sign-in could not be completed.'
    );
  }
  throw new Error('The sign-in did not return an ID token.');
}

export function pemToBase64(pem: string): string {
  const bytes = new TextEncoder().encode(pem);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function yamlQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** Headlamp serves the Kubernetes API under /clusters/<context>, not at /. */
export function headlampProxyServer(server: string): boolean {
  try {
    const path = new URL(server).pathname.replace(/\/+$/, '');
    return path === '/clusters' || path.startsWith('/clusters/');
  } catch {
    return false;
  }
}

/**
 * configured: the cluster config set a certificate.
 * system: the server is the Headlamp proxy behind Envoy, so kubectl uses the
 * workstation trust store. kube-root-ca.crt is the API server CA and would
 * reject the gateway certificate.
 * cluster-root: the server is the API server and no certificate was set, so
 * download reads kube-root-ca.crt from kube-public.
 */
export type CertificateAuthorityMode = 'configured' | 'system' | 'cluster-root';

export function certificateAuthorityMode(
  server: string,
  configured: string | undefined
): CertificateAuthorityMode {
  if (configured?.trim()) {
    return 'configured';
  }
  return headlampProxyServer(server) ? 'system' : 'cluster-root';
}

export function clusterCaFieldText(server: string, configured: string | undefined): string {
  if (!server.trim()) {
    return 'Not set';
  }
  const mode = certificateAuthorityMode(server, configured);
  if (mode === 'configured') {
    return 'Set in the cluster config';
  }
  if (mode === 'system') {
    return 'System trust store';
  }
  return 'kube-root-ca.crt in kube-public';
}

/** Namespace from a Headlamp URL, or the first path segment when it is a real namespace. */
export function namespaceFromHeadlampPath(
  pathname: string,
  cluster: string,
  knownNamespaces: readonly string[]
): string {
  const parts = pathname.split('/').filter(Boolean);
  const index = parts.findIndex((part, i) => part === 'c' && parts[i + 1] === cluster);
  if (index < 0) {
    return '';
  }
  const rest = parts.slice(index + 2);
  if (rest[0] === 'namespaces' && rest[1] && knownNamespaces.includes(rest[1])) {
    return rest[1];
  }
  if (rest[0] && knownNamespaces.includes(rest[0])) {
    return rest[0];
  }
  return '';
}

/** Current page, then the last choice, then the ConfigMap suggestion. */
export function contextNamespaceChoice(input: {
  pathname: string;
  cluster: string;
  knownNamespaces: readonly string[];
  stored: string;
  configDefault: string;
}): string {
  return (
    namespaceFromHeadlampPath(input.pathname, input.cluster, input.knownNamespaces) ||
    input.stored.trim() ||
    input.configDefault.trim()
  );
}

export function kubeconfigDocument(input: {
  settings: KubeconfigSettings;
  clusterFallbackName: string;
  namespaceFallback: string;
  certificateAuthorityPem: string;
  idToken: string;
}): KubeconfigFile {
  const identity = tokenIdentity(input.idToken);
  const clusterName = input.settings.clusterName?.trim() || input.clusterFallbackName.trim();
  if (!clusterName) {
    throw new Error('The cluster config does not set kubeconfig.clusterName.');
  }
  const server = input.settings.server?.trim() ?? '';
  if (!server) {
    throw new Error('The cluster config does not set kubeconfig.server.');
  }
  const namespace =
    input.settings.contextNamespace?.trim() || input.namespaceFallback.trim() || 'default';
  const expires = identity.expiresAt.toISOString();
  const contextName = `${identity.userName}@${clusterName}`;
  const pem = input.certificateAuthorityPem.trim();
  const clusterLines = [`    server: ${yamlQuote(server)}`];
  if (pem) {
    clusterLines.push(`    certificate-authority-data: ${pemToBase64(pemFromAdminCa(pem))}`);
  }
  const yaml = [
    `# ${identity.userName} expires ${expires}.`,
    'apiVersion: v1',
    'kind: Config',
    'clusters:',
    `- name: ${yamlQuote(clusterName)}`,
    '  cluster:',
    ...clusterLines,
    'users:',
    `- name: ${yamlQuote(identity.userName)}`,
    '  user:',
    `    token: ${yamlQuote(input.idToken)}`,
    'contexts:',
    `- name: ${yamlQuote(contextName)}`,
    '  context:',
    `    cluster: ${yamlQuote(clusterName)}`,
    `    user: ${yamlQuote(identity.userName)}`,
    `    namespace: ${yamlQuote(namespace)}`,
    `current-context: ${yamlQuote(contextName)}`,
    '',
  ].join('\n');
  const safeUser = identity.userName.replace(/[^A-Za-z0-9._@+-]+/g, '-');
  const safeCluster = clusterName.replace(/[^A-Za-z0-9._@+-]+/g, '-');
  return {
    fileName: `${safeUser}-${safeCluster}.kubeconfig`,
    contextName,
    yaml,
    identity,
  };
}
