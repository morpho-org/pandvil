import { parseArgs } from "node:util";

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { proxy } from "hono/proxy";
import { z } from "zod";

import { DEFAULT_ANVIL_ARGS } from "@/server/children/spawn-anvil";
import { type PonderArgs } from "@/server/children/spawn-ponder";
import { Database } from "@/server/database";
import { InstanceManager, Pandvil } from "@/server/instance-manager";
import { NeonManager } from "@/server/neon-manager";
import { ShutdownRegistry } from "@/server/utils/shutdown-registry";
import { InstanceStatusResponse } from "@/types";

// Parse CLI args
const { values: cliArgs } = parseArgs({
  options: {
    "ponder-log-level": {
      type: "string", // PonderArgs["logLevel"]
      default: "warn",
    },
    "anvil-interval-mining": {
      type: "string", // "off" | number (integer seconds)
      default: "5",
    },
    "parent-branch": {
      type: "string",
      default: "main",
    },
    "preserve-ephemeral-branch": {
      type: "boolean",
      default: false,
    },
    "preserve-schemas": {
      type: "boolean",
      default: false,
    },
    spawn: {
      type: "string", // number (of instances to spawn) | ...string (variadic instance IDs)
      multiple: true,
    },
  },
  strict: true,
  allowPositionals: false,
});

// Get configuration from CLI args with env var fallbacks
const projectId = process.env.NEON_PROJECT_ID;
const ponderAppPath = process.env.PONDER_APP_PATH;
const port = Number(process.env.PORT ?? 3999);

if (!projectId) {
  throw new Error("Failed to start: missing NEON_PROJECT_ID");
}
if (!ponderAppPath) {
  throw new Error("Failed to start: missing PONDER_APP_PATH");
}

const neonManager = new NeonManager(projectId);
let db: Database | null = null;
let instanceManager: InstanceManager | null = null;
let instanceCount = 0;

// MARK: startup

/**
 * 1. Create ephemeral Neon branch
 * 2. Fetch latest block numbers for each chain
 * 3. Prepare new `InstanceManager`
 *
 * TODO: better isolate this so that it can be exported and used independent of the Docker container
 */
const startup = async () => {
  const parentBranchName = cliArgs["parent-branch"];
  const branch = await neonManager.createBranch({ parent: parentBranchName });

  console.log(`\n🟩 Neon:\n ═╣ ${parentBranchName}\n  ╙─☑︎ ${branch.name} (${branch.id})`);

  db = new Database(branch.connectionString);

  // Get latest block numbers
  const blockNumbers = await db.getLatestBlockNumbers();
  // Stop tracking any unconfirmed blocks (on this Neon branch only)
  await db.updateBlockNumberIntervals(blockNumbers);

  const chains = blockNumbers.map((x) => {
    const rpcUrl = process.env[`PONDER_RPC_URL_${x.chainId}`];
    if (!rpcUrl) {
      throw new Error(`Failed to start: missing PONDER_RPC_URL_${x.chainId}`);
    }
    return { ...x, rpcUrl };
  });

  console.log("\n⛓️ Chains:");
  console.log(chains);

  instanceManager = new InstanceManager(
    chains,
    // IMPORTANT: High value for `slotsInAnEpoch` ensures blocks aren't finalized and inserted into `ponder_sync`
    // IMPORTANT: Make block timestamp 100% predictable. (https://ponder.sh/docs/guides/foundry#mining-mode)
    {
      ...DEFAULT_ANVIL_ARGS,
      slotsInAnEpoch: 100_000,
      blockTime:
        cliArgs["anvil-interval-mining"] === "off"
          ? undefined
          : parseInt(cliArgs["anvil-interval-mining"]),
    },
    {
      root: ponderAppPath,
      logLevel: cliArgs["ponder-log-level"] as PonderArgs["logLevel"],
    },
  );

  if (cliArgs.spawn?.[0] !== undefined) {
    if (Number.isInteger(parseInt(cliArgs.spawn[0]))) {
      // --spawn <N>
      for (let i = 0; i < parseInt(cliArgs.spawn[0]); i += 1) {
        await spawn(instanceManager, db.connectionString);
      }
    } else {
      // --spawn <instance-name...>
      for (const id of cliArgs.spawn) {
        await spawn(instanceManager, db.connectionString, id);
      }
    }
  }
};

startup().catch((reason) => {
  throw new Error(`Failed to start: ${reason}`);
});

// MARK: hono

function spawn(im: InstanceManager, connectionString: string, id?: string) {
  const autoId = `instance-${instanceCount++}`;
  return im.start(
    connectionString,
    id ?? autoId,
    // Optional - proxy Ponder's own requests through the hono server:
    // ({ chainId }) => `http://localhost:${port}/proxy/${id}/rpc/${chainId}/`,
  );
}

