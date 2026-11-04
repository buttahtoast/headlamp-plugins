# Shell

A Headlamp plugin that opens a kubectl shell in the cluster. The shell pod uses an OIDC ID token from a public client. That client, the issuer, the endpoints, the image, and the namespace come from `buttah-shell-config/config.json`. The plugin does not embed an identity provider or a shell image. When that file is missing or invalid, Open shell stays disabled.

Headlamp serves the file from `/plugins/buttah-shell-config/config.json`, then `/static-plugins/`, then `/user-plugins/`.

![Open a shell](demo/shell.gif)

`demo/shell.gif` is Headlamp v0.46.0 on a kind cluster. Open shell signs in and runs `kubectl version --client`. `npm run demo` records it again from a Headlamp already serving this plugin. It reads `HEADLAMP_URL` (default `https://headlamp.local:8443`) and `HEADLAMP_CLUSTER` (default `shell`).

## Build

```sh
cd buttah-shell
npm ci
npm run lint
npm run format -- --check
npm run tsc
npm test
npm run build
```
