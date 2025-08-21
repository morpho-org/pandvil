import { type AnvilTestClient } from "@morpho-org/test";
import { type Chain } from "viem";

import { isPonderSynced } from "@/server/children/spawn-ponder";
import { waitFor } from "@/server/utils/wait-for";

export function waitForIndexing<const chains extends readonly Chain[]>(
  {
    clients,
    ponderUrl,
  }: { clients: Record<chains[number]["id"], AnvilTestClient<Chain>>; ponderUrl: string },
  timeoutMs: number,
  ...markers: { chainId: chains[number]["id"]; blocks: bigint }[]
) {
  return waitFor(
    async () => {
      const tips = await Promise.all(
        markers.map(async ({ chainId, blocks }) => ({
          chainId,
          blockNumber: blocks + (await clients[chainId].getBlockNumber()),
        })),
      );

      return isPonderSynced(ponderUrl, ...tips);
    },
    {
      timeoutMs,
      intervalMs: 500,
    },
  );
}
