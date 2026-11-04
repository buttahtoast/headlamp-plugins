# Kubeconfig

A Headlamp plugin that downloads a kubeconfig for the signed-in user. The issuer, client, token endpoints, shell image, API server, and cluster name come from `buttah-kubeconfig-config/config.json`. Nothing in that list is built into the plugin. When the file is missing or invalid, download stays disabled.

Headlamp serves the file from `/plugins/buttah-kubeconfig-config/config.json`, then `/static-plugins/`, then `/user-plugins/`.

![Download a kubeconfig](demo/kubeconfig.gif)

`demo/kubeconfig.gif` is Headlamp v0.46.0 on a kind cluster. Download signs in and shows the kubeconfig. `npm run demo` records it again from a Headlamp already serving this plugin and buttah-shell. It reads `HEADLAMP_URL` (default `https://headlamp.local:8443`) and `HEADLAMP_CLUSTER` (default `shell`).

The download uses a public PKCE client. That client is not Headlamp's gateway client.

## Build

```sh
cd buttah-kubeconfig
npm ci
npm run lint
npm run format -- --check
npm run tsc
npm test
npm run build
```
