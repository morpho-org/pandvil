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

### Building

```bash
pnpm docker:build ponder-app-package-name
# e.g.
pnpm docker:build curator-api
```

### Running

```bash
pnpm docker:run ponder-app-package-name --parent-branch some-neon-branch
# e.g.
pnpm docker:run curator-api --parent-branch production

# Output:
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
> If you reference the "run" script explicitly from a directory where
> `.env` or `.env.local` contains your environment variables, they'll be
> injected into the container automatically.
>
> Example:
>
> ```bash
> ../../packages/pandvil/scripts/run-docker.sh curator-api --parent-branch production
> ```
>
> Alternatively, just make sure your `.env` or `.env.local` is inside the pandvil
> directory.

### Connecting Interactively

The server should only take a few seconds to start. Once it's up, POST to `/spawn` with `{ id: "frontend" }`.
The resulting URLs are deterministic:

- `"http://localhost:3999/proxy/frontend/rpc/:chainId"`
- `"http://localhost:3999/proxy/frontend/ponder/"`

In your `.env` for, e.g. `apps/curator-v2-app`, update the corresponding `PRIVATE_{CHAIN}_RPC` and
`NEXT_PUBLIC_CURATOR_API_URL`.

Finally, run the curator app dev server, create a new Chrome profile, and configure [enkrypt](https://www.enkrypt.com/)
(in my testing this has been more amenable to altered RPCs than Rabby, which falls back to public ones too readily):

- Seed: "test test test test test test test test test test test junk"
- Custom RPC: http://localhost:3060/api/rpc/8453

The first wallet associated with that seed is funded by anvil automatically, and the curator app dev
server ensures that RPC gets proxied through to the pandvil server.

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
