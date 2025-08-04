import { type AnvilArgs } from "@/server/children/spawn-anvil";
import { getPonderStatus, isPonderReady, type PonderArgs } from "@/server/children/spawn-ponder";
import { startPandvil, type StartPandvilParameters } from "@/server/children/start-pandvil";
import { Chain } from "@/types";

export interface Pandvil {
  createdAt: number;
  status: "starting" | "ready" | "stopping";
  stop: () => Promise<void>;
  schema: string;
  rpcUrls: Record<number, { rpcUrl: string }>;
  apiUrl: string;
}

export class InstanceManager {
  public readonly instances = new Map<string, Pandvil>();

  constructor(
    public readonly chains: readonly Chain[],
    public readonly anvilArgs: Omit<
      AnvilArgs,
      "port" | "forkChainId" | "forkUrl" | "forkBlockNumber"
    > = {},
    public readonly ponderArgs: Omit<PonderArgs, "port" | "schema"> = {},
  ) {}

  /**
   * Starts a new instance -- pretty straightforward except for the `overrideRpcFn`.
   *
   * @param databaseUrl The database ponder should point to
   * @param schema The database schema ponder should operate on
   * @param rpcUrlRewriter The RPC URL rewriter to pass to `startPandvil` (see those docs)
   */
  async start(
    databaseUrl: string,
    schema: string,
    rpcUrlRewriter?: StartPandvilParameters["rpcUrlRewriter"],
  ) {
    if (this.instances.has(schema)) {
      return this.instances.get(schema)!;
    }

    const pandvil = await startPandvil({
      schema,
      databaseUrl,
      chains: this.chains,
      anvilArgs: this.anvilArgs,
      ponderArgs: this.ponderArgs,
      rpcUrlRewriter,
    });

    // Start watching sync status
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    const statusCheckInterval = setInterval(async () => {
      const status = await getPonderStatus(pandvil.apiUrl);

      const statusTexts: string[] = [];
      for (const { chainId, blockNumber: forkBlockNumber } of this.chains) {
        const fraction = (status?.get(chainId) ?? 0) / forkBlockNumber;
        const emoji = " ▏▎▍▌▋▊▉█"[Math.round(fraction * 8)];
        statusTexts.push(
          ` ✦ ${schema}-${chainId}: ${emoji} (${Math.round(fraction * 10_000) / 100}%)`,
        );
      }
      console.log(statusTexts.join("\n"));
    }, 5_000);

    // Start watching for readiness
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    const readinessCheckInterval = setInterval(async () => {
      if (await isPonderReady(pandvil.apiUrl)) {
        const instance = this.instances.get(schema);

        if (instance === undefined || instance.status === "stopping") return;
        instance.status = "ready";

        const backfillSeconds = Math.round((Date.now() - instance.createdAt) / 1000);
        console.log(
          `🏁 ${schema} is ready! (backfill took ${(backfillSeconds / 60).toFixed(2)} minutes)`,
        );

        clearInterval(readinessCheckInterval);
        clearInterval(statusCheckInterval);
      }
    }, 2_000);

    // Define unified teardown method
    const stop = async () => {
      const instance = this.instances.get(schema);

      if (instance === undefined || instance.status === "stopping") return;
      instance.status = "stopping";

      clearInterval(readinessCheckInterval);
      clearInterval(statusCheckInterval);
      await pandvil.stop();

      this.instances.delete(schema);
    };

    const instance: Pandvil = {
      ...pandvil,
      status: "starting" as const,
      stop,
      schema,
    };

    this.instances.set(schema, instance);
    return instance;
  }

  /** Stops the instance associated with `schema`; returns success flag. */
  async stop(schema: string) {
    try {
      await this.instances.get(schema)?.stop();
      return true;
    } catch {
      return false;
    }
  }

  /** Stops all instances (best effort). */
  async stopAll() {
    return Promise.allSettled([...this.instances.values()].map((instance) => instance.stop()));
  }
}
