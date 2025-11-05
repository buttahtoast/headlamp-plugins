# Use the official Node.js 18 image as the base image for building the plugins
FROM node:21 AS builder

# Set the working directory inside the container
WORKDIR /headlamp-plugins

# Add a build argument for the desired plugin to be built
ARG PLUGIN

# Check if the PLUGIN argument is provided
RUN if [ -z "$PLUGIN" ]; then \
      echo "Error: PLUGIN argument is required"; \
      exit 1; \
    fi

# Create a directory for the plugin build
RUN mkdir -p /headlamp-plugins/build/${PLUGIN}

# Copy the plugin source code into the container
COPY ${PLUGIN} /headlamp-plugins/${PLUGIN}

# Install dependencies for the specified plugin
RUN echo "Installing deps for plugin $PLUGIN..."; \
    cd /headlamp-plugins/$PLUGIN; \
    npm ci

# Build the specified plugin
RUN echo "Building plugin $PLUGIN..."; \
    cd /headlamp-plugins/$PLUGIN; \
    npm run build

# Extract the built plugin to the build directory
RUN echo "Extracting plugin $PLUGIN..."; \
    cd /headlamp-plugins/$PLUGIN; \
    npx --no-install headlamp-plugin extract . /headlamp-plugins/build/${PLUGIN}

FROM alpine

# Copy the built plugin files from the builder stage to the /plugins directory in the final image
COPY --from=builder /headlamp-plugins/build/ /plugins/

LABEL org.opencontainers.image.source=https://github.com/buttahtoast/headlamp-plugins
LABEL org.opencontainers.image.licenses=MIT