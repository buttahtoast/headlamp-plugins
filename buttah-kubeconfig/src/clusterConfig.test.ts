import { describe, expect, it } from 'vitest';
import { emptyOverrides, fetchClusterConfig, oidcReady, resolvePrefs } from './clusterConfig';

const served = JSON.stringify({
  shell: {
    issuerUrl: 'https://dex.dex.svc.cluster.local:5556/dex',
    clientId: 'buttah-kubeconfig',
    scopes: 'openid email',
    authorizationEndpoint: 'https://dex.dex.svc.cluster.local:5556/dex/auth',
    tokenEndpoint: 'https://dex.dex.svc.cluster.local:5556/dex/token',
    image: 'example.invalid/kubectl:1',
  },
  kubeconfig: {
    server: 'https://headlamp.local:8443/clusters/shell',
    clusterName: 'shell',
  },
});

describe('cluster config', () => {
  it('stays empty when no config file is served', async () => {
    const config = await fetchClusterConfig(
      async () => new Response('missing', { status: 404 }),
      [
        '/plugins/buttah-kubeconfig-config/config.json',
        '/static-plugins/buttah-kubeconfig-config/config.json',
        '/user-plugins/buttah-kubeconfig-config/config.json',
      ]
    );
    expect(config.status).toBe('absent');
    expect(config.origin).toBe('none');
    expect(oidcReady(config)).toBe(false);
    const resolved = resolvePrefs(emptyOverrides(), config);
    expect(resolved.prefs.shell.issuerUrl).toBe('');
    expect(resolved.prefs.shell.clientId).toBe('');
    expect(resolved.prefs.shell.image).toBe('');
    expect(resolved.prefs.organization).toBe('');
    expect(config.values.kubeconfig.server ?? '').toBe('');
    expect(config.values.kubeconfig.clusterName ?? '').toBe('');
  });

  it('uses only the served config', async () => {
    const config = await fetchClusterConfig(
      async () => new Response(served, { status: 200 }),
      ['/plugins/buttah-kubeconfig-config/config.json']
    );
    expect(config.status).toBe('ok');
    expect(config.origin).toBe('file');
    expect(config.values.kubeconfig.server).toBe('https://headlamp.local:8443/clusters/shell');
    expect(config.values.kubeconfig.clusterName).toBe('shell');
    expect(config.values.shell.image).toBe('example.invalid/kubectl:1');
    const resolved = resolvePrefs(emptyOverrides(), config);
    expect(resolved.source['shell.issuerUrl']).toBe('admin');
    expect(resolved.source['kubeconfig.server']).toBe('admin');
  });
});
