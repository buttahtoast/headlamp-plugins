import { describe, expect, it, vi } from 'vitest';
const { sidebar, routes, registerRoute, registerSidebarEntry } = vi.hoisted(() => {
  const sidebar = new Map<string, any>();
  const routes = new Map<string, any>();
  return {
    sidebar,
    routes,
    registerSidebarEntry: vi.fn((entry: any) => sidebar.set(entry.name, entry)),
    registerRoute: vi.fn((route: any) => routes.set(route.name, route)),
  };
});
vi.mock('@kinvolk/headlamp-plugin/lib', () => ({ registerRoute, registerSidebarEntry }));
vi.mock('./index', () => ({ FluxOverview: () => null }));
import { registerFluxOverview } from './register';
describe('Flux overview navigation', () => {
  it('keeps Capsule and generic overview entries while registering its own route and sidebar', () => {
    const capsule = { parent: 'capsule', name: 'capsule-overview', url: '/capsule/overview/' };
    const generic = { name: 'overview', url: '/capsule/overview/' };
    sidebar.set(capsule.name, capsule);
    sidebar.set(generic.name, generic);
    registerFluxOverview();
    expect(sidebar.get('capsule-overview')).toBe(capsule);
    expect(sidebar.get('overview')).toBe(generic);
    const flux = sidebar.get('flux-overview');
    expect(flux.parent).toBe('flux');
    expect(flux.url).toBe('/flux/overview');
    expect(routes.get('flux-overview').path).toBe(flux.url);
    expect(routes.get('flux-overview').sidebar).toBe(flux.name);
    expect(routes.get('flux-overview').component()).toBeTruthy();
  });
});
