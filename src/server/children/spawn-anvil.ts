import { spawn, toArgs } from "./spawn";

export interface AnvilArgs {
  /**
   * Number of dev accounts to generate and configure.
   *
   * @defaultValue 10
   */
  accounts?: number;
  /**
   * Set the Access-Control-Allow-Origin response header (CORS).
   *
   * @defaultValue *
   */
  allowOrigin?: string;
  /**
   * Enable autoImpersonate on startup
   */
  autoImpersonate?: true;
  /**
   * The balance of every dev account in Ether.
   *
   * @defaultValue 10000
   */
  balance?: number | bigint;
  /**
   * The base fee in a block.
   */
  blockBaseFeePerGas?: number | bigint;
  /**
   * Block time in seconds for interval mining.
   */
  blockTime?: number;
  /**
   * Path or alias to the Anvil binary.
   */
  binary?: string;
  /**
   * The chain id.
   */
  chainId?: number;
  /**
   * EIP-170: Contract code size limit in bytes. Useful to increase this because of tests.
   *
   * @defaultValue 0x6000 (~25kb)
   */
  codeSizeLimit?: number;
  /**
   * Sets the number of assumed available compute units per second for this fork provider.
   *
   * @defaultValue 350
   * @see https://github.com/alchemyplatform/alchemy-docs/blob/master/documentation/compute-units.md#rate-limits-cups
   */
  computeUnitsPerSecond?: number;
  /**
   * Writes output of `anvil` as json to user-specified file.
   */
  configOut?: string;
  /**
   * Sets the derivation path of the child key to be derived.
   *
   * @defaultValue m/44'/60'/0'/0/
   */
  derivationPath?: string;
  /**
   * Disable the `call.gas_limit <= block.gas_limit` constraint.
   */
  disableBlockGasLimit?: true;
  /**
   * Dump the state of chain on exit to the given file. If the value is a directory, the state will be
   * written to `<VALUE>/state.json`.
   */
  dumpState?: string;
  /**
   * Fetch state over a remote endpoint instead of starting from an empty state.
   *
   * If you want to fetch state from a specific block number, add a block number like `http://localhost:8545@1400000`
   * or use the `forkBlockNumber` option.
   */
  forkUrl?: string;
  /**
   * Fetch state from a specific block number over a remote endpoint.
   *
   * Requires `forkUrl` to be set.
   */
  forkBlockNumber?: number | bigint;
  /**
   * Specify chain id to skip fetching it from remote endpoint. This enables offline-start mode.
   *
   * You still must pass both `forkUrl` and `forkBlockNumber`, and already have your required state cached
   * on disk, anything missing locally would be fetched from the remote.
   */
  forkChainId?: number;
  /**
   * Specify headers to send along with any request to the remote JSON-RPC server in forking mode.
   *
   * e.g. "User-Agent: test-agent"
   *
   * Requires `forkUrl` to be set.
   */
  forkHeader?: Record<string, string>;
  /**
   * Initial retry backoff on encountering errors.
   */
  forkRetryBackoff?: number;
  /**
   * The block gas limit.
   */
  gasLimit?: number | bigint;
  /**
   * The gas price.
   */
  gasPrice?: number | bigint;
  /**
   * Disable minimum priority fee to set the gas price to zero.
   */
  disableMinPriorityFee?: true;
  /**
   * The EVM hardfork to use.
   */
  hardfork?:
    | "Frontier"
    | "Homestead"
    | "Dao"
    | "Tangerine"
    | "SpuriousDragon"
    | "Byzantium"
    | "Constantinople"
    | "Petersburg"
    | "Istanbul"
    | "Muirglacier"
    | "Berlin"
    | "London"
    | "ArrowGlacier"
    | "GrayGlacier"
    | "Paris"
    | "Shanghai"
    | "Cancun"
    | "Prague"
    | "Latest";
  /**
   * The host the server will listen on.
   */
  host?: string;
  /**
   * Initialize the genesis block with the given `genesis.json` file.
   */
  init?: string;
  /**
   * Launch an ipc server at the given path or default path = `/tmp/anvil.ipc`.
   */
  ipc?: string;
  /**
   * Initialize the chain from a previously saved state snapshot.
   */
  loadState?: string;
  /**
   * BIP39 mnemonic phrase used for generating accounts.
   */
  mnemonic?: string;
  /**
   * Automatically generates a BIP39 mnemonic phrase, and derives accounts from it.
   */
  mnemonicRandom?: true;
  /**
   * Disable CORS.
   */
  noCors?: true;
  /**
   * Disable auto and interval mining, and mine on demand instead.
   */
  noMining?: true;
  /**
   * Disables rate limiting for this node's provider.
   *
   * @defaultValue false
   * @see https://github.com/alchemyplatform/alchemy-docs/blob/master/documentation/compute-units.md#rate-limits-cups
   */
  noRateLimit?: true;
  /**
   * Explicitly disables the use of RPC caching.
   *
   * All storage slots are read entirely from the endpoint.
   */
  noStorageCaching?: boolean;
  /**
   * How transactions are sorted in the mempool.
   *
   * @defaultValue fees
   */
  order?: "fifo" | "fees";
  /**
   * Run an Optimism chain.
   */
  optimism?: true;
  /**
   * Port number to listen on.
   *
   * @defaultValue 8545
   */
  port?: number;
  /**
   * Don't keep full chain history. If a number argument is specified, at most this number of states is kept in memory.
   */
  pruneHistory?: number | undefined | boolean;
  /**
   * Number of retry requests for spurious networks (timed out requests).
   *
   * @defaultValue 5
   */
  retries?: number;
  /**
   * Don't print anything on startup and don't print logs.
   */
  silent?: true;
  /**
   * Slots in an epoch.
   */
  slotsInAnEpoch?: number;
  /**
   * Enable steps tracing used for debug calls returning geth-style traces.
   */
  stepsTracing?: true;
  /**
   * Interval in seconds at which the status is to be dumped to disk.
   */
  stateInterval?: number;
  /**
   * This is an alias for both `loadState` and `dumpState`. It initializes the chain with the state stored at the
   * file, if it exists, and dumps the chain's state on exit
   */
  state?: string;
  /**
   * Timeout in ms for requests sent to remote JSON-RPC server in forking mode.
   *
   * @defaultValue 45000
   */
  timeout?: number;
  /**
   * The timestamp of the genesis block.
   */
  timestamp?: number | bigint;
  /**
   * Number of blocks with transactions to keep in memory.
   */
  transactionBlockKeeper?: number;
  /**
   * Path to the cache directory where states are stored.
   */
  cachePath?: string;
}

export const DEFAULT_ANVIL_ARGS: AnvilArgs = {
  silent: true,
  autoImpersonate: true,
  order: "fifo",
  // TODO: might want to make this configurable based on block time
  pruneHistory: false,
  stepsTracing: true,
  gasPrice: 0n,
  blockBaseFeePerGas: 0n,
};

export function spawnAnvil(args: AnvilArgs) {
  const port = args.port ?? 8545;

  const stop = spawn(`[anvil :${port}]`, "anvil", toArgs({ ...args, port }));

  return {
    rpcUrl: `http://localhost:${port}/`,
    stop,
  };
}

export async function isAnvilReady(rpcUrl: string) {
  try {
    await fetch(rpcUrl, { method: "POST" });
    return true;
  } catch {
    return false;
  }
}
