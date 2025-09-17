import { serve } from "@hono/node-server";
import { type Context, Hono } from "hono";
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
import type { InstanceStatusResponse } from "@/types";

export interface ServerArgs {
  /**
   * Port number for the server
   *
   * @defaultValue 3999
   */
  port?: number;
  /**
   * Minimum log level for Ponder
   *
   * @defaultValue "warn"
   */
  ponderLogLevel?: PonderArgs["logLevel"];
  /**
   * Block time (integer seconds) for anvil interval mining, or "off"
   *
   * @defaultValue 5
   */
  anvilIntervalMining?: "off" | number;
  /**
   * Neon parent branch ID to fork off of
   *
   * @defaultValue "main"
   */
  parentBranch?: string;
  /**
   * Whether to preserve the Neon child branch on server shutdown
   *
   * @defaultValue false
   */
  preserveEphemeralBranch?: boolean;
  /**
   * Whether to preserve database schemas on instance shutdown
   *
   * @defaultValue false
   */
  preserveSchemas?: boolean;
  /**
   * Number of instances to spawn, or variadic string instance IDs
   */
  spawn?: [] | [number] | [string, ...string[]];
}

export function startServer({
  port,
  ponderLogLevel = "warn",
  anvilIntervalMining = 5,
  parentBranch: parentBranchName = "main",
  preserveEphemeralBranch = false,
  preserveSchemas = false,
  spawn: instances,
}: ServerArgs) {
  port ??= Number(process.env.PORT ?? 3999);

  const projectId = process.env.NEON_PROJECT_ID;
  const ponderAppPath = process.env.PONDER_APP_PATH;

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
   */
  const prepare = async () => {
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
        blockTime: anvilIntervalMining === "off" ? undefined : Math.round(anvilIntervalMining),
      },
      {
        root: ponderAppPath,
        logLevel: ponderLogLevel,
      },
    );

    switch (typeof instances) {
      case "object": {
        if (!Array.isArray(instances) || instances.length === 0) break;

        if (typeof instances[0] === "number") {
          // --spawn <N>
          for (let i = 0; i < instances[0]; i += 1) {
            await spawn(instanceManager, db.connectionString);
          }
        } else {
          // --spawn <instance-name...>
          for (const id of instances) {
            await spawn(instanceManager, db.connectionString, id as string);
          }
        }
      }
    }
  };

  prepare().catch((reason) => {
    throw new Error(`Failed to start: ${reason}`);
  });

  // MARK: hono

  const spawn = (im: InstanceManager, connectionString: string, id?: string) => {
    const autoId = `instance-${instanceCount++}`;
    return im.start(
      connectionString,
      id ?? autoId,
      // Optional - proxy Ponder's own requests through the hono server:
      // ({ chainId }) => `http://localhost:${port}/proxy/${id}/rpc/${chainId}/`,
    );
  };

  const formatResponse = (pandvil: Pandvil): InstanceStatusResponse => {
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
  };

  const SpawnBody = z.object({ id: z.string().optional() });

  const app = new Hono();

  app.use("*", cors());
  app.use(
    "*",
    logger((str, ...rest) => {
      if (str.includes("/proxy") || !process.env.DEBUG) return;
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
      if (!preserveSchemas) {
        await db?.dropSchemas(instance.schema);
      }
      return c.json({ status: "ok" }, 200);
    } else {
      return c.json({ error: "Failed to stop instance." }, 500);
    }
  });

  // Proxy requests to specific ponder instances
  const ponderProxyHandler = async (c: Context) => {
    const id = c.req.param("id");
    const instance = instanceManager?.instances.get(id);

    if (!instance) {
      return c.json({ error: "Instance not found." }, 404);
    }

    const { search } = new URL(c.req.url);
    const path = c.req.param("tail") ?? "";
    try {
      return proxy(`${instance.apiUrl}${path}${search}`, c.req);
    } catch {
      return c.json({ error: "Instance not up yet." }, 503);
    }
  };
  app.all("/proxy/:id/ponder", ponderProxyHandler);
  app.all("/proxy/:id/ponder/", ponderProxyHandler);
  app.all("/proxy/:id/ponder/:tail{.*}", ponderProxyHandler);

  // Proxy requests to specific anvil instances
  const rpcProxyHandler = async (c: Context) => {
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

    const { search } = new URL(c.req.url);
    const path = c.req.param("tail") ?? "";
    try {
      return proxy(`${rpcUrl}${path}${search}`, c.req);
    } catch {
      return c.json({ error: "Instance not up yet." }, 503);
    }
  };
  app.all("/proxy/:id/rpc/:chainId", rpcProxyHandler);
  app.all("/proxy/:id/rpc/:chainId/", rpcProxyHandler);
  app.all("/proxy/:id/rpc/:chainId/:tail{.*}", rpcProxyHandler);

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

    try {
      const { search } = new URL(c.req.url);
      const target = new URL(c.req.path, instance.apiUrl);
      return proxy(`${target}${search}`, c.req);
    } catch {
      return c.json({ error: "Instance not up yet." }, 503);
    }
  });

  const server = serve({ ...app, port });

  const stop = async () => {
    console.log("\n\n");
    console.log("🚦 Stopping all pandvil instances.");
    await instanceManager?.stopAll();
    console.log("🚦 Closing database connection.");
    await db?.close();
    if (!preserveEphemeralBranch) {
      console.log("🚦 Deleting Neon branches.");
      await neonManager.deleteAll();
    }
    console.log("🚦 Shutting down server.");
    server.close();
  };

  ShutdownRegistry.instance.register(stop);

  return { server, stop };
}
