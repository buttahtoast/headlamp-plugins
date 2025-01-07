import { registerRoute } from '@kinvolk/headlamp-plugin/lib';
import WebProxy from './webproxy';

// Below are some imports you may want to use.
//   See README.md for links to plugin development documentation.
// import { SectionBox } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
// import { K8s } from '@kinvolk/headlamp-plugin/lib/K8s';
// import { Typography } from '@mui/material';

registerSidebarEntry({
    parent: null,
    name: 'webproxy',
    label: 'Web Proxy',
    url: '/webproxy/',
  });
registerRoute({
    path: '/webproxy/',
    parent: null,
    sidebar: 'webproxy',
    component: () => <WebProxy />,

  });
  