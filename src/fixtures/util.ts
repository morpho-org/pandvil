import { type AnvilTestClient } from "@morpho-org/test";
import { type Chain } from "viem";

import { getPonderStatus } from "@/server/children/spawn-ponder";
import { waitFor } from "@/server/utils/wait-for";
import { type InstanceStatusResponse } from "@/types";

export async function waitForIndexing<const chains extends readonly Chain[]>(
  {
    instance: { apiUrl },
    clients,
  }: {
    instance: InstanceStatusResponse;
    clients: Record<chains[number]["id"], AnvilTestClient<Chain>>;
  },
  timeoutMs: number,
  enableLogging: boolean,
  ...markers: { chainId: chains[number]["id"]; blocks: bigint }[]
) {
  const status0 = await getPonderStatus(apiUrl);

  return waitFor(
    async () => {
      const mins = await Promise.all(
        markers.map(async ({ chainId, blocks }) => ({
          chainId,
          blockNumber: blocks >= 0n ? blocks : blocks + (await clients[chainId].getBlockNumber()),
        })),
      );

      const status = await getPonderStatus(apiUrl);
      if (!status) return false;

      const logs: string[] = [];

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
        const percentage = Math.round(Math.min(fraction, 1) * 10_000) / 100;
        const emoji = current > required ? "🟢" : "🟡";
        logs.push(
          `${progressBar(fraction, 20)} ${percentage}% (${current} / ${required}) ☞ ${chainId} ${emoji}`,
        );
      }

      if (enableLogging) {
        console.log(logInBox(logs, "Indexing"));
      }

      return isSynced;
    },
    {
      timeoutMs,
      intervalMs: 500,
    },
  );
}

function logInBox(logs: string[], title: string = "") {
  const longestLogLength = logs.reduce((prev, log) => Math.max(log.length, prev), 0);
  // (left: space, bars, space) + (right: space, bars)
  const lineLength = Math.max(longestLogLength, title.length) + 3 + 2;

  const header = ` ╔═${title}`.padEnd(lineLength - 1, "═").concat("╗");
  const footer = ` ╚`.padEnd(lineLength - 1, "═").concat("╝");
  const body = logs.map((log) => ` ║ ${log}`.padEnd(lineLength - 1).concat("║")).join("\n");

  return `${header}\n${body}\n${footer}`;
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
