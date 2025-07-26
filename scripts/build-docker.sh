#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PANDVIL_DIR="$(dirname "$SCRIPT_DIR")"
MONOREPO_ROOT="$(cd "$PANDVIL_DIR/../.." && pwd)"

export PONDER_APP_NAME="${1:-curator-api}"
PONDER_APP_PATH=$(pnpm --filter curator-api exec pwd)
export PONDER_APP_PATH="${PONDER_APP_PATH#$MONOREPO_ROOT/}"
export PONDER_APP_BUILD_CMD="pnpm --filter $PONDER_APP_NAME^... run build"

export TURBO_PRINT_VERSION_DISABLED=1
export TURBO_NO_UPDATE_NOTIFIER=1

export PANDVIL_PRUNED_PATH="./out/pandvil"
rm -rf -- "${MONOREPO_ROOT:?}/$PANDVIL_PRUNED_PATH"
pnpm turbo --only prune @repo/pandvil --docker --out-dir $PANDVIL_PRUNED_PATH

export PONDER_APP_PRUNED_PATH="./out/${PONDER_APP_NAME}"
rm -rf -- "${MONOREPO_ROOT:?}/$PONDER_APP_PRUNED_PATH"
pnpm turbo --only prune $PONDER_APP_NAME --docker --out-dir $PONDER_APP_PRUNED_PATH

docker buildx bake -f docker-bake.hcl --allow fs.read=../.. --load
