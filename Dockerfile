FROM node:24-slim AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

WORKDIR /workspace

# Path to a directory with the following structure:
# - `json` - all files required to `pnpm install` the package, e.g.:
#            .npmrc package.json pnpm-lock.yaml pnpm-workspace.yaml
#            .pnpmfile.cjs patches
# - `full` - all files required to build/run the package, i.e.
#            the source code
#
# If you're using turbo, this is the output of `turbo prune --docker`
ARG PRUNED_PATH

# Install pnpm and fetch prod deps since they're used in all stages
COPY ${PRUNED_PATH}/json .

FROM base AS prod-deps
# ´:°•.°+.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°+.*•´.*:
# Install dependencies (prod)
# .•°:°.´+˚.*°.˚:*.´•*.+°.•°:´*.´•*.•°.•°:°.´:•˚°.*°.˚:*.´+°.•

# Install
RUN --mount=type=cache,id=pnpm0,target=/pnpm/store pnpm install --frozen-lockfile --prod

FROM base AS builder
# ´:°•.°+.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°+.*•´.*:
# Install dependencies (all) and build
# .•°:°.´+˚.*°.˚:*.´•*.+°.•°:´*.´•*.•°.•°:°.´:•˚°.*°.˚:*.´+°.•
ARG PRUNED_PATH

# Install
RUN --mount=type=cache,id=pnpm1,target=/pnpm/store pnpm install --frozen-lockfile

# Build
COPY ${PRUNED_PATH}/full .
ARG BUILD_CMD
RUN /bin/bash -c "${BUILD_CMD}"

# Delete node_modules and replace with cached `--prod` installation
RUN pnpm -r exec rm -rf node_modules

FROM base AS prod
# ´:°•.°+.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°+.*•´.*:
# Production
# .•°:°.´+˚.*°.˚:*.´•*.+°.•°:´*.´•*.•°.•°:°.´:•˚°.*°.˚:*.´+°.•
COPY --from=builder /workspace .
COPY --from=prod-deps /workspace .
