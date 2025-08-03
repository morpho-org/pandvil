variable "PONDER_APP_NAME" {
    type = string
    default = "$PONDER_APP_NAME"
}
variable "PONDER_APP_PATH" {
    type = string
    default = "$PONDER_APP_PATH"
}

group "default" {
    targets = ["ponder-app", "server"]
}

target "docker-metadata-action" {}

target "pandvil" {
    context    = "."
    dockerfile = "./Dockerfile"
    target     = "prod"
    args = {
        PRUNED_PATH = "./out"
        BUILD_CMD  = "pnpm --filter @morpho-org/pandvil... run build"
    }
    tags = ["ghcr.io/morpho-org/pandvil:latest"]
}

target "pandvil-gha" {
    inherits   = ["docker-metadata-action", "pandvil"]
    cache-from = ["type=gha"]
    cache-to   = ["type=gha,mode=max"]
}

target "ponder-app" {
    context    = "."
    dockerfile = "./Dockerfile"
    # NOTE: when `target` is unspecified, the last stage is built
    args = {}
    output = [{ type = "cacheonly" }]
}

target "server" {
    context    = "."
    dockerfile = "./Dockerfile.with-your-app"
    depends    = ["pandvil", "ponder-app"]
    # https://docs.docker.com/build/bake/reference/#targetcontexts
    contexts = {
        "pandvil" = "docker-image://ghcr.io/morpho-org/pandvil:latest"
        "ponder-app" = "target:ponder-app"
    }
    args = {
        PONDER_APP_PATH = PONDER_APP_PATH
    }
    tags = ["pandvil/${PONDER_APP_NAME}:latest"]
}