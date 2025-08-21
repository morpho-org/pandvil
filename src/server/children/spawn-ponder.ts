import { spawn, toArgs } from "./spawn";

export interface PonderArgs {
  /**
   * Path to the project root directory
   *
   * @defaultValue working directory
   */
  root?: string;
  /**
   * Path to the project config file
   *
   * @defaultValue "ponder.config.ts"
   */
  config?: string;
  /**
   * Enable debug logs, e.g. realtime blocks, internal events
   */
  debug?: true;
  /**
   * Enable trace logs, e.g. db queries, indexing checkpoints
   */
  trace?: true;
  /**
   * Minimum log level
   *
   * @defaultValue "info"
   */
  logLevel?: "error" | "warn" | "info" | "debug" | "trace";
  /**
   * The log format
   *
   * @defaultValue "pretty"
   */
  logFormat?: "pretty" | "json";
  /**
   * Database schema
   */
  schema?: string;
  /**
   * Port for the web server
   *
   * @defaultValue 42069
   */
  port?: number;
  /**
   * Hostname for the web server
   *
   * @defaultValue "0.0.0.0" or "::"
   */
  hostname?: string;
}

/**
 * Spawns a new ponder instance pointed at the specified `rpcUrls` and `databaseUrl`.
 *
 * @dev In order for `rpcUrls` to take effect, your ponder config _MUST_ specify RPC URLs
 * in the form `process.env.PONDER_RPC_URL_CHAINID`, e.g. `PONDER_RPC_URL_8453`.
 * @dev In order for `databaseUrl` to take effect, your ponder config _MUST_ have
 * `kind: "postgres"` with no `connectionString`, or have it specified like
 * `connectionString: process.env.DATABASE_URL`.
 */
export function spawnPonder(
  args: PonderArgs,
  rpcUrls: Record<number, { rpcUrl: string }>,
  databaseUrl?: string,
) {
  const port = args.port ?? 42069;

  const rpcUrlEnv = Object.fromEntries(
    Object.entries(rpcUrls).map(([chainId, { rpcUrl }]) => [`PONDER_RPC_URL_${chainId}`, rpcUrl]),
  );

  const stop = spawn(
    `[ponder :${port}]`,
    "pnpm",
    ["ponder", "start", ...toArgs({ ...args, port, root: undefined })],
    {
      cwd: args.root,
      env: {
        ...(({ SCHEMA, HOSTNAME, PORT, ...rest }) => rest)(process.env),
        ...rpcUrlEnv,
        ...(databaseUrl ? { DATABASE_URL: databaseUrl } : {}),
        PONDER_TELEMETRY_DISABLED: "true",
      },
    },
  );

  return {
    apiUrl: `http://localhost:${port}/`,
    stop,
  };
}

export async function isPonderReady(apiUrl: string) {
  try {
    const response = await fetch(new URL("ready", apiUrl));
    return response.status === 200;
  } catch {
    return false;
  }
}

export async function getPonderStatus(apiUrl: string) {
  try {
    const response = await fetch(new URL("status", apiUrl));
    const data = (await response.json()) as {
      [chainName: string]: { id: number; block: { number: number; timestamp: number } };
    };
    return new Map(Object.values(data).map((v) => [v.id, v.block.number]));
  } catch {
    return undefined;
  }
}

export async function isPonderSynced(
  apiUrl: string,
  ...mins: { chainId: number; blockNumber: bigint }[]
) {
  const status = await getPonderStatus(apiUrl);
  if (!status) return false;

  for (const min of mins) {
    if (BigInt(status.get(min.chainId) ?? 0) <= min.blockNumber) {
      return false;
    }
  }

  return true;
}
