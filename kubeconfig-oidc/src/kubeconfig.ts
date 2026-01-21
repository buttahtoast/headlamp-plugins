export type KubeconfigInput = {
  clusterName: string;
  userName: string;
  contextName: string;
  namespace?: string;

  server: string;
  insecureSkipTLSVerify: boolean;
  caCert?: string; // PEM or base64

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
    // PEM contains base64 body inside; strip header/footer/whitespace.
    return trimmed
      .replace(/-----BEGIN CERTIFICATE-----/g, '')
      .replace(/-----END CERTIFICATE-----/g, '')
      .replace(/\s+/g, '');
  }

  // assume already base64
  return trimmed.replace(/\s+/g, '');
}

export function buildKubeconfigYAML(input: KubeconfigInput): string {
  const caData = normalizeCaData(input.caCert);

  const indent = (n: number) => ' '.repeat(n);
  const lines: string[] = [];

  lines.push('apiVersion: v1');
  lines.push('kind: Config');

  lines.push('clusters:');
  lines.push(`${indent(2)}- name: ${input.clusterName}`);
  lines.push(`${indent(4)}cluster:`);
  lines.push(`${indent(6)}server: ${input.server}`);
  if (input.insecureSkipTLSVerify) {
    lines.push(`${indent(6)}insecure-skip-tls-verify: true`);
  } else if (caData) {
    lines.push(`${indent(6)}certificate-authority-data: ${caData}`);
  }

  lines.push('users:');
  lines.push(`${indent(2)}- name: ${input.userName}`);
  lines.push(`${indent(4)}user:`);
  lines.push(`${indent(6)}token: ${input.token}`);

  lines.push('contexts:');
  lines.push(`${indent(2)}- name: ${input.contextName}`);
  lines.push(`${indent(4)}context:`);
  lines.push(`${indent(6)}cluster: ${input.clusterName}`);
  lines.push(`${indent(6)}user: ${input.userName}`);
  if (input.namespace?.trim()) {
    lines.push(`${indent(6)}namespace: ${input.namespace.trim()}`);
  }

  lines.push(`current-context: ${input.contextName}`);

  return lines.join('\n') + '\n';
}
