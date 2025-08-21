# Pandvil

A testing infrastructure for Ponder applications that combines:

- **Neon**: Ephemeral database branches
- **Anvil**: Local blockchain forks for testing
- **Ponder**: Blockchain indexing framework

## Overview

Pandvil provides a Docker-based testing environment that:

1. Creates an ephemeral Neon database branch for test isolation
2. Spins up Anvil instances that fork each indexed chain at the latest indexed block
3. Launches Ponder instances pointing at the local Anvil forks
4. Prevents block finalization to allow multiple Ponder instances on the same database

## Install

We haven't set up NPM yet, but you can download from GitHub like so:

```bash
# Replace v0.0.10 with whatever version you want
pnpm add -D https://github.com/morpho-org/pandvil/releases/download/v0.0.10/package.tgz
```

## Setup

### Prerequisites

- Docker
- Neon account with API access
- Environment variables:
  - `NEON_API_KEY`: Your Neon API key for branch management (obtainable through Neon's web app)
  - `NEON_PROJECT_ID`: Your Neon project ID
  - `PONDER_RPC_URL_*`: RPC URLs for each chain you want to fork
- Ponder app with a `ponder.config.ts` where:
  - RPCs are of the form `PONDER_RPC_URL_*`
  - `database: { kind: "postgres" }` (`connectionString` should be left unspecified)

### Dockerfile

Pandvil's server runs in a Docker container, so your Ponder app needs to as well.
Your Dockerfile should install/build your Ponder app in the `/workspace` directory
such that `pnpm ponder start` would run successfully.

For most setups, you can use something like [this](./Dockerfile), or go even simpler
if you don't care about Docker build speed and caching.

### Building

```bash
pnpm pandvil build \
  --name your-ponder-app-name \
  --ponder-app relative/path/where/ponder/should/run

# For argument documentation:
pnpm pandvil build --help
```

### Running

```bash
<<DOC
Run the Pandvil dev server for your app

Options:
  --name <name>                The ponder app name
  --parent-branch <name>       The name of the Neon branch to fork off of
  --spawn <N> | <name>         Spawn N instances on startup (if integer), or spawn 1 instance of a given name (if string)
  --prepare <N>                Spawn N instances and wait for backfill, preserving branch on exit for future use
  --preserve-ephemeral-branch  Tells the server not to delete its Neon branch on shutdown
  --preserve-schemas           Tells the server not to delete schemas when killing instances
  --ponder-log-level <level>   "debug" | "trace" | "error" | "warn" | "info" (default: "warn")
  --anvil-interval-mining <s>  "off" or an integer indicating seconds per block
  --port <port>                Port to connect to Pandvil dev server (default: "3999")
DOC

pnpm pandvil run \
  --name your-ponder-app-name
  --parent-branch some-neon-branch

# Output (example):
Starting Pandvil container...
❇︎ Image: pandvil/curator-api:latest
❇︎ Port: 3999

🟩 Neon:
 ═╣ production
  ╙─☑︎ production-pandvil-branch-name-123 (branch-id-456)

⛓️ Chains:
[
  {
    chainId: 8453,
    blockNumber: 33169119,
    rpcUrl: 'https://base-mainnet.g.alchemy.com/v2/key_789'
  }
]
```

> [!TIP]
> Run `pandvil` in a directory with your `.env` or `.env.local` to automatically inject
> environment variables into the container.

> [!TIP]
> Use the following recipe for quick, repeatable tests against a specific block number:
>
> 1. Trim your main branch (fully synced) back to a specific block:  
> ```
> pnpm pandvil trim --parent-branch production --name your-ci-branch --block-numbers 8453:33730000
> ```
> 2. Take the load off your CI by backfilling in advance:
> ```
> pnpm pandvil run --name your-ponder-app-name --parent-branch your-ci-branch --prepare 10
> # This prepares 10 instances, but you can prepare more depending on how many independent tests you plan to run!
> ```
> 3. Use the Neon web app to rename the ephemeral branch to something meaningful, like your-ci-branch-bootstrap
> 4. Run your CI!
> ```
> pnpm pandvil run --name your-ponder-app-name --parent-branch your-ci-branch-bootstrap
> ```

### Connecting Interactively

The server should only take a few seconds to start. Once it's up, POST to `/spawn` with `{ id: "frontend" }`.
The resulting URLs are deterministic:

- `"http://localhost:3999/proxy/frontend/rpc/:chainId"`
- `"http://localhost:3999/proxy/frontend/ponder/"`

Run your frontend dev server, create a new Chrome profile, and configure [enkrypt](https://www.enkrypt.com/)
(in my testing this has been more amenable to altered RPCs than Rabby, which falls back to public ones too readily):

- Seed: "test test test test test test test test test test test junk"
- Custom RPC: http://localhost:3999/proxy/frontend/rpc/:chainId

The first wallet associated with that seed is funded by anvil automatically.

> [!IMPORTANT]
> After hitting `/spawn`, it'll take ~2 minutes for ponder to return 200's from its `/ready` endpoint.
> You can use it before that (e.g., playing with schema in GraphQL playground) but it won't have data.

## API

The Pandvil server exposes the following endpoints:

### `POST /spawn`

Creates a new Ponder instance using its own set of new Anvil forks.

Request body:

```json
{
  "id": "optional-custom-id"
}
```

Response:

```json
{
  "id": "abc123",
  "rpcUrls": {
    "1": "http://localhost:3999/proxy/abc123/rpc/1"
  },
  "apiUrl": "http://localhost:3999/proxy/abc123/ponder/",
  "status": "starting"
}
```

### `GET /instance/:id`

Get the status of a Pandvil instance. The response is the same as above.

### `DELETE /instance/:id`

Kill a Pandvil instance and clean up its database schema.

### `POST /proxy/:id/ponder/*` and `POST /proxy/:id/rpc/:chainId/*`

Proxy requests to specific Ponder/anvil instances.

## Architecture

1. **Docker Container**: Provides isolated environment with all dependencies
2. **Ephemeral Neon Branches**: Each run gets its own database branch
3. **Anvil Instances**: Local blockchain forks with high `slotsInAnEpoch` to prevent finalization
4. **Ponder Instances**: Each gets a unique schema in the run's database branch
5. **Management Server**: Controls lifecycle of instances
