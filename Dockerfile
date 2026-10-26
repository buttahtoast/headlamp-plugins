# Match the Node version used by the Capsule Headlamp checks.
FROM node:24 AS builder

# Set the working directory inside the container
WORKDIR /headlamp-plugins

# Add a build argument for the desired plugin to be built
ARG PLUGIN

# Check if the PLUGIN argument is provided
RUN case "$PLUGIN" in ''|*[!a-z0-9-]*) echo 'Invalid PLUGIN directory'; exit 1 ;; esac

# Create a directory for the plugin build
RUN mkdir -p /headlamp-plugins/build

# Copy the plugin source code into the container
# Flux bundles the shared inspector exported by this local plugin package.
COPY ssa /headlamp-plugins/ssa
COPY ${PLUGIN} /headlamp-plugins/${PLUGIN}
COPY .github/plugin-settings.json /headlamp-plugins/plugin-settings.json

WORKDIR /headlamp-plugins/${PLUGIN}
RUN npm ci
RUN npm run build

# Extract the built plugin to the build directory
RUN npx --no-install headlamp-plugin extract "$PWD" /headlamp-plugins/build && \
    node -e 'const fs = require("node:fs"); const name = process.env.PLUGIN; const install = require("/headlamp-plugins/plugin-settings.json")[name]?.installDirectory || name; if (install !== name) fs.renameSync(`/headlamp-plugins/build/${name}`, `/headlamp-plugins/build/${install}`);'

FROM busybox:1.37.0

# Copy the built plugin files from the builder stage to the /plugins directory in the final image
COPY --from=builder /headlamp-plugins/build/ /plugins/

LABEL org.opencontainers.image.source=https://github.com/buttahtoast/headlamp-plugins
