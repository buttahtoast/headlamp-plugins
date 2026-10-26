import { registerRoute, registerSidebarEntry } from '@kinvolk/headlamp-plugin/lib';
import { VeleroPage, View } from './ui';

registerSidebarEntry({
  parent: null,
  name: 'velero',
  label: 'Velero',
  icon: 'mdi:backup-restore',
  url: '/velero',
});
for (const [view, label, icon] of [
  ['overview', 'Overview', 'mdi:view-dashboard-outline'],
  ['backups', 'Backups', 'mdi:archive-outline'],
  ['schedules', 'Schedules', 'mdi:calendar-clock'],
  ['restores', 'Restores', 'mdi:restore'],
  ['storage', 'Storage', 'mdi:database-outline'],
  ['activity', 'Volume transfers', 'mdi:swap-vertical'],
]) {
  const path = view === 'overview' ? '/velero' : `/velero/${view}`;
  registerSidebarEntry({ parent: 'velero', name: `velero-${view}`, label, url: path, icon });
  registerRoute({
    path,
    name: `velero-${view}`,
    sidebar: `velero-${view}`,
    exact: true,
    component: () => <VeleroPage view={view as View} />,
  });
}
for (const [view, collection] of [
  ['backup', 'backups'],
  ['schedule', 'schedules'],
  ['restore', 'restores'],
]) {
  registerRoute({
    path: `/velero/${collection}/:namespace/:name`,
    name: `velero-${view}`,
    sidebar: `velero-${collection}`,
    exact: true,
    component: () => <VeleroPage view={view as View} />,
  });
}
