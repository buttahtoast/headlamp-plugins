export type RuntimeDefaults = {
  server?: string;
  caCert?: string;
  insecureSkipTLSVerify?: boolean;

  clusterName?: string;
  userName?: string;
  contextName?: string;
  namespace?: string;
};

const CONFIG_FILE = 'config.json';

/**
 * Attempt to load runtime config from the plugin's own directory.
 *
 * Headlamp typically serves plugins from a /plugins/<pluginName>/ path.
 * We derive the base URL from the currently executing plugin script URL.
 */
export async function loadRuntimeDefaults(pluginId: string): Promise<RuntimeDefaults | undefined> {
  // 1) Best-effort: find the script tag that loaded our main bundle
  // Headlamp loads plugins by passing JS to the frontend; in most deployments
  // it is served from /plugins/<folder>/main.js (or similar).
  const scripts = Array.from(document.getElementsByTagName('script'));
  const myScript =
    scripts.find(s => (s.src || '').includes(`/plugins/${pluginId}/`)) ||
    scripts.find(s => (s.src || '').includes(pluginId));

  let baseUrl: string | undefined;

  if (myScript?.src) {
    // e.g. https://host/plugins/headlamp-kubeconfig-oidc/main.js
    baseUrl = myScript.src.split('/').slice(0, -1).join('/');
  } else {
    // 2) Fallback: assume standard path
    baseUrl = `${window.location.origin}/plugins/${pluginId}`;
  }

  const url = `${baseUrl}/${CONFIG_FILE}`;

  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return undefined;
    const data = (await res.json()) as RuntimeDefaults;
    return data || undefined;
  } catch {
    return undefined;
  }
}
