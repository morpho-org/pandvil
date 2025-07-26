variable "PONDER_APP_PRUNED_PATH" {
    type = string
    default = "$PONDER_APP_PRUNED_PATH"
}
variable "PONDER_APP_BUILD_CMD" {
    type = string
    default = "$PONDER_APP_BUILD_CMD"
}
variable "PONDER_APP_PATH" {
    type = string
    default = "$PONDER_APP_PATH"
}
variable "PONDER_APP_NAME" {
    type = string
    default = "$PONDER_APP_NAME"
}

group "default" {
    targets = ["pandvil", "ponder-app", "server"]
}

target "pandvil" {
    context    = "."
    dockerfile = "./Dockerfile"
    target     = "prod"
    args = {
        PRUNED_PATH = "./out/pandvil"
        BUILD_CMD  = "pnpm --filter @morpho/pandvil... run build"
    }
    output = [{ type = "cacheonly" }]
}

target "ponder-app" {
    context    = "."
    dockerfile = "./Dockerfile"
    target     = "prod"
    args = {
        PRUNED_PATH = PONDER_APP_PRUNED_PATH
        BUILD_CMD  = PONDER_APP_BUILD_CMD
    }
    output = [{ type = "cacheonly" }]
}

target "server" {
    context    = "."
    dockerfile = "./Dockerfile.with-your-app"
    depends    = ["pandvil", "ponder-app"]
    # https://docs.docker.com/build/bake/reference/#targetcontexts
    contexts = {
        "pandvil" = "target:builder-pandvil"
        "ponder-app" = "target:builder-ponder-app"
    }
    args = {
        PONDER_APP_PATH = PONDER_APP_PATH
    }
    tags = ["pandvil/${PONDER_APP_NAME}:latest"]
}