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
   * Whether to preserve Neon branches on server shutdown
   *
   * @defaultValue false
   */
  preserveBranches?: boolean;
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
  preserveBranches = false,
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
  let primaryBranchName: string | undefined = undefined;
  let instanceManager: InstanceManager<{ neonBranchId: string }> | undefined = undefined;
  let instanceCount = 0;

  // MARK: startup

  /**
   * 1. Create primary branch from parent and clean schemas
   * 2. Fetch latest block numbers for each chain
   * 3. Prepare new `InstanceManager`
   */
  const prepare = async () => {
    const branch = await neonManager.createBranch({ parent: parentBranchName });

    if (!branch.name) {
      throw new Error(`Failed to start: forked Neon branch came back with no name`);
    }
    console.log(`\n🟩 Neon:\n ═╣ ${parentBranchName}\n  ╙─☑︎ ${branch.name} (${branch.id})`);

    primaryBranchName = branch.name;

    const db = new Database(branch.connectionString);
    // Clean schemas to avoid naming conflicts
    const schemas = await db.listSchemas();
    await db.dropSchemas(
      ...schemas.filter((schema) => !["public", "ponder_sync", "pandvil"].includes(schema)),
    );
    // Get latest block numbers
    const blockNumbers = await db.getLatestBlockNumbers();
    // Stop tracking any unconfirmed blocks (on this Neon branch only)
    await db.updateBlockNumberIntervals(blockNumbers);
    await db.close();

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
      // IMPORTANT: Make block timestamp 100% predictable. (https://ponder.sh/docs/guides/foundry#mining-mode)
      {
        ...DEFAULT_ANVIL_ARGS,
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
            await spawn();
          }
        } else {
          // --spawn <instance-name...>
          for (const id of instances) {
            await spawn(id as string);
          }
        }
      }
    }
  };

  prepare().catch((reason) => {
    throw new Error(`Failed to start: ${reason}`);
  });

  // MARK: hono

  const spawn = async (id?: string) => {
    if (!instanceManager || !primaryBranchName) {
      return undefined;
    }

    const autoId = `instance-${instanceCount++}`;
    const instanceId = id ?? autoId;

    const branch = await neonManager.createBranch({
      parent: primaryBranchName,
      name: `${primaryBranchName}-${instanceId}`,
    });
    console.log(`\n🟩 Neon:\n ═╣ ${primaryBranchName}\n  ╙─☑︎ ${branch.name} (${branch.id})`);

    return instanceManager.start({
      databaseUrl: branch.connectionString,
      id: instanceId,
      metadata: { neonBranchId: branch.id },
      // Optional - proxy Ponder's own requests through the hono server:
      // rpcUrlRewriter: ({ chainId }) => `http://localhost:${port}/proxy/${instanceId}/rpc/${chainId}/`,
    });
  };

  const formatResponse = (pandvil: Pandvil): InstanceStatusResponse => {
    const id = pandvil.id;
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

  app.get("/ready", (c) => c.json({}, !instanceManager || !primaryBranchName ? 503 : 200));

  // TODO: allow user to pass more ponder + anvil args for customization
  app.post("/spawn", async (c) => {
    let id: string | undefined = undefined;
    try {
      const body = SpawnBody.parse(await c.req.json());
      if (body.id) {
        id = body.id;
      }
    } catch (e) {
      console.debug(`Failed to parse /spawn body; using auto-generated id`, e);
    }

    const instance = await spawn(id);
    if (!instance) {
      return c.json({ error: "Server not initialized." }, 500);
    }

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

    const didStop = await instanceManager?.stop(instance.id);
    if (didStop) {
      if (!preserveBranches) {
        await neonManager.deleteBranch(instance.metadata.neonBranchId);
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
    if (!preserveBranches) {
      console.log("🚦 Deleting Neon branches.");
      await neonManager.deleteAll();
    }
    console.log("🚦 Shutting down server.");
    server.close();
  };

  ShutdownRegistry.instance.register(stop);

  return { server, stop };
}
