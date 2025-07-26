import { spawn as _spawn, SpawnOptionsWithoutStdio } from "child_process";

function toKebabCase(x: string) {
  return x.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
}

export function toArgs(obj: object): string[] {
  return Object.entries(obj).flatMap<string>(([key, value]) => {
    const flag = `--${toKebabCase(key)}`;

    switch (typeof value) {
      case "object": {
        if (Array.isArray(value)) {
          return [flag, value.join(",")];
        }
        const subArgs = toArgs(value as object);
        return subArgs[0] === undefined
          ? [flag]
          : [flag.concat(".", subArgs[0].slice(2), ...subArgs)];
      }
      case "undefined": {
        return [];
      }
      case "boolean": {
        return value ? [flag] : [flag, "false"];
      }
      default: {
        const stringified = String(value);
        return stringified === "" ? [flag] : [flag, stringified];
      }
    }
  });
}

export function spawn(
  tag: string,
  command: string,
  args: readonly string[] = [],
  options?: SpawnOptionsWithoutStdio,
  killTimeoutMs = 5_000,
) {
  const subprocess = _spawn(command, args, {
    cwd: process.cwd(),
    ...options,
    stdio: ["pipe", "pipe", "pipe"],
    detached: true,
  });

  subprocess.stdout.on("data", (buf) => {
    console.log(`${tag}: ${String(buf).trim()}`);
  });

  subprocess.stderr.on("data", (buf) => {
    console.error(`${tag}: ${String(buf).trim()}`);
  });

  subprocess.once("error", (err) => {
    console.error(`${tag}:`, err);
  });

  subprocess.once("exit", (code) => {
    console.warn(`${tag} Completed shutdown`.concat(code != null ? ` with code ${code}` : ""));
  });

  return async () => {
    console.log(`${tag} Requesting shutdown`);
    try {
      process.kill(-subprocess.pid!, "SIGTERM");
    } catch {}
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        try {
          process.kill(-subprocess.pid!, "SIGKILL");
        } catch {}
        resolve();
      }, killTimeoutMs);
      subprocess.once("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  };
}
