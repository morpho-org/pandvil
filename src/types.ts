export interface Chain {
  chainId: number;
  rpcUrl: string;
  blockNumber: number;
}

export interface InstanceStatusResponse {
  id: string;
  rpcUrls: Record<number, { rpcUrl: string }>;
  apiUrl: string;
  status: "starting" | "ready" | "stopping";
}

export function typedFromEntries<K extends PropertyKey, V>(
  entries: readonly (readonly [K, V])[],
): { [P in K]: V } {
  return Object.fromEntries(entries) as { [P in K]: V };
}
