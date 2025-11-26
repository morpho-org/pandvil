import { type AnvilArgs } from "@/server/children/spawn-anvil";
import { isPonderReady, type PonderArgs } from "@/server/children/spawn-ponder";
import { startPandvil, type StartPandvilParameters } from "@/server/children/start-pandvil";
import { Chain } from "@/types";

type Metadata<T> = T extends undefined ? { metadata?: unknown } : { metadata: T };

export type Pandvil<T = undefined> = {
  createdAt: number;
  status: "starting" | "ready" | "stopping";
  stop: () => Promise<void>;
  id: string;
  rpcUrls: Record<number, { rpcUrl: string }>;
  apiUrl: string;
} & Metadata<T>;

export class InstanceManager<T = undefined> {
  public readonly instances = new Map<string, Pandvil<T>>();

  constructor(
    public readonly chains: readonly Chain[],
    public readonly anvilArgs: Omit<
      AnvilArgs,
      "port" | "forkChainId" | "forkUrl" | "forkBlockNumber"
    > = {},
    public readonly ponderArgs: Omit<PonderArgs, "port" | "schema"> = {},
  ) {}

  /** Starts a new instance -- pretty straightforward except for the `overrideRpcFn`. */
  async start({
    databaseUrl,
    id,
    metadata,
    rpcUrlRewriter,
  }: {
    /** The database ponder should point to */
    databaseUrl: string;
    /** The unique instance identifier */
    id: string;
    /** The RPC URL rewriter to pass to `startPandvil` (see those docs) */
    rpcUrlRewriter?: StartPandvilParameters["rpcUrlRewriter"];
  } & Metadata<T>) {
    if (this.instances.has(id)) {
      return this.instances.get(id)!;
    }

    const pandvil = await startPandvil({
      schema: "pandvil",
      databaseUrl,
      chains: this.chains,
      anvilArgs: this.anvilArgs,
      ponderArgs: this.ponderArgs,
      rpcUrlRewriter,
    });

    // Start watching for readiness
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    const readinessCheckInterval = setInterval(async () => {
      if (await isPonderReady(pandvil.apiUrl)) {
        const instance = this.instances.get(id);

        if (instance === undefined || instance.status === "stopping") return;
        instance.status = "ready";

        const backfillSeconds = Math.round((Date.now() - instance.createdAt) / 1000);
        console.log(
          `🏁 ${id} is ready! (backfill took ${(backfillSeconds / 60).toFixed(2)} minutes)`,
        );

        clearInterval(readinessCheckInterval);
      }
    }, 2_000);

    // Define unified teardown method
    const stop = async () => {
      const instance = this.instances.get(id);

      if (instance === undefined || instance.status === "stopping") return;
      instance.status = "stopping";

      clearInterval(readinessCheckInterval);
      await pandvil.stop();

      this.instances.delete(id);
    };

    const instance: Pandvil<T> = {
      ...pandvil,
      status: "starting" as const,
      stop,
      id,
      ...((metadata ? { metadata } : {}) as Metadata<T>),
    };

    this.instances.set(id, instance);
    return instance;
  }

  /** Stops the instance associated with `id`; returns success flag. */
  async stop(id: string) {
    try {
      await this.instances.get(id)?.stop();
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
