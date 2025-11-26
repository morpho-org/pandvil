import { createAnvilTestClient, type AnvilTestClient } from "@morpho-org/test";
import { test } from "@playwright/test";
import { type Chain, http, type HttpTransportConfig } from "viem";

import { waitForIndexing } from "./util";

import { Client } from "@/client";
import { type InstanceStatusResponse, typedFromEntries } from "@/types";

/**
 * @dev You must start the pandvil dev server separately.
 *
 * @example
 * ```
 * const test = createPandvilTest({ chains: [] });
 *
 * test.describe("your app", () => {
 *   // [optional] Customize instance ID
 *   test.use({ instanceId: "my-instance" });
 *
 *   test("using my-instance", ({ pandvil }) => {
 *     // Use pandvil
 *   });
 *
 *   test("still using my-instance", ({ pandvil }) => {
 *     // Use pandvil some more -- changes persist through
 *     // tests sequentially!
 *   })
 * })
 * ```
 */
export function createPandvilTest<const chains extends readonly Chain[]>({
  chains,
  chainIdsToWaitOn,
  httpTransportConfig = {
    fetchOptions: { cache: "force-cache" },
    timeout: 5_000,
  },
  pandvilUrl = "http://localhost:3999/",
  timeoutMs = 60_000,
}: {
  chains: chains;
  chainIdsToWaitOn?: chains[number]["id"][];
  httpTransportConfig?: HttpTransportConfig;
  pandvilUrl?: string;
  timeoutMs?: number;
}) {
  return test.extend<
    object,
    {
      instanceId: string | undefined;
      client: Client;
      pandvil: {
        instance: InstanceStatusResponse;
        clients: Record<chains[number]["id"], AnvilTestClient<Chain>>;
      };
      waitForIndexing: (
        timeoutMs: number,
        enableLogging: boolean,
        ...markers: { chainId: chains[number]["id"]; blocks: bigint }[]
      ) => Promise<void>;
    }
  >({
    instanceId: [undefined, { scope: "worker", option: true }],

    client: [
      // eslint-disable-next-line no-empty-pattern
      async ({}, use) => {
        const client = new Client(pandvilUrl);
        await client.waitForServer({ timeoutMs: Infinity, intervalMs: 1_000 });
        await use(client);
      },
      { scope: "worker", timeout: 10_000, title: "Instantiate pandvil client" },
    ],

    pandvil: [
      async ({ instanceId, client }, use) => {
        console.log(`▻ Spawning ponder instance ${instanceId}, please wait...`);
        const instance = await client.spawn(instanceId);
        await client.waitForPonder(instance.id, { timeoutMs: Infinity, intervalMs: 1_000 });

        const clients = typedFromEntries(
          chains.map((chain) => {
            const { rpcUrl } = instance.rpcUrls[chain.id] ?? { rpcUrl: undefined };

            if (!(chain.id in instance.rpcUrls)) {
              throw new Error(`Missing anvil instance for chainId ${chain.id}`);
            }

            const client = createAnvilTestClient(http(rpcUrl, httpTransportConfig), chain);
            return [chain.id as chains[number]["id"], client];
          }),
        );

        for (const ki in instance.rpcUrls) {
          if (!(ki in clients)) {
            console.warn(`Skipping client creation for chainId ${ki} in test fixture`);
          }
        }

        const pandvil = { instance, clients };
        if (chainIdsToWaitOn) {
          await waitForIndexing(
            pandvil,
            Infinity,
            true,
            ...chainIdsToWaitOn.map((chainId) => ({ blocks: -5n, chainId })),
          );
        }
        await use(pandvil);

        await client.kill(instance.id);
      },
      { scope: "worker", timeout: timeoutMs, title: "Spawn ponder and wait for backfill" },
    ],

    waitForIndexing: [
      async ({ pandvil }, use) => {
        await use((timeoutMs, enableLogging, marker) =>
          waitForIndexing(pandvil, timeoutMs, enableLogging, marker),
        );
      },
      { scope: "worker" },
    ],
  });
}