function formatResponse(pandvil: Pandvil): InstanceStatusResponse {
  const id = pandvil.schema;
  const rpcUrls: Pandvil["rpcUrls"] = {};
  Object.keys(pandvil.rpcUrls).forEach((chainId) => {
    rpcUrls[Number(chainId)] = {
      rpcUrl: `http://localhost:${port}/proxy/${id}/rpc/${chainId}/`,
    };
  });
  return {
    id,
    rpcUrls,
    apiUrl: `http://localhost:${port}/proxy/${id}/ponder/`,
    status: pandvil.status,
  };
}

const SpawnBody = z.object({ id: z.string().optional() });

const app = new Hono();

app.use("*", cors());
app.use(
  "*",
  logger((str, ...rest) => {
    if (str.includes("/proxy")) return;
    console.log(str, ...rest);
  }),
);

app.get("/health", (c) => c.json({ status: "ok" }, 200));

app.get("/ready", (c) => c.json({}, instanceManager == null ? 503 : 200));

// TODO: allow user to pass more ponder + anvil args for customization
app.post("/spawn", async (c) => {
  if (db == null) {
    return c.json({ error: "Server not initialized. Waiting for database." }, 500);
  }

  if (instanceManager == null) {
    return c.json({ error: "Server not initialized. Getting latest block numbers." }, 500);
  }

  let id: string | undefined = undefined;
  try {
    const body = SpawnBody.parse(await c.req.json());
    if (body.id) {
      id = body.id;
    }
  } catch (e) {
    console.debug(`Failed to parse /spawn body; using auto-generated id`, e);
  }

  const instance = await spawn(instanceManager, db.connectionString, id);

  return c.json(formatResponse(instance));
});

app.get("/instance/:id", (c) => {
  const id = c.req.param("id");
  const instance = instanceManager?.instances.get(id);

  if (!instance) {
    return c.json({ error: "Instance not found." }, 404);
  }

  return c.json(formatResponse(instance));
});

app.delete("/instance/:id", async (c) => {
  const id = c.req.param("id");
  const instance = instanceManager?.instances.get(id);

  if (!instance) {
    return c.json({ error: "Instance not found." }, 404);
  }

  const didStop = await instanceManager?.stop(instance.schema);
  if (didStop) {
    if (!cliArgs["preserve-schemas"]) {
      await db?.dropSchemas(instance.schema);
    }
    return c.json({ status: "ok" }, 200);
  } else {
    return c.json({ error: "Failed to stop instance." }, 500);
  }
});

// Proxy requests to specific ponder instances
app.all("/proxy/:id/ponder/*", async (c) => {
  const id = c.req.param("id");
  const instance = instanceManager?.instances.get(id);

  if (!instance) {
    return c.json({ error: "Instance not found." }, 404);
  }

  const path = c.req.path.replace(`/proxy/${id}/ponder`, "");
  return proxy(`${instance.apiUrl}${path}`, c.req);
});

// Proxy requests to specific anvil instances
app.all("/proxy/:id/rpc/:chainId/*", async (c) => {
  const id = c.req.param("id");
  const instance = instanceManager?.instances.get(id);

  if (!instance) {
    return c.json({ error: "Instance not found." }, 404);
  }

  const chainId = c.req.param("chainId");
  const rpcUrl = instance.rpcUrls[Number(chainId)]?.rpcUrl;

  if (!rpcUrl) {
    return c.json({ error: "chainId not found." }, 404);
  }

  const path = c.req.path.replace(`/proxy/${id}/rpc/${chainId}`, "");
  return proxy(`${rpcUrl}${path}`, c.req);
});

// Proxy direct requests to make ponder's graphql Playground work
// NOTE: Hacky!! Must be registered last so other routes take precedence
app.all("/*", async (c) => {
  const referer = c.req.header("Referer") || "";
  const m = /\/proxy\/([^/]+)/.exec(referer);
  const id = m?.[1];
  if (!id) return c.json({ error: "Referer is not an instance" }, 400);

  const instance = instanceManager?.instances.get(id);

  if (!instance) {
    return c.json({ error: "Instance not found." }, 404);
  }

  return proxy(`${instance.apiUrl}${c.req.path}`, c.req);
});

const server = serve({ ...app, port });

// MARK: teardown

/**
 * 1. Shut down all pandvil instances
 * 2. Close database connection
 * 3. Delete ephemeral Neon branch
 */
ShutdownRegistry.instance.register(async () => {
  console.log("\n\n");
  console.log("🚦 Stopping all pandvil instances.");
  await instanceManager?.stopAll();
  console.log("🚦 Closing database connection.");
  await db?.close();
  if (!cliArgs["preserve-ephemeral-branch"]) {
    console.log("🚦 Deleting Neon branches.");
    await neonManager.deleteAll();
  }
  console.log("🚦 Shutting down server.");
  server.close();
});
