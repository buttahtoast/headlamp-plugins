import {
  DefaultDetailsViewSection,
  registerDetailsViewSectionsProcessor,
  registerRoute,
  registerSidebarEntry,
} from '@kinvolk/headlamp-plugin/lib';
import { Resource } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Box } from '@mui/material';
import { isValidElement } from 'react';
import { API_VERSION } from './model';
import { CleanerPage } from './ui';

// Reuse Headlamp's Events section so its data loading and controls stay native.
registerDetailsViewSectionsProcessor((resource, sections) => {
  if (
    resource?.jsonData.apiVersion !== API_VERSION ||
    !['Cleaner', 'Report'].includes(resource.kind)
  ) {
    return sections;
  }
  const events = sections.find(
    section =>
      section &&
      typeof section === 'object' &&
      'id' in section &&
      section.id === DefaultDetailsViewSection.EVENTS
  );
  if (
    !events ||
    typeof events !== 'object' ||
    !('section' in events) ||
    !isValidElement(events.section)
  ) {
    return sections;
  }
  const eventsContent = events.section;
  return sections.flatMap(section => {
    if (section === events) return [];
    if (
      section &&
      typeof section === 'object' &&
      'id' in section &&
      section.id === DefaultDetailsViewSection.METADATA
    ) {
      return [
        section,
        {
          id: 'cleaner-conditions-events',
          section: (
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: 'minmax(0, 1fr)', lg: 'repeat(2, minmax(0, 1fr))' },
                gap: 2,
                alignItems: 'start',
                minWidth: 0,
              }}
            >
              <Box sx={{ minWidth: 0 }}>
                <Resource.ConditionsSection resource={resource.jsonData} />
              </Box>
              <Box sx={{ minWidth: 0 }}>{eventsContent}</Box>
            </Box>
          ),
        },
      ];
    }
    return [section];
  });
});

registerSidebarEntry({
  parent: null,
  name: 'cleaner',
  label: 'Cleaner',
  icon: 'mdi:broom',
  url: '/cleaner',
});
for (const [name, label, path, icon] of [
  ['overview', 'Overview', '/cleaner', 'mdi:view-dashboard-outline'],
  ['reports', 'Reports', '/cleaner/reports', 'mdi:clipboard-text-outline'],
  ['recipes', 'Recipes', '/cleaner/recipes', 'mdi:bookshelf'],
]) {
  registerSidebarEntry({ parent: 'cleaner', name: `cleaner-${name}`, label, url: path, icon });
  registerRoute({
    path,
    name: `cleaner-${name}`,
    sidebar: `cleaner-${name}`,
    exact: true,
    component: () => <CleanerPage view={name as 'overview' | 'reports' | 'recipes'} />,
  });
}
// Keep existing bookmarks working after the Library → Recipes rename.
registerRoute({
  path: '/cleaner/library',
  name: 'cleaner-library',
  sidebar: 'cleaner-recipes',
  exact: true,
  component: () => <CleanerPage view="recipes" />,
});
registerRoute({
  path: '/cleaner/policies/:name',
  name: 'cleaner-policy',
  sidebar: 'cleaner-overview',
  exact: true,
  component: () => <CleanerPage view="policy" />,
});
registerRoute({
  path: '/cleaner/reports/:name',
  name: 'cleaner-report',
  sidebar: 'cleaner-reports',
  exact: true,
  component: () => <CleanerPage view="report" />,
});
