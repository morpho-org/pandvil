import { type AnvilTestClient } from "@morpho-org/test";
import { type Chain } from "viem";

import { getPonderStatus } from "@/server/children/spawn-ponder";
import { waitFor } from "@/server/utils/wait-for";

export async function waitForIndexing<const chains extends readonly Chain[]>(
  {
    clients,
    ponderUrl,
  }: { clients: Record<chains[number]["id"], AnvilTestClient<Chain>>; ponderUrl: string },
  timeoutMs: number,
  ...markers: { chainId: chains[number]["id"]; blocks: bigint }[]
) {
  const status0 = await getPonderStatus(ponderUrl);

  return waitFor(
    async () => {
      const mins = await Promise.all(
        markers.map(async ({ chainId, blocks }) => ({
          chainId,
          blockNumber: blocks >= 0n ? blocks : blocks + (await clients[chainId].getBlockNumber()),
        })),
      );

      const status = await getPonderStatus(ponderUrl);
      if (!status) return false;

      console.log("⌛︎ Syncing...\n ╔═══════════");

      let isSynced = true;
      for (const min of mins) {
        const chainId = min.chainId;

        const current = status.get(chainId) ?? 0;
        const required = Number(min.blockNumber);

        isSynced &&= current > required;

        // Logging
        const baseline = status0?.get(chainId) ?? 0;
        const denom = required - baseline;
        const fraction = denom <= 0 ? 1 : (current - baseline) / denom;
        const percentage = Math.round(fraction * 10_000) / 100;
        console.log(
          ` ║ ${progressBar(fraction, 20)} ${percentage}% (${current} / ${required}) ☞ ${chainId}`,
        );
      }

      console.log(" ╚═══════════");

      return isSynced;
    },
    {
      timeoutMs,
      intervalMs: 500,
    },
  );
}

function progressBar(fraction: number, lineLength: number = 10) {
  if (Number.isNaN(fraction) || !Number.isFinite(fraction)) {
    return "".padEnd(lineLength);
  }

  const f = Math.max(0, Math.min(fraction, 1));
  const glyphs = " ▏▎▍▌▋▊▉█";

  return [...Array<unknown>(lineLength)]
    .map((_, i) => {
      const sub = Math.max(0, Math.min(f * lineLength - i, 1));
      return glyphs[Math.round(sub * 8)];
    })
    .join("");
}
