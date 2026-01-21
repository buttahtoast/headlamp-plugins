export type RuntimeDefaults = {
  server?: string;
  caCert?: string; // PEM or base64
  insecureSkipTLSVerify?: boolean;

  clusterName?: string;
  userName?: string;
  contextName?: string;
  namespace?: string;
};

function getPluginBaseUrl(pluginId: string): string {
  const scripts = Array.from(document.getElementsByTagName('script'));
  const myScript =
    scripts.find(s => (s.src || '').includes(`/plugins/${pluginId}/`)) ||
    scripts.find(s => (s.src || '').includes(pluginId));

  if (myScript?.src) {
    return myScript.src.split('/').slice(0, -1).join('/');
  }

  return `${window.location.origin}/plugins/${pluginId}`;
}

export async function loadRuntimeDefaults(pluginId: string): Promise<RuntimeDefaults> {
  const base = getPluginBaseUrl(pluginId);
  const url = `${base}/config.json`;

  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`Failed to load config.json from ${url} (HTTP ${res.status})`);
  }

  const data = (await res.json()) as RuntimeDefaults;
  return data || {};
}
