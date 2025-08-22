import { type AnvilArgs, isAnvilReady, spawnAnvil } from "./spawn-anvil";
import { type PonderArgs, spawnPonder } from "./spawn-ponder";

import { PortAllocator } from "@/server/utils/port-allocator";
import { waitFor } from "@/server/utils/wait-for";
import { Chain } from "@/types";

export interface StartPandvilParameters {
  /**
   * The connection string of the postgres database to be used.
   */
  databaseUrl: string;
  /**
   * The name of the (primary) schema to use within the database. Note
   * that if anvil ever finalizes blocks, pandvil will also touch
   * the `ponder_sync` schema. **To prevent this, ensure
   * `anvilArgs.slotsInAnEpoch` is very large.**
   */
  schema: string;
  /**
   * The list of chains (ids, rpc urls, and block numbers) to fork with anvil.
   * **Block numbers should be ≥ the latest entry in `ponder_sync.blocks`.**
   */
  chains: readonly Chain[];
  /**
   * The command line flags/args to pass to each anvil instance.
   */
  anvilArgs?: Omit<AnvilArgs, "port" | "forkChainId" | "forkUrl" | "forkBlockNumber">;
  /**
   * The command line flags/args to pass to ponder.
   */
  ponderArgs?: Omit<PonderArgs, "port" | "schema">;
  /**
   * ponder hashes the execution result of its `ponder.config.ts`
   * file, so changing RPC URLs makes it think a migration is necessary. This slows
   * things down and prevents you from reusing existing schemas. By default, RPC URLs
   * are non-deterministic (they depend on what ports are free when the instance
   * starts), so **schemas are rarely reusable**. `rpcUrlRewriter` allows the server
   * to **specify deterministic (proxied) RPC URLs to solve this issue.**
   */
  rpcUrlRewriter?: (x: { chainId: number; rpcUrl: string }) => string;
  /**
   * The lowest port number that might be used by any process within the
   * pandvil instance.
   */
  basePort?: number;
}

/**
 * Starts a single pandvil instance -- 1 ponder, N anvil (N = chains.length)
 */
export async function startPandvil({
  databaseUrl,
  schema,
  chains,
  anvilArgs = {},
  ponderArgs = {},
  rpcUrlRewriter = ({ rpcUrl }) => rpcUrl,
  basePort,
}: StartPandvilParameters) {
  const chainsAreUnique = chains.length === new Set(chains.map((chain) => chain.chainId)).size;
  if (!chainsAreUnique) {
    throw new Error(`Each \`chainId\` may only appear once in the \`chains\` array.`);
  }

  const ports = await PortAllocator.instance.reserve(chains.length + 1, { port: basePort }, 60_000);

  // `spawnAnvil` for each chain using the given `rpcUrl`
  const anvilArr = await Promise.all(
    chains.map(async ({ chainId, rpcUrl, blockNumber }, idx) => {
      // Create the instance
      const anvil = spawnAnvil({
        ...anvilArgs,
        port: ports[idx],
        // Set up fork.
        forkChainId: chainId,
        forkUrl: rpcUrl,
        forkBlockNumber: blockNumber,
      });
      // Wait for it to start
      await waitFor(() => isAnvilReady(anvil.rpcUrl), {
        timeoutMs: 5_000,
        intervalMs: 333,
      });

      return { chainId, ...anvil };
    }),
  );

  // Enable interval mining via RPC since CLI flag doesn't work
  if (anvilArgs.blockTime) {
    await Promise.allSettled(
      anvilArr.map((anvil) =>
        fetch(anvil.rpcUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "evm_setIntervalMining",
            params: [anvilArgs.blockTime],
          }),
        }),
      ),
    );
  }

  // Reshape anvil instances into a map (chainId => { rpcUrl })
  const rpcUrls = Object.fromEntries(
    anvilArr.map((anvil) => [anvil.chainId, { rpcUrl: anvil.rpcUrl }]),
  );
  const ponderRpcUrls: Record<number, { rpcUrl: string }> = Object.fromEntries(
    anvilArr.map((anvil) => [anvil.chainId, { rpcUrl: rpcUrlRewriter(anvil) }]),
  );

  // `spawnPonder` using local `rpcUrl`s from anvil
  const ponder = spawnPonder(
    { ...ponderArgs, port: ports.at(-1), schema },
    ponderRpcUrls,
    databaseUrl,
  );

  // Define unified teardown method and register it so that it runs even if vitest crashes mid-test
  let didStop = false;
  const stop = async () => {
    if (didStop) return;
    didStop = true;
    await ponder.stop();
    await Promise.all(anvilArr.map((anvil) => anvil.stop()));
  };

  return {
    createdAt: Date.now(),
    stop,
    rpcUrls,
    apiUrl: ponder.apiUrl,
  };
}
