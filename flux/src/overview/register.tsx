import { registerRoute, registerSidebarEntry } from '@kinvolk/headlamp-plugin/lib';
import { FluxOverview } from './index';

export const FLUX_OVERVIEW_ID = 'flux-overview';

export function registerFluxOverview() {
  registerSidebarEntry({
    parent: 'flux',
    name: FLUX_OVERVIEW_ID,
    label: 'Overview',
    url: '/flux/overview',
  });
  registerRoute({
    path: '/flux/overview',
    sidebar: FLUX_OVERVIEW_ID,
    name: FLUX_OVERVIEW_ID,
    component: () => <FluxOverview />,
    exact: true,
  });
}
