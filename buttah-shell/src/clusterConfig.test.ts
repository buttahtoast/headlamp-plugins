import { describe, expect, it } from 'vitest';
import { emptyOverrides, fetchClusterConfig, oidcReady, resolvePrefs } from './clusterConfig';

const served = JSON.stringify({
  shell: {
    issuerUrl: 'https://dex.dex.svc.cluster.local:5556/dex',
    clientId: 'buttah-shell',
    scopes: 'openid email',
    authorizationEndpoint: 'https://dex.dex.svc.cluster.local:5556/dex/auth',
    tokenEndpoint: 'https://dex.dex.svc.cluster.local:5556/dex/token',
    image: 'docker.io/alpine/kubectl:1.35.4',
    namespace: 'shop',
  },
});

describe('cluster config', () => {
  it('stays empty when no config file is served', async () => {
    const config = await fetchClusterConfig(
      async () => new Response('missing', { status: 404 }),
      [
        '/plugins/buttah-shell-config/config.json',
        '/static-plugins/buttah-shell-config/config.json',
        '/user-plugins/buttah-shell-config/config.json',
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
  });

  it('uses only the served config', async () => {
    const config = await fetchClusterConfig(
      async () => new Response(served, { status: 200 }),
      ['/plugins/buttah-shell-config/config.json']
    );
    expect(config.status).toBe('ok');
    expect(config.origin).toBe('file');
    expect(config.values.shell.issuerUrl).toBe('https://dex.dex.svc.cluster.local:5556/dex');
    expect(config.values.shell.clientId).toBe('buttah-shell');
    expect(config.values.shell.namespace).toBe('shop');
    const resolved = resolvePrefs(emptyOverrides(), config);
    expect(resolved.prefs.shell.issuerUrl).toBe('https://dex.dex.svc.cluster.local:5556/dex');
    expect(resolved.source['shell.issuerUrl']).toBe('admin');
  });
});
