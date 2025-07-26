import { sleep } from "./sleep";

export async function waitFor(
  promiseFn: () => Promise<boolean>,
  { timeoutMs, intervalMs = 100 }: { timeoutMs: number; intervalMs?: number },
) {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    if (await promiseFn()) {
      return;
    }
    await sleep(intervalMs);
  }

  throw new Error(`Method still returning false after ${timeoutMs / 1000} sec`);
}
