export type KubeconfigInput = {
  clusterName: string;
  userName: string;
  contextName: string;
  namespace?: string;

  server: string;

  // If true, uses insecure-skip-tls-verify instead of CA data
  insecureSkipTLSVerify: boolean;

  // Either PEM ("-----BEGIN CERTIFICATE-----") or base64 CA data
  caCert?: string;

  token: string;
};

function isProbablyPemCert(s: string): boolean {
  return /-----BEGIN CERTIFICATE-----/.test(s);
}

function normalizeCaData(caCert?: string): string | undefined {
  if (!caCert) return undefined;
  const trimmed = caCert.trim();
  if (!trimmed) return undefined;

  if (isProbablyPemCert(trimmed)) {
    // Convert PEM to base64 (kubeconfig expects base64 for *-data fields)
    const pemBody = trimmed
      .replace(/-----BEGIN CERTIFICATE-----/g, '')
      .replace(/-----END CERTIFICATE-----/g, '')
      .replace(/\s+/g, '');
    // pemBody is already base64 content inside PEM
    return pemBody;
  }

  // Assume already base64 CA data
  return trimmed.replace(/\s+/g, '');
}

export function buildKubeconfigYAML(input: KubeconfigInput): string {
  const {
    clusterName,
    userName,
    contextName,
    namespace,
    server,
    insecureSkipTLSVerify,
    caCert,
    token,
  } = input;

  const caData = normalizeCaData(caCert);

  // Minimal YAML emitter (safe for this structure)
  const indent = (n: number) => ' '.repeat(n);

  const lines: string[] = [];
  lines.push('apiVersion: v1');
  lines.push('kind: Config');
  lines.push('clusters:');
  lines.push(`${indent(2)}- name: ${clusterName}`);
  lines.push(`${indent(4)}cluster:`);
  lines.push(`${indent(6)}server: ${server}`);

  if (insecureSkipTLSVerify) {
    lines.push(`${indent(6)}insecure-skip-tls-verify: true`);
  } else if (caData) {
    lines.push(`${indent(6)}certificate-authority-data: ${caData}`);
  }

  lines.push('users:');
  lines.push(`${indent(2)}- name: ${userName}`);
  lines.push(`${indent(4)}user:`);
  lines.push(`${indent(6)}token: ${token}`);

  lines.push('contexts:');
  lines.push(`${indent(2)}- name: ${contextName}`);
  lines.push(`${indent(4)}context:`);
  lines.push(`${indent(6)}cluster: ${clusterName}`);
  lines.push(`${indent(6)}user: ${userName}`);
  if (namespace?.trim()) {
    lines.push(`${indent(6)}namespace: ${namespace.trim()}`);
  }

  lines.push(`current-context: ${contextName}`);

  return lines.join('\n') + '\n';
}
