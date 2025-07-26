import { exec } from "child_process";
import { platform } from "os";

import pidtree from "pidtree";

const IS_WINDOWS = platform() === "win32";

function getProcessName(pid: number) {
  const cmd = IS_WINDOWS ? `tasklist /FI "PID eq ${pid}" /FO CSV /NH` : `ps -p ${pid} -o comm=`;

  return new Promise<string>((resolve) => {
    exec(cmd, (err, stdout) => {
      if (err || !stdout) {
        resolve("");
        return;
      }

      if (IS_WINDOWS) {
        const parts = stdout.trim().split('","');
        const imageName = parts[0]?.replace(/^"|"$/g, "");
        resolve(imageName ?? "");
      } else {
        resolve(stdout.trim());
      }
    });
  });
}

/**
 * Kills *all* descendants of *any* descendant of `parentPid` that matches `pattern`.
 */
export async function killDescendants(pattern = /.*/, parentPid = process.pid, timeoutMs = 5000) {
  const children = (await pidtree(parentPid)).filter((pid) => pid !== parentPid);
  const matches = (
    await Promise.all(
      children.map(async (pid) => {
        const name = await getProcessName(pid);
        return { pid, name, matches: !!name && pattern.test(name) };
      }),
    )
  ).filter((x) => x.matches);

  await Promise.all(
    matches.map(async ({ pid, name }) => {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        await killDescendants(/.*/, pid, timeoutMs);
        return;
      }

      // Check child process status in 100ms intervals, waiting up to `timeoutMs`
      const t0 = Date.now();
      while (Date.now() - t0 < timeoutMs) {
        await new Promise((r) => setTimeout(r, 100));

        try {
          // Test for existence
          process.kill(pid, 0);
        } catch {
          console.log(`[${pid}] ${name || ""} shut down gracefully`);
          await killDescendants(/.*/, pid, timeoutMs);
          return;
        }
      }

      // Kill remaining ones
      try {
        process.kill(pid, "SIGKILL");
        console.log(`[${pid}] ${name || ""} shut down forcefully`);
      } catch {}

      await killDescendants(/.*/, pid, timeoutMs);
    }),
  );
}
