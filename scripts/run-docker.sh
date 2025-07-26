#!/bin/bash
set -e

# Pull in env vars
set -a
[ -f .env ] && source .env
[ -f .env.local ] && source .env.local
set +a

PONDER_APP_NAME="${1:-curator-api}"
IMAGE_TAG="pandvil/${PONDER_APP_NAME}:latest"
PORT="${PORT:-3999}"

echo "Starting Pandvil container..."
echo "❇︎ Image: $IMAGE_TAG"
echo "❇︎ Port: $PORT"
echo ""

# Build the docker run command as an array
DOCKER_CMD=(docker run --rm -it)
DOCKER_CMD+=( -p "${PORT}:3999" )

# Inject env vars (no extra escaping needed in array form)
DOCKER_CMD+=( \
  -e "NEON_API_KEY=${NEON_API_KEY}" \
  -e "NEON_PROJECT_ID=${NEON_PROJECT_ID}" \
)

# Add all PONDER_RPC_URL_* environment variables
for var in $(env | grep '^PONDER_RPC_URL_' | cut -d= -f1); do
  DOCKER_CMD+=( -e "${var}=${!var}" )
done

# Add image and pass through remaining arguments directly
DOCKER_CMD+=( "${IMAGE_TAG}" "${@:2}" )

# Execute the assembled command
"${DOCKER_CMD[@]}"