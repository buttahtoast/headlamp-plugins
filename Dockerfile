# Use Node.js 22 LTS slim variant (required by vite, vitest, and other dependencies)
FROM node:22-slim AS builder

# Set the working directory inside the container
WORKDIR /headlamp-plugins

# Add a build argument for the desired plugin to be built
ARG PLUGIN

# Check if the PLUGIN argument is provided
RUN if [ -z "$PLUGIN" ]; then \
      echo "Error: PLUGIN argument is required"; \
      exit 1; \
    fi

# Configure npm for better reliability in CI/QEMU environments
RUN npm config set fetch-retry-mintimeout 20000 && \
    npm config set fetch-retry-maxtimeout 120000 && \
    npm config set fetch-retries 5

# Copy only package files first for better layer caching
COPY ${PLUGIN}/package*.json /headlamp-plugins/${PLUGIN}/

# Install dependencies with retry logic for QEMU builds
WORKDIR /headlamp-plugins/${PLUGIN}
RUN --mount=type=cache,target=/root/.npm \
    npm ci || npm ci || npm ci

# Copy the rest of the plugin source code
COPY ${PLUGIN} /headlamp-plugins/${PLUGIN}

# Build the plugin and extract to build directory
RUN npm run build && \
    mkdir -p /headlamp-plugins/build/${PLUGIN} && \
    npx --no-install headlamp-plugin extract . /headlamp-plugins/build/${PLUGIN}

# Use minimal final image
FROM alpine:3.20

# Copy the built plugin files from the builder stage
COPY --from=builder /headlamp-plugins/build/ /plugins/

LABEL org.opencontainers.image.source=https://github.com/buttahtoast/headlamp-plugins
LABEL org.opencontainers.image.licenses=MIT